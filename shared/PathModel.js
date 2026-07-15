/**
 * PathModel.js — نموذج المسار البيزيري الموحّد (أساس P0)
 *
 * المسار = { type:'path', anchors:[...], closed:bool }
 * المرساة = { x, y, hin:{x,y}, hout:{x,y}, kind:'corner'|'smooth' }
 *   hin/hout متجهان **نسبيان** من المرساة (صفرهما = مقطع مستقيم من هذا الطرف).
 *   corner  = مقبضان مستقلان. smooth = مقبضان متعاكسا الاتجاه (الأطوال حرّة).
 *
 * يوفّر: تحويلاً بلا فقد من كل الأشكال البارامترية (دائرة/قوس/بيضوي/فتحة/مستطيل…)،
 * تفليطاً متكيّفاً بدقة يحدّدها التفاوت لا عدد نقاط ثابت، حدوداً مضبوطة من جذور
 * المشتقة، تقسيم مقطع (de Casteljau)، وأقرب نقطة على المسار.
 *
 * وحدة مشتركة (UMD): الخادم بـ require، والمتصفح عبر DQ.PathModel.
 * كائنات JSON بحتة — undo/clipboard/الحفظ تعمل بلا تسلسل خاص.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.PathModel = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ثابت بيزير الدائري: ربع دائرة بمقبض r·κ يعطي خطأ نصف قطر ≤ 0.027% */
const KAPPA = 0.5522847498307936;

const V0 = () => ({ x: 0, y: 0 });
/* ‎+0 يطبّع الصفر السالب (-k·sin(0) = -0) — وإلا اختلف الاستنساخ عبر JSON عن الأصل */
const anchor = (x, y, hin, hout, kind) => ({
  x: x + 0, y: y + 0,
  hin:  hin  ? { x: hin.x + 0,  y: hin.y + 0 }  : V0(),
  hout: hout ? { x: hout.x + 0, y: hout.y + 0 } : V0(),
  kind: kind || 'corner',
});

const isPath = s => !!s && s.type === 'path' && Array.isArray(s.anchors);

function makePath(anchors, closed) {
  return { type: 'path', anchors, closed: !!closed };
}

/* ═══════════════ التحويل بلا فقد من الأشكال البارامترية ═══════════════ */

/* مراسي قوس دائري حول (cx,cy) من زاوية a0 إلى a1 (اتجاه الإشارة يحدّد الدوران).
   يُقسَّم لمقاطع ≤ 90° بمقبض r·(4/3)·tan(Δ/4) — التمثيل البيزيري القياسي للقوس. */
function arcAnchors(cx, cy, r, a0, a1) {
  const sweep = a1 - a0;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const d = sweep / n;
  const k = (4 / 3) * Math.tan(d / 4) * r;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + d * i;
    const cos = Math.cos(a), sin = Math.sin(a);
    // المماس عند a هو (-sin, cos)·اتجاه — المقابض على المماس
    out.push(anchor(
      cx + r * cos, cy + r * sin,
      { x:  k * sin, y: -k * cos },   // داخل (عكس اتجاه التقدّم)
      { x: -k * sin, y:  k * cos },   // خارج
      'smooth'
    ));
  }
  // طرفا القوس المفتوح: لا مقبض خارج آخر مرساة ولا داخل أولها
  out[0].hin = V0();
  out[out.length - 1].hout = V0();
  return out;
}

