/**
 * interaction-pro.js — سلوك التحديد والسحب وتبديل الأدوات بمعايير إليستريتور
 *
 * ما كان يجعل التحديد «غير سلس» — أعطال حقيقية لا ذوق:
 *
 *  ١) `_evPt` كان يُمرّر كل نقرة عبر `_snap`. فالنقر عند (7.3, 12.8) وشبكةٍ 10مم
 *     يصير اختبار إصابة عند (10, 10) — أي على بُعد 3.7مم من حيث نقرت.
 *     النتيجة: تنقر على الشكل فلا يُحدَّد. الالتقاط للرسم، لا للتحديد.
 *  ٢) `_paintShape` يلوّن `selectedIdx` وحده. فتحديد خمسة أشكال يُظهر واحداً
 *     محدَّداً — التحديد المتعدد كان غير مرئي أصلاً.
 *  ٣) لا عتبة سحب: اهتزاز بكسل واحد أثناء النقر يبدأ مستطيل تحديد أو يزيح الشكل.
 *  ٤) السحب كان يلتقط **المؤشر** للشبكة لا **أصل الشكل**، فالشكل يقفز بمقدار
 *     إزاحة الإمساك ولا يستقرّ على الشبكة ولا يتحرّك بنعومة.
 *  ٥) لا تمييز عند المرور: لا تعرف ما الذي ستحدّده قبل أن تنقر.
 *
 * وتبديل الأدوات: أُضيفت أعراف إليستريتور — مسافة = يد مؤقتة، Esc = عودة
 * لأداة التحديد، Alt+سحب = تكرار، الأسهم = إزاحة دقيقة.
 *
 * كل شيء هنا تغليف للنموذج الأولي (prototype) بعد تحميل باقي الوحدات، فلا
 * يُعاد تعريف منطق قائم ولا يُلمس مولّد G-Code.
 */
