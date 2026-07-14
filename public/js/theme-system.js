/**
 * theme-system.js — سمة فاتحة/داكنة (ميزة #5)
 *
 *  الواجهة كلها مبنية على متغيّرات CSS (--bg/--text/--accent…)، فتبديل السمة
 *  يضبط سمة data-theme على الجذر وتُعيد قواعد ui-refine.css تلوين كل شيء.
 *  اللوحة (canvas) وحدها ترسم بألوان صريحة، فنمرّر لها لوح ألوان مطابقاً عبر
 *  editor._canvasTheme ثم نعيد الرسم.
 *
 *  يُحفَظ الاختيار في localStorage ويُستعاد عند الإقلاع (الافتراضي: داكن).
 */
(function themeSystem() {
  'use strict';

  const KEY = 'dq_theme';
  const CANVAS = {
    dark:  { bg: '#0d1117', grid: '#161b22', axis: '#21262d', label: '#30363d' },
    light: { bg: '#f6f8fa', grid: '#e3e8ee', axis: '#c8d0d8', label: '#8a94a0' },
  };

  function current() {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  }

  function apply(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);

    // لوح ألوان اللوحة + إعادة رسم
    const ed = window.app && window.app.editor;
    if (ed) { ed._canvasTheme = { ...CANVAS[t] }; ed.render(); }

    // تحديث لون meta theme-color لشريط المتصفح على الجوال
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = t === 'light' ? '#ffffff' : '#0d1117';

    // مزامنة الأزرار
    document.querySelectorAll('.theme-seg button').forEach(b => b.classList.toggle('on', b.dataset.theme === t));
    return t;
  }

  function set(theme) {
    const t = apply(theme);
    localStorage.setItem(KEY, t);
    window.app?.toast?.(t === 'light' ? '☀️ السمة الفاتحة' : '🌙 السمة الداكنة', 'info');
  }

  /* حقن مبدّل السمة في قسم «🖥 الواجهة» بلوحة الإعدادات */
  function injectToggle() {
    const scaleRow = document.querySelector('.ui-scale-row');
    if (!scaleRow || document.getElementById('theme-seg')) return;
    const wrap = document.createElement('label');
    wrap.className = 'theme-row';
    wrap.innerHTML = `السمة
      <span class="theme-seg" id="theme-seg">
        <button data-theme="dark" type="button">🌙 داكن</button>
        <button data-theme="light" type="button">☀️ فاتح</button>
      </span>`;
    scaleRow.parentElement.insertBefore(wrap, scaleRow.nextSibling);
    wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => set(b.dataset.theme)));
  }

  function boot() {
    injectToggle();
    apply(current());   // يطبّق المحفوظ (يشمل لوحة الرسم إن كان app جاهزاً)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // إعادة التطبيق بعد جاهزية app (لضمان تلوين اللوحة عند بدء بارد)
  window.addEventListener('load', () => apply(current()));

  window.ThemeSystem = { set, current, toggle: () => set(current() === 'light' ? 'dark' : 'light') };
})();
