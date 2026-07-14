/**
 * layers-float.js — لوحة طبقات عائمة مستقلة بنمط Illustrator/Photoshop
 *
 *  ينقل نظام الطبقات من قائمة الإعدادات إلى لوحة عائمة فوق الكانفس (يمين):
 *    • قابلة للسحب من رأسها · للطيّ · للإخفاء (مع لسان إعادة فتح)
 *    • تحتفظ بموضعها وحالتها في localStorage
 *    • تعيد استخدام #layers-list و #layer-add كي يبقى layers-panel.js يعمل كما هو
 *
 *  يُحمَّل بعد layers-panel.js. لا يكرّر منطق الطبقات — واجهة فقط.
 */
(function layersFloat() {
  'use strict';
  const KEY = 'dq_layers_float';
  const st = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const save = o => localStorage.setItem(KEY, JSON.stringify({ ...st(), ...o }));

  function injectCSS() {
    if (document.getElementById('lyrf-css')) return;
    const s = document.createElement('style');
    s.id = 'lyrf-css';
    s.textContent = `
      .lyrf{position:fixed;z-index:1200;width:262px;background:var(--bg1,#0d1117);
        border:1px solid var(--border2,#3d444d);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.42);
        display:flex;flex-direction:column;overflow:hidden;transition:box-shadow .18s,opacity .18s}
      .lyrf.dragging{box-shadow:0 24px 60px rgba(0,0,0,.55);opacity:.96;user-select:none}
      .lyrf-head{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;cursor:grab;
        background:linear-gradient(180deg,var(--bg3,#1c2128),var(--bg2,#161b22));border-bottom:1px solid var(--border,#30363d)}
      .lyrf-head:active{cursor:grabbing}
      .lyrf-title{font-size:13px;font-weight:700;color:var(--text,#e6edf3);display:flex;align-items:center;gap:7px}
      .lyrf-title .lyrf-badge{font-size:10px;color:var(--text3,#8b949e);font-weight:500}
      .lyrf-actions{display:flex;gap:2px}
      .lyrf-actions button{width:24px;height:24px;border:none;background:none;color:var(--text3,#8b949e);
        cursor:pointer;font-size:13px;border-radius:6px;line-height:1;transition:.12s}
      .lyrf-actions button:hover{background:var(--bg4,#21262d);color:var(--text,#e6edf3)}
      .lyrf-body{padding:10px;max-height:min(60vh,460px);overflow-y:auto}
      .lyrf.collapsed .lyrf-body{display:none}
      .lyrf-tab{position:fixed;z-index:1200;top:150px;inline-size:auto;display:none;
        padding:8px 12px;background:var(--bg1,#0d1117);border:1px solid var(--border2,#3d444d);
        border-radius:10px;color:var(--text2,#b1bac4);cursor:pointer;font-size:12.5px;font-family:inherit;
        box-shadow:0 8px 24px rgba(0,0,0,.35);display:none;align-items:center;gap:6px}
      .lyrf-tab.show{display:inline-flex}
      .lyrf-tab:hover{border-color:var(--accent,#4f6ef7);color:var(--text,#e6edf3)}

      /* صفوف طبقات أنظف داخل اللوحة العائمة */
      .lyrf .lyr-toolbar{margin-bottom:9px}
      .lyrf .lyr-hint{font-size:10.5px}
      .lyrf #layers-list{gap:4px}
      .lyrf .lyr-row{padding:7px 8px;gap:6px;background:var(--bg2,#161b22);border:1px solid var(--border,#30363d)}
      .lyrf .lyr-row:hover{background:var(--bg3,#1c2128);border-color:var(--border2,#3d444d)}
      .lyrf .lyr-row.active{border-color:var(--accent,#4f6ef7);
        background:color-mix(in srgb,var(--accent,#4f6ef7) 14%,var(--bg2,#161b22))}
      .lyrf .lyr-name{font-size:12.5px;color:var(--text,#e6edf3)}
      .lyrf .lyr-row.active .lyr-name{font-weight:600}
    `;
    document.head.appendChild(s);
  }

  let panel, tab;

  function build() {
    injectCSS();
    panel = document.createElement('div');
    panel.className = 'lyrf';
    panel.id = 'lyrf';
    panel.innerHTML = `
      <div class="lyrf-head" id="lyrf-drag">
        <span class="lyrf-title">🗂 الطبقات <span class="lyrf-badge">تنظيم القطع/النقش</span></span>
        <span class="lyrf-actions">
          <button id="lyrf-collapse" title="طيّ/فتح">▾</button>
          <button id="lyrf-hide" title="إخفاء اللوحة">✕</button>
        </span>
      </div>
      <div class="lyrf-body">
        <div class="lyr-toolbar">
          <span class="lyr-hint">نظّم الأشكال: قطع · نقش · تخطيط</span>
          <button id="layer-add" type="button">＋ طبقة</button>
        </div>
        <div id="layers-list"></div>
      </div>`;
    document.body.appendChild(panel);

    tab = document.createElement('button');
    tab.className = 'lyrf-tab';
    tab.innerHTML = '🗂 الطبقات';
    document.body.appendChild(tab);

    // الموضع الابتدائي (يمين أعلى الكانفس) أو المحفوظ
    const s = st();
    if (s.left != null) { panel.style.left = s.left + 'px'; panel.style.top = s.top + 'px'; panel.style.right = 'auto'; }
    else { panel.style.right = '18px'; panel.style.top = '150px'; }
    if (s.collapsed) { panel.classList.add('collapsed'); document.getElementById('lyrf-collapse').textContent = '▸'; }
    if (s.hidden) { panel.style.display = 'none'; tab.classList.add('show'); }

    wireControls();
    wireDrag();
  }

  function wireControls() {
    document.getElementById('lyrf-collapse').addEventListener('click', () => {
      const c = panel.classList.toggle('collapsed');
      document.getElementById('lyrf-collapse').textContent = c ? '▸' : '▾';
      save({ collapsed: c });
    });
    document.getElementById('lyrf-hide').addEventListener('click', () => {
      panel.style.display = 'none'; tab.classList.add('show'); save({ hidden: true });
    });
    tab.addEventListener('click', () => {
      panel.style.display = ''; tab.classList.remove('show'); save({ hidden: false });
    });
  }

  function wireDrag() {
    const head = document.getElementById('lyrf-drag');
    let sx, sy, ox, oy, drag = false;
    head.addEventListener('mousedown', e => {
      if (e.target.closest('.lyrf-actions')) return;
      drag = true; panel.classList.add('dragging');
      const r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px'; panel.style.right = 'auto';
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const w = panel.offsetWidth, h = panel.offsetHeight;
      let nl = ox + (e.clientX - sx), nt = oy + (e.clientY - sy);
      nl = Math.max(4, Math.min(nl, innerWidth - w - 4));
      nt = Math.max(4, Math.min(nt, innerHeight - 40));
      panel.style.left = nl + 'px'; panel.style.top = nt + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = false; panel.classList.remove('dragging');
      save({ left: parseInt(panel.style.left), top: parseInt(panel.style.top) });
    });
  }

  function boot() {
    if (document.getElementById('lyrf')) return;
    build();
    const paint = () => { const ed = window.app?.editor; if (ed) ed._renderLayersPanel(); else setTimeout(paint, 200); };
    setTimeout(paint, 350);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.LayersFloat = { show: () => { panel.style.display = ''; tab.classList.remove('show'); save({ hidden: false }); } };
})();
