/**
 * panels-illustrator.js — تسع لوحات Illustrator قابلة للرسو
 *
 *   مكتشف المسارات   — عشر عمليات كاملة + مسار مركّب + قناع قصّ + تمديد
 *   الملاحة           — خريطة مصغّرة للمستند مع مستطيل منطقة العرض
 *   دليل الألوان      — قواعد انسجام لوني تُولّد لوحة من اللون الحالي
 *   المظهر            — عرض وتحرير خصائص الشكل المحدد (حدّ، عمق، طبقة)
 *   الأنماط الجرافيكية — حفظ مجموعة خصائص وتطبيقها بنقرة
 *   الرموز            — مكتبة رموز + رشّاش
 *   الإجراءات         — مسجّل أوامر (macro) وتشغيلها بزرّ
 *   الحروف الرسومية    — تصفّح حروف الخطّ ودرجها
 *   ألواح الفنّ        — إدارة الألواح والتبليط وعلامات القطع
 *
 * كل زرّ ينادي واجهة موجودة على المحرّر (pfDivide · makeClipMask · extrude3D…)
 * فلا يصير للمنطق مصدران — اللوحة واجهة عرض لا محرّك.
 */
(function panelsIllustrator() {
  'use strict';

  const ed = () => window.app && window.app.editor;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };
  const sel = () => { const e = ed(); return e && e._selIndices ? e._selIndices() : []; };

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function btn(label, title, fn, cls) {
    const b = el('button', 'dqp-b' + (cls ? ' ' + cls : ''), label);
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  }
  const call = (m, ...a) => () => { const e = ed(); if (!e || typeof e[m] !== 'function') return toast('غير متاح', 'warn'); e[m](...a); };

  function injectCSS() {
    if (document.getElementById('dqpi-css')) return;
    const s = el('style'); s.id = 'dqpi-css';
    s.textContent = `
      .dqpi-grid{display:grid;gap:4px}
      .dqpi-g2{grid-template-columns:1fr 1fr}
      .dqpi-g3{grid-template-columns:1fr 1fr 1fr}
      .dqpi-g4{grid-template-columns:repeat(4,1fr)}
      .dqpi-list{display:flex;flex-direction:column;gap:3px;max-height:190px;overflow:auto}
      .dqpi-row{display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:6px;
        border:1px solid var(--border,#30363d);background:var(--bg2,#161b22);font-size:11.5px;
        color:var(--text2,#b1bac4);cursor:pointer;transition:background .12s ease,border-color .12s ease}
      .dqpi-row:hover{background:var(--bg3,#1c2128);border-color:var(--border2,#3d444d);color:var(--text,#e6edf3)}
      .dqpi-row.on{border-color:var(--accent,#4f6ef7);color:var(--accent-h,#58a6ff)}
      .dqpi-row .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dqpi-row .x{opacity:.5;padding:0 3px;border:none;background:none;color:inherit;cursor:pointer;font-size:13px}
      .dqpi-row .x:hover{opacity:1;color:var(--red,#f85149)}
      .dqpi-empty{font-size:11px;color:var(--text3,#8b949e);padding:8px 2px;text-align:center}
      .dqpi-sw{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
      .dqpi-sw i{aspect-ratio:1;border-radius:4px;border:1px solid rgba(0,0,0,.4);cursor:pointer;
        transition:transform .12s cubic-bezier(.34,1.56,.64,1)}
      .dqpi-sw i:hover{transform:scale(1.18)}
      .dqpi-nav{position:relative;width:100%;aspect-ratio:4/3;border:1px solid var(--border,#30363d);
        border-radius:6px;background:var(--bg1,#0d1117);overflow:hidden;cursor:move}
      .dqpi-nav canvas{position:absolute;inset:0;width:100%;height:100%}
      .dqpi-nav .vp{position:absolute;border:1.5px solid var(--accent,#4f6ef7);
        background:rgba(79,110,247,.1);pointer-events:none}
      .dqpi-kv{display:flex;justify-content:space-between;font-size:11px;padding:3px 0;
        color:var(--text3,#8b949e);border-bottom:1px dashed var(--border,#30363d)}
      .dqpi-kv b{color:var(--text2,#b1bac4);font-weight:600}
      .dqpi-glyphs{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;max-height:200px;overflow:auto}
      .dqpi-glyphs b{aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-weight:400;
        border:1px solid var(--border,#30363d);border-radius:4px;cursor:pointer;font-size:15px;
        color:var(--text2,#b1bac4);transition:background .1s ease}
      .dqpi-glyphs b:hover{background:var(--accent,#4f6ef7);color:#fff}
      .dqpi-rec{width:9px;height:9px;border-radius:50%;background:var(--red,#f85149);
        display:inline-block;animation:dqpiPulse 1s infinite}
      @keyframes dqpiPulse{50%{opacity:.25}}
    `;
    document.head.appendChild(s);
  }

  function sec(title, ...kids) {
    const s = el('div', 'dqp-sec');
    s.appendChild(el('div', 'dqp-h', `<span>${title}</span>`));
    kids.forEach(k => k && s.appendChild(k));
    return s;
  }
  const hint = t => el('div', 'dqp-hint', t);

  /* ═══════════════ ١) مكتشف المسارات الكامل ═══════════════ */
  function buildPathfinder() {
    const p = el('div', 'dqp');

    const g1 = el('div', 'dqpi-grid dqpi-g4');
    g1.append(
      btn('توحيد', 'دمج الأشكال في واحد', call('booleanOp', 'union')),
      btn('طرح أمامي', 'الأعلى يُطرح من الأسفل', call('booleanOp', 'difference')),
      btn('تقاطع', 'ما يشترك فيه الجميع', call('booleanOp', 'intersect')),
      btn('استبعاد', 'ما لا يشترك فيه الجميع', call('booleanOp', 'xor')),
    );

    const g2 = el('div', 'dqpi-grid dqpi-g3');
    g2.append(
      btn('تقسيم', 'كل تقاطع يفصل منطقة مستقلة', call('pfDivide')),
      btn('محاصرة', 'يزيل ما يخفيه ما فوقه — يمنع القطع المزدوج', call('pfTrim')),
      btn('دمج', 'محاصرة ثم توحيد المتلاصق', call('pfMerge')),
      btn('قصّ', 'يُبقي ما داخل الشكل الأعلى', call('pfCrop')),
      btn('مخطّط', 'يحوّل الحدود إلى خطوط', call('pfOutline')),
      btn('طرح خلفي', 'الأعلى يبقى ويُطرح منه ما تحته', call('pfMinusBack')),
    );

    const g3 = el('div', 'dqpi-grid dqpi-g2');
    g3.append(
      btn('مسار مركّب', 'ثقوب حقيقية داخل الشكل — Ctrl+8', call('makeCompoundPath')),
      btn('فكّ المركّب', 'Alt+Ctrl+8', call('releaseCompoundPath')),
      btn('قناع قصّ', 'الأعلى يقصّ ما تحته — Ctrl+7', call('makeClipMask')),
      btn('فكّ القناع', 'Alt+Ctrl+7', call('releaseClipMask')),
    );

    const g4 = el('div', 'dqpi-grid dqpi-g2');
    g4.append(
      btn('تمديد المظهر', 'تسطيح إلى مسارات نقية', call('expandAppearance')),
      btn('بثق ثلاثي الأبعاد', 'كفافات بأعماق متدرّجة', call('extrude3D')),
    );

    p.append(
      sec('أوضاع الشكل', g1),
      sec('مكتشف المسارات', g2, hint('«المحاصرة» أهمّها للقطع: تمنع مرور الرأس مرّتين على الخطّ نفسه.')),
      sec('مسارات وأقنعة', g3),
      sec('التمديد', g4),
    );
    return { el: p, sync() {} };
  }

  /* ═══════════════ ٢) الملاحة ═══════════════ */
  function buildNavigator() {
    const p = el('div', 'dqp');
    const box = el('div', 'dqpi-nav');
    const cv = el('canvas'); const vp = el('div', 'vp');
    box.append(cv, vp);

    const zoomRow = el('div', 'dqp-row');
    const rng = el('input'); rng.type = 'range'; rng.min = '5'; rng.max = '800'; rng.value = '100';
    rng.style.flex = '1'; rng.title = 'التكبير ٪'; rng.setAttribute('aria-label', 'التكبير');
    const lbl = el('span', 'dqp-lbl', '100%'); lbl.style.minWidth = '44px';
    zoomRow.append(lbl, rng);

    let baseScale = 1;
    rng.addEventListener('input', () => {
      const e = ed(); if (!e) return;
      const pct = +rng.value;
      lbl.textContent = pct + '%';
      const cx = e.canvas.width / 2, cy = e.canvas.height / 2;
      const w = e._sToW(cx, cy);
      e.scale = baseScale * pct / 100;
      const after = e._wToS(w.x, w.y);
      if (e.offsetX !== undefined) { e.offsetX += cx - after.x; e.offsetY += cy - after.y; }
      e.render();
    });

    const g = el('div', 'dqpi-grid dqpi-g3');
    g.append(
      btn('ملاءمة', 'ملاءمة كل الأشكال', () => document.getElementById('btn-zoom-fit')?.click()),
      btn('١٠٠٪', 'حجم طبيعي', () => { const e = ed(); if (!e) return; e.scale = baseScale; e.render(); draw(); }),
      btn('اللوح', 'ملاءمة اللوح النشط', call('fitToArtboard')),
    );

    function draw() {
      const e = ed(); if (!e || !cv.isConnected) return;
      const W = box.clientWidth || 200, H = box.clientHeight || 150;
      if (cv.width !== W) { cv.width = W; cv.height = H; }
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      if (!e.shapes.length) { vp.style.display = 'none'; return; }
      // صندوق يشمل كل الأشكال
      let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
      e.shapes.forEach(s => { const b = e._bounds(s); if (!b) return;
        mnX = Math.min(mnX, b.minX); mxX = Math.max(mxX, b.maxX);
        mnY = Math.min(mnY, b.minY); mxY = Math.max(mxY, b.maxY); });
      if (!isFinite(mnX)) return;
      const pad = 8;
      const k = Math.min((W - pad * 2) / ((mxX - mnX) || 1), (H - pad * 2) / ((mxY - mnY) || 1));
      const ox = pad - mnX * k, oy = pad - mnY * k;
      ctx.strokeStyle = '#8b949e'; ctx.lineWidth = 1;
      e.shapes.forEach(s => {
        const b = e._bounds(s); if (!b) return;
        ctx.strokeRect(b.minX * k + ox, b.minY * k + oy, (b.maxX - b.minX) * k, (b.maxY - b.minY) * k);
      });
      // مستطيل منطقة العرض الحالية
      const tl = e._sToW(0, 0), br = e._sToW(e.canvas.width, e.canvas.height);
      vp.style.display = '';
      vp.style.left = (tl.x * k + ox) + 'px';
      vp.style.top = (tl.y * k + oy) + 'px';
      vp.style.width = Math.max(4, (br.x - tl.x) * k) + 'px';
      vp.style.height = Math.max(4, (br.y - tl.y) * k) + 'px';
      box.__map = { k, ox, oy };
    }

    // سحب المستطيل ينقل العرض
    let dragging = false;
    const jump = evt => {
      const e = ed(), m = box.__map; if (!e || !m) return;
      const r = box.getBoundingClientRect();
      const wx = (evt.clientX - r.left - m.ox) / m.k, wy = (evt.clientY - r.top - m.oy) / m.k;
      const p2 = e._wToS(wx, wy);
      if (e.offsetX !== undefined) { e.offsetX += e.canvas.width / 2 - p2.x; e.offsetY += e.canvas.height / 2 - p2.y; }
      e.render(); draw();
    };
    box.addEventListener('mousedown', evt => { dragging = true; jump(evt); });
    window.addEventListener('mousemove', evt => { if (dragging) jump(evt); });
    window.addEventListener('mouseup', () => { dragging = false; });

    p.append(sec('خريطة المستند', box, hint('اسحب داخل الخريطة لنقل منطقة العرض.')),
             sec('التكبير', zoomRow, g));

    function sync() {
      const e = ed(); if (!e) return;
      if (baseScale === 1 && e.scale) baseScale = e.__navBase || (e.__navBase = e.scale);
      rng.value = String(Math.round(e.scale / baseScale * 100));
      lbl.textContent = rng.value + '%';
      draw();
    }
    setInterval(() => { if (box.isConnected && box.offsetParent) sync(); }, 700);
    return { el: p, sync };
  }

  /* ═══════════════ ٣) دليل الألوان ═══════════════ */
  function buildColorGuide() {
    const p = el('div', 'dqp');
    const base = el('input'); base.type = 'color'; base.value = '#4f9dff';
    base.style.cssText = 'width:100%;height:30px;border-radius:6px;border:1px solid var(--border);cursor:pointer';
    base.title = 'اللون الأساس'; base.setAttribute('aria-label', 'اللون الأساس');

    const rule = el('select', 'dqp-sel');
    rule.style.cssText = 'width:100%;height:28px;border-radius:6px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);font-family:inherit;font-size:11.5px';
    [['comp', 'تكميليّ'], ['tri', 'ثلاثيّ'], ['ana', 'متجاور'], ['split', 'تكميليّ منقسم'],
     ['tetra', 'رباعيّ'], ['mono', 'أحاديّ'], ['shades', 'درجات']].forEach(([v, t]) => {
      const o = el('option'); o.value = v; o.textContent = t; rule.appendChild(o);
    });

    const out = el('div', 'dqpi-sw');

    /* تحويلات HSL — تُبقي الانسجام رياضياً لا بالتخمين */
    function h2h(hex) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0; const l = (mx + mn) / 2;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (d) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
      }
      return { h, s, l };
    }
    function hsl2hex(h, s, l) {
      h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
      const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
      const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
              : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
      return '#' + t.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
    }
    const RULES = {
      comp:  b => [0, 180].flatMap(d => [-0.12, 0, 0.12].map(dl => hsl2hex(b.h + d, b.s, b.l + dl))),
      tri:   b => [0, 120, 240].flatMap(d => [-0.1, 0].map(dl => hsl2hex(b.h + d, b.s, b.l + dl))),
      ana:   b => [-60, -30, 0, 30, 60, 90].map(d => hsl2hex(b.h + d, b.s, b.l)),
      split: b => [0, 150, 210].flatMap(d => [0, 0.14].map(dl => hsl2hex(b.h + d, b.s, b.l + dl))),
      tetra: b => [0, 90, 180, 270].map(d => hsl2hex(b.h + d, b.s, b.l)).concat([hsl2hex(b.h, b.s, b.l + 0.15), hsl2hex(b.h + 180, b.s, b.l - 0.15)]),
      mono:  b => [-0.3, -0.18, -0.06, 0.06, 0.18, 0.3].map(d => hsl2hex(b.h, b.s, b.l + d)),
      shades:b => [1, 0.82, 0.64, 0.46, 0.3, 0.16].map(k => hsl2hex(b.h, b.s * k, b.l)),
    };

    function gen() {
      const b = h2h(base.value);
      const list = (RULES[rule.value] || RULES.comp)(b);
      out.innerHTML = '';
      list.forEach(c => {
        const i = el('i'); i.style.background = c; i.title = c + ' — نقر للتطبيق';
        i.addEventListener('click', () => {
          const e = ed(); if (!e) return;
          const idx = sel();
          if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
          e._saveHistory();
          idx.forEach(k => { if (e.shapes[k]) e.shapes[k].stroke = c; });
          e.render(); toast('لون ' + c, 'success');
        });
        out.appendChild(i);
      });
    }
    base.addEventListener('input', gen);
    rule.addEventListener('change', gen);
    gen();

    const acts = el('div', 'dqpi-grid dqpi-g2');
    acts.append(
      btn('من التحديد', 'خذ اللون من الشكل المحدد', () => {
        const e = ed(); const i = sel()[0];
        if (i === undefined || !e.shapes[i]) return toast('حدّد شكلاً أولاً', 'warn');
        const c = e.shapes[i].stroke;
        if (c && /^#[0-9a-f]{6}$/i.test(c)) { base.value = c; gen(); } else toast('لا لون صريح على الشكل', 'warn');
      }),
      btn('طبّق تدرّجاً', 'وزّع اللوحة على الأشكال المحددة', () => {
        const e = ed(); const idx = sel();
        if (idx.length < 2) return toast('حدّد شكلين أو أكثر', 'warn');
        const cols = [...out.querySelectorAll('i')].map(i => i.style.background);
        if (!cols.length) return;
        e._saveHistory();
        idx.forEach((k, n) => { if (e.shapes[k]) e.shapes[k].stroke = cols[n % cols.length]; });
        e.render(); toast('✓ وُزّعت اللوحة', 'success');
      }),
    );

    p.append(sec('اللون الأساس', base, rule), sec('اللوحة المتناسقة', out, acts),
             hint('الانسجام محسوب في فضاء HSL — لا تخمين.'));
    return { el: p, sync() {} };
  }

  /* ═══════════════ ٤) المظهر ═══════════════ */
  function buildAppearance() {
    const p = el('div', 'dqp');
    const info = el('div');
    const body = el('div');

    function row(k, v) { const r = el('div', 'dqpi-kv'); r.innerHTML = `<span>${k}</span><b>${v}</b>`; return r; }

    function sync() {
      const e = ed(); info.innerHTML = ''; body.innerHTML = '';
      const idx = sel();
      if (!e || !idx.length) { info.appendChild(el('div', 'dqpi-empty', 'لا تحديد')); return; }
      const s = e.shapes[idx[0]];
      if (!s) return;
      const b = e._bounds(s);
      info.append(
        row('النوع', s.type),
        row('الاسم', s.name || '—'),
        row('عدد المحدد', idx.length),
        row('الحدّ', s.stroke || 'افتراضي'),
        row('سماكة العرض', (s.sw || 1) + ' mm'),
        row('العمق', s.maxDepth === undefined ? 'افتراضي المشروع' : s.maxDepth + ' mm'),
        row('الطبقة', s.layer === undefined ? '—' : s.layer),
        row('العرض المتغيّر', s.widthProfile || 'لا'),
        row('القياس', b ? `${(b.maxX - b.minX).toFixed(1)} × ${(b.maxY - b.minY).toFixed(1)} mm` : '—'),
        row('مقفل', s.locked ? 'نعم' : 'لا'),
        row('معطّل من G-Code', s.disabled ? 'نعم' : 'لا'),
      );
      const g = el('div', 'dqpi-grid dqpi-g2');
      g.append(
        btn('تمديد المظهر', 'تسطيح إلى مسارات', call('expandAppearance')),
        btn('تحويل الحدّ', 'الحدّ يصير شكلاً', call('outlineStroke')),
        btn('عرض متغيّر → شكل', 'يُرسل العرض المتغيّر إلى G-Code', call('outlineVariableWidth')),
        btn('مسح العرض المتغيّر', '', call('clearWidthProfile')),
      );
      body.appendChild(g);
    }

    p.append(sec('خصائص المحدد', info), sec('إجراءات', body));
    return { el: p, sync };
  }

  /* ═══════════════ ٥) الأنماط الجرافيكية ═══════════════ */
  function buildStyles() {
    const KEY = 'dq_gstyles';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
    const store = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (_) {} };
    const FIELDS = ['stroke', 'sw', 'maxDepth', 'layer', 'widthPts', 'widthProfile'];

    const p = el('div', 'dqp');
    const list = el('div', 'dqpi-list');

    function paint() {
      const a = load(); list.innerHTML = '';
      if (!a.length) { list.appendChild(el('div', 'dqpi-empty', 'لا أنماط — احفظ من التحديد')); return; }
      a.forEach((st, i) => {
        const r = el('div', 'dqpi-row');
        const dot = el('span'); dot.style.cssText = `width:12px;height:12px;border-radius:3px;flex:0 0 auto;background:${st.props.stroke || '#8b949e'}`;
        const n = el('span', 'n', `${st.name} · ${st.props.sw || 1}mm${st.props.maxDepth ? ' · ' + st.props.maxDepth + 'mm عمق' : ''}`);
        const x = el('button', 'x', '×'); x.title = 'حذف';
        x.addEventListener('click', ev => { ev.stopPropagation(); const b = load(); b.splice(i, 1); store(b); paint(); });
        r.append(dot, n, x);
        r.title = 'نقر للتطبيق على التحديد';
        r.addEventListener('click', () => {
          const e = ed(); const idx = sel();
          if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
          e._saveHistory();
          idx.forEach(k => { const s = e.shapes[k]; if (!s) return;
            FIELDS.forEach(f => { if (st.props[f] !== undefined) s[f] = JSON.parse(JSON.stringify(st.props[f])); }); });
          e.render(); toast(`✓ نمط «${st.name}» على ${idx.length} شكلاً`, 'success');
        });
        list.appendChild(r);
      });
    }
    paint();

    const g = el('div', 'dqpi-grid dqpi-g2');
    g.append(
      btn('احفظ من التحديد', 'يلتقط الحدّ والسماكة والعمق والطبقة', async () => {
        const e = ed(); const i = sel()[0];
        if (i === undefined || !e.shapes[i]) return toast('حدّد شكلاً أولاً', 'warn');
        const s = e.shapes[i];
        let name = 'نمط ' + (load().length + 1);
        if (window.DQPrompt) {
          const r = await window.DQPrompt('نمط جرافيكي جديد', [{ key: 'n', label: 'الاسم', type: 'text', value: name }]);
          if (!r) return; name = r.n;
        }
        const props = {};
        FIELDS.forEach(f => { if (s[f] !== undefined) props[f] = JSON.parse(JSON.stringify(s[f])); });
        const a = load(); a.push({ name, props }); store(a); paint();
        toast(`✓ حُفظ «${name}»`, 'success');
      }),
      btn('مسح الكل', '', () => { store([]); paint(); toast('مُسحت الأنماط', 'info'); }),
    );

    p.append(sec('الأنماط المحفوظة', list, g),
             hint('النمط يحمل: اللون، السماكة، العمق، الطبقة، وبروفايل العرض.'));
    return { el: p, sync() {} };
  }

  /* ═══════════════ ٦) الرموز والرشّاش ═══════════════ */
  function buildSymbols() {
    const p = el('div', 'dqp');
    const list = el('div', 'dqpi-list');
    let active = 0;

    function paint() {
      const e = ed();
      const a = (e && e.listSymbols) ? e.listSymbols() : [];
      list.innerHTML = '';
      if (!a.length) { list.appendChild(el('div', 'dqpi-empty', 'لا رموز — عرِّف من التحديد')); return; }
      a.forEach(s => {
        const r = el('div', 'dqpi-row' + (s.i === active ? ' on' : ''));
        r.append(el('span', 'n', `${s.name} · ${s.w.toFixed(0)}×${s.h.toFixed(0)}mm`));
        const x = el('button', 'x', '×'); x.title = 'حذف';
        x.addEventListener('click', ev => { ev.stopPropagation(); ed()?.deleteSymbol(s.i); });
        r.appendChild(x);
        r.addEventListener('click', () => { active = s.i; window.DQSprayIndex = s.i; paint(); });
        list.appendChild(r);
      });
    }
    paint();
    window.addEventListener('dq:symbols-changed', paint);

    const g = el('div', 'dqpi-grid dqpi-g2');
    g.append(
      btn('عرِّف رمزاً', 'يحفظ التحديد رمزاً', call('defineSymbol')),
      btn('أدرج نسخة', 'في وسط العرض', () => {
        const e = ed(); if (!e) return;
        const c = e._sToW(e.canvas.width / 2, e.canvas.height / 2);
        e._saveHistory();
        const n = e.placeSymbol(active, c, 1, 0);
        e.render();
        if (n) toast(`✓ أُدرج الرمز (${n} شكلاً)`, 'success');
      }),
    );

    const opts = el('div');
    function slider(label, key, min, max, val, scale) {
      const row = el('div', 'dqp-row');
      const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.value = val; r.style.flex = '1';
      r.title = label; r.setAttribute('aria-label', label);
      const o = el('span', 'dqp-lbl', String(val));
      r.addEventListener('input', () => { o.textContent = r.value; window[key] = scale ? +r.value / 100 : +r.value; });
      window[key] = scale ? val / 100 : val;
      row.append(el('span', 'dqp-lbl', label), r, o);
      return row;
    }
    opts.append(slider('التباعد', 'DQSpraySpacing', 2, 60, 8),
                slider('التنويع ٪', 'DQSprayVary', 0, 90, 30, true));
    const rot = el('label', 'dqp-chk');
    rot.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text2);padding:4px 0';
    const cb = el('input'); cb.type = 'checkbox';
    cb.addEventListener('change', () => { window.DQSprayRotate = cb.checked; });
    rot.append(cb, document.createTextNode('دوران عشوائي'));
    opts.appendChild(rot);
    opts.appendChild(btn('فعّل الرشّاش', 'Shift+S', () => ed()?.setTool('symbol-sprayer')));

    p.append(sec('مكتبة الرموز', list, g), sec('الرشّاش', opts));
    return { el: p, sync: paint };
  }

  /* ═══════════════ ٧) الإجراءات (مسجّل الأوامر) ═══════════════ */
  function buildActions() {
    const KEY = 'dq_actions';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
    const store = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (_) {} };

    const p = el('div', 'dqp');
    const status = el('div', 'dqpi-empty', 'متوقّف');
    const list = el('div', 'dqpi-list');

    /* التسجيل: نعترض نقرات عناصر القوائم وأزرار الشريط، فنلتقط «الأمر»
       لا نتيجته — فيُعاد تشغيله على تحديد آخر بنفس الأثر. */
    let rec = null;
    function onClick(e) {
      if (!rec) return;
      const mi = e.target.closest('.mi[data-act]');
      if (mi) { rec.steps.push({ act: mi.dataset.act, label: mi.textContent.trim().split('\n')[0] }); refresh(); return; }
      const st = e.target.closest('.st-btn[id], .dqp-b');
      if (st && st.id) { rec.steps.push({ id: st.id, label: st.title || st.id }); refresh(); }
    }
    document.addEventListener('click', onClick, true);

    function refresh() { status.innerHTML = rec ? `<span class="dqpi-rec"></span> يسجّل — ${rec.steps.length} خطوة` : 'متوقّف'; }

    function paint() {
      const a = load(); list.innerHTML = '';
      if (!a.length) { list.appendChild(el('div', 'dqpi-empty', 'لا إجراءات محفوظة')); return; }
      a.forEach((ac, i) => {
        const r = el('div', 'dqpi-row');
        r.append(el('span', 'n', `${ac.name} · ${ac.steps.length} خطوة`));
        const x = el('button', 'x', '×');
        x.addEventListener('click', ev => { ev.stopPropagation(); const b = load(); b.splice(i, 1); store(b); paint(); });
        r.appendChild(x);
        r.title = 'نقر للتشغيل';
        r.addEventListener('click', () => run(ac));
        list.appendChild(r);
      });
    }
    function run(ac) {
      let n = 0;
      for (const s of ac.steps) {
        try {
          if (s.act) { const t = document.querySelector(`.mi[data-act="${CSS.escape(s.act)}"]`); if (t) { t.click(); n++; } }
          else if (s.id) { const t = document.getElementById(s.id); if (t) { t.click(); n++; } }
        } catch (_) {}
      }
      toast(`▶ ${ac.name} — نُفّذت ${n}/${ac.steps.length} خطوة`, n ? 'success' : 'warn');
    }
    paint();

    const g = el('div', 'dqpi-grid dqpi-g2');
    const bRec = btn('ابدأ التسجيل', 'كل أمر تنقره يُسجَّل', async () => {
      if (rec) {
        const steps = rec.steps; rec = null; refresh();
        bRec.textContent = 'ابدأ التسجيل';
        if (!steps.length) return toast('لم تُسجَّل خطوات', 'warn');
        let name = 'إجراء ' + (load().length + 1);
        if (window.DQPrompt) {
          const r = await window.DQPrompt('احفظ الإجراء', [{ key: 'n', label: 'الاسم', type: 'text', value: name }]);
          if (!r) return; name = r.n;
        }
        const a = load(); a.push({ name, steps }); store(a); paint();
        toast(`✓ حُفظ «${name}» — ${steps.length} خطوة`, 'success');
      } else {
        rec = { steps: [] }; refresh();
        bRec.textContent = 'أوقف واحفظ';
        toast('التسجيل يعمل — نفّذ الأوامر ثم أوقف', 'info');
      }
    });
    g.append(bRec, btn('مسح الكل', '', () => { store([]); paint(); toast('مُسحت الإجراءات', 'info'); }));

    const scripts = el('div', 'dqpi-grid dqpi-g2');
    scripts.append(
      btn('سكربت…', 'شغّل JavaScript على المحرّر', call('promptScript')),
      btn('بحث واستبدال', 'Ctrl+H', call('findReplace')),
    );

    p.append(sec('المسجّل', status, g, hint('يلتقط الأمر لا نتيجته، فيعمل على أي تحديد.')),
             sec('الإجراءات', list), sec('أتمتة', scripts));
    return { el: p, sync() {} };
  }

  /* ═══════════════ ٨) الحروف الرسومية ═══════════════ */
  function buildGlyphs() {
    const p = el('div', 'dqp');
    const grid = el('div', 'dqpi-glyphs');
    /* خطّ النقش المدمج (tools-pro.js) لاتينيّ/رقميّ. الحروف التي لا يعرفها
       لا تُنقَش، فنعلّمها هنا بدل أن يكتشف المستخدم ذلك بعد التوليد. */
    const sets = {
      'لاتينية': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      'أرقام': '0123456789',
      'رموز': '.,;:!?()[]{}-_+=*/\\%&#@$<>"\'',
      'عربية': 'ابتثجحخدذرزسشصضطظعغفقكلمنهوىيءآأؤإئةًٌٍَُِّْ',
      'أرقام عربية': '٠١٢٣٤٥٦٧٨٩',
      'هندسية': '△▽○◇□▭▱☆✦✧⬡⬢◈◉●▲▼■◆',
    };

    /** هل يعرف محرّك النقش هذا الحرف؟ الاختبار الوحيد الموثوق: جرّبه. */
    function engravable(ch) {
      const e = ed();
      if (!e || !e._textToStrokes) return true;
      try { const g = e._textToStrokes(ch, 10); return !!(g && g.strokes && g.strokes.length); }
      catch (_) { return false; }
    }
    const pick = el('select');
    pick.style.cssText = 'width:100%;height:28px;border-radius:6px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);font-family:inherit;font-size:11.5px';
    pick.title = 'مجموعة الحروف'; pick.setAttribute('aria-label', 'مجموعة الحروف');
    Object.keys(sets).forEach(k => { const o = el('option'); o.value = k; o.textContent = k; pick.appendChild(o); });

    const note = el('div', 'dqp-hint');

    function paint() {
      grid.innerHTML = '';
      let ok = 0, total = 0;
      [...sets[pick.value]].forEach(ch => {
        total++;
        const can = engravable(ch);
        if (can) ok++;
        const b = el('b', '', ch);
        b.title = can ? `درج «${ch}» في النصّ المحدد` : `«${ch}» لا يدعمه خطّ النقش المدمج`;
        if (!can) { b.style.opacity = '.3'; b.style.cursor = 'not-allowed'; }
        b.addEventListener('click', () => {
          if (!can) return toast(`«${ch}» غير مدعوم في خطّ النقش المدمج`, 'warn');
          const e = ed(); const i = sel()[0];
          if (i === undefined || !e.shapes[i] || e.shapes[i].type !== 'text') return toast('حدّد شكل نصّ أولاً', 'warn');
          e._saveHistory();
          e.shapes[i].text = (e.shapes[i].text || '') + ch;
          if (e.retextShape) e.retextShape(i);
          e.render();
          toast(`أُدرج «${ch}»`, 'success');
        });
        grid.appendChild(b);
      });
      note.textContent = ok === total
        ? `كل الـ${total} حرفاً قابل للنقش.`
        : `${ok} من ${total} قابل للنقش — الباهت لا يدعمه الخطّ المدمج.`;
    }
    pick.addEventListener('change', paint);
    paint();

    p.append(sec('الحروف الرسومية', pick, grid, note),
             hint('النقر يُلحق الحرف بالنصّ المحدد ويعيد نقشه. للخطّ العربي استعمل صفحة «الخط العربي».'));
    return { el: p, sync() {} };
  }

  /* ═══════════════ ٩) ألواح الفنّ ═══════════════ */
  function buildArtboards() {
    const p = el('div', 'dqp');
    const list = el('div', 'dqpi-list');

    function paint() {
      const e = ed(); list.innerHTML = '';
      const a = (e && e.listArtboards) ? e.listArtboards() : [];
      if (!a.length) { list.appendChild(el('div', 'dqpi-empty', 'لا ألواح')); return; }
      a.forEach(ab => {
        const r = el('div', 'dqpi-row' + (ab.active ? ' on' : ''));
        r.append(el('span', 'n', `${ab.name} · ${ab.w}×${ab.h}mm`));
        const x = el('button', 'x', '×'); x.title = 'حذف';
        x.addEventListener('click', ev => { ev.stopPropagation(); ed()?.deleteArtboard(ab.i); });
        r.appendChild(x);
        r.addEventListener('click', () => { ed()?.setActiveArtboard(ab.i); ed()?.fitToArtboard(ab.i); });
        list.appendChild(r);
      });
    }
    paint();
    window.addEventListener('dq:artboards-changed', paint);

    const g = el('div', 'dqpi-grid dqpi-g2');
    g.append(
      btn('لوح جديد', 'Shift+O للرسم بالسحب', call('addArtboard')),
      btn('حدّد محتواه', 'يحدّد كل ما في اللوح النشط', call('selectArtboardContents')),
      btn('علامات قطع', 'حول التحديد أو اللوح', call('createTrimMarks')),
      btn('تبليط', 'قسّم إلى بلاطات بحجم الآلة', call('printTiling')),
    );

    p.append(sec('الألواح', list, g),
             hint('«حدّد محتواه» ثم «توليد G-Code» = تصدير اللوح وحده.'));
    return { el: p, sync: paint };
  }

  /* ═══════════════ التسجيل ═══════════════ */
  const DEFS = [
    { id: 'pathfinder', title: 'مكتشف المسارات',    icon: 'merge',      build: buildPathfinder },
    { id: 'navigator',  title: 'الملاحة',            icon: 'search',     build: buildNavigator },
    { id: 'colorguide', title: 'دليل الألوان',       icon: 'palette',    build: buildColorGuide },
    { id: 'appearance', title: 'المظهر',             icon: 'eye',        build: buildAppearance },
    { id: 'gstyles',    title: 'الأنماط الجرافيكية', icon: 'sparkles',   build: buildStyles },
    { id: 'symbols',    title: 'الرموز',             icon: 'star',       build: buildSymbols },
    { id: 'actions',    title: 'الإجراءات',          icon: 'zap',        build: buildActions },
    { id: 'glyphs',     title: 'الحروف الرسومية',    icon: 'text-vertical', build: buildGlyphs },
    { id: 'artboards',  title: 'ألواح الفنّ',         icon: 'boxes',      build: buildArtboards },
  ];

  const syncers = [];
  function boot() {
    const WD = window.WorkspaceDock;
    if (!WD || !WD.register) return false;
    injectCSS();
    for (const d of DEFS) {
      try {
        const made = d.build();
        syncers.push(made.sync);
        WD.register(d.id, { title: d.title, icon: d.icon, el: made.el });
      } catch (err) { console.error('[panel ' + d.id + ']', err); }
    }
    const hook = () => {
      const e = ed();
      if (!e || !e.events) return false;
      const run = () => syncers.forEach(f => { try { f(); } catch (_) {} });
      e.events.on('selection:changed', run);
      e.events.on('history:changed', run);
      return true;
    };
    if (!hook()) { let n = 0; const t = setInterval(() => { if (hook() || ++n > 40) clearInterval(t); }, 200); }
    return true;
  }

  if (!boot()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
  }
})();
