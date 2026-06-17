/**
 * CalligraphyEngine.js — محرك الخط العربي
 * يحوّل تتابع المحارف المُشكَّلة (HarfBuzz) + مخططات الحروف (opentype)
 * إلى كنتورات مغلقة بوحدة mm جاهزة لتوليد G-Code.
 *
 * نقي تماماً: لا DOM، لا شبكة. الإدخال:
 *   run        : مصفوفة { glyphId, ax, ay, dx, dy }  (مخرجات HarfBuzz، وحدات الخط، y لأعلى)
 *   glyphPaths : خريطة glyphId -> { commands:[...] } (مخطط الحرف الخام، وحدات الخط، y لأعلى — opentype glyph.path)
 *
 * المخرجات: كنتورات بوحدة mm، الأصل أسفل-يسار (0,0)، y لأعلى — اصطلاح CNC.
 *
 * وحدة مشتركة (UMD): الخادم require، المتصفح DQ.CalligraphyEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.CalligraphyEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ── أنماط الخطوط المضمَّنة (OFL) ─────────────────────────────────
const FONTS = [
  { id: 'amiri',   name: 'نسخ — Amiri',          file: 'Amiri-Regular.ttf',     style: 'نسخ',   note: 'كلاسيكي احترافي للنصوص' },
  { id: 'cairo',   name: 'حديث — Cairo',         file: 'Cairo-Regular.ttf',     style: 'حديث',  note: 'هندسي نظيف للأسماء واللوحات' },
  { id: 'reem',    name: 'كوفي — Reem Kufi',     file: 'ReemKufi-Regular.ttf',  style: 'كوفي',  note: 'هندسي للشعارات واللافتات' },
  { id: 'ruqaa',   name: 'رقعة — Aref Ruqaa',    file: 'ArefRuqaa-Regular.ttf', style: 'رقعة',  note: 'زخرفي تقليدي أنيق' },
];

function listFonts() { return FONTS.map(f => ({ ...f })); }
function getFont(id) { return FONTS.find(f => f.id === id) || FONTS[0]; }

// ── تسطيح منحنيات بيزييه ──────────────────────────────────────────
// اختبار الاستواء الكلاسيكي (AGG): أقصى انحراف لنقاط التحكم عن الوتر.
function _cubicFlat(p0, p1, p2, p3, tol) {
  const ux = 3 * p1.x - 2 * p0.x - p3.x;
  const uy = 3 * p1.y - 2 * p0.y - p3.y;
  const vx = 3 * p2.x - p0.x - 2 * p3.x;
  const vy = 3 * p2.y - p0.y - 2 * p3.y;
  return (Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy)) <= 16 * tol * tol;
}

function _flattenCubic(p0, p1, p2, p3, tol, out, depth) {
  if (depth >= 24 || _cubicFlat(p0, p1, p2, p3, tol)) { out.push({ x: p3.x, y: p3.y }); return; }
  // تقسيم de Casteljau عند 0.5
  const p01  = _mid(p0, p1),  p12 = _mid(p1, p2),  p23 = _mid(p2, p3);
  const p012 = _mid(p01, p12), p123 = _mid(p12, p23);
  const m    = _mid(p012, p123);
  _flattenCubic(p0, p01, p012, m, tol, out, depth + 1);
  _flattenCubic(m, p123, p23, p3, tol, out, depth + 1);
}
function _mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

// رفع منحنى تربيعي إلى تكعيبي ثم تسطيحه
function _flattenQuad(p0, c, p3, tol, out) {
  const c1 = { x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) };
  const c2 = { x: p3.x + (2 / 3) * (c.x - p3.x), y: p3.y + (2 / 3) * (c.y - p3.y) };
  _flattenCubic(p0, c1, c2, p3, tol, out, 0);
}

/**
 * تسطيح أوامر مسار opentype إلى كنتورات.
 * @returns {Array<Array<{x,y}>>} كل كنتور مصفوفة نقاط (مغلق ضمنياً)
 */
