/**
 * tools-dock.js — شريط أدوات قابل للإرساء (يمين · يسار · أعلى · أسفل)
 * اسحب المقبض ⠿ وأفلته قرب أي حافة من مساحة الرسم.
 * الموضع يُحفظ ويُستعاد تلقائياً.
 */
(function dockableRail() {
  'use strict';

  function init() {
    const rail = document.getElementById('tools-rail');
    const main = document.querySelector('.canvas-main');
    if (!rail || !main) return;

    // مقبض السحب
    const grip = document.createElement('div');
    grip.className = 'rail-grip';
    grip.title = 'اسحب لتغيير موضع شريط الأدوات';
    grip.innerHTML = '⠿';
    rail.prepend(grip);

    const SIDES = ['dock-left', 'dock-right', 'dock-top', 'dock-bottom'];

    function applyDock(side) {
      SIDES.forEach(c => main.classList.remove(c));
      main.classList.add('dock-' + side);
      try { localStorage.setItem('dq_rail_dock', side); } catch (e) {}
      // أعد ضبط حجم الكانفس بعد تغيير التخطيط
      requestAnimationFrame(() => window.app?.editor?._resize?.());
    }

    // استعادة الموضع المحفوظ
    const saved = (() => { try { return localStorage.getItem('dq_rail_dock'); } catch (e) { return null; } })();
    applyDock(saved && ['left','right','top','bottom'].includes(saved) ? saved : 'left');

    // السحب والإفلات
    let dragging = false;
    grip.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      dragging = true;
      document.body.style.cursor = 'grabbing';
      main.classList.add('dock-dragging');
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const side = nearestSide(e);
      SIDES.forEach(c => main.classList.remove(c + '-hint'));
      main.classList.add('dock-' + side + '-hint');
    });

    document.addEventListener('mouseup', e => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      main.classList.remove('dock-dragging');
      SIDES.forEach(c => main.classList.remove(c + '-hint'));
      const side = nearestSide(e);
      applyDock(side);
      window.app?.toast?.('📌 رُسي شريط الأدوات: ' +
        ({ left: 'يسار', right: 'يمين', top: 'أعلى', bottom: 'أسفل' }[side]), 'info');
    });

    function nearestSide(e) {
      const r = main.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX, r.left), r.right);
      const y = Math.min(Math.max(e.clientY, r.top), r.bottom);
      const d = {
        left:   x - r.left,
        right:  r.right - x,
        top:    y - r.top,
        bottom: r.bottom - y,
      };
      return Object.keys(d).reduce((a, b) => (d[a] <= d[b] ? a : b));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
