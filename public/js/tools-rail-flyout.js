(function () {
  function init() {
    const rail = document.getElementById('tools-rail');
    if (!rail || rail.dataset.flyoutReady === '1') return;
    rail.dataset.flyoutReady = '1';

    const children = Array.from(rail.children);
    const groups = [];
    let current = null;
    for (const el of children) {
      if (el.classList.contains('tr-group-label')) {
        if (current) groups.push(current);
        current = { label: el.textContent.trim(), buttons: [] };
      } else if (el.classList.contains('tr-sep')) {
        // group boundary
      } else if (el.classList.contains('tr-btn')) {
        if (!current) current = { label: '', buttons: [] };
        current.buttons.push(el);
      }
    }
    if (current) groups.push(current);

    rail.innerHTML = '';

    let activeFlyout = null;

    function closeAll() {
      if (activeFlyout) {
        activeFlyout.style.display = 'none';
        activeFlyout = null;
      }
    }

    function positionFlyout(flyout, arrow) {
      const r = arrow.getBoundingClientRect();
      flyout.style.top = r.top + 'px';
      flyout.style.left = (r.right + 6) + 'px';
    }

    groups.forEach((g, idx) => {
      if (idx > 0) {
        const sep = document.createElement('div');
        sep.className = 'tr-sep';
        rail.appendChild(sep);
      }
      if (g.label) {
        const lbl = document.createElement('div');
        lbl.className = 'tr-group-label';
        lbl.textContent = g.label;
        rail.appendChild(lbl);
      }

      const slot = document.createElement('div');
      slot.className = 'tr-slot';
      const hasMany = g.buttons.length > 1;
      if (hasMany) slot.classList.add('has-flyout');

      const primary = g.buttons[0];
      slot.appendChild(primary);

      if (hasMany) {
        const arrow = document.createElement('button');
        arrow.className = 'tr-arrow';
        arrow.type = 'button';
        slot.appendChild(arrow);

        const flyout = document.createElement('div');
        flyout.className = 'tr-flyout';
        flyout.style.display = 'none';
        g.buttons.forEach(btn => flyout.appendChild(btn.cloneNode(true)));
        document.body.appendChild(flyout);

        function toggleFlyout(e) {
          e.preventDefault();
          e.stopPropagation();
          if (activeFlyout && activeFlyout !== flyout) {
            activeFlyout.style.display = 'none';
          }
          if (flyout.style.display === 'none') {
            positionFlyout(flyout, slot);
            flyout.style.display = 'flex';
            activeFlyout = flyout;
          } else {
            flyout.style.display = 'none';
            activeFlyout = null;
          }
        }

        arrow.addEventListener('click', toggleFlyout);
        arrow.addEventListener('mousedown', function (e) { e.stopPropagation(); });

        primary.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          toggleFlyout(e);
        });

        // فتح بالمرور (نمط Illustrator/CorelDraw) — يكشف كل أدوات المجموعة دون البحث
        // عن سهم صغير. مهلة فتح تمنع الوميض، ومهلة إغلاق تسمح بالانتقال إلى القائمة.
        let openTimer = null, closeTimer = null;
        function openHover() {
          clearTimeout(closeTimer);
          if (activeFlyout && activeFlyout !== flyout) activeFlyout.style.display = 'none';
          positionFlyout(flyout, slot);
          flyout.style.display = 'flex';
          activeFlyout = flyout;
        }
        function scheduleClose() {
          clearTimeout(openTimer);
          closeTimer = setTimeout(function () {
            if (activeFlyout === flyout) { flyout.style.display = 'none'; activeFlyout = null; }
          }, 280);
        }
        slot.addEventListener('mouseenter', function () {
          clearTimeout(closeTimer);
          openTimer = setTimeout(openHover, 180);
        });
        slot.addEventListener('mouseleave', function () { clearTimeout(openTimer); scheduleClose(); });
        flyout.addEventListener('mouseenter', function () { clearTimeout(closeTimer); });
        flyout.addEventListener('mouseleave', scheduleClose);

        flyout.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        flyout.addEventListener('click', function (e) {
          e.stopPropagation();
          const btn = e.target.closest('.tr-btn');
          if (!btn) return;
          const tool = btn.dataset.tool;
          flyout.style.display = 'none';
          activeFlyout = null;
          if (primary.dataset.tool !== tool) {
            primary.innerHTML = btn.innerHTML;
            primary.title = btn.title;
            primary.dataset.tool = tool;
          }
          primary.click();
        });
      }

      rail.appendChild(slot);
    });

    document.addEventListener('mousedown', function () { closeAll(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
