/**
 * tools-guides.js — مساطر + أدلة + أدلة ذكية (نمط Illustrator)
 *
 *   المساطر (Rulers)     — شريطان بالمليمتر أعلى ويسار اللوحة، متزامنان مع التكبير/الإزاحة.
 *   الأدلة (Guides)       — اسحب من المسطرة لإنشاء خط دليل؛ اسحبه لتحريكه، أو أعده
 *                           إلى المسطرة لحذفه. الرسم يلتقط عليها. تُحفَظ في localStorage.
 *   الأدلة الذكية (Smart) — أثناء الرسم أو تحريك شكل، تظهر خطوط محاذاة قرمزية تلقائياً
 *                           إلى حواف/مراكز الأشكال الأخرى وتلتقط عليها.
 *   مربّع الزاوية         — نقره يُظهر/يُخفي المساطر والأدلة؛ نقرة مزدوجة تمسح كل الأدلة.
 *
 * كل السلوك عبر لفّ render/_snap/_onDown/_onMove/_onUp بلا مسّ منطق الرسم أو G-Code،
 * وبلا تغيير أي id/class. يقرأ التحويلات _wToS/_sToW/_bounds من المحرّر.
 */
(function guidesSystem() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;

  const RULER = 20;                 // عرض شريط المسطرة (px شاشة)
  const GUIDE_HIT = 5;              // نطاق التقاط خط الدليل (px)
  const SMART = 6;                  // عتبة الالتقاط الذكي (px)
  const GC = '#4f6ef7';            // لون الدليل
  const SMARTC = '#ff4fa3';        // لون الدليل الذكي (قرمزي)
  const KEY = 'dq_guides';

  const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
  const niceStep = minWorld => NICE.find(s => s >= minWorld) || 1000;

  /* ── الحالة على المحرّر ── */
  let seq = 1;
  const uid = () => 'g' + (seq++) + Date.now().toString(36).slice(-3);

  function ensure(ed) {
    if (ed._guides) return;
    try { ed._guides = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { ed._guides = []; }
    if (!Array.isArray(ed._guides)) ed._guides = [];
    // ترقية الأدلة القديمة: معرّف لكل دليل كي تشير إليه اللوحة بلا اعتمادٍ على
    // ترتيبٍ يتغيّر بالحذف
    ed._guides.forEach(g => { if (!g.id) g.id = uid(); });
    ed._rulersOn   = localStorage.getItem(KEY + '_on') !== '0';
    ed._guidesOn   = localStorage.getItem(KEY + '_show') !== '0';   // إظهار الأدلة مستقلّاً عن المساطر
    ed._guidesLock = localStorage.getItem(KEY + '_lock') === '1';   // قفل عامّ: تُرى وتلتقط ولا تُسحب
    ed._guidesSnap = localStorage.getItem(KEY + '_snap') !== '0';   // الالتقاط على الأدلة
  }
  const saveGuides = ed => {
    try { localStorage.setItem(KEY, JSON.stringify(ed._guides)); } catch (e) {}
    emit();
  };
  const flag = (ed, name, key, v) => {
    ed[name] = !!v;
    try { localStorage.setItem(KEY + key, v ? '1' : '0'); } catch (e) {}
    ed.render(); emit();
  };

  /* مشتركو التغيير — اللوحة تتابع الأدلة بلا استطلاعٍ دوريّ */
  const subs = new Set();
  function emit() { subs.forEach(f => { try { f(); } catch (_) {} }); }

  /** نقطة على دليلٍ مائل أقربُ ما تكون إلى p، مع مسافتها */
  function projectAngled(g, p) {
    const a = (g.ang || 0) * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const t = (p.x - g.x) * dx + (p.y - g.y) * dy;
    const qx = g.x + dx * t, qy = g.y + dy * t;
    return { x: qx, y: qy, d: Math.hypot(p.x - qx, p.y - qy) };
  }

  /* ═══════════════ الالتقاط: أدلة + محاذاة ذكية ═══════════════ */
  const origSnap = P._snap;
  P._snap = function (pt) {
    let p = origSnap.call(this, pt);            // التقاط الشبكة أولاً كما هو
    ensure(this);
    if (!this._rulersOn) { this._smart = null; return p; }

    const tolW = SMART / this.scale;            // العتبة بوحدات العالم
    let sx = null, sy = null;                    // خطوط ذكية مطابقة (عالم)

    // 1) الأدلة الثابتة لها أولوية الالتقاط — ما لم يُعطَّل الالتقاط أو تُخفَ.
    //    تُقاس المسافة من النقطة **الخام** لا من نقطة الشبكة: التقاطُ الشبكة
    //    يسبق هذا السطر، فشبكةٌ بخطوة ١٠مم كانت تدفع المؤشّر إلى ٣٠ قبل أن
    //    يُقاس بُعده عن دليلٍ في ٢٥ — فلا يفوز الدليل أبداً. والدليل خطٌّ وضعه
    //    المستخدم بيده، فهو أولى بالفوز من شبكةٍ عامّة.
    if (this._guidesSnap !== false && this._guidesOn !== false) {
      for (const g of this._guides) {
        if (g.off) continue;
        if (g.axis === 'v' && Math.abs(pt.x - g.pos) <= tolW) { p = { x: g.pos, y: p.y }; sx = g.pos; }
        else if (g.axis === 'h' && Math.abs(pt.y - g.pos) <= tolW) { p = { x: p.x, y: g.pos }; sy = g.pos; }
        else if (g.axis === 'a') {
          // المائل يُلتقط بالإسقاط العموديّ لا بمحورٍ واحد
          const q = projectAngled(g, pt);
          if (q.d <= tolW) p = { x: q.x, y: q.y };
        }
      }
    }

    // 2) المحاذاة الذكية لحواف/مراكز الأشكال الأخرى — أثناء رسم أو تحريك فقط
    const active = this._guideDrag == null &&
      (this.isDrawing || this.previewPt || (this.tool === 'select' && this._ptrDown && this.selectedIdx >= 0));
    if (active) {
      const skip = (this.tool === 'select') ? this.selectedIdx : -1;
      let bestX = tolW, bestY = tolW;
      for (let i = 0; i < this.shapes.length; i++) {
        if (i === skip) continue;
        let b; try { b = this._bounds(this.shapes[i]); } catch (e) { continue; }
        const xs = [b.minX, (b.minX + b.maxX) / 2, b.maxX];
        const ys = [b.minY, (b.minY + b.maxY) / 2, b.maxY];
        for (const x of xs) { const d = Math.abs(p.x - x); if (d <= bestX) { bestX = d; p = { x, y: p.y }; sx = x; } }
        for (const y of ys) { const d = Math.abs(p.y - y); if (d <= bestY) { bestY = d; p = { x: p.x, y }; sy = y; } }
      }
    }

    this._smart = (sx != null || sy != null) ? { sx, sy } : null;
    return p;
  };

  /* ═══════════════ الفأرة: إنشاء/تحريك/حذف الأدلة ═══════════════ */
  function region(ed, e) {
    const r = ed.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function guideAt(ed, sx, sy) {
    if (ed._guidesOn === false) return -1;
    for (let i = ed._guides.length - 1; i >= 0; i--) {
      const g = ed._guides[i];
      if (g.off || g.lock || ed._guidesLock) continue;      // المقفل يُرى ويلتقط ولا يُمسَك
      if (g.axis === 'v') { const gx = g.pos * ed.scale + ed.offset.x; if (Math.abs(sx - gx) <= GUIDE_HIT && sy > RULER) return i; }
      else if (g.axis === 'h') { const gy = ed.offset.y - g.pos * ed.scale; if (Math.abs(sy - gy) <= GUIDE_HIT && sx > RULER) return i; }
      else if (g.axis === 'a') {
        if (sx <= RULER || sy <= RULER) continue;
        const w = ed._sToW(sx, sy);
        if (projectAngled(g, w).d * ed.scale <= GUIDE_HIT) return i;
      }
    }
    return -1;
  }

  const origDown = P._onDown;
  P._onDown = function (e) {
    ensure(this);
    this._ptrDown = true;
    if (e.button === 0) {
      const { sx, sy } = region(this, e);
      const inTop = sy < RULER, inLeft = sx < RULER;

      // مربّع الزاوية: نقرة = إظهار/إخفاء — يبقى نشطاً حتى عند إخفاء المساطر
      // (وإلا لا سبيل لإعادتها) فنكشفه قبل بوابة _rulersOn
      if (inTop && inLeft) { this._cornerDown = true; return; }
    }
    if (e.button === 0 && this._rulersOn) {
      const { sx, sy } = region(this, e);
      const inTop = sy < RULER, inLeft = sx < RULER;

      // من داخل المسطرة: أنشئ دليلاً جديداً واسحبه
      if (inTop) { const w = this._sToW(sx, sy); this._guideDrag = { axis: 'h', pos: w.y, isNew: true }; this.canvas.style.cursor = 'row-resize'; return; }
      if (inLeft) { const w = this._sToW(sx, sy); this._guideDrag = { axis: 'v', pos: w.x, isNew: true }; this.canvas.style.cursor = 'col-resize'; return; }

      // على دليل قائم: امسكه لتحريكه/حذفه
      const hit = guideAt(this, sx, sy);
      if (hit >= 0) {
        const g = this._guides[hit];
        this._guideDrag = { axis: g.axis, pos: g.pos, idx: hit };
        this.canvas.style.cursor = g.axis === 'v' ? 'col-resize' : (g.axis === 'h' ? 'row-resize' : 'move');
        return;
      }
    }
    return origDown.call(this, e);
  };

  const origMove = P._onMove;
  P._onMove = function (e) {
    if (this._guideDrag) {
      const { sx, sy } = region(this, e);
      const w = this._snap(this._sToW(sx, sy));
      const d = this._guideDrag;
      if (d.axis === 'a') {
        d.x = w.x; d.y = w.y;
        d.overRuler = sx < RULER || sy < RULER;
        if (d.idx != null) { this._guides[d.idx].x = w.x; this._guides[d.idx].y = w.y; }
      } else {
        d.pos = d.axis === 'v' ? w.x : w.y;
        d.overRuler = d.axis === 'h' ? (sy < RULER) : (sx < RULER);
        if (d.idx != null) this._guides[d.idx].pos = d.pos;
      }
      this._smart = null;
      this.render();
      return;
    }
    // تلميح المؤشر فوق مسطرة أو دليل
    if (this._rulersOn && !this._ptrDown) {
      const { sx, sy } = region(this, e);
      const overGuide = guideAt(this, sx, sy) >= 0;
      const inRuler = sy < RULER || sx < RULER;
      if (overGuide || inRuler) { origMove.call(this, e); return; }
    }
    return origMove.call(this, e);
  };

  const origUp = P._onUp;
  P._onUp = function (e) {
    this._ptrDown = false;
    if (this._cornerDown) {
      this._cornerDown = false;
      const now = Date.now();
      if (this._cornerLast && now - this._cornerLast < 350) {
        // نقر مزدوج: امسح كل الأدلة — وألغِ قلب الإظهار الذي أحدثته نقرة هذا الزوج الأولى
        this._guides = []; saveGuides(this);
        this._rulersOn = !this._rulersOn; localStorage.setItem(KEY + '_on', this._rulersOn ? '1' : '0');
      } else {
        this._rulersOn = !this._rulersOn; localStorage.setItem(KEY + '_on', this._rulersOn ? '1' : '0');
      }
      this._cornerLast = now;
      this.canvas.style.cursor = '';
      this.render();
      return;
    }
    if (this._guideDrag) {
      const d = this._guideDrag; this._guideDrag = null; this.canvas.style.cursor = '';
      // نحسب overRuler من حدث الإفلات مباشرة — مستمع الحركة مُخنّق بـrAF فقد يتأخّر
      const { sx, sy } = region(this, e);
      const overRuler = d.axis === 'a' ? (sx < RULER || sy < RULER)
                      : d.axis === 'h' ? (sy < RULER) : (sx < RULER);
      const w = this._snap(this._sToW(sx, sy));
      const pos = d.axis === 'v' ? w.x : w.y;
      if (d.idx != null) {
        if (overRuler) this._guides.splice(d.idx, 1);   // أُعيد إلى المسطرة → حذف
        else if (d.axis === 'a') { this._guides[d.idx].x = w.x; this._guides[d.idx].y = w.y; }
        else this._guides[d.idx].pos = pos;
      } else if (d.isNew && !overRuler) {
        this._guides.push({ id: uid(), axis: d.axis, pos });   // دليل جديد ثُبّت
      }
      saveGuides(this);
      this.render();
      return;
    }
    return origUp.call(this, e);
  };

  /* ═══════════════ العرض: أدلة + خطوط ذكية + مساطر ═══════════════ */
  function drawRulers(ed) {
    const { ctx, canvas } = ed, W = canvas.width, H = canvas.height;
    const t = ed._canvasTheme || {};
    // الأرقام كانت تُرسم بـt.label وهو #30363d فوق شريطٍ #161b22 — تباينٌ ١٫٤:١،
    // أي رقمٌ موجود ولا يُقرأ. المسطرة أداة قياس، فأرقامها بلون النصّ الكامل
    // (تباين ~١١:١) وبخطٍّ أعرض، والعلامات الصغرى وحدها هي التي تخفت.
    const band  = t.rulerBand  || '#171d26';
    const txt   = t.rulerText  || '#c9d1d9';
    const major = t.rulerTick  || '#8b949e';
    const minorC = t.rulerMinor || '#4a525d';
    const edge  = t.axis || '#30363d';

    ctx.save();
    ctx.textBaseline = 'middle';

    // خلفية الشريطين
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, W, RULER);
    ctx.fillRect(0, 0, RULER, H);
    // حافّة تفصل الشريط عن اللوحة
    ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(0, RULER + 0.5); ctx.lineTo(W, RULER + 0.5);
    ctx.moveTo(RULER + 0.5, 0); ctx.lineTo(RULER + 0.5, H);
    ctx.stroke();

    const step = niceStep(60 / ed.scale);       // خطوة تعطي ~60px بين التسميات
    const minor = step / 5;
    const isMajor = v => Math.abs(v / step - Math.round(v / step)) < 1e-6;

    const x0 = ed._sToW(RULER, 0).x, x1 = ed._sToW(W, 0).x;
    const yTop = ed._sToW(0, RULER).y, yBot = ed._sToW(0, H).y;   // yTop > yBot (العالم صاعد)

    /* العلامات في مسارين: الصغرى خافتة والكبرى واضحة — الخلط بينهما في مسارٍ
       واحد كان يفرض لوناً واحداً على الاثنتين فيضيع التدرّج */
    const ticks = (isMinor) => {
      ctx.strokeStyle = isMinor ? minorC : major;
      ctx.lineWidth = isMinor ? 1 : 1.4;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) {
        if (isMajor(x) === isMinor) continue;
        const sx = Math.round(x * ed.scale + ed.offset.x) + 0.5;
        ctx.moveTo(sx, RULER); ctx.lineTo(sx, isMinor ? RULER - 4 : RULER - 8);
      }
      for (let y = Math.ceil(yBot / minor) * minor; y <= yTop; y += minor) {
        if (isMajor(y) === isMinor) continue;
        const sy = Math.round(ed.offset.y - y * ed.scale) + 0.5;
        ctx.moveTo(RULER, sy); ctx.lineTo(isMinor ? RULER - 4 : RULER - 8, sy);
      }
      ctx.stroke();
    };
    ticks(true); ticks(false);

    // الأرقام
    ctx.fillStyle = txt;
    ctx.font = '700 10px ui-monospace, "Cascadia Mono", Consolas, monospace';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      ctx.fillText(String(Math.round(x)), Math.round(x * ed.scale + ed.offset.x) + 3, RULER - 12);
    }
    for (let y = Math.ceil(yBot / step) * step; y <= yTop; y += step) {
      ctx.save();
      ctx.translate(RULER - 12, Math.round(ed.offset.y - y * ed.scale));
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(y)), 3, 0);
      ctx.restore();
    }

    // مربّع الزاوية
    ctx.fillStyle = band; ctx.fillRect(0, 0, RULER, RULER);
    ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, RULER, RULER);
    ctx.fillStyle = major;
    ctx.font = '700 8px ui-monospace, monospace';
    ctx.fillText('mm', 2, RULER / 2);
    ctx.restore();
  }

  /** يرسم خطّ دليلٍ واحد في مساره الحاليّ (بلا beginPath/stroke) */
  function guidePath(ed, g, W, H) {
    const { ctx } = ed;
    if (g.axis === 'v') {
      const sx = Math.round(g.pos * ed.scale + ed.offset.x) + 0.5;
      ctx.moveTo(sx, RULER); ctx.lineTo(sx, H);
    } else if (g.axis === 'h') {
      const sy = Math.round(ed.offset.y - g.pos * ed.scale) + 0.5;
      ctx.moveTo(RULER, sy); ctx.lineTo(W, sy);
    } else {
      // المائل يُمدّ إلى ما بعد حدود اللوحة في الاتجاهين — لا قصّ بالمسطرة
      const a = (g.ang || 0) * Math.PI / 180;
      const x0 = g.x * ed.scale + ed.offset.x, y0 = ed.offset.y - g.y * ed.scale;
      const dx = Math.cos(a), dy = -Math.sin(a), L = W + H;
      ctx.moveTo(x0 - dx * L, y0 - dy * L); ctx.lineTo(x0 + dx * L, y0 + dy * L);
    }
  }

  function drawGuides(ed) {
    const { ctx, canvas } = ed, W = canvas.width, H = canvas.height;
    if (ed._guidesOn === false) return;
    ctx.save();
    ctx.lineWidth = 1;
    for (const g of ed._guides) {
      if (g.off) continue;
      ctx.strokeStyle = g.color || GC;
      // المقفل مُنقَّط: علامةٌ بصرية على أنّه لا يُمسَك بالفأرة
      ctx.setLineDash(g.lock || ed._guidesLock ? [2, 3] : []);
      ctx.beginPath(); guidePath(ed, g, W, H); ctx.stroke();
    }
    ctx.setLineDash([]);

    // الدليل المُبرَز من اللوحة — يومض عريضاً ليُعرَف أيّهم هو
    if (ed._guideHi) {
      const g = ed._guides.find(x => x.id === ed._guideHi);
      if (g) {
        ctx.strokeStyle = '#ffd33d'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.9;
        ctx.beginPath(); guidePath(ed, g, W, H); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 1;
      }
    }

    // معاينة الدليل الجاري سحبه
    const d = ed._guideDrag;
    if (d) {
      ctx.strokeStyle = d.overRuler ? '#f85149' : GC;
      ctx.setLineDash([5, 4]); ctx.beginPath();
      guidePath(ed, d.axis === 'a' ? d : { axis: d.axis, pos: d.pos }, W, H);
      ctx.stroke(); ctx.setLineDash([]);
      // قراءة الموضع
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 10px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      const label = d.axis === 'a' ? `${d.x.toFixed(1)} , ${d.y.toFixed(1)}` : d.pos.toFixed(1);
      let lx, ly;
      if (d.axis === 'v') { lx = d.pos * ed.scale + ed.offset.x + 5; ly = RULER + 12; }
      else if (d.axis === 'h') { lx = RULER + 5; ly = ed.offset.y - d.pos * ed.scale - 8; }
      else { lx = d.x * ed.scale + ed.offset.x + 6; ly = ed.offset.y - d.y * ed.scale - 8; }
      // خلفية تحت القراءة: الرقم فوق رسمٍ مزدحم كان يذوب في الأشكال
      const w = ctx.measureText(label).width;
      ctx.fillStyle = d.overRuler ? '#f85149' : GC;
      ctx.fillRect(lx - 3, ly - 8, w + 6, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, lx, ly);
    }
    ctx.restore();
  }

  function drawSmart(ed) {
    const s = ed._smart; if (!s) return;
    const { ctx, canvas } = ed, W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.strokeStyle = SMARTC; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    if (s.sx != null) { const sx = s.sx * ed.scale + ed.offset.x; ctx.beginPath(); ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, H); ctx.stroke(); }
    if (s.sy != null) { const sy = ed.offset.y - s.sy * ed.scale; ctx.beginPath(); ctx.moveTo(0, sy + 0.5); ctx.lineTo(W, sy + 0.5); ctx.stroke(); }
    ctx.restore();
  }

  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    ensure(this);
    if (!this.ctx) return;
    if (this._rulersOn) { drawSmart(this); drawGuides(this); drawRulers(this); }
    else drawCornerHint(this);   // علامة صغيرة لإعادة إظهار المساطر
  };

  function drawCornerHint(ed) {
    const { ctx } = ed, t = ed._canvasTheme || {};
    ctx.save();
    ctx.fillStyle = t.rulerBand || '#171d26';
    ctx.strokeStyle = t.axis || '#30363d';
    ctx.fillRect(0, 0, 14, 14); ctx.strokeRect(0.5, 0.5, 13, 13);
    // كانت بلون تسميات الشبكة الخافت فلا تكاد تُلمَح — وهي المدخل الوحيد لإعادة
    // إظهار المساطر بعد إخفائها
    ctx.strokeStyle = t.rulerTick || '#8b949e'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(4, 10); ctx.lineTo(10, 10); ctx.stroke();   // زاوية مسطرة مصغّرة
    ctx.restore();
  }

  /* ═══════════════ الواجهة العامّة — اللوحة عرضٌ لا محرّك ═══════════════ */

  const E = () => {
    const e = window.app && window.app.editor;
    if (e) ensure(e);
    return e || null;
  };
  const done = e => { saveGuides(e); e.render(); };

  window.DQGuides = {
    /** نسخة للقراءة من قائمة الأدلة */
    list() { const e = E(); return e ? e._guides.map(g => Object.assign({}, g)) : []; },

    /** يضيف دليلاً: {axis:'v'|'h', pos} أو {axis:'a', x, y, ang} */
    add(g) {
      const e = E(); if (!e || !g) return null;
      const n = Object.assign({ id: uid() }, g);
      if (n.axis === 'a') { n.x = +n.x || 0; n.y = +n.y || 0; n.ang = +n.ang || 0; }
      else { n.pos = +n.pos || 0; }
      e._guides.push(n); done(e);
      return n.id;
    },

    /** يضيف عدّة أدلة دفعةً واحدة (حفظٌ ورسمٌ مرّة واحدة) */
    addMany(arr) {
      const e = E(); if (!e || !Array.isArray(arr) || !arr.length) return 0;
      arr.forEach(g => e._guides.push(Object.assign({ id: uid() }, g)));
      done(e);
      return arr.length;
    },

    update(id, patch) {
      const e = E(); if (!e) return false;
      const g = e._guides.find(x => x.id === id);
      if (!g) return false;
      Object.assign(g, patch); done(e);
      return true;
    },

    remove(id) {
      const e = E(); if (!e) return false;
      const i = e._guides.findIndex(x => x.id === id);
      if (i < 0) return false;
      e._guides.splice(i, 1); done(e);
      return true;
    },

    clear() { const e = E(); if (!e) return 0; const n = e._guides.length; e._guides = []; done(e); return n; },

    /** إبراز مؤقّت لدليلٍ عند المرور على صفّه في اللوحة */
    highlight(id) { const e = E(); if (!e) return; e._guideHi = id || null; e.render(); },

    flags() {
      const e = E();
      return e ? { rulers: !!e._rulersOn, show: e._guidesOn !== false,
                   lock: !!e._guidesLock, snap: e._guidesSnap !== false } : null;
    },
    setRulers(v) { const e = E(); if (e) flag(e, '_rulersOn', '_on', v); },
    setShow(v)   { const e = E(); if (e) flag(e, '_guidesOn', '_show', v); },
    setLock(v)   { const e = E(); if (e) flag(e, '_guidesLock', '_lock', v); },
    setSnap(v)   { const e = E(); if (e) flag(e, '_guidesSnap', '_snap', v); },

    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    RULER,
  };
})();
