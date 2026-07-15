/**
 * object-dock.js — شريط الكائن: لوحة مرساة مغناطيسية بنمط Illustrator
 *
 *   🗂 الطبقات  — يستضيف #layers-list و #layer-add فيبقى layers-panel.js يعمل كما هو
 *   ⬡ الكائنات — كل أشكال التصميم في قائمة: نقر = تحديد · Ctrl+نقر = تحديد متعدد
 *                 · 👁 إظهار/إخفاء من الإخراج · 🔒 قفل
 *   ✥ الأدوات  — كل أدوات الرسم مجمّعة في شبكة (نفس مجموعات الشريط الجانبي)
 *
 *  إرساء مغناطيسي: اسحب رأس اللوحة فتطفو، وعند الإفلات ترتسي على أقرب حافة
 *  (يمين/يسار مساحة الرسم) — كما يفعل tools-dock.js بشريط الأدوات.
 *  «/» يطويها إلى شريط أيقونات · F7 يبدّل الإظهار. الحالة في localStorage.
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
      .odk{position:absolute;z-index:900;top:10px;bottom:10px;width:268px;
        background:var(--bg2,#161b22);border:1px solid var(--border2,#3d444d);border-radius:12px;
        box-shadow:var(--shadow-float,0 16px 44px rgba(0,0,0,.42));
        display:flex;flex-direction:column;overflow:hidden;
        transition:width .2s var(--ease-out,cubic-bezier(.22,1,.36,1)),
                   right .22s var(--ease-out,cubic-bezier(.22,1,.36,1)),
                   left .22s var(--ease-out,cubic-bezier(.22,1,.36,1))}
      .odk.side-right{right:10px;left:auto}
      .odk.side-left{left:10px;right:auto}
      .odk.resizing,.odk.floating{transition:none}
      /* أثناء السحب: تطفو بحرّية تحت المؤشر */
      .odk.floating{bottom:auto;height:min(70vh,520px);opacity:.94;cursor:grabbing;
        box-shadow:0 26px 64px rgba(0,0,0,.55);border-color:var(--accent,#2f81f7)}

      /* ── الرأس: مقبض السحب + التبويبات ── */
      .odk-head{display:flex;align-items:stretch;flex-shrink:0;
        background:var(--bg1,#0d1117);border-bottom:1px solid var(--border,#30363d)}
      .odk-grip{display:flex;align-items:center;justify-content:center;width:20px;flex-shrink:0;
        cursor:grab;color:var(--text3,#8b949e);font-size:11px;letter-spacing:-1px;
        border-inline-end:1px solid var(--border,#30363d);
        transition:color .15s ease,background .15s ease}
      .odk-grip:hover{color:var(--accent-h,#58a6ff);background:var(--bg3,#1c2128)}
      .odk-grip:active{cursor:grabbing}
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
      #odk-collapse{font-size:12px;font-weight:700}
      .odk-body{flex:1;overflow-y:auto;padding:10px}
      .odk-pane{display:none}
      .odk-pane.on{display:block;animation:dqPaneIn .2s cubic-bezier(.22,1,.36,1)}

      /* ── ظلّ الإرساء: يُظهر أين ستستقر اللوحة عند الإفلات ── */
      .odk-ghost{position:absolute;z-index:899;top:10px;bottom:10px;width:268px;
        border:2px dashed var(--accent,#2f81f7);border-radius:12px;pointer-events:none;display:none;
        background:color-mix(in srgb,var(--accent,#2f81f7) 8%,transparent)}
      .odk-ghost.show{display:block;animation:dqPaneIn .15s ease}

      /* ── مقبض التحجيم على الحافة المواجهة للكانفس ── */
      .odk-resize{position:absolute;top:0;width:6px;height:100%;
        cursor:ew-resize;z-index:5;background:transparent;transition:background .15s ease}
      .odk.side-right .odk-resize{left:0;right:auto}
      .odk.side-left  .odk-resize{right:0;left:auto}
      .odk-resize:hover,.odk-resize.active{background:var(--accent,#2f81f7)}

      /* ── الوضع المطويّ: شريط أيقونات نحيف ── */
      .odk.collapsed{width:44px}
      .odk.collapsed .odk-body,.odk.collapsed .odk-resize,.odk.collapsed .odk-grip{display:none}
      .odk.collapsed .odk-head{flex-direction:column;border-bottom:none;background:transparent}
      .odk.collapsed .odk-tab{flex:0 0 auto;padding:11px 0}
      .odk.collapsed .odk-tab .odk-tab-label{display:none}
      .odk.collapsed .odk-tab.on::after{left:auto;right:-1px;top:14%;bottom:14%;height:auto;width:2px;
        border-radius:2px 0 0 2px;animation:none}
      .odk.collapsed .odk-actions{flex-direction:column;border-inline-start:none;
        border-top:1px solid var(--border,#30363d);margin-top:4px;padding:4px 0}

      /* ── لسان إعادة الفتح عند الإخفاء ── */
      .odk-reopen{position:fixed;top:170px;z-index:800;display:none;align-items:center;gap:6px;
        padding:9px 11px;border:1px solid var(--border2,#3d444d);cursor:pointer;
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
        border:1px solid transparent;background:var(--bg1,#0d1117);
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

      /* ── تبويب الأدوات: شبكة مجمّعة ── */
      .odk-tools h4{display:flex;align-items:center;gap:7px;
        font-size:10.5px;font-weight:700;color:var(--text3,#8b949e);
        letter-spacing:.04em;margin:14px 0 7px;text-transform:uppercase}
      .odk-tools h4:first-child{margin-top:0}
      .odk-tools h4::after{content:'';flex:1;height:1px;background:var(--border,#30363d)}
      .odk-tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));gap:4px}
      .odk-tbtn{position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center;
        border:1px solid var(--border,#30363d);border-radius:7px;cursor:pointer;
        background:var(--btn-hi,var(--bg3,#1c2128));color:var(--text2,#b1bac4);padding:0;
        transition:background .13s ease,color .13s ease,border-color .13s ease,transform .13s cubic-bezier(.22,1,.36,1)}
      .odk-tbtn svg{width:17px;height:17px}
      .odk-tbtn:hover{background:var(--bg4,#21262d);color:var(--text,#e6edf3);
        border-color:var(--border2,#3d444d);transform:translateY(-1px)}
      .odk-tbtn:active{transform:translateY(0) scale(.94)}
      .odk-tbtn.on{background:color-mix(in srgb,var(--accent,#2f81f7) 20%,transparent);
        border-color:var(--accent,#2f81f7);color:var(--accent-h,#58a6ff);
        box-shadow:0 0 0 1px color-mix(in srgb,var(--accent,#2f81f7) 40%,transparent) inset}

      @media (max-width:1024px){.odk,.odk-reopen,.odk-ghost{display:none !important}}
    `;
    document.head.appendChild(s);
  }

  /* ══ التقاط مجموعات الأدوات من الشريط الجانبي ══
     يُقرأ عند الإقلاع — قبل أن يعيد tools-rail-flyout.js بناء الشريط وينقل
     الأدوات الثانوية إلى قوائم منسدلة خارج الـDOM الأصلي. */
  let TOOL_GROUPS = [];
  function captureTools() {
    const rail = document.getElementById('tools-rail');
    if (!rail) return;
    const groups = [];
    let cur = null;
    Array.from(rail.children).forEach(el => {
      if (el.classList.contains('tr-group-label')) {
        cur = { label: el.textContent.trim(), tools: [] };
        groups.push(cur);
      } else if (el.classList.contains('tr-btn') && el.dataset.tool) {
        if (!cur) { cur = { label: 'أدوات', tools: [] }; groups.push(cur); }
        cur.tools.push({ tool: el.dataset.tool, title: el.title || el.dataset.tool, svg: el.innerHTML });
      }
    });
    TOOL_GROUPS = groups.filter(g => g.tools.length);
  }

  let dock, ghost, reopen, objList, objCount;
  const side = () => (st().side === 'left' ? 'left' : 'right');

  const MINW = 200, MAXW = 400;
  /* العرض المضمّن يغلب قواعد الـclass — فلا يبقى إلا حين يكون مقصوداً.
     مصدر واحد لضبطه: يُمسح عند الطيّ وبعد السحب، ويُستعاد من الحالة المحفوظة فقط. */
  function restoreWidth() {
    const w = st().width;
    dock.style.width = (!dock.classList.contains('collapsed') && w >= MINW && w <= MAXW) ? w + 'px' : '';
  }

  function build() {
    injectCSS();
    const host = document.querySelector('.canvas-area') || document.body;

    dock = document.createElement('div');
    dock.className = 'odk dq-pop-in side-' + side();
    dock.id = 'object-dock';
    dock.innerHTML = `
      <div class="odk-head">
        <div class="odk-grip" id="odk-grip" title="اسحب لإرساء اللوحة يميناً أو يساراً">⠿</div>
        <button class="odk-tab on" data-pane="layers" title="الطبقات">🗂<span class="odk-tab-label"> الطبقات</span></button>
        <button class="odk-tab" data-pane="objects" title="الكائنات">⬡<span class="odk-tab-label"> الكائنات</span></button>
        <button class="odk-tab" data-pane="tools" title="كل الأدوات مجمّعة">✥<span class="odk-tab-label"> الأدوات</span></button>
        <span class="odk-actions">
          <button id="odk-collapse" title="طيّ اللوحة"></button>
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
        <div class="odk-pane odk-tools" data-pane="tools" id="odk-tools"></div>
      </div>
      <div class="odk-resize" title="اسحب لتغيير عرض اللوحة"></div>`;
    host.appendChild(dock);

    ghost = document.createElement('div');
    ghost.className = 'odk-ghost';
    host.appendChild(ghost);

    reopen = document.createElement('button');
    reopen.className = 'odk-reopen';
    reopen.innerHTML = '⬡ شريط الكائن';
    document.body.appendChild(reopen);

    objList = dock.querySelector('#odk-obj-list');
    objCount = dock.querySelector('#odk-obj-count');

    renderTools();
    applySide(side());

    const s = st();
    if (s.collapsed) dock.classList.add('collapsed');
    restoreWidth();
    if (s.hidden) { dock.style.display = 'none'; reopen.classList.add('show'); }
    if (s.pane) activate(s.pane);

    wire();
  }

  /* السهم يشير دائماً نحو الحافة التي تنطوي إليها اللوحة (مثل Illustrator) */
  function syncCollapseIcon() {
    const btn = dock.querySelector('#odk-collapse');
    if (!btn) return;
    const c = dock.classList.contains('collapsed');
    const toEdge = side() === 'right' ? '»' : '«';
    const toOpen = side() === 'right' ? '«' : '»';
    btn.textContent = c ? toOpen : toEdge;
    btn.title = c ? 'توسيع اللوحة' : 'طيّ اللوحة';
  }

  function applySide(v) {
    dock.classList.toggle('side-right', v === 'right');
    dock.classList.toggle('side-left', v === 'left');
    // لسان إعادة الفتح يلتصق بنفس الحافة
    reopen.style.right = v === 'right' ? '0' : '';
    reopen.style.left = v === 'left' ? '0' : '';
    reopen.style.borderRadius = v === 'right' ? '10px 0 0 10px' : '0 10px 10px 0';
    reopen.style.borderRightWidth = v === 'right' ? '0' : '';
    reopen.style.borderLeftWidth = v === 'left' ? '0' : '';
    save({ side: v });
    syncCollapseIcon();
  }

  function activate(pane) {
    dock.querySelectorAll('.odk-tab[data-pane]').forEach(t => t.classList.toggle('on', t.dataset.pane === pane));
    dock.querySelectorAll('.odk-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === pane));
    save({ pane });
    if (pane === 'objects') renderObjects();
    if (pane === 'tools') syncActiveTool();
  }

  function setHidden(v) {
    dock.style.display = v ? 'none' : '';
    reopen.classList.toggle('show', v);
    save({ hidden: v });
  }

  /* ══ تبويب الأدوات ══ */
  function renderTools() {
    const host = dock.querySelector('#odk-tools');
    if (!host) return;
    if (!TOOL_GROUPS.length) {
      host.innerHTML = '<div class="odk-obj-empty">شريط الأدوات غير متاح على هذه الصفحة.</div>';
      return;
    }
    host.innerHTML = TOOL_GROUPS.map(g =>
      `<h4>${g.label}</h4><div class="odk-tgrid">` +
      g.tools.map(t => `<button class="odk-tbtn" data-tool="${t.tool}" title="${t.title}">${t.svg}</button>`).join('') +
      '</div>').join('');

    host.querySelectorAll('.odk-tbtn').forEach(b =>
      b.addEventListener('click', () => { ed()?.setTool?.(b.dataset.tool); syncActiveTool(); }));
    syncActiveTool();
  }

  function syncActiveTool() {
    const cur = ed()?.tool;
    dock?.querySelectorAll('.odk-tbtn').forEach(b => b.classList.toggle('on', b.dataset.tool === cur));
  }

  /* ══ الأسلاك ══ */
  function wire() {
    dock.querySelectorAll('.odk-tab[data-pane]').forEach(t =>
      t.addEventListener('click', () => {
        // في الوضع المطويّ: النقر على تبويب يفتح اللوحة عليه
        if (dock.classList.contains('collapsed')) {
          dock.classList.remove('collapsed');
          save({ collapsed: false });
          restoreWidth(); syncCollapseIcon();
        }
        activate(t.dataset.pane);
      }));

    dock.querySelector('#odk-collapse').addEventListener('click', () => {
      save({ collapsed: dock.classList.toggle('collapsed') });
      restoreWidth(); syncCollapseIcon();
    });
    dock.querySelector('#odk-hide').addEventListener('click', () => setHidden(true));
    reopen.addEventListener('click', () => setHidden(false));

    document.addEventListener('keydown', e => {
      if (e.key !== 'F7') return;
      const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      if (inInput) return;
      e.preventDefault();
      setHidden(dock.style.display !== 'none');
    });

    wireMagneticDrag();
    wireResize();
  }

  /* ── إرساء مغناطيسي: اسحب الرأس فتطفو، وعند الإفلات ترتسي على أقرب حافة ── */
  function wireMagneticDrag() {
    const grip = dock.querySelector('#odk-grip');
    const host = dock.parentElement;
    let drag = null;

    const nearestSide = clientX => {
      const r = host.getBoundingClientRect();
      return (clientX - r.left) < (r.width / 2) ? 'left' : 'right';
    };

    grip.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const r = dock.getBoundingClientRect();
      if (r.width < 2) return;   // مخفية (قاعدة الوسائط) — لا سحب بلا حجم
      e.preventDefault();
      // offsetWidth لا getBoundingClientRect().width: الأخير مقيس بعد أي تحويل
      // (حركة الدخول، ui-scale) فتُثبَّت قيمة مصغّرة تتقلّص مع كل سحبة.
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: dock.offsetWidth, moved: false };
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', e => {
      if (!drag) return;
      if (!drag.moved) {
        drag.moved = true;
        dock.classList.add('floating');
        dock.classList.remove('side-left', 'side-right');
        dock.style.width = drag.w + 'px';
        ghost.classList.add('show');
      }
      const r = host.getBoundingClientRect();
      dock.style.left = (e.clientX - drag.dx - r.left) + 'px';
      dock.style.top = (e.clientY - drag.dy - r.top) + 'px';
      dock.style.right = 'auto';

      const s = nearestSide(e.clientX);
      ghost.style.width = drag.w + 'px';
      ghost.style.left = s === 'left' ? '10px' : 'auto';
      ghost.style.right = s === 'right' ? '10px' : 'auto';
    });

    window.addEventListener('mouseup', e => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      document.body.style.userSelect = '';
      if (!moved) return;
      ghost.classList.remove('show');
      dock.classList.remove('floating');
      // امسح كل ما فرضه الطفو (الإزاحة والعرض) كي تعود قواعد side-*/collapsed هي الحاكمة
      dock.style.left = ''; dock.style.top = ''; dock.style.right = '';
      restoreWidth();
      const s = nearestSide(e.clientX);
      applySide(s);
      window.app?.toast?.('📌 رُسي شريط الكائن: ' + (s === 'right' ? 'يمين' : 'يسار'), 'info');
    });
  }

  function wireResize() {
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
      // السحب بعيداً عن حافة الإرساء يوسّع اللوحة — الاتجاه يتبع الجهة المرساة
      const delta = side() === 'right' ? (drag.x - e.clientX) : (e.clientX - drag.x);
      dock.style.width = Math.min(MAXW, Math.max(MINW, drag.w + delta)) + 'px';
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
    // إبقاء شبكة الأدوات متزامنة مع الأداة الفعّالة أياً كان مصدر التبديل
    const origSetTool = P.setTool;
    P.setTool = function (t) { origSetTool.call(this, t); syncActiveTool(); };
  }

  function boot() {
    if (document.getElementById('object-dock')) return;
    captureTools();   // قبل أن يعيد tools-rail-flyout بناء الشريط
    build();
    hookEditor();
    // ارسم لوحة الطبقات فور جاهزية المحرر (كما كان يفعل layers-float)
    const paint = () => { const e = ed(); if (e) { e._renderLayersPanel?.(); syncActiveTool(); } else setTimeout(paint, 200); };
    setTimeout(paint, 350);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.ObjectDock = { show: () => setHidden(false), refresh: renderObjects };
})();
