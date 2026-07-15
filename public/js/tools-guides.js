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
  function ensure(ed) {
    if (ed._guides) return;
    try { ed._guides = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { ed._guides = []; }
    if (!Array.isArray(ed._guides)) ed._guides = [];
    ed._rulersOn = localStorage.getItem(KEY + '_on') !== '0';
  }
  const saveGuides = ed => { try { localStorage.setItem(KEY, JSON.stringify(ed._guides)); } catch (e) {} };

  /* ═══════════════ الالتقاط: أدلة + محاذاة ذكية ═══════════════ */
  const origSnap = P._snap;
  P._snap = function (pt) {
    let p = origSnap.call(this, pt);            // التقاط الشبكة أولاً كما هو
    ensure(this);
    if (!this._rulersOn) { this._smart = null; return p; }

    const tolW = SMART / this.scale;            // العتبة بوحدات العالم
    let sx = null, sy = null;                    // خطوط ذكية مطابقة (عالم)

    // 1) الأدلة الثابتة لها أولوية الالتقاط
    for (const g of this._guides) {
      if (g.axis === 'v' && Math.abs(p.x - g.pos) <= tolW) { p = { x: g.pos, y: p.y }; sx = g.pos; }
      if (g.axis === 'h' && Math.abs(p.y - g.pos) <= tolW) { p = { x: p.x, y: g.pos }; sy = g.pos; }
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
    for (let i = ed._guides.length - 1; i >= 0; i--) {
      const g = ed._guides[i];
      if (g.axis === 'v') { const gx = g.pos * ed.scale + ed.offset.x; if (Math.abs(sx - gx) <= GUIDE_HIT && sy > RULER) return i; }
      else { const gy = ed.offset.y - g.pos * ed.scale; if (Math.abs(sy - gy) <= GUIDE_HIT && sx > RULER) return i; }
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
      if (hit >= 0) { const g = this._guides[hit]; this._guideDrag = { axis: g.axis, pos: g.pos, idx: hit }; this.canvas.style.cursor = g.axis === 'v' ? 'col-resize' : 'row-resize'; return; }
    }
    return origDown.call(this, e);
  };

  const origMove = P._onMove;
  P._onMove = function (e) {
    if (this._guideDrag) {
      const { sx, sy } = region(this, e);
      const w = this._snap(this._sToW(sx, sy));
      this._guideDrag.pos = this._guideDrag.axis === 'v' ? w.x : w.y;
      this._guideDrag.overRuler = this._guideDrag.axis === 'h' ? (sy < RULER) : (sx < RULER);
      // معاينة حيّة على الدليل القائم
      if (this._guideDrag.idx != null) this._guides[this._guideDrag.idx].pos = this._guideDrag.pos;
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
      const overRuler = d.axis === 'h' ? (sy < RULER) : (sx < RULER);
      const w = this._snap(this._sToW(sx, sy));
      const pos = d.axis === 'v' ? w.x : w.y;
      if (d.idx != null) {
        if (overRuler) this._guides.splice(d.idx, 1);   // أُعيد إلى المسطرة → حذف
        else this._guides[d.idx].pos = pos;
      } else if (d.isNew && !overRuler) {
        this._guides.push({ axis: d.axis, pos });        // دليل جديد ثُبّت
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
    const band = t.grid || '#161b22', line = t.axis || '#21262d', txt = t.label || '#8b949e';

    ctx.save();
    ctx.font = '9px monospace'; ctx.textBaseline = 'middle';

    // خلفية الشريطين
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, W, RULER);
    ctx.fillRect(0, 0, RULER, H);

    const step = niceStep(60 / ed.scale);       // خطوة تعطي ~60px بين التسميات
    const minor = step / 5;

    // مسطرة أفقية
    const x0 = ed._sToW(RULER, 0).x, x1 = ed._sToW(W, 0).x;
    ctx.strokeStyle = line; ctx.fillStyle = txt; ctx.beginPath();
    for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) {
      const sx = x * ed.scale + ed.offset.x;
      const major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
      ctx.moveTo(sx + 0.5, RULER); ctx.lineTo(sx + 0.5, major ? RULER - 9 : RULER - 4);
      if (major) ctx.fillText(String(Math.round(x)), sx + 2, RULER - 12);
    }
    ctx.stroke();

    // مسطرة رأسية
    const yTop = ed._sToW(0, RULER).y, yBot = ed._sToW(0, H).y;   // yTop > yBot (العالم صاعد)
    ctx.beginPath();
    for (let y = Math.ceil(yBot / minor) * minor; y <= yTop; y += minor) {
      const sy = ed.offset.y - y * ed.scale;
      const major = Math.abs(y / step - Math.round(y / step)) < 1e-6;
      ctx.moveTo(RULER, sy + 0.5); ctx.lineTo(major ? RULER - 9 : RULER - 4, sy + 0.5);
      if (major) { ctx.save(); ctx.translate(RULER - 11, sy); ctx.rotate(-Math.PI / 2); ctx.fillText(String(Math.round(y)), 2, 0); ctx.restore(); }
    }
    ctx.stroke();

    // مربّع الزاوية
    ctx.fillStyle = band; ctx.fillRect(0, 0, RULER, RULER);
    ctx.strokeStyle = line; ctx.strokeRect(0.5, 0.5, RULER - 1, RULER - 1);
    ctx.restore();
  }

  function drawGuides(ed) {
    const { ctx, canvas } = ed, W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.strokeStyle = GC; ctx.lineWidth = 1; ctx.setLineDash([]);
    for (const g of ed._guides) {
      ctx.beginPath();
      if (g.axis === 'v') { const sx = g.pos * ed.scale + ed.offset.x; ctx.moveTo(sx + 0.5, RULER); ctx.lineTo(sx + 0.5, H); }
      else { const sy = ed.offset.y - g.pos * ed.scale; ctx.moveTo(RULER, sy + 0.5); ctx.lineTo(W, sy + 0.5); }
      ctx.stroke();
    }
    // معاينة الدليل الجاري سحبه
    const d = ed._guideDrag;
    if (d) {
      ctx.strokeStyle = d.overRuler ? '#f85149' : GC;
      ctx.setLineDash([5, 4]); ctx.beginPath();
      if (d.axis === 'v') { const sx = d.pos * ed.scale + ed.offset.x; ctx.moveTo(sx + 0.5, RULER); ctx.lineTo(sx + 0.5, H); }
      else { const sy = ed.offset.y - d.pos * ed.scale; ctx.moveTo(RULER, sy + 0.5); ctx.lineTo(W, sy + 0.5); }
      ctx.stroke(); ctx.setLineDash([]);
      // قراءة الموضع
      ctx.fillStyle = GC; ctx.font = '600 10px monospace';
      if (d.axis === 'v') { const sx = d.pos * ed.scale + ed.offset.x; ctx.fillText(d.pos.toFixed(1), sx + 4, RULER + 12); }
      else { const sy = ed.offset.y - d.pos * ed.scale; ctx.fillText(d.pos.toFixed(1), RULER + 4, sy - 4); }
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
    ctx.fillStyle = t.grid || '#161b22';
    ctx.strokeStyle = t.axis || '#21262d';
    ctx.fillRect(0, 0, 14, 14); ctx.strokeRect(0.5, 0.5, 13, 13);
    ctx.strokeStyle = t.label || '#8b949e'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(4, 10); ctx.lineTo(10, 10); ctx.stroke();   // زاوية مسطرة مصغّرة
    ctx.restore();
  }
})();
