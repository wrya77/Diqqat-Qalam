/**
 * color-system.js — نظام الألوان بنمط CorelDraw / Illustrator
 *
 *  شريط ألوان أفقي أسفل الكانفس (كلوحة CorelDraw الراسية لكن أفقية ليلائم RTL):
 *   - نقرة يسرى على لون  → لون الخط (المسار) للأشكال المحددة
 *   - نقرة يمنى على لون  → لون التعبئة
 *   - بلا تحديد          → يضبط اللون الافتراضي للأشكال الجديدة (سلوك CorelDraw)
 *   - خانة ∅             → إزالة اللون (عودة للافتراضي/بلا تعبئة)
 *   - 🎨 لون مخصص        → منتقي ألوان النظام
 *   - مؤشّر خط/تعبئة كمربّعَي Illustrator مع زر تبديل ⇄ (Shift+X)
 *
 *  الألوان بصرية وتنظيمية (تمييز عمليات: قطع/نقش/تخطيط) — لا تغيّر G-Code.
 *  لون الشكل الخاص يغلب صبغة الطبقة (شرط !s.stroke في layers-panel).
 *  يُحمَّل بعد layers-panel.js وقبل app.js.
 */
(function colorSystem() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');
  const ed = () => window.app && window.app.editor;

  /* لوحة CorelDraw القياسية (مختصرة لعمليات CNC الشائعة) */
  const SWATCHES = [
    '#000000', '#404040', '#808080', '#c0c0c0', '#ffffff',
    '#8b0000', '#f85149', '#ff6b35', '#ff8c00', '#ffd33d',
    '#9acd32', '#3fb950', '#2e8b57', '#39c5cf', '#00bfff',
    '#2f81f7', '#4f6ef7', '#191970', '#a371f7', '#8b008b',
    '#db61a2', '#ff69b4', '#8b4513', '#d2691e', '#e3b341',
  ];

  /* ── الحالة: افتراضيات الأشكال الجديدة (تُحفَظ وتُستعاد) ── */
  const state = {
    defStroke: localStorage.getItem('dq_def_stroke') || null,
    defFill:   localStorage.getItem('dq_def_fill') || null,
  };
  function saveDefs() {
    state.defStroke ? localStorage.setItem('dq_def_stroke', state.defStroke) : localStorage.removeItem('dq_def_stroke');
    state.defFill   ? localStorage.setItem('dq_def_fill', state.defFill)     : localStorage.removeItem('dq_def_fill');
  }

  /* ── ختم كسول: الأشكال الجديدة ترث الافتراضي الحالي (سلوك CorelDraw) ── */
  const origDraw = P._drawShape;
  P._drawShape = function (s) {
    if (s.stroke === undefined) s.stroke = state.defStroke;
    if (s.fill === undefined) s.fill = state.defFill;
    origDraw.call(this, s);
  };

  /* ── الفهارس المحددة: msel الجماعي أو selectedIdx الفردي ── */
  function selIdxs(e) {
    if (e.msel && e.msel.size) return [...e.msel];
    return e.selectedIdx >= 0 ? [e.selectedIdx] : [];
  }

  /* ── الألوان الأخيرة (آخر 10 ألوان مصمتة مُطبَّقة) ── */
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem('dq_recent_colors') || '[]'); } catch (e) { recents = []; }
  function pushRecent(color) {
    if (typeof color !== 'string' || !color) return;   // التدرّجات لا تُسجَّل
    recents = [color, ...recents.filter(c => c !== color)].slice(0, 10);
    localStorage.setItem('dq_recent_colors', JSON.stringify(recents));
    renderRecents();
  }
  function renderRecents() {
    const box = document.getElementById('clr-recents');
    if (!box) return;
    box.innerHTML = recents.map(c => `<button class="clr-sw" data-c="${c}" style="background:${c}"
      title="${c} — أخير: يسرى خط · يمنى تعبئة"></button>`).join('') || '<span class="clr-recent-empty">—</span>';
    box.querySelectorAll('.clr-sw').forEach(b => {
      b.addEventListener('click', () => apply('stroke', b.dataset.c));
      b.addEventListener('contextmenu', e => { e.preventDefault(); apply('fill', b.dataset.c); });
    });
  }

  /* ── تطبيق لون على خاصية (stroke|fill) — color نصّ مصمت أو كائن تدرّج ── */
  function apply(prop, color) {
    const e = ed();
    if (!e) return;
    pushRecent(color);
    const idxs = selIdxs(e);
    if (!idxs.length) {
      // بلا تحديد → افتراضي الأشكال الجديدة (كما يسأل CorelDraw)
      if (prop === 'stroke') state.defStroke = color; else state.defFill = color;
      saveDefs(); syncIndicator();
      toast(color
        ? `🎨 ${prop === 'stroke' ? 'خط' : 'تعبئة'} الأشكال الجديدة: ${color}`
        : `∅ أُزيل ${prop === 'stroke' ? 'خط' : 'تعبئة'} الافتراضي`, 'info');
      return;
    }
    e._saveHistory?.();
    idxs.forEach(i => { const s = e.shapes[i]; if (s) s[prop] = color; });
    e.render(); syncIndicator();
    toast(`🎨 ${prop === 'stroke' ? 'لون الخط' : 'التعبئة'} → ${idxs.length} شكل`, 'success');
  }

  /* ── تبديل خط ⇄ تعبئة (Shift+X كما في Illustrator) ── */
  function swap() {
    const e = ed();
    const idxs = e ? selIdxs(e) : [];
    if (idxs.length) {
      e._saveHistory?.();
      idxs.forEach(i => {
        const s = e.shapes[i]; if (!s) return;
        const t = s.stroke; s.stroke = s.fill; s.fill = t;
      });
      e.render();
    } else {
      const t = state.defStroke; state.defStroke = state.defFill; state.defFill = t;
      saveDefs();
    }
    syncIndicator();
  }

  /* ── المؤشّر يعكس المحدد أولاً ثم الافتراضي ── */
  function syncIndicator() {
    const e = ed();
    let stroke = state.defStroke, fill = state.defFill;
    if (e) {
      const idxs = selIdxs(e);
      if (idxs.length) { const s = e.shapes[idxs[0]]; stroke = s?.stroke ?? null; fill = s?.fill ?? null; }
    }
    const sc = document.getElementById('clr-stroke-chip');
    const fc = document.getElementById('clr-fill-chip');
    if (sc) { sc.style.borderColor = stroke || '#2f81f7'; sc.classList.toggle('empty', !stroke); }
    if (fc) { fc.style.background = fill || 'transparent'; fc.classList.toggle('empty', !fill); }
  }

  /* ═══════════════ الواجهة ═══════════════ */
  function injectCSS() {
    if (document.getElementById('clr-css')) return;
    const st = document.createElement('style');
    st.id = 'clr-css';
    st.textContent = `
      .clr-bar{display:flex;align-items:center;gap:4px;padding:3px 10px;overflow-x:auto;scrollbar-width:none;
        background:var(--bg1,#0d1117);border-top:1px solid var(--border,#30363d);min-height:26px}
      .clr-bar::-webkit-scrollbar{display:none}
      .clr-ind{display:flex;align-items:center;gap:2px;margin-inline-end:6px;flex-shrink:0}
      .clr-chip{width:16px;height:16px;border-radius:4px;display:inline-block;position:relative}
      .clr-strokechip{border:3px solid #2f81f7;background:transparent;margin-inline-start:-7px;margin-top:7px}
      .clr-fillchip{border:1px solid var(--border2,#3d444d)}
      .clr-chip.empty::after{content:'';position:absolute;inset:1px;
        background:linear-gradient(45deg,transparent 44%,#f85149 46%,#f85149 54%,transparent 56%)}
      .clr-swap{background:none;border:none;color:var(--text3,#8b949e);cursor:pointer;font-size:12px;
        padding:0 4px;line-height:1}
      .clr-swap:hover{color:var(--text,#e6edf3)}
      .clr-sw{width:15px;height:15px;border-radius:3px;border:1px solid rgba(255,255,255,.12);cursor:pointer;
        flex-shrink:0;padding:0;transition:transform .08s}
      .clr-sw:hover{transform:scale(1.35);border-color:#fff;z-index:1}
      .clr-none{width:17px;height:17px;border-radius:3px;border:1px solid var(--border2,#3d444d);cursor:pointer;
        background:var(--bg2,#161b22);color:#f85149;font-size:11px;line-height:1;padding:0;flex-shrink:0}
      .clr-custom{width:20px;height:18px;padding:0;border:1px solid var(--border2,#3d444d);border-radius:3px;
        background:none;cursor:pointer;flex-shrink:0}
      .clr-hint{font-size:10px;color:var(--text3,#8b949e);margin-inline-start:auto;white-space:nowrap;flex-shrink:0}
      .clr-div{color:var(--border2,#3d444d);flex-shrink:0;font-size:14px}
      .clr-recents{display:flex;gap:4px;align-items:center;flex-shrink:0}
      .clr-recent-empty{color:var(--text3,#8b949e);font-size:11px}
      .clr-tools{display:flex;gap:4px;align-items:center;flex-shrink:0;margin-inline-start:6px}
      .clr-toolbtn{width:22px;height:19px;border:1px solid var(--border2,#3d444d);border-radius:4px;
        background:var(--bg2,#161b22);color:var(--text2,#b1bac4);cursor:pointer;font-size:12px;line-height:1;padding:0}
      .clr-toolbtn:hover{color:var(--text,#e6edf3);border-color:var(--accent,#4f6ef7)}
      .clr-toolbtn.armed{background:var(--accent,#4f6ef7);color:#fff;border-color:var(--accent,#4f6ef7)}
    `;
    document.head.appendChild(st);
  }

  function build() {
    injectCSS();
    const wrap = document.querySelector('.canvas-wrap');
    const footer = document.querySelector('.canvas-footer');
    if (!wrap || !footer || document.getElementById('color-bar')) return;

    const bar = document.createElement('div');
    bar.className = 'clr-bar';
    bar.id = 'color-bar';
    bar.innerHTML = `
      <span class="clr-ind" title="خط/تعبئة — ⇄ للتبديل (Shift+X)">
        <span class="clr-chip clr-fillchip" id="clr-fill-chip"></span>
        <span class="clr-chip clr-strokechip" id="clr-stroke-chip"></span>
        <button class="clr-swap" id="clr-swap" title="تبديل خط ⇄ تعبئة (Shift+X)">⇄</button>
      </span>
      <button class="clr-none" id="clr-none" title="إزالة: يسرى=الخط · يمنى=التعبئة">∅</button>
      <input type="color" class="clr-custom" id="clr-custom" value="#4f6ef7"
             title="لون مخصص: يُطبَّق على الخط — مع Shift على التعبئة">
      ${SWATCHES.map(c => `<button class="clr-sw" data-c="${c}" style="background:${c}"
             title="${c} — يسرى: خط · يمنى: تعبئة"></button>`).join('')}
      <span class="clr-div" title="ألوان أخيرة">│</span>
      <span class="clr-recents" id="clr-recents"></span>
      <span class="clr-tools" id="clr-tools"></span>
      <span class="clr-hint">يسرى: خط │ يمنى: تعبئة</span>
    `;
    wrap.insertBefore(bar, footer);

    /* أحداث الخانات */
    bar.querySelectorAll('.clr-sw').forEach(b => {
      b.addEventListener('click', () => apply('stroke', b.dataset.c));
      b.addEventListener('contextmenu', e => { e.preventDefault(); apply('fill', b.dataset.c); });
    });
    const none = document.getElementById('clr-none');
    none.addEventListener('click', () => apply('stroke', null));
    none.addEventListener('contextmenu', e => { e.preventDefault(); apply('fill', null); });

    const custom = document.getElementById('clr-custom');
    custom.addEventListener('change', e => apply(e.shiftKey ? 'fill' : 'stroke', custom.value));

    document.getElementById('clr-swap').addEventListener('click', swap);

    /* Shift+X — تبديل خط/تعبئة كما في Illustrator */
    document.addEventListener('keydown', e => {
      if (e.shiftKey && !e.ctrlKey && !e.altKey && e.code === 'KeyX' &&
          !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
        e.preventDefault(); swap();
      }
    });

    /* مزامنة المؤشّر مع تغيّر التحديد */
    const origToolbar = P._updateShapeToolbar;
    P._updateShapeToolbar = function () { origToolbar?.call(this); syncIndicator(); };
    syncIndicator();
    renderRecents();
    document.dispatchEvent(new CustomEvent('colorbar:ready'));   // إشارة لأدوات اللون الإضافية
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  window.ColorSystem = { apply, swap, selIdxs: () => selIdxs(ed()), pushRecent };
})();
