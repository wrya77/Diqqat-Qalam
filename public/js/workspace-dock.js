/**
 * workspace-dock.js — نظام رسو اللوحات (P2)
 *
 * يحوّل الأعمدة الثابتة (إعدادات · كانفس · إخراج) إلى نظام رسو حقيقي بنمط
 * Illustrator/Figma: كل لوحة وحدة مستقلة تُسحب من لسانها فتُجمَّع بتبويبات فوق
 * لوحة أخرى، أو تُقسم منطقة رأسياً، أو تنتقل لعمود آخر. التخطيط يُحفظ ويُستعاد،
 * ومعه ثلاث «مساحات عمل» جاهزة (رسم · CNC · محاكاة).
 *
 * مبدأ عدم التخريب: اللوحات هنا هي **عناصر DOM القائمة نفسها** تُنقل كما هي —
 * لا يتغيّر أي id/class، فتبقى كل مستمعات الأحداث وقواعد CSS عاملة. وعلى
 * الشاشات ≤1024px يُفكَّك النظام وتعود العناصر لمواضعها الأصلية (أدراج الجوال).
 *
 * لا مكتبات خارجية — بديل محلي عن Dockview يحترم RTL أصلاً.
 */
(function workspaceDock() {
  'use strict';

  const KEY = 'dq_workspace_v1';
  const MINW = 190, MAXW = 900, MIN_GROUP_PX = 84;
  const mq = window.matchMedia('(min-width: 1025px)');
  const ico = n => { try { return window.DQIcon ? window.DQIcon(n) : ''; } catch (_) { return ''; } };

  /* ══════════════ سجل اللوحات ══════════════ */
  const PANELS = {
    props:    { title: 'الخصائص',   icon: 'dimensions' },
    settings: { title: 'الإعدادات', icon: 'settings'   },
    layers:   { title: 'الطبقات',   icon: 'layers'     },
    objects:  { title: 'الكائنات',  icon: 'shapes'     },
    tools:    { title: 'الأدوات',   icon: 'wrench'     },
    output:   { title: 'الإخراج',   icon: 'page'       },
  };
  const IDS = Object.keys(PANELS);

  /* مساحات العمل الجاهزة — دوال لأن «محاكاة» تعتمد على عرض النافذة */
  const WORKSPACES = {
    design: {
      label: 'رسم',
      make: () => ({
        zones: {
          right: { w: 272, groups: [
            { p: ['layers', 'objects', 'tools'], a: 'layers', f: 1.2 },
            { p: ['props', 'settings'],          a: 'props',  f: 1 },
          ] },
          left: { w: 0, groups: [] },
        },
        closed: ['output'],
      }),
    },
    cnc: {
      label: 'CNC',
      make: () => ({
        zones: {
          right: { w: 264, groups: [
            { p: ['props', 'settings'],          a: 'settings', f: 1 },
            { p: ['layers', 'objects', 'tools'], a: 'layers',   f: 1 },
          ] },
          left: { w: 400, groups: [{ p: ['output'], a: 'output', f: 1 }] },
        },
        closed: [],
      }),
      after: () => pickOutTab('gcode'),
    },
    sim: {
      label: 'محاكاة',
      make: () => ({
        zones: {
          right: { w: 0, groups: [] },
          left: { w: Math.round(Math.min(820, Math.max(460, window.innerWidth * 0.52))),
                  groups: [{ p: ['output'], a: 'output', f: 1 }] },
        },
        closed: ['props', 'settings', 'layers', 'objects', 'tools'],
      }),
      after: () => pickOutTab('sim'),
    },
  };

  function pickOutTab(name) {
    const b = document.querySelector(`.output-panel .otab[data-tab="${name}"]`);
    if (b && !b.classList.contains('active')) b.click();
  }

  /* ══════════════ الحالة ══════════════ */
  let M = null;            // النموذج {zones, closed}
  let wsName = 'cnc';      // مساحة العمل الفعّالة
  let root = null;         // main.app-layout
  let zoneEl = {};         // right/left → عنصر العمود
  let splitEl = {};        // right/left → مقسّم أفقي
  let park = null;         // حاوية اللوحات المغلقة
  let els = {};            // id → عنصر اللوحة
  let home = {};           // id → {parent, next} لاستعادته عند التفكيك
  let built = false;

  const store = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
  };
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ ws: wsName, M })); } catch (_) {}
  };

  /* ══════════════ الأنماط ══════════════ */
  function injectCSS() {
    if (document.getElementById('dqw-css')) return;
    const s = document.createElement('style');
    s.id = 'dqw-css';
    s.textContent = `
      .app-layout.dqw-on{display:flex;position:relative;align-items:stretch}
      .app-layout.dqw-on > .canvas-wrap{flex:1 1 0;min-width:120px}

      .dqw-zone{display:flex;flex-direction:column;flex:0 0 auto;min-width:0;
        background:var(--bg2,#161b22);overflow:hidden}
      .dqw-zone.empty{display:none}

      /* مقسّم أفقي بين العمود والكانفس */
      .dqw-hsplit{flex:0 0 5px;cursor:ew-resize;background:var(--border,#30363d);
        position:relative;z-index:6;transition:background .15s ease}
      .dqw-hsplit:hover,.dqw-hsplit.act{background:var(--accent,#2f81f7)}
      .dqw-hsplit.gone{display:none}

      /* مقسّم رأسي بين مجموعتين داخل العمود */
      .dqw-vsplit{flex:0 0 5px;cursor:ns-resize;background:var(--border,#30363d);
        transition:background .15s ease}
      .dqw-vsplit:hover,.dqw-vsplit.act{background:var(--accent,#2f81f7)}

      .dqw-group{display:flex;flex-direction:column;min-height:0;overflow:hidden;
        border-top:1px solid transparent}
      .dqw-tabs{display:flex;align-items:stretch;flex-shrink:0;overflow:hidden;
        background:var(--bg1,#0d1117);border-bottom:1px solid var(--border,#30363d)}
      .dqw-tab{display:flex;align-items:center;gap:5px;padding:7px 9px;border:none;
        background:none;cursor:grab;position:relative;white-space:nowrap;min-width:0;
        color:var(--text3,#8b949e);font-family:inherit;font-size:12px;font-weight:600;
        transition:color .16s ease,background .16s ease}
      .dqw-tab:hover{color:var(--text2,#b1bac4);background:var(--bg3,#1c2128)}
      .dqw-tab.on{color:var(--accent-h,#58a6ff);
        background:linear-gradient(180deg,color-mix(in srgb,var(--accent,#2f81f7) 12%,transparent),transparent)}
      .dqw-tab.on::after{content:'';position:absolute;inset-inline:12%;bottom:-1px;height:2px;
        background:var(--accent-h,#58a6ff);border-radius:2px 2px 0 0}
      .dqw-tab.dragging{opacity:.35}
      .dqw-tab svg{width:14px;height:14px;flex:0 0 auto}
      .dqw-tab .dqw-lbl{overflow:hidden;text-overflow:ellipsis}
      .dqw-gap{flex:1 1 auto;min-width:4px;cursor:default}
      .dqw-close{flex:0 0 auto;width:24px;border:none;background:none;cursor:pointer;
        color:var(--text3,#8b949e);font-size:12px;line-height:1;border-radius:6px;
        transition:background .12s ease,color .12s ease}
      .dqw-close:hover{background:var(--bg4,#21262d);color:var(--text,#e6edf3)}

      .dqw-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
      /* اللوحات المنقولة تملأ جسم المجموعة وتحتفظ بأنماطها الأصلية */
      .dqw-body > .settings-panel,.dqw-body > .output-panel{
        flex:1 1 auto;min-height:0;border:none;border-radius:0}
      .dqw-body > .odk-pane{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px}
      .dqw-hidden{display:none !important}

      .dqw-park{display:none !important}

      /* مؤشّر الإفلات */
      .dqw-drop{position:absolute;z-index:1500;pointer-events:none;display:none;
        border:2px solid var(--accent,#2f81f7);border-radius:8px;
        background:color-mix(in srgb,var(--accent,#2f81f7) 16%,transparent);
        transition:all .08s linear}
      .dqw-drop.show{display:block}
      .dqw-ghost{position:fixed;z-index:2400;pointer-events:none;display:flex;align-items:center;
        gap:6px;padding:6px 11px;border-radius:8px;font-size:12px;font-weight:600;
        background:var(--bg2,#161b22);color:var(--text,#e6edf3);
        border:1px solid var(--accent,#2f81f7);box-shadow:0 14px 34px rgba(0,0,0,.5)}
      body.dqw-dragging,body.dqw-dragging *{cursor:grabbing !important;user-select:none !important}

      @media (max-width:1024px){.dqw-hsplit,.dqw-vsplit,.dqw-tabs{display:none}}
    `;
    document.head.appendChild(s);
  }

  /* ══════════════ حصر عناصر اللوحات ══════════════ */
  function remember(el) { home[el.__dqwId] = { parent: el.parentNode, next: el.nextSibling }; }

  function resolveEls() {
    els = {}; home = {};
    const settings = document.querySelector('main.app-layout > aside.settings-panel');
    const output   = document.querySelector('main.app-layout > aside.output-panel');
    if (!settings || !output) return false;

    /* الخصائص: تُستخرج من لوحة الإعدادات إلى مضيف يحمل نفس الصنف — فتبقى
       قواعد `.settings-panel …` سارية عليها بلا تعديل أي CSS. */
    const propsSec = document.getElementById('props-section');
    let host = document.getElementById('dqw-props-host');
    if (propsSec && !host) {
      host = document.createElement('aside');
      host.className = 'settings-panel dqw-sub';
      host.id = 'dqw-props-host';
      const label = propsSec.previousElementSibling &&
                    propsSec.previousElementSibling.classList.contains('sec-group-label')
                    ? propsSec.previousElementSibling : null;
      // موضع العودة يُسجَّل قبل النقل
      if (label) { label.__dqwId = 'props-label'; remember(label); }
      propsSec.__dqwId = 'props-section'; remember(propsSec);
      settings.insertBefore(host, label || propsSec);
      if (label) host.appendChild(label);
      host.appendChild(propsSec);
    }

    const odk = window.ObjectDock && window.ObjectDock.detachPanes
      ? window.ObjectDock.detachPanes() : null;

    els.props    = host || null;
    els.settings = settings;
    els.output   = output;
    els.layers   = odk ? odk.layers  : null;
    els.objects  = odk ? odk.objects : null;
    els.tools    = odk ? odk.tools   : null;

    for (const id of IDS) {
      const el = els[id];
      if (!el) continue;
      el.__dqwId = id;
      if (!home[id]) remember(el);
    }
    return true;
  }

  /* ══════════════ النموذج ══════════════ */
  function sanitize(m) {
    if (!m || !m.zones) return null;
    const seen = new Set(), out = { zones: { right: null, left: null }, closed: [] };
    for (const z of ['right', 'left']) {
      const src = m.zones[z] || {};
      const groups = [];
      for (const g of (src.groups || [])) {
        const p = (g.p || []).filter(id => els[id] && !seen.has(id));
        p.forEach(id => seen.add(id));
        if (p.length) groups.push({ p, a: p.includes(g.a) ? g.a : p[0], f: +g.f > 0 ? +g.f : 1 });
      }
      out.zones[z] = { w: clampW(+src.w || 0), groups };
    }
    // أي لوحة متاحة لم تُذكر تُعتبر مغلقة إن كانت في قائمة المغلق، وإلا تُضاف للعمود اليمين
    for (const id of IDS) {
      if (!els[id] || seen.has(id)) continue;
      if ((m.closed || []).includes(id)) { out.closed.push(id); continue; }
      const zr = out.zones.right;
      if (!zr.groups.length) { zr.groups.push({ p: [id], a: id, f: 1 }); if (!zr.w) zr.w = 264; }
      else zr.groups[0].p.push(id);
    }
    return out;
  }
  const clampW = w => (w <= 0 ? 0 : Math.min(MAXW, Math.max(MINW, w)));

  function applyWorkspace(name, silent) {
    const ws = WORKSPACES[name];
    if (!ws) return;
    wsName = name;
    M = sanitize(ws.make());
    render(); persist();
    try { ws.after && ws.after(); } catch (_) {}
    if (!silent) window.app?.toast?.('🗔 مساحة العمل: ' + ws.label, 'info');
  }

  /* ══════════════ البناء ══════════════ */
  function build() {
    if (built) return;
    root = document.querySelector('main.app-layout');
    if (!root || !mq.matches) return;
    injectCSS();
    if (!resolveEls()) return;

    const canvas = root.querySelector('.canvas-wrap');
    if (!canvas) return;

    zoneEl.right = mk('div', 'dqw-zone'); zoneEl.right.dataset.zone = 'right';
    zoneEl.left  = mk('div', 'dqw-zone'); zoneEl.left.dataset.zone  = 'left';
    splitEl.right = mk('div', 'dqw-hsplit'); splitEl.right.dataset.zone = 'right';
    splitEl.left  = mk('div', 'dqw-hsplit'); splitEl.left.dataset.zone  = 'left';
    park = mk('div', 'dqw-park');

    root.classList.add('dqw-on');
    // الترتيب في RTL: أول عنصر يظهر يميناً
    root.insertBefore(zoneEl.right, canvas);
    root.insertBefore(splitEl.right, canvas);
    root.appendChild(splitEl.left);
    root.appendChild(zoneEl.left);
    root.appendChild(park);

    const saved = store();
    wsName = (saved && WORKSPACES[saved.ws]) ? saved.ws : 'cnc';
    M = sanitize(saved && saved.M) || sanitize(WORKSPACES[wsName].make());

    built = true;
    render();
    wireSplitters();
    wireMenu();
    wireKeys();
  }

  function teardown() {
    if (!built) return;
    // أعد كل لوحة لموضعها الأصلي بالترتيب الصحيح
    for (const id of IDS) {
      const el = els[id], h = home[id];
      if (!el || !h || !h.parent) continue;
      el.classList.remove('dqw-hidden');
      h.parent.insertBefore(el, h.next && h.next.parentNode === h.parent ? h.next : null);
    }
    // فكّ مضيف الخصائص: أعد القسم واللافتة ثم احذف المضيف
    const hostRec = els.props;
    for (const k of ['props-label', 'props-section']) {
      const h = home[k];
      if (!h || !h.parent) continue;
      const node = k === 'props-section' ? document.getElementById('props-section')
                                         : hostRec && hostRec.querySelector('.sec-group-label');
      if (node) h.parent.insertBefore(node, h.next && h.next.parentNode === h.parent ? h.next : null);
    }
    if (hostRec && hostRec.parentNode) hostRec.parentNode.removeChild(hostRec);
    window.ObjectDock?.reattachPanes?.();

    [zoneEl.right, zoneEl.left, splitEl.right, splitEl.left, park]
      .forEach(n => n && n.parentNode && n.parentNode.removeChild(n));
    root.classList.remove('dqw-on');
    zoneEl = {}; splitEl = {}; park = null; built = false;
  }

  const mk = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };

  /* ══════════════ الرسم ══════════════ */
  function render() {
    if (!built) return;
    // احتفظ بالعناصر (المراجع تبقيها حيّة بعد تفريغ الحاويات)
    for (const id of IDS) { const el = els[id]; if (el && el.parentNode) el.parentNode.removeChild(el); }
    zoneEl.right.innerHTML = ''; zoneEl.left.innerHTML = '';

    for (const z of ['right', 'left']) {
      const zone = M.zones[z], host = zoneEl[z];
      const on = zone.groups.length > 0;
      host.classList.toggle('empty', !on);
      splitEl[z].classList.toggle('gone', !on);
      if (!on) continue;
      host.style.width = (zone.w || 264) + 'px';
      zone.groups.forEach((g, gi) => {
        if (gi > 0) {
          const vs = mk('div', 'dqw-vsplit');
          vs.dataset.zone = z; vs.dataset.gi = gi;
          host.appendChild(vs);
        }
        host.appendChild(buildGroup(z, gi, g));
      });
    }

    for (const id of M.closed) { const el = els[id]; if (el) { el.classList.add('dqw-hidden'); park.appendChild(el); } }
    syncMenu();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function buildGroup(z, gi, g) {
    const wrap = mk('div', 'dqw-group');
    wrap.dataset.zone = z; wrap.dataset.gi = gi;
    wrap.style.flex = `${g.f} 1 0`;

    const tabs = mk('div', 'dqw-tabs');
    g.p.forEach(id => {
      const t = mk('button', 'dqw-tab' + (id === g.a ? ' on' : ''));
      t.type = 'button'; t.dataset.panel = id; t.title = PANELS[id].title;
      t.innerHTML = ico(PANELS[id].icon) + `<span class="dqw-lbl">${PANELS[id].title}</span>`;
      t.addEventListener('mousedown', e => onTabDown(e, t, z, gi, id));
      t.addEventListener('click', () => { if (!dragMoved) activate(z, gi, id); });
      tabs.appendChild(t);
    });
    const gap = mk('span', 'dqw-gap'); tabs.appendChild(gap);
    const x = mk('button', 'dqw-close');
    x.type = 'button'; x.title = 'إغلاق اللوحة الفعّالة'; x.textContent = '✕';
    x.addEventListener('click', () => closePanel(g.a));
    tabs.appendChild(x);
    wrap.appendChild(tabs);

    const body = mk('div', 'dqw-body');
    g.p.forEach(id => {
      const el = els[id];
      if (!el) return;
      el.classList.toggle('dqw-hidden', id !== g.a);
      if (el.classList.contains('odk-pane')) el.classList.add('on');
      body.appendChild(el);
    });
    wrap.appendChild(body);
    return wrap;
  }

  function activate(z, gi, id) {
    const g = M.zones[z].groups[gi];
    if (!g || g.a === id) return;
    g.a = id;
    render(); persist();
    if (id === 'objects') window.ObjectDock?.refresh?.();
  }

  function findPanel(id) {
    for (const z of ['right', 'left'])
      for (let gi = 0; gi < M.zones[z].groups.length; gi++)
        if (M.zones[z].groups[gi].p.includes(id)) return { z, gi };
    return null;
  }

  function removePanel(id) {
    const at = findPanel(id);
    if (!at) { M.closed = M.closed.filter(x => x !== id); return; }
    const zone = M.zones[at.z], g = zone.groups[at.gi];
    g.p = g.p.filter(x => x !== id);
    if (g.a === id) g.a = g.p[0];
    if (!g.p.length) zone.groups.splice(at.gi, 1);
  }

  function closePanel(id) {
    if (!id) return;
    removePanel(id);
    if (!M.closed.includes(id)) M.closed.push(id);
    render(); persist();
  }

  function openPanel(id) {
    if (!els[id]) return;
    M.closed = M.closed.filter(x => x !== id);
    if (findPanel(id)) return;
    const zone = M.zones.right.groups.length ? M.zones.right
               : (M.zones.left.groups.length ? M.zones.left : M.zones.right);
    if (!zone.w) zone.w = 264;
    if (!zone.groups.length) zone.groups.push({ p: [id], a: id, f: 1 });
    else { zone.groups[0].p.push(id); zone.groups[0].a = id; }
    render(); persist();
  }

  const isOpen = id => !!findPanel(id);

  /* ══════════════ سحب الألسنة ══════════════ */
  let drag = null, dragMoved = false, ghost = null, dropInd = null;

  function onTabDown(e, tabEl, z, gi, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { id, from: { z, gi }, x0: e.clientX, y0: e.clientY, tabEl };
    dragMoved = false;
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragUp);
  }

  function onDragMove(e) {
    if (!drag) return;
    if (!dragMoved) {
      if (Math.abs(e.clientX - drag.x0) < 4 && Math.abs(e.clientY - drag.y0) < 4) return;
      dragMoved = true;
      document.body.classList.add('dqw-dragging');
      drag.tabEl.classList.add('dragging');
      ghost = mk('div', 'dqw-ghost');
      ghost.innerHTML = ico(PANELS[drag.id].icon) + `<span>${PANELS[drag.id].title}</span>`;
      document.body.appendChild(ghost);
      dropInd = mk('div', 'dqw-drop');
      root.appendChild(dropInd);
    }
    ghost.style.left = (e.clientX + 12) + 'px';
    ghost.style.top  = (e.clientY + 14) + 'px';
    drag.target = hitTest(e.clientX, e.clientY);
    paintIndicator(drag.target);
  }

  function onDragUp() {
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragUp);
    const d = drag; drag = null;
    if (!d) return;
    document.body.classList.remove('dqw-dragging');
    d.tabEl.classList.remove('dragging');
    ghost?.remove(); dropInd?.remove(); ghost = dropInd = null;
    if (dragMoved && d.target) applyDrop(d.id, d.target);
    setTimeout(() => { dragMoved = false; }, 0);
  }

  /* أهداف الإفلات: تبويب داخل مجموعة · تقسيم رأسي · عمود جديد على حافة الكانفس */
  function hitTest(x, y) {
    for (const z of ['right', 'left']) {
      const groups = Array.from(zoneEl[z].querySelectorAll(':scope > .dqw-group'));
      for (let gi = 0; gi < groups.length; gi++) {
        const r = groups[gi].getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const strip = Math.min(34, r.height * 0.34);
        if (y <= r.top + strip) {
          // شريط الألسنة → إدراج بينها
          const tabs = Array.from(groups[gi].querySelectorAll('.dqw-tab'));
          let at = tabs.length;
          for (let i = 0; i < tabs.length; i++) {
            const tr = tabs[i].getBoundingClientRect();
            // RTL: اللسان الأول أقصى اليمين
            if (x > tr.left + tr.width / 2) { at = i; break; }
          }
          return { kind: 'tab', z, gi, at };
        }
        const q = r.height * 0.28;
        if (y < r.top + strip + q) return { kind: 'split', z, gi, before: true };
        if (y > r.bottom - q)      return { kind: 'split', z, gi, before: false };
        return { kind: 'tab', z, gi, at: -1 };
      }
    }
    // فوق الكانفس: قرب حافة = عمود
    const cv = root.querySelector('.canvas-wrap');
    if (cv) {
      const r = cv.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const band = Math.max(60, r.width * 0.16);
        if (x >= r.right - band) return { kind: 'zone', z: 'right' };
        if (x <= r.left + band)  return { kind: 'zone', z: 'left' };
      }
    }
    return null;
  }

  function paintIndicator(t) {
    if (!dropInd) return;
    if (!t) { dropInd.classList.remove('show'); return; }
    const rr = root.getBoundingClientRect();
    const set = (l, tp, w, h) => {
      dropInd.style.left = (l - rr.left) + 'px'; dropInd.style.top = (tp - rr.top) + 'px';
      dropInd.style.width = w + 'px'; dropInd.style.height = h + 'px';
      dropInd.classList.add('show');
    };
    if (t.kind === 'zone') {
      const cv = root.querySelector('.canvas-wrap').getBoundingClientRect();
      const w = Math.max(MINW, M.zones[t.z].w || 264);
      set(t.z === 'right' ? cv.right - w : cv.left, cv.top, w, cv.height);
      return;
    }
    const g = zoneEl[t.z].querySelectorAll(':scope > .dqw-group')[t.gi];
    if (!g) { dropInd.classList.remove('show'); return; }
    const r = g.getBoundingClientRect();
    if (t.kind === 'tab') set(r.left, r.top, r.width, r.height);
    else if (t.before)    set(r.left, r.top, r.width, r.height / 2);
    else                  set(r.left, r.top + r.height / 2, r.width, r.height / 2);
  }

  function applyDrop(id, t) {
    const before = findPanel(id);
    removePanel(id);
    M.closed = M.closed.filter(x => x !== id);

    if (t.kind === 'zone') {
      const zone = M.zones[t.z];
      if (!zone.w) zone.w = 264;
      zone.groups.push({ p: [id], a: id, f: 1 });
    } else {
      const zone = M.zones[t.z];
      // الحذف قد يكون أزال مجموعة قبل الهدف — أعِد ضبط الفهرس ضمن الحدود
      let gi = Math.min(t.gi, Math.max(0, zone.groups.length - (t.kind === 'tab' ? 1 : 0)));
      if (t.kind === 'tab') {
        const g = zone.groups[gi];
        if (!g) { zone.groups.push({ p: [id], a: id, f: 1 }); }
        else {
          const at = t.at < 0 || t.at > g.p.length ? g.p.length : t.at;
          g.p.splice(at, 0, id); g.a = id;
        }
      } else {
        const f = zone.groups[gi] ? zone.groups[gi].f : 1;
        if (zone.groups[gi]) zone.groups[gi].f = f / 2;
        zone.groups.splice(t.before ? gi : gi + 1, 0, { p: [id], a: id, f: f / 2 || 1 });
      }
      if (!zone.w) zone.w = 264;
    }
    render(); persist();
    if (before && (before.z !== t.z || t.kind !== 'tab')) window.app?.toast?.('🗔 نُقلت لوحة ' + PANELS[id].title, 'info');
  }

  /* ══════════════ المقسّمات ══════════════ */
  function wireSplitters() {
    let s = null;
    root.addEventListener('mousedown', e => {
      const h = e.target.closest('.dqw-hsplit'), v = e.target.closest('.dqw-vsplit');
      if (!h && !v) return;
      e.preventDefault();
      if (h) {
        const z = h.dataset.zone;
        if (!M.zones[z].groups.length) return;
        s = { kind: 'h', z, el: h, r: zoneEl[z].getBoundingClientRect() };
      } else {
        const z = v.dataset.zone, gi = +v.dataset.gi;
        const gs = zoneEl[z].querySelectorAll(':scope > .dqw-group');
        const a = gs[gi - 1], b = gs[gi];
        if (!a || !b) return;
        s = { kind: 'v', z, gi, el: v, y0: e.clientY,
              ha: a.offsetHeight, hb: b.offsetHeight,
              fa: M.zones[z].groups[gi - 1].f, fb: M.zones[z].groups[gi].f };
      }
      s.el.classList.add('act');
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', e => {
      if (!s) return;
      if (s.kind === 'h') {
        const w = s.z === 'right' ? (s.r.right - e.clientX) : (e.clientX - s.r.left);
        M.zones[s.z].w = clampW(w);
        zoneEl[s.z].style.width = M.zones[s.z].w + 'px';
      } else {
        const total = s.ha + s.hb, ft = s.fa + s.fb;
        let ha = Math.min(total - MIN_GROUP_PX, Math.max(MIN_GROUP_PX, s.ha + (e.clientY - s.y0)));
        const gs = M.zones[s.z].groups;
        gs[s.gi - 1].f = ft * (ha / total);
        gs[s.gi].f     = ft * ((total - ha) / total);
        const els2 = zoneEl[s.z].querySelectorAll(':scope > .dqw-group');
        els2[s.gi - 1].style.flex = `${gs[s.gi - 1].f} 1 0`;
        els2[s.gi].style.flex     = `${gs[s.gi].f} 1 0`;
      }
    });

    window.addEventListener('mouseup', () => {
      if (!s) return;
      s.el.classList.remove('act'); s = null;
      document.body.style.userSelect = '';
      persist();
      window.dispatchEvent(new Event('resize'));
    });
  }

  /* ══════════════ قائمة «نافذة» ══════════════ */
  function wireMenu() {
    document.addEventListener('click', e => {
      const mi = e.target.closest && e.target.closest('.mi[data-ws]');
      if (!mi) return;
      const v = mi.dataset.ws;
      if (v.startsWith('ws:')) applyWorkspace(v.slice(3));
      else if (v.startsWith('panel:')) { const id = v.slice(6); isOpen(id) ? closePanel(id) : openPanel(id); }
      else if (v === 'reset') { try { localStorage.removeItem(KEY); } catch (_) {} applyWorkspace('cnc'); }
    });
    // حدّث علامات الاختيار عند فتح القائمة
    document.getElementById('menu-window')?.parentElement
      ?.querySelector('.menu-btn')?.addEventListener('click', () => setTimeout(syncMenu, 0));
    syncMenu();
  }

  function syncMenu() {
    const host = document.getElementById('dqw-panel-items');
    if (!host) return;
    host.innerHTML = IDS.filter(id => els[id]).map(id =>
      `<button class="mi${isOpen(id) ? ' checked' : ''}" data-ws="panel:${id}">${PANELS[id].title}</button>`
    ).join('');
    document.querySelectorAll('.mi[data-ws^="ws:"]').forEach(b =>
      b.classList.toggle('checked', b.dataset.ws === 'ws:' + wsName));
  }

  function wireKeys() {
    document.addEventListener('keydown', e => {
      if (e.key !== 'F7' || e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      ['layers', 'objects', 'tools'].forEach(id => isOpen(id) ? closePanel(id) : openPanel(id));
    });
  }

  /* ══════════════ الإقلاع ══════════════ */
  function boot() {
    if (mq.matches) build();
    const onChange = () => { if (mq.matches) build(); else teardown(); };
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    // شبكة أمان: بعض البيئات لا تُطلق حدث matchMedia — نتحقّق أيضاً عند تغيّر المقاس
    let t = 0;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => { if (mq.matches !== built) onChange(); }, 160);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.WorkspaceDock = {
    active: () => built,
    mount: build,        // يُستدعى تلقائياً عند تجاوز 1024px — ومتاح للاختبار
    unmount: teardown,   // يعيد اللوحات لمواضعها الأصلية (وضع الأدراج)
    apply: applyWorkspace,
    open: openPanel,
    close: closePanel,
    isOpen,
    layout: () => JSON.parse(JSON.stringify(M || {})),
    workspaces: () => Object.keys(WORKSPACES),
    current: () => wsName,
  };
})();
