/**
 * redesign.js — سلوكيات تحسينات الواجهة
 *  • Fix #15: تعطيل أزرار (توليد/تصدير/محاكاة/فحص) عند خلوّ اللوحة مع تلميح
 *  • منع النقر على الأزرار المعطّلة منطقياً دون كسر معالجات app.js
 *  • ربط زر الاستيراد في اللوحة الفارغة بزر الاستيراد الفعلي
 * لا يلمس منطق الكانفاس أو توليد G-Code.
 */
(function redesignBehaviors() {
  'use strict';

  const IDS  = ['btn-generate', 'btn-export', 'btn-simulate', 'btn-preflight'];
  const HINT = 'ارسم شيئاً أولاً';
  const orig = {};

  function setState(hasContent) {
    IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (hasContent) {
        el.removeAttribute('data-disabled');
        el.removeAttribute('aria-disabled');
        el.removeAttribute('data-tip');           // أعد قراءة العنوان الأصلي عند المرور
        if (orig[id]) el.setAttribute('title', orig[id]); else el.removeAttribute('title');
      } else {
        el.setAttribute('data-disabled', 'true');
        el.setAttribute('aria-disabled', 'true');
        el.removeAttribute('data-tip');
        el.setAttribute('title', HINT);
      }
    });
  }

  function shapeCount() {
    const el = document.getElementById('shape-count');
    if (!el) return 0;
    const m = (el.textContent || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function init() {
    // احفظ العناوين الأصلية قبل أن يحوّلها نظام التلميحات
    IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) orig[id] = el.getAttribute('title') || '';
    });

    // امنع تنفيذ إجراء الأزرار المعطّلة منطقياً (طور الالتقاط قبل معالج app)
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-disabled="true"]');
      if (b) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // زر الاستيراد في اللوحة الفارغة → يفتح حوار الاستيراد الفعلي
    document.getElementById('empty-import')
      ?.addEventListener('click', () => document.getElementById('btn-import')?.click());

    const sc = document.getElementById('shape-count');
    setState(shapeCount() > 0);
    if (sc) {
      new MutationObserver(() => setState(shapeCount() > 0))
        .observe(sc, { childList: true, characterData: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
