/**
 * tools-width-envelope.js — أداة العرض المتغيّر · تشويه الغلاف · شبكة المنظور
 *
 *   أداة العرض (Width, Shift+W)
 *     اسحب على مسار فتُضاف نقطة عرض؛ سحبها عمودياً يوسّع الحدّ أو يضيّقه عندها.
 *     العرض يُخزَّن في `s.widthPts = [{t, w}]` حيث t نسبة الموضع على المسار.
 *     مولّد G-Code يقرأ `sw` فقط، فنُصدِّر العرض المتغيّر بـ«تحويل إلى شكل».
 *
 *   بروفايلات العرض
 *     ستّ توزيعات جاهزة (منتظم، مدبّب، مزدوج، مقوّس، منتفخ، متعرّج) تُطبَّق بنقرة.
 *
 *   تشويه الغلاف (Envelope Distort, Alt+Ctrl+W)
 *     أربعة أغلفة رياضية (قوس، انتفاخ، موجة، راية) + غلاف بشبكة 4 زوايا حرّة.
 *
 *   شبكة المنظور (Perspective Grid, Shift+P)
 *     شبكة بنقطة أو نقطتين تلاشٍ؛ الأشكال المرسومة تُسقَط على المستوى النشط.
 *
 * لا يمسّ منطق G-Code ولا أي id/class.
 */
