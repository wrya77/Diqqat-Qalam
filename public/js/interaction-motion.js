/**
 * interaction-motion.js — سلوك القوائم واللوحات بمعايير سطح المكتب
 *
 * ما كان ناقصاً في شريط القوائم — وكلّه سلوكٌ يتوقّعه من استعمل إليستريتور:
 *
 *  ١) **لا تنقّل بلوحة المفاتيح إطلاقاً.** تفتح القائمة فلا تستطيع النزول
 *     فيها بسهم، ولا تفعيل عنصر بـEnter، ولا الانتقال للقائمة المجاورة
 *     بسهم أفقي. الفأر كان السبيل الوحيد.
 *  ٢) **لا ARIA.** قارئ الشاشة لا يعرف أن هذا زرّ يفتح قائمة، ولا أنها
 *     مفتوحة، ولا كم فيها من عنصر.
 *  ٣) **لا تعطيل.** «تراجع» يظهر صالحاً للنقر ولا تاريخ وراءه، و«نسخ»
 *     يظهر صالحاً بلا تحديد. القائمة تكذب على المستخدم ثم لا يحدث شيء.
 *  ٤) **لا انقلاب عند الحافّة.** القائمة قرب طرف الشاشة تُقصّ خارجها.
 *  ٥) **الطيّ يقفز.** `<details>` يُظهر ويُخفي فجأةً بلا ارتفاع محسوب.
 *
 * ولا شيء هنا يُعيد تعريف منطق `menu-bar.js` — كلّه إضافةٌ فوقه: نستمع
 * لأحداثه، ونقرأ صنف `.open` الذي يضعه، ولا نلمس سجلّ ACTIONS.
 */