(function interactionPro() {
  'use strict';

  const THRESH   = 3;    // بكسل شاشة قبل أن يُعتبر الضغط سحباً
  const HOVER_MS = 30;   // خنق إعادة الرسم عند المرور

  function boot() {
    const C = (typeof CanvasEditor !== 'undefined') ? CanvasEditor : window.CanvasEditor;
    if (!C || !C.prototype) return;
    const P = C.prototype;
    if (P.__ixPro) return;
    P.__ixPro = true;

    /* ═════════ ١) نقطة غير ملتقطة لأداة التحديد ═════════
       الالتقاط يخدم الرسم (رأس الشكل على الشبكة). أما التحديد فيريد
       الإحداثي الحقيقي تحت المؤشر، وإلا اختُبرت الإصابة في مكان آخر. */
    const origEvPt = P._evPt;
    P._evPt = function (e) {
      if (this.tool !== 'select') return origEvPt.call(this, e);
      const r = this.canvas.getBoundingClientRect();
      return this._sToW(e.clientX - r.left, e.clientY - r.top);
    };

    /* نقطة عالمية خام مهما كانت الأداة (للتمييز عند المرور) */
    P._rawPt = function (e) {
      const r = this.canvas.getBoundingClientRect();
      return this._sToW(e.clientX - r.left, e.clientY - r.top);
    };

    /* ═════════ ١ب) حدود المضلّع من نقاطه ═════════
       `_bounds` كان يحسب المضلّع `cx ± r` — أي نصف قطر المضلّع المنتظم. وهذا
       يصحّ للمضلّع كما يُرسَم أوّل مرّة فقط؛ فما إن تُحرَّر نقاطه (تحرير عُقَد،
       عملية بوليانية، تسييل) حتى تصير الحدود خاطئة أو صفراً. والنتيجة تظهر في
       التحديد نفسه: مربّع التحديد بحجم خاطئ، والتحديد المستطيلي لا يلتقط
       الشكل، والملاءمة والمحاذاة تحسبان مكاناً غير مكانه.
       النقاط موجودة دوماً في المضلّع (`_isNear` يعتمد عليها) فهي الأصدق. */
    const origBoundsIx = P._bounds;
    P._bounds = function (s) {
      if (!s || (s.type !== 'polygon' && s.type !== 'polyline') || !s.points || !s.points.length)
        return origBoundsIx.call(this, s);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of s.points) {   // حلقة لا spread: مضلّع بعشرات الآلاف من النقاط يُفجّر المكدّس
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      return isFinite(minX) ? { minX, maxX, minY, maxY } : origBoundsIx.call(this, s);
    };

    /* ═════════ ٢) التحديد المتعدد يظهر محدَّداً ═════════ */
    const origPaintShape = P._paintShape;
    P._paintShape = function (i) {
      const inM = this.msel && this.msel.size > 1 && this.msel.has(i) && i !== this.selectedIdx;
      if (!inM) return origPaintShape.call(this, i);
      // عضو في تحديد متعدد: نفس لون التحديد بدرجة أهدأ ليبقى المحوَر مميّزاً
      const ctx = this.ctx, s = this.shapes[i];
      if (!s) return;
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#f8a49f';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      this._drawShape(s);
      const o = this._shapeOrigin(s), sp = this._wToS(o.x, o.y);
      ctx.fillStyle = '#f8a49f';
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };

    /* ═════════ ٣) الضغط: عتبة سحب + Alt+سحب = تكرار ═════════ */
    const origOnDown = P._onDown;
    P._onDown = function (e) {
      this._press = null;
      this._hoverIdx = -1;

      if (this.tool === 'select' && e.button === 0) {
        const r = this.canvas.getBoundingClientRect();
        this._press = { sx: e.clientX - r.left, sy: e.clientY - r.top, moved: false, alt: e.altKey };
      }

      origOnDown.call(this, e);

      // أجّل مستطيل التحديد حتى تُتجاوز العتبة — نقرةٌ ساكنة يجب ألا تبدأ تحديداً
      if (this._marquee && this._press) {
        this._pendingMarquee = this._marquee;
        this._marquee = null;
      }
      // أجّل السحب الجماعي كذلك (يضبطه tools-arrange عند الضغط)
      if (this._groupDrag && this._press) {
        this._pendingGroupDrag = this._groupDrag;
        this._groupDrag = null;
      }
    };

    /* ═════════ ٤) الحركة: سحب ناعم + التقاط الأصل + تمييز المرور ═════════ */
    const origOnMove = P._onMove;
    P._onMove = function (e) {
      // تمرير بلا ضغط: مؤشر يقول ما الذي ستحدّده
      if (this.tool === 'select' && e.buttons === 0) {
        this._hoverPick(e);
        return origOnMove.call(this, e);
      }

      if (this.tool !== 'select' || e.buttons !== 1 || !this._press) {
        return origOnMove.call(this, e);
      }

      const r  = this.canvas.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;

      if (!this._press.moved) {
        if (Math.hypot(sx - this._press.sx, sy - this._press.sy) < THRESH) return;
        this._press.moved = true;
        // تجاوزت العتبة: فعّل ما أُجّل
        if (this._pendingMarquee)   { this._marquee   = this._pendingMarquee;   this._pendingMarquee = null; }
        if (this._pendingGroupDrag) { this._groupDrag = this._pendingGroupDrag; this._pendingGroupDrag = null; }
        // Alt+سحب = اسحب نسخة واترك الأصل مكانه (عُرف إليستريتور)
        if (this._press.alt && !this._marquee) this._altDuplicate();
      }

      const raw = this._sToW(sx, sy);
      this._readout(raw);

      // سحب جماعي: دلتا خام، ثم يُلتقط أصل الشكل المحوَر لا المؤشر
      if (this._groupDrag) {
        const g = this._groupDrag;
        if (!g.origin) {
          const s0 = this.shapes[this.selectedIdx] || this.shapes[[...this.msel][0]];
          g.origin = s0 ? { ...this._shapeOrigin(s0) } : { x: 0, y: 0 };
          g.grab   = { x: raw.x - g.origin.x, y: raw.y - g.origin.y };
          g.applied = { x: 0, y: 0 };
        }
        const want = this._snapOrigin({ x: raw.x - g.grab.x, y: raw.y - g.grab.y });
        const dx = (want.x - g.origin.x) - g.applied.x;
        const dy = (want.y - g.origin.y) - g.applied.y;
        if (dx || dy) {
          for (const i of this.msel) { const s = this.shapes[i]; if (s) this._offsetShape(s, dx, dy); }
          g.applied.x += dx; g.applied.y += dy;
          g.last = raw;
          this.render();
        }
        return;
      }

      // سحب مفرد: الأصل هو ما يلتقط الشبكة، فالحركة ناعمة والاستقرار مضبوط
      if (this.selectedIdx >= 0 && this.dragOffset) {
        const s = this.shapes[this.selectedIdx];
        if (s) {
          this._movingSel = true;
          const want = this._snapOrigin({ x: raw.x - this.dragOffset.dx, y: raw.y - this.dragOffset.dy });
          this._moveShape(s, want.x, want.y);
          this.render();
        }
        return;
      }

      // مستطيل التحديد
      if (this._marquee) {
        this._marquee.x1 = raw.x; this._marquee.y1 = raw.y;
        this.render(); return;
      }

      return origOnMove.call(this, e);
    };

    /* التقاط الأصل لا المؤشر — هذا ما يجعل السحب يستقرّ على الشبكة بلا قفز */
    P._snapOrigin = function (o) {
      if (!this.snapGrid) return o;
      const g = this.gridSize || 1;
      return { x: Math.round(o.x / g) * g, y: Math.round(o.y / g) * g };
    };

    P._readout = function (pt) {
      const cx = pt.x.toFixed(3), cy = pt.y.toFixed(3);
      if (this._lastX !== cx) { const el = document.getElementById('cur-x'); if (el) el.textContent = cx; this._lastX = cx; }
      if (this._lastY !== cy) { const el = document.getElementById('cur-y'); if (el) el.textContent = cy; this._lastY = cy; }
    };

    /* Alt+سحب: انسخ المحدد فوراً واسحب النسخة */
    P._altDuplicate = function () {
      const idx = [];
      if (this.msel && this.msel.size) idx.push(...this.msel);
      else if (this.selectedIdx >= 0) idx.push(this.selectedIdx);
      if (!idx.length) return;
      this._saveHistory();
      const made = [];
      for (const i of idx) {
        const s = this.shapes[i];
        if (!s) continue;
        this.shapes.push(JSON.parse(JSON.stringify(s)));
        made.push(this.shapes.length - 1);
      }
      if (!made.length) return;
      this.msel = new Set(made);
      this.selectedIdx = made[made.length - 1];
      this._sceneVersion = (this._sceneVersion | 0) + 1;
      // السحب يستكمل على النسخة: أعد بناء الإمساك من أصلها
      if (this._groupDrag) this._groupDrag.origin = null;
      window.app?.toast?.('نسخة أثناء السحب (Alt)', 'info');
    };

    /* تمييز ما تحت المؤشر — يقيّد نفسه زمنياً كي لا يُعيد الرسم كل بكسل */
    P._hoverPick = function (e) {
      const now = performance.now();
      if (this._hoverAt && now - this._hoverAt < HOVER_MS) return;
      this._hoverAt = now;
      const hit = this._hitTest(this._rawPt(e));
      if (hit === this._hoverIdx) return;
      this._hoverIdx = hit;
      this.canvas.style.cursor = hit >= 0 ? 'move' : 'default';
      this.render();
    };

    /* ═════════ ٥) الرفع: تنظيف حالة الضغط ═════════ */
    const origOnUp = P._onUp;
    P._onUp = function (e) {
      const wasPending = this._pendingMarquee || this._pendingGroupDrag;
      const noDrag = this._press && !this._press.moved;
      this._pendingMarquee = null; this._pendingGroupDrag = null;
      this._press = null;
      if (noDrag && wasPending) {
        // نقرة ساكنة على فراغ = إلغاء التحديد، لا مستطيل بمساحة صفر
        this._marquee = null; this._groupDrag = null;
        this._movingSel = false;
        if (this.tool === 'select' && this.selectedIdx < 0) { this.msel?.clear?.(); this._updateShapeToolbar?.(); }
        this.render();
        return;
      }
      return origOnUp.call(this, e);
    };

    /* ═════════ ٦) تمييز المرور فوق المشهد ═════════ */
    const origOverlays = P._paintOverlays;
    P._paintOverlays = function () {
      if (this.tool === 'select' && this._hoverIdx >= 0 &&
          this._hoverIdx !== this.selectedIdx && !this._press) {
        const s = this.shapes[this._hoverIdx];
        if (s) {
          const ctx = this.ctx;
          ctx.save();
          ctx.strokeStyle = 'rgba(88,166,255,.85)';
          ctx.lineWidth = 2.5; ctx.setLineDash([]);
          ctx.shadowColor = 'rgba(88,166,255,.5)'; ctx.shadowBlur = 6;
          try { this._drawShape(s); } catch (_) {}
          ctx.restore();
        }
      }
      return origOverlays.call(this);
    };

    /* ═════════ ٧) تبديل الأدوات: أعراف إليستريتور ═════════ */
    const origSetTool = P.setTool;
    P.setTool = function (t) {
      /* التحديد يبقى عبر تبديل الأدوات عمداً — أدوات التدوير والتحجيم والقصّ
         والانعكاس والمزج تعمل كلّها على المحدد، فمسحُه عند التبديل يجعلها
         تشتكي «حدّد شكلاً أولاً» فور اختيارها. وهذا سلوك إليستريتور نفسه.
         (كان التحديد المتعدد غير مرئي قبل هذا الملف، فلم يظهر أثر بقائه.) */
      this._hoverIdx = -1;
      return origSetTool.call(this, t);
    };

    installKeys(P);
  }

  function installKeys(P) {
    let spacePrev = null;   // الأداة قبل ضغط المسافة

    const inField = () => {
      const a = document.activeElement;
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
    };
    const ed = () => window.app && window.app.editor;

    document.addEventListener('keydown', e => {
      const E = ed(); if (!E || inField()) return;

      // مسافة = يد مؤقتة ما دامت مضغوطة (لا تُبدّل الأداة الفعلية)
      if (e.code === 'Space' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (E.tool !== 'hand') { spacePrev = E.tool; E.setTool('hand'); }
        return;
      }

      // Esc: ألغِ الرسم الجاري ثم عُد لأداة التحديد
      if (e.key === 'Escape') {
        if (E.tool !== 'select') { E.setTool('select'); }
        return;
      }

      /* الإزاحة بالأسهم موجودة أصلاً في tools-pro.js (1مم · Shift=10 · Alt=0.1)
         ولا تُكرَّر هنا — معالجان اثنان يضاعفان كل ضغطة. */
    }, true);

    document.addEventListener('keyup', e => {
      const E = ed(); if (!E) return;
      if (e.code === 'Space' && spacePrev !== null) {
        E.setTool(spacePrev); spacePrev = null;
      }
    }, true);
  }

  /* سكربتات defer تنفَّذ بالترتيب قبل DOMContentLoaded، و`app.js` (الذي يُنشئ
     المحرر) آخرها. فالتنفيذ الفوري هنا — ووسمُنا موضوعٌ قبل app.js مباشرةً —
     يضمن أن تغليفنا هو الأخير فوق كل وحدات الأدوات وقبل إنشاء أي محرر. */
  if (typeof CanvasEditor !== 'undefined') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
