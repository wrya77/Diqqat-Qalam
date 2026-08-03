/**
 * help-center.js — قائمة «مساعدة»
 *
 *   مراجع قصيرة تُقرأ داخل التطبيق بلا مغادرته: الاختصارات، أوامر G-Code التي
 *   يولّدها البرنامج فعلاً، دليل مساحة ثلاثيّ الأبعاد، المساطر والأدلة، قائمة
 *   فحصٍ قبل تشغيل الآلة، وتشخيصٌ يُلصَق في بلاغ عطل.
 *
 *   المحتوى مكتوبٌ هنا لا مجلوبٌ من الشبكة: التطبيق يعمل دون اتصال (Electron
 *   ونسخة PWA)، ومساعدةٌ تحتاج إنترنت ليست مساعدة.
 */
(function helpCenter() {
  'use strict';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ico = n => { try { return window.DQIcon ? window.DQIcon(n) : ''; } catch (_) { return ''; } };
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };

  function injectCSS() {
    if (document.getElementById('dqh-css')) return;
    const s = document.createElement('style');
    s.id = 'dqh-css';
    s.textContent = `
      .dqh{font-size:12.5px;line-height:1.85;color:var(--text2,#b1bac4);max-height:64vh;overflow-y:auto}
      .dqh h4{margin:14px 0 6px;font-size:11px;font-weight:800;letter-spacing:.4px;
        color:var(--text3,#8b949e);text-transform:uppercase}
      .dqh h4:first-child{margin-top:0}
      .dqh p{margin:0 0 8px}
      .dqh b{color:var(--text,#e6edf3)}
      .dqh code{font-family:ui-monospace,monospace;font-size:11.5px;padding:1px 5px;border-radius:4px;
        background:var(--bg1,#0d1117);border:1px solid var(--border,#30363d);color:var(--accent-h,#6b86ff)}
      .dqh table{width:100%;border-collapse:collapse;margin:2px 0 10px}
      .dqh td{padding:4px 7px;border-bottom:1px solid var(--border,#30363d);vertical-align:top}
      .dqh tr:last-child td{border-bottom:none}
      .dqh td:first-child{width:34%;white-space:nowrap;color:var(--text,#e6edf3);font-weight:600}
      .dqh tr:nth-child(odd) td{background:color-mix(in srgb,var(--bg3,#1c2128) 45%,transparent)}
      .dqh kbd{font-family:ui-monospace,monospace;font-size:11px;background:var(--bg1,#0d1117);
        border:1px solid var(--border2,#3d444d);border-bottom-width:2px;border-radius:4px;
        padding:1px 6px;color:var(--text,#e6edf3);white-space:nowrap}
      .dqh ul{margin:0 0 10px;padding-inline-start:18px}
      .dqh li{margin-bottom:4px}
      .dqh-chk{display:flex;align-items:flex-start;gap:8px;padding:5px 7px;border-radius:6px;
        cursor:pointer;user-select:none}
      .dqh-chk:hover{background:var(--bg3,#1c2128)}
      .dqh-chk input{margin-top:4px;accent-color:var(--accent,#4f6ef7);flex:0 0 auto}
      .dqh-chk.done{opacity:.5;text-decoration:line-through}
      .dqh-warn{padding:8px 10px;border-radius:7px;margin:8px 0;
        background:color-mix(in srgb,#f0883e 12%,transparent);
        border:1px solid color-mix(in srgb,#f0883e 45%,transparent);color:#f0b072}
      .dqh-b{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:7px;
        border:1px solid var(--border,#30363d);background:var(--bg2,#161b22);cursor:pointer;
        color:var(--text2,#b1bac4);font-family:inherit;font-size:12px;font-weight:600}
      .dqh-b:hover{background:var(--bg3,#1c2128);color:var(--text,#e6edf3)}
      .dqh-b.pri{background:var(--accent,#4f6ef7);border-color:var(--accent,#4f6ef7);color:#fff}
      .dqh-b svg{width:14px;height:14px}
      .dqh-x{background:none;border:none;cursor:pointer;color:var(--text3,#8b949e);
        padding:2px;line-height:0;border-radius:5px}
      .dqh-x:hover{color:var(--text,#e6edf3);background:var(--bg3,#1c2128)}
      .dqh-x svg{width:15px;height:15px}
    `;
    document.head.appendChild(s);
  }

  /** نافذة مشروطة موحّدة لكل بنود المساعدة */
  function sheet(title, html, footHTML) {
    injectCSS();
    document.getElementById('_dqh')?.remove();
    const dlg = document.createElement('dialog');
    dlg.id = '_dqh';
    dlg.className = 'modal modal-wide';
    dlg.innerHTML =
      `<h3 style="display:flex;align-items:center;gap:8px">
         <span style="flex:1">${esc(title)}</span>
         <button class="dqh-x" id="_dqh-x" aria-label="إغلاق" title="إغلاق">${ico('close')}</button>
       </h3>
       <div class="modal-body" style="padding:16px 20px"><div class="dqh">${html}</div></div>` +
      (footHTML ? `<div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px">${footHTML}</div>` : '');
    document.body.appendChild(dlg);
    dlg.querySelector('#_dqh-x').onclick = () => dlg.close();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
  }

  const rows = pairs => '<table>' +
    pairs.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('') + '</table>';

  /* ═══════════════ البنود ═══════════════ */

  function tour() {
    if (window.OnboardingTour && window.OnboardingTour.start) { window.OnboardingTour.start(); return; }
    toast('الجولة التعريفية غير متاحة الآن', 'warn');
  }

  function palette() {
    if (window.CommandPalette && window.CommandPalette.open) { window.CommandPalette.open(); return; }
    toast('لوحة الأوامر غير متاحة', 'warn');
  }

  /** لوحة «المفاتيح» مسجَّلة في الدوك — نفتحها بدل تكرار قائمتها هنا */
  function keys() {
    const W = window.WorkspaceDock;
    if (W && W.open) { W.open('keys'); toast('لوحة المفاتيح مفتوحة في الجانب', 'info'); return; }
    toast('لوحة المفاتيح غير متاحة', 'warn');
  }

  function guidesHelp() {
    const W = window.WorkspaceDock;
    sheet('المساطر والأدلة', `
      <h4>المساطر</h4>
      <p>شريطان بالمليمتر أعلى اللوحة ويمينها، يتبعان التكبير والإزاحة.
         نقرةٌ على <b>مربّع الزاوية</b> تُظهرهما أو تُخفيهما، ونقرةٌ مزدوجة تمسح كل الأدلة.</p>
      <h4>إنشاء دليل</h4>
      ${rows([
        ['بالسحب', 'اسحب من داخل شريط المسطرة إلى اللوحة'],
        ['بموضع دقيق', 'لوحة «الأدلة والمساطر» ← إضافة بموضع دقيق'],
        ['من الأشكال', 'مولّدات: حواف التحديد · مركزه · المحوران · هوامش'],
        ['دليل مائل', 'اختر «مائل» وحدّد نقطةً وزاوية — يلتقط الرسمُ عليه بالإسقاط العموديّ'],
      ])}
      <h4>التحكّم</h4>
      ${rows([
        ['تحريك', 'اسحب الدليل نفسه'],
        ['حذف', 'أعِد سحبه إلى المسطرة، أو زرّ الحذف في اللوحة'],
        ['قفل', 'المقفل يُرسم منقّطاً: يُرى ويلتقط ولا يُمسَك بالفأرة'],
        ['إخفاء مؤقّت', 'زرّ العين في صفّ الدليل — يبقى محفوظاً ولا يلتقط'],
        ['إيقاف الالتقاط', 'مفتاح «الالتقاط» في أعلى اللوحة'],
      ])}
      <h4>الأدلة الذكية</h4>
      <p>أثناء الرسم أو تحريك شكل تظهر خطوط قرمزية تحاذي حواف الأشكال الأخرى ومراكزها،
         ويلتقط المؤشّر عليها تلقائياً. تُعطَّل بإخفاء المساطر.</p>
    `, `<button class="dqh-b pri" id="_dqh-g">${ico('ruler')}<span>افتح لوحة الأدلة</span></button>`);
    const b = document.getElementById('_dqh-g');
    if (b) b.onclick = () => {
      document.getElementById('_dqh')?.close();
      if (W && W.open) W.open('guides'); else toast('اللوحة غير مسجّلة', 'warn');
    };
  }

  function cad3dHelp() {
    sheet('دليل مساحة ثلاثيّ الأبعاد', `
      <h4>الوصول</h4>
      <p>قائمة <b>نافذة ← مساحة ثلاثيّ الأبعاد</b>، أو <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>.
         النموذج <b>بارامتريّ</b>: كل عملية تُحفَظ ميزةً في الشجرة، وتعديل معاملها
         يُعيد بناءها وكل ما فوقها.</p>
      <h4>من الرسم إلى المجسّم</h4>
      ${rows([
        ['بثق', 'حدّد شكلاً في لوحة الرسم ثم «بثق» — بميلٍ وشطفٍ اختياريّين'],
        ['تدوير', 'مقطع يدور حول محور، بزاوية كاملة أو جزئية'],
        ['كنس', 'حدّد المقطع ثم المسار (آخر محدَّد = المسار)'],
        ['تجسير', 'مقطعان اثنان يُوصلان بجسم واحد'],
        ['لولب', 'مقطع + نصف قطر وخطوة وعدد لفّات'],
      ])}
      <h4>الحفر والنقش</h4>
      ${rows([
        ['ثقب', 'قطر وموضع وعمق — صفرٌ يعني نافذاً'],
        ['جيب', 'مستطيل محفور من السطح العلويّ'],
        ['نقش الرسم', 'يحفر أشكال لوحة الرسم داخل المجسّم بعمقٍ محدَّد'],
        ['إبراز الرسم', 'يرفعها فوق سطحه بدل حفرها'],
      ])}
      <h4>التصنيع</h4>
      ${rows([
        ['مسار تخشين', 'يُولّد G-Code ثلاثيّ المحاور من خريطة ارتفاعات المجسّم'],
        ['كتلة الخام', 'صندوق بهوامش حول القطعة — شاهده بوضع الإظهار «شفّاف»'],
        ['تقرير التصنيع', 'نسبة الأوجه المتدلّية التي تحتاج دعماً أو قلباً'],
        ['مقطع إلى الرسم', 'يقطع المجسّم بمستوٍ ويُعيد الحلقات إلى لوحة الرسم'],
        ['إسقاط الظلّ', 'ظلّ المجسّم على XY كمخطّط ثنائيّ'],
      ])}
      <h4>الاختصارات داخل المساحة</h4>
      ${rows([
        ['<kbd>U</kbd> · <kbd>S</kbd> · <kbd>I</kbd>', 'اتحاد · طرح · تقاطع'],
        ['<kbd>M</kbd> · <kbd>R</kbd> · <kbd>T</kbd>', 'نقل · تدوير · تحجيم'],
        ['<kbd>H</kbd> · <kbd>Del</kbd>', 'إخفاء · حذف'],
        ['<kbd>F</kbd> · <kbd>١</kbd>–<kbd>٧</kbd>', 'ملاءمة · المساقط'],
        ['<kbd>F2</kbd> · <kbd>Ctrl</kbd>+<kbd>A</kbd>', 'إعادة تسمية · تحديد الكلّ'],
      ])}
      <p>الشجرة تُحفَظ تلقائياً في المتصفّح، فتعود كما تركتَها بعد تحديث الصفحة.</p>
    `, `<button class="dqh-b pri" id="_dqh-3d">${ico('cube')}<span>افتح المساحة</span></button>`);
    const b = document.getElementById('_dqh-3d');
    if (b) b.onclick = () => { document.getElementById('_dqh')?.close(); window.CAD3D?.reveal?.(); };
  }

  function gcodeHelp() {
    sheet('أوامر G-Code التي يولّدها البرنامج', `
      <p>هذه هي الأوامر التي تظهر فعلاً في ملفّاتك — لا مرجعاً عامّاً للمعيار.</p>
      <h4>التهيئة</h4>
      ${rows([
        ['<code>G21</code>', 'الوحدات بالمليمتر'],
        ['<code>G90</code>', 'إحداثيات مطلقة (لا نسبية)'],
        ['<code>G17</code>', 'مستوى العمل XY'],
        ['<code>G94</code>', 'التغذية بالمليمتر في الدقيقة'],
        ['<code>G54</code>', 'نظام إحداثيات القطعة الأوّل'],
      ])}
      <h4>الحركة</h4>
      ${rows([
        ['<code>G00</code>', 'حركة سريعة — بلا قطع، دائماً على ارتفاع الأمان'],
        ['<code>G01</code>', 'حركة قطع مستقيمة بتغذية <code>F</code>'],
        ['<code>G02</code> / <code>G03</code>', 'قوس باتجاه عقارب الساعة / عكسها'],
      ])}
      <h4>المغزل والبرنامج</h4>
      ${rows([
        ['<code>M03 S…</code>', 'تشغيل المغزل بالدورة المحدّدة'],
        ['<code>M05</code>', 'إيقاف المغزل'],
        ['<code>M30</code>', 'نهاية البرنامج والعودة إلى البداية'],
        ['<code>G04 P…</code>', 'انتظار بالثواني (تسريع المغزل)'],
      ])}
      <div class="dqh-warn">قبل التشغيل الحقيقيّ: شغّل «فحص جاهزية الملفّ» — يكشف الحركات
        خارج مدى الآلة، والغطسات بلا تغذية، والمسارات المتقاطعة.</div>
    `);
  }

  function unitsHelp() {
    if (window.Extras && window.Extras.units) { window.Extras.units(); return; }
    sheet('محوّل الوحدات', rows([
      ['1 بوصة', '25.4 مم'],
      ['1 قدم', '304.8 مم'],
      ['1 مم', '0.03937 بوصة'],
      ['التغذية بوصة/دقيقة → مم/دقيقة', 'اضرب في 25.4'],
      ['1 HP', '745.7 واط'],
    ]));
  }

  const CHECKS = [
    'ثُبِّتت القطعة بإحكام ولا تتحرّك باليد',
    'صُفِّر نقطة الأصل X · Y · Z على القطعة لا على المنضدة',
    'الأداة مركّبة بإحكام وطولها البارز يكفي أعمق قطع',
    'ارتفاع الأمان أعلى من أيّ مشبك أو برغي على المسار',
    'سرعة المغزل والتغذية تناسبان الخامة وقطر الأداة',
    'جُرّب المسار في الهواء (تعويض Z للأعلى) أو بمحاكاة البرنامج',
    'مسار الشفط أو التبريد جاهز إن كانت الخامة تتطلّبه',
    'النظّارات الواقية مرتداة، والأكمام والشعر بعيدان عن المغزل',
    'زرّ الإيقاف الاضطراريّ في متناول اليد ومُختبَر',
    'لن تُترك الآلة تعمل بلا مراقبة',
  ];

  function checklist() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('dq_checklist') || '{}'); } catch (_) {}
    const html = CHECKS.map((t, i) =>
      `<label class="dqh-chk${saved[i] ? ' done' : ''}" data-i="${i}">
         <input type="checkbox"${saved[i] ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('');
    sheet('قائمة فحص السلامة قبل التشغيل',
      `<p>راجعها في كل تشغيل. تُحفَظ علاماتها في هذا المتصفّح.</p>${html}
       <div class="dqh-warn">CNC آلة قطع لا لعبة: أسرع خطأ يكسر أداةً، وأبطأ خطأ يكسر يداً.</div>`,
      `<button class="dqh-b" id="_dqh-clr">${ico('refresh')}<span>امسح العلامات</span></button>`);
    const dlg = document.getElementById('_dqh');
    dlg.querySelectorAll('.dqh-chk').forEach(l => {
      l.addEventListener('change', () => {
        const i = l.dataset.i, on = l.querySelector('input').checked;
        l.classList.toggle('done', on);
        saved[i] = on;
        try { localStorage.setItem('dq_checklist', JSON.stringify(saved)); } catch (_) {}
      });
    });
    const c = document.getElementById('_dqh-clr');
    if (c) c.onclick = () => {
      saved = {};
      try { localStorage.removeItem('dq_checklist'); } catch (_) {}
      dlg.querySelectorAll('.dqh-chk').forEach(l => {
        l.classList.remove('done'); l.querySelector('input').checked = false;
      });
    };
  }

  function diagnostics() {
    const e = window.app && window.app.editor;
    const gl = (() => {
      try {
        const c = document.createElement('canvas');
        const g = c.getContext('webgl2') || c.getContext('webgl');
        if (!g) return 'غير متاح';
        const d = g.getExtension('WEBGL_debug_renderer_info');
        return d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)).slice(0, 60) : 'متاح';
      } catch (_) { return 'غير متاح'; }
    })();
    const info = [
      ['الإصدار', (window.app && window.app.version) || '—'],
      ['المتصفّح', navigator.userAgent.slice(0, 70)],
      ['اللغة والاتجاه', navigator.language + ' · ' + document.documentElement.dir],
      ['الشاشة', `${screen.width}×${screen.height} @${window.devicePixelRatio}x`],
      ['النافذة', `${innerWidth}×${innerHeight}`],
      ['WebGL', gl],
      ['الأشكال في المشروع', e && e.shapes ? e.shapes.length : '—'],
      ['ميزات ثلاثيّ الأبعاد', window.CAD3D ? window.CAD3D.features().length : 'لم تُفتح'],
      ['الأدلة', window.DQGuides ? window.DQGuides.list().length : '—'],
      ['العامل الخدميّ', ('serviceWorker' in navigator) ? 'مدعوم' : 'غير مدعوم'],
      ['الاتصال', navigator.onLine ? 'متّصل' : 'غير متّصل'],
      ['سطح المكتب', (navigator.userAgent.includes('Electron') ? 'نعم' : 'لا')],
    ];
    sheet('تشخيص النظام',
      `<p>ألصِق هذه البيانات في أيّ بلاغ عطل — تختصر نصف الأسئلة.</p>${rows(info)}`,
      `<button class="dqh-b pri" id="_dqh-cp">${ico('clipboard')}<span>انسخ التقرير</span></button>`);
    const b = document.getElementById('_dqh-cp');
    if (b) b.onclick = async () => {
      const txt = info.map(([k, v]) => `${k}: ${v}`).join('\n');
      try { await navigator.clipboard.writeText(txt); toast('نُسخ التقرير', 'success'); }
      catch (_) { toast('تعذّر النسخ — انسخه يدوياً', 'warn'); }
    };
  }

  function about() {
    sheet('عن دقة قلم', `
      <p><b>دقة قلم</b> — من التصميم إلى آلة CNC في ثوانٍ.
         محرّر متّجهات عربيّ يولّد G-Code مباشرةً، بمساحة ثلاثيّة الأبعاد بارامترية
         ومحرّك خطٍّ عربيّ ومحاكٍ للمسار.</p>
      ${rows([
        ['الإصدار', (window.app && window.app.version) || '—'],
        ['الوحدات', 'مليمتر · إحداثيات مطلقة G90'],
        ['يعمل دون اتصال', 'نعم — بعد أوّل تحميل'],
      ])}
      <h4>ما الذي يميّزه</h4>
      <ul>
        <li>عربيّ أصلاً: الواجهة والتشكيل والاتجاه، لا ترجمةً على قالبٍ لاتينيّ.</li>
        <li>G-Code مفهوم: كل سطرٍ مُعلَّق ومطابقٌ لما تراه على الشاشة.</li>
        <li>فحص جاهزية قبل التشغيل يمنع أخطاءً تكسر الأدوات.</li>
        <li>لا يرفع تصميمك إلى أيّ خادم لتوليد المسار — الحساب في جهازك.</li>
      </ul>
    `);
  }

  window.HelpCenter = {
    tour, palette, keys, gcode: gcodeHelp, cad3d: cad3dHelp,
    guides: guidesHelp, units: unitsHelp, checklist, diagnostics, about,
  };
})();