(function interactionMotion() {
  'use strict';

  const ed = () => window.app && window.app.editor;
  const inField = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  };

  /* ═══════════════ ١) شريط القوائم ═══════════════ */

  function menus() { return [...document.querySelectorAll('#menubar .menu')]; }
  const openMenu = () => document.querySelector('#menubar .menu.open');
  const itemsOf = m => [...m.querySelectorAll('.mi:not([aria-disabled="true"])')]
    .filter(i => i.offsetParent !== null);

  function setCursor(menu, i) {
    const list = itemsOf(menu);
    if (!list.length) return;
    list.forEach(x => x.classList.remove('mp-cursor'));
    const n = ((i % list.length) + list.length) % list.length;
    const el = list[n];
    el.classList.add('mp-cursor');
    el.scrollIntoView({ block: 'nearest' });
    menu.__mpIdx = n;
  }

  function aria() {
    for (const m of menus()) {
      const btn = m.querySelector('.menu-btn');
      const drop = m.querySelector('.menu-drop');
      if (!btn || !drop) continue;
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', m.classList.contains('open') ? 'true' : 'false');
      drop.setAttribute('role', 'menu');
      if (!drop.id) drop.id = 'mp-drop-' + Math.random().toString(36).slice(2, 8);
      btn.setAttribute('aria-controls', drop.id);
      drop.querySelectorAll('.mi').forEach(i => i.setAttribute('role', 'menuitem'));
      drop.querySelectorAll('.mi-sep').forEach(s => s.setAttribute('role', 'separator'));
    }
  }

  /* التعطيل: القائمة يجب أن تقول الحقيقة قبل أن تُنقر */
  const GUARDS = {
    // canUndo/canRedo في editor-core خاصيّتان (getter) لا دالّتان — استدعاؤهما
    // بقوسين يرمي، فيبتلع الحارسُ الخطأ ويُبقي العنصر مفعَّلاً دائماً
    'edit-undo':  e => e.commands ? !!e.commands.canUndo : !!(e.history && e.history.length),
    'edit-redo':  e => e.commands ? !!e.commands.canRedo : !!(e.redoStack && e.redoStack.length),
    'sel-all':    e => e.shapes.length > 0,
    'edit-copy':  e => hasSel(e),
    'edit-dup':   e => hasSel(e),
    'edit-del':   e => hasSel(e),
    'sel-none':   e => hasSel(e),
    'sel-invert': e => e.shapes.length > 0,
    'delete-all': e => e.shapes.length > 0,
    'edit-paste': e => !!(e._clip || e._clipboard),
    'il-group':   e => selCount(e) >= 2,
    'il-ungroup': e => hasSel(e),
    'il-shear':   e => hasSel(e),
    'obj-topath': e => hasSel(e),
    'vp-offset':  e => hasSel(e),
    'vp-outline': e => hasSel(e),
    'vp-blend':   e => selCount(e) >= 2,
    'view-fit':   e => e.shapes.length > 0,
  };
  const selCount = e => (e.msel && e.msel.size) ? e.msel.size : (e.selectedIdx >= 0 ? 1 : 0);
  const hasSel = e => selCount(e) > 0;

  function syncDisabled(menu) {
    const e = ed();
    if (!e) return;
    menu.querySelectorAll('.mi[data-act]').forEach(it => {
      const g = GUARDS[it.dataset.act];
      if (!g) return;
      let ok = true;
      try { ok = !!g(e); } catch (_) { ok = true; }   // شكٌّ في الحارس = لا تُعطّل
      it.setAttribute('aria-disabled', ok ? 'false' : 'true');
    });
  }

  /* الانقلاب عند الحافّة: القائمة لا تُقصّ خارج الشاشة */
  function reposition(menu) {
    const drop = menu.querySelector('.menu-drop');
    if (!drop) return;
    drop.style.left = drop.style.right = '';
    const r = drop.getBoundingClientRect();
    if (r.left < 4) drop.style.right = `${Math.max(0, r.right - window.innerWidth + 8)}px`;
    else if (r.right > window.innerWidth - 4) drop.style.right = `${r.right - window.innerWidth + 8}px`;
    const maxH = window.innerHeight - r.top - 12;
    drop.style.maxHeight = maxH > 120 ? maxH + 'px' : '';
  }

  function openAt(menu, focusLast) {
    menus().forEach(m => { m.classList.remove('open'); m.__mpIdx = -1; });
    menu.classList.add('open');
    syncDisabled(menu);
    aria();
    reposition(menu);
    setCursor(menu, focusLast ? itemsOf(menu).length - 1 : 0);
  }

  function closeMenus() {
    menus().forEach(m => {
      m.classList.remove('open');
      m.__mpIdx = -1;
      m.querySelectorAll('.mp-cursor').forEach(x => x.classList.remove('mp-cursor'));
    });
    aria();
  }

  function wireMenus() {
    const bar = document.getElementById('menubar');
    if (!bar || bar.__mp) return;
    bar.__mp = true;
    aria();

    /* `menu-bar.js` يضع صنف `.open` ويستدعي `stopPropagation()` على زرّ القائمة،
       فلا يصلنا حدثُ نقرٍ مفوَّض. والمراقبة على تغيّر الصنف تلتقط كل طرق الفتح
       (نقر، مرور، برمجياً) وتعمل كمهمّة دقيقة — لا تعتمد على إطار رسم قد لا
       يأتي أصلاً حين تكون اللسان في الخلفية. */
    const watch = new MutationObserver(recs => {
      for (const r of recs) {
        const m = r.target;
        if (!m.classList || !m.classList.contains('menu')) continue;
        if (m.classList.contains('open')) {
          if (m.__mpOpen) continue;
          m.__mpOpen = true;
          syncDisabled(m); aria(); reposition(m); setCursor(m, 0);
        } else if (m.__mpOpen) {
          m.__mpOpen = false;
          m.__mpIdx = -1;
          m.querySelectorAll('.mp-cursor').forEach(x => x.classList.remove('mp-cursor'));
          aria();
        }
      }
    });
    menus().forEach(m => watch.observe(m, { attributes: true, attributeFilter: ['class'] }));

    // المرور بين القوائم المفتوحة: أعد ضبط المؤشر للقائمة الجديدة
    bar.addEventListener('mouseover', e => {
      const it = e.target.closest('.mi');
      const m = openMenu();
      if (!it || !m || !m.contains(it)) return;
      const list = itemsOf(m);
      const i = list.indexOf(it);
      if (i >= 0) setCursor(m, i);
    });

    // منع تفعيل عنصر معطَّل حتى لو نُقر برمجياً
    bar.addEventListener('click', e => {
      const it = e.target.closest('.mi');
      if (it && it.getAttribute('aria-disabled') === 'true') {
        e.stopPropagation(); e.preventDefault();
      }
    }, true);

    document.addEventListener('keydown', e => {
      const m = openMenu();

      // F10 أو Alt وحدها تفتح أول قائمة — عُرف سطح المكتب
      if (!m && e.key === 'F10' && !e.ctrlKey && !inField()) {
        e.preventDefault();
        const first = menus()[0];
        if (first) openAt(first, false);
        return;
      }
      if (!m) return;

      const list = itemsOf(m);
      const i = m.__mpIdx ?? 0;
      const all = menus();
      const mi = all.indexOf(m);

      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); setCursor(m, i + 1); break;
        case 'ArrowUp':   e.preventDefault(); setCursor(m, i - 1); break;
        case 'Home':      e.preventDefault(); setCursor(m, 0); break;
        case 'End':       e.preventDefault(); setCursor(m, list.length - 1); break;
        // في واجهة RTL يفتح السهم الأيسر القائمة التالية والأيمن السابقة
        case 'ArrowLeft': e.preventDefault(); openAt(all[(mi + 1) % all.length], false); break;
        case 'ArrowRight':e.preventDefault(); openAt(all[(mi - 1 + all.length) % all.length], false); break;
        case 'Escape':    e.preventDefault(); closeMenus(); document.querySelector('#menubar .menu-btn')?.blur(); break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (list[i]) { closeMenus(); list[i].click(); }
          break;
        case 'Tab':       closeMenus(); break;
        default:
          // الكتابة السريعة: أول حرف ينتقل لأول عنصر يبدأ به
          if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const ch = e.key.toLowerCase();
            const from = (i + 1) % list.length;
            for (let k = 0; k < list.length; k++) {
              const j = (from + k) % list.length;
              const t = list[j].textContent.trim().toLowerCase();
              if (t.startsWith(ch)) { e.preventDefault(); setCursor(m, j); break; }
            }
          }
      }
    });

    window.addEventListener('resize', () => { const m = openMenu(); if (m) reposition(m); });
  }

  /* ═══════════════ ٢) الطيّ الناعم للوحات ═══════════════
     `<details>` لا يُحرَّك أصلاً. نقيس الارتفاع قبل الفتح ونمرّره متغيّراً
     للحركة، فالانتقال يعرف إلى أين ينتهي بدل تخمين max-height كبير. */
  function wireFolds() {
    document.querySelectorAll('details.section').forEach(d => {
      if (d.__mp) return;
      d.__mp = true;
      const body = [...d.children].filter(c => c.tagName !== 'SUMMARY');
      d.addEventListener('toggle', () => {
        if (!d.open) { d.classList.remove('mp-anim'); return; }
        const h = body.reduce((a, c) => a + c.scrollHeight, 0);
        d.style.setProperty('--mp-h', (h + 24) + 'px');
        d.classList.add('mp-anim');
        setTimeout(() => d.classList.remove('mp-anim'), 260);
      });
    });
  }

  /* ═══════════════ ٣) حالة الانشغال أثناء العمليات الطويلة ═══════════════ */
  function wireBusy() {
    const long = ['btn-generate', 'btn-simulate', 'btn-export', 'btn-preflight'];
    for (const id of long) {
      const b = document.getElementById(id);
      if (!b || b.__mp) continue;
      b.__mp = true;
      b.addEventListener('click', () => {
        b.classList.add('mp-busy');
        // العمليات هنا متزامنة في معظمها — نرفع الحالة بعد إطارَي رسم
        setTimeout(() => b.classList.remove('mp-busy'), 600);
      });
    }
  }

  /* ═══════════════ ٤) وسم السحب على مستوى الجسم ═══════════════
     أي سحب في التطبيق (لوحة، شريط، مقبض) يضع صنفاً على body، فتتوقّف
     الأزرار عن التقاط المؤشر ويصير شكل المؤشر «قبضة» في كل مكان. */
  function wireDragFlag() {
    let down = false;
    document.addEventListener('mousedown', e => {
      if (e.target.closest('.dqw-tab, .tbf-grip, .rail-grip, .dqw-split, .odk-grip')) {
        down = true;
        document.body.classList.add('mp-dragging');
      }
    }, true);
    window.addEventListener('mouseup', () => {
      if (down) { down = false; document.body.classList.remove('mp-dragging'); }
    }, true);
  }

  function boot() {
    wireMenus();
    wireFolds();
    wireBusy();
    wireDragFlag();
    // لوحات تُبنى لاحقاً (لوحات الرسو الخمس، الأدراج) — راقب وأعد الربط
    new MutationObserver(() => { wireFolds(); }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