(function widthEnvelopeTools() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };
  const sel = ed => (ed._selIndices ? ed._selIndices() : []);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ───────── مساعدات المسار ───────── */

  /** نقاط الشكل كمسار مرتّب، مع علم الإغلاق — يعمل على polyline/polygon/rect/circle */
  function pathOf(ed, s) {
    if (!s) return null;
    if ((s.type === 'polyline' || s.type === 'polygon') && s.points && s.points.length > 1) {
      return { pts: s.points, closed: !!s.closed || s.type === 'polygon' };
    }
    if (s.type === 'line') return { pts: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], closed: false };
    const c = ed._shapeToContours ? ed._shapeToContours(s) : null;
    return (c && c[0] && c[0].length > 1) ? { pts: c[0], closed: true } : null;
  }

  /** أطوال تراكمية على المسار — أساس تحويل الموضع t∈[0,1] إلى نقطة */
  function cumLen(pts, closed) {
    const L = [0];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      L.push(L[L.length - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return L;
  }

  /** نقطة على المسار عند نسبة t، مع اتجاه المماسّ */
  function atT(pts, closed, t) {
    const L = cumLen(pts, closed), total = L[L.length - 1];
    if (!total) return { x: pts[0].x, y: pts[0].y, nx: 0, ny: -1 };
    const d = clamp(t, 0, 1) * total;
    let i = 0;
    while (i < L.length - 2 && L[i + 1] < d) i++;
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const segL = L[i + 1] - L[i] || 1;
    const u = (d - L[i]) / segL;
    const tx = (b.x - a.x) / segL, ty = (b.y - a.y) / segL;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, nx: -ty, ny: tx };
  }

  /* ═══════════════ ١) بروفايلات العرض ═══════════════ */

  /** كل بروفايل دالّة t→معامل عرض (1 = العرض الأساسي) */
  const PROFILES = {
    uniform:  { name: 'منتظم',  f: () => 1 },
    tapered:  { name: 'مدبّب',  f: t => 1 - t * 0.9 },
    doubleT:  { name: 'مدبّب مزدوج', f: t => 1 - Math.abs(t - 0.5) * 1.8 },
    bulge:    { name: 'منتفخ',  f: t => 0.25 + Math.sin(t * Math.PI) * 0.95 },
    arc:      { name: 'مقوّس',  f: t => 0.3 + t * 0.9 },
    wavy:     { name: 'متعرّج', f: t => 0.6 + Math.sin(t * Math.PI * 4) * 0.4 },
  };
  window.DQWidthProfiles = PROFILES;

  /** يطبّق بروفايلاً على المحدد — يملأ widthPts بـ17 عيّنة (دقّة كافية بصرياً) */
  P.applyWidthProfile = function (key) {
    const prof = PROFILES[key];
    if (!prof) return toast('بروفايل غير معروف', 'error');
    const idx = sel(this);
    if (!idx.length) return toast('حدّد مساراً أولاً', 'warn');
    this._saveHistory();
    let n = 0;
    for (const i of idx) {
      const s = this.shapes[i];
      if (!pathOf(this, s)) continue;
      s.widthPts = Array.from({ length: 17 }, (_, k) => {
        const t = k / 16;
        return { t, w: Math.max(0.05, prof.f(t)) };
      });
      s.widthProfile = key;
      n++;
    }
    this.render();
    if (!n) return toast('لا مسار صالح في التحديد', 'warn');
    toast(`✓ بروفايل العرض: ${prof.name}`, 'success');
  };

  /** يمسح العرض المتغيّر ويعيد الحدّ منتظماً */
  P.clearWidthProfile = function () {
    const idx = sel(this);
    if (!idx.length) return toast('حدّد مساراً أولاً', 'warn');
    this._saveHistory();
    idx.forEach(i => { const s = this.shapes[i]; if (s) { delete s.widthPts; delete s.widthProfile; } });
    this.render();
    toast('أُلغي العرض المتغيّر', 'info');
  };

  /** معامل العرض عند t بالاستيفاء الخطّي بين نقاط widthPts */
  function widthAt(s, t) {
    const W = s.widthPts;
    if (!W || !W.length) return 1;
    if (t <= W[0].t) return W[0].w;
    for (let i = 1; i < W.length; i++) {
      if (t <= W[i].t) {
        const u = (t - W[i - 1].t) / ((W[i].t - W[i - 1].t) || 1);
        return W[i - 1].w + (W[i].w - W[i - 1].w) * u;
      }
    }
    return W[W.length - 1].w;
  }
  window.DQWidthAt = widthAt;

  /**
   * تحويل الحدّ المتغيّر إلى شكل مغلق — هذا ما يجعله يصل إلى G-Code.
   * نبني الحافّتين: إزاحة عمودية بمقدار (sw/2 × معامل العرض) في الاتجاهين.
   */
  P.outlineVariableWidth = function () {
    const idx = sel(this);
    const targets = idx.filter(i => this.shapes[i] && this.shapes[i].widthPts);
    if (!targets.length) return toast('حدّد مساراً بعرض متغيّر أولاً', 'warn');
    this._saveHistory();
    const made = [];
    for (const i of targets) {
      const s = this.shapes[i];
      const p = pathOf(this, s);
      if (!p) continue;
      const base = (s.sw || 1) / 2;
      const N = 96, left = [], right = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const q = atT(p.pts, p.closed, t);
        const w = base * widthAt(s, t);
        left.push({ x: q.x + q.nx * w, y: q.y + q.ny * w });
        right.push({ x: q.x - q.nx * w, y: q.y - q.ny * w });
      }
      made.push({
        type: 'polyline', closed: true,
        points: left.concat(right.reverse()),
        layer: s.layer, stroke: s.stroke, sw: s.sw, maxDepth: s.maxDepth,
      });
    }
    if (!made.length) return toast('تعذّر التحويل', 'warn');
    targets.slice().sort((a, b) => b - a).forEach(i => this.shapes.splice(i, 1));
    const first = this.shapes.length;
    made.forEach(m => this.shapes.push(m));
    if (this.msel) { this.msel.clear(); for (let i = first; i < this.shapes.length; i++) this.msel.add(i); }
    this.selectedIdx = this.shapes.length - 1;
    this.render(); this._updateStatus?.();
    toast(`✓ حوّل ${made.length} مساراً بعرض متغيّر إلى أشكال`, 'success');
  };

  /* ═══════════════ ٢) أداة العرض التفاعلية ═══════════════ */

  const widthTool = {
    cursor: 'crosshair',
    onDown(e) {
      const pt = this._evPt(e);
      const idx = this._hitTest ? this._hitTest(pt) : -1;
      if (idx < 0) { toast('انقر على مسار لإضافة نقطة عرض', 'warn'); return; }
      const s = this.shapes[idx];
      const p = pathOf(this, s);
      if (!p) { toast('هذا الشكل لا يدعم العرض المتغيّر', 'warn'); return; }
      // أقرب t على المسار للنقطة المضغوطة
      let bestT = 0, bestD = Infinity;
      for (let k = 0; k <= 200; k++) {
        const t = k / 200, q = atT(p.pts, p.closed, t);
        const d = Math.hypot(q.x - pt.x, q.y - pt.y);
        if (d < bestD) { bestD = d; bestT = t; }
      }
      if (!s.widthPts) { s.widthPts = [{ t: 0, w: 1 }, { t: 1, w: 1 }]; }
      this._saveHistory();
      this._widthDrag = { si: idx, t: bestT, base: (s.sw || 1) / 2, start: pt };
      this.isDrawing = true;
    },
    onMove(e) {
      const d = this._widthDrag;
      if (!d) return;
      const pt = this._evPt(e);
      const s = this.shapes[d.si];
      const p = pathOf(this, s);
      const q = atT(p.pts, p.closed, d.t);
      // المسافة العمودية عن المسار هي نصف العرض المطلوب
      const off = Math.abs((pt.x - q.x) * q.nx + (pt.y - q.y) * q.ny);
      const w = clamp(off / (d.base || 1), 0.05, 12);
      const W = s.widthPts;
      const at = W.findIndex(o => Math.abs(o.t - d.t) < 0.012);
      if (at >= 0) W[at].w = w; else { W.push({ t: d.t, w }); W.sort((a, b) => a.t - b.t); }
      s.widthProfile = 'custom';
      this.render();
    },
    onUp() {
      if (!this._widthDrag) return;
      this._widthDrag = null;
      this.isDrawing = false;
      toast('نقطة عرض — «تحويل العرض إلى شكل» يُرسِلها إلى G-Code', 'info');
    },
    onDraw(ctx) {
      // يرسم الحدّ المتغيّر معاينةً على كل شكل يحمل widthPts
      const ed = this;
      ctx.save();
      ctx.strokeStyle = '#f0c674';
      ctx.globalAlpha = 0.85;
      ed.shapes.forEach(s => {
        if (!s.widthPts) return;
        const p = pathOf(ed, s);
        if (!p) return;
        const base = (s.sw || 1) / 2;
        for (let k = 0; k <= 64; k++) {
          const t = k / 64, q = atT(p.pts, p.closed, t), w = base * widthAt(s, t);
          const a = ed._wToS(q.x + q.nx * w, q.y + q.ny * w);
          const b = ed._wToS(q.x - q.nx * w, q.y - q.ny * w);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      });
      ctx.restore();
    },
  };

  /* ═══════════════ ٣) تشويه الغلاف ═══════════════ */

  /**
   * أغلفة رياضية: تأخذ نقطة في مربّع وحدة [0,1]² وتعيد إزاحة نسبية.
   *
   * ملاحظة على «القوس»: الصيغة البديهية `v + k·sin(uπ)·(1−v)` تحرّك الحافّة
   * العليا وحدها فتنهار على السفلى عند k=0.5. الانحناء الصحيح يزيح الحافّتين
   * معاً بالمقدار نفسه — فيحفظ سماكة الشكل ويثني الشريط كلّه، وهو ما يفعله
   * Arc في Illustrator. النسخة المائلة نحو حافّة واحدة بقيت باسم «قوس سفليّ».
   */
  const ENVELOPES = {
    arc:   { name: 'قوس',       f: (u, v, k) => ({ u, v: v + k * Math.sin(u * Math.PI) * 0.6 }) },
    arcLo: { name: 'قوس سفليّ', f: (u, v, k) => ({ u, v: v + k * Math.sin(u * Math.PI) * (1 - v) * 0.8 }) },
    bulge: { name: 'انتفاخ',    f: (u, v, k) => ({ u: u + k * Math.sin(v * Math.PI) * (u - 0.5), v: v + k * Math.sin(u * Math.PI) * (v - 0.5) }) },
    wave:  { name: 'موجة',      f: (u, v, k) => ({ u, v: v + k * Math.sin(u * Math.PI * 2) * 0.5 }) },
    // الراية موجة بسعة متنامية على الطول — لا تعتمد على v وإلا جمدت الحافّة العليا
    flag:  { name: 'راية',      f: (u, v, k) => ({ u, v: v + k * Math.sin(u * Math.PI * 2) * (0.2 + u * 0.6) }) },
    fish:  { name: 'سمكة',      f: (u, v, k) => ({ u, v: 0.5 + (v - 0.5) * (1 - k * u) }) },
    rise:  { name: 'صعود',      f: (u, v, k) => ({ u, v: v + k * u * (1 - v) }) },
    squeeze: { name: 'ضغط',     f: (u, v, k) => ({ u, v: 0.5 + (v - 0.5) * (1 - k * Math.sin(u * Math.PI)) }) },
  };
  window.DQEnvelopes = ENVELOPES;

  /** يطبّق غلافاً على كل نقاط المحدد، بالنسبة إلى صندوقه المحيط */
  P.applyEnvelope = function (kind, bend) {
    const env = ENVELOPES[kind];
    if (!env) return toast('غلاف غير معروف', 'error');
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
    const k = bend === undefined ? 0.5 : bend;

    // صندوق موحّد لكل التحديد — فيتشوّه كوحدة واحدة كما في Illustrator
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of idx) {
      const b = this._bounds(this.shapes[i]);
      if (!b) continue;
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    }
    if (!isFinite(minX)) return toast('تعذّر قياس التحديد', 'warn');
    const W = (maxX - minX) || 1, H = (maxY - minY) || 1;

    this._saveHistory();
    let n = 0;
    // خطوة التكثيف نسبةً إلى حجم الصندوق: ٦٠ قطعة على أطول ضلع
    const step = Math.max(0.4, Math.max(W, H) / 60);
    for (const i of idx) {
      densifyShape(this, i, step);
      if (!eachPointOf(this, i, (x, y) => {
        const r = env.f((x - minX) / W, (y - minY) / H, k);
        return { x: minX + r.u * W, y: minY + r.v * H };
      })) continue;
      n++;
    }
    this.render(); this._updateStatus?.();
    if (!n) return toast('لا شكل قابل للتشويه في التحديد', 'warn');
    toast(`✓ غلاف ${env.name} — انحناء ${Math.round(k * 100)}%`, 'success');
  };

  /** غلاف بأربع زوايا حرّة: يعيد رسم التحديد داخل رباعي أضلاع كيفيّ */
  P.applyEnvelopeMesh = function (corners) {
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
    if (!corners || corners.length !== 4) return toast('يلزم أربع زوايا', 'error');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of idx) {
      const b = this._bounds(this.shapes[i]); if (!b) continue;
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    }
    const W = (maxX - minX) || 1, H = (maxY - minY) || 1;
    const [A, B, C, D] = corners;                 // أ.يسار‑أعلى ب.يمين‑أعلى ج.يمين‑أسفل د.يسار‑أسفل
    this._saveHistory();
    const stepM = Math.max(0.4, Math.max(W, H) / 60);
    for (const i of idx) {
      densifyShape(this, i, stepM);
      eachPointOf(this, i, (x, y) => {
        const u = (x - minX) / W, v = (y - minY) / H;
        // استيفاء ثنائي الخطّية على الرباعي
        const top = { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u };
        const bot = { x: D.x + (C.x - D.x) * u, y: D.y + (C.y - D.y) * u };
        return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
      });
    }
    this.render();
    toast('✓ غلاف بشبكة حرّة', 'success');
  };

  /** حوار الغلاف */
  P.promptEnvelope = async function () {
    const ask = window.DQPrompt;
    if (!ask) return this.applyEnvelope('arc', 0.5);
    const r = await ask('تشويه الغلاف', [
      { key: 'kind', label: 'النوع', type: 'select',
        options: Object.entries(ENVELOPES).map(([k, v]) => ({ value: k, label: v.name })), value: 'arc' },
      { key: 'bend', label: 'الانحناء ٪', value: 50, min: -100, max: 100 },
    ]);
    if (!r) return;
    this.applyEnvelope(r.kind, (+r.bend || 0) / 100);
  };

  /**
   * تكثيف المسار قبل التشويه — بلا هذا لا يظهر أي انحناء.
   * السبب: أغلفة كـ«القوس» و«الموجة» تُصفَّر عند u=0 وu=1، وهما بالضبط
   * زاويتا المستطيل رباعيّ النقاط، فيعود الشكل كما كان. Illustrator يكثّف
   * أيضاً قبل أن يطبّق الغلاف — التشويه يحتاج نقاطاً وسطى ليحرّكها.
   */
  function densifyShape(ed, i, maxSeg) {
    const s = ed.shapes[i];
    if (!s) return;
    const step = maxSeg || 2;
    const run = pts => {
      if (!pts || pts.length < 2) return pts;
      const out = [];
      const n = pts.length;
      for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % n];
        out.push({ x: a.x, y: a.y });
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        const parts = Math.min(200, Math.floor(d / step));
        for (let m = 1; m < parts; m++) {
          out.push({ x: a.x + (b.x - a.x) * m / parts, y: a.y + (b.y - a.y) * m / parts });
        }
      }
      return out;
    };
    if (s.type === 'compound' && s.contours) { s.contours = s.contours.map(run); return; }
    if (s.points && s.points.length >= 2) { s.points = run(s.points); return; }
    // شكل أوّليّ: حوّله إلى polyline مكثّف
    const c = ed._shapeToContours ? ed._shapeToContours(s) : null;
    if (!c || !c[0]) return;
    ed.shapes[i] = {
      type: 'polyline', closed: true, points: run(c[0].map(p => ({ x: p.x, y: p.y }))),
      layer: s.layer, stroke: s.stroke, sw: s.sw, maxDepth: s.maxDepth, name: s.name,
    };
  }
  window.DQDensifyShape = densifyShape;

  /** يمرّر دالّة على كل نقطة في شكل — يغطّي كل الأنواع التي يفهمها المحرّر */
  function eachPointOf(ed, i, fn) {
    const s = ed.shapes[i];
    if (!s) return false;
    const M = p => { const q = fn(p.x, p.y); p.x = q.x; p.y = q.y; };
    if (s.type === 'text' && Array.isArray(s.strokes)) { s.strokes.forEach(st => st.forEach(M)); return true; }
    if (s.type === 'compound' && s.contours) { s.contours.forEach(c => c.forEach(M)); return true; }
    if (s.points && s.points.length) { s.points.forEach(M); return true; }
    if (s.type === 'line') {
      const a = fn(s.x1, s.y1), b = fn(s.x2, s.y2);
      s.x1 = a.x; s.y1 = a.y; s.x2 = b.x; s.y2 = b.y; return true;
    }
    // شكل أوّليّ: حوّله إلى polyline أولاً ثمّ شوّهه
    const c = ed._shapeToContours ? ed._shapeToContours(s) : null;
    if (!c || !c[0]) return false;
    const conv = { type: 'polyline', closed: true, points: c[0].map(p => ({ x: p.x, y: p.y })),
                   layer: s.layer, stroke: s.stroke, sw: s.sw, maxDepth: s.maxDepth, name: s.name };
    conv.points.forEach(M);
    ed.shapes[i] = conv;
    return true;
  }
  window.DQEachPoint = eachPointOf;

  /* ═══════════════ ٤) شبكة المنظور ═══════════════ */

  const PG = {
    on: false,
    mode: 2,                                  // 1 = نقطة تلاشٍ واحدة، 2 = نقطتان
    horizon: 60,                              // ارتفاع خطّ الأفق (عالم)
    vl: { x: -120, y: 60 },                   // نقطة التلاشي اليسرى
    vr: { x: 320, y: 60 },                    // اليمنى
    plane: 'left',                            // المستوى النشط: left | right | floor
  };
  window.DQPerspective = PG;

  P.togglePerspectiveGrid = function (mode) {
    PG.on = !PG.on || (mode && mode !== PG.mode);
    if (mode) PG.mode = mode;
    this.render();
    toast(PG.on ? `شبكة المنظور: ${PG.mode === 1 ? 'نقطة واحدة' : 'نقطتان'} — المستوى ${planeName()}` : 'أُطفئت شبكة المنظور',
      PG.on ? 'success' : 'info');
  };
  const planeName = () => ({ left: 'الأيسر', right: 'الأيمن', floor: 'الأرضية' })[PG.plane];

  P.setPerspectivePlane = function (p) {
    if (!['left', 'right', 'floor'].includes(p)) return;
    PG.plane = p;
    this.render();
    toast(`المستوى النشط: ${planeName()}`, 'info');
  };

  /** يُسقط المحدد على المستوى النشط — تقريب خطّي نحو نقطة التلاشي */
  P.projectToPerspective = function (amount) {
    if (!PG.on) return toast('فعّل شبكة المنظور أولاً (Shift+P)', 'warn');
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
    const k = amount === undefined ? 0.35 : amount;
    const V = PG.plane === 'right' ? PG.vr : PG.plane === 'left' ? PG.vl
            : { x: (PG.vl.x + PG.vr.x) / 2, y: PG.horizon };
    this._saveHistory();
    for (const i of idx) {
      // الانجذاب غير خطّي، فالخطّ المستقيم يجب أن ينحني — ولا ينحني بلا نقاط وسطى
      densifyShape(this, i, 2);
      eachPointOf(this, i, (x, y) => {
        // كلّما بَعُدت النقطة عن الأفق قلّ انجذابها — فيظهر العمق
        const d = Math.abs(y - PG.horizon);
        const w = k / (1 + d / 100);
        return { x: x + (V.x - x) * w, y: y + (V.y - y) * w };
      });
    }
    this.render();
    toast(`✓ إسقاط على المستوى ${planeName()}`, 'success');
  };

  /* رسم الشبكة فوق الكانفس */
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    if (!PG.on || !this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1;

    const hy = this._wToS(0, PG.horizon).y;
    ctx.strokeStyle = 'rgba(240,198,116,.55)';
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(this.canvas.width, hy); ctx.stroke();

    const ray = (V, color, from, to) => {
      const v = this._wToS(V.x, V.y);
      ctx.strokeStyle = color;
      for (let i = 0; i <= 12; i++) {
        const wx = from + (to - from) * (i / 12);
        const p = this._wToS(wx, PG.horizon + 220);
        ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    };
    const act = c => ctx.globalAlpha = c ? 0.5 : 0.18;
    if (PG.mode === 2) {
      act(PG.plane === 'left');  ray(PG.vl, '#4f9dff', -200, 400);
      act(PG.plane === 'right'); ray(PG.vr, '#ff6b9d', -200, 400);
    } else {
      const v = { x: (PG.vl.x + PG.vr.x) / 2, y: PG.horizon };
      act(true); ray(v, '#4f9dff', -200, 400);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  /* أداة المنظور: النقر يبدّل المستوى النشط، والسحب يُسقط */
  const perspTool = {
    cursor: 'crosshair',
    onDown(e) {
      if (!PG.on) PG.on = true;
      const pt = this._evPt(e);
      // ثلث أيسر → المستوى الأيسر، أوسط → الأرضية، أيمن → الأيمن
      const mid = (PG.vl.x + PG.vr.x) / 2;
      const span = Math.max(1, (PG.vr.x - PG.vl.x) / 4);
      PG.plane = pt.x < mid - span ? 'left' : pt.x > mid + span ? 'right' : 'floor';
      this._perspStart = pt;
      this.render();
      toast(`المستوى النشط: ${planeName()} — اسحب للإسقاط`, 'info');
    },
    onUp(e) {
      if (!this._perspStart) return;
      const pt = this._evPt(e);
      const d = Math.hypot(pt.x - this._perspStart.x, pt.y - this._perspStart.y);
      this._perspStart = null;
      if (d > 2 && sel(this).length) this.projectToPerspective(clamp(d / 200, 0.05, 0.9));
    },
  };

  /* ═══════════════ التسجيل ═══════════════ */
  const origInstall = P._installCore;
  P._installCore = function () {
    if (origInstall) origInstall.call(this);
    if (!this.tools || !this.tools.register) return;
    this.tools.register('width', widthTool);
    this.tools.register('perspective', perspTool);
  };

  document.addEventListener('keydown', e => {
    const ed = window.app && window.app.editor;
    if (!ed) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.altKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); ed.promptEnvelope(); }
      return;
    }
    if (!e.shiftKey) return;
    if (e.key === 'W') { e.preventDefault(); ed.setTool('width'); }
    else if (e.key === 'P') { e.preventDefault(); ed.togglePerspectiveGrid(); }
  });
})();
