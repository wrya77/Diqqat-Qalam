'use strict';
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const multer     = require('multer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');

const GCodeGenerator    = require('./src/generators/GCodeGenerator');
const PathOptimizer     = require('./src/optimizers/PathOptimizer');
const FeedrateOptimizer = require('./src/optimizers/FeedrateOptimizer');
const SVGParser         = require('./src/parsers/SVGParser');
const DXFParser         = require('./src/parsers/DXFParser');
const AIOptimizer       = require('./src/ai/AIOptimizer');
const MachineConfig     = require('./src/core/MachineConfig');
const validator         = require('./src/utils/validator');
const geometry          = require('./src/utils/geometry');
const ProjectManager    = require('./src/core/ProjectManager');
const ToolLibrary       = require('./src/core/ToolLibrary');
const { applyPostProcessor } = require('./src/generators/PostProcessors');
const DXFExporter       = require('./src/exporters/DXFExporter');
const GCodeValidator    = require('./src/utils/GCodeValidator');

const projectMgr = new ProjectManager();
const toolLib    = new ToolLibrary();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

// CNC Connector (TCP over Wi-Fi)
const CNCConnector = require('./src/core/CNCConnector');
const cnc = new CNCConnector(io);

// ── CNC endpoints ────────────────────────────────────────────────────────────

