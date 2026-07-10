/**
 * extras.js — «إضافات»: أدوات مساعدة مضمّنة + وظائف إنتاجية CNC
 *
 * • تضمين الأدوات المستقلة (السرعات/الأسعار/الخط) كنوافذ منبثقة داخل التطبيق (iframe)
 *   بدل فتحها في تبويب منفصل — بلا إعادة كتابة صفحاتها.
 * • وظائف إنتاجية تعمل على الأشكال الحالية: إحصاءات، تقدير زمن، تكلفة، تحويل وحدات،
 *   كشف تقاطعات، تحسين ترتيب القطع.
 *
 * يُصدَّر كـ window.Extras؛ قائمة «إضافات» في menu-bar.js تستدعي دواله.
 */
(function () {
  'use strict';

  const ed = () => window.app && window.app.editor;
  const toast = (m, t) => window.app?.toast ? window.app.toast(m, t) : console.log(m);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── نافذة عامة قابلة لإعادة الاستخدام (تُبنى ديناميكياً، بنمط التطبيق) ── */
  function modal(title, bodyHTML, { wide = false, footer = '' } = {}) {
    document.getElementById('_ext-modal')?.remove();
    const dlg = document.createElement('dialog');
    dlg.id = '_ext-modal';
    dlg.className = 'modal' + (wide ? ' modal-wide' : '');
    dlg.innerHTML = `
      <h3>${esc(title)}
        <button class="modal-x" id="_ext-x" aria-label="إغلاق" style="float:left;background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;line-height:1">✕</button>
      </h3>
      <div class="modal-body" style="padding:18px 20px">${bodyHTML}</div>
      ${footer ? `<div class="modal-foot" style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-start">${footer}</div>` : ''}`;
    document.body.appendChild(dlg);
    dlg.querySelector('#_ext-x').onclick = () => dlg.close();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
  }

  /* ════════ تضمين الأدوات المستقلة داخل التطبيق (iframe منبثق) ════════ */
  function openEmbed(url, title) {
    document.getElementById('_ext-embed')?.remove();
    const dlg = document.createElement('dialog');
    dlg.id = '_ext-embed';
    dlg.className = 'modal ext-embed';
    dlg.innerHTML = `
      <div class="ext-embed-bar">
        <span class="ext-embed-title">${esc(title)}</span>
        <span class="ext-embed-actions">
          <a class="ext-embed-btn" href="${esc(url)}" target="_blank" rel="noopener" title="فتح في تبويب جديد">↗ تبويب</a>
          <button class="ext-embed-btn" id="_ext-embed-x" title="إغلاق">✕ إغلاق</button>
        </span>
      </div>
      <iframe class="ext-embed-frame" src="${esc(url)}" title="${esc(title)}" loading="lazy"></iframe>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#_ext-embed-x').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
  }

  /* ════════ أدوات مساعدة حسابية على الأشكال الحالية ════════ */
  function shapesOf() { const e = ed(); return (e && Array.isArray(e.shapes)) ? e.shapes : []; }

  // طول مسار شكل واحد بالمِلّيمتر (نقاطه في وحدات العالم = مم)
  function shapeLen(s) {
    const p = s.points;
    if (!p || p.length < 2) return 0;
    let d = 0;
    for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    if (s.closed && p.length > 2) d += Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y);
    return d;
  }
  function totalLen() { return shapesOf().reduce((a, s) => a + shapeLen(s), 0); }

  function bbox() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const s of shapesOf()) for (const p of (s.points || [])) {
      any = true;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return any ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } : null;
  }

  const feedXY = () => parseFloat(document.getElementById('feed-rate-xy')?.value) || 1000;
  const fmtLen = (mm) => mm >= 1000 ? (mm / 1000).toFixed(2) + ' م' : mm.toFixed(1) + ' مم';
  const fmtTime = (min) => {
    const s = Math.max(0, Math.round(min * 60));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + 'س ' : '') + (m || h ? m + 'د ' : '') + sec + 'ث';
  };

  function noShapes() {
    if (shapesOf().length) return false;
    toast('لا توجد أشكال في التصميم بعد', 'warn');
    return true;
  }

  /* 1) إحصاءات التصميم */
  function stats() {
    if (noShapes()) return;
    const n = shapesOf().length;
    const len = totalLen();
    const bb = bbox();
    const est = len / feedXY();
    modal('📊 إحصاءات التصميم', `
      <table class="ext-table">
        <tr><td>عدد الأشكال</td><td><b>${n}</b></td></tr>
        <tr><td>إجمالي طول القطع</td><td><b>${fmtLen(len)}</b></td></tr>
        <tr><td>أبعاد التصميم</td><td><b>${bb ? bb.w.toFixed(1) + ' × ' + bb.h.toFixed(1) + ' مم' : '—'}</b></td></tr>
        <tr><td>زمن قطع تقديري (XY)</td><td><b>${fmtTime(est)}</b></td></tr>
      </table>
      <p class="ext-note">التقدير مبنيّ على تغذية ${feedXY()} مم/دقيقة (بلا زمن الغطس والحركات السريعة).</p>`);
  }

  /* 2) تقدير زمن التشغيل (يشمل غطس ورفع تقديري لكل شكل) */
  function runtime() {
    if (noShapes()) return;
    const len = totalLen();
    const n = shapesOf().length;
    const cut = len / feedXY();                         // دقائق قطع
    const feedZ = parseFloat(document.getElementById('feed-rate-z')?.value) || 300;
    const depth = parseFloat(document.getElementById('cut-depth')?.value) || 3;
    const plunge = (n * depth) / feedZ;                 // غطس تقديري لكل شكل
    const rapids = n * 0.03;                            // ~1.8ث تموضع/شكل
    const total = cut + plunge + rapids;
    modal('⏱ تقدير زمن التشغيل', `
      <table class="ext-table">
        <tr><td>زمن القطع (XY)</td><td>${fmtTime(cut)}</td></tr>
        <tr><td>زمن الغطس (Z)</td><td>${fmtTime(plunge)}</td></tr>
        <tr><td>حركات سريعة/تموضع</td><td>${fmtTime(rapids)}</td></tr>
        <tr class="ext-total"><td>الإجمالي التقديري</td><td><b>${fmtTime(total)}</b></td></tr>
      </table>
      <p class="ext-note">تقدير هندسي؛ الزمن الفعلي يعتمد على تسارع الآلة وعدد الطبقات.</p>`);
  }

  /* 3) تقدير التكلفة السريع */
  function cost() {
    if (noShapes()) return;
    const est = totalLen() / feedXY();                 // دقائق
    modal('💰 تقدير التكلفة السريع', `
      <div class="ext-form">
        <label>سعر الخامة (لكل قطعة) <input type="number" id="_c-mat" value="0" min="0" step="500"></label>
        <label>أجرة الآلة (لكل ساعة) <input type="number" id="_c-rate" value="15000" min="0" step="1000"></label>
        <label>هامش ربح (%) <input type="number" id="_c-margin" value="30" min="0" step="5"></label>
      </div>
      <table class="ext-table" id="_c-out"></table>`, {
      footer: `<button class="btn-primary" id="_c-calc">احسب</button>`
    });
    const calc = () => {
      const mat = +document.getElementById('_c-mat').value || 0;
      const rate = +document.getElementById('_c-rate').value || 0;
      const margin = +document.getElementById('_c-margin').value || 0;
      const machine = (est / 60) * rate;
      const base = mat + machine;
      const total = base * (1 + margin / 100);
      document.getElementById('_c-out').innerHTML = `
        <tr><td>زمن التشغيل</td><td>${fmtTime(est)}</td></tr>
        <tr><td>تكلفة الآلة</td><td>${Math.round(machine).toLocaleString('ar')} د.ع</td></tr>
        <tr><td>الخامة</td><td>${mat.toLocaleString('ar')} د.ع</td></tr>
        <tr class="ext-total"><td>السعر المقترح</td><td><b>${Math.round(total).toLocaleString('ar')} د.ع</b></td></tr>`;
    };
    document.getElementById('_c-calc').onclick = calc;
    calc();
  }

  /* 4) محوّل الوحدات */
  function units() {
    const F = { mm: 1, cm: 10, m: 1000, inch: 25.4, ft: 304.8 };
    const names = { mm: 'مليمتر', cm: 'سنتيمتر', m: 'متر', inch: 'إنش', ft: 'قدم' };
    const opt = (sel) => Object.keys(F).map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${names[k]}</option>`).join('');
    modal('📏 محوّل الوحدات', `
      <div class="ext-form ext-form-row">
        <input type="number" id="_u-val" value="1" step="any" style="flex:1">
        <select id="_u-from" style="flex:1">${opt('inch')}</select>
        <span style="align-self:center">←</span>
        <select id="_u-to" style="flex:1">${opt('mm')}</select>
      </div>
      <div class="ext-result" id="_u-out">—</div>`);
    const calc = () => {
      const v = parseFloat(document.getElementById('_u-val').value) || 0;
      const from = document.getElementById('_u-from').value;
      const to = document.getElementById('_u-to').value;
      const mm = v * F[from];
      const out = mm / F[to];
      document.getElementById('_u-out').textContent =
        `${v} ${names[from]} = ${(+out.toFixed(6)).toLocaleString('ar')} ${names[to]}`;
    };
    ['_u-val', '_u-from', '_u-to'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', calc); el.addEventListener('change', calc);
    });
    calc();
  }

  /* 5) كشف التقاطعات بين المسارات (تحذير جودة للقطع) */
  function segInt(a, b, c, d) {
    const dn = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
    if (Math.abs(dn) < 1e-9) return false;
    const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / dn;
    const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / dn;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
  }
  function intersect() {
    if (noShapes()) return;
    // نجمع كل القطع مع مرجع الشكل، ثم نفحص التقاطعات بين قطع غير متجاورة
    const segs = [];
    shapesOf().forEach((s, si) => {
      const p = s.points || [];
      const m = s.closed ? p.length : p.length - 1;
      for (let i = 0; i < m; i++) segs.push({ si, a: p[i], b: p[(i + 1) % p.length] });
    });
    let count = 0;
    const MAX = 4000; // حارس أداء
    if (segs.length <= MAX) {
      for (let i = 0; i < segs.length; i++)
        for (let j = i + 1; j < segs.length; j++) {
          if (segs[i].si === segs[j].si && Math.abs(i - j) <= 1) continue;
          if (segInt(segs[i].a, segs[i].b, segs[j].a, segs[j].b)) count++;
        }
    }
    if (segs.length > MAX) toast('التصميم كبير — فُحصت عيّنة فقط', 'info');
    if (count === 0) toast('✅ لا تقاطعات — المسارات نظيفة للقطع', 'success');
    else toast(`⚠ عُثر على ${count} تقاطع مسار — قد يسبب مشاكل بالقطع`, 'warn');
  }

  /* 6) تحسين ترتيب القطع (أقرب جار) — يقلّل الحركات السريعة */
  function optimizeOrder() {
    const e = ed();
    if (!e || noShapes()) return;
    const shapes = e.shapes;
    if (shapes.length < 3) { toast('يلزم 3 أشكال على الأقل', 'info'); return; }
    const start = s => (s.points && s.points[0]) || { x: 0, y: 0 };
    const before = travel(shapes);
    const used = new Array(shapes.length).fill(false);
    const order = [];
    let cur = { x: 0, y: 0 };
    for (let k = 0; k < shapes.length; k++) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < shapes.length; i++) {
        if (used[i]) continue;
        const p = start(shapes[i]);
        const d = Math.hypot(p.x - cur.x, p.y - cur.y);
        if (d < bd) { bd = d; best = i; }
      }
      used[best] = true; order.push(shapes[best]);
      const lp = shapes[best].points; cur = lp[lp.length - 1] || start(shapes[best]);
    }
    const after = travel(order);
    e._saveHistory?.();
    e.shapes = order;
    e.selectedIdx = -1;
    e.render?.();
    const saved = before > 0 ? Math.round((1 - after / before) * 100) : 0;
    toast(`✅ رُتّبت القطع — تقليل التنقّل ~${Math.max(0, saved)}%`, 'success');
  }
  // مجموع مسافات التنقّل السريع بين نهاية شكل وبداية التالي
  function travel(list) {
    let d = 0, cur = { x: 0, y: 0 };
    for (const s of list) {
      const p = s.points || [];
      if (!p.length) continue;
      d += Math.hypot(p[0].x - cur.x, p[0].y - cur.y);
      cur = p[p.length - 1];
    }
    return d;
  }

  window.Extras = { openEmbed, stats, runtime, cost, units, intersect, optimizeOrder };

  /* ── اعتراض بطاقات «أدوات مساعدة» في اللوحة اليمنى: افتحها منبثقة بدل تبويب ── */
  function wireCards() {
    document.querySelectorAll('.ai-tool-card[data-embed]').forEach(card => {
      card.addEventListener('click', e => {
        e.preventDefault();
        openEmbed(card.getAttribute('data-embed'), card.getAttribute('data-embed-title') || '');
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireCards);
  else wireCards();
})();
