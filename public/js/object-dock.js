/**
 * object-dock.js — شريط الكائن: لوحة جانبية مرساة بنمط Illustrator بثلاثة تبويبات
 *
 *   🗂 الطبقات   — يستضيف #layers-list و #layer-add فيبقى layers-panel.js يعمل كما هو
 *                  (حلّ محلّ اللوحة العائمة layers-float.js)
 *   ⬡ الكائنات  — كل أشكال التصميم في قائمة: نقر = تحديد · Ctrl+نقر = تحديد متعدد
 *                  · 👁 إظهار/إخفاء من الإخراج · 🔒 قفل
 *   ⌨ اختصارات — مرجع اختصارات الكيبورد كاملاً داخل التطبيق
 *
 *  مرن بالكامل: تحجيم بالسحب من حافته · طيّ إلى شريط أيقونات نحيف · إخفاء مع
 *  لسان إعادة فتح · F7 يبدّل الإظهار (كلوحة طبقات Illustrator). الحالة في localStorage.
 *  واجهة فقط — لا منطق هندسي؛ يقرأ ed.shapes ويحدّد عبر selectedIdx/msel القائمة.
 */
(function objectDock() {
  'use strict';
  const KEY = 'dq_object_dock';
  const st = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const save = o => localStorage.setItem(KEY, JSON.stringify({ ...st(), ...o }));
  const ed = () => window.app && window.app.editor;

  const AR_TYPE = {
    line: 'خط', rect: 'مستطيل', circle: 'دائرة', ellipse: 'بيضوي', arc: 'قوس',
    polygon: 'مضلّع', slot: 'فتحة', polyline: 'مسار', compound: 'مركّب', text: 'نص',
  };
  const ICONS = {
    line: '╱', rect: '▭', circle: '◯', ellipse: '⬭', arc: '◜',
    polygon: '⬡', slot: '▢', polyline: '〰', compound: '⧉', text: 'ن',
  };

  /* ══ الأنماط ══ */
  function injectCSS() {
    if (document.getElementById('odk-css')) return;
    const s = document.createElement('style');
    s.id = 'odk-css';
    s.textContent = `
      .odk{position:absolute;z-index:900;top:10px;bottom:10px;right:10px;width:264px;
        background:var(--bg2,#161b22);border:1px solid var(--border2,#3d444d);border-radius:12px;
        box-shadow:var(--shadow-float,0 16px 44px rgba(0,0,0,.42));
        display:flex;flex-direction:column;overflow:hidden;
        transition:width .2s cubic-bezier(.22,1,.36,1)}
      .odk.resizing{transition:none}
      .odk-head{display:flex;align-items:stretch;flex-shrink:0;
        background:var(--bg1,#0d1117);border-bottom:1px solid var(--border,#30363d)}
      .odk-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;
        padding:9px 4px;border:none;background:none;cursor:pointer;position:relative;
        color:var(--text3,#8b949e);font-family:inherit;font-size:12px;font-weight:600;
        transition:color .18s ease,background .18s ease;white-space:nowrap}
      .odk-tab:hover{color:var(--text2,#b1bac4)}
      .odk-tab.on{color:var(--accent-h,#58a6ff);
        background:linear-gradient(180deg,color-mix(in srgb,var(--accent,#2f81f7) 10%,transparent),transparent)}
      .odk-tab.on::after{content:'';position:absolute;left:14%;right:14%;bottom:-1px;height:2px;
        background:var(--accent-h,#58a6ff);border-radius:2px 2px 0 0;
        animation:dqTabBar .22s cubic-bezier(.22,1,.36,1)}
      .odk-actions{display:flex;align-items:center;gap:1px;padding:0 4px;border-inline-start:1px solid var(--border,#30363d)}
      .odk-actions button{width:24px;height:24px;border:none;background:none;color:var(--text3,#8b949e);
        cursor:pointer;font-size:13px;border-radius:6px;line-height:1;
        transition:background .12s ease,color .12s ease,transform .12s cubic-bezier(.22,1,.36,1)}
      .odk-actions button:hover{background:var(--bg4,#21262d);color:var(--text,#e6edf3)}
      .odk-actions button:active{transform:scale(.9)}
      .odk-body{flex:1;overflow-y:auto;padding:10px}
      .odk-pane{display:none}
      .odk-pane.on{display:block;animation:dqPaneIn .2s cubic-bezier(.22,1,.36,1)}

      /* ── مقبض تحجيم على الحافة المواجهة للكانفس (يسار اللوحة في RTL) ── */
      .odk-resize{position:absolute;top:0;left:0;width:6px;height:100%;
        cursor:ew-resize;z-index:5;background:transparent;transition:background .15s ease}
      .odk-resize:hover,.odk-resize.active{background:var(--accent,#2f81f7)}

      /* ── الوضع المطويّ: شريط أيقونات نحيف ── */
      .odk.collapsed{width:44px}
      .odk.collapsed .odk-body,.odk.collapsed .odk-resize{display:none}
      .odk.collapsed .odk-head{flex-direction:column;border-bottom:none;background:transparent}
      .odk.collapsed .odk-tab{flex:0 0 auto;padding:11px 0}
      .odk.collapsed .odk-tab .odk-tab-label{display:none}
      .odk.collapsed .odk-tab.on::after{left:auto;right:-1px;top:14%;bottom:14%;height:auto;width:2px;
        border-radius:2px 0 0 2px;animation:none}
      .odk.collapsed .odk-actions{flex-direction:column;border-inline-start:none;
        border-top:1px solid var(--border,#30363d);margin-top:4px;padding:4px 0}

      /* ── لسان إعادة الفتح عند الإخفاء ── */
      .odk-reopen{position:fixed;top:170px;z-index:800;display:none;align-items:center;gap:6px;
        padding:9px 11px;border:1px solid var(--border2,#3d444d);border-radius:10px;cursor:pointer;
        background:var(--bg2,#161b22);color:var(--text2,#b1bac4);font-family:inherit;font-size:12.5px;
        box-shadow:var(--shadow-float,0 16px 44px rgba(0,0,0,.42));
        transition:color .15s ease,border-color .15s ease}
      .odk-reopen:hover{color:var(--text,#e6edf3);border-color:var(--accent,#2f81f7)}
      .odk-reopen.show{display:inline-flex}

      /* ── تبويب الكائنات ── */
      .odk-obj-empty{font-size:12px;color:var(--text3,#8b949e);padding:6px 2px;line-height:1.7}
      .odk-obj-count{font-size:10.5px;color:var(--text3,#8b949e);margin-bottom:8px}
      .odk-obj-list{display:flex;flex-direction:column;gap:3px}
      .odk-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;cursor:pointer;
        border:1px solid transparent;background:var(--bg1,#0d1117) ;
        transition:background .12s ease,border-color .12s ease}
      .odk-row:hover{background:var(--bg3,#1c2128);border-color:var(--border,#30363d)}
      .odk-row.sel{border-color:var(--accent,#2f81f7);
        background:color-mix(in srgb,var(--accent,#2f81f7) 14%,var(--bg1,#0d1117))}
      .odk-row-ic{width:18px;text-align:center;color:var(--accent-h,#58a6ff);font-size:13px;flex-shrink:0}
      .odk-row-name{flex:1;font-size:12.5px;color:var(--text,#e6edf3);min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .odk-row.sel .odk-row-name{font-weight:600}
      .odk-row.off .odk-row-name{color:var(--text3,#8b949e);text-decoration:line-through}
      .odk-row button{width:22px;height:20px;border:none;background:none;cursor:pointer;
        color:var(--text3,#8b949e);font-size:12px;border-radius:5px;line-height:1;flex-shrink:0;
        transition:background .12s ease,color .12s ease}
      .odk-row button:hover{background:var(--bg4,#21262d);color:var(--text,#e6edf3)}
      .odk-row button.act{color:var(--amber,#d29922)}

      /* ── تبويب الاختصارات ── */
      .odk-keys h4{font-size:11px;font-weight:700;color:var(--text3,#8b949e);
        letter-spacing:.03em;margin:12px 0 6px}
      .odk-keys h4:first-child{margin-top:0}
      .odk-key-row{display:flex;align-items:center;justify-content:space-between;gap:8px;
        padding:4px 2px;font-size:12px;color:var(--text2,#b1bac4)}
      .odk-key-row kbd{display:inline-flex;align-items:center;justify-content:center;
        min-width:20px;height:19px;padding:0 6px;flex-shrink:0;
        background:var(--bg1,#0d1117);color:var(--text2,#b1bac4);
        border:1px solid var(--border2,#3d444d);border-bottom-width:2px;border-radius:4px;
        font-family:var(--font-mono,monospace);font-size:10.5px;font-weight:700;line-height:1;direction:ltr}

      @media (max-width:1024px){.odk,.odk-reopen{display:none !important}}
    `;
    document.head.appendChild(s);
  }

  /* ══ اختصارات الكيبورد (مرجع ثابت — مصدره canvas-editor/ui-controls/القوائم) ══ */
  const KEY_GROUPS = [
    ['تحرير', [
      ['Ctrl+Z', 'تراجع'], ['Ctrl+Y', 'إعادة'], ['Ctrl+C', 'نسخ'], ['Ctrl+V', 'لصق'],
      ['Ctrl+D', 'تكرار'], ['Ctrl+A', 'تحديد الكل'], ['Del', 'حذف المحدد'],
      ['Ctrl+Del', 'حذف كل الأشكال'], ['Esc', 'إلغاء التحديد/الرسم'],
    ]],
    ['أدوات الرسم', [
      ['V', 'تحديد'], ['H', 'تحريك اللوحة'], ['L', 'خط'], ['R', 'مستطيل'],
      ['C', 'دائرة'], ['E', 'بيضوي'], ['A', 'قوس'], ['G', 'مضلّع'],
      ['S', 'فتحة'], ['P', 'بولي خط'], ['F', 'رسم حر'], ['T', 'نقش نص'], ['Z', 'تكبير'],
    ]],
    ['تنظيم', [
      ['Ctrl+G', 'تجميع'], ['Ctrl+Shift+G', 'فك التجميع'], ['Ctrl+J', 'ربط/إغلاق المسار'],
      ['Shift+W', 'العصا السحرية'], ['Shift+M', 'منشئ الأشكال'],
    ]],
    ['تحريك دقيق وعرض', [
      ['أسهم', 'تحريك المحدد 1mm'], ['Shift+أسهم', 'تحريك 10mm'], ['Alt+أسهم', 'تحريك 0.1mm'],
      ['Ctrl+0', 'ملاءمة العرض'], ['Enter', 'توليد G-Code'], ['F7', 'إظهار/إخفاء هذا الشريط'],
    ]],
  ];

  let dock, reopen, objList, objCount;

  function build() {
    injectCSS();
    const host = document.querySelector('.canvas-area') || document.body;

    dock = document.createElement('div');
    dock.className = 'odk dq-pop-in';
    dock.id = 'object-dock';
    dock.innerHTML = `
      <div class="odk-head">
        <button class="odk-tab on" data-pane="layers" title="الطبقات">🗂<span class="odk-tab-label"> الطبقات</span></button>
        <button class="odk-tab" data-pane="objects" title="الكائنات">⬡<span class="odk-tab-label"> الكائنات</span></button>
        <button class="odk-tab" data-pane="keys" title="اختصارات الكيبورد">⌨<span class="odk-tab-label"> اختصارات</span></button>
        <span class="odk-actions">
          <button id="odk-collapse" title="طيّ إلى شريط نحيف">⇥</button>
          <button id="odk-hide" title="إخفاء (F7)">✕</button>
        </span>
      </div>
      <div class="odk-body">
        <div class="odk-pane on" data-pane="layers">
          <div class="lyr-toolbar">
            <span class="lyr-hint">نظّم الأشكال: قطع · نقش · تخطيط</span>
            <button id="layer-add" type="button">＋ طبقة</button>
          </div>
          <div id="layers-list"></div>
        </div>
        <div class="odk-pane" data-pane="objects">
          <div class="odk-obj-count" id="odk-obj-count"></div>
          <div class="odk-obj-list" id="odk-obj-list"></div>
        </div>
        <div class="odk-pane odk-keys" data-pane="keys">
          ${KEY_GROUPS.map(([title, rows]) => `<h4>${title}</h4>` +
            rows.map(([k, label]) => `<div class="odk-key-row"><span>${label}</span><kbd>${k}</kbd></div>`).join('')
          ).join('')}
        </div>
      </div>
      <div class="odk-resize" title="اسحب لتغيير عرض الشريط"></div>`;
    host.appendChild(dock);

    reopen = document.createElement('button');
    reopen.className = 'odk-reopen';
    reopen.innerHTML = '⬡ شريط الكائن';
    reopen.style.right = '0';
    reopen.style.borderRight = 'none';
    reopen.style.borderRadius = '10px 0 0 10px';
    document.body.appendChild(reopen);

    objList = dock.querySelector('#odk-obj-list');
    objCount = dock.querySelector('#odk-obj-count');

    // استعادة الحالة
    const s = st();
    if (s.collapsed) dock.classList.add('collapsed');
    else if (s.width) dock.style.width = s.width + 'px';
    if (s.hidden) { dock.style.display = 'none'; reopen.classList.add('show'); }
    if (s.pane) activate(s.pane);

    wire();
  }

  function activate(pane) {
    dock.querySelectorAll('.odk-tab[data-pane]').forEach(t => t.classList.toggle('on', t.dataset.pane === pane));
    dock.querySelectorAll('.odk-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === pane));
    save({ pane });
    if (pane === 'objects') renderObjects();
  }

  function setHidden(v) {
    dock.style.display = v ? 'none' : '';
    reopen.classList.toggle('show', v);
    save({ hidden: v });
  }

  function wire() {
    dock.querySelectorAll('.odk-tab[data-pane]').forEach(t =>
      t.addEventListener('click', () => {
        // في الوضع المطويّ: النقر على تبويب يفتح الشريط عليه
        if (dock.classList.contains('collapsed')) {
          dock.classList.remove('collapsed');
          dock.style.width = st().width ? st().width + 'px' : '';
          save({ collapsed: false });
        }
        activate(t.dataset.pane);
      }));

    dock.querySelector('#odk-collapse').addEventListener('click', () => {
      const c = dock.classList.toggle('collapsed');
      // العرض المضمّن (من التحجيم اليدوي) يغلب class width — أزله عند الطيّ وأعده عند الفتح
      dock.style.width = c ? '' : (st().width ? st().width + 'px' : '');
      save({ collapsed: c });
    });
    dock.querySelector('#odk-hide').addEventListener('click', () => setHidden(true));
    reopen.addEventListener('click', () => setHidden(false));

    // F7 يبدّل الإظهار (كلوحة الطبقات في Illustrator)
    document.addEventListener('keydown', e => {
      if (e.key !== 'F7') return;
      const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      if (inInput) return;
      e.preventDefault();
      setHidden(dock.style.display !== 'none');
    });

    // تحجيم بالسحب من الحافة المواجهة للكانفس (اللوحة على يمين الكانفس في RTL)
    const handle = dock.querySelector('.odk-resize');
    let drag = null;
    handle.addEventListener('mousedown', e => {
      drag = { x: e.clientX, w: dock.offsetWidth };
      handle.classList.add('active'); dock.classList.add('resizing');
      document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      // السحب بعيداً عن اللوحة (يساراً) يوسّعها
      const w = Math.min(400, Math.max(200, drag.w + (drag.x - e.clientX)));
      dock.style.width = w + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null; handle.classList.remove('active'); dock.classList.remove('resizing');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      save({ width: dock.offsetWidth });
    });
  }

  /* ══ تبويب الكائنات ══ */
  function selSet(e) {
    const out = new Set();
    if (e.msel && e.msel.size) e.msel.forEach(i => out.add(i));
    else if (e.selectedIdx >= 0) out.add(e.selectedIdx);
    return out;
  }

  function renderObjects() {
    if (!objList) return;
    const e = ed();
    if (!e || !e.shapes.length) {
      objCount.textContent = '';
      objList.innerHTML = '<div class="odk-obj-empty">لا كائنات بعد — ارسم شكلاً أو استورد ملفاً وستظهر عناصره هنا.</div>';
      return;
    }
    const sel = selSet(e);
    objCount.textContent = `${e.shapes.length} كائن${sel.size ? ` · ${sel.size} محدد` : ''}`;
    objList.innerHTML = e.shapes.map((s, i) => `
      <div class="odk-row ${sel.has(i) ? 'sel' : ''} ${s.disabled ? 'off' : ''}" data-i="${i}">
        <span class="odk-row-ic">${ICONS[s.type] || '◇'}</span>
        <span class="odk-row-name">${s.name || `${AR_TYPE[s.type] || s.type} ${i + 1}`}</span>
        <button data-act="eye" title="${s.disabled ? 'إظهار في الإخراج' : 'إخفاء من الإخراج'}">${s.disabled ? '🚫' : '👁'}</button>
        <button data-act="lock" class="${s.locked ? 'act' : ''}" title="${s.locked ? 'فك القفل' : 'قفل'}">${s.locked ? '🔒' : '🔓'}</button>
      </div>`).join('');

    objList.querySelectorAll('.odk-row').forEach(row => {
      const i = +row.dataset.i;
      row.addEventListener('click', ev => {
        const e2 = ed(); if (!e2 || !e2.shapes[i]) return;
        const act = ev.target.closest('button')?.dataset.act;
        if (act === 'eye') { e2.shapes[i].disabled = !e2.shapes[i].disabled; e2.render(); e2._updateStatus?.(); return; }
        if (act === 'lock') { e2.shapes[i].locked = !e2.shapes[i].locked; renderObjects(); return; }
        // تحديد: نقرة = مفرد · Ctrl+نقرة = إضافة/إزالة من المتعدد
        // setTool أولاً — تبديل الأداة يستدعي _cancelDraw فيصفّر أي تحديد يُضبط قبله
        if (e2.tool !== 'select') e2.setTool?.('select');
        e2.msel = e2.msel || new Set();
        if (ev.ctrlKey || ev.metaKey) {
          if (e2.msel.size === 0 && e2.selectedIdx >= 0) e2.msel.add(e2.selectedIdx);
          e2.msel.has(i) ? e2.msel.delete(i) : e2.msel.add(i);
          e2.selectedIdx = e2.msel.size ? [...e2.msel][e2.msel.size - 1] : -1;
        } else {
          e2.msel.clear(); e2.selectedIdx = i;
        }
        e2._updateShapeToolbar?.(); e2.render();
      });
      // تمييز الشكل على اللوحة عند المرور
      row.addEventListener('mouseenter', () => { try { ed()?.addHighlightIndex?.(i); } catch (e2) {} });
      row.addEventListener('mouseleave', () => { try { ed()?.removeHighlightIndex?.(i); } catch (e2) {} });
    });
  }

  /* إعادة رسم قائمة الكائنات عند تغيّر المشهد/التحديد — ببصمة تمنع العمل الزائد */
  function hookEditor() {
    if (typeof CanvasEditor === 'undefined') return;
    const P = CanvasEditor.prototype;
    let sig = '';
    const maybeRender = self => {
      if (!dock || dock.style.display === 'none') return;
      if (!dock.querySelector('.odk-pane[data-pane="objects"]').classList.contains('on')) return;
      const sel = selSet(self);
      const s = self.shapes.map((sh, i) => `${i}${sh.type}${sh.disabled ? 'd' : ''}${sh.locked ? 'l' : ''}`).join('|')
        + '#' + [...sel].join(',');
      if (s !== sig) { sig = s; renderObjects(); }
    };
    const origStatus = P._updateStatus;
    P._updateStatus = function () { origStatus?.call(this); maybeRender(this); };
    const origToolbar = P._updateShapeToolbar;
    P._updateShapeToolbar = function () { origToolbar?.call(this); maybeRender(this); };
  }

  function boot() {
    if (document.getElementById('object-dock')) return;
    build();
    hookEditor();
    // ارسم لوحة الطبقات فور جاهزية المحرر (كما كان يفعل layers-float)
    const paint = () => { const e = ed(); if (e) e._renderLayersPanel?.(); else setTimeout(paint, 200); };
    setTimeout(paint, 350);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.ObjectDock = { show: () => setHidden(false), refresh: renderObjects };
})();
