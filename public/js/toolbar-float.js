/**
 * toolbar-float.js — الشريط المتنقّل: شريط إجراءات ثانٍ يُسحب ويرسو
 *
 * لماذا: الشريط العلوي كان يحمل القوائم + ثمانية أزرار تحرير + أربعة أزرار
 * إنتاج + الحالة + المستخدم في 54px، فيزدحم ويضيق على الشاشات المتوسطة.
 * هنا تنتقل **مجموعة التحرير والعرض** إلى شريط مستقلّ يطفو فوق الكانفس،
 * يُسحب من مقبضه، ويرسو على أي حافة من حواف مساحة الرسم الأربع، ويُطوى.
 *
 * مبدأ عدم التخريب: الأزرار هنا **وكلاء** — كل واحد ينسخ أيقونة الأصل
 * وعنوانه ثم ينقر عليه (`original.click()`)، والأصل يبقى في الـDOM بمعرّفه
 * مخفياً بصنف. فلا ينكسر أي مستمع ولا أي استدعاء `getElementById(...).click()`
 * من شريط القوائم أو لوحة الأوامر. وحالة التعطيل تُنسخ من الأصل باستمرار.
 */
(function toolbarFloat() {
  'use strict';

  const KEY = 'dq_toolbar_float';
  const st = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const save = o => { try { localStorage.setItem(KEY, JSON.stringify({ ...st(), ...o })); } catch (_) {} };

  /* المجموعات المنقولة — معرّفات أزرار قائمة في الشريط العلوي وشريط الكانفس */
  const GROUPS = [
    ['btn-undo', 'btn-redo'],
    ['btn-select-all', 'btn-copy', 'btn-paste', 'btn-duplicate', 'btn-delete'],
    ['btn-zoom-out', 'btn-zoom-in', 'btn-zoom-fit'],
  ];

  /* يُخفى دون وكيل: `btn-fit` نسخة مطابقة من `btn-zoom-fit` (كلاهما fitToView) */
  const HIDE_ONLY = ['btn-fit'];

  /* أزرار الكانفس نصّية (+ − ⊞) — نمنحها أيقونات لتتّسق مع بقية الشريط */
  const ICONS = {
    'btn-zoom-in':  '<svg class="ti" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14M7 5v4M5 7h4"/></svg>',
    'btn-zoom-out': '<svg class="ti" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14M5 7h4"/></svg>',
    'btn-zoom-fit': '<svg class="ti" viewBox="0 0 16 16"><path d="M2 6V3.5A1.5 1.5 0 013.5 2H6M10 2h2.5A1.5 1.5 0 0114 3.5V6M14 10v2.5a1.5 1.5 0 01-1.5 1.5H10M6 14H3.5A1.5 1.5 0 012 12.5V10"/></svg>',
  };

  let bar, grip, body, originals = [];

  function injectCSS() {
    if (document.getElementById('tbf-css')) return;
    const s = document.createElement('style');
    s.id = 'tbf-css';
    s.textContent = `
      /* الأصل يبقى حيّاً بمعرّفه — يُخفى بصرياً فقط */
      .tbf-moved{display:none !important}

      .tbf{position:absolute;z-index:880;display:flex;align-items:center;gap:3px;
        padding:4px;border-radius:11px;
        background:linear-gradient(180deg,var(--bg2,#161b22),var(--bg1,#0d1117));
        border:1px solid var(--border2,#3d444d);
        box-shadow:var(--shadow-float,0 16px 44px rgba(0,0,0,.42));
        transition:opacity .16s ease,box-shadow .16s ease}
      .tbf.vert{flex-direction:column}
      .tbf.dragging{opacity:.92;border-color:var(--accent,#2f81f7);transition:none;cursor:grabbing}

      .tbf-grip{display:flex;align-items:center;justify-content:center;flex-shrink:0;
        width:16px;height:28px;cursor:grab;color:var(--text3,#8b949e);
        font-size:11px;letter-spacing:-1px;border-radius:6px;
        transition:color .14s ease,background .14s ease}
      .tbf.vert .tbf-grip{width:28px;height:16px}
      .tbf-grip:hover{color:var(--accent-h,#58a6ff);background:var(--bg3,#1c2128)}
      .tbf-grip:active{cursor:grabbing}

      .tbf-body{display:flex;align-items:center;gap:3px}
      .tbf.vert .tbf-body{flex-direction:column}

      .tbf-b{width:30px;height:30px;display:flex;align-items:center;justify-content:center;
        border:1px solid transparent;border-radius:8px;cursor:pointer;padding:0;
        background:transparent;color:var(--text2,#b1bac4);
        transition:transform .13s var(--ease-out,cubic-bezier(.22,1,.36,1)),
                   background .13s ease,border-color .13s ease,color .13s ease}
      .tbf-b svg{width:16px;height:16px;pointer-events:none}
      .tbf-b:hover{background:linear-gradient(180deg,var(--btn-hi,#262c36),var(--btn-lo,#1c2128));
        border-color:var(--border,#30363d);color:var(--text,#e6edf3);transform:translateY(-1px)}
      .tbf-b:active{transform:translateY(0) scale(.93)}
      .tbf-b[disabled],.tbf-b.off{opacity:.35;pointer-events:none}

      .tbf-sep{width:1px;height:20px;background:var(--border,#30363d);flex-shrink:0;margin:0 2px}
      .tbf.vert .tbf-sep{width:20px;height:1px;margin:2px 0}

      .tbf-fold{width:18px;height:28px;border:none;background:none;cursor:pointer;flex-shrink:0;
        color:var(--text3,#8b949e);font-size:11px;border-radius:6px}
      .tbf.vert .tbf-fold{width:28px;height:18px}
      .tbf-fold:hover{color:var(--text,#e6edf3);background:var(--bg3,#1c2128)}
      .tbf.folded .tbf-body{display:none}

      /* ظلّ الإرساء: يُظهر أين سيستقرّ الشريط */
      .tbf-ghost{position:absolute;z-index:879;border:2px dashed var(--accent,#2f81f7);
        border-radius:11px;pointer-events:none;display:none;
        background:color-mix(in srgb,var(--accent,#2f81f7) 10%,transparent)}
      .tbf-ghost.show{display:block}

      @media (max-width:1024px){.tbf,.tbf-ghost{display:none !important}}
    `;
    document.head.appendChild(s);
  }

  /* وكيل زرّ: ينسخ الأيقونة والعنوان، وينقر الأصل، ويعكس تعطيله */
  function proxy(id) {
    const src = document.getElementById(id);
    if (!src) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tbf-b';
    b.dataset.for = id;
    b.innerHTML = ICONS[id] || src.innerHTML;
    b.title = src.title || src.getAttribute('aria-label') || '';
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', () => src.click());
    src.classList.add('tbf-moved');
    originals.push(src);
    // مرآة التعطيل: الأصل قد يُعطَّل (مثلاً تراجع بلا تاريخ)
    const mirror = () => {
      const off = src.disabled || src.getAttribute('data-disabled') === 'true';
      b.classList.toggle('off', !!off);
    };
    mirror();
    new MutationObserver(mirror).observe(src, { attributes: true, attributeFilter: ['disabled', 'data-disabled', 'class'] });
    return b;
  }

  /* بعد نقل الأزرار تبقى فواصل معلّقة لا تفصل شيئاً — نخفيها كي لا تعلّم فراغاً */
  function tidySeparators() {
    const vis = el => el && !el.classList.contains('tbf-moved') && el.offsetParent !== null;
    document.querySelectorAll('header .tbtn-div').forEach(sep => {
      let p = sep.previousElementSibling; while (p && !vis(p)) p = p.previousElementSibling;
      let n = sep.nextElementSibling;     while (n && !vis(n)) n = n.nextElementSibling;
      const btn = el => el && el.tagName === 'BUTTON';
      if (!btn(p) || !btn(n)) { sep.classList.add('tbf-moved'); originals.push(sep); }
    });
  }

  function build() {
    const host = document.querySelector('.canvas-area') || document.querySelector('.canvas-wrap');
    if (!host || document.getElementById('dq-toolbar-float')) return;
    injectCSS();

    bar = document.createElement('div');
    bar.className = 'tbf';
    bar.id = 'dq-toolbar-float';

    grip = document.createElement('div');
    grip.className = 'tbf-grip';
    grip.textContent = '⠿';
    grip.title = 'اسحب لتحريك الشريط — أفلته قرب حافة ليرسو';

    body = document.createElement('div');
    body.className = 'tbf-body';

    let added = 0;
    GROUPS.forEach((g, gi) => {
      const made = g.map(proxy).filter(Boolean);
      if (!made.length) return;
      if (added && gi) { const sp = document.createElement('div'); sp.className = 'tbf-sep'; body.appendChild(sp); }
      made.forEach(b => body.appendChild(b));
      added += made.length;
    });
    if (!added) return;   // لا أزرار لننقلها — لا تبنِ شريطاً فارغاً
    HIDE_ONLY.forEach(id => {
      const o = document.getElementById(id);
      if (o) { o.classList.add('tbf-moved'); originals.push(o); }
    });
    tidySeparators();

    const fold = document.createElement('button');
    fold.className = 'tbf-fold'; fold.type = 'button';
    fold.textContent = '–'; fold.title = 'طيّ الشريط';
    fold.addEventListener('click', () => {
      const f = bar.classList.toggle('folded');
      fold.textContent = f ? '+' : '–';
      fold.title = f ? 'توسيع الشريط' : 'طيّ الشريط';
      save({ folded: f });
      place();
    });

    bar.append(grip, body, fold);
    host.appendChild(bar);

    const ghost = document.createElement('div');
    ghost.className = 'tbf-ghost';
    host.appendChild(ghost);

    const s = st();
    if (s.folded) { bar.classList.add('folded'); fold.textContent = '+'; }
    place();
    wireDrag(host, ghost);
    window.addEventListener('resize', place);
  }

  /* المواضع: أربع حواف + موضع حرّ محفوظ بنسبة مئوية فيصمد مع تغيّر المقاس */
  function place() {
    if (!bar) return;
    const s = st();
    const dock = s.dock || 'top';
    bar.classList.toggle('vert', dock === 'left' || dock === 'right');
    bar.style.inset = '';
    bar.style.left = bar.style.right = bar.style.top = bar.style.bottom = '';
    const host = bar.parentElement;
    const r = host.getBoundingClientRect();
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const M = 12;
    switch (dock) {
      case 'top':    bar.style.top = M + 'px';    bar.style.left = Math.round((r.width - bw) / 2) + 'px'; break;
      case 'bottom': bar.style.bottom = M + 'px'; bar.style.left = Math.round((r.width - bw) / 2) + 'px'; break;
      case 'left':   bar.style.left = M + 'px';   bar.style.top = Math.round((r.height - bh) / 2) + 'px'; break;
      case 'right':  bar.style.right = M + 'px';  bar.style.top = Math.round((r.height - bh) / 2) + 'px'; break;
      default: {     // حرّ
        const x = Math.min(Math.max(0, (s.fx ?? 0.5) * r.width - bw / 2), Math.max(0, r.width - bw));
        const y = Math.min(Math.max(0, (s.fy ?? 0.06) * r.height), Math.max(0, r.height - bh));
        bar.style.left = Math.round(x) + 'px'; bar.style.top = Math.round(y) + 'px';
      }
    }
  }

  function wireDrag(host, ghost) {
    let drag = null;
    const EDGE = 64;   // قرب هذه المسافة من الحافة = إرساء

    const targetFor = (x, y, r) => {
      if (y - r.top < EDGE) return 'top';
      if (r.bottom - y < EDGE) return 'bottom';
      if (x - r.left < EDGE) return 'left';
      if (r.right - x < EDGE) return 'right';
      return 'free';
    };

    grip.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const b = bar.getBoundingClientRect();
      drag = { dx: e.clientX - b.left, dy: e.clientY - b.top, moved: false };
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const r = host.getBoundingClientRect();
      if (!drag.moved) { drag.moved = true; bar.classList.add('dragging'); ghost.classList.add('show'); }
      bar.style.right = bar.style.bottom = '';
      bar.style.left = (e.clientX - drag.dx - r.left) + 'px';
      bar.style.top = (e.clientY - drag.dy - r.top) + 'px';

      const t = targetFor(e.clientX, e.clientY, r);
      const vert = t === 'left' || t === 'right';
      const bw = vert ? bar.offsetHeight : bar.offsetWidth;
      const bh = vert ? bar.offsetWidth : bar.offsetHeight;
      const M = 12;
      Object.assign(ghost.style, { width: bw + 'px', height: bh + 'px', left: '', right: '', top: '', bottom: '' });
      if (t === 'top')         { ghost.style.top = M + 'px';    ghost.style.left = ((r.width - bw) / 2) + 'px'; }
      else if (t === 'bottom') { ghost.style.bottom = M + 'px'; ghost.style.left = ((r.width - bw) / 2) + 'px'; }
      else if (t === 'left')   { ghost.style.left = M + 'px';   ghost.style.top = ((r.height - bh) / 2) + 'px'; }
      else if (t === 'right')  { ghost.style.right = M + 'px';  ghost.style.top = ((r.height - bh) / 2) + 'px'; }
      else { ghost.style.left = bar.style.left; ghost.style.top = bar.style.top;
             ghost.style.width = bar.offsetWidth + 'px'; ghost.style.height = bar.offsetHeight + 'px'; }
      drag.target = t;
    });

    window.addEventListener('mouseup', e => {
      if (!drag) return;
      const moved = drag.moved, t = drag.target || 'free';
      drag = null;
      document.body.style.userSelect = '';
      bar.classList.remove('dragging');
      ghost.classList.remove('show');
      if (!moved) return;
      const r = host.getBoundingClientRect();
      if (t === 'free') {
        save({ dock: 'free', fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
      } else {
        save({ dock: t });
        const AR = { top: 'أعلى', bottom: 'أسفل', left: 'يسار', right: 'يمين' };
        window.app?.toast?.('📌 رسا الشريط المتنقّل: ' + AR[t], 'info');
      }
      place();
    });
  }

  window.ToolbarFloat = {
    show: () => { if (bar) { bar.style.display = ''; save({ hidden: false }); } },
    hide: () => { if (bar) { bar.style.display = 'none'; save({ hidden: true }); } },
    dock: d => { save({ dock: d }); place(); },
    /* استعادة الأزرار للشريط العلوي (لو أراد المستخدم الترتيب القديم) */
    restore: () => {
      originals.forEach(o => o.classList.remove('tbf-moved'));
      bar?.remove();
      bar = null;
    },
  };

  function boot() {
    build();
    if (st().hidden && bar) bar.style.display = 'none';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
