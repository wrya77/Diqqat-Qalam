/**
 * color-library.js — صندوق الألوان الموحّد + مكتبة ألوان كاملة
 *
 *  صندوق واحد يجمع كل ما يخصّ اللون في مكان واحد:
 *    • هدف التطبيق: خط ⇄ تعبئة
 *    • مكتبة كاملة منظّمة: رمادّيات + 14 عائلة لونية × 5 درجات
 *    • لون مخصّص: منتقٍ + إدخال HEX
 *    • الألوان الأخيرة
 *    • تدرّج 🌈 + ملتقط 💧 (يفوّضان لأدوات color-tools)
 *
 *  يُفتح بزر «📚» في شريط الألوان. يعتمد window.ColorSystem.apply.
 */
(function colorLibrary() {
  'use strict';
  const apply = (t, c) => window.ColorSystem && window.ColorSystem.apply(t, c);

  /* ── توليد مكتبة منظّمة ── */
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => { const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return Math.round(255 * c); };
    return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  const GRAYS = ['#ffffff', '#f2f4f7', '#d0d7de', '#9aa4af', '#6a737d', '#424a53', '#24292f', '#000000'];
  const HUES = [
    ['أحمر', 0, 78], ['برتقالي', 24, 82], ['كهرماني', 38, 85], ['أصفر', 52, 88],
    ['ليموني', 80, 70], ['أخضر', 140, 60], ['زمردي', 160, 62], ['تركوازي', 178, 62],
    ['سماوي', 198, 72], ['أزرق', 216, 78], ['نيلي', 240, 70], ['بنفسجي', 268, 68],
    ['أرجواني', 292, 62], ['وردي', 330, 72],
  ];
  const SHADES = [82, 68, 55, 43, 32];   // فاتح → غامق
  // صفوف: صفّ رمادّيات ثم صفّ لكل درجة عبر كل العائلات؟ الأنسب: عمود لكل عائلة، صفّ لكل درجة
  function libraryHTML() {
    let cells = GRAYS.map(c => sw(c)).join('');
    const grayRow = `<div class="cl-row" title="رمادّيات">${cells}</div>`;
    let rows = '';
    for (const L of SHADES) {
      rows += `<div class="cl-row">` + HUES.map(([n, h, s]) => sw(hslHex(h, s, L), n)).join('') + `</div>`;
    }
    return grayRow + rows;
  }
  const sw = (c, name) => `<button class="cl-sw" data-c="${c}" style="background:${c}" title="${(name ? name + ' ' : '') + c}"></button>`;

  /* ── الحالة ── */
  let target = 'stroke', box, built = false;

  function recents() { try { return JSON.parse(localStorage.getItem('dq_recent_colors') || '[]'); } catch (e) { return []; } }

  function injectCSS() {
    if (document.getElementById('cl-css')) return;
    const st = document.createElement('style');
    st.id = 'cl-css';
    st.textContent = `
      .cl-pop{position:fixed;z-index:3200;width:330px;background:var(--bg1,#0d1117);
        border:1px solid var(--border2,#3d444d);border-radius:14px;box-shadow:0 22px 60px rgba(0,0,0,.5);
        padding:14px;display:none}
      .cl-pop.open{display:block;animation:clIn .13s cubic-bezier(.22,1,.36,1)}
      @keyframes clIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
      .cl-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
      .cl-title{font-size:14px;font-weight:700;color:var(--text,#e6edf3)}
      .cl-x{background:none;border:none;color:var(--text3,#8b949e);font-size:18px;cursor:pointer;line-height:1}
      .cl-seg{display:flex;border:1px solid var(--border2,#3d444d);border-radius:9px;overflow:hidden;margin-bottom:12px}
      .cl-seg button{flex:1;padding:7px;border:none;background:var(--bg2,#161b22);color:var(--text2,#b1bac4);
        cursor:pointer;font-size:12.5px;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px}
      .cl-seg button.on{background:var(--accent,#4f6ef7);color:#fff}
      .cl-seg .cl-chip{width:13px;height:13px;border-radius:3px;border:1px solid rgba(255,255,255,.35)}
      .cl-sec{font-size:10.5px;color:var(--text3,#8b949e);margin:10px 0 5px;letter-spacing:.03em}
      .cl-lib{display:flex;flex-direction:column;gap:4px}
      .cl-row{display:grid;grid-template-columns:repeat(14,1fr);gap:4px}
      .cl-row[title]{grid-template-columns:repeat(8,1fr)}
      .cl-sw{aspect-ratio:1;border:1px solid rgba(128,128,128,.28);border-radius:5px;cursor:pointer;
        padding:0;transition:transform .1s,box-shadow .1s}
      .cl-sw:hover{transform:scale(1.18);box-shadow:0 2px 8px rgba(0,0,0,.4);z-index:1;border-color:var(--accent,#4f6ef7)}
      .cl-custom{display:flex;align-items:center;gap:8px;margin-top:4px}
      .cl-custom input[type=color]{width:38px;height:30px;border:1px solid var(--border2,#3d444d);border-radius:7px;background:none;padding:0;cursor:pointer}
      .cl-hex{flex:1;background:var(--bg2,#161b22);border:1px solid var(--border,#30363d);border-radius:7px;
        color:var(--text,#e6edf3);padding:6px 9px;font-family:var(--font-mono,monospace);font-size:12.5px}
      .cl-none{padding:6px 10px;border:1px solid var(--border2,#3d444d);border-radius:7px;background:var(--bg2,#161b22);
        color:var(--red,#f85149);cursor:pointer;font-size:13px}
      .cl-recents{display:flex;gap:5px;flex-wrap:wrap;min-height:22px}
      .cl-recents .cl-sw{width:22px;height:22px;aspect-ratio:auto;flex:0 0 auto}
      .cl-recents .cl-empty{font-size:11px;color:var(--text3,#8b949e)}
      .cl-actions{display:flex;gap:8px;margin-top:12px}
      .cl-actions button{flex:1;padding:8px;border:1px solid var(--border2,#3d444d);border-radius:8px;
        background:var(--bg2,#161b22);color:var(--text2,#b1bac4);cursor:pointer;font-size:12.5px;font-family:inherit;
        display:flex;align-items:center;justify-content:center;gap:6px;transition:.12s}
      .cl-actions button:hover{border-color:var(--accent,#4f6ef7);color:var(--text,#e6edf3)}
    `;
    document.head.appendChild(st);
  }

  function build() {
    injectCSS();
    box = document.createElement('div');
    box.className = 'cl-pop'; box.dir = 'rtl';
    box.innerHTML = `
      <div class="cl-head"><span class="cl-title">🎨 صندوق الألوان</span><button class="cl-x">✕</button></div>
      <div class="cl-seg" id="cl-seg">
        <button data-t="stroke" class="on"><span class="cl-chip" id="cl-chip-stroke"></span> الخط</button>
        <button data-t="fill"><span class="cl-chip" id="cl-chip-fill"></span> التعبئة</button>
      </div>
      <div class="cl-sec">المكتبة</div>
      <div class="cl-lib">${libraryHTML()}</div>
      <div class="cl-sec">لون مخصّص</div>
      <div class="cl-custom">
        <input type="color" id="cl-picker" value="#4f6ef7">
        <input type="text" class="cl-hex" id="cl-hex" placeholder="#RRGGBB" spellcheck="false">
        <button class="cl-none" id="cl-none" title="بلا لون">∅</button>
      </div>
      <div class="cl-sec">الألوان الأخيرة</div>
      <div class="cl-recents" id="cl-recents"></div>
      <div class="cl-actions">
        <button id="cl-eyedrop">💧 ملتقط</button>
        <button id="cl-gradient">🌈 تدرّج</button>
      </div>`;
    document.body.appendChild(box);

    box.querySelector('.cl-x').addEventListener('click', close);
    box.querySelectorAll('.cl-seg button').forEach(b => b.addEventListener('click', () => setTarget(b.dataset.t)));
    box.querySelectorAll('.cl-lib .cl-sw').forEach(b => b.addEventListener('click', () => pick(b.dataset.c)));
    const picker = box.querySelector('#cl-picker'), hex = box.querySelector('#cl-hex');
    picker.addEventListener('input', () => { hex.value = picker.value; });
    picker.addEventListener('change', () => pick(picker.value, true));
    hex.addEventListener('change', () => { let v = hex.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) pick(v[0] === '#' ? v : '#' + v, true); });
    box.querySelector('#cl-none').addEventListener('click', () => { apply(target, null); });
    box.querySelector('#cl-eyedrop').addEventListener('click', () => { close(); window.ColorTools?.eyedropper(); });
    box.querySelector('#cl-gradient').addEventListener('click', e => { close(); window.ColorTools?.gradient(document.getElementById('clr-gradient') || e.currentTarget); });
    document.addEventListener('mousedown', e => {
      if (box.classList.contains('open') && !box.contains(e.target) && e.target.id !== 'clr-library') close();
    });
    built = true;
  }

  function setTarget(t) {
    target = t === 'fill' ? 'fill' : 'stroke';
    box.querySelectorAll('.cl-seg button').forEach(b => b.classList.toggle('on', b.dataset.t === target));
  }

  function pick(color, keepOpen) {
    apply(target, color);
    if (!keepOpen) renderRecents();
    renderRecents();
  }

  function renderRecents() {
    const box2 = document.getElementById('cl-recents');
    if (!box2) return;
    const rec = recents();
    box2.innerHTML = rec.length
      ? rec.map(c => `<button class="cl-sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')
      : '<span class="cl-empty">— لا ألوان بعد —</span>';
    box2.querySelectorAll('.cl-sw').forEach(b => b.addEventListener('click', () => pick(b.dataset.c)));
  }

  function syncChips() {
    const st = window.app?.editor;
    const g = id => document.getElementById(id);
    // اعرض ألوان الافتراضي/المحدد إن توفّرت
    const s = g('cl-chip-stroke'), f = g('cl-chip-fill');
    if (s) s.style.background = getComputedStyle(document.getElementById('clr-stroke-chip') || document.body).backgroundColor || '#888';
    if (f) f.style.background = getComputedStyle(document.getElementById('clr-fill-chip') || document.body).backgroundColor || 'transparent';
  }

  function open(anchor) {
    if (!built) build();
    renderRecents(); syncChips();
    box.classList.add('open');
    const r = (anchor || document.getElementById('color-bar')).getBoundingClientRect();
    const w = 330, left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    box.style.left = left + 'px';
    box.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    box.style.top = 'auto';
  }
  function close() { box && box.classList.remove('open'); }

  /* زر الفتح في شريط الألوان */
  function injectButton() {
    const tools = document.getElementById('clr-tools');
    if (!tools || document.getElementById('clr-library')) return;
    const btn = document.createElement('button');
    btn.className = 'clr-toolbtn'; btn.id = 'clr-library'; btn.title = 'مكتبة الألوان الكاملة';
    btn.textContent = '📚';
    tools.appendChild(btn);
    btn.addEventListener('click', () => box && box.classList.contains('open') ? close() : open(btn));
  }

  document.addEventListener('colorbar:ready', injectButton);
  if (document.getElementById('clr-tools')) injectButton();

  window.ColorLibrary = { open, close };
})();
