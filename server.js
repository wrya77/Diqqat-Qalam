'use strict';
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const multer     = require('multer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const compression = require('compression');

// ── Core modules ──────────────────────────────────────────────────────────────
const GCodeGenerator    = require('./src/generators/GCodeGenerator');
const PathOptimizer     = require('./src/optimizers/PathOptimizer');
const FeedrateOptimizer = require('./src/optimizers/FeedrateOptimizer');
const SVGParser         = require('./src/parsers/SVGParser');
const DXFParser         = require('./src/parsers/DXFParser');
const AIOptimizer       = require('./src/ai/AIOptimizer');
const MachineConfig     = require('./src/core/MachineConfig');
const validator         = require('./src/utils/validator');
const ProjectManager    = require('./src/core/ProjectManager');
const ToolLibrary       = require('./src/core/ToolLibrary');
const { applyPostProcessor } = require('./src/generators/PostProcessors');
const DXFExporter       = require('./src/exporters/DXFExporter');
const GCodeValidator    = require('./src/utils/GCodeValidator');

// ── New feature modules ───────────────────────────────────────────────────────
const JobQueue              = require('./src/core/JobQueue');
const CostEstimator         = require('./src/core/CostEstimator');
const SubscriptionManager   = require('./src/core/SubscriptionManager');
const TemplateManager       = require('./src/core/TemplateManager');
const Analytics             = require('./src/core/Analytics');
const BackupManager         = require('./src/core/BackupManager');
const WebhookManager        = require('./src/core/WebhookManager');
const MachineMonitor        = require('./src/core/MachineMonitor');
const BatchProcessor        = require('./src/core/BatchProcessor');
const MaterialCostCalculator = require('./src/utils/MaterialCostCalculator');

// ── Ensure required directories exist ────────────────────────────────────────
['uploads', 'exports', 'projects', 'data', 'backups'].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Service instances ─────────────────────────────────────────────────────────
const projectMgr   = new ProjectManager();
const toolLib      = new ToolLibrary();
const jobQueue     = new JobQueue();
const costEst      = new CostEstimator();
const subMgr       = new SubscriptionManager();
const WorkerPool   = require('./src/core/WorkerPool');
const genPool      = new WorkerPool();   // توليد G-Code خارج الخيط الرئيسي
const templateMgr  = new TemplateManager();
const analytics    = new Analytics();
const backupMgr    = new BackupManager();
const webhookMgr   = new WebhookManager();
const batchProc    = new BatchProcessor();
const matCalc      = new MaterialCostCalculator();

// ── Express app setup ─────────────────────────────────────────────────────────
const app    = express();
// خلف proxy الاستضافة (Railway/Render): يصحح req.ip و req.protocol
// مطلوب لعمل rate limiting وروابط callback الدفع بشكل سليم
app.set('trust proxy', 1);
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin:  process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST'],
  },
});

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      // معالجات inline (onclick/oninput/onsubmit) — يستخدمها auth.html و index.html
      // بدون هذا السطر يبقى الافتراضي 'none' في Helmet فتتعطّل كل الأزرار (زر التسجيل مثلاً)
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc:     ["'self'", 'fonts.gstatic.com'],
      connectSrc:  ["'self'", 'ws:', 'wss:', 'https://*.supabase.co'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      600,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'طلبات كثيرة جداً. حاول مجدداً بعد 15 دقيقة.' },
});

const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      30,
  message: { error: 'تجاوزت حد توليد G-Code. حاول مجدداً بعد دقيقة.' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      20,
  message: { error: 'تجاوزت حد رفع الملفات. حاول مجدداً.' },
});

// ── Compression: gzip لكل الاستجابات (يقلص النقل ~75%) ───────────────────────
app.use(compression());

