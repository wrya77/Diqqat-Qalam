/**
 * menu-bar.js — شريط قوائم احترافي بنمط CorelDraw / Illustrator
 * القوائم تستدعي أزرار/دوال موجودة — لا منطق مكرر
 */
(function menuBar() {
  'use strict';

  const ed = () => window.app && window.app.editor;

  /* سجل الإجراءات: اسم → دالة */
  const ACTIONS = {
    // ملف
    'file-new':     () => window.app?.newProject(),
    'file-open':    () => document.getElementById('btn-load-project')?.click(),
    'file-save':    () => document.getElementById('btn-save-project')?.click(),
    'file-import':  () => document.getElementById('btn-import')?.click(),
    'file-trace':   () => document.getElementById('btn-image-trace')?.click(),
    'file-export':  () => document.getElementById('btn-export')?.click(),

    // تحرير
    'edit-undo':    () => document.getElementById('btn-undo')?.click(),
    'edit-redo':    () => document.getElementById('btn-redo')?.click(),
    'edit-copy':    () => ed()?._copy(),
    'edit-paste':   () => ed()?._paste(),
    'edit-dup':     () => ed()?._duplicate(),
    'edit-del':     () => ed()?._deleteSelected(),
    'sel-all':      () => ed()?.selectAll(),
    'sel-invert':   () => ed()?.invertSelection(),
    'sel-none':     () => ed()?.clearSelection(),

    // عرض
    'view-zoom-in':  () => document.getElementById('btn-zoom-in')?.click(),
    'view-zoom-out': () => document.getElementById('btn-zoom-out')?.click(),
    'view-zoom-100': () => ed()?.zoom100(),
    'view-fit':      () => document.getElementById('btn-zoom-fit')?.click(),
    'view-grid':     () => toggleCheck('show-grid'),
    'view-snap':     () => toggleCheck('snap-grid'),
    'view-osnap':    () => toggleCheck('snap-objects'),
    'view-order':    () => ed()?.toggleCutOrder(),
    'view-dir':      () => ed()?.toggleDirection(),

    // كائن
    'obj-precise':  () => document.getElementById('btn-precise')?.click(),
    'obj-pocket':   () => document.getElementById('btn-pocket-toggle')?.click(),
    'align-left':    () => ed()?.alignSelected('left'),
    'align-hcenter': () => ed()?.alignSelected('hcenter'),
    'align-right':   () => ed()?.alignSelected('right'),
    'align-top':     () => ed()?.alignSelected('top'),
    'align-vcenter': () => ed()?.alignSelected('vcenter'),
    'align-bottom':  () => ed()?.alignSelected('bottom'),
    'dist-h':        () => ed()?.distributeSelected('h'),
    'dist-v':        () => ed()?.distributeSelected('v'),
    'order-front':    () => ed()?.reorderSelected('front'),
    'order-forward':  () => ed()?.reorderSelected('forward'),
    'order-backward': () => ed()?.reorderSelected('backward'),
    'order-back':     () => ed()?.reorderSelected('back'),
    'tr-mirror-h':  () => document.getElementById('st-mirror-h')?.click(),
    'tr-mirror-v':  () => document.getElementById('st-mirror-v')?.click(),
    'tr-rotate':    () => document.getElementById('st-rotate')?.click(),
    'tr-scale':     () => document.getElementById('st-scale')?.click(),
    'tr-array':     () => document.getElementById('st-array')?.click(),
    'tr-offset':    () => document.getElementById('st-offset')?.click(),
    'cnc-nesting':    () => document.getElementById('dlg-nesting')?.showModal(),
    'cnc-bolt':       () => document.getElementById('dlg-boltcircle')?.showModal(),
    'cnc-join':       () => ed()?.joinSelected(),
    'cnc-centermark': () => ed()?.insertCenterMark(),
    'cnc-bbox':       () => ed()?.insertBoundingBox(),
    'cnc-unlock':     () => ed()?.unlockAll(),

    // تأثيرات
    'fx-wave':      () => ed()?.applyEffect('wave'),
    'fx-roughen':   () => ed()?.applyEffect('roughen'),
    'fx-smooth':    () => ed()?.applyEffect('smooth'),
    'fx-simplify':  () => ed()?.applyEffect('simplify'),
    'fx-perforate': () => ed()?.applyEffect('perforate'),
    'fx-twirl':     () => ed()?.applyEffect('twirl'),
    'fx-bloat':     () => ed()?.applyEffect('bloat'),
    'fx-stair':     () => ed()?.applyEffect('stair'),
    'fx-hatchfill': () => ed()?.applyEffect('hatchfill'),
    'fx-shadow':    () => ed()?.applyEffect('shadow'),

    // أدوات
    'tool-preflight':() => window.app?.preflight(),
    'tool-presets':  () => document.getElementById('btn-presets')?.click(),
    'tool-validate': () => document.getElementById('btn-validate-gcode')?.click(),
    'tool-library':  () => document.getElementById('btn-tool-library')?.click(),
    'tool-machine':  () => document.getElementById('btn-machine-panel')?.click(),
    'tool-upgrade':  () => document.getElementById('btn-upgrade')?.click(),
  };

  function toggleCheck(id) {
    const c = document.getElementById(id);
    if (!c) return;
    c.checked = !c.checked;
    c.dispatchEvent(new Event('change'));
  }

  function closeAll() {
    document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
  }

  function init() {
    const bar = document.getElementById('menubar');
    if (!bar) return;

    bar.querySelectorAll('.menu > .menu-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const menu = btn.parentElement;
        const wasOpen = menu.classList.contains('open');
        closeAll();
        if (!wasOpen) {
          menu.classList.add('open');
          syncChecks(menu);
        }
      });
      // فتح بالمرور عندما تكون قائمة أخرى مفتوحة (سلوك سطح المكتب)
      btn.addEventListener('mouseenter', () => {
        if (document.querySelector('.menu.open') && !btn.parentElement.classList.contains('open')) {
          closeAll();
          btn.parentElement.classList.add('open');
          syncChecks(btn.parentElement);
        }
      });
    });

    bar.querySelectorAll('.mi[data-act]').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        closeAll();
        ACTIONS[item.dataset.act]?.();
      });
    });

    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
  }

  // ضع ✓ أمام خيارات العرض المفعلة
  function syncChecks(menu) {
    menu.querySelectorAll('.mi[data-check]').forEach(item => {
      const c = document.getElementById(item.dataset.check);
      item.classList.toggle('checked', !!(c && c.checked));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
