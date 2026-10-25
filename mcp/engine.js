/**
 * engine.js — قلب جسر دقة قلم: نصٌّ عربيّ → حروف → G-Code + SVG.
 *
 *   يكرّر مسار صفحة الخطّ في المتصفّح (public/js/calligraphy.js) حرفياً، لكن في
 *   Node: نفس WASM (HarfBuzz) ونفس opentype ونفس محرّك الهندسة المشترك في
 *   shared/ — فالناتج مطابقٌ لما يُنتجه التطبيق تماماً، بلا متصفّح وبلا أي
 *   تبعيةٍ جديدة (كلّ ما يلزم مُضمَّنٌ في المستودع أصلاً).
 *
 *   نقيّ تماماً: لا علاقة له ببروتوكول MCP — يُستورَد ويُختبَر وحده.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const VENDOR  = path.join(ROOT, 'public', 'vendor');
const FONTDIR = path.join(ROOT, 'public', 'fonts');

// ── تحميل مكتبات المتصفّح المُضمَّنة في بيئة Node ───────────────────────────

// hbjs.js يعرّف دالّة hbjs(instance) بلا تصدير — نلفّها ونُخرجها
function loadHbjs() {
  const src = fs.readFileSync(path.join(VENDOR, 'hbjs.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  return new Function(src + '\n;return hbjs;')();
}

// opentype.min.js وحدة UMD — require يعيد الكائن مباشرةً
function loadOpentype() {
  const ot = require(path.join(VENDOR, 'opentype.min.js'));
  return ot && ot.parse ? ot : (global.opentype || ot);
}

// الوحدات المشتركة — نفس مصدر الخادم والمتصفّح
const CE             = require(path.join(ROOT, 'shared', 'CalligraphyEngine'));
const GCodeGenerator = require(path.join(ROOT, 'shared', 'GCodeGenerator'));
let PathSort = null;
try { PathSort = require(path.join(ROOT, 'shared', 'PathSort')); } catch (_) { /* اختياريّ */ }

// ── تهيئة المحرّك مرّةً واحدة (WASM + الخطوط) ───────────────────────────────

let _ready = null;
const _fontCache = new Map();

async function init() {
  if (_ready) return _ready;
  _ready = (async () => {
    const hbjs = loadHbjs();
    const opentype = loadOpentype();
    const wasmBuf = fs.readFileSync(path.join(VENDOR, 'hb.wasm'));
    const { instance } = await WebAssembly.instantiate(wasmBuf, {});
    const hb = hbjs(instance);
    return { hb, opentype };
  })();
  return _ready;
}

/** يحمّل خطاً (opentype + وجه HarfBuzz) ويُخزّنه */
async function loadFont(id) {
  const meta = CE.getFont(id);                 // يرتدّ إلى الأوّل إن لم يوجد
  if (_fontCache.has(meta.id)) return _fontCache.get(meta.id);
  const { hb, opentype } = await init();
  const ab = fs.readFileSync(path.join(FONTDIR, meta.file));
  const u8 = new Uint8Array(ab);
  const ot = opentype.parse(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  const blob = hb.createBlob(u8);
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const f = { meta, hb, ot, font };
  _fontCache.set(meta.id, f);
  return f;
}

// ── تشكيل سطر → run + glyphPaths (منقول من calligraphy.js) ──────────────────

function shapeLine(text, f) {
  const hb = f.hb;
  const buf = hb.createBuffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  hb.shape(f.font, buf);
  const out = buf.json();
  buf.destroy();
  const run = out.map(r => ({ glyphId: r.g, ax: r.ax, ay: r.ay, dx: r.dx, dy: r.dy }));
  const glyphPaths = {};
  for (const r of run) {
    if (!(r.glyphId in glyphPaths)) {
      try { glyphPaths[r.glyphId] = f.ot.glyphs.get(r.glyphId).path.commands; }
      catch (_) { glyphPaths[r.glyphId] = []; }
    }
  }
  return { run, glyphPaths };
}

// ── تخطيط متعدّد الأسطر (محاذاة يمين RTL، مقياس موحّد) ──────────────────────

function composeText(text, f, heightMM, spacing) {
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return null;

  const upm = f.ot.unitsPerEm;
  const laid = lines.map(line => {
    const { run, glyphPaths } = shapeLine(line, f);
    return CE.layout({ run, glyphPaths, unitsPerEm: upm, heightMM });
  });

  const scale0 = laid[0].scale || 1;
  laid.forEach(res => {
    const fac = res.scale ? scale0 / res.scale : 1;
    if (Math.abs(fac - 1) > 1e-9) {
      const sc = c => c.map(p => ({ x: p.x * fac, y: p.y * fac }));
      res.contours = res.contours.map(sc);
      res.groups   = (res.groups || []).map(g => g.map(sc));
      res.width  *= fac;
      res.height *= fac;
    }
  });

  const maxW = Math.max(...laid.map(r => r.width));
  const step = heightMM * spacing;
  const contours = [];
  const groups = [];                                 // تجميع الحروف للعرض السليم
  laid.forEach((res, i) => {
    const xo = maxW - res.width;                     // محاذاة لليمين
    const yo = (laid.length - 1 - i) * step;          // السطر الأوّل للأعلى
    const mv = c => c.map(p => ({ x: p.x + xo, y: p.y + yo }));
    for (const c of res.contours) contours.push(mv(c));
    for (const g of (res.groups || [])) groups.push(g.map(mv));
  });

  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x;
    if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y;
  }
  const nm = c => c.map(p => ({ x: p.x - mnx, y: p.y - mny }));
  const out = contours.map(nm);
  const outGroups = groups.map(g => g.map(nm));
  return { contours: out, groups: outGroups, width: mxx - mnx, height: mxy - mny, lines: lines.length };
}

