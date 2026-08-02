/**
 * tools-artboards.js — ألواح الفنّ · علامات القطع · الطباعة المبلّطة
 *                     · بحث واستبدال · السكربتات
 *
 *   ألواح الفنّ (Shift+O)
 *     مناطق رسم مستقلّة على اللوحة نفسها. لكل لوح اسم وأبعاد، ويمكن
 *     تصدير G-Code للّوح النشط وحده — وهو بالضبط ما يلزم لقطع عدّة قطع
 *     من ألواح خام مختلفة في مشروع واحد.
 *
 *   علامات القطع
 *     خطوط تسجيل عند زوايا التحديد أو اللوح — مرجع محاذاة للقطع اليدوي.
 *
 *   الطباعة المبلّطة
 *     يقسّم تصميماً أكبر من مساحة الآلة إلى بلاطات متداخلة، كلٌّ منها
 *     قابل للقطع على حدة مع علامات وصل.
 *
 *   بحث واستبدال (Ctrl+H)
 *     في نصوص المشروع وأسماء الأشكال.
 *
 *   السكربتات
 *     تشغيل JavaScript على المحرّر — أتمتة العمليات المتكرّرة.
 *
 * لا يمسّ منطق G-Code في shared/ ولا أي id/class.
 */
(function artboardTools() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };
  const sel = ed => (ed._selIndices ? ed._selIndices() : []);
  const KEY = 'dq_artboards';

  /* ═══════════════ ١) ألواح الفنّ ═══════════════ */

  function ensure(ed) {
    if (ed._artboards) return ed._artboards;
    try { ed._artboards = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { ed._artboards = null; }
    if (!Array.isArray(ed._artboards) || !ed._artboards.length) {
      // اللوح الأول يطابق مساحة العمل المعرَّفة في إعدادات الآلة
      const w = ed.workW || 300, h = ed.workH || 200;
      ed._artboards = [{ name: 'لوح ١', x: 0, y: 0, w, h }];
    }
    if (ed._abActive === undefined) ed._abActive = 0;
    return ed._artboards;
  }
  const save = ed => { try { localStorage.setItem(KEY, JSON.stringify(ed._artboards)); } catch (_) {} };

  P.listArtboards = function () { return ensure(this).map((a, i) => ({ i, ...a, active: i === this._abActive })); };

  P.addArtboard = async function (opts) {
    const A = ensure(this);
    let o = opts;
    if (!o && window.DQPrompt) {
      const last = A[A.length - 1];
      const r = await window.DQPrompt('لوح فنّ جديد', [
        { key: 'name', label: 'الاسم', type: 'text', value: `لوح ${A.length + 1}` },
        { key: 'w', label: 'العرض mm', value: last.w, min: 1, max: 5000 },
        { key: 'h', label: 'الارتفاع mm', value: last.h, min: 1, max: 5000 },
        { key: 'where', label: 'الموضع', type: 'select', value: 'right', options: [
          { value: 'right', label: 'يمين الأخير' },
          { value: 'below', label: 'أسفل الأخير' },
        ] },
      ]);
      if (!r) return;
      const gap = 10;
      o = { name: r.name, w: +r.w, h: +r.h,
            x: r.where === 'right' ? last.x + last.w + gap : last.x,
            y: r.where === 'below' ? last.y + last.h + gap : last.y };
    }
    if (!o) return;
    A.push(o); save(this);
    this._abActive = A.length - 1;
    this.render();
    toast(`✓ ${o.name} — ${o.w}×${o.h}mm`, 'success');
    window.dispatchEvent(new CustomEvent('dq:artboards-changed'));
  };

  P.deleteArtboard = function (i) {
    const A = ensure(this);
    if (A.length <= 1) return toast('لا يمكن حذف اللوح الوحيد', 'warn');
    const n = A[i] && A[i].name;
    A.splice(i, 1); save(this);
    if (this._abActive >= A.length) this._abActive = A.length - 1;
    this.render();
    toast(`حُذف ${n}`, 'info');
    window.dispatchEvent(new CustomEvent('dq:artboards-changed'));
  };

  P.setActiveArtboard = function (i) {
    const A = ensure(this);
    if (!A[i]) return;
    this._abActive = i;
    this.render();
    toast(`اللوح النشط: ${A[i].name}`, 'info');
    window.dispatchEvent(new CustomEvent('dq:artboards-changed'));
  };

  /** يقرّب العرض إلى اللوح النشط */
  P.fitToArtboard = function (i) {
    const A = ensure(this);
    const a = A[i === undefined ? this._abActive : i];
    if (!a || !this._wToS) return;
    const cw = this.canvas.width, chh = this.canvas.height;
    const pad = 40;
    this.scale = Math.min((cw - pad * 2) / a.w, (chh - pad * 2) / a.h);
    // نضع مركز اللوح في مركز الشاشة
    if (this.offsetX !== undefined) {
      this.offsetX = cw / 2 - (a.x + a.w / 2) * this.scale;
      this.offsetY = chh / 2 - (a.y + a.h / 2) * this.scale;
    }
    this.render();
  };

  /** الأشكال الواقعة داخل لوح — أساس التصدير المستقلّ */
  P.shapesInArtboard = function (i) {
    const A = ensure(this);
    const a = A[i === undefined ? this._abActive : i];
    if (!a) return [];
    const out = [];
    this.shapes.forEach((s, k) => {
      const b = this._bounds(s);
      if (!b) return;
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      if (cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) out.push(k);
    });
    return out;
  };

  /** يحدّد كل ما في اللوح النشط — الخطوة الأولى قبل توليد G-Code له وحده */
  P.selectArtboardContents = function (i) {
    const list = this.shapesInArtboard(i);
    if (!list.length) return toast('اللوح فارغ', 'warn');
    if (this.msel) { this.msel.clear(); list.forEach(k => this.msel.add(k)); }
    this.selectedIdx = list[list.length - 1];
    this._updateShapeToolbar?.();
    this.render(); this._updateStatus?.();
    toast(`حُدّد ${list.length} شكلاً في اللوح`, 'success');
  };

  /* رسم الألواح خلف الأشكال */
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    const A = this._artboards;
    if (!A || !this.ctx || this._abHidden) return;
    const ctx = this.ctx;
    ctx.save();
    A.forEach((a, i) => {
      const p = this._wToS(a.x, a.y), q = this._wToS(a.x + a.w, a.y + a.h);
      const active = i === this._abActive;
      ctx.strokeStyle = active ? '#4f9dff' : 'rgba(139,148,158,.45)';
      ctx.lineWidth = active ? 1.6 : 1;
      ctx.setLineDash(active ? [] : [5, 4]);
      ctx.strokeRect(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y));
      ctx.setLineDash([]);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = active ? '#4f9dff' : 'rgba(139,148,158,.7)';
      ctx.textAlign = 'right';
      ctx.fillText(`${a.name} — ${a.w}×${a.h}`, Math.max(p.x, q.x), Math.min(p.y, q.y) - 5);
    });
    ctx.restore();
  };

  /** أداة اللوح: السحب يرسم لوحاً جديداً، والنقر يفعّل ما تحته */
  const artboardTool = {
    cursor: 'crosshair',
    onDown(e) { this._abDrag = { a: this._evPt(e) }; this.isDrawing = true; },
    onMove(e) { if (this._abDrag) { this._abDrag.b = this._evPt(e); this.render(); } },
    onUp(e) {
      const d = this._abDrag;
      this._abDrag = null; this.isDrawing = false;
      if (!d) return;
      const b = this._evPt(e);
      const w = Math.abs(b.x - d.a.x), h = Math.abs(b.y - d.a.y);
      if (w < 5 || h < 5) {
        // نقرة: فعّل اللوح الذي تقع فيه
        const A = ensure(this);
        const i = A.findIndex(a => b.x >= a.x && b.x <= a.x + a.w && b.y >= a.y && b.y <= a.y + a.h);
        if (i >= 0) this.setActiveArtboard(i);
        return;
      }
      this.addArtboard({ name: `لوح ${ensure(this).length + 1}`,
        x: Math.min(d.a.x, b.x), y: Math.min(d.a.y, b.y),
        w: +w.toFixed(1), h: +h.toFixed(1) });
    },
    onDraw(ctx) {
      const d = this._abDrag;
      if (!d || !d.b) return;
      const p = this._wToS(d.a.x, d.a.y), q = this._wToS(d.b.x, d.b.y);
      ctx.save();
      ctx.strokeStyle = '#4f9dff'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.4;
      ctx.strokeRect(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y));
      ctx.restore();
    },
  };

  /* ═══════════════ ٢) علامات القطع ═══════════════ */

  /**
   * أربع زوايا × خطّان لكلٍّ = ثمانية خطوط قصيرة، مزاحة عن الحافّة بمسافة
   * تُسمّى offset (كما في Illustrator: العلامة لا تلمس العمل).
   */
  P.createTrimMarks = async function (opts) {
    let o = opts;
    const idx = sel(this);
    let box;
    if (idx.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      idx.forEach(i => { const b = this._bounds(this.shapes[i]); if (b) {
        minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
        minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY); } });
      if (!isFinite(minX)) return toast('تعذّر قياس التحديد', 'warn');
      box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    } else {
      const a = ensure(this)[this._abActive];
      box = { x: a.x, y: a.y, w: a.w, h: a.h };
    }
    if (!o && window.DQPrompt) {
      const r = await window.DQPrompt('علامات القطع', [
        { key: 'len', label: 'طول العلامة mm', value: 6, min: 1, max: 50, step: 0.5 },
        { key: 'off', label: 'الإزاحة عن الحافّة mm', value: 3, min: 0, max: 50, step: 0.5 },
        { key: 'reg', label: 'أضف علامة تسجيل مركزية', type: 'check', value: false },
      ]);
      if (!r) return;
      o = { len: +r.len, off: +r.off, reg: !!r.reg };
    }
    o = o || { len: 6, off: 3, reg: false };

    const L = o.len, O = o.off, marks = [];
    const line = (x1, y1, x2, y2) => marks.push({ type: 'line', x1, y1, x2, y2, name: 'علامة قطع', __trim: true });
    const X0 = box.x, Y0 = box.y, X1 = box.x + box.w, Y1 = box.y + box.h;
    // كل زاوية: خطّ أفقيّ وآخر رأسيّ، كلاهما مزاح للخارج
    [[X0, Y0, -1, -1], [X1, Y0, 1, -1], [X1, Y1, 1, 1], [X0, Y1, -1, 1]].forEach(([x, y, sx, sy]) => {
      line(x + sx * O, y, x + sx * (O + L), y);
      line(x, y + sy * O, x, y + sy * (O + L));
    });
    if (o.reg) {
      const cx = X0 + box.w / 2, cy = Y0 + box.h / 2, r = L / 2;
      marks.push({ type: 'circle', cx, cy, r, name: 'علامة تسجيل', __trim: true });
      line(cx - r * 1.6, cy, cx + r * 1.6, cy);
      line(cx, cy - r * 1.6, cx, cy + r * 1.6);
    }
    this._saveHistory();
    marks.forEach(m => this.shapes.push(m));
    this.render(); this._updateStatus?.();
    toast(`✓ ${marks.length} علامة قطع`, 'success');
  };

  /* ═══════════════ ٣) الطباعة المبلّطة ═══════════════ */

  /**
   * يقسّم منطقة أكبر من مساحة الآلة إلى بلاطات بتداخل معلوم، ويُنشئ لوحاً
   * لكلٍّ منها — فيصير كل بلاط قابلاً للقطع مستقلاً مع منطقة وصل.
   */
  P.printTiling = async function (opts) {
    let o = opts;
    if (!o && window.DQPrompt) {
      const a = ensure(this)[this._abActive];
      const r = await window.DQPrompt('الطباعة المبلّطة', [
        { key: 'tw', label: 'عرض البلاطة mm', value: Math.min(a.w, this.workW || 300), min: 10, max: 3000 },
        { key: 'th', label: 'ارتفاع البلاطة mm', value: Math.min(a.h, this.workH || 200), min: 10, max: 3000 },
        { key: 'ov', label: 'التداخل mm', value: 5, min: 0, max: 100, step: 0.5 },
        { key: 'marks', label: 'علامات وصل على الحدود', type: 'check', value: true },
      ]);
      if (!r) return;
      o = { tw: +r.tw, th: +r.th, ov: +r.ov, marks: !!r.marks };
    }
    if (!o) return;
    const a = ensure(this)[this._abActive];
    const stepX = Math.max(1, o.tw - o.ov), stepY = Math.max(1, o.th - o.ov);
    const cols = Math.ceil((a.w - o.ov) / stepX), rows = Math.ceil((a.h - o.ov) / stepY);
    if (cols * rows > 200) return toast(`${cols}×${rows} بلاطة — أكثر من الحدّ (٢٠٠)`, 'warn');

    const A = ensure(this);
    const made = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        made.push({ name: `بلاطة ${r + 1}·${c + 1}`,
          x: +(a.x + c * stepX).toFixed(2), y: +(a.y + r * stepY).toFixed(2),
          w: Math.min(o.tw, a.x + a.w - (a.x + c * stepX)),
          h: Math.min(o.th, a.y + a.h - (a.y + r * stepY)) });
      }
    }
    made.forEach(m => A.push(m));
    save(this);

    if (o.marks) {
      this._saveHistory();
      made.forEach(m => {
        const t = 3;
        [[m.x, m.y], [m.x + m.w, m.y], [m.x + m.w, m.y + m.h], [m.x, m.y + m.h]].forEach(([x, y]) => {
          this.shapes.push({ type: 'line', x1: x - t, y1: y, x2: x + t, y2: y, name: 'وصل', __trim: true });
          this.shapes.push({ type: 'line', x1: x, y1: y - t, x2: x, y2: y + t, name: 'وصل', __trim: true });
        });
      });
    }
    this.render();
    toast(`✓ ${cols}×${rows} بلاطة بتداخل ${o.ov}mm`, 'success');
    window.dispatchEvent(new CustomEvent('dq:artboards-changed'));
  };

  /* ═══════════════ ٤) بحث واستبدال ═══════════════ */

  P.findReplace = async function () {
    if (!window.DQPrompt) return toast('الحوارات غير متاحة', 'error');
    const r = await window.DQPrompt('بحث واستبدال', [
      { key: 'find', label: 'ابحث عن', type: 'text', value: '' },
      { key: 'repl', label: 'استبدل بـ', type: 'text', value: '' },
      { key: 'where', label: 'المجال', type: 'select', value: 'both', options: [
        { value: 'both',  label: 'النصوص وأسماء الأشكال' },
        { value: 'text',  label: 'نصوص المشروع فقط' },
        { value: 'name',  label: 'أسماء الأشكال فقط' },
      ] },
      { key: 'cs', label: 'حسّاس لحالة الأحرف', type: 'check', value: false },
      { key: 'selOnly', label: 'في التحديد فقط', type: 'check', value: false },
    ]);
    if (!r || !r.find) return;

    const idx = r.selOnly && sel(this).length ? sel(this) : this.shapes.map((_, i) => i);
    const flags = r.cs ? 'g' : 'gi';
    const re = new RegExp(r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    let hits = 0;
    const touched = [];
    for (const i of idx) {
      const s = this.shapes[i];
      if (!s) continue;
      if ((r.where === 'both' || r.where === 'text') && s.type === 'text' && typeof s.text === 'string' && re.test(s.text)) {
        s.__newText = s.text.replace(re, r.repl); hits++; touched.push(i);
      }
      if ((r.where === 'both' || r.where === 'name') && typeof s.name === 'string' && re.test(s.name)) {
        s.__newName = s.name.replace(re, r.repl); hits++; touched.push(i);
      }
    }
    if (!hits) { this.shapes.forEach(s => { delete s.__newText; delete s.__newName; }); return toast(`لا نتائج لـ«${r.find}»`, 'warn'); }

    this._saveHistory();
    let retext = 0;
    for (const i of new Set(touched)) {
      const s = this.shapes[i];
      if (s.__newName !== undefined) { s.name = s.__newName; delete s.__newName; }
      if (s.__newText !== undefined) {
        s.text = s.__newText; delete s.__newText;
        // النصّ محفور كـstrokes: يلزم إعادة نقشه ليظهر التغيير فعلاً
        if (this.retextShape) { this.retextShape(i); retext++; }
      }
    }
    this.shapes.forEach(s => { delete s.__newText; delete s.__newName; });
    this.render(); this._updateStatus?.();
    toast(`✓ ${hits} استبدال${retext ? ` (أُعيد نقش ${retext} نصّاً)` : ''}`, 'success');
  };

  /**
   * إعادة نقش نصّ بعد تغيير محتواه — يستعمل نفس مولّد الحروف الذي تستعمله
   * أداة النصّ، فلا يصير للنقش مصدران.
   *
   * ملاحظتان تعلّمناهما من `tools-pro.js`:
   *  ١) `_textToStrokes` يأخذ **النصّ كاملاً** ويدير مؤشّر التقدّم بنفسه؛
   *     استدعاؤه حرفاً حرفاً يفرض إعادة حساب التباعد يدوياً ويخطئ فيه.
   *  ٢) خطّ النقش المدمج لاتينيّ/رقميّ فقط. النصّ العربي يعود بلا ضربات،
   *     فنُبقي النقش القديم ونصرّح بالسبب بدل تفريغ الشكل صامتاً.
   */
  P.retextShape = function (i) {
    const s = this.shapes[i];
    if (!s || s.type !== 'text' || !this._textToStrokes) return false;
    const b = this._bounds(s);
    const x0 = b ? b.minX : (s.x || 0), y0 = b ? b.minY : (s.y || 0);
    const h = s.height || 10;

    const g = this._textToStrokes(String(s.text || ''), h);
    if (!g || !g.strokes || !g.strokes.length) {
      toast('خطّ النقش المدمج لا يدعم هذه الأحرف (لاتينية وأرقام ورموز فقط) — بقي النقش السابق', 'warn');
      return false;
    }
    // إحداثيات الضربات في `s.strokes` عالميّة، ومخرج المولّد محلّيّ — فنزيحه
    s.strokes = g.strokes.map(st => st.map(p => ({ x: p.x + x0, y: p.y + y0 })));
    s.width = g.width;
    return true;
  };

  /* ═══════════════ ٥) السكربتات ═══════════════ */

  const SCRIPTS_KEY = 'dq_scripts';
  const loadScripts = () => { try { return JSON.parse(localStorage.getItem(SCRIPTS_KEY) || '[]'); } catch (_) { return []; } };
  const saveScripts = a => { try { localStorage.setItem(SCRIPTS_KEY, JSON.stringify(a)); } catch (_) {} };

  /**
   * يشغّل شفرة على المحرّر. `ed` و`shapes` و`toast` متاحة داخل السكربت.
   * تحذير: هذا تنفيذٌ لشفرة يكتبها المستخدم بنفسه على بياناته — لا يُستورَد
   * من الشبكة ولا يُشغَّل تلقائياً؛ يبقى بضغطة زرّ صريحة منه.
   */
  P.runScript = function (code) {
    if (!code || !code.trim()) return toast('السكربت فارغ', 'warn');
    const ed = this;
    try {
      ed._saveHistory();
      // eslint-disable-next-line no-new-func
      const fn = new Function('ed', 'shapes', 'toast', 'DQ', code);
      const out = fn(ed, ed.shapes, toast, window.DQ);
      ed.render(); ed._updateStatus?.();
      toast(out === undefined ? '✓ نُفّذ السكربت' : '✓ ' + String(out).slice(0, 120), 'success');
      return out;
    } catch (e) {
      console.error('[script]', e);
      toast('خطأ في السكربت: ' + e.message, 'error');
    }
  };

  P.promptScript = async function () {
    if (!window.DQPrompt) return toast('الحوارات غير متاحة', 'error');
    const saved = loadScripts();
    const r = await window.DQPrompt('تشغيل سكربت', [
      { key: 'pick', label: 'محفوظ', type: 'select', value: '',
        options: [{ value: '', label: '— جديد —' }, ...saved.map((s, i) => ({ value: String(i), label: s.name }))] },
      { key: 'code', label: 'الشفرة', type: 'text',
        value: saved.length ? '' : 'shapes.forEach(s => s.maxDepth = 3); return shapes.length + " شكلاً"' },
      { key: 'save', label: 'احفظه باسم (اتركه فارغاً للتشغيل فقط)', type: 'text', value: '' },
    ]);
    if (!r) return;
    let code = r.code;
    if (r.pick !== '' && saved[+r.pick] && !code.trim()) code = saved[+r.pick].code;
    if (r.save && code.trim()) { saved.push({ name: r.save, code }); saveScripts(saved); toast(`حُفظ «${r.save}»`, 'info'); }
    return this.runScript(code);
  };

  P.listScripts = () => loadScripts().map((s, i) => ({ i, name: s.name }));
  P.deleteScript = function (i) { const a = loadScripts(); if (!a[i]) return; a.splice(i, 1); saveScripts(a); toast('حُذف السكربت', 'info'); };

  /* ═══════════════ التسجيل ═══════════════ */
  const origInstall = P._installCore;
  P._installCore = function () {
    if (origInstall) origInstall.call(this);
    if (this.tools && this.tools.register) this.tools.register('artboard', artboardTool);
  };

  document.addEventListener('keydown', e => {
    const ed = window.app && window.app.editor;
    if (!ed) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); ed.findReplace(); }
    else if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === 'O') { e.preventDefault(); ed.setTool('artboard'); }
  });
})();
