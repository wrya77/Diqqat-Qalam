/**
 * ui-scale.js — منزلق حجم الواجهة (ميزة #8)
 *
 * يضبط المتغيّر --ui-scale على جذر المستند؛ قواعد ui-refine.css تطبّقه
 * بخاصية zoom على أشرطة الواجهة (القوائم/الإعدادات/المخرجات/شريط الأدوات)
 * دون لمس الكانفس — فلا تتأثر رياضيات الإحداثيات في المحرر إطلاقاً.
 *
 * يُحفَظ الاختيار في localStorage ويُستعاد عند كل إقلاع.
 * نقر مزدوج على قيمة النسبة = عودة إلى 100%.
 */
(function uiScale() {
  'use strict';

  const KEY = 'dq_ui_scale';
  const MIN = 85, MAX = 130, DEF = 100;

  function apply(pct) {
    const v = Math.min(MAX, Math.max(MIN, +pct || DEF));
    document.documentElement.style.setProperty('--ui-scale', v / 100);
    const lbl = document.getElementById('ui-scale-val');
    if (lbl) lbl.textContent = v + '%';
    return v;
  }

  function boot() {
    const saved = +localStorage.getItem(KEY) || DEF;
    apply(saved);

    const slider = document.getElementById('ui-scale');
    if (!slider) return;
    slider.min = MIN; slider.max = MAX; slider.step = 5;
    slider.value = saved;

    slider.addEventListener('input', () => apply(slider.value));
    slider.addEventListener('change', () => {
      const v = apply(slider.value);
      localStorage.setItem(KEY, String(v));
    });

    // نقر مزدوج على النسبة = إعادة الضبط
    document.getElementById('ui-scale-val')?.addEventListener('dblclick', () => {
      slider.value = DEF;
      apply(DEF);
      localStorage.setItem(KEY, String(DEF));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
