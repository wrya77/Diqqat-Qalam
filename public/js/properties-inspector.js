/**
 * properties-inspector.js — لوحة الخصائص السياقية (ميزة #3) بنمط CorelDraw/Illustrator
 *
 *  عند تحديد شكل (أو أكثر) تعرض لوحة «📐 الخصائص» صندوقه الحاوي قابلاً للتحرير:
 *    X · Y  → الموضع (الزاوية السفلى-اليسرى بإحداثيات العالم mm)
 *    العرض · الارتفاع → الأبعاد (تحجيم مثبّت عند تلك الزاوية، مع خيار حفظ التناسب)
 *    الدوران° → تدوير حول المركز (مطلق ضمن جلسة التحديد)
 *
 *  يعمل مع التحديد المفرد والمتعدد (يحوّل المجموعة كوحدة).
 *  لا منطق هندسي جديد: يعيد استخدام _bounds/_offsetShape/_scaleShape/_rotateShape.
 *  يُحمَّل بعد color-tools.js وقبل app.js.
 */
(function propertiesInspector() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const ed = () => window.app && window.app.editor;

  const AR_TYPE = {
    line: 'خط', rect: 'مستطيل', circle: 'دائرة', ellipse: 'بيضوي', arc: 'قوس',
    polygon: 'مضلّع', slot: 'فتحة', polyline: 'مسار', compound: 'مركّب', text: 'نص',
  };

  /* فهارس التحديد: مفرد selectedIdx أو متعدد msel */
  /* نُصفّي الفهارس الميتة (تبقى في msel/selectedIdx بعد الحذف) كي لا يُستدعى _bounds(undefined) */
  function selIdxs(e) {
    const valid = i => i >= 0 && i < e.shapes.length && e.shapes[i];
    if (e.msel && e.msel.size) return [...e.msel].filter(valid);
    return valid(e.selectedIdx) ? [e.selectedIdx] : [];
  }

  /* الصندوق الحاوي المجمّع لعدة أشكال */
  function combinedBounds(e, idxs) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    idxs.forEach(i => {
      const b = e._bounds(e.shapes[i]);
      if (b.minX < minX) minX = b.minX; if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY; if (b.maxY > maxY) maxY = b.maxY;
    });
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  }

  /* تتبّع الزاوية المطلقة ضمن جلسة تحديد واحدة */
  let appliedAngle = 0, lastSig = '';

  const $ = id => document.getElementById(id);
  const num = v => Math.round(v * 100) / 100;

  /* ملء الحقول من التحديد الحالي (يتخطّى الحقل قيد التحرير كي لا يُقاطَع) */
  function refresh() {
    const e = ed();
    const empty = $('props-empty'), body = $('props-body');
    if (!empty || !body) return;
    const idxs = e ? selIdxs(e) : [];

    if (!idxs.length) {
      empty.style.display = ''; body.style.display = 'none';
      lastSig = ''; appliedAngle = 0;
      return;
    }
    empty.style.display = 'none'; body.style.display = '';

    const sig = idxs.slice().sort((a, b) => a - b).join(',');
    if (sig !== lastSig) { lastSig = sig; appliedAngle = 0; }   // تحديد جديد ⇒ صفّر الزاوية

    const b = combinedBounds(e, idxs);
    const single = idxs.length === 1;
    $('props-type').textContent = single ? (AR_TYPE[e.shapes[idxs[0]].type] || e.shapes[idxs[0]].type) : 'مجموعة';
    $('props-count').textContent = single ? '' : `${idxs.length} أشكال`;

    const setIf = (id, val) => { const el = $(id); if (el && document.activeElement !== el) el.value = num(val); };
    setIf('prop-x', b.minX);
    setIf('prop-y', b.minY);
    setIf('prop-w', b.w);
    setIf('prop-h', b.h);
    const ang = $('prop-angle');
    if (ang && document.activeElement !== ang) ang.value = num(appliedAngle);
  }

  /* ── تطبيق التحويلات ── */
  function move(axis, val) {
    const e = ed(); const idxs = selIdxs(e); if (!idxs.length) return;
    const b = combinedBounds(e, idxs);
    const dx = axis === 'x' ? val - b.minX : 0;
    const dy = axis === 'y' ? val - b.minY : 0;
    if (!dx && !dy) return;
    e._saveHistory();
    idxs.forEach(i => e._offsetShape(e.shapes[i], dx, dy));
    e.render(); e._updateStatus?.();
  }

  function resize(dim, val) {
    const e = ed(); const idxs = selIdxs(e); if (!idxs.length) return;
    val = Math.max(0.1, val);
    const b = combinedBounds(e, idxs);
    const cur = dim === 'w' ? b.w : b.h;
    if (cur < 1e-6) return;
    const f = val / cur;
    const lock = $('prop-lock-aspect')?.checked;
    let fx, fy;
    if (dim === 'w') { fx = f; fy = lock ? f : 1; } else { fy = f; fx = lock ? f : 1; }
    e._saveHistory();
    idxs.forEach(i => e._scaleShape(e.shapes[i], fx, fy, b.minX, b.minY));  // تثبيت الزاوية السفلى-اليسرى
    e.render(); e._updateStatus?.();
  }

  function rotate(val) {
    const e = ed(); const idxs = selIdxs(e); if (!idxs.length) return;
    const delta = (val - appliedAngle) * Math.PI / 180;
    if (Math.abs(delta) < 1e-6) return;
    const b = combinedBounds(e, idxs);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    e._saveHistory();
    idxs.forEach(i => e._rotateShape(e.shapes[i], delta, cx, cy));
    appliedAngle = val;
    e.render(); e._updateStatus?.();
  }

  /* ── ربط الحقول ── */
  function bind() {
    const on = (id, fn) => {
      const el = $(id); if (!el) return;
      el.addEventListener('change', () => { fn(parseFloat(el.value)); });
      // Enter يطبّق ويُبقي التركيز للتعديل المتتابع
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); el.focus(); } });
    };
    on('prop-x', v => !isNaN(v) && move('x', v));
    on('prop-y', v => !isNaN(v) && move('y', v));
    on('prop-w', v => !isNaN(v) && resize('w', v));
    on('prop-h', v => !isNaN(v) && resize('h', v));
    on('prop-angle', v => !isNaN(v) && rotate(v));
  }

  /* ── تحديث اللوحة عند كل تغيّر تحديد (نقطة العبور المركزية) ── */
  const origToolbar = P._updateShapeToolbar;
  P._updateShapeToolbar = function () {
    origToolbar.call(this);
    refresh();
  };

  function boot() { bind(); refresh(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PropertiesInspector = { refresh };
})();