// ── Static files served BEFORE rate limiting ──────────────────────────────────
// كاش ساعة للملفات الثابتة — Service Worker يتكفل بالتحديث الفوري للعائدين
const staticOpts = {
  maxAge: '1h',
  setHeaders(res, filePath) {
    // ملف الـ SW نفسه يجب ألا يُكَش حتى تصل التحديثات فوراً
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
};
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
// المحرك المشترك — نفس الملفات التي يستخدمها الخادم تُخدَّم للمتصفح
app.use('/shared', express.static(path.join(__dirname, 'shared'), staticOpts));

app.use(globalLimiter);
app.use(express.json({ limit: '5mb' }));          // كان 50mb — قلّصناه لمنع استنزاف الذاكرة (الرفع يمر عبر multer لا عبر هذا)
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Auth middleware (Supabase JWT + API key) ──────────────────────────────────
const { attachUser, requireAuth, requireAuthOrApiKey, isValidApiKey } = require('./src/middleware/auth');

// Verifies Bearer token (if any) and sets req.user — never blocks
app.use('/api', attachUser);

// Admin-only endpoints: timing-safe API key check, header only (never query string)
const requireApiKey = (req, res, next) => {
  const serverKey = process.env.API_SECRET_KEY;
  if (!serverKey) {
    // fail-closed: لا نفتح النقاط الإدارية أبداً بلا مفتاح إلا في التطوير الصريح
    if (process.env.NODE_ENV !== 'development') {
      return res.status(503).json({ error: 'نقطة إدارية معطّلة: لم يُضبط API_SECRET_KEY على الخادم.' });
    }
    return next(); // تطوير محلي فقط (NODE_ENV=development)
  }

  if (!isValidApiKey(req)) {
    analytics.track('error', { type: 'unauthorized', path: req.path, ip: req.ip });
    return res.status(401).json({ error: 'غير مصرح. مطلوب مفتاح API صالح.' });
  }
  next();
};

// ── Cache-control ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// خطأ خادم 500: نسجّل التفاصيل داخلياً ونرجع رسالة عامة (لا نسرّب رسائل داخلية للعميل)
function fail(res, err, msg = 'حدث خطأ في الخادم. حاول مجدداً.') {
  console.error('API error:', err?.message || err);
  res.status(500).json({ error: msg });
}

// ── CNC Connector ─────────────────────────────────────────────────────────────
const CNCConnector = require('./src/core/CNCConnector');
const cnc     = new CNCConnector(io);
const monitor = new MachineMonitor();
monitor.attach(cnc);

// Forward monitor events to WebSocket clients
monitor.on('machine-alarm',    d => io.emit('monitor-alarm',    d));
monitor.on('critical-alarm',   d => io.emit('monitor-critical', d));
monitor.on('high-error-rate',  d => io.emit('monitor-error-rate', d));
monitor.on('machine-idle',     d => io.emit('monitor-idle',     d));

// Forward job queue events
jobQueue.on('job-queued',    d => io.emit('queue-job-queued',   d));
jobQueue.on('job-started',   d => io.emit('queue-job-started',  d));
jobQueue.on('job-progress',  d => io.emit('queue-job-progress', d));
jobQueue.on('job-done',      async d => {
  io.emit('queue-job-done', d);
  await webhookMgr.fire('job_completed', d);
});
jobQueue.on('job-error',     async d => {
  io.emit('queue-job-error', d);
  await webhookMgr.fire('job_error', d);
});
jobQueue.on('queue-finished', () => io.emit('queue-finished'));

// Forward CNC events
cnc.on('cnc-status',   s => console.log('CNC status', s.state));
cnc.on('cnc-response', d => console.log('CNC >', d.line));
cnc.on('cnc-sent',     d => console.log('CNC <', d.line));

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!process.env.SUPABASE_URL) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});
app.get('/auth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));
app.get('/app',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Public config (Supabase public keys only) ─────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL      || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY || '',
    devMode:    !process.env.SUPABASE_URL,
  });
});

// ── File upload setup ─────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'image/svg+xml', 'application/octet-stream', 'text/plain',
  'application/x-dxf', 'application/dxf',
]);
const ALLOWED_EXTENSIONS = new Set(['.svg', '.dxf', '.nc', '.gcode', '.tap']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`نوع الملف غير مسموح به: ${ext}`), false);
  }
  cb(null, true);
};

const upload      = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter });
const batchUpload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024, files: 50 }, fileFilter });

