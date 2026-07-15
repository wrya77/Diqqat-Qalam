/**
 * icons.js — نظام أيقونات SVG موحّد (يحلّ محلّ الإيموجي الوظيفية)
 *
 *  مصدر واحد للحقيقة: سجلّ أيقونات خطّية بشبكة 16×16، تُرسم بـcurrentColor
 *  بنفس أسلوب أيقونات الشريط القائمة (class="ti": stroke 1.4، أطراف دائرية).
 *
 *  الاستخدام في HTML:  <span class="ti-ph" data-icon="wrench"></span>
 *    عند الإقلاع يُملأ العنصر بالأيقونة؛ يرث لون النصّ المحيط تلقائياً.
 *  الاستخدام في JS:    el.innerHTML = DQIcon('x');   // سلسلة <svg>
 *
 *  لا يغيّر أي id/class؛ يضيف فقط <svg> داخل العناصر الحاملة data-icon.
 */
(function iconSystem() {
  'use strict';

  // كل قيمة: محتوى داخل <svg viewBox="0 0 16 16"> بنمط خطّي (fill=none, stroke=currentColor)
  const I = {
    // ── كروم عام ──
    settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>',
    page: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
    menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    check: '<path d="M3 8.5L6.5 12 13 4.5"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/>',
    trash: '<path d="M3 4.5h10M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M4.5 4.5l.7 8.5a1 1 0 001 1h3.6a1 1 0 001-1l.7-8.5"/>',
    pencil: '<path d="M11 2.5l2.5 2.5-8 8H3v-2.5z"/><path d="M10 3.5l2.5 2.5"/>',
    clipboard: '<rect x="4" y="3" width="8" height="11" rx="1.5"/><rect x="6" y="1.8" width="4" height="2.4" rx=".8"/><path d="M6 7.5h4M6 10h4"/>',
    download: '<path d="M8 2v8M5 7l3 3 3-3"/><path d="M2.5 11v2a1 1 0 001 1h9a1 1 0 001-1v-2"/>',
    fullscreen: '<path d="M2 6V3.5A1.5 1.5 0 013.5 2H6M10 2h2.5A1.5 1.5 0 0114 3.5V6M14 10v2.5a1.5 1.5 0 01-1.5 1.5H10M6 14H3.5A1.5 1.5 0 012 12.5V10"/>',
    'fullscreen-exit': '<path d="M6 2v2.5A1.5 1.5 0 014.5 6H2M14 6h-2.5A1.5 1.5 0 0110 4.5V2M10 14v-2.5a1.5 1.5 0 011.5-1.5H14M2 10h2.5A1.5 1.5 0 016 11.5V14"/>',

    // ── عناوين أقسام لوحة الإعدادات ──
    dimensions: '<path d="M2 11.5V4.5M14 11.5V4.5M2 8h12"/><path d="M2 4.5h3M2 11.5h3M11 4.5h3M11 11.5h3"/>',
    wrench: '<path d="M10.5 2.2a3.2 3.2 0 00-3.9 4.2L2.4 10.6a1.4 1.4 0 002 2l4.2-4.2a3.2 3.2 0 004.2-3.9l-2 2-1.6-.4-.4-1.6z"/>',
    ruler: '<rect x="2" y="5.5" width="12" height="5" rx="1" transform="rotate(-20 8 8)"/><path d="M5.5 6.2v1.6M8 5.4v2M10.5 4.6v1.8"/>',
    zap: '<path d="M9 1.5L3 9h4l-1 5.5L13 7H8z"/>',
    target: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>',
    'arrow-down-line': '<path d="M8 2v7.5M5 7l3 3 3-3"/><path d="M3.5 13.5h9"/>',
    cpu: '<rect x="4" y="4" width="8" height="8" rx="1"/><rect x="6.2" y="6.2" width="3.6" height="3.6" rx=".5"/><path d="M6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2"/>',
    sparkles: '<path d="M8 2.5l1.1 3.1L12 6.7 9.1 7.8 8 11 6.9 7.8 4 6.7l2.9-1.1z"/><path d="M12.5 10.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z"/>',
    palette: '<path d="M8 2a6 6 0 000 12c1 0 1.5-.7 1.5-1.4 0-.4-.2-.7-.4-1-.2-.2-.4-.6-.4-1 0-.7.6-1.3 1.3-1.3H11a3 3 0 003-3c0-2.9-2.7-5-6-5z"/><circle cx="5.5" cy="7" r=".9"/><circle cx="8" cy="5" r=".9"/><circle cx="10.5" cy="7" r=".9"/>',
    history: '<path d="M2.5 8a5.5 5.5 0 105.5-5.5A5.5 5.5 0 003 6"/><path d="M2.5 3v3h3"/><path d="M8 5.2V8l2 1.4"/>',

    // ── إضافية للأقسام اللاحقة ──
    layers: '<path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/>',
    eye: '<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
    unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 014.9-.6"/>',
    library: '<rect x="2.5" y="3" width="4" height="10" rx=".8"/><rect x="7" y="3" width="3" height="10" rx=".8"/><path d="M11 3.5l2.3.6-2 9.4-2.3-.6z"/>',
    chain: '<path d="M6.5 9.5a2.5 2.5 0 010-3.5l1.5-1.5a2.5 2.5 0 013.5 3.5l-.8.8"/><path d="M9.5 6.5a2.5 2.5 0 010 3.5L8 11.5a2.5 2.5 0 01-3.5-3.5l.8-.8"/>',

    // ── قوائم: عرض/كائن/محاذاة/تحويل ──
    'list-ordered': '<path d="M6 4.5h8M6 8h8M6 11.5h8"/><path d="M2.5 3.2v2.6M2 3.4l.7-.4M2 11h1.4L2 12.8v.6h1.6"/>',
    'arrow-cut': '<path d="M3 8h8"/><path d="M8 5l3 3-3 3"/>',
    rect: '<rect x="2.5" y="4.5" width="11" height="7" rx="1"/>',
    'corner-round': '<path d="M3 13V7a4 4 0 014-4h6"/>',
    'corner-chamfer': '<path d="M3 13V7l4-4h6"/>',
    blend: '<circle cx="5" cy="8" r="3"/><circle cx="11" cy="8" r="3"/><path d="M8 8h0" stroke-dasharray="1 1.4"/>',
    polar: '<circle cx="8" cy="8" r="1.6"/><path d="M8 3.5V1.5M8 14.5v-2M3.5 8h-2M14.5 8h-2M4.8 4.8L3.4 3.4M12.6 12.6l-1.4-1.4M11.2 4.8l1.4-1.4M4.8 11.2l-1.4 1.4"/>',
    'dist-h': '<path d="M2.5 3v10M13.5 3v10"/><rect x="6.5" y="5.5" width="3" height="5" rx=".6"/>',
    'dist-v': '<path d="M3 2.5h10M3 13.5h10"/><rect x="5.5" y="6.5" width="5" height="3" rx=".6"/>',
    'arrow-up': '<path d="M8 13V3M4.5 6.5L8 3l3.5 3.5"/>',
    'arrow-down': '<path d="M8 3v10M4.5 9.5L8 13l3.5-3.5"/>',
    'mirror-h': '<path d="M8 2v12" stroke-dasharray="2 2"/><path d="M6 5L3 8l3 3zM10 5l3 3-3 3"/>',
    'mirror-v': '<path d="M2 8h12" stroke-dasharray="2 2"/><path d="M5 6L8 3l3 3zM5 10l3 3 3-3"/>',
    rotate: '<path d="M13 8A5 5 0 1 0 12 11"/><path d="M13 3.5V7h-3.5"/>',
    scale: '<rect x="2.5" y="2.5" width="6" height="6" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke-dasharray="2 1.6"/><path d="M9 6l4 4M13 6.5V10h-3.5"/>',
    grid: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 6.5h11M2.5 10h11M6.5 2.5v11M10 2.5v11"/>',
    'bolt-circle': '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="3.5" r=".9"/><circle cx="8" cy="12.5" r=".9"/><circle cx="3.5" cy="8" r=".9"/><circle cx="12.5" cy="8" r=".9"/>',
    merge: '<path d="M3 3v3a4 4 0 004 4h6"/><path d="M3 13v-3a4 4 0 014-4h6"/><path d="M11 8l2 2-2 2"/>',
    crosshair: '<circle cx="8" cy="8" r="2"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/>',
    bbox: '<rect x="3" y="3" width="10" height="10" rx="1" stroke-dasharray="2.5 2"/>',

    // ── قوائم: CNC+ / الابتكار / التأثيرات ──
    dogbone: '<rect x="5" y="6.5" width="6" height="3" rx="1"/><circle cx="4.5" cy="6" r="1.6"/><circle cx="4.5" cy="10" r="1.6"/><circle cx="11.5" cy="6" r="1.6"/><circle cx="11.5" cy="10" r="1.6"/>',
    hash: '<path d="M6 2.5L4.5 13.5M11 2.5L9.5 13.5M3 5.5h10M2.5 10.5h10"/>',
    'dots-path': '<path d="M2 12c3-8 9-8 12 0" stroke-dasharray="1.5 2"/><circle cx="2" cy="12" r="1.1"/><circle cx="8" cy="5.5" r="1.1"/><circle cx="14" cy="12" r="1.1"/>',
    clamp: '<rect x="5" y="6" width="6" height="7" rx="1"/><path d="M5 6V3.5h6V6M7 3.5V2M9 3.5V2"/>',
    clock: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.4"/>',
    star: '<path d="M8 2l1.7 3.9 4.3.4-3.2 2.8 1 4.2L8 11.2 4.2 13.3l1-4.2L2 6.3l4.3-.4z"/>',
    'arc-join': '<path d="M2.5 12a6 6 0 0111 0"/><circle cx="2.5" cy="12" r="1.1"/><circle cx="13.5" cy="12" r="1.1"/>',
    swap: '<path d="M3 6h8M9 3.5L11.5 6 9 8.5"/><path d="M13 10H5M7 7.5L4.5 10 7 12.5"/>',
    broom: '<path d="M10.5 2.5l3 3M12 4L6.5 9.5M6.5 9.5l-4 4M6.5 9.5l3 3M5 11l-2 .5.5-2"/>',
    'text-vertical': '<path d="M8 2.5v11M5.5 5V3.5h5V5M6 13.5h4"/>',
    wand: '<path d="M4 12l7-7M11 5l1.5-1.5"/><path d="M12.5 2v2M12.5 7v2M10 4.5h2M14 4.5h-2"/>',
    shapes: '<circle cx="5.5" cy="8" r="3.2"/><rect x="8" y="5" width="5.5" height="5.5" rx="1"/>',
    hand: '<path d="M6 8V4a1.2 1.2 0 012.4 0v3M8.4 7V3.4a1.2 1.2 0 012.4 0V8M10.8 8V5.4a1.2 1.2 0 012.2.5V10a4 4 0 01-4 4H8l-3.4-3.4a1.2 1.2 0 011.8-1.6L6 8z"/>',
    spiral: '<path d="M8 8a1 1 0 011-1 2.5 2.5 0 01.8 4.9 4 4 0 01-5-4.7A5.5 5.5 0 0113.5 8"/>',
    circle: '<circle cx="8" cy="8" r="5.5"/>',
    stairs: '<path d="M2.5 13.5V11h3.5V7.5h3.5V4h3.5"/>',
    simplify: '<path d="M2.5 11c2 0 3-6 5.5-6s3.5 6 5.5 6" stroke-dasharray="3 2"/>',
    hatch: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 8l5.5-5.5M2.5 12.5l10-10M7 13.5l6.5-6.5M11.5 13.5l2-2"/>',

    // ── قوائم: مساعدة / أدوات / موسّعة ──
    box: '<path d="M8 2l5.5 3v6L8 14l-5.5-3V5z"/><path d="M2.5 5L8 8l5.5-3M8 8v6"/>',
    cap: '<path d="M8 3l6 3-6 3-6-3z"/><path d="M4.5 7v3.5c0 1 1.5 2 3.5 2s3.5-1 3.5-2V7"/>',
    'check-circle': '<circle cx="8" cy="8" r="6"/><path d="M5.2 8L7 9.8 10.8 6"/>',
    monitor: '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 14h4M8 11v3"/>',
    receipt: '<path d="M4 2h8v12l-2-1.2L8 14l-2-1.2L4 14z"/><path d="M6 5h4M6 8h4"/>',
    pen: '<path d="M11.5 2.5l2 2-7.5 7.5-3 1 1-3z"/><path d="M3.5 12.5L2 14"/>',
    'bar-chart': '<path d="M2.5 13.5h11"/><rect x="3.5" y="8" width="2.4" height="4"/><rect x="6.8" y="5" width="2.4" height="7"/><rect x="10.1" y="9.5" width="2.4" height="2.5"/>',
    coin: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.8v6.4M6.5 6.2h2.2a1.3 1.3 0 010 2.6H6.5h2.2a1.3 1.3 0 010 2.6H6.5"/>',
    shuffle: '<path d="M2.5 4.5H5l6 7h2.5M2.5 11.5H5l2-2.3M9.5 5.8l1.5-1.3H13.5"/><path d="M11.5 2.5L13.5 4.5 11.5 6.5M11.5 9.5l2 2-2 2"/>',
    alert: '<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11h0"/>',
    save: '<path d="M3 3h7l3 3v7H3z"/><path d="M5.5 3v3h4V3M5.5 13v-4h5v4"/>',

    // ── محاذاة + إزاحة الكفاف ──
    offset: '<path d="M8 3.5a4.5 4.5 0 100 9 4.5 4.5 0 100-9z"/><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 100-13z" stroke-dasharray="2 1.8"/>',
    'align-left': '<path d="M2.5 2v12"/><rect x="4.5" y="3.5" width="8" height="3" rx=".8"/><rect x="4.5" y="9.5" width="5" height="3" rx=".8"/>',
    'align-right': '<path d="M13.5 2v12"/><rect x="3.5" y="3.5" width="8" height="3" rx=".8"/><rect x="6.5" y="9.5" width="5" height="3" rx=".8"/>',
    'align-hcenter': '<path d="M8 2v12"/><rect x="4" y="3.5" width="8" height="3" rx=".8"/><rect x="5.5" y="9.5" width="5" height="3" rx=".8"/>',
    'align-top': '<path d="M2 2.5h12"/><rect x="3.5" y="4.5" width="3" height="8" rx=".8"/><rect x="9.5" y="4.5" width="3" height="5" rx=".8"/>',
    'align-bottom': '<path d="M2 13.5h12"/><rect x="3.5" y="3.5" width="3" height="8" rx=".8"/><rect x="9.5" y="6.5" width="3" height="5" rx=".8"/>',
    'align-vcenter': '<path d="M2 8h12"/><rect x="3.5" y="4" width="3" height="8" rx=".8"/><rect x="9.5" y="5.5" width="3" height="5" rx=".8"/>',

    // ── ترتيب/تجميع/تحويل/تأثيرات إضافية ──
    'bring-front': '<rect x="5" y="5" width="7" height="7" rx="1"/><path d="M3 8.5V3.5A.5.5 0 013.5 3H9"/>',
    'send-back': '<rect x="4" y="4" width="7" height="7" rx="1"/><path d="M13 7.5v5a.5.5 0 01-.5.5H7"/>',
    group: '<rect x="3" y="3" width="4.5" height="4.5" rx=".8"/><rect x="8.5" y="8.5" width="4.5" height="4.5" rx=".8"/><path d="M2 5.5h-.5M14 10.5h.5M5.5 2v-.5M10.5 14v.5"/>',
    ungroup: '<rect x="2.5" y="2.5" width="5" height="5" rx=".8"/><rect x="8.5" y="8.5" width="5" height="5" rx=".8" stroke-dasharray="2 1.6"/>',
    'plus-node': '<path d="M2 12c3-7 9-7 12 0"/><path d="M8 5.5v4M6 7.5h4"/>',
    boxes: '<rect x="2.5" y="2.5" width="5" height="5" rx=".8"/><rect x="8.5" y="2.5" width="5" height="5" rx=".8"/><rect x="2.5" y="8.5" width="5" height="5" rx=".8"/><rect x="8.5" y="8.5" width="5" height="5" rx=".8"/>',
    shear: '<path d="M5 3h7l-2 10H3z"/>',
    smooth: '<path d="M2 10c2 0 2.5-5 5-5s3 5 6 4" stroke-linecap="round"/>',
    dashed: '<path d="M2 8h2M6 8h2M10 8h2M14 8h.5" stroke-dasharray="0" stroke-linecap="round"/>',
    shadow: '<rect x="3" y="3" width="7" height="7" rx="1"/><path d="M6.5 10.5h3.5a1 1 0 001-1V6" opacity=".5"/>',
    tabs: '<path d="M2.5 12.5V8h11v4.5z"/><path d="M5.5 8V5.5h2V8M8.5 8V5.5h2V8"/>',
  };

  function svg(name) {
    const body = I[name];
    if (!body) return '';
    return `<svg class="ti" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
  }

  // ترقية كل عنصر يحمل data-icon (يُبقي أي نصّ شقيق كما هو)
  function upgrade(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => {
      const name = el.getAttribute('data-icon');
      if (!name || el.querySelector('svg')) return;   // مُرقّى مسبقاً
      const markup = svg(name);
      if (markup) el.insertAdjacentHTML('afterbegin', markup);
    });
  }

  function boot() { upgrade(document); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.DQIcon = svg;            // سلسلة <svg> لاستخدام JS
  window.DQIcons = { upgrade, names: () => Object.keys(I) };
})();
