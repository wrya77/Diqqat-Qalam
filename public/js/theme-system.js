/**
 * theme-system.js — فرض السمة الداكنة (حُذف الوضع النهاري)
 *
 *  التطبيق داكن دائماً كمحرّرات التصميم الاحترافية (Illustrator/Photoshop الداكن).
 *  يضبط data-theme=dark على الجذر، ويمرّر لوح ألوان اللوحة الداكن للمحرّر.
 *  يُبقي window.ThemeSystem كواجهة صامتة كي لا ينكسر أي مستدعٍ قديم.
 */
(function themeSystem() {
  'use strict';

  const CANVAS = { bg: '#0d1117', grid: '#161b22', axis: '#21262d', label: '#30363d' };

  function apply() {
    document.documentElement.setAttribute('data-theme', 'dark');

    const ed = window.app && window.app.editor;
    if (ed) { ed._canvasTheme = { ...CANVAS }; ed.render(); }

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = '#0d1117';
  }

  function boot() {
    // تنظيف أثر السمة الفاتحة القديمة من المتصفحات التي جرّبتها
    try { localStorage.removeItem('dq_theme'); } catch (e) {}
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.addEventListener('load', apply);   // ضمان تلوين اللوحة عند بدء بارد

  // واجهة صامتة — كل الطلبات تبقى على الداكن
  window.ThemeSystem = { set: apply, current: () => 'dark', toggle: apply };
})();