// ── API: App info ─────────────────────────────────────────────────────────────
app.get('/api/info', (req, res) => {
  res.json({
    version:    '2.0.0',
    aiEnabled:  !!process.env.ANTHROPIC_API_KEY,
    profiles:   MachineConfig.getProfiles(),
    features:   ['queue', 'cost', 'subscriptions', 'templates', 'analytics', 'backup', 'webhooks', 'monitor', 'batch', 'material-cost'],
  });
});

// ── API: Generate G-Code ──────────────────────────────────────────────────────
app.post('/api/generate', generateLimiter, async (req, res) => {
  try {
    const { shapes, config: rawConfig, useAI } = req.body;
    // Identity comes from the verified JWT only — body userId is ignored.
    // Anonymous users are rate-limited per IP under the free plan.
    const userId = req.user ? req.user.id : 'anon:' + req.ip;
    const validationErr = validator.validateShapes(shapes);
    if (validationErr && validationErr.length) return res.status(400).json({ error: validationErr });

    if (!subMgr.checkLimit(userId, 'jobsPerMonth')) {
      return res.status(429).json({ error: 'تجاوزت حد المهام الشهري. يرجى ترقية خطة الاشتراك.' });
    }
    if (!subMgr.checkLimit(userId, 'shapesPerJob', shapes.length)) {
      return res.status(400).json({ error: `عدد الأشكال يتجاوز حد الخطة (${shapes.length} شكل)` });
    }

    const config = new MachineConfig(rawConfig).toObject();
    let suggestions = [], estimatedSaving = '0%';

    // المرحلة الثقيلة #1 — تحسين المسارات (في خيط عامل، لا يُجمّد بقية الطلبات)
    let processedShapes = (await genPool.run({ op: 'optimize', shapes, config })).shapes;

    if (useAI && subMgr.hasFeature(userId, 'ai')) {
      const AIImpl = process.env.ANTHROPIC_API_KEY ? AIOptimizer : require('./src/ai/MockAIOptimizer');
      const ai     = process.env.ANTHROPIC_API_KEY ? new AIImpl(process.env.ANTHROPIC_API_KEY) : new AIImpl();
      try {
        const r2 = await ai.optimizePaths(processedShapes, config);
        if (r2 && r2.optimizedShapes && r2.optimizedShapes.length === processedShapes.length) {
          processedShapes = r2.optimizedShapes;
          suggestions     = r2.suggestions || [];
          estimatedSaving = r2.estimatedSaving || '0%';
          io.emit('ai-suggestions', { suggestions, estimatedSaving });
        } else {
          processedShapes = (await genPool.run({ op: 'optimize', shapes: processedShapes, config })).shapes;
          suggestions = ['AI أعاد نتيجة غير صالحة — تم استخدام المُحسِّن المحلي'];
        }
        subMgr.incrementUsage(userId, 'aiOptimizations');
        analytics.track('ai_called', { userId, shapes: shapes.length });
      } catch (e) {
        console.error('AI optimize error:', e?.message || e);
        processedShapes = (await genPool.run({ op: 'optimize', shapes: processedShapes, config })).shapes;
        suggestions = [`خطأ AI: ${e?.message || String(e)}`];
      }
    }

    // المرحلة الثقيلة #2 — معدّلات التغذية + النصائح + G-Code + التحليل (في خيط عامل)
    const fin = await genPool.run({ op: 'finalize', shapes: processedShapes, config, machineProfile: rawConfig.machineProfile });
    processedShapes = fin.shapes;
    if (fin.expertTips && fin.expertTips.length) suggestions = [...suggestions, ...fin.expertTips];

    subMgr.incrementUsage(userId, 'jobsPerMonth');
    analytics.track('job_generated', { userId, shapesCount: shapes.length, timeSavedMin: parseFloat(estimatedSaving) || 0 });
    await webhookMgr.fire('job_generated', { userId, shapes: shapes.length, stats: fin.stats });

    res.json({ success: true, gcode: fin.gcode, stats: fin.stats, suggestions, estimatedSaving, analysis: fin.analysis, processedShapes });

  } catch (err) {
    console.error(err);
    analytics.track('error', { type: 'generate', message: err.message });
    fail(res, err);
  }
});

