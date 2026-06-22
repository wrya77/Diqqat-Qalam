/**
 * image-tracer.worker.js — تتبّع الصورة خارج الخيط الرئيسي
 *
 * يستقبل بيانات بكسل خام (RGBA) فيُجري التحويل الثنائي + تتبّع الحدود + التبسيط،
 * ثم يُعيد الأشكال. الهدف: ألّا تتجمّد الواجهة ثوانٍ أثناء تتبّع الصور الكبيرة.
 * الخوارزمية مطابقة لـ image-tracer.js (Square Tracing + Ramer-Douglas-Peucker).
 */
'use strict';

/* ── تحويل بيانات البيكسل إلى ثنائي ── */
function toBinary(data, w, h, threshold, invert, blur) {
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const gray  = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    const alpha = data[o + 3];
    let v = (alpha > 20 && gray < threshold) ? 1 : 0;
    if (invert) v ^= 1;
    bin[i] = v;
  }
  if (blur) simpleBlur(bin, w, h);
  return bin;
}

/* تمويه 3×3 لإزالة الضجيج */
function simpleBlur(bin, w, h) {
  const tmp = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          sum += bin[(y + dy) * w + (x + dx)];
      tmp[y * w + x] = sum >= 5 ? 1 : 0;
    }
  }
  for (let i = 0; i < w * h; i++) bin[i] = tmp[i];
}

/* ── Square Tracing لاستخراج الحدود ── */
function traceContours(bin, w, h, minPts) {
  const visited  = new Uint8Array(w * h);
  const contours = [];
  const get = (x, y) => (x >= 0 && x < w && y >= 0 && y < h ? bin[y * w + x] : 0);

  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      if (!bin[sy * w + sx] || visited[sy * w + sx]) continue;

      const isEdge = !get(sx - 1, sy) || !get(sx + 1, sy) || !get(sx, sy - 1) || !get(sx, sy + 1);
      if (!isEdge) continue;

      const pts = [];
      let x = sx, y = sy, dir = 0;
      let steps = 0;
      const MAX_STEPS = 50000;

      do {
        if (!visited[y * w + x]) { visited[y * w + x] = 1; pts.push(x, y); }
        const left = (dir + 6) & 7;
        let found = false;
        for (let t = 0; t < 8; t++) {
          const d = (left + t) & 7;
          const nx = x + DX[d], ny = y + DY[d];
          if (get(nx, ny)) { x = nx; y = ny; dir = d; found = true; break; }
        }
        if (!found) break;
        steps++;
      } while ((x !== sx || y !== sy) && steps < MAX_STEPS);

      const points = [];
      for (let i = 0; i < pts.length; i += 2) points.push({ x: pts[i], y: pts[i + 1] });

      if (points.length >= minPts) contours.push(points);
    }
  }

  return contours;
}

/* ── تحويل الحدود إلى أشكال مع التبسيط والتحجيم ── */
function toShapes(contours, scaleMM, resizeRatio, simplify) {
  const s = scaleMM / resizeRatio;
  let maxY = 0;
  for (const pts of contours) for (const p of pts) if (p.y > maxY) maxY = p.y;

  // سقف إجمالي النقاط (مطابق لـ image-tracer.js): تبسيط تكيّفي يمنع برامج G-Code
  // العملاقة غير القابلة للتشغيل ويُبقي التوليد/التدقيق سريعاً.
  const CAP = 40000;
  const build = (eps) => contours.map(pts => {
    const simple = rdp(pts, eps);
    const closed = simple.length > 3 &&
      Math.hypot(simple[0].x - simple[simple.length - 1].x,
                 simple[0].y - simple[simple.length - 1].y) < 3;
    return {
      type: 'polyline',
      points: simple.map(p => ({ x: p.x * s, y: (maxY - p.y) * s })),
      closed,
    };
  }).filter(sh => sh.points.length >= 2);

  let eps = simplify;
  let shapes = build(eps);
  let total = shapes.reduce((n, sh) => n + sh.points.length, 0);
  let guard = 0;
  while (total > CAP && guard++ < 8) {
    eps *= 1.8;
    shapes = build(eps);
    total = shapes.reduce((n, sh) => n + sh.points.length, 0);
  }
  return shapes;
}

/* ── Ramer-Douglas-Peucker ── */
function rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  let dmax = 0, idx = 0;
  const end = pts.length - 1;
  for (let i = 1; i < end; i++) {
    const d = pdist(pts[i], pts[0], pts[end]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const r1 = rdp(pts.slice(0, idx + 1), eps);
    const r2 = rdp(pts.slice(idx), eps);
    return [...r1.slice(0, -1), ...r2];
  }
  return [pts[0], pts[end]];
}

function pdist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (!len) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / len;
}

self.onmessage = (e) => {
  const d = e.data || {};
  try {
    const data = d.data;
    const bin  = toBinary(data, d.width, d.height, d.threshold ?? 128, !!d.invert, d.blur !== false);
    const cont = traceContours(bin, d.width, d.height, d.minPts ?? 4);
    const shapes = toShapes(cont, d.scale || 1, d.ratio || 1, d.simplify ?? 1.5);
    self.postMessage({ shapes });
  } catch (err) {
    self.postMessage({ error: (err && err.message) || String(err) });
  }
};