function flatten(commands, tol) {
  const contours = [];
  let cur = null, start = null, pen = null;
  const t = Math.max(0.01, tol || 1);
  for (const cmd of (commands || [])) {
    switch (cmd.type) {
      case 'M':
        if (cur && cur.length > 1) contours.push(cur);
        cur = [{ x: cmd.x, y: cmd.y }];
        start = { x: cmd.x, y: cmd.y };
        pen = start;
        break;
      case 'L':
        cur.push({ x: cmd.x, y: cmd.y });
        pen = { x: cmd.x, y: cmd.y };
        break;
      case 'Q': {
        const end = { x: cmd.x, y: cmd.y };
        _flattenQuad(pen, { x: cmd.x1, y: cmd.y1 }, end, t, cur);
        pen = end;
        break;
      }
      case 'C': {
        const end = { x: cmd.x, y: cmd.y };
        _flattenCubic(pen, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, end, t, cur, 0);
        pen = end;
        break;
      }
      case 'Z':
        if (cur && start) { cur.push({ x: start.x, y: start.y }); }
        if (cur && cur.length > 1) contours.push(cur);
        cur = null;
        break;
      default: break;
    }
  }
  if (cur && cur.length > 1) contours.push(cur);
  return contours;
}

// مساحة موقّعة لكنتور (>0 = عكس عقارب الساعة في نظام y-لأعلى)
function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * تخطيط تتابع الحروف المُشكَّل إلى كنتورات mm.
 * @param {Object} o
 * @param {Array}  o.run         مخرجات HarfBuzz: [{glyphId, ax, ay, dx, dy}]
 * @param {Object} o.glyphPaths  glyphId -> {commands}
 * @param {Number} o.unitsPerEm
 * @param {Number} o.heightMM    ارتفاع النص الناتج (حسب المحيط الفعلي)
 * @param {Number} [o.letterSpacing] تباعد إضافي بين الحروف (جزء من em)
 * @param {Number} [o.curveTol]  تساهل التسطيح (جزء من em، افتراضي 0.0025)
 * @returns {{contours, width, height, scale, glyphCount, contourCount, pointCount}}
 */
function layout(o) {
  const run        = o.run || [];
  const glyphPaths = o.glyphPaths || {};
  const upm        = o.unitsPerEm || 1000;
  const heightMM   = Math.max(0.1, o.heightMM || 20);
  const spacingU   = (o.letterSpacing || 0) * upm;
  const tolU       = (o.curveTol != null ? o.curveTol : 0.0025) * upm;

  // 1) تجميع الكنتورات في وحدات الخط (y لأعلى)
  let penX = 0;
  const raw = [];
  for (const g of run) {
    const cmds = glyphPaths[g.glyphId];
    if (cmds && cmds.length) {
      const cs = flatten(cmds, tolU);
      const ox = penX + (g.dx || 0);
      const oy = (g.dy || 0);
      for (const c of cs) raw.push(c.map(p => ({ x: p.x + ox, y: p.y + oy })));
    }
    penX += (g.ax || 0) + spacingU;
  }

  // 2) المحيط
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of raw) for (const p of c) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) {
    return { contours: [], width: 0, height: 0, scale: 0, glyphCount: run.length, contourCount: 0, pointCount: 0 };
  }
  const hU = Math.max(1e-6, maxY - minY);
  const k  = heightMM / hU;

  // 3) القياس + النقل للأصل أسفل-يسار
  let pts = 0;
  const contours = raw.map(c => {
    pts += c.length;
    return c.map(p => ({ x: (p.x - minX) * k, y: (p.y - minY) * k }));
  });

  return {
    contours,
    width:  (maxX - minX) * k,
    height: (maxY - minY) * k,
    scale:  k,
    glyphCount:   run.length,
    contourCount: contours.length,
    pointCount:   pts,
  };
}

/** تحويل الكنتورات إلى أشكال مضلّع جاهزة لـ GCodeGenerator */
function contoursToShapes(contours, extra) {
  extra = extra || {};
  const shapes = [];
  for (const c of contours) {
    if (!c || c.length < 3) continue;
    // إزالة نقطة الإغلاق المكرّرة إن وُجدت (المضلّع مغلق ضمنياً)
    let points = c;
    const a = c[0], b = c[c.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) points = c.slice(0, -1);
    if (points.length < 3) continue;
    shapes.push(Object.assign({ type: 'polygon', points: points.map(p => ({ x: p.x, y: p.y })) }, extra));
  }
  return shapes;
}

return { FONTS, listFonts, getFont, flatten, signedArea, layout, contoursToShapes };
}));