function fromShape(s) {
  if (!s) return null;
  if (isPath(s)) return s;
  const styleOf = () => {
    const keep = {};
    for (const k of ['layer', 'depth', 'color', 'stroke', 'fill', 'name', 'feedRate', 'reversed', 'leadIn', 'tabs', 'disabled', 'locked'])
      if (s[k] !== undefined) keep[k] = s[k];
    return keep;
  };
  const wrap = (anchors, closed) => Object.assign(makePath(anchors, closed), styleOf());

  switch (s.type) {
    case 'line':
      return wrap([anchor(s.x1, s.y1), anchor(s.x2, s.y2)], false);

    case 'rect':
      return wrap([
        anchor(s.x, s.y), anchor(s.x + s.w, s.y),
        anchor(s.x + s.w, s.y + s.h), anchor(s.x, s.y + s.h),
      ], true);

    case 'circle': {
      const a = arcAnchors(s.cx, s.cy, s.r, 0, 2 * Math.PI);
      a.pop();                                   // المرساة الأخيرة تطابق الأولى
      const k = KAPPA * s.r;
      a[0].hin = { x: 0, y: -k };                // أعد مقبض الإغلاق الذي أزاله القوس المفتوح
      return wrap(a, true);
    }

    case 'ellipse': {
      const rx = s.rx || 1, ry = s.ry || 1, kx = KAPPA * rx, ky = KAPPA * ry;
      return wrap([
        anchor(s.cx + rx, s.cy, { x: 0, y: -ky }, { x: 0, y: ky }, 'smooth'),
        anchor(s.cx, s.cy + ry, { x: kx, y: 0 }, { x: -kx, y: 0 }, 'smooth'),
        anchor(s.cx - rx, s.cy, { x: 0, y: ky }, { x: 0, y: -ky }, 'smooth'),
        anchor(s.cx, s.cy - ry, { x: -kx, y: 0 }, { x: kx, y: 0 }, 'smooth'),
      ], true);
    }

    case 'arc': {
      let sweep = s.endAngle - s.startAngle;
      if (s.clockwise) { if (sweep > 0) sweep -= 2 * Math.PI; }
      else             { if (sweep < 0) sweep += 2 * Math.PI; }
      return wrap(arcAnchors(s.cx, s.cy, s.r, s.startAngle, s.startAngle + sweep), false);
    }

    case 'slot': {
      const ang = Math.atan2(s.cy2 - s.cy1, s.cx2 - s.cx1), r = s.r || 1;
      if (Math.hypot(s.cx2 - s.cx1, s.cy2 - s.cy1) < 1e-9)
        return fromShape({ ...s, type: 'circle', cx: s.cx1, cy: s.cy1, r });
      // نصف دائرة حول c2 ثم خط ثم نصف دائرة حول c1 ثم إغلاق
      const h2 = arcAnchors(s.cx2, s.cy2, r, ang - Math.PI / 2, ang + Math.PI / 2);
      const h1 = arcAnchors(s.cx1, s.cy1, r, ang + Math.PI / 2, ang + 3 * Math.PI / 2);
      return wrap([...h2, ...h1], true);
    }

    case 'polygon':
      return (s.points && s.points.length >= 3)
        ? wrap(s.points.map(p => anchor(p.x, p.y)), true) : null;

    case 'polyline':
      return (s.points && s.points.length >= 2)
        ? wrap(s.points.map(p => anchor(p.x, p.y)), !!s.closed) : null;

    default:
      return (Array.isArray(s.points) && s.points.length >= 2)
        ? wrap(s.points.map(p => anchor(p.x, p.y)), s.closed !== false) : null;
  }
}

/* ═══════════════ المقاطع والتقييم ═══════════════ */

/* مقاطع المسار: كل مقطع {p0, c1, c2, p1, i0, i1} بنقاط تحكم مطلقة */
function segments(path) {
  const A = path.anchors, n = A.length, out = [];
  if (n < 2) return out;
  const m = path.closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = A[i], b = A[(i + 1) % n];
    out.push({
      p0: { x: a.x, y: a.y },
      c1: { x: a.x + a.hout.x, y: a.y + a.hout.y },
      c2: { x: b.x + b.hin.x,  y: b.y + b.hin.y },
      p1: { x: b.x, y: b.y },
      i0: i, i1: (i + 1) % n,
    });
  }
  return out;
}

function evalSeg(s, t) {
  const m = 1 - t;
  return {
    x: m*m*m*s.p0.x + 3*m*m*t*s.c1.x + 3*m*t*t*s.c2.x + t*t*t*s.p1.x,
    y: m*m*m*s.p0.y + 3*m*m*t*s.c1.y + 3*m*t*t*s.c2.y + t*t*t*s.p1.y,
  };
}

const segIsLine = s =>
  Math.abs(s.c1.x - s.p0.x) < 1e-12 && Math.abs(s.c1.y - s.p0.y) < 1e-12 &&
  Math.abs(s.c2.x - s.p1.x) < 1e-12 && Math.abs(s.c2.y - s.p1.y) < 1e-12;

/* ═══════════════ التفليط المتكيّف ═══════════════ */

/* مسطّح إذا بَعُدت نقطتا التحكم عن الوتر أقل من tol */
function flatEnough(s, tol) {
  const dx = s.p1.x - s.p0.x, dy = s.p1.y - s.p0.y;
  const L = Math.hypot(dx, dy) || 1e-12;
  const d1 = Math.abs((s.c1.x - s.p0.x) * dy - (s.c1.y - s.p0.y) * dx) / L;
  const d2 = Math.abs((s.c2.x - s.p0.x) * dy - (s.c2.y - s.p0.y) * dx) / L;
  return Math.max(d1, d2) <= tol;
}

