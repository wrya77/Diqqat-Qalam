/**
 * tools-illustrator-fx.js — تلوين مباشر · رموز ورشّاش · فسيفساء · إعادة تلوين
 *                          · شبكة تدرّج · بثق ثلاثي الأبعاد · محرّر أنماط
 *
 * إعادة تفسير هذه الأدوات لسياق CNC — فالتطبيق يقطع ولا يطبع:
 *   التلوين المباشر  → يحدّد «المناطق» المحاطة بمسارات متقاطعة ويحوّلها أشكالاً
 *                      مستقلة قابلة للقطع (وهي الفائدة الحقيقية للأداة هنا).
 *   البثق ثلاثي الأبعاد → يولّد كفافات بأعماق متدرّجة: نحت ٢.٥D فعليّ، لا مجرّد عرض.
 *   الفسيفساء        → تُنتج شبكة جيوب بعمق يتناسب مع سطوع كل خلية (نقش نصف‑ظليّ).
 *   إعادة التلوين    → تعيد إسناد الطبقات والأعماق دفعةً واحدة.
 *
 * لا يمسّ منطق G-Code في shared/ ولا أي id/class.
 */
(function illustratorFX() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };
  const sel = ed => (ed._selIndices ? ed._selIndices() : []);
  const PB = () => (typeof DQ !== 'undefined' && DQ.PolyBoolean) || (window.DQ && window.DQ.PolyBoolean) || null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ═══════════════ ١) التلوين المباشر (Live Paint) ═══════════════ */

  /**
   * يبني «مناطق» من مسارات متقاطعة: كل منطقة مغلقة يحدّها تقاطع الخطوط
   * تصير شكلاً مستقلاً. الطريقة: تقسيم متبادل عبر PolyBoolean — نفس منطق
   * pfDivide لكن على المحدد كلّه وبإسناد عمق مستقلّ لكل منطقة.
   */
  P.livePaintBuild = function () {
    const B = PB(); if (!B) return toast('محرّك العمليات غير مُحمَّل', 'error');
    const idx = sel(this).slice().sort((a, b) => a - b);
    if (idx.length < 2) return toast('حدّد مسارين متقاطعين أو أكثر', 'warn');
    if (!this.pfDivide) return toast('وحدة مكتشف المسارات غير مُحمَّلة', 'error');
    const before = this.shapes.length;
    this.pfDivide();
    const made = this.shapes.length - (before - idx.length);
    if (made > 0) {
      // كل منطقة تبدأ بعمق التطبيق الافتراضي وتُسمّى لتسهيل الإسناد
      for (let i = this.shapes.length - made; i < this.shapes.length; i++) {
        this.shapes[i].name = `منطقة ${i - (this.shapes.length - made) + 1}`;
        this.shapes[i].__livePaint = true;
      }
      this.render();
      toast(`✓ تلوين مباشر — ${made} منطقة مستقلة`, 'success');
    }
  };

  /** أداة دلو التلوين: النقر داخل منطقة يُسند إليها عمقاً/طبقة */
  const paintBucket = {
    cursor: 'copy',
    onDown(e) {
      const pt = this._evPt(e);
      const i = this._hitTest ? this._hitTest(pt) : -1;
      if (i < 0) return toast('انقر داخل منطقة', 'warn');
      const d = window.DQPaintDepth;
      if (d === undefined) return toast('اضبط العمق من «إعادة التلوين» أولاً', 'warn');
      this._saveHistory();
      this.shapes[i].maxDepth = d;
      this.render();
      toast(`عمق ${d}mm ← ${this.shapes[i].name || 'الشكل'}`, 'success');
    },
  };

  /* ═══════════════ ٢) الرموز ورشّاشها (Symbols + Sprayer) ═══════════════ */

  const SYM_KEY = 'dq_symbols';
  function loadSyms() {
    try { return JSON.parse(localStorage.getItem(SYM_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveSyms(a) { try { localStorage.setItem(SYM_KEY, JSON.stringify(a)); } catch (_) {} }

  /** يحفظ التحديد رمزاً قابلاً لإعادة الاستعمال */
  P.defineSymbol = async function (name) {
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
    if (!name && window.DQPrompt) {
      const r = await window.DQPrompt('رمز جديد', [{ key: 'n', label: 'الاسم', type: 'text', value: 'رمز ' + (loadSyms().length + 1) }]);
      if (!r) return;
      name = r.n;
    }
    // نطبّع الرمز حول أصله ليُلصق في أي مكان
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    idx.forEach(i => { const b = this._bounds(this.shapes[i]); if (b) {
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY); } });
    if (!isFinite(minX)) return toast('تعذّر قياس التحديد', 'warn');
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const parts = idx.map(i => JSON.parse(JSON.stringify(this.shapes[i])));
    parts.forEach(s => shiftShape(s, -cx, -cy));
    const syms = loadSyms();
    syms.push({ name: name || 'رمز', w: maxX - minX, h: maxY - minY, parts });
    saveSyms(syms);
    toast(`✓ حُفظ الرمز «${name}» (${syms.length} في المكتبة)`, 'success');
    window.dispatchEvent(new CustomEvent('dq:symbols-changed'));
  };

  P.listSymbols = () => loadSyms().map((s, i) => ({ i, name: s.name, w: s.w, h: s.h }));

  P.deleteSymbol = function (i) {
    const s = loadSyms(); if (!s[i]) return;
    const n = s[i].name; s.splice(i, 1); saveSyms(s);
    toast(`حُذف الرمز «${n}»`, 'info');
    window.dispatchEvent(new CustomEvent('dq:symbols-changed'));
  };

  /** يدرج نسخة من رمز عند نقطة، بمقياس ودوران اختياريين */
  P.placeSymbol = function (i, at, scale, rot) {
    const sym = loadSyms()[i];
    if (!sym) return toast('رمز غير موجود', 'error');
    const k = scale || 1, a = rot || 0;
    const cos = Math.cos(a), sin = Math.sin(a);
    const made = JSON.parse(JSON.stringify(sym.parts));
    made.forEach(s => {
      mapShape(s, (x, y) => ({ x: (x * cos - y * sin) * k + at.x, y: (x * sin + y * cos) * k + at.y }));
      s.__symbol = i;
    });
    made.forEach(s => this.shapes.push(s));
    return made.length;
  };

  function shiftShape(s, dx, dy) { mapShape(s, (x, y) => ({ x: x + dx, y: y + dy })); }

  /** يمرّر دالّة على كل إحداثيّ في الشكل — يُعيد استعمال DQEachPoint إن وُجد */
  function mapShape(s, fn) {
    const M = p => { const q = fn(p.x, p.y); p.x = q.x; p.y = q.y; };
    if (s.type === 'text' && Array.isArray(s.strokes)) { s.strokes.forEach(st => st.forEach(M)); return; }
    if (s.type === 'compound' && s.contours) { s.contours.forEach(c => c.forEach(M)); return; }
    if (s.points) { s.points.forEach(M); return; }
    if (s.type === 'line') { const a = fn(s.x1, s.y1), b = fn(s.x2, s.y2); s.x1 = a.x; s.y1 = a.y; s.x2 = b.x; s.y2 = b.y; return; }
    if (s.type === 'rect') { const a = fn(s.x, s.y); s.x = a.x; s.y = a.y; return; }
    if (s.type === 'circle' || s.type === 'ellipse' || s.type === 'polygon' || s.type === 'star') {
      const a = fn(s.cx || 0, s.cy || 0); s.cx = a.x; s.cy = a.y;
    }
  }
  window.DQMapShape = mapShape;

  /** رشّاش الرموز: السحب يبعثر نسخاً بكثافة وتنويع عشوائيَّين */
  const sprayer = {
    cursor: 'crosshair',
    onDown(e) {
      const syms = loadSyms();
      if (!syms.length) return toast('عرِّف رمزاً أولاً («رمز جديد» من لوحة الرموز)', 'warn');
      this._saveHistory();
      this._sprayLast = null;
      this._sprayN = 0;
      this.isDrawing = true;
      sprayAt.call(this, this._evPt(e));
    },
    onMove(e) {
      if (!this.isDrawing || e.buttons !== 1) return;
      const pt = this._evPt(e);
      const gap = (window.DQSpraySpacing || 8);
      if (this._sprayLast && Math.hypot(pt.x - this._sprayLast.x, pt.y - this._sprayLast.y) < gap) return;
      sprayAt.call(this, pt);
    },
    onUp() {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      if (this._sprayN) toast(`✓ رُشّ ${this._sprayN} نسخة`, 'success');
      this._sprayN = 0;
    },
  };
  function sprayAt(pt) {
    const which = window.DQSprayIndex || 0;
    const vary = window.DQSprayVary === undefined ? 0.3 : window.DQSprayVary;
    const k = 1 + (Math.random() * 2 - 1) * vary;
    const rot = window.DQSprayRotate ? Math.random() * Math.PI * 2 : 0;
    this.placeSymbol(which, pt, k, rot);
    this._sprayLast = pt;
    this._sprayN = (this._sprayN || 0) + 1;
    this.render();
  }

  /* ═══════════════ ٣) فسيفساء الكائنات (Object Mosaic) ═══════════════ */

  /**
   * يقسّم الصندوق المحيط بالتحديد إلى شبكة، ويُبقي الخلايا التي يمرّ بها
   * الشكل — فتصير نقشاً بيكسلياً قابلاً للقطع. مع خيار عمق متدرّج.
   */
  P.objectMosaic = async function (opts) {
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
    let o = opts;
    if (!o && window.DQPrompt) {
      const r = await window.DQPrompt('فسيفساء الكائنات', [
        { key: 'cols', label: 'أعمدة', value: 20, min: 2, max: 200 },
        { key: 'rows', label: 'صفوف', value: 20, min: 2, max: 200 },
        { key: 'gap',  label: 'فجوة ٪', value: 10, min: 0, max: 50 },
        { key: 'depth', label: 'عمق متدرّج', type: 'check', value: false },
      ]);
      if (!r) return;
      o = { cols: +r.cols, rows: +r.rows, gap: +r.gap / 100, depth: !!r.depth };
    }
    o = o || { cols: 20, rows: 20, gap: 0.1, depth: false };
    if (o.depth) guardDepth(5);        // أقصى ما تولّده صيغة العمق أدناه

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    idx.forEach(i => { const b = this._bounds(this.shapes[i]); if (b) {
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY); } });
    if (!isFinite(minX)) return toast('تعذّر قياس التحديد', 'warn');

    const cw = (maxX - minX) / o.cols, ch = (maxY - minY) / o.rows;
    const rings = idx.map(i => this._shapeToContours(this.shapes[i])).filter(Boolean).flat();
    if (!rings.length) return toast('تعذّر: الأشكال مفتوحة', 'warn');

    const cells = [];
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        const cx = minX + (c + 0.5) * cw, cy = minY + (r + 0.5) * ch;
        if (!rings.some(ring => inside({ x: cx, y: cy }, ring))) continue;
        const g = o.gap / 2;
        cells.push({
          type: 'rect',
          x: minX + c * cw + cw * g, y: minY + r * ch + ch * g,
          w: cw * (1 - o.gap), h: ch * (1 - o.gap),
          name: `خلية ${r + 1}·${c + 1}`,
          // العمق يتناسب مع البُعد عن المركز: نقش نصف‑ظليّ
          maxDepth: o.depth ? +(1 + 4 * (1 - Math.hypot((cx - (minX + maxX) / 2) / ((maxX - minX) / 2 || 1),
                                                        (cy - (minY + maxY) / 2) / ((maxY - minY) / 2 || 1)))).toFixed(2)
                            : undefined,
        });
      }
    }
    if (!cells.length) return toast('لا خلايا داخل الشكل — جرّب دقّة أعلى', 'warn');
    this._saveHistory();
    idx.slice().sort((a, b) => b - a).forEach(i => this.shapes.splice(i, 1));
    const first = this.shapes.length;
    cells.forEach(c => this.shapes.push(c));
    if (this.msel) { this.msel.clear(); for (let i = first; i < this.shapes.length; i++) this.msel.add(i); }
    this.selectedIdx = this.shapes.length - 1;
    this.render(); this._updateStatus?.();
    toast(`✓ فسيفساء — ${cells.length} خلية`, 'success');
  };

  function inside(pt, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }

  /**
   * حارس العمق — `maxDepth` على الشكل سقفٌ يقصّه المولّد عند عمق المشروع
   * الكلّي (GCodeGenerator: `Math.min(shape.maxDepth, config.totalDepth)`).
   * فطلبُ ٨mm في مشروع عمقه ٢mm يُنفَّذ صامتاً عند ٢mm — يبدو كأن الأداة
   * لم تعمل. نعرض العمق الكلّي هنا ونعرض رفعه بدل الفشل الصامت.
   */
  function guardDepth(want) {
    const inp = document.getElementById('total-depth');
    const total = inp ? +inp.value : 5;
    if (!(want > total)) return true;
    if (inp) {
      inp.value = String(want);
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      toast(`رُفع عمق المشروع من ${total} إلى ${want}mm — وإلّا قُصَّت الأعماق عنده`, 'warn');
      return true;
    }
    toast(`العمق المطلوب ${want}mm أكبر من عمق المشروع ${total}mm — ارفعه من الإعدادات`, 'warn');
    return true;
  }

  /* ═══════════════ ٤) البثق ثلاثي الأبعاد (3D Extrude) ═══════════════ */

  /**
   * بثق ٢.٥D حقيقي: يولّد كفافات متتالية مُزاحة إلى الداخل، لكل منها عمق أكبر —
   * فينحت المجسّم على مراحل بدل رسم وهم ثلاثي الأبعاد.
   * الشطب (bevel) يتحكّم في مقدار الإزاحة بين المستويات.
   */
  P.extrude3D = async function (opts) {
    const B = PB(); if (!B) return toast('محرّك العمليات غير مُحمَّل', 'error');
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً مغلقاً أولاً', 'warn');
    let o = opts;
    if (!o && window.DQPrompt) {
      const r = await window.DQPrompt('بثق ثلاثي الأبعاد', [
        { key: 'depth', label: 'العمق الكلّي mm', value: 6, min: 0.5, max: 100, step: 0.5 },
        { key: 'steps', label: 'عدد المستويات', value: 5, min: 2, max: 40 },
        { key: 'bevel', label: 'الشطب mm', value: 1, min: 0, max: 20, step: 0.25 },
      ]);
      if (!r) return;
      o = { depth: +r.depth, steps: +r.steps, bevel: +r.bevel };
    }
    o = o || { depth: 6, steps: 5, bevel: 1 };
    guardDepth(o.depth);

    const made = [];
    for (const i of idx) {
      const c = this._shapeToContours(this.shapes[i]);
      if (!c || !c.length) continue;
      const src = this.shapes[i];
      for (let k = 0; k < o.steps; k++) {
        const inset = (o.bevel * k) / Math.max(1, o.steps - 1) * (o.steps - 1) / Math.max(1, o.steps - 1);
        const off = o.bevel * k;
        const rings = off > 0 ? insetRings(c, off) : c;
        if (!rings.length) break;
        made.push({
          type: 'compound', contours: rings.map(r => r.map(p => ({ x: p.x, y: p.y }))),
          layer: src.layer, stroke: src.stroke, sw: src.sw,
          maxDepth: +(o.depth * (k + 1) / o.steps).toFixed(2),
          name: `مستوى ${k + 1}/${o.steps} — ${(o.depth * (k + 1) / o.steps).toFixed(1)}mm`,
        });
      }
    }
    if (!made.length) return toast('تعذّر البثق على هذه الأشكال', 'warn');
    this._saveHistory();
    idx.slice().sort((a, b) => b - a).forEach(i => this.shapes.splice(i, 1));
    const first = this.shapes.length;
    made.forEach(m => this.shapes.push(m));
    if (this.msel) { this.msel.clear(); for (let i = first; i < this.shapes.length; i++) this.msel.add(i); }
    this.selectedIdx = this.shapes.length - 1;
    this.render(); this._updateStatus?.();
    toast(`✓ بثق ${o.depth}mm على ${o.steps} مستويات (${made.length} كفاف)`, 'success');
  };

  /** إزاحة حلقات إلى الداخل بمقدار d — بإزاحة كل رأس على منصّف زاويته */
  function insetRings(rings, d) {
    const out = [];
    for (const ring of rings) {
      const n = ring.length;
      if (n < 3) continue;
      const moved = [];
      for (let i = 0; i < n; i++) {
        const p = ring[i], a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
        const n1 = norm(p.x - a.x, p.y - a.y), n2 = norm(b.x - p.x, b.y - p.y);
        // منصّف الاتجاهين العموديّين على الضلعين
        let bx = -n1.y - n2.y, by = n1.x + n2.x;
        const L = Math.hypot(bx, by) || 1;
        bx /= L; by /= L;
        moved.push({ x: p.x + bx * d, y: p.y + by * d });
      }
      // نتجاهل الحلقة إن انقلب اتجاهها (تجاوزت الإزاحة نصف عرضها)
      if (sign(moved) === sign(ring) && Math.abs(shoelace(moved)) > 1e-6) out.push(moved);
    }
    return out;
  }
  const norm = (x, y) => { const L = Math.hypot(x, y) || 1; return { x: x / L, y: y / L }; };
  function shoelace(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
  const sign = r => shoelace(r) >= 0 ? 1 : -1;

  /* ═══════════════ ٥) إعادة تلوين العمل (Recolor Artwork) ═══════════════ */

  /**
   * في CNC «اللون» = الطبقة والعمق. تُظهر هذه الأداة كل القيم المستعملة
   * في التحديد وتتيح إعادة إسنادها دفعةً واحدة.
   */
  P.recolorArtwork = async function () {
    const idx = sel(this).length ? sel(this) : this.shapes.map((_, i) => i);
    if (!idx.length) return toast('لا أشكال', 'warn');
    const depths = new Map();
    idx.forEach(i => { const d = this.shapes[i].maxDepth; depths.set(d, (depths.get(d) || 0) + 1); });
    const list = [...depths.entries()].map(([d, n]) => `${d === undefined ? 'الافتراضي' : d + 'mm'} (${n})`).join('، ');
    if (!window.DQPrompt) return toast('الأعماق المستعملة: ' + list, 'info');
    const r = await window.DQPrompt('إعادة تلوين العمل', [
      { key: 'mode', label: 'الطريقة', type: 'select', value: 'set', options: [
        { value: 'set',    label: 'عمق موحّد للجميع' },
        { value: 'ramp',   label: 'تدرّج من الأول للأخير' },
        { value: 'byArea', label: 'حسب المساحة (الأكبر أعمق)' },
        { value: 'clear',  label: 'إعادة الجميع للافتراضي' },
      ] },
      { key: 'a', label: 'العمق / البداية mm', value: 3, min: 0.1, max: 100, step: 0.5 },
      { key: 'b', label: 'النهاية mm (للتدرّج)', value: 10, min: 0.1, max: 100, step: 0.5 },
    ]);
    if (!r) return;
    this._saveHistory();
    const a = +r.a, b = +r.b;
    if (r.mode === 'clear') idx.forEach(i => delete this.shapes[i].maxDepth);
    else if (r.mode === 'set') idx.forEach(i => this.shapes[i].maxDepth = a);
    else if (r.mode === 'ramp') idx.forEach((i, k) => {
      this.shapes[i].maxDepth = +(a + (b - a) * (k / Math.max(1, idx.length - 1))).toFixed(2);
    });
    else {
      const areas = idx.map(i => { const bb = this._bounds(this.shapes[i]); return bb ? (bb.maxX - bb.minX) * (bb.maxY - bb.minY) : 0; });
      const mx = Math.max(...areas) || 1;
      idx.forEach((i, k) => this.shapes[i].maxDepth = +(a + (b - a) * (areas[k] / mx)).toFixed(2));
    }
    this.render(); this._updateStatus?.();
    toast(`✓ أُعيد إسناد العمق لـ${idx.length} شكلاً`, 'success');
  };

  /* ═══════════════ ٦) شبكة التدرّج (Gradient Mesh) ═══════════════ */

  /**
   * شبكة عقد داخل الشكل، لكلّ عقدة «قيمة» تُترجَم إلى عمق. تُنتج نحتاً
   * متدرّج العمق — وهو المعنى العمليّ لشبكة التدرّج في آلة CNC.
   */
  P.gradientMesh = async function (opts) {
    const idx = sel(this);
    if (idx.length !== 1) return toast('حدّد شكلاً واحداً مغلقاً', 'warn');
    let o = opts;
    if (!o && window.DQPrompt) {
      const r = await window.DQPrompt('شبكة التدرّج', [
        { key: 'rows', label: 'صفوف', value: 6, min: 2, max: 40 },
        { key: 'cols', label: 'أعمدة', value: 6, min: 2, max: 40 },
        { key: 'min', label: 'أدنى عمق mm', value: 1, min: 0.1, max: 50, step: 0.5 },
        { key: 'max', label: 'أقصى عمق mm', value: 8, min: 0.1, max: 50, step: 0.5 },
        { key: 'shape', label: 'التوزيع', type: 'select', value: 'radial', options: [
          { value: 'radial', label: 'شعاعيّ (قبّة)' },
          { value: 'linear', label: 'خطّيّ' },
          { value: 'wave',   label: 'موجيّ' },
        ] },
      ]);
      if (!r) return;
      o = { rows: +r.rows, cols: +r.cols, min: +r.min, max: +r.max, shape: r.shape };
    }
    o = o || { rows: 6, cols: 6, min: 1, max: 8, shape: 'radial' };
    guardDepth(o.max);

    const s = this.shapes[idx[0]];
    const rings = this._shapeToContours(s);
    if (!rings || !rings.length) return toast('تعذّر: الشكل مفتوح', 'warn');
    const b = this._bounds(s);
    const cw = (b.maxX - b.minX) / o.cols, ch = (b.maxY - b.minY) / o.rows;

    const cells = [];
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        const cx = b.minX + (c + 0.5) * cw, cy = b.minY + (r + 0.5) * ch;
        if (!rings.some(ring => inside({ x: cx, y: cy }, ring))) continue;
        const u = (c + 0.5) / o.cols, v = (r + 0.5) / o.rows;
        let t;
        if (o.shape === 'radial') t = 1 - clamp(Math.hypot(u - 0.5, v - 0.5) * 2, 0, 1);
        else if (o.shape === 'wave') t = (Math.sin(u * Math.PI * 3) * Math.sin(v * Math.PI * 3) + 1) / 2;
        else t = u;
        cells.push({
          type: 'rect', x: b.minX + c * cw, y: b.minY + r * ch, w: cw, h: ch,
          maxDepth: +(o.min + (o.max - o.min) * t).toFixed(2),
          name: `عقدة ${r + 1}·${c + 1}`, layer: s.layer, stroke: s.stroke, sw: s.sw,
        });
      }
    }
    if (!cells.length) return toast('لا عقد داخل الشكل', 'warn');
    this._saveHistory();
    this.shapes.splice(idx[0], 1);
    const first = this.shapes.length;
    cells.forEach(c => this.shapes.push(c));
    if (this.msel) { this.msel.clear(); for (let i = first; i < this.shapes.length; i++) this.msel.add(i); }
    this.render(); this._updateStatus?.();
    toast(`✓ شبكة تدرّج — ${cells.length} عقدة، ${o.min}→${o.max}mm`, 'success');
  };

  /* ═══════════════ ٧) محرّر الأنماط (Pattern Editor) ═══════════════ */

  /** يكرّر التحديد نمطاً متكرّراً بتباعد وإزاحة صفّية (نمط قرميد) */
  P.makePattern = async function (opts) {
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
    let o = opts;
    if (!o && window.DQPrompt) {
      const r = await window.DQPrompt('محرّر الأنماط', [
        { key: 'cols', label: 'أعمدة', value: 5, min: 1, max: 100 },
        { key: 'rows', label: 'صفوف', value: 5, min: 1, max: 100 },
        { key: 'gx', label: 'تباعد أفقي mm', value: 5, min: -500, max: 500, step: 0.5 },
        { key: 'gy', label: 'تباعد رأسي mm', value: 5, min: -500, max: 500, step: 0.5 },
        { key: 'brick', label: 'إزاحة قرميدية', type: 'check', value: false },
        { key: 'rot', label: 'دوران تراكمي °', value: 0, min: -180, max: 180 },
      ]);
      if (!r) return;
      o = { cols: +r.cols, rows: +r.rows, gx: +r.gx, gy: +r.gy, brick: !!r.brick, rot: +r.rot };
    }
    o = o || { cols: 5, rows: 5, gx: 5, gy: 5, brick: false, rot: 0 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    idx.forEach(i => { const bb = this._bounds(this.shapes[i]); if (bb) {
      minX = Math.min(minX, bb.minX); maxX = Math.max(maxX, bb.maxX);
      minY = Math.min(minY, bb.minY); maxY = Math.max(maxY, bb.maxY); } });
    if (!isFinite(minX)) return toast('تعذّر قياس التحديد', 'warn');
    const W = (maxX - minX) + o.gx, H = (maxY - minY) + o.gy;
    const src = idx.map(i => JSON.parse(JSON.stringify(this.shapes[i])));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    this._saveHistory();
    let n = 0;
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        if (r === 0 && c === 0) continue;                 // الأصل موجود
        const dx = c * W + (o.brick && r % 2 ? W / 2 : 0), dy = r * H;
        const ang = (o.rot * Math.PI / 180) * (r * o.cols + c);
        src.forEach(sh => {
          const cp = JSON.parse(JSON.stringify(sh));
          if (ang) {
            const co = Math.cos(ang), si = Math.sin(ang);
            mapShape(cp, (x, y) => {
              const px = x - cx, py = y - cy;
              return { x: cx + px * co - py * si + dx, y: cy + px * si + py * co + dy };
            });
          } else mapShape(cp, (x, y) => ({ x: x + dx, y: y + dy }));
          this.shapes.push(cp); n++;
        });
      }
    }
    this.render(); this._updateStatus?.();
    toast(`✓ نمط ${o.cols}×${o.rows} — ${n} نسخة`, 'success');
  };

  /* ═══════════════ التسجيل ═══════════════ */
  const origInstall = P._installCore;
  P._installCore = function () {
    if (origInstall) origInstall.call(this);
    if (!this.tools || !this.tools.register) return;
    this.tools.register('live-paint', paintBucket);
    this.tools.register('symbol-sprayer', sprayer);
  };

  window.DQSymbols = { load: loadSyms, save: saveSyms };
})();
