/**
 * FeedsSpeeds.js — حاسبة السرعات والتغذية (Feeds & Speeds)
 *
 * تحسب التغذية وسرعة الغطس والعمق الآمن وحمل القاطع (chip load) لكل مادة،
 * وتُحذّر من كسر اللقمة قبل أن يحدث. مصدر الحقيقة الوحيد لجداول chip-load.
 *
 * وحدة مشتركة (UMD):
 *   الخادم  : require('./FeedsSpeeds')
 *   المتصفح : window.FeedsSpeeds  (نفس الكود حرفياً)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.FeedsSpeeds = factory();
    root.FeedsSpeeds = root.DQ.FeedsSpeeds;
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // chip load (mm/سن) مرجعي عند قطر 6mm + معاملات لكل مادة
  // chipLoad = base × (القطر/6) ضمن حدود؛ والمدى يُوسّع للتحذير
  // plungeFactor = نسبة سرعة الغطس من التغذية الأفقية
  // maxDocFactor = أقصى عمق تمريرة آمن كنسبة من قطر العدّة (للتفريز الكامل/slotting)
  const MATERIALS = {
    mdf:      { name: 'MDF (خشب مضغوط)',     base: 0.10, min: 0.07, max: 0.14, plungeFactor: 0.40, maxDocFactor: 1.0, coolant: false },
    plywood:  { name: 'خشب أبلكاش/معاكس',     base: 0.09, min: 0.06, max: 0.13, plungeFactor: 0.40, maxDocFactor: 1.0, coolant: false },
    hardwood: { name: 'خشب صلب (زان/سنديان)', base: 0.08, min: 0.05, max: 0.11, plungeFactor: 0.40, maxDocFactor: 0.8, coolant: false },
    softwood: { name: 'خشب طري (صنوبر)',      base: 0.10, min: 0.07, max: 0.14, plungeFactor: 0.40, maxDocFactor: 1.0, coolant: false },
    acrylic:  { name: 'أكريليك (بلكسي)',      base: 0.08, min: 0.05, max: 0.12, plungeFactor: 0.35, maxDocFactor: 0.5, coolant: false, tip: 'استخدم لقمة سنّ واحد (O-flute) لمنع ذوبان الأكريليك' },
    pvc:      { name: 'PVC / فوم',            base: 0.10, min: 0.06, max: 0.14, plungeFactor: 0.40, maxDocFactor: 1.0, coolant: false },
    acp:      { name: 'ألوبوند ACP (لافتات)', base: 0.06, min: 0.04, max: 0.09, plungeFactor: 0.30, maxDocFactor: 0.5, coolant: false },
    aluminum: { name: 'ألمنيوم',              base: 0.04, min: 0.025, max: 0.06, plungeFactor: 0.30, maxDocFactor: 0.5, coolant: true,  tip: 'استخدم هواء مضغوط أو سائل تبريد، ولقمة كربيد' },
    brass:    { name: 'نحاس أصفر',            base: 0.04, min: 0.025, max: 0.06, plungeFactor: 0.30, maxDocFactor: 0.4, coolant: false },
    steel:    { name: 'حديد طري',             base: 0.02, min: 0.01,  max: 0.03, plungeFactor: 0.25, maxDocFactor: 0.3, coolant: true,  tip: 'لقمة كربيد + تبريد إجباري، وRPM منخفض' },
    generic:  { name: 'عام / غير محدد',        base: 0.03, min: 0.02,  max: 0.05, plungeFactor: 0.35, maxDocFactor: 0.6, coolant: false },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, d = 0) => { const p = Math.pow(10, d); return Math.round(v * p) / p; };

  function listMaterials() {
    return Object.entries(MATERIALS).map(([key, m]) => ({ key, name: m.name }));
  }

  /**
   * @param {Object} i
   *   material     : مفتاح المادة (mdf/aluminum/…)
   *   toolDiameter : قطر العدّة mm
   *   flutes       : عدد الأسنان
   *   rpm          : دوران المحور
   *   docTarget    : عمق التمريرة المرغوب mm (اختياري — للتحذير وحساب MRR)
   *   wocTarget    : عرض القطع mm (اختياري — لحساب MRR؛ افتراضياً قطر العدّة)
   *   machineMaxFeed : أقصى تغذية تدعمها الآلة mm/min (اختياري)
   * @returns {Object} النتائج + warnings[]
   */
  function compute(i) {
    const mat = MATERIALS[i.material] || MATERIALS.generic;
    const dia    = Math.max(0.1, Number(i.toolDiameter) || 3);
    const flutes = Math.max(1, Math.round(Number(i.flutes) || 2));
    const rpm    = Math.max(1, Math.round(Number(i.rpm) || 18000));
    const warnings = [];

    // chip load يتناسب مع القطر (لقمة أصغر = سنّ أرفع = حمل أقل)
    const scale    = clamp(dia / 6, 0.3, 1.6);
    const chipLoad = round(mat.base * scale, 4);
    const clMin    = round(mat.min * scale, 4);
    const clMax    = round(mat.max * scale, 4);

    const feed       = Math.round(rpm * flutes * chipLoad);
    const feedMin    = Math.round(rpm * flutes * clMin);
    const feedMax    = Math.round(rpm * flutes * clMax);
    const plungeRate = Math.round(feed * mat.plungeFactor);
    const maxDoc     = round(mat.maxDocFactor * dia, 2);

    // MRR (cm³/دقيقة) إن توفّر العمق
    const woc = Number(i.wocTarget) > 0 ? Number(i.wocTarget) : dia;
    const doc = Number(i.docTarget) > 0 ? Number(i.docTarget) : null;
    const mrr = doc ? round((feed * doc * woc) / 1000, 2) : null;

    // ── التحذيرات ───────────────────────────────────────────────
    if (doc && doc > maxDoc) {
      warnings.push({ level: 'danger',
        msg: `عمق التمريرة ${doc}mm أكبر من الآمن (${maxDoc}mm) — خطر كسر اللقمة. قسّمه إلى تمريرات أصغر.` });
    }
    if (dia <= 2 && ['aluminum', 'brass', 'steel'].includes(i.material)) {
      warnings.push({ level: 'danger',
        msg: `لقمة رفيعة (${dia}mm) في معدن — هشّة جداً. خفّض العمق والتغذية واستخدم كربيد.` });
    }
    if (dia <= 1) {
      warnings.push({ level: 'warn',
        msg: `لقمة دقيقة جداً (${dia}mm) — أي حمل زائد يكسرها فوراً. تمريرات سطحية فقط.` });
    }
    if (i.machineMaxFeed && feed > Number(i.machineMaxFeed)) {
      warnings.push({ level: 'warn',
        msg: `التغذية الموصى بها (${feed}) تتجاوز حد آلتك (${i.machineMaxFeed}). خفّض RPM لتقليل التغذية المطلوبة.` });
    }
    if (mat.coolant) {
      warnings.push({ level: 'info', msg: mat.tip || 'هذه المادة تحتاج تبريداً (هواء/سائل) لمنع التصاق ولحام البرادة باللقمة.' });
    } else if (mat.tip) {
      warnings.push({ level: 'info', msg: mat.tip });
    }
    if (!warnings.some(w => w.level === 'danger')) {
      warnings.push({ level: 'ok', msg: 'الإعدادات ضمن النطاق الآمن لهذه المادة والعدّة.' });
    }

    return {
      material: mat.name,
      chipLoad, chipLoadRange: [clMin, clMax],
      feed, feedRange: [feedMin, feedMax],
      plungeRate,
      maxDoc,
      mrr,
      warnings,
    };
  }

  return { compute, listMaterials, MATERIALS };
}));
