'use strict';
/**
 * gcode-correctness.test.js — اختبارات مطابقة G-Code لآلات CNC الحقيقية
 *
 * محاكي تحقق يمر على كل سطر ويفرض قواعد السلامة الصناعية:
 * أعماق، ارتفاعات آمنة، حالة المغزل، هندسة الأقواس (GRBL err33)،
 * صحة الهبوط المائل، وتوافق المعالجات اللاحقة (GRBL/Fanuc).
 */

const GCodeGenerator = require('../src/generators/GCodeGenerator');
const { applyPostProcessor } = require('../src/generators/PostProcessors');

const CFG = {
  toolDiameter: 3, toolNumber: 2, totalDepth: 3, passDepth: 1,
  safeHeight: 5, feedRateXY: 1000, feedRateZ: 300,
  spindleSpeed: 12000, spindleDir: 'cw', coordSystem: 'G55',
  addComments: true, arcDetect: true,
};

/* ── محاكي تنفيذ مصغر: يتتبع الموضع والحالة سطراً سطراً ── */
function simulate(gcode) {
  const state = {
    x: 0, y: 0, z: CFG.safeHeight,
    spindle: false, feed: 0, modalG: null,
    minZ: 0, cutDepths: new Set(),
    violations: [],
    arcs: [], moves: 0,
    spindleOnBeforeFirstCut: null,
    endedWithM30: false,
  };

  const lines = gcode.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\(.*?\)/g, '').split(';')[0].trim().toUpperCase();
    if (!line) continue;

    const tok = {};
    line.replace(/([A-Z])(-?\d*\.?\d+)/g, (_, k, v) => { tok[k] = parseFloat(v); return ''; });

    if (tok.M === 3 || tok.M === 4) state.spindle = true;
    if (tok.M === 5) state.spindle = false;
    if (tok.M === 30 || tok.M === 2) state.endedWithM30 = true;
    if (tok.F !== undefined) state.feed = tok.F;

    if ([0, 1, 2, 3].includes(tok.G)) state.modalG = tok.G;
    const g = tok.G !== undefined && [0, 1, 2, 3].includes(tok.G) ? tok.G : state.modalG;
    const hasMotion = tok.X !== undefined || tok.Y !== undefined || tok.Z !== undefined;
    if (!hasMotion) continue;

    const nx = tok.X !== undefined ? tok.X : state.x;
    const ny = tok.Y !== undefined ? tok.Y : state.y;
    const nz = tok.Z !== undefined ? tok.Z : state.z;

    const isCutMove = (g === 1 || g === 2 || g === 3) && (nz < -1e-6 || state.z < -1e-6);

    // قاعدة: قطع بلا مغزل = كارثة
    if (isCutMove && state.spindleOnBeforeFirstCut === null) {
      state.spindleOnBeforeFirstCut = state.spindle;
    }
    // قاعدة: حركة قطع بلا تغذية
    if ((g === 1 || g === 2 || g === 3) && state.feed <= 0) {
      state.violations.push(`سطر ${i + 1}: حركة G${g} بلا F مسبق`);
    }
    // قاعدة: انتقال سريع XY تحت سطح الخامة = تكسير الأداة
    const xyMoved = Math.abs(nx - state.x) > 1e-6 || Math.abs(ny - state.y) > 1e-6;
    if (g === 0 && xyMoved && (state.z < -1e-6 || nz < -1e-6)) {
      state.violations.push(`سطر ${i + 1}: G00 أفقي والأداة داخل الخامة (Z=${state.z.toFixed(3)})`);
    }
    // هندسة القوس: نصف قطر البداية = نصف قطر النهاية (GRBL error 33)
    if ((g === 2 || g === 3) && (tok.I !== undefined || tok.J !== undefined)) {
      const cx = state.x + (tok.I || 0), cy = state.y + (tok.J || 0);
      const r0 = Math.hypot(state.x - cx, state.y - cy);
      const r1 = Math.hypot(nx - cx, ny - cy);
      state.arcs.push({ line: i + 1, r0, r1, dr: Math.abs(r0 - r1) });
    }

    if (nz < state.minZ) state.minZ = nz;
    if (isCutMove && nz < -1e-6) state.cutDepths.add(nz.toFixed(3));
    state.x = nx; state.y = ny; state.z = nz;
    state.moves++;
  }
  return state;
}

