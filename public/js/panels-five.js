/**
 * panels-five.js — خمس لوحات Illustrator قابلة للرسو
 *
 *   الألوان                  (Color / Swatches / Gradient)
 *   الخط والمظهر             (Stroke / Appearance)
 *   المحاذاة ومكتشف المسارات (Align / Pathfinder)
 *   التحويل                  (Transform)
 *   المحرف والفقرة           (Character / Paragraph)
 *
 * مبدأ البناء: **لا منطق جديد**. كل زرّ هنا ينادي واجهة قائمة ومختبَرة —
 * ColorSystem.apply · alignSelected · distributeSelected · booleanOp ·
 * typeOnPath · outlineStroke · أزرار شريط الشكل (st-*) — فلا يصير في
 * التطبيق مصدران للحقيقة. الجديد الوحيد صفتان على الشكل:
 * `sw` (سماكة العرض) و`maxDepth` (عمق مخصّص، يقرأه مولّد G-Code أصلاً).
 *
 * تُسجَّل كلّها في نظام الرسو (WorkspaceDock.register) فتبدأ مغلقة وتُفتح من
 * «نافذة ← اللوحات» — تماماً كـWindow > Color في Illustrator.
 */
(function panelsFive() {
  'use strict';

  const ed = () => window.app && window.app.editor;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };
  const click = id => document.getElementById(id)?.click();
  const sel = () => { const e = ed(); return e && e._selIndices ? e._selIndices() : []; };

  const SWATCHES = [
    '#e6edf3', '#b1bac4', '#8b949e', '#6e7681', '#484f58', '#30363d', '#161b22', '#0d1117',
    '#f85149', '#ff7b72', '#ffa198', '#d29922', '#e3b341', '#f0c674',
    '#3fb950', '#56d364', '#7ee787', '#2f81f7', '#58a6ff', '#79c0ff',
    '#bc8cff', '#d2a8ff', '#db6d28', '#f78166', '#1f6feb', '#388bfd',
    '#238636', '#2ea043', '#8957e5', '#a371f7',
  ];

  /* ══════════════ أنماط اللوحات ══════════════ */
  function injectCSS() {
    if (document.getElementById('dqp-css')) return;
    const s = document.createElement('style');
    s.id = 'dqp-css';
    s.textContent = `
      .dqp{padding:0 !important}
      .dqp-sec{padding:10px 12px;border-bottom:1px solid var(--border,#30363d)}
      .dqp-sec:last-child{border-bottom:none}
      .dqp-h{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:700;
        letter-spacing:.06em;color:var(--text3,#8b949e);text-transform:uppercase;margin-bottom:9px}
      .dqp-h::after{content:'';flex:1;height:1px;background:var(--border,#30363d)}
      .dqp-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .dqp-lbl{font-size:11.5px;color:var(--text3,#8b949e);min-width:52px}

      /* أزرار موحّدة */
      .dqp-b{display:flex;align-items:center;justify-content:center;gap:6px;
        min-height:28px;padding:0 9px;border:1px solid var(--border,#30363d);border-radius:7px;
        background:linear-gradient(180deg,var(--bg4,#21262d),var(--bg3,#1c2128));
        color:var(--text2,#b1bac4);font-family:inherit;font-size:11.5px;font-weight:600;cursor:pointer;
        box-shadow:inset 0 1px 0 var(--gloss,rgba(255,255,255,.05));
        transition:transform .13s var(--ease-out,cubic-bezier(.22,1,.36,1)),
                   background .13s ease,border-color .13s ease,color .13s ease}
      .dqp-b:hover{background:linear-gradient(180deg,var(--btn-hi,#262c36),var(--btn-lo,#1c2128));
        border-color:var(--border2,#3d444d);color:var(--text,#e6edf3);transform:translateY(-1px)}
      .dqp-b:active{transform:translateY(0) scale(.95)}
      .dqp-b svg{width:15px;height:15px}
      .dqp-grid{display:grid;gap:5px}
      .dqp-g3{grid-template-columns:repeat(3,1fr)}
      .dqp-g4{grid-template-columns:repeat(4,1fr)}
      .dqp-g2{grid-template-columns:repeat(2,1fr)}

      /* الألوان */
      .dqp-sw-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:4px}
      .dqp-sw{aspect-ratio:1;border-radius:3px;border:1px solid rgba(0,0,0,.45);cursor:pointer;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);padding:0;
        transition:transform .12s var(--ease-out,ease)}
      .dqp-sw:hover{transform:scale(1.35);z-index:2;border-color:var(--text,#e6edf3)}
      .dqp-chips{display:flex;align-items:center;gap:10px}
      .dqp-chip{width:26px;height:26px;border-radius:6px;position:relative;flex-shrink:0;
        box-shadow:var(--shadow-1,0 1px 2px rgba(0,0,0,.28))}
      .dqp-chip.fill{border:1px solid var(--border2,#3d444d)}
      .dqp-chip.stroke{border:4px solid var(--accent,#2f81f7);background:transparent}
      .dqp-chip.none::after{content:'';position:absolute;inset:2px;
        background:linear-gradient(45deg,transparent 44%,var(--red,#f85149) 44%,
        var(--red,#f85149) 56%,transparent 56%)}
      .dqp-hint{font-size:10.5px;color:var(--text3,#8b949e);line-height:1.6;margin-top:7px}
      .dqp-c{width:34px;height:26px;padding:0;border:1px solid var(--border2,#3d444d);
        border-radius:6px;background:none;cursor:pointer}

      .dqp input[type="number"],.dqp input[type="text"]{
        height:26px;border-radius:6px;background:var(--bg1,#0d1117);
        border:1px solid var(--border,#30363d);color:var(--text,#e6edf3);
        font-family:var(--font-mono,monospace);font-size:12px;padding:0 7px;min-width:0}
      .dqp input[type="range"]{flex:1;accent-color:var(--accent,#2f81f7)}
      .dqp-val{font-family:var(--font-mono,monospace);font-size:11.5px;color:var(--cyan,#79c0ff);min-width:34px;text-align:center}
      .dqp-empty{font-size:11.5px;color:var(--text3,#8b949e);line-height:1.7}
    `;
    document.head.appendChild(s);
  }

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  function panelShell() {
    const a = el('aside', 'settings-panel dqw-sub dqp');
    return a;
  }
  /* أيقونة من مكتبة الأيقونات الموحّدة، وإلا نصّ بديل */
  const ic = (n, alt) => { try { return window.DQIcon ? window.DQIcon(n) : (alt || ''); } catch (_) { return alt || ''; } };

  /* ══════════════ 1) الألوان ══════════════ */
  function buildColor() {
    const p = panelShell();

    const s1 = el('div', 'dqp-sec');
    s1.appendChild(el('div', 'dqp-h', '<span>التعبئة والخط</span>'));
    const chips = el('div', 'dqp-chips');
    const fill = el('span', 'dqp-chip fill'), stroke = el('span', 'dqp-chip stroke');
    const swap = el('button', 'dqp-b', '⇄');
    swap.title = 'تبديل الخط ⇄ التعبئة (Shift+X)';
    const none = el('button', 'dqp-b', '∅ بلا لون');
    none.title = 'يسرى: يزيل لون الخط · يمنى: يزيل التعبئة';
    chips.append(fill, stroke, swap, none);
    s1.appendChild(chips);
    s1.appendChild(el('div', 'dqp-hint', 'نقرة على الحامل = لون الخط · نقرة يمنى = التعبئة'));

    const s2 = el('div', 'dqp-sec');
    s2.appendChild(el('div', 'dqp-h', '<span>الحوامل</span>'));
    const grid = el('div', 'dqp-sw-grid');
    SWATCHES.forEach(c => {
      const b = el('button', 'dqp-sw');
      b.style.background = c; b.title = c;
      b.addEventListener('click', () => applyColor('stroke', c));
      b.addEventListener('contextmenu', e => { e.preventDefault(); applyColor('fill', c); });
      grid.appendChild(b);
    });
    s2.appendChild(grid);

    const s3 = el('div', 'dqp-sec');
    s3.appendChild(el('div', 'dqp-h', '<span>لون مخصّص</span>'));
    const row = el('div', 'dqp-row');
    const inp = el('input', 'dqp-c'); inp.type = 'color'; inp.value = '#2f81f7';
    const bS = el('button', 'dqp-b', 'للخط'), bF = el('button', 'dqp-b', 'للتعبئة');
    bS.addEventListener('click', () => applyColor('stroke', inp.value));
    bF.addEventListener('click', () => applyColor('fill', inp.value));
    row.append(inp, bS, bF);
    s3.appendChild(row);

    const s4 = el('div', 'dqp-sec');
    s4.appendChild(el('div', 'dqp-h', '<span>أدوات اللون</span>'));
    const g = el('div', 'dqp-grid dqp-g3');
    const mk = (label, fn, title) => { const b = el('button', 'dqp-b', label); b.title = title || label; b.addEventListener('click', fn); return b; };
    // لا تُشتقّ الإتاحة من قيمة الإرجاع — هذه الدوالّ تُعيد undefined عند النجاح،
    // فكان `fn() || toast(...)` يُطلق تحذير «غير متاح» بعد كل نقرة ناجحة
    // الحامل يُقرأ عند النقر لا عند بناء اللوحة، فقد تُبنى قبل تحميل الوحدة
    const call = (holder, fn, warn) => () => {
      const obj = window[holder];
      const f = obj && obj[fn];
      if (typeof f !== 'function') { toast(warn, 'warn'); return; }
      f.call(obj);
    };
    g.append(
      mk('قطّارة', call('ColorTools', 'eyedropper', 'أداة القطّارة غير متاحة'), 'التقط لوناً من الكانفس'),
      mk('تدرّج', call('ColorTools', 'gradient', 'محرّر التدرّج غير متاح'), 'تعبئة متدرّجة'),
      mk('مكتبة', call('ColorLibrary', 'open', 'مكتبة الألوان غير متاحة'), 'مكتبة الألوان'),
    );
    s4.appendChild(g);

    p.append(s1, s2, s3, s4);

    function applyColor(prop, c) {
      if (!window.ColorSystem?.apply) { toast('نظام الألوان غير مُحمَّل', 'error'); return; }
      window.ColorSystem.apply(prop, c);
      sync();
    }
    swap.addEventListener('click', () => { window.ColorSystem?.swap?.(); sync(); });
    none.addEventListener('click', () => applyColor('stroke', null));
    none.addEventListener('contextmenu', e => { e.preventDefault(); applyColor('fill', null); });

    function sync() {
      const e = ed(); if (!e) return;
      const i = sel()[0];
      const s = i != null ? e.shapes[i] : null;
      const st = s ? s.stroke : null, fl = s ? s.fill : null;
      stroke.style.borderColor = st || 'var(--accent,#2f81f7)';
      stroke.classList.toggle('none', !st);
      fill.style.background = (typeof fl === 'string' ? fl : '') || 'transparent';
      fill.classList.toggle('none', !fl);
    }
    return { el: p, sync };
  }

  /* ══════════════ 2) الخط والمظهر ══════════════ */
  function buildStroke() {
    const p = panelShell();

    const s1 = el('div', 'dqp-sec');
    s1.appendChild(el('div', 'dqp-h', '<span>سماكة العرض</span>'));
    const r1 = el('div', 'dqp-row');
    const rng = el('input'); rng.type = 'range'; rng.min = '0.5'; rng.max = '6'; rng.step = '0.5'; rng.value = '1.5';
    const val = el('span', 'dqp-val', '1.5');
    r1.append(el('span', 'dqp-lbl', 'السماكة'), rng, val);
    s1.appendChild(r1);
    s1.appendChild(el('div', 'dqp-hint',
      'سماكة العرض على الشاشة فقط — لا تؤثّر في G-Code. عرض القَطع الحقيقي يحدّده قطر الأداة.'));

    const s2 = el('div', 'dqp-sec');
    s2.appendChild(el('div', 'dqp-h', '<span>عمق قطع مخصّص</span>'));
    const r2 = el('div', 'dqp-row');
    const dep = el('input'); dep.type = 'number'; dep.min = '0'; dep.step = '0.5'; dep.placeholder = 'افتراضي'; dep.style.width = '76px';
    const depApply = el('button', 'dqp-b', 'تطبيق');
    const depClear = el('button', 'dqp-b', 'مسح');
    r2.append(el('span', 'dqp-lbl', 'العمق mm'), dep, depApply, depClear);
    s2.appendChild(r2);
    s2.appendChild(el('div', 'dqp-hint', 'يقرأه مولّد G-Code لكل شكل على حدة (shape.maxDepth).'));

    const s3 = el('div', 'dqp-sec');
    s3.appendChild(el('div', 'dqp-h', '<span>حالة الشكل</span>'));
    const g3 = el('div', 'dqp-grid dqp-g2');
    const bVis = el('button', 'dqp-b', 'إظهار/إخفاء من الإخراج');
    const bLock = el('button', 'dqp-b', 'قفل / فك القفل');
    g3.append(bVis, bLock);
    s3.appendChild(g3);

    const s4 = el('div', 'dqp-sec');
    s4.appendChild(el('div', 'dqp-h', '<span>المظهر</span>'));
    const g4 = el('div', 'dqp-grid dqp-g2');
    const bOutline = el('button', 'dqp-b', 'تفريغ الخط إلى شريط');
    const bPath = el('button', 'dqp-b', 'تحويل إلى مسار');
    g4.append(bOutline, bPath);
    s4.appendChild(g4);

    p.append(s1, s2, s3, s4);

    const each = fn => {
      const e = ed(), idx = sel();
      if (!idx.length) { toast('حدّد شكلاً أولاً', 'warn'); return false; }
      e._saveHistory();
      idx.forEach(i => { const s = e.shapes[i]; if (s) fn(s); });
      e.render(); e._updateStatus?.(); e._updateShapeToolbar?.();
      return true;
    };
    rng.addEventListener('input', () => { val.textContent = rng.value; });
    rng.addEventListener('change', () => {
      // اقرأ القيمة قبل each: بداخله _saveHistory يبثّ history:changed
      // فتُشغَّل sync() وتُعيد ضبط الشريط على القيمة القديمة قبل أن نقرأه.
      const v = +rng.value;
      if (each(s => { s.sw = v; })) toast(`سماكة العرض ${v}`, 'success');
    });
    depApply.addEventListener('click', () => {
      const v = parseFloat(dep.value);
      if (!(v > 0)) { toast('أدخل عمقاً موجباً', 'warn'); return; }
      if (each(s => { s.maxDepth = v; })) toast(`عمق مخصّص ${v}mm`, 'success');
    });
    depClear.addEventListener('click', () => { if (each(s => { delete s.maxDepth; })) toast('أُعيد العمق للافتراضي', 'info'); });
    bVis.addEventListener('click', () => each(s => { s.disabled = !s.disabled; }));
    bLock.addEventListener('click', () => each(s => { s.locked = !s.locked; }));
    bOutline.addEventListener('click', () => ed()?.outlineStroke?.() ?? toast('غير متاح', 'warn'));
    bPath.addEventListener('click', () => ed()?.convertSelectedToPath?.() ?? toast('غير متاح', 'warn'));

    function sync() {
      const e = ed(); if (!e) return;
      const s = e.shapes[sel()[0]];
      if (!s) return;
      rng.value = String(s.sw || 1.5); val.textContent = rng.value;
      dep.value = s.maxDepth != null ? s.maxDepth : '';
    }
    return { el: p, sync };
  }

  /* ══════════════ 3) المحاذاة ومكتشف المسارات ══════════════ */
  function buildAlign() {
    const p = panelShell();
    const mk = (icon, alt, title, fn) => {
      const b = el('button', 'dqp-b', ic(icon, alt));
      b.title = title; b.addEventListener('click', fn); return b;
    };
    const A = m => () => ed()?.alignSelected?.(m);
    const D = a => () => ed()?.distributeSelected?.(a);
    const B = o => () => ed()?.booleanOp?.(o);

    const s1 = el('div', 'dqp-sec');
    s1.appendChild(el('div', 'dqp-h', '<span>المحاذاة</span>'));
    const g1 = el('div', 'dqp-grid dqp-g3');
    g1.append(
      mk('align-right', '⇥', 'محاذاة يمين', A('right')),
      mk('align-hcenter', '⇹', 'توسيط أفقي', A('hcenter')),
      mk('align-left', '⇤', 'محاذاة يسار', A('left')),
      mk('align-top', '⤒', 'محاذاة أعلى', A('top')),
      mk('align-vcenter', '⇳', 'توسيط رأسي', A('vcenter')),
      mk('align-bottom', '⤓', 'محاذاة أسفل', A('bottom')),
    );
    s1.appendChild(g1);
    s1.appendChild(el('div', 'dqp-hint', 'تحتاج شكلين أو أكثر.'));

    const s2 = el('div', 'dqp-sec');
    s2.appendChild(el('div', 'dqp-h', '<span>التوزيع</span>'));
    const g2 = el('div', 'dqp-grid dqp-g2');
    g2.append(
      mk('dist-h', '↔', 'توزيع أفقي متساوٍ', D('h')),
      mk('dist-v', '↕', 'توزيع رأسي متساوٍ', D('v')),
    );
    s2.appendChild(g2);
    s2.appendChild(el('div', 'dqp-hint', 'يحتاج ثلاثة أشكال أو أكثر.'));

    const s3 = el('div', 'dqp-sec');
    s3.appendChild(el('div', 'dqp-h', '<span>مكتشف المسارات</span>'));
    const g3 = el('div', 'dqp-grid dqp-g2');
    const bb = (label, op) => { const b = el('button', 'dqp-b', label); b.title = label; b.addEventListener('click', B(op)); return b; };
    g3.append(bb('توحيد', 'union'), bb('طرح', 'difference'), bb('تقاطع', 'intersect'), bb('استبعاد', 'xor'));
    s3.appendChild(g3);
    s3.appendChild(el('div', 'dqp-hint', 'الأعلى ترتيباً يُطرح من الأسفل — كما في Illustrator.'));

    p.append(s1, s2, s3);
    return { el: p, sync: () => {} };
  }

  /* ══════════════ 4) التحويل ══════════════ */
  function buildTransform() {
    const p = panelShell();
    const mk = (label, id, title) => {
      const b = el('button', 'dqp-b', label); b.title = title || label;
      b.addEventListener('click', () => click(id)); return b;
    };

    const s1 = el('div', 'dqp-sec');
    s1.appendChild(el('div', 'dqp-h', '<span>انعكاس ودوران</span>'));
    const g1 = el('div', 'dqp-grid dqp-g2');
    g1.append(
      mk('انعكاس أفقي', 'st-mirror-h'),
      mk('انعكاس رأسي', 'st-mirror-v'),
      mk('تدوير بزاوية…', 'st-rotate'),
      mk('تحجيم بنسبة…', 'st-scale'),
    );
    s1.appendChild(g1);

    const s2 = el('div', 'dqp-sec');
    s2.appendChild(el('div', 'dqp-h', '<span>إزاحة دقيقة</span>'));
    const r = el('div', 'dqp-row');
    const dx = el('input'); dx.type = 'number'; dx.value = '0'; dx.step = '0.5'; dx.style.width = '62px';
    const dy = el('input'); dy.type = 'number'; dy.value = '0'; dy.step = '0.5'; dy.style.width = '62px';
    const go = el('button', 'dqp-b', 'حرّك');
    r.append(el('span', 'dqp-lbl', 'ΔX / ΔY'), dx, dy, go);
    s2.appendChild(r);
    go.addEventListener('click', () => {
      const e = ed(), idx = sel();
      if (!idx.length) { toast('حدّد شكلاً أولاً', 'warn'); return; }
      const ax = +dx.value || 0, ay = +dy.value || 0;
      if (!ax && !ay) return;
      e._saveHistory();
      idx.forEach(i => e._offsetShape(e.shapes[i], ax, ay));
      e.render(); e._updateStatus?.(); e._updateShapeToolbar?.();
      toast(`↔ حُرّك ${idx.length} شكلاً (${ax}, ${ay}) mm`, 'success');
    });

    const s3 = el('div', 'dqp-sec');
    s3.appendChild(el('div', 'dqp-h', '<span>تكرار وترتيب</span>'));
    const g3 = el('div', 'dqp-grid dqp-g2');
    g3.append(
      mk('مصفوفة…', 'st-array'),
      mk('إزاحة كفاف…', 'st-offset'),
      mk('تكرار', 'st-duplicate'),
      mk('عكس الاتجاه', 'st-reverse'),
    );
    s3.appendChild(g3);

    const s4 = el('div', 'dqp-sec');
    s4.appendChild(el('div', 'dqp-h', '<span>متقدّم</span>'));
    const g4 = el('div', 'dqp-grid dqp-g2');
    const bEach = el('button', 'dqp-b', 'تحويل كل شكل…');
    const bShear = el('button', 'dqp-b', 'إمالة…');
    bEach.addEventListener('click', () => ed()?.transformEach?.() ?? toast('غير متاح', 'warn'));
    bShear.addEventListener('click', () => ed()?.shearSelected?.() ?? toast('غير متاح', 'warn'));
    g4.append(bEach, bShear);
    s4.appendChild(g4);

    p.append(s1, s2, s3, s4);
    return { el: p, sync: () => {} };
  }

  /* ══════════════ 5) المحرف والفقرة ══════════════ */
  function buildType() {
    const p = panelShell();

    const s1 = el('div', 'dqp-sec');
    s1.appendChild(el('div', 'dqp-h', '<span>إدراج نص</span>'));
    const g1 = el('div', 'dqp-grid dqp-g2');
    const bTool = el('button', 'dqp-b', 'أداة النص');
    bTool.title = 'انقر على الكانفس لوضع نص منقوش';
    bTool.addEventListener('click', () => ed()?.setTool?.('text'));
    const bPath = el('button', 'dqp-b', 'نص على مسار…');
    bPath.addEventListener('click', () => ed()?.typeOnPath?.() ?? toast('غير متاح', 'warn'));
    const bVert = el('button', 'dqp-b', 'نص عمودي…');
    bVert.addEventListener('click', () => ed()?.verticalType?.() ?? toast('غير متاح', 'warn'));
    const bCal = el('button', 'dqp-b', 'محرك الخط العربي');
    bCal.addEventListener('click', () => window.Extras?.openEmbed?.('/calligraphy', 'محرك الخط العربي')
      || window.open('/calligraphy', '_blank', 'noopener'));
    g1.append(bTool, bPath, bVert, bCal);
    s1.appendChild(g1);

    const s2 = el('div', 'dqp-sec');
    s2.appendChild(el('div', 'dqp-h', '<span>المحرف</span>'));
    const r = el('div', 'dqp-row');
    const h = el('input'); h.type = 'number'; h.min = '1'; h.step = '0.5'; h.value = '10'; h.style.width = '72px';
    const apply = el('button', 'dqp-b', 'طبّق الارتفاع');
    r.append(el('span', 'dqp-lbl', 'الارتفاع mm'), h, apply);
    s2.appendChild(r);
    s2.appendChild(el('div', 'dqp-hint',
      'النصّ هنا منقوش بخط أحادي الخط (single-stroke) — يُقاس بارتفاع الحرف لا بحجم النقطة.'));

    apply.addEventListener('click', () => {
      const e = ed(), idx = sel().filter(i => e.shapes[i]?.type === 'text');
      if (!idx.length) { toast('حدّد كائن نصّ أولاً', 'warn'); return; }
      const nh = parseFloat(h.value);
      if (!(nh > 0)) { toast('ارتفاع غير صالح', 'warn'); return; }
      e._saveHistory();
      for (const i of idx) {
        const s = e.shapes[i];
        const k = nh / (s.height || nh);
        if (Math.abs(k - 1) < 1e-9) continue;
        // تحجيم حول الركن الأسفل-الأيسر للنصّ حتى يثبت موضع السطر
        const ox = s.x || 0, oy = s.y || 0;
        if (Array.isArray(s.strokes)) {
          s.strokes = s.strokes.map(st => st.map(q => ({ x: ox + (q.x - ox) * k, y: oy + (q.y - oy) * k })));
        }
        s.height = nh;
        if (s.width) s.width *= k;
      }
      e.render(); e._updateStatus?.(); e._updateShapeToolbar?.();
      toast(`ارتفاع الحرف ${nh}mm لـ${idx.length} نصّ`, 'success');
    });

    const s3 = el('div', 'dqp-sec');
    s3.appendChild(el('div', 'dqp-h', '<span>الفقرة</span>'));
    const g3 = el('div', 'dqp-grid dqp-g3');
    const al = (label, mode) => { const b = el('button', 'dqp-b', label); b.title = 'محاذاة كائنات النصّ ' + label;
      b.addEventListener('click', () => ed()?.alignSelected?.(mode)); return b; };
    g3.append(al('يمين', 'right'), al('توسيط', 'hcenter'), al('يسار', 'left'));
    s3.appendChild(g3);
    s3.appendChild(el('div', 'dqp-hint', 'محاذاة أسطر النصّ المنقوش بعضها ببعض.'));

    p.append(s1, s2, s3);

    function sync() {
      const e = ed(); if (!e) return;
      const s = e.shapes[sel()[0]];
      if (s && s.type === 'text' && s.height) h.value = String(s.height);
    }
    return { el: p, sync };
  }

  /* ══════════════ التسجيل ══════════════ */
  const DEFS = [
    { id: 'color',     title: 'الألوان',                   icon: 'palette',    build: buildColor },
    { id: 'stroke',    title: 'الخط والمظهر',              icon: 'pen',        build: buildStroke },
    { id: 'align',     title: 'المحاذاة ومكتشف المسارات',  icon: 'align-left', build: buildAlign },
    { id: 'transform', title: 'التحويل',                   icon: 'scale',      build: buildTransform },
    { id: 'type',      title: 'المحرف والفقرة',            icon: 'text-vertical', build: buildType },
  ];

  const syncers = [];
  function boot() {
    const WD = window.WorkspaceDock;
    if (!WD || !WD.register) return false;
    injectCSS();
    for (const d of DEFS) {
      const made = d.build();
      syncers.push(made.sync);
      WD.register(d.id, { title: d.title, icon: d.icon, el: made.el });
    }
    // تُحدَّث محتوياتها مع كل تغيّر تحديد عبر ناقل أحداث P1
    const hook = () => {
      const e = ed();
      if (!e || !e.events) return false;
      e.events.on('selection:changed', () => syncers.forEach(f => { try { f(); } catch (_) {} }));
      e.events.on('history:changed',   () => syncers.forEach(f => { try { f(); } catch (_) {} }));
      return true;
    };
    if (!hook()) {
      let n = 0;
      const t = setInterval(() => { if (hook() || ++n > 40) clearInterval(t); }, 200);
    }
    return true;
  }

  if (!boot()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
  }
})();
