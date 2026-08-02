(function () {
  /* أفعال داخل الشريط: أزرار تحمل data-act بدل data-tool — فعل يُنفَّذ فوراً
     ولا يصير «الأداة الفعّالة» ولا يحلّ محلّ الزرّ الرئيسي للمجموعة.
     مُعلَنة عالمياً ليستعملها object-dock في لوحة «الأدوات» أيضاً. */
  const ACTS = {
    'sel-all': () => {
      const ed = window.app && window.app.editor;
      if (!ed) return;
      // setTool أولاً: تبديل الأداة يستدعي _cancelDraw فيمسح أي تحديد قبله
      if (ed.tool !== 'select') ed.setTool('select');
      ed.selectAll();
    },
  };
  window.DQToolAct = ACTS;
  function runAct(name) { try { ACTS[name] && ACTS[name](); } catch (e) { console.error('[rail act] ' + name, e); } }
  window.DQRunToolAct = runAct;

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

    // مصدر واحد لفتح/إغلاق القائمة الطائرة — يبقي aria-expanded على السهم
    // متزامناً مع العرض؛ كتابة display مباشرةً في عشرة مواضع كانت تُفقد المزامنة.
    function setFly(fl, open) {
      if (!fl) return;
      fl.style.display = open ? 'flex' : 'none';
      if (fl.__arrow) fl.__arrow.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function closeAll() {
      if (activeFlyout) {
        setFly(activeFlyout, false);
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
        // بلا نصّ مرئيّ (مثلّث CSS فقط) — فيلزم اسم للقارئ الشاشيّ وحالة الفتح
        const gname = g.label || (primary.title || '').split(' ')[0] || 'الأدوات';
        arrow.setAttribute('aria-label', `أدوات ${gname} الإضافية`);
        arrow.setAttribute('aria-haspopup', 'true');
        arrow.setAttribute('aria-expanded', 'false');
        arrow.title = `المزيد — ${gname}`;
        slot.appendChild(arrow);

        const flyout = document.createElement('div');
        flyout.className = 'tr-flyout';
        flyout.__arrow = arrow;
        setFly(flyout, false);
        g.buttons.forEach(btn => flyout.appendChild(btn.cloneNode(true)));
        document.body.appendChild(flyout);

        function toggleFlyout(e) {
          e.preventDefault();
          e.stopPropagation();
          if (activeFlyout && activeFlyout !== flyout) {
            setFly(activeFlyout, false);
          }
          if (flyout.style.display === 'none') {
            positionFlyout(flyout, slot);
            setFly(flyout, true);
            activeFlyout = flyout;
          } else {
            setFly(flyout, false);
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
          if (activeFlyout && activeFlyout !== flyout) setFly(activeFlyout, false);
          positionFlyout(flyout, slot);
          setFly(flyout, true);
          activeFlyout = flyout;
        }
        function scheduleClose() {
          clearTimeout(openTimer);
          closeTimer = setTimeout(function () {
            if (activeFlyout === flyout) { setFly(flyout, false); activeFlyout = null; }
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
          setFly(flyout, false);
          activeFlyout = null;
          // زرّ فعل: نفّذ وانصرف — لا يستبدل الزرّ الرئيسي ولا يغيّر الأداة
          if (btn.dataset.act) { runAct(btn.dataset.act); return; }
          const tool = btn.dataset.tool;
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