// قائمة منافذ Serial المتاحة
app.get('/api/cnc/ports', async (req, res) => {
  try {
    const ports = await CNCConnector.listPorts();
    res.json({ ports });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// اتصال (TCP أو Serial)
app.post('/api/cnc/connect', async (req, res) => {
  const { type = 'tcp', host, port, serialPort, baudRate } = req.body || {};
  try {
    let r;
    if (type === 'serial') {
      if (!serialPort) return res.status(400).json({ error: 'serialPort مطلوب' });
      r = await cnc.connectSerial(serialPort, +baudRate || 115200);
    } else {
      if (!host || !port) return res.status(400).json({ error: 'host و port مطلوبان' });
      r = await cnc.connectTCP(host, +port);
    }
    res.json({ success: true, status: cnc.getStatus() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cnc/disconnect', (req, res) => {
  cnc.disconnect();
  res.json({ success: true });
});

app.post('/api/cnc/send', async (req, res) => {
  try {
    const { line } = req.body || {};
    if (!line) return res.status(400).json({ error: 'line required' });
    await cnc.sendLine(line);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cnc/stream', async (req, res) => {
  try {
    const { gcode } = req.body || {};
    if (!gcode) return res.status(400).json({ error: 'gcode required' });
    const r = await cnc.streamGCode(gcode);
    res.json({ success: true, started: r.started, total: r.total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cnc/status', (req, res) => res.json({ status: cnc.getStatus(), logs: cnc.tailLogs(200) }));

// E-Stop
app.post('/api/cnc/estop', (req, res) => {
  cnc.emergencyStop();
  res.json({ success: true });
});

// إيقاف البث
app.post('/api/cnc/stop', (req, res) => {
  cnc.stopStream();
  res.json({ success: true });
});

// Jog
app.post('/api/cnc/jog', async (req, res) => {
  const { axis, distance, feedRate } = req.body || {};
  try {
    await cnc.jog(axis, +distance, +feedRate || 1000);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// forward connector events to console
cnc.on('cnc-status', s => console.log('CNC status', s));
cnc.on('cnc-response', d => console.log('CNC >', d.line));
cnc.on('cnc-sent', d => console.log('CNC <', d.line));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/auth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));
app.get('/app',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Public config (Supabase public keys only — safe to expose) ────────────────
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL  || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 50*1024*1024 } });

// API: Generate G-Code
app.post('/api/generate', async (req, res) => {
  try {
    const { shapes, config: rawConfig, useAI } = req.body;
    const err = validator.validateShapes(shapes);
    if (err && err.length) return res.status(400).json({ error: err });

    const config = new MachineConfig(rawConfig).toObject();
    let processedShapes = shapes;
    let suggestions = [], estimatedSaving = '0%';

    const optimizer = new PathOptimizer(config);
    processedShapes = optimizer.optimize(processedShapes);

    // إذا طُلب AI فجرّب الاتصال بخدمة Anthropic، لكن احتفظ بف fallback محلي
    if (useAI) {
      // استخدم MockAIOptimizer إذا لم يتوفر مفتاح Anthropic لتسريع التطوير
      const AIImpl = process.env.ANTHROPIC_API_KEY ? AIOptimizer : require('./src/ai/MockAIOptimizer');
      const ai = process.env.ANTHROPIC_API_KEY ? new AIImpl(process.env.ANTHROPIC_API_KEY) : new AIImpl();
      try {
        const r = await ai.optimizePaths(processedShapes, config);
        if (r && r.optimizedShapes && r.optimizedShapes.length === processedShapes.length) {
          processedShapes = r.optimizedShapes;
          suggestions     = r.suggestions || [];
          estimatedSaving = r.estimatedSaving || '0%';
          io.emit('ai-suggestions', { suggestions, estimatedSaving });
        } else {
          // fallback: نستخدم ترتيب محلي فقط
          const local = new PathOptimizer(config);
          processedShapes = local.optimize(processedShapes);
          suggestions = ['AI returned invalid result — used local optimizer'];
        }
      } catch (e) {
        console.error('AI optimize error:', e && e.message ? e.message : e);
        const local = new PathOptimizer(config);
        processedShapes = local.optimize(processedShapes);
        suggestions = [`AI error: ${e && e.message ? e.message : String(e)}`];
      }
    }

    // تأكد من أن كل شكل لديه feedRate وتلقّي تقدير القوى النهائي
    const feedOpt = new FeedrateOptimizer();
    processedShapes = feedOpt.assignFeedRates(processedShapes, config, { preserveExisting: true });

    const generator = new GCodeGenerator(config);
    let { gcode, stats } = generator.generate(processedShapes);

    // تطبيق Post-Processor حسب ملف الآلة
    if (rawConfig.machineProfile && rawConfig.machineProfile !== 'generic') {
      gcode = applyPostProcessor(gcode, config, rawConfig.machineProfile);
    }

    // تجميع تحليل قوى/توصيات لكل شكل لواجهة المستخدم
    const analysis = processedShapes.map((s, i) => {
      if (!s || !s.type) return null;
      return {
        index: i,
        type: s.type,
        length: geometry.shapeLength(s),
        feedRate: s.feedRate || null,
        maxRecommendedFeedRate: s.maxRecommendedFeedRate || null,
        forceEstimate: s.forceEstimate || null,
        engagement: s.forceEstimate && s.forceEstimate.engagement,
      };
    }).filter(Boolean);

    const aiMetadata = (typeof r !== 'undefined' && r && r.metadata) ? r.metadata : null;

    res.json({ success: true, gcode, stats, suggestions, estimatedSaving, analysis, aiMetadata, processedShapes });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// API: Import file
app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يُرفع ملف' });
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let shapes = [];

    if (ext === '.svg') {
      const content = fs.readFileSync(filePath, 'utf8');
      shapes = new SVGParser().parse(content);
    } else if (ext === '.dxf') {
      const content = fs.readFileSync(filePath, 'utf8');
      shapes = new DXFParser().parse(content);
    } else if (['.nc','.gcode','.tap'].includes(ext)) {
      const gcode = fs.readFileSync(filePath, 'utf8');
      try { fs.unlinkSync(filePath); } catch(_) {}
      return res.json({ success: true, type: 'gcode', gcode });
    }

    try { fs.unlinkSync(filePath); } catch(_) {}

    if (!shapes.length) return res.status(400).json({ error: 'لم يُعثر على أشكال في الملف' });
    res.json({ success: true, type: 'shapes', shapes, count: shapes.length });

  } catch (err) {
    console.error(err);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch(_){}
    res.status(500).json({ error: err.message });
  }
});

// API: Export file
app.post('/api/export', (req, res) => {
  const { gcode, filename = 'design', ext = '.nc' } = req.body;
  if (!gcode) return res.status(400).json({ error: 'G-Code مطلوب' });
  const safe = filename.replace(/[^a-zA-Z0-9_-]/g,'_');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}${ext}"`);
  res.send(gcode);
});

// API: Info
app.get('/api/info', (req, res) => {
  res.json({
    version: '1.1.0',
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
    profiles: MachineConfig.getProfiles()
  });
});

// ── Projects ──────────────────────────────────────────────────────────────────
app.get('/api/projects', (req, res) => {
  try { res.json({ projects: projectMgr.list() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/project/save', (req, res) => {
  const { name, data } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name مطلوب' });
  try {
    const result = projectMgr.save(name, data || {});
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/project/:id', (req, res) => {
  try { res.json({ project: projectMgr.load(req.params.id) }); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

app.delete('/api/project/:id', (req, res) => {
  try { projectMgr.delete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

// ── Tools Library ─────────────────────────────────────────────────────────────
app.get('/api/tools', (req, res) => {
  try { res.json({ tools: toolLib.getAll() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tools', (req, res) => {
  try {
    const tool = toolLib.add(req.body || {});
    res.json({ success: true, tool });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/tools/:id', (req, res) => {
  try {
    const tool = toolLib.update(req.params.id, req.body || {});
    res.json({ success: true, tool });
  } catch (err) { res.status(404).json({ error: err.message }); }
});

app.delete('/api/tools/:id', (req, res) => {
  try { toolLib.delete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

app.get('/api/tools/:id/speeds/:material', (req, res) => {
  const speeds = toolLib.getSpeeds(req.params.id, req.params.material);
  if (!speeds) return res.status(404).json({ error: 'لا توجد بيانات لهذه الأداة/المادة' });
  res.json({ speeds });
});

// ── DXF Export ───────────────────────────────────────────────────────────────
app.post('/api/export/dxf', (req, res) => {
  const { shapes, filename = 'design', units = 'mm' } = req.body || {};
  if (!shapes || !shapes.length) return res.status(400).json({ error: 'أشكال مطلوبة' });
  try {
    const exp  = new DXFExporter({ units });
    const dxf  = exp.export(shapes);
    const safe = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.dxf"`);
    res.send(dxf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── G-Code Validation ─────────────────────────────────────────────────────────
app.post('/api/validate-gcode', (req, res) => {
  const { gcode, machineConfig = {} } = req.body || {};
  if (!gcode) return res.status(400).json({ error: 'gcode مطلوب' });
  try {
    const validator = new GCodeValidator(machineConfig);
    const result    = validator.validate(gcode);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Post-Processor ────────────────────────────────────────────────────────────
app.post('/api/postprocess', (req, res) => {
  const { gcode, config, profile } = req.body || {};
  if (!gcode) return res.status(400).json({ error: 'gcode مطلوب' });
  try {
    const result = applyPostProcessor(gcode, config || {}, profile || 'generic');
    res.json({ success: true, gcode: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// WebSocket: streaming generation
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.on('generate-stream', async ({ shapes, config: rawConfig }) => {
    try {
      const config = new MachineConfig(rawConfig).toObject();
      const opt    = new PathOptimizer(config);
      const gen    = new GCodeGenerator(config);
      const { gcode, stats } = gen.generate(opt.optimize(shapes));
      const lines = gcode.split('\n');
      socket.emit('stream-start', { total: lines.length, stats });
      for (let i = 0; i < lines.length; i++) {
        socket.emit('stream-line', { line: lines[i], index: i });
        if (i % 300 === 0) await new Promise(r => setImmediate(r));
      }
      socket.emit('stream-end', { stats });
    } catch (err) {
      socket.emit('stream-error', { error: err.message });
    }
  });
});

// In serverless environments (Vercel), export the app instead of listening
if (process.env.VERCEL) {
  module.exports = app;
} else {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Diqqat Qalam running on port ${PORT}`);
  });
  module.exports = { app, server };
}