// ── API: Import file ──────────────────────────────────────────────────────────
app.post('/api/import', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يُرفع ملف' });
    const filePath = req.file.path;
    const ext      = path.extname(req.file.originalname).toLowerCase();
    let shapes = [];

    if (ext === '.svg') {
      const content = fs.readFileSync(filePath, 'utf8');
      shapes = new SVGParser().parse(content);
    } else if (ext === '.dxf') {
      const content = fs.readFileSync(filePath, 'utf8');
      shapes = new DXFParser().parse(content);
    } else if (['.nc', '.gcode', '.tap'].includes(ext)) {
      const gcode = fs.readFileSync(filePath, 'utf8');
      try { fs.unlinkSync(filePath); } catch (_) {}
      analytics.track('file_imported', { ext, type: 'gcode' });
      return res.json({ success: true, type: 'gcode', gcode });
    }

    try { fs.unlinkSync(filePath); } catch (_) {}

    if (!shapes.length) return res.status(400).json({ error: 'لم يُعثر على أشكال قابلة للمعالجة في الملف' });

    analytics.track('file_imported', { ext, type: 'shapes', count: shapes.length });
    res.json({ success: true, type: 'shapes', shapes, count: shapes.length });

  } catch (err) {
    console.error(err);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch (_) {}
    analytics.track('error', { type: 'import', message: err.message });
    fail(res, err);
  }
});

// ── API: Export G-Code ────────────────────────────────────────────────────────
app.post('/api/export', (req, res) => {
  const { gcode, filename = 'design', ext = '.nc' } = req.body;
  if (!gcode) return res.status(400).json({ error: 'G-Code مطلوب' });
  const safe = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
  analytics.track('file_exported', { ext, lines: gcode.split('\n').length });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}${ext}"`);
  res.send(gcode);
});

// ── API: DXF Export ───────────────────────────────────────────────────────────
app.post('/api/export/dxf', (req, res) => {
  const { shapes, filename = 'design', units = 'mm' } = req.body || {};
  if (!shapes || !shapes.length) return res.status(400).json({ error: 'أشكال مطلوبة' });
  try {
    const dxf  = new DXFExporter({ units }).export(shapes);
    const safe = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    analytics.track('file_exported', { ext: '.dxf' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.dxf"`);
    res.send(dxf);
  } catch (err) { fail(res, err); }
});

// ── API: Validate G-Code ──────────────────────────────────────────────────────
app.post('/api/validate-gcode', (req, res) => {
  const { gcode, machineConfig = {} } = req.body || {};
  if (!gcode) return res.status(400).json({ error: 'gcode مطلوب' });
  try {
    const result = new GCodeValidator(machineConfig).validate(gcode);
    res.json(result);
  } catch (err) { fail(res, err); }
});

// ── API: Post-Processor ───────────────────────────────────────────────────────
app.post('/api/postprocess', (req, res) => {
  const { gcode, config, profile } = req.body || {};
  if (!gcode) return res.status(400).json({ error: 'gcode مطلوب' });
  try {
    const result = applyPostProcessor(gcode, config || {}, profile || 'generic');
    res.json({ success: true, gcode: result });
  } catch (err) { fail(res, err); }
});

// ── API: Projects (Supabase per-user with RLS, file fallback in dev mode) ────
const { CloudProjects, CloudTools } = require('./src/core/CloudStore');
const useCloud = (req) => !!(req.accessToken && req.user && !req.user.dev);

app.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const projects = useCloud(req) ? await CloudProjects.list(req.accessToken) : projectMgr.list();
    res.json({ projects });
  } catch (e) { fail(res, e); }
});