const SHAPES = {
  line:     { type: 'line', x1: 0, y1: 0, x2: 50, y2: 30 },
  rect:     { type: 'rect', x: 10, y: 10, w: 60, h: 40 },
  circle:   { type: 'circle', cx: 40, cy: 40, r: 20 },
  arc:      { type: 'arc', cx: 30, cy: 30, r: 15, startAngle: 0.3, endAngle: 2.4, clockwise: false },
  ellipse:  { type: 'ellipse', cx: 50, cy: 50, rx: 25, ry: 15 },
  polygon:  { type: 'polygon', points: [{x:0,y:0},{x:30,y:0},{x:15,y:25}] },
  slot:     { type: 'slot', cx1: 10, cy1: 10, cx2: 60, cy2: 10, r: 5 },
  polyline: { type: 'polyline', points: [{x:0,y:0},{x:20,y:5},{x:35,y:25},{x:50,y:20}], closed: false },
  text:     { type: 'text', x: 5, y: 5, height: 10, width: 30, text: 'DQ',
              strokes: [[{x:0,y:0},{x:0,y:10},{x:5,y:10},{x:7,y:5},{x:5,y:0},{x:0,y:0}],
                        [{x:10,y:0},{x:10,y:10},{x:15,y:10}]] },
};

describe('مطابقة G-Code لآلات CNC', () => {

  test('قواعد السلامة تتحقق لكل نوع شكل على حدة', () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      const { gcode } = new GCodeGenerator(CFG).generate([shape]);
      const sim = simulate(gcode);

      expect({ shape: name, v: sim.violations }).toEqual({ shape: name, v: [] });
      expect(sim.spindleOnBeforeFirstCut).toBe(true);          // المغزل قبل أول قطع
      expect(sim.minZ).toBeGreaterThanOrEqual(-CFG.totalDepth - 1e-6); // لا تجاوز للعمق
      expect(Math.abs(sim.minZ + CFG.totalDepth)).toBeLessThan(1e-6); // العمق الكلي يتحقق بدقة
      expect(sim.cutDepths.size).toBe(3);                       // 3 طبقات (3mm / 1mm)
      expect(sim.endedWithM30).toBe(true);
    }
  });

  test('هندسة الأقواس متسقة — لا GRBL error 33', () => {
    const { gcode } = new GCodeGenerator(CFG).generate([SHAPES.circle, SHAPES.arc]);
    const sim = simulate(gcode);
    expect(sim.arcs.length).toBeGreaterThan(0);
    for (const a of sim.arcs) {
      expect(a.dr).toBeLessThan(0.005);   // فرق نصفي القطر < 5 ميكرون
    }
  });

  test('الإحداثيات بثلاث منازل عشرية كحد أقصى', () => {
    const { gcode } = new GCodeGenerator(CFG).generate([SHAPES.polyline]);
    const bad = gcode.split('\n').filter(l => /[XYZIJ]-?\d+\.\d{4,}/.test(l.split(';')[0]));
    expect(bad).toEqual([]);
  });

  test('الهبوط المائل يبقى داخل أول مقطع قطع وينتهي عند نقطة البداية', () => {
    const cfg = { ...CFG, plungeStrategy: 'ramp', rampAngle: 5, totalDepth: 2, passDepth: 2 };
    const shape = { type: 'line', x1: 10, y1: 10, x2: 40, y2: 10 };
    const { gcode } = new GCodeGenerator(cfg).generate([shape]);

    // كل حركات الميل يجب أن تكون على الخط y=10 وبين x=10 و x=40
    const rampLines = gcode.split('\n').filter(l => /G01 X.*Z-/.test(l) && !l.includes('إغلاق'));
    expect(rampLines.length).toBeGreaterThan(1);
    for (const l of rampLines) {
      const x = parseFloat(/X(-?[\d.]+)/.exec(l)[1]);
      const y = parseFloat(/Y(-?[\d.]+)/.exec(l)[1]);
      expect(y).toBeCloseTo(10, 3);
      expect(x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(x).toBeLessThanOrEqual(40 + 1e-6);
    }
    // آخر سطر ملتقط هو حركة القطع للنهاية؛ ما قبله = نهاية الميل
    // ويجب أن يعود لنقطة البداية بالعمق الكامل
    const rampEnd = rampLines[rampLines.length - 2];
    expect(parseFloat(/X(-?[\d.]+)/.exec(rampEnd)[1])).toBeCloseTo(10, 3);
    expect(parseFloat(/Z(-?[\d.]+)/.exec(rampEnd)[1])).toBeCloseTo(-2, 3);
    // ولا تجاوز للعمق في أي نقطة
    expect(simulate(gcode).minZ).toBeGreaterThanOrEqual(-2 - 1e-6);
  });

  test('الهبوط الحلزوني للدائرة يصل العمق بدقة قبل القطع', () => {
    const cfg = { ...CFG, plungeStrategy: 'helical', totalDepth: 2, passDepth: 2 };
    const { gcode } = new GCodeGenerator(cfg).generate([SHAPES.circle]);
    const sim = simulate(gcode);
    expect(sim.violations).toEqual([]);
    expect(sim.minZ).toBeCloseTo(-2, 4);
    // الحلزون = أقواس بعمق متدرج
    expect(gcode).toMatch(/G02 .*Z-0\./);
  });

  test('تعويض الأداة: D برقم السجل وليس نصف القطر، وG40 قبل العودة', () => {
    const cfg = { ...CFG, compensation: 'left' };
    const { gcode } = new GCodeGenerator(cfg).generate([SHAPES.rect]);
    expect(gcode).toMatch(/G41 D2\b/);              // رقم الأداة = 2
    expect(gcode).not.toMatch(/G41 D1\.5/);          // ليس نصف القطر!
    const lines = gcode.split('\n');
    const g40 = lines.findIndex(l => l.includes('G40'));
    const home = lines.findIndex(l => l.includes('X0.000 Y0.000'));
    expect(g40).toBeGreaterThan(-1);
    expect(g40).toBeLessThan(home);                  // الإلغاء قبل العودة
  });

  test('معالج GRBL يزيل كل ما يرفضه المتحكم', () => {
    const cfg = { ...CFG, compensation: 'left' };
    const { gcode } = new GCodeGenerator(cfg).generate([SHAPES.rect]);
    const out = applyPostProcessor(gcode, cfg, 'grbl');
    const code = out.split('\n').map(l => l.split(';')[0]).join('\n');
    expect(code).not.toMatch(/\bM0?6\b/);            // لا تغيير أداة
    expect(code).not.toMatch(/\bT\d+\b/);            // لا كلمة T
    expect(code).not.toMatch(/\bG4[123]\b/);         // لا تعويض قطر/طول
    expect(code).toMatch(/\bG04 P2\b/);              // التوقف بالثواني يبقى
    expect(code).toMatch(/\bG55\b/);                 // نظام الإحداثيات مدعوم ويبقى
  });

  test('معالج Fanuc: توقف بصيغة X بالثواني وترقيم وشريط %', () => {
    const { gcode } = new GCodeGenerator(CFG).generate([SHAPES.line]);
    const out = applyPostProcessor(gcode, CFG, 'fanuc');
    const lines = out.split('\n');
    expect(lines[0]).toBe('%');
    expect(lines[1]).toMatch(/^O\d{4}/);
    expect(out).toMatch(/G04 X2\.0/);                // وليس P2 (ملي ثانية!)
    expect(out).not.toMatch(/G0?4\s+P\d/);
    expect(lines[lines.length - 1]).toBe('%');
    // كل أسطر الأوامر مرقمة
    const unnumbered = lines.filter(l => l && !l.startsWith('%') && !l.startsWith('O') &&
      !l.startsWith('(') && !/^N\d+/.test(l));
    expect(unnumbered).toEqual([]);
  });

  test('تسلسل كامل متعدد الأشكال يجتاز كل القواعد', () => {
    const all = Object.values(SHAPES);
    const { gcode, stats } = new GCodeGenerator(CFG).generate(all);
    const sim = simulate(gcode);
    expect(sim.violations).toEqual([]);
    expect(sim.spindleOnBeforeFirstCut).toBe(true);
    expect(stats.lines).toBe(gcode.split('\n').length);
    expect(stats.passes).toBe(3);
  });
});