function subdivide(s) {
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = mid(s.p0, s.c1), p12 = mid(s.c1, s.c2), p23 = mid(s.c2, s.p1);
  const p012 = mid(p01, p12), p123 = mid(p12, p23);
  const p = mid(p012, p123);
  return [
    { p0: s.p0, c1: p01,  c2: p012, p1: p },
    { p0: p,    c1: p123, c2: p23,  p1: s.p1 },
  ];
}

function flattenSeg(s, tol, out, depth) {
  if (depth >= 16 || segIsLine(s) || flatEnough(s, tol)) { out.push(s.p1); return; }
  const [a, b] = subdivide(s);
  flattenSeg(a, tol, out, depth + 1);
  flattenSeg(b, tol, out, depth + 1);
}

/**
 * تفليط المسار إلى {points, closed}. tol بوحدات العالم (mm) — افتراضي 0.02mm:
 * أدقّ بكثير من N=64 الثابتة للأشكال الكبيرة، وأخفّ للصغيرة.
 */
function flatten(path, tol) {
  tol = tol > 0 ? tol : 0.02;
  const segs = segments(path);
  if (!segs.length) return { points: path.anchors.map(a => ({ x: a.x, y: a.y })), closed: !!path.closed };
  const pts = [{ x: segs[0].p0.x, y: segs[0].p0.y }];
  for (const s of segs) flattenSeg(s, tol, pts, 0);
  if (path.closed && pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) pts.pop();   // لا تكرار لنقطة الإغلاق
  }
  return { points: pts, closed: !!path.closed };
}

/* ═══════════════ الحدود المضبوطة ═══════════════ */

/* جذور مشتقة البيزير التكعيبي لمحور واحد: 3(at² + bt + c) */
function axisExtrema(p0, c1, c2, p1) {
  const a = p1 - 3 * c2 + 3 * c1 - p0;
  const b = 2 * (c2 - 2 * c1 + p0);
  const c = c1 - p0;
  const ts = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) { const t = -c / b; if (t > 0 && t < 1) ts.push(t); }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const q = Math.sqrt(disc);
      for (const t of [(-b + q) / (2 * a), (-b - q) / (2 * a)]) if (t > 0 && t < 1) ts.push(t);
    }
  }
  return ts;
}

function bounds(path) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const eat = p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  };
  const segs = segments(path);
  if (!segs.length) { path.anchors.forEach(eat); }
  for (const s of segs) {
    eat(s.p0); eat(s.p1);
    for (const t of axisExtrema(s.p0.x, s.c1.x, s.c2.x, s.p1.x)) eat(evalSeg(s, t));
    for (const t of axisExtrema(s.p0.y, s.c1.y, s.c2.y, s.p1.y)) eat(evalSeg(s, t));
  }
  if (!isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

/* ═══════════════ التحويلات ═══════════════ */

/* fnPt يحوّل النقاط المطلقة، fnVec يحوّل المتجهات (الجزء الخطي فقط — بلا إزاحة) */
function transform(path, fnPt, fnVec) {
  for (const a of path.anchors) {
    const p = fnPt({ x: a.x, y: a.y });
    a.x = p.x; a.y = p.y;
    if (fnVec) { a.hin = fnVec(a.hin); a.hout = fnVec(a.hout); }
  }
  return path;
}

const translate = (path, dx, dy) =>
  transform(path, p => ({ x: p.x + dx, y: p.y + dy }), null);

const rotate = (path, theta, cx, cy) => {
  const cos = Math.cos(theta), sin = Math.sin(theta);
  return transform(path,
    p => ({ x: cx + (p.x - cx) * cos - (p.y - cy) * sin, y: cy + (p.x - cx) * sin + (p.y - cy) * cos }),
    v => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }));
};

const scale = (path, fx, fy, cx, cy) =>
  transform(path,
    p => ({ x: cx + (p.x - cx) * fx, y: cy + (p.y - cy) * fy }),
    v => ({ x: v.x * fx, y: v.y * fy }));

/* ═══════════════ عمليات العُقَد ═══════════════ */

/* إدراج مرساة عند t داخل المقطع segIdx (de Casteljau) — يحافظ على الشكل حرفياً */
function splitSegment(path, segIdx, t) {
  const segs = segments(path);
  const s = segs[segIdx];
  if (!s) return -1;
  const mix = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = mix(s.p0, s.c1), p12 = mix(s.c1, s.c2), p23 = mix(s.c2, s.p1);
  const p012 = mix(p01, p12), p123 = mix(p12, p23);
  const p = mix(p012, p123);

  const A = path.anchors;
  const a0 = A[s.i0], a1 = A[s.i1];
  a0.hout = { x: p01.x - a0.x, y: p01.y - a0.y };
  a1.hin  = { x: p23.x - a1.x, y: p23.y - a1.y };
  const mid = anchor(p.x, p.y,
    { x: p012.x - p.x, y: p012.y - p.y },
    { x: p123.x - p.x, y: p123.y - p.y },
    'smooth');
  const at = s.i0 + 1;
  A.splice(at, 0, mid);
  return at;
}