app.get('/api/project/:id', requireAuth, async (req, res) => {
  try {
    const project = useCloud(req) ? await CloudProjects.load(req.accessToken, req.params.id) : projectMgr.load(req.params.id);
    res.json({ project });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/project/:id', requireAuth, async (req, res) => {
  try {
    if (useCloud(req)) await CloudProjects.delete(req.accessToken, req.params.id);
    else projectMgr.delete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/project/save', requireAuth, async (req, res) => {
  const { name, data } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name مطلوب' });
  try {
    const result = useCloud(req)
      ? await CloudProjects.save(req.accessToken, req.user.id, name, data || {})
      : projectMgr.save(name, data || {});
    analytics.track('project_saved', { name });
    res.json({ success: true, ...result });
  } catch (e) { fail(res, e); }
});

// ── API: Tool Library (built-in defaults + per-user cloud tools) ─────────────
app.get('/api/tools', async (req, res) => {
  try {
    // Defaults are available to everyone; logged-in users also get their own tools
    let tools = toolLib.getDefaults ? toolLib.getDefaults() : toolLib.getAll();
    if (useCloud(req)) tools = [...tools, ...await CloudTools.list(req.accessToken)];
    else tools = toolLib.getAll();
    res.json({ tools });
  } catch (e) { fail(res, e); }
});

app.post('/api/tools', requireAuth, async (req, res) => {
  try {
    const tool = useCloud(req)
      ? await CloudTools.add(req.accessToken, req.user.id, req.body || {})
      : toolLib.add(req.body || {});
    res.json({ success: true, tool });
  } catch (e) { fail(res, e); }
});

app.put('/api/tools/:id', requireAuth, async (req, res) => {
  try {
    const tool = useCloud(req)
      ? await CloudTools.update(req.accessToken, req.params.id, req.body || {})
      : toolLib.update(req.params.id, req.body || {});
    res.json({ success: true, tool });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/tools/:id', requireAuth, async (req, res) => {
  try {
    if (useCloud(req)) await CloudTools.delete(req.accessToken, req.params.id);
    else toolLib.delete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.get('/api/tools/:id/speeds/:material',   (req, res) => { const s = toolLib.getSpeeds(req.params.id, req.params.material); if (!s) return res.status(404).json({ error: 'لا توجد بيانات' }); res.json({ speeds: s }); });

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 1: CNC Job Queue ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/queue/enqueue', requireAuthOrApiKey, (req, res) => {
  try {
    const job = jobQueue.enqueue(req.body || {});
    res.json({ success: true, job });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/queue/:id', requireAuthOrApiKey, (req, res) => {
  try {
    jobQueue.dequeue(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/queue/start', requireAuthOrApiKey, async (req, res) => {
  if (jobQueue.running) return res.status(409).json({ error: 'قائمة الانتظار تعمل بالفعل' });
  res.json({ success: true, message: 'بدأ تشغيل قائمة الانتظار' });
  jobQueue.start(cnc).catch(e => console.error('Queue error:', e.message));
});

app.post('/api/queue/stop',  requireAuthOrApiKey, (req, res) => { jobQueue.stop();  res.json({ success: true }); });
app.post('/api/queue/clear', requireAuthOrApiKey, (req, res) => { jobQueue.clear(); res.json({ success: true }); });
app.get('/api/queue/status', (req, res) => res.json(jobQueue.getStatus()));

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 2: Cost Estimator ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/cost/estimate', (req, res) => {
  try {
    const estimate = costEst.estimate(req.body || {});
    analytics.track('cost_estimated', { total: estimate.total, currency: estimate.currency });
    res.json({ success: true, estimate });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/cost/quote', (req, res) => {
  try {
    const { estimate, clientInfo } = req.body || {};
    if (!estimate) return res.status(400).json({ error: 'estimate مطلوب' });
    const quote = costEst.generateQuote(estimate, clientInfo || {});
    analytics.track('quote_generated', { total: estimate.total });
    res.json({ success: true, quote });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/cost/rates', requireApiKey, (req, res) => {
  try {
    costEst.updateRates(req.body || {});
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 3: Subscription Plans ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/plans',                     (req, res) => res.json({ plans: subMgr.listPlans() }));

// ── Payments (العراق: FIB + Visa/Mastercard) ──────────────────────────────────
const PaymentManager = require('./src/payments/PaymentManager');
const payMgr = new PaymentManager(subMgr, analytics);

const publicBaseUrl = (req) =>
  (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

// طرق الدفع المتاحة والخطط والأسعار
app.get('/api/payments/methods', (req, res) => res.json(payMgr.methods()));

// إنشاء عملية دفع — الهوية من التوكن الموثق حصراً
app.post('/api/payments/checkout', requireAuth, async (req, res) => {
  try {
    const { plan, method } = req.body || {};
    if (!plan || !method) return res.status(400).json({ error: 'plan و method مطلوبان' });
    const result = await payMgr.createCheckout({
      userId:  req.user.id,
      email:   req.user.email,
      plan, method,
      baseUrl: publicBaseUrl(req),
    });
    res.json({ success: true, ...result });
  } catch (e) {
    const code = e.code === 'NOT_CONFIGURED' ? 503 : 500;
    res.status(code).json({ error: e.message });
  }
});

// استعلام حالة الدفعة (polling من الواجهة) — يؤكد ويرقّي عند السداد
app.get('/api/payments/:id/status', requireAuth, async (req, res) => {
  try {
    const payment = payMgr.find(req.params.id);
    if (!payment) return res.status(404).json({ error: 'دفعة غير موجودة' });
    if (payment.userId !== req.user.id) return res.status(403).json({ error: 'غير مصرح' });
    const updated = await payMgr.reconcile(payment);
    res.json({ id: updated.id, status: updated.status, plan: updated.plan });
  } catch (e) { fail(res, e); }
});

// إشعار FIB (خادم↔خادم) — لا نثق بالمحتوى، نتحقق من المزوّد مباشرة
app.post('/api/payments/callback/fib', async (req, res) => {
  try {
    const payment = payMgr.find(req.query.pid) || payMgr.findByRef(req.body?.id);
    if (payment) await payMgr.reconcile(payment);
  } catch (e) { console.error('FIB callback error:', e.message); }
  res.json({ ok: true });
});

// إشعار/عودة PayTabs — التحقق دائماً عبر استعلام المزوّد
app.all('/api/payments/callback/card', async (req, res) => {
  try {
    const ref = req.body?.tran_ref || req.query?.tranRef;
    const payment = ref ? payMgr.findByRef(ref) : null;
    if (payment) await payMgr.reconcile(payment);
    // طلب متصفح؟ أعده للتطبيق
    if (req.method === 'GET' || req.headers.accept?.includes('text/html')) {
      return res.redirect('/app?payment=' + (payment ? payment.id : ''));
    }
  } catch (e) { console.error('Card callback error:', e.message); }
  res.json({ ok: true });
});
app.get('/api/subscription/:userId',      requireAuth, (req, res) => {
  // A user may only read their own usage; admin (API key) may read anyone's
  if (req.params.userId !== req.user.id && !isValidApiKey(req)) {
    return res.status(403).json({ error: 'لا يمكنك الاطلاع على اشتراك مستخدم آخر.' });
  }
  res.json(subMgr.getUsageSummary(req.params.userId));
});
app.post('/api/subscription/:userId',     requireApiKey, (req, res) => {
  try {
    const { plan, renewsAt } = req.body || {};
    const result = subMgr.setSubscription(req.params.userId, plan, renewsAt);
    analytics.track('subscription_changed', { userId: req.params.userId, plan });
    res.json({ success: true, subscription: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 4: Batch File Processor ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/batch/process', uploadLimiter, requireAuthOrApiKey, batchUpload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'لا توجد ملفات' });
    const rawConfig = req.body.config ? JSON.parse(req.body.config) : {};
    const config    = new MachineConfig(rawConfig).toObject();

    const result = await batchProc.processFiles(req.files, config, {
      SVGParser, DXFParser, GCodeGenerator, PathOptimizer, FeedrateOptimizer, applyPostProcessor,
    });

    analytics.track('batch_processed', { files: req.files.length, succeeded: result.succeeded });
    await webhookMgr.fire('batch_completed', result);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('Batch error:', e.message);
    fail(res, e);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 5: Machine Health Monitor ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/monitor/health',        (req, res) => res.json(monitor.getHealthReport()));
app.post('/api/monitor/reset',        requireApiKey, (req, res) => { monitor.resetStats(); res.json({ success: true }); });

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 6: Config Templates ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/templates',         (req, res) => {
  const list = templateMgr.list(req.query);
  const builtin = templateMgr.getBuiltinTemplates();
  res.json({ templates: [...builtin, ...list] });
});
app.post('/api/templates',        requireAuth, (req, res) => {
  try {
    const { name, config, metadata } = req.body || {};
    const tmpl = templateMgr.save(name, config, metadata || {});
    res.json({ success: true, template: tmpl });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/templates/:id',     (req, res) => {
  try { res.json({ template: templateMgr.load(req.params.id) }); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
app.delete('/api/templates/:id',  requireApiKey, (req, res) => {
  try { templateMgr.delete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 7: Usage Analytics ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/analytics/report', requireApiKey, (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json(analytics.getReport(days));
});

app.post('/api/analytics/payment', requireApiKey, (req, res) => {
  const { amount, currency = 'USD', userId, description } = req.body || {};
  if (!amount) return res.status(400).json({ error: 'amount مطلوب' });
  analytics.track('payment', { amount: +amount, currency, userId, description });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 8: Auto Backup ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/backup/list',          requireApiKey, (req, res) => res.json({ backups: backupMgr.listBackups() }));
app.post('/api/backup/now',          requireApiKey, (req, res) => {
  const result = backupMgr.backup();
  analytics.track('backup_created', { projectsBacked: result.projectsBacked });
  res.json({ success: true, ...result });
});
app.post('/api/backup/restore/:id',  requireApiKey, (req, res) => {
  try {
    const result = backupMgr.restore(req.params.id);
    analytics.track('backup_restored', result);
    res.json({ success: true, ...result });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 9: Webhook Notifications ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/webhooks',          requireApiKey, (req, res) => res.json({ webhooks: webhookMgr.list() }));
app.post('/api/webhooks',         requireApiKey, (req, res) => {
  try {
    const hook = webhookMgr.register(req.body || {});
    res.json({ success: true, webhook: hook });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/webhooks/:id',      requireApiKey, (req, res) => {
  try {
    const hook = webhookMgr.update(req.params.id, req.body || {});
    res.json({ success: true, webhook: hook });
  } catch (e) { res.status(404).json({ error: e.message }); }
});
app.delete('/api/webhooks/:id',   requireApiKey, (req, res) => {
  try { webhookMgr.delete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
app.post('/api/webhooks/:id/test', requireApiKey, async (req, res) => {
  try {
    const results = await webhookMgr.test(req.params.id);
    res.json({ success: true, results });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ██ FEATURE 10: Material Cost Calculator ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/materials',               (req, res) => res.json({ materials: matCalc.getMaterials() }));
app.post('/api/materials/cost',         (req, res) => {
  try {
    const result = matCalc.calculate(req.body || {});
    res.json({ success: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/materials/nesting',      (req, res) => {
  try {
    const { parts, stockSheet, material } = req.body || {};
    const result = matCalc.optimizeNesting(parts || [], stockSheet, material);
    res.json({ success: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ██ CNC Endpoints (Protected) ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/cnc/ports', requireAuthOrApiKey, async (req, res) => {
  try {
    const ports = await CNCConnector.listPorts();
    res.json({ ports });
  } catch (e) { fail(res, e); }
});

app.post('/api/cnc/connect', requireAuthOrApiKey, async (req, res) => {
  const { type = 'tcp', host, port, serialPort, baudRate } = req.body || {};
  try {
    if (type === 'serial') {
      if (!serialPort) return res.status(400).json({ error: 'serialPort مطلوب' });
      await cnc.connectSerial(serialPort, +baudRate || 115200);
    } else {
      if (!host || !port) return res.status(400).json({ error: 'host و port مطلوبان' });
      await cnc.connectTCP(host, +port);
    }
    analytics.track('cnc_connected', { type });
    res.json({ success: true, status: cnc.getStatus() });
  } catch (e) { fail(res, e); }
});

app.post('/api/cnc/disconnect', requireAuthOrApiKey, (req, res) => { cnc.disconnect(); res.json({ success: true }); });

app.post('/api/cnc/send', requireAuthOrApiKey, async (req, res) => {
  try {
    const { line } = req.body || {};
    if (!line) return res.status(400).json({ error: 'line required' });
    if (/[;&|`$]/.test(line)) return res.status(400).json({ error: 'محتوى غير مسموح به في الأمر' });
    await cnc.sendLine(line);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

app.post('/api/cnc/stream', requireAuthOrApiKey, async (req, res) => {
  try {
    const { gcode } = req.body || {};
    if (!gcode) return res.status(400).json({ error: 'gcode required' });
    const r = await cnc.streamGCode(gcode);
    analytics.track('cnc_stream_started', { lines: r.total });
    res.json({ success: true, started: r.started, total: r.total });
  } catch (e) { fail(res, e); }
});

app.get('/api/cnc/status',  (req, res) => res.json({ status: cnc.getStatus(), logs: cnc.tailLogs(200) }));
app.post('/api/cnc/estop',  requireAuthOrApiKey, (req, res) => { cnc.emergencyStop(); analytics.track('cnc_estop', {}); res.json({ success: true }); });
app.post('/api/cnc/stop',   requireAuthOrApiKey, (req, res) => { cnc.stopStream(); res.json({ success: true }); });

app.post('/api/cnc/jog', requireAuthOrApiKey, async (req, res) => {
  const { axis, distance, feedRate } = req.body || {};
  try {
    await cnc.jog(axis, +distance, +feedRate || 1000);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// ── WebSocket: streaming generation ──────────────────────────────────────────
io.on('connection', socket => {
  console.log('Client connected:', socket.id);

  // حماية: حد معدل لكل اتصال + حد حجم الحمولة
  let streamCalls = [];
  socket.on('generate-stream', async ({ shapes, config: rawConfig }) => {
    try {
      const now = Date.now();
      streamCalls = streamCalls.filter(t => now - t < 60000);
      if (streamCalls.length >= 10) {
        return socket.emit('stream-error', { error: 'تجاوزت حد الطلبات — انتظر دقيقة' });
      }
      streamCalls.push(now);
      if (!Array.isArray(shapes) || shapes.length > 5000) {
        return socket.emit('stream-error', { error: 'عدد الأشكال غير صالح (الحد 5000)' });
      }
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

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'حجم الملف يتجاوز الحد المسموح به (20 ميغابايت)' });
  }
  if (err.message && err.message.includes('نوع الملف غير مسموح')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled error:', err.message);
  analytics.track('error', { type: 'unhandled', message: err.message, path: req.path });
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

// ── Start scheduled services ──────────────────────────────────────────────────
backupMgr.startScheduled();

// ── Server launch ─────────────────────────────────────────────────────────────
if (process.env.VERCEL) {
  module.exports = app;
} else {
  const PORT = process.env.PORT || 3000;
  // حمّل الاشتراكات من Supabase قبل الاستماع كي يُعرَف المشتركون فوراً بعد كل نشر
  subMgr.hydrate()
    .catch(e => console.error('[subscriptions] hydrate failed — متابعة بذاكرة فارغة:', e.message))
    .finally(() => {
      server.listen(PORT, () => {
        console.log(`✓ Diqqat Qalam v2.0 running on port ${PORT}`);
        console.log(`  AI: ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'disabled (mock)'}`);
        console.log(`  Auth: ${process.env.API_SECRET_KEY ? 'enabled' : 'dev-mode (no key)'}`);
        console.log(`  Subscriptions: ${subMgr.cloud ? 'Supabase (دائم)' : 'file (dev)'}`);
        console.log(`  Backup: scheduled every 6 hours`);
      });
    });

  // ── متانة: لا تُسقِط الخادم بصمت ──
  process.on('unhandledRejection', (reason) => {
    console.error('UnhandledRejection:', reason);  // سجّل فقط — لا تُسقِط العملية لرفض وعد عابر
  });
  process.on('uncaughtException', (err) => {
    console.error('UncaughtException:', err);
    server.close(() => process.exit(1));           // أغلق برفق ثم دع Railway يعيد التشغيل
    setTimeout(() => process.exit(1), 10000).unref();
  });
  // إيقاف رشيق عند إعادة النشر (Railway يرسل SIGTERM)
  ['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => {
    console.log(`\n${sig} — إيقاف رشيق…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  }));

  module.exports = { app, server };
}
