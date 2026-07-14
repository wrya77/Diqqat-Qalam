/**
 * onboarding.js — جولة تعريفية (ميزة #7)
 *
 *  تُبرز أهم مناطق الواجهة خطوةً خطوة مع بطاقة شرح وبقعة ضوئية على الهدف،
 *  تعمل تلقائياً أول زيارة وتُعاد من أدوات ▸ «🎓 جولة تعريفية» أو Ctrl+K.
 *
 *  ملاحظة: التلميحات الغنية (title → فقاعة منسّقة) يوفّرها ui-polish.js أصلاً
 *  (مع حفظ aria-label لقارئات الشاشة) فلا نكرّرها هنا.
 *
 *  لا منطق تطبيقي — واجهة إرشادية فقط. يُحمَّل قرب النهاية بعد بناء الواجهة.
 */
(function onboarding() {
  'use strict';

  /* ═══════════════ الجولة التعريفية ═══════════════ */
  const STEPS = [
    { title: '👋 أهلاً بك في دقة قلم', body: 'جولة سريعة (~30 ثانية) على أهم أدوات التطبيق. يمكنك التخطّي في أي وقت.' },
    { sel: '#tools-rail', title: '✎ أدوات الرسم', body: 'الخطوط والأشكال والعقد والأدوات الاحترافية وأدوات CNC — كلّها هنا.' },
    { sel: '#color-bar', title: '🎨 الألوان', body: 'يسرى = لون الخط، يمنى = التعبئة. مع ملتقط ألوان 💧 وتدرّجات 🌈 وألوان أخيرة.' },
    { sel: '#props-section', title: '📐 الخصائص', body: 'حدّد شكلاً لتحرير موضعه وأبعاده ودورانه بدقّة — بنمط CorelDraw/Illustrator.' },
    { sel: '#layers-panel', title: '🗂 الطبقات', body: 'نظّم أشكالك: قطع · نقش · تخطيط — مع إظهار/إخفاء وقفل لكل طبقة.' },
    { sel: '#btn-generate', title: '⚡ توليد G-Code', body: 'يحوّل تصميمك إلى كود CNC. أو فعّل الوضع الحيّ ليتحدّث تلقائياً مع كل تعديل.' },
    { sel: '.output-panel', title: '📄 المخرجات', body: 'الكود الملوّن + الإحصائيات وزمن التشغيل + محاكاة المسار ثنائية/ثلاثية الأبعاد.' },
    { title: '🚀 جاهز للبدء!', body: 'اضغط Ctrl+K لأي أمر فوراً، وجرّب أدوات ▸ «مكتبة القوالب» لتصاميم جاهزة. بالتوفيق!' },
  ];

  const KEY = 'dq_tour_done';
  let idx = 0, ov, spot, card;

  function injectCSS() {
    if (document.getElementById('ob-css')) return;
    const st = document.createElement('style');
    st.id = 'ob-css';
    st.textContent = `
      .ob-ov{position:fixed;inset:0;z-index:3500;display:none}
      .ob-ov.open{display:block}
      .ob-spot{position:absolute;border-radius:10px;box-shadow:0 0 0 9999px rgba(3,6,12,.68);
        transition:top .25s,left .25s,width .25s,height .25s;pointer-events:none;
        border:2px solid var(--accent,#4f6ef7)}
      .ob-card{position:absolute;width:min(320px,88vw);background:var(--bg1,#0d1117);
        border:1px solid var(--border2,#3d444d);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.6);
        padding:18px;transition:top .25s,left .25s}
      .ob-card h3{margin:0 0 8px;font-size:16px;color:var(--text,#e6edf3)}
      .ob-card p{margin:0 0 14px;font-size:13.5px;line-height:1.6;color:var(--text2,#b1bac4)}
      .ob-dots{display:flex;gap:5px;margin-bottom:12px}
      .ob-dots i{width:7px;height:7px;border-radius:50%;background:var(--border2,#3d444d)}
      .ob-dots i.on{background:var(--accent,#4f6ef7);width:18px;border-radius:4px}
      .ob-row{display:flex;gap:8px;align-items:center}
      .ob-row .ob-skip{margin-inline-end:auto;background:none;border:none;color:var(--text3,#8b949e);
        cursor:pointer;font-size:12.5px;font-family:inherit}
      .ob-btn{padding:8px 16px;border-radius:8px;font-size:13.5px;cursor:pointer;font-family:inherit;font-weight:600}
      .ob-prev{background:var(--bg3,#1c2128);border:1px solid var(--border2,#3d444d);color:var(--text2,#b1bac4)}
      .ob-next{background:var(--accent,#4f6ef7);border:none;color:#fff}
      .ob-next:hover{filter:brightness(1.08)}
    `;
    document.head.appendChild(st);
  }

  function build() {
    injectCSS();
    ov = document.createElement('div');
    ov.className = 'ob-ov'; ov.dir = 'rtl';
    ov.innerHTML = `<div class="ob-spot" style="display:none"></div><div class="ob-card"></div>`;
    document.body.appendChild(ov);
    spot = ov.querySelector('.ob-spot');
    card = ov.querySelector('.ob-card');
  }

  function positionCard(rect) {
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16;
    let top, left;
    if (!rect) {   // موسّطة
      top = (innerHeight - ch) / 2; left = (innerWidth - cw) / 2;
    } else {
      // تحت الهدف إن أمكن، وإلا فوقه
      if (rect.bottom + gap + ch < innerHeight) top = rect.bottom + gap;
      else if (rect.top - gap - ch > 0) top = rect.top - gap - ch;
      else top = Math.max(gap, (innerHeight - ch) / 2);
      left = rect.left + rect.width / 2 - cw / 2;
      left = Math.max(gap, Math.min(left, innerWidth - cw - gap));
    }
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  }

  function renderStep() {
    const s = STEPS[idx];
    let rect = null;
    const el = s.sel && document.querySelector(s.sel);
    if (el && el.offsetParent !== null) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      rect = el.getBoundingClientRect();
      const pad = 6;
      spot.style.display = '';
      spot.style.top = (rect.top - pad) + 'px';
      spot.style.left = (rect.left - pad) + 'px';
      spot.style.width = (rect.width + 2 * pad) + 'px';
      spot.style.height = (rect.height + 2 * pad) + 'px';
    } else {
      spot.style.display = 'none';
    }

    const last = idx === STEPS.length - 1;
    card.innerHTML = `
      <div class="ob-dots">${STEPS.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>
      <h3>${s.title}</h3>
      <p>${s.body}</p>
      <div class="ob-row">
        <button class="ob-skip">تخطّي</button>
        ${idx > 0 ? '<button class="ob-btn ob-prev">‹ السابق</button>' : ''}
        <button class="ob-btn ob-next">${last ? 'ابدأ الاستخدام ✓' : 'التالي ›'}</button>
      </div>`;
    card.querySelector('.ob-skip').addEventListener('click', finish);
    card.querySelector('.ob-next').addEventListener('click', () => last ? finish() : go(idx + 1));
    card.querySelector('.ob-prev')?.addEventListener('click', () => go(idx - 1));

    requestAnimationFrame(() => positionCard(rect));
  }

  function go(i) { idx = Math.max(0, Math.min(i, STEPS.length - 1)); renderStep(); }

  function start() {
    if (!ov) build();
    idx = 0;
    ov.classList.add('open');
    renderStep();
  }

  function finish() {
    if (ov) ov.classList.remove('open');
    localStorage.setItem(KEY, '1');
  }

  // تشغيل تلقائي أول زيارة (بعد استقرار الواجهة)
  function maybeAutoStart() {
    if (localStorage.getItem(KEY)) return;
    setTimeout(() => { if (!localStorage.getItem(KEY)) start(); }, 1400);
  }

  window.addEventListener('keydown', e => { if (e.key === 'Escape' && ov && ov.classList.contains('open')) finish(); });
  window.addEventListener('load', maybeAutoStart);

  window.OnboardingTour = { start, finish };
})();
