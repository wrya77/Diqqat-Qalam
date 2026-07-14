/**
 * color-tools.js — أدوات لون متقدّمة: ملتقط الألوان + التدرّجات
 *
 *  💧 ملتقط الألوان (Eyedropper — اختصار I):
 *      يسلّح الأداة، والنقرة التالية على اللوحة تلتقط لون البكسل تحتها
 *      وتطبّقه على الخط (أو التعبئة مع Shift). كأداة القطّارة في Illustrator.
 *
 *  🌈 التدرّج (Gradient):
 *      يفتح لوحة صغيرة لبناء تدرّج خطي/شعاعي بلونين وزاوية، ويطبّقه تعبئةً
 *      على الأشكال المحددة. يُخزَّن ككائن {type,angle,stops} يفهمه _resolveFill.
 *
 *  التدرّج تنظيمي/بصري فقط — لا يؤثّر على G-Code (القطع يتبع الخط).
 *  يعتمد على color-system.js (window.ColorSystem) ويُحمَّل بعده.
 */
(function colorTools() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');
  const ed = () => window.app && window.app.editor;

  /* ══════════════ 💧 ملتقط الألوان ══════════════ */
  let armed = false;

  function setArmed(on) {
    armed = on;
    const btn = document.getElementById('clr-eyedrop');
    if (btn) btn.classList.toggle('armed', on);
    const cv = ed()?.canvas;
    if (cv) cv.style.cursor = on ? 'crosshair' : '';
  }

  // لون البكسل تحت المؤشّر من كانفس المحرر (يراعي devicePixelRatio)
  function pickAt(clientX, clientY, toFill) {
    const e = ed();
    if (!e) return;
    const cv = e.canvas, rect = cv.getBoundingClientRect();
    const x = Math.round((clientX - rect.left) * (cv.width / rect.width));
    const y = Math.round((clientY - rect.top) * (cv.height / rect.height));
    const d = e.ctx.getImageData(x, y, 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    window.ColorSystem.apply(toFill ? 'fill' : 'stroke', hex);
    toast(`💧 التُقط ${hex} → ${toFill ? 'التعبئة' : 'الخط'}`, 'success');
  }

  function bindEyedropper() {
    // مستمع على المستند بمرحلة الالتقاط — لا يحتاج الكانفس وقت الإقلاع (app.js يأتي لاحقاً)
    // نعترض قبل أدوات الرسم/التحديد فلا تُنشأ أشكال عند الالتقاط
    document.addEventListener('mousedown', e => {
      if (!armed) return;
      const cv = ed()?.canvas;
      if (!cv || e.target !== cv) return;
      e.preventDefault(); e.stopPropagation();
      pickAt(e.clientX, e.clientY, e.shiftKey || e.button === 2);
      setArmed(false);
    }, true);
    document.addEventListener('contextmenu', e => {
      if (armed && e.target === ed()?.canvas) e.preventDefault();
    }, true);
    // I = تسليح، Esc = إلغاء
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyI' && !e.shiftKey) { e.preventDefault(); setArmed(!armed); }
      else if (e.key === 'Escape' && armed) { setArmed(false); }
    });
  }

  /* ══════════════ 🌈 التدرّج ══════════════ */
  function injectCSS() {
    if (document.getElementById('clrt-css')) return;
    const st = document.createElement('style');
    st.id = 'clrt-css';
    st.textContent = `
      .grad-pop{position:fixed;z-index:3200;width:280px;background:var(--bg1,#0d1117);
        border:1px solid var(--border2,#3d444d);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);
        padding:14px;display:none;font-size:13px;color:var(--text,#e6edf3)}
      .grad-pop.open{display:block;animation:gradIn .12s ease-out}
      @keyframes gradIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .grad-pop h4{margin:0 0 10px;font-size:13.5px;display:flex;justify-content:space-between;align-items:center}
      .grad-pop .gx{cursor:pointer;color:var(--text3,#8b949e);border:none;background:none;font-size:16px}
      .grad-prev{height:34px;border-radius:8px;border:1px solid var(--border,#30363d);margin-bottom:12px}
      .grad-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
      .grad-row label{flex:1;color:var(--text2,#b1bac4)}
      .grad-row input[type=color]{width:34px;height:26px;border:1px solid var(--border2,#3d444d);border-radius:5px;
        background:none;padding:0;cursor:pointer}
      .grad-row input[type=range]{flex:1;accent-color:var(--accent,#4f6ef7)}
      .grad-types{display:flex;gap:6px;margin-bottom:12px}
      .grad-types button{flex:1;padding:6px;border:1px solid var(--border2,#3d444d);border-radius:7px;
        background:var(--bg2,#161b22);color:var(--text2,#b1bac4);cursor:pointer;font-size:12.5px}
      .grad-types button.on{background:var(--accent,#4f6ef7);color:#fff;border-color:var(--accent,#4f6ef7)}
      .grad-apply{width:100%;padding:9px;border:none;border-radius:8px;background:var(--accent,#4f6ef7);
        color:#fff;font-weight:600;cursor:pointer;font-size:13.5px}
      .grad-apply:hover{filter:brightness(1.08)}
      .grad-angle-val{min-width:38px;text-align:center;color:var(--text2,#b1bac4);font-size:12px}
    `;
    document.head.appendChild(st);
  }

  const g = { type: 'linear', angle: 0, c1: '#4f6ef7', c2: '#39c5cf' };
  let pop;

  function cssPreview() {
    return g.type === 'radial'
      ? `radial-gradient(circle, ${g.c1}, ${g.c2})`
      : `linear-gradient(${g.angle + 90}deg, ${g.c1}, ${g.c2})`;
  }
  function refreshPreview() {
    const pv = pop.querySelector('.grad-prev');
    if (pv) pv.style.background = cssPreview();
    pop.querySelectorAll('.grad-types button').forEach(b => b.classList.toggle('on', b.dataset.t === g.type));
    const av = pop.querySelector('.grad-angle-val');
    if (av) av.textContent = g.angle + '°';
  }

  function buildPopover() {
    injectCSS();
    pop = document.createElement('div');
    pop.className = 'grad-pop';
    pop.innerHTML = `
      <h4>🌈 تدرّج التعبئة <button class="gx" id="grad-x">✕</button></h4>
      <div class="grad-prev"></div>
      <div class="grad-types">
        <button data-t="linear" class="on">خطي ↗</button>
        <button data-t="radial">شعاعي ◉</button>
      </div>
      <div class="grad-row"><label>اللون الأول</label><input type="color" id="grad-c1" value="${g.c1}"></div>
      <div class="grad-row"><label>اللون الثاني</label><input type="color" id="grad-c2" value="${g.c2}"></div>
      <div class="grad-row" id="grad-angle-row">
        <label>الزاوية</label>
        <input type="range" id="grad-angle" min="0" max="360" step="15" value="0">
        <span class="grad-angle-val">0°</span>
      </div>
      <button class="grad-apply" id="grad-apply">تطبيق على المحدد</button>
    `;
    document.body.appendChild(pop);

    pop.querySelector('#grad-x').addEventListener('click', closePop);
    pop.querySelectorAll('.grad-types button').forEach(b =>
      b.addEventListener('click', () => { g.type = b.dataset.t; refreshPreview(); }));
    pop.querySelector('#grad-c1').addEventListener('input', e => { g.c1 = e.target.value; refreshPreview(); });
    pop.querySelector('#grad-c2').addEventListener('input', e => { g.c2 = e.target.value; refreshPreview(); });
    pop.querySelector('#grad-angle').addEventListener('input', e => { g.angle = +e.target.value; refreshPreview(); });
    pop.querySelector('#grad-apply').addEventListener('click', applyGradient);
    document.addEventListener('mousedown', e => {
      if (pop.classList.contains('open') && !pop.contains(e.target) && e.target.id !== 'clr-gradient') closePop();
    });
  }

  function applyGradient() {
    const e = ed();
    const idxs = window.ColorSystem.selIdxs();
    const fill = { type: g.type, angle: g.angle, stops: [{ offset: 0, color: g.c1 }, { offset: 1, color: g.c2 }] };
    if (!idxs.length) {
      toast('حدّد شكلاً أو أكثر أولاً لتطبيق التدرّج', 'warn');
      return;
    }
    e._saveHistory?.();
    idxs.forEach(i => { const s = e.shapes[i]; if (s) s.fill = fill; });
    e.render();
    toast(`🌈 تدرّج ${g.type === 'radial' ? 'شعاعي' : 'خطي'} → ${idxs.length} شكل`, 'success');
    closePop();
  }

  function openPop(btn) {
    if (!pop) buildPopover();
    refreshPreview();
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 296)) + 'px';
    pop.style.top = Math.max(8, r.top - 300) + 'px';
    pop.classList.add('open');
  }
  function closePop() { pop && pop.classList.remove('open'); }

  /* ══════════════ حقن الأزرار في شريط الألوان ══════════════ */
  function injectButtons() {
    const box = document.getElementById('clr-tools');
    if (!box || box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML = `
      <button class="clr-toolbtn" id="clr-eyedrop" title="ملتقط الألوان (I) — Shift للتعبئة">💧</button>
      <button class="clr-toolbtn" id="clr-gradient" title="تدرّج التعبئة">🌈</button>`;
    document.getElementById('clr-eyedrop').addEventListener('click', () => setArmed(!armed));
    document.getElementById('clr-gradient').addEventListener('click', e => {
      pop && pop.classList.contains('open') ? closePop() : openPop(e.currentTarget);
    });
  }

  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    injectButtons();
    bindEyedropper();
  }
  // ينتظر جاهزية شريط الألوان (color-system يطلق الحدث)
  document.addEventListener('colorbar:ready', boot);
  if (document.getElementById('clr-tools')) boot();

  window.ColorTools = { eyedropper: () => setArmed(true), gradient: openPop };
})();