function removeAnchor(path, i) {
  if (path.anchors.length <= 2) return false;
  path.anchors.splice(i, 1);
  return true;
}

/* فرض قيد النعومة: عدّل hin/hout المقابل ليبقى معاكس الاتجاه (طوله محفوظ) */
function syncSmooth(a, changed) {
  if (a.kind !== 'smooth') return;
  const src = changed === 'hin' ? a.hin : a.hout;
  const dstKey = changed === 'hin' ? 'hout' : 'hin';
  const len = Math.hypot(a[dstKey].x, a[dstKey].y);
  const sl = Math.hypot(src.x, src.y);
  if (sl < 1e-9) return;
  a[dstKey] = { x: -src.x / sl * len, y: -src.y / sl * len };
}

/* تبديل نوع المرساة: smooth يبني مقابض على مماس الجارين إن كانت صفرية */
function setKind(path, i, kind) {
  const A = path.anchors, a = A[i];
  a.kind = kind;
  if (kind !== 'smooth') return;
  const prev = A[(i - 1 + A.length) % A.length];
  const next = A[(i + 1) % A.length];
  const tx = next.x - prev.x, ty = next.y - prev.y;
  const tl = Math.hypot(tx, ty) || 1;
  const lin  = Math.hypot(a.hin.x, a.hin.y)  || Math.hypot(prev.x - a.x, prev.y - a.y) / 3;
  const lout = Math.hypot(a.hout.x, a.hout.y) || Math.hypot(next.x - a.x, next.y - a.y) / 3;
  a.hin  = { x: -tx / tl * lin,  y: -ty / tl * lin };
  a.hout = { x:  tx / tl * lout, y:  ty / tl * lout };
}

/* ═══════════════ أقرب نقطة على المسار ═══════════════ */

/* عيّنة خشنة (24/مقطع) + تنقيح ثنائي محلي — كافٍ لالتقاط الأدوات */
function nearest(path, pt) {
  const segs = segments(path);
  let best = null;
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const p = evalSeg(s, t);
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (!best || d < best.dist) best = { segIdx: si, t, pt: p, dist: d };
    }
  }
  if (!best) return null;
  // تنقيح: بحث ثلاثي حول أفضل t
  const s = segs[best.segIdx];
  let lo = Math.max(0, best.t - 1 / 24), hi = Math.min(1, best.t + 1 / 24);
  for (let it = 0; it < 24; it++) {
    const t1 = lo + (hi - lo) / 3, t2 = hi - (hi - lo) / 3;
    const d1 = Math.hypot(evalSeg(s, t1).x - pt.x, evalSeg(s, t1).y - pt.y);
    const d2 = Math.hypot(evalSeg(s, t2).x - pt.x, evalSeg(s, t2).y - pt.y);
    if (d1 < d2) hi = t2; else lo = t1;
  }
  const t = (lo + hi) / 2, p = evalSeg(s, t);
  return { segIdx: best.segIdx, t, pt: p, dist: Math.hypot(p.x - pt.x, p.y - pt.y) };
}

/* ═══════════════ من عقد القلم {x,y,ho} ═══════════════ */

/* عقد أداة القلم: ho = المقبض الخارج، والداخل مرآته (نمط السحب أثناء الرسم) */
function fromPenNodes(nodes, closed) {
  if (!nodes || nodes.length < 2) return null;
  const anchors = nodes.map(n => {
    const ho = n.ho || V0();
    const curved = Math.hypot(ho.x, ho.y) > 1e-9;
    return anchor(n.x, n.y, { x: -ho.x, y: -ho.y }, { x: ho.x, y: ho.y }, curved ? 'smooth' : 'corner');
  });
  if (!closed) { anchors[0].hin = V0(); anchors[anchors.length - 1].hout = V0(); }
  return makePath(anchors, closed);
}

return {
  KAPPA, anchor, isPath, makePath, fromShape, fromPenNodes,
  segments, evalSeg, flatten, bounds,
  transform, translate, rotate, scale,
  splitSegment, removeAnchor, setKind, syncSmooth, nearest,
};
}));
