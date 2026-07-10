/**
 * اختبار تكامل العمليات المنطقية عبر كود المتصفح الفعلي (canvas-editor + الأدوات).
 * يحمّل ملفات js الحقيقية في بيئة DOM مُجذَّمة (stub) ويشغّل booleanOp فعلياً،
 * ثم يولّد G-Code من الشكل المركّب الناتج. يشغَّل: node tests/boolean.integration.js
 */
const fs = require('fs');
const path = require('path');

/* ── بيئة DOM مُجذَّمة (no-op) كافية لبناء CanvasEditor وتشغيله ── */
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => (p in t ? t[p] : () => ({ width: 0 })),
  set: () => true,
});
function fakeEl() {
  return new Proxy({
    getContext: () => ctxProxy,
    addEventListener: noop, removeEventListener: noop,
    parentElement: { clientWidth: 800, clientHeight: 600, addEventListener: noop },
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    width: 800, height: 600, value: '', textContent: '',
    querySelectorAll: () => [], appendChild: noop, prepend: noop,
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'string' ? noop : undefined)) });
}

global.window = {
  addEventListener: noop, requestAnimationFrame: (f) => { f(); return 1; },
  app: { toast: (m, t) => { if (t === 'error') console.log('  toast[error]:', m); } },
  localStorage: { getItem: () => null, setItem: noop },
};
global.document = {
  getElementById: () => fakeEl(),
  querySelectorAll: () => [], querySelector: () => null,
  addEventListener: noop, createElement: () => fakeEl(),
};
global.localStorage = global.window.localStorage;
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.ResizeObserver = class { observe() {} disconnect() {} };
// PolyBoolean متاح للمتصفح عبر DQ
global.DQ = { PolyBoolean: require('../shared/PolyBoolean') };
global.window.DQ = global.DQ;

/* ── حمّل ملفات المتصفح الحقيقية في النطاق العام بالترتيب ── */
const load = (rel) => {
  let code = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  // class/const من eval غير المباشر لا تتسرّب للنطاق العام — صدّرها يدوياً
  if (rel.endsWith('canvas-editor.js')) code += '\n;globalThis.CanvasEditor = CanvasEditor;';
  (0, eval)(code);
};
['public/js/canvas-editor.js',
 'public/js/tools-extra.js',
 'public/js/tools-pro.js',
 'public/js/tools-arrange.js',
 'public/js/tools-cnc.js',
 'public/js/tools-boolean.js'].forEach(load);

/* ── شغّل ── */
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${n}`); };

const ed = new CanvasEditor('c');

function run(op, shapes) {
  ed.shapes = JSON.parse(JSON.stringify(shapes));
  ed.msel = new Set(shapes.map((_, i) => i));
  ed.selectedIdx = shapes.length - 1;
  ed.booleanOp(op);
  return ed.shapes;
}

const A = { type: 'rect', x: 0, y: 0, w: 10, h: 10 };
const B = { type: 'rect', x: 5, y: 5, w: 10, h: 10 };

let r = run('union', [A, B]);
ok('union → شكل واحد مركّب', r.length === 1 && r[0].type === 'compound');
ok('union → مسار واحد (بلا ثقب)', r[0].contours && r[0].contours.length === 1);

r = run('difference', [A, B]);
ok('difference → مركّب', r.length === 1 && r[0].type === 'compound');

// طرح يُنتج ثقباً: مربّع كبير ناقص مربّع داخلي
const Big = { type: 'rect', x: 0, y: 0, w: 20, h: 20 };
const Small = { type: 'rect', x: 6, y: 6, w: 8, h: 8 };
r = run('difference', [Big, Small]);
ok('difference (داخلي) → مسارَان (ثقب)', r.length === 1 && r[0].contours.length === 2);

r = run('intersect', [A, B]);
ok('intersect → مركّب', r.length === 1 && r[0].type === 'compound');

// رفض المدخلات المفتوحة
r = run('union', [{ type: 'line', x1: 0, y1: 0, x2: 5, y2: 5 }, A]);
ok('union يرفض الخط المفتوح (يبقى شكلان)', r.length === 2);

// تكامل G-Code من المركّب الناتج
const GCodeGenerator = require('../shared/GCodeGenerator');
r = run('difference', [Big, Small]);
const out = new GCodeGenerator({ totalDepth: 2, passDepth: 2, addComments: true }).generate(r);
const loops = out.gcode.split('\n').filter(l => l.includes('حلقة')).length;
ok('G-Code يقطع المركّب كحلقتين', loops === 2);
ok('G-Code غير فارغ ويحوي حركة قطع', /G0[01]/.test(out.gcode));

// التراجع (undo) يعيد الأشكال الأصلية
ed.shapes = [JSON.parse(JSON.stringify(A)), JSON.parse(JSON.stringify(B))];
ed.msel = new Set([0, 1]); ed.selectedIdx = 1;
ed.booleanOp('union');
const after = ed.shapes.length;
ed.undo();
ok('undo يعيد الشكلين الأصليين', after === 1 && ed.shapes.length === 2);

console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
