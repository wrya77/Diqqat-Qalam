/**
 * command-palette.js — لوحة أوامر فورية (Ctrl+K / Ctrl+P)
 *
 * تبحث بالاسم العربي عن أي أداة أو أمر في التطبيق وتشغّله فوراً — بدل التنقل في القوائم.
 * لا تكرّر أي منطق: تحصد الأزرار الموجودة ([data-tool] و .mi[data-act]) وتشغّلها كما لو نُقرت.
 * أي أداة جديدة تُضاف مستقبلاً تظهر تلقائياً في اللوحة.
 *
 * يُحمَّل بعد menu-bar.js (لتكون كل الأوامر مربوطة) وقبل app.js.
 */
(function commandPalette() {
  'use strict';

  /* ── تطبيع عربي للبحث: يتجاهل التشكيل ويوحّد الألف/الياء/التاء المربوطة ── */
  function norm(s) {
    return (s || '')
      .replace(/[ً-ْٰـ]/g, '')  // تشكيل + تطويل
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  /* ── حصد كل الأوامر من DOM عند الفتح ── */
  function buildIndex() {
    const cmds = [];

    // 1) الأدوات (شريط الأدوات الجانبي) — من data-tool + title
    const seen = new Set();
    document.querySelectorAll('[data-tool]').forEach(b => {
      const id = b.dataset.tool;
      if (!id || seen.has(id)) return;
      seen.add(id);
      const title = (b.getAttribute('title') || id).trim();
      const label = title.split('—')[0].split('[')[0].trim() || id;
      const shortcut = (title.match(/\[([^\]]+)\]/) || [])[1] || '';
      cmds.push({
        label, shortcut, hint: 'أداة', icon: '✎',
        search: norm(label + ' ' + title + ' ' + id),
        run: () => { const ed = window.app?.editor; if (ed) ed.setTool(id); },
      });
    });

    // 2) أوامر القوائم — من .mi[data-act] + نصّها العربي
    document.querySelectorAll('.mi[data-act]').forEach(b => {
      const keyEl = b.querySelector('.mi-key');
      const shortcut = keyEl ? keyEl.textContent.trim() : '';
      let label = b.textContent || '';
      if (shortcut) label = label.replace(shortcut, '');
      label = label.replace(/…/g, '').trim();
      if (!label) return;
      const menu = b.closest('.menu')?.querySelector('.menu-btn')?.textContent.trim() || 'أمر';
      cmds.push({
        label, shortcut, hint: menu, icon: '⌘',
        search: norm(label + ' ' + menu),
        run: () => b.click(),
      });
    });

    // 3) روابط القوائم (تصدير/مكتبة… أي <a class="mi">)
    document.querySelectorAll('a.mi[href]').forEach(a => {
      const label = (a.textContent || '').replace(/…/g, '').trim();
      if (!label) return;
      const menu = a.closest('.menu')?.querySelector('.menu-btn')?.textContent.trim() || 'أمر';
      cmds.push({ label, shortcut: '', hint: menu, icon: '↗', search: norm(label + ' ' + menu), run: () => a.click() });
    });

    return cmds;
  }

  /* ── ترتيب النتائج: بداية الكلمة أولاً ثم التضمين ── */
  function rank(cmds, q) {
    const nq = norm(q);
    if (!nq) return cmds.slice(0, 40);
    const tokens = nq.split(' ');
    const scored = [];
    for (const c of cmds) {
      let ok = true, score = 0;
      for (const t of tokens) {
        const idx = c.search.indexOf(t);
        if (idx < 0) { ok = false; break; }
        score += idx === 0 ? 0 : (c.search[idx - 1] === ' ' ? 1 : 3);  // بداية كلمة أفضل
      }
      if (ok) scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score || a.c.label.length - b.c.label.length);
    return scored.slice(0, 40).map(s => s.c);
  }

  /* ── بناء الواجهة مرة واحدة ── */
  let ov, input, list, cmds = [], results = [], active = 0;

  function injectCSS() {
    if (document.getElementById('cmdp-css')) return;
    const st = document.createElement('style');
    st.id = 'cmdp-css';
    st.textContent = `
      .cmdp-ov{position:fixed;inset:0;z-index:3000;display:none;align-items:flex-start;justify-content:center;
        background:rgba(2,4,8,.55);backdrop-filter:blur(3px);padding-top:12vh}
      .cmdp-ov.open{display:flex;animation:cmdpIn .12s ease-out}
      @keyframes cmdpIn{from{opacity:0}to{opacity:1}}
      .cmdp-box{width:min(620px,92vw);max-height:70vh;display:flex;flex-direction:column;
        background:var(--bg1,#0d1117);border:1px solid var(--border2,#3d444d);border-radius:14px;
        box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden;animation:cmdpBox .14s ease-out}
      @keyframes cmdpBox{from{transform:translateY(-8px) scale(.99);opacity:.6}to{transform:none;opacity:1}}
      .cmdp-inwrap{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border,#30363d)}
      .cmdp-inwrap .cmdp-mag{color:var(--text3,#8b949e);font-size:17px}
      .cmdp-in{flex:1;background:none;border:none;outline:none;color:var(--text,#e6edf3);
        font-family:inherit;font-size:16px;padding:2px 0}
      .cmdp-in::placeholder{color:var(--text3,#8b949e)}
      .cmdp-hintk{font-size:11px;color:var(--text3,#8b949e);border:1px solid var(--border,#30363d);
        border-radius:5px;padding:2px 7px;font-family:var(--font-mono,monospace)}
      .cmdp-list{overflow-y:auto;padding:6px;scrollbar-width:thin}
      .cmdp-item{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:8px;cursor:pointer}
      .cmdp-item .cmdp-ic{width:22px;text-align:center;color:var(--text3,#8b949e);font-size:14px;flex-shrink:0}
      .cmdp-item .cmdp-lbl{flex:1;color:var(--text,#e6edf3);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cmdp-item .cmdp-cat{font-size:11.5px;color:var(--text3,#8b949e)}
      .cmdp-item .cmdp-sc{font-size:11px;color:var(--text2,#b1bac4);border:1px solid var(--border,#30363d);
        border-radius:5px;padding:1px 6px;font-family:var(--font-mono,monospace)}
      .cmdp-item.on{background:var(--accent-soft,rgba(79,110,247,.15))}
      .cmdp-item.on .cmdp-ic{color:var(--accent-h,#6b86ff)}
      .cmdp-empty{padding:26px;text-align:center;color:var(--text3,#8b949e);font-size:14px}
      .cmdp-foot{display:flex;gap:16px;padding:8px 16px;border-top:1px solid var(--border,#30363d);
        font-size:11.5px;color:var(--text3,#8b949e)}
      .cmdp-foot b{color:var(--text2,#b1bac4);font-weight:600}
    `;
    document.head.appendChild(st);
  }

  function build() {
    injectCSS();
    ov = document.createElement('div');
    ov.className = 'cmdp-ov';
    ov.dir = 'rtl';
    ov.innerHTML = `
      <div class="cmdp-box" role="dialog" aria-label="لوحة الأوامر">
        <div class="cmdp-inwrap">
          <span class="cmdp-mag">🔎</span>
          <input class="cmdp-in" type="text" placeholder="ابحث عن أداة أو أمر… (مثال: تجميع، عمق، تدوير)" aria-label="بحث">
          <span class="cmdp-hintk">Esc</span>
        </div>
        <div class="cmdp-list"></div>
        <div class="cmdp-foot"><span><b>↑↓</b> تنقّل</span><span><b>Enter</b> تشغيل</span><span><b>Esc</b> إغلاق</span></div>
      </div>`;
    document.body.appendChild(ov);
    input = ov.querySelector('.cmdp-in');
    list = ov.querySelector('.cmdp-list');

    input.addEventListener('input', () => { refresh(); });
    input.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  }

  function renderList() {
    if (!results.length) {
      list.innerHTML = `<div class="cmdp-empty">لا نتائج — جرّب كلمة أخرى</div>`;
      return;
    }
    list.innerHTML = results.map((c, i) => `
      <div class="cmdp-item ${i === active ? 'on' : ''}" data-i="${i}">
        <span class="cmdp-ic">${c.icon}</span>
        <span class="cmdp-lbl">${c.label}</span>
        <span class="cmdp-cat">${c.hint}</span>
        ${c.shortcut ? `<span class="cmdp-sc">${c.shortcut}</span>` : ''}
      </div>`).join('');
    list.querySelectorAll('.cmdp-item').forEach(el => {
      el.addEventListener('mousemove', () => { active = +el.dataset.i; markActive(); });
      el.addEventListener('click', () => run(+el.dataset.i));
    });
  }

  function markActive() {
    list.querySelectorAll('.cmdp-item').forEach((el, i) => el.classList.toggle('on', i === active));
    const el = list.querySelector('.cmdp-item.on');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function refresh() {
    results = rank(cmds, input.value);
    active = 0;
    renderList();
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, results.length - 1); markActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); markActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function run(i) {
    const c = results[i];
    close();
    if (c && typeof c.run === 'function') { try { c.run(); } catch (err) { console.warn('cmd failed', err); } }
  }

  function open() {
    if (!ov) build();
    cmds = buildIndex();               // حصد طازج في كل فتح (يلتقط أي جديد)
    input.value = '';
    refresh();
    ov.classList.add('open');
    setTimeout(() => input.focus(), 20);
  }

  function close() {
    if (ov) ov.classList.remove('open');
  }

  // Ctrl/Cmd + K  أو  Ctrl/Cmd + P
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.code === 'KeyK' || e.code === 'KeyP')) {
      e.preventDefault();
      (ov && ov.classList.contains('open')) ? close() : open();
    }
  });

  // أتِح فتحها برمجياً (زر في الشريط لاحقاً)
  window.CommandPalette = { open, close };
})();