// ── تصدير SVG نظيف بوحدة mm (منقول من calligraphy.js) ──────────────────────

function svgExport(comp) {
  const W = comp.width, H = comp.height;
  const pathOf = (rings) => {
    let d = '';
    for (const c of rings) {
      if (c.length < 2) continue;
      d += 'M' + c.map(p => `${p.x.toFixed(3)},${(H - p.y).toFixed(3)}`).join('L') + 'Z';
    }
    return d;
  };
  // مسارٌ لكلّ حرفٍ بقاعدة even-odd: تراكبات الوصلات تظهر ملأى، والثقوب محفوظة.
  // الارتداد إلى مسارٍ واحد لو غابت المجموعات (توافقٌ خلفيّ).
  const groups = (comp.groups && comp.groups.length) ? comp.groups : [comp.contours];
  const paths = groups
    .map(g => pathOf(g))
    .filter(Boolean)
    .map(d => `  <path d="${d}" fill="black" fill-rule="evenodd"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}mm" height="${H.toFixed(2)}mm" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">\n` +
    `${paths}\n</svg>\n`;
}

// ── اسم ملفٍّ آمن من النصّ العربيّ ──────────────────────────────────────────

function slug(text) {
  const first = String(text).split(/\r?\n/)[0].trim().slice(0, 40);
  const s = first.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
  return s || 'letters';
}

// ══════════════════ الواجهة العامّة ══════════════════

/**
 * يصنع ملفّات حروفٍ من نصّ.
 * @param {object} o
 *   text        النصّ (أسطرٌ متعدّدة مسموحة) — إجباريّ
 *   font        amiri | cairo | reem | ruqaa (افتراضي amiri)
 *   heightMM    ارتفاع الحرف بالمليمتر (افتراضي 100)
 *   lineSpacing تباعد الأسطر كنسبةٍ من الارتفاع (افتراضي 1.5)
 *   material    سماكة الخامة بالمليمتر — عمق القطع الكلّيّ (افتراضي 3)
 *   passDepth   عمق كل تمريرة (افتراضي 1.5)
 *   toolDiameter قطر الأداة (افتراضي 3)
 *   feedXY, feedZ, rpm, safeZ, origin — إعدادات الآلة
 *   formats     ['gcode','svg'] (افتراضي كلاهما)
 *   outDir      مجلّد الإخراج (افتراضي exports/ داخل المشروع)
 */
async function generate(o) {
  if (!o || !o.text || !String(o.text).trim()) {
    throw new Error('النصّ مطلوب');
  }
  // خطٌّ مجهول يُخطئ صراحةً (لا ارتدادٌ صامت كما في getFont) — كي يعرف كلاود
  if (o.font) {
    const ids = CE.listFonts().map(f => f.id);
    if (!ids.includes(o.font)) {
      throw new Error(`خطّ غير معروف: ${o.font}. استعمل list_fonts لرؤية المتاح.`);
    }
  }
  const opt = Object.assign({
    font: 'amiri', heightMM: 100, lineSpacing: 1.5,
    material: 3, passDepth: 1.5, toolDiameter: 3,
    feedXY: 1000, feedZ: 300, rpm: 0, safeZ: 5, origin: 'bottom-left',
    formats: ['gcode', 'svg'],
  }, o);

  const f = await loadFont(opt.font);
  const comp = composeText(opt.text, f, +opt.heightMM || 100, +opt.lineSpacing || 1.5);
  if (!comp || !comp.contours.length) {
    throw new Error('تعذّر تشكيل النصّ — جرّب نصاً آخر أو خطاً مختلفاً');
  }

  let shapes = CE.contoursToShapes(comp.contours, {});
  if (PathSort && PathSort.optimize) {
    try { shapes = PathSort.optimize(shapes).shapes; } catch (_) { /* ترتيبٌ اختياريّ */ }
  }

  const cfg = {
    toolDiameter: +opt.toolDiameter || 3,
    totalDepth:   +opt.material || 3,
    passDepth:    +opt.passDepth || 1.5,
    feedRateXY:   +opt.feedXY || 1000,
    feedRateZ:    +opt.feedZ || 300,
    spindleSpeed: +opt.rpm || 0,
    safeHeight:   +opt.safeZ || 5,
    origin:       opt.origin || 'bottom-left',
    toolType:     'flat',
  };

  const outDir = opt.outDir || path.join(ROOT, 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const base = `${slug(opt.text)}_${opt.font}_${Math.round(+opt.heightMM || 100)}mm_${Date.now().toString(36)}`;

  const formats = Array.isArray(opt.formats) ? opt.formats : ['gcode', 'svg'];
  const files = {};
  const result = { font: f.meta, dimensionsMM: { w: comp.width, h: comp.height }, contours: comp.contours.length, lines: comp.lines };

  if (formats.includes('gcode')) {
    const g = new GCodeGenerator(cfg).generate(shapes);
    const p = path.join(outDir, base + '.gcode');
    fs.writeFileSync(p, g.gcode, 'utf8');
    files.gcode = p;
    result.gcodeStats = g.stats;
  }
  if (formats.includes('svg')) {
    const p = path.join(outDir, base + '.svg');
    fs.writeFileSync(p, svgExport(comp), 'utf8');
    files.svg = p;
  }

  result.files = files;
  result.config = cfg;
  return result;
}

function listFonts() { return CE.listFonts(); }

module.exports = { init, generate, listFonts };
