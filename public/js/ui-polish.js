/**
 * ui-polish.js — تحسينات تصميم وتجربة الاستخدام
 *
 *  1. تلميحات فورية أنيقة بدل title البطيء
 *  2. حالة فارغة إرشادية على لوحة الرسم
 *  3. محاور CAD ملونة (X أحمر · Y أخضر) مع تسميات
 *  4. نقطة بداية كل مسار (مهمة في CNC — منها يبدأ القطع)
 *  5. حدود طاولة الآلة على اللوحة (من حدود X/Y في الإعدادات)
 *  6. توهج زر التوليد عند جاهزية التصميم
 *  7. اسم الأداة الحالية في شريط الحالة
 */
(function uiPolish() {
  'use strict';

  /* ══ 1) تلميحات فورية ══ */
  function initTooltips() {
    const tip = document.createElement('div');
    tip.className = 'dq-tip';
    document.body.appendChild(tip);
    let hideTimer;

    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[title]');
      if (!el || el.closest('dialog')) return;
      const text = el.getAttribute('title');
      if (!text) return;
      el.dataset.tip = text;
      // حافظ على اسم الوصول قبل حذف title (وإلا تفقده قارئات الشاشة)
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
      el.removeAttribute('title');          // عطّل تلميح المتصفح البطيء
      showTip(el);
    });
    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-tip]');
      if (el) showTip(el);
      else { clearTimeout(hideTimer); hideTimer = setTimeout(() => tip.classList.remove('on'), 60); }
    });

    function showTip(el) {
      clearTimeout(hideTimer);
      tip.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - 10, Math.max(10, r.left + r.width / 2)) + 'px';
      const below = r.bottom + 34 < window.innerHeight;
      tip.style.top = (below ? r.bottom + 8 : r.top - 30) + 'px';
      tip.classList.add('on');
    }
  }

  /* ══ هوكات المحرر ══ */
  function initEditorHooks() {
    if (typeof CanvasEditor === 'undefined') return;
    const P = CanvasEditor.prototype;

    // 3) محاور ملونة بنمط CAD
    const origAxes = P._drawAxes;
    P._drawAxes = function () {
      const { ctx, canvas, offset } = this;
      // Y (أخضر عمودي) و X (أحمر أفقي)
      ctx.strokeStyle = 'rgba(63,185,80,.45)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(offset.x, 0); ctx.lineTo(offset.x, canvas.height); ctx.stroke();
      ctx.strokeStyle = 'rgba(248,81,73,.45)';
      ctx.beginPath(); ctx.moveTo(0, offset.y); ctx.lineTo(canvas.width, offset.y); ctx.stroke();
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = 'rgba(248,81,73,.8)';
      ctx.fillText('X+', canvas.width - 22, offset.y - 6);
      ctx.fillStyle = 'rgba(63,185,80,.8)';
      ctx.fillText('Y+', offset.x + 6, 14);
      ctx.fillStyle = '#30363d';
      ctx.fillText('0,0', offset.x + 4, offset.y + 12);
    };

    // 4+5) نقاط البداية + حدود الطاولة — فوق الرسم الأساسي
    const origRender = P.render;
    P.render = function () {
      origRender.call(this);
      const { ctx } = this;

      // حدود طاولة الآلة من الإعدادات
      const tx = parseFloat(document.getElementById('travel-x')?.value) || 0;
      const ty = parseFloat(document.getElementById('travel-y')?.value) || 0;
      if (tx > 0 && ty > 0) {
        const a = this._wToS(0, ty), b = this._wToS(tx, 0);
        ctx.save();
        ctx.strokeStyle = 'rgba(210,153,34,.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(210,153,34,.7)';
        ctx.font = '10px Tajawal, monospace';
        ctx.fillText(`طاولة الآلة ${tx}×${ty}mm`, a.x + 6, a.y + 14);
        ctx.restore();
      }

      // نقطة بداية كل مسار (يبدأ القطع منها)
      if (this.shapes.length && this.scale > 0.8) {
        ctx.save();
        for (const s of this.shapes) {
          if (s.disabled) continue;
          let p = null;
          try { p = (typeof DQ !== 'undefined') ? DQ.geometry.shapeStartPoint(s) : null; } catch (e) {}
          if (!p) continue;
          const sp = this._wToS(p.x, p.y);
          ctx.fillStyle = '#3fb950';
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 2) الحالة الفارغة
      const es = document.getElementById('canvas-empty-state');
      if (es) es.style.display = this.shapes.length ? 'none' : 'flex';

      // 6) توهج زر التوليد عند وجود تصميم بلا كود مولد
      const gen = document.getElementById('btn-generate');
      if (gen) gen.classList.toggle('ready-glow', this.shapes.length > 0 && !(window.app && window.app.gcode));
    };

    // 7) اسم الأداة في شريط الحالة
    const NAMES = {
      select:'تحديد', hand:'تحريك', lasso:'لاسو', line:'خط', bezier:'بيزير', spline:'سبلاين',
      polyline:'بولي خط', freehand:'رسم حر', rect:'مستطيل', 'rounded-rect':'مستطيل مدوّر',
      'chamfer-rect':'مستطيل مشطوف', circle:'دائرة', ellipse:'بيضاوي', triangle:'مثلث',
      polygon:'مضلع', star:'نجمة', arrow:'سهم', slot:'فتحة', donut:'حلقة', arc:'قوس',
      spiral:'حلزون', wave:'موجة', zigzag:'متعرج', gear:'تروس', crosshair:'علامة تمركز',
      dimension:'قياس', text:'نقش نص', heart:'قلب', cross:'صليب', semicircle:'نصف دائرة',
      crescent:'هلال', teardrop:'قطرة', stairs:'درج', 'double-arrow':'سهم مزدوج',
      frame:'إطار', arc3:'قوس 3 نقاط', honeycomb:'خلايا نحل', 'living-hinge':'مفصل مرن',
      'finger-joint':'وصلة أصابع', voronoi:'فورونوي', maze:'متاهة', starburst:'نجمة شعاعية',
      hatch:'هاشير', lattice:'شبكة', 'wave-fill':'تعبئة موجية', 'tab-slot':'وصلة تابس',
    };
    const origSetTool = P.setTool;
    P.setTool = function (t) {
      origSetTool.call(this, t);
      const el = document.getElementById('footer-tool');
      if (el) el.textContent = '🖊 ' + (NAMES[t] || t);
    };
  }

  /* ══ a11y: اسم وصول ثابت للأزرار الأيقونية (قارئات الشاشة) ══ */
  function initA11y() {
    document.querySelectorAll('button[title]:not([aria-label]), [role="button"][title]:not([aria-label])')
      .forEach(b => b.setAttribute('aria-label', b.getAttribute('title')));
  }

  /* ══ أدراج منزلقة للوحتين على اللوحي/الهاتف ══ */
  function initDrawers() {
    const settings = document.querySelector('.settings-panel');
    const output   = document.querySelector('.output-panel');
    const backdrop = document.getElementById('drawer-backdrop');
    if (!backdrop) return;

    function closeAll() {
      settings && settings.classList.remove('drawer-open');
      output   && output.classList.remove('drawer-open');
      backdrop.classList.remove('on');
    }
    function toggle(panel) {
      if (!panel) return;
      const willOpen = !panel.classList.contains('drawer-open');
      closeAll();
      if (willOpen) { panel.classList.add('drawer-open'); backdrop.classList.add('on'); }
    }

    document.getElementById('dt-settings')?.addEventListener('click', () => toggle(settings));
    document.getElementById('dt-output')?.addEventListener('click', () => toggle(output));
    backdrop.addEventListener('click', closeAll);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
    // عند توسيع الشاشة (دوران الجهاز) أغلق الأدراج لتجنّب حالة عالقة
    window.addEventListener('resize', () => { if (window.innerWidth > 1024) closeAll(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initTooltips(); initA11y(); initDrawers(); });
  } else { initTooltips(); initA11y(); initDrawers(); }
  initEditorHooks();
})();
