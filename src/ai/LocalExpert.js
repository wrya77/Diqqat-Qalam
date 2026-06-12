'use strict';
/**
 * LocalExpert.js — نظام خبير محلي حتمي (يعمل دائماً، بلا إنترنت ولا API)
 *
 * يفحص الإعدادات والأشكال بقواعد التشغيل الفيزيائية المعروفة ويعيد
 * نصائح عملية بالعربية. يُدمج ناتجه مع اقتراحات AI السحابي إن توفر.
 */

const materials = require('../utils/materials');
const geometry  = require('../utils/geometry');

// أقصى عمق طبقة كنسبة من قطر الأداة حسب المادة
const MAX_AP_RATIO = { wood: 1.0, plastic: 0.7, generic: 0.5, brass: 0.3, aluminum: 0.25, steel: 0.12 };

// نطاق سرعة السطح المعقول vc (م/دقيقة) حسب المادة لأدوات الكربايد
const VC_RANGE = {
  wood:     [300, 900],
  plastic:  [150, 500],
  generic:  [100, 400],
  aluminum: [150, 500],
  brass:    [100, 300],
  steel:    [60, 180],
};

function analyze(shapes, config = {}) {
  const tips = [];
  const matKey = materials[config.material] ? config.material : 'generic';
  const mat    = materials[matKey];
  const D      = config.toolDiameter || 3;
  const rpm    = config.spindleSpeed || 18000;
  const flutes = config.toolFlutes   || 2;
  const feed   = config.feedRateXY   || 1000;
  const ap     = config.passDepth    || 1;

  /* 1) سماكة النحاتة chipload */
  const chip = feed / (rpm * flutes);
  const rec  = mat.recChipLoad || 0.02;
  if (chip < rec * 0.4) {
    tips.push(`سماكة النحاتة ${chip.toFixed(3)}mm منخفضة جداً (الموصى ~${rec}mm لمادة ${mat.name}) — ` +
      `الأداة تحتكّ بدل أن تقطع فتسخن وتتلف. ارفع التغذية إلى ~${Math.round(rec * rpm * flutes)}mm/min أو اخفض الدوران.`);
  } else if (chip > rec * 2.5) {
    tips.push(`سماكة النحاتة ${chip.toFixed(3)}mm مرتفعة (الموصى ~${rec}mm) — خطر كسر الأداة. ` +
      `اخفض التغذية إلى ~${Math.round(rec * rpm * flutes * 1.5)}mm/min أو ارفع الدوران.`);
  }

  /* 2) عمق الطبقة مقابل قطر الأداة */
  const maxAp = (MAX_AP_RATIO[matKey] ?? 0.5) * D;
  if (ap > maxAp * 1.05) {
    tips.push(`عمق الطبقة ${ap}mm كبير على أداة ⌀${D}mm في ${mat.name} — ` +
      `الموصى ≤ ${maxAp.toFixed(1)}mm. قسّم العمق على طبقات أكثر.`);
  }

  /* 3) سرعة السطح vc */
  const vc = (Math.PI * D * rpm) / 1000; // م/دقيقة
  const [vcMin, vcMax] = VC_RANGE[matKey] || VC_RANGE.generic;
  if (vc > vcMax * 1.3) {
    tips.push(`سرعة السطح ${Math.round(vc)}م/د أعلى من نطاق ${mat.name} (${vcMin}-${vcMax}) — ` +
      `اخفض الدوران إلى ~${Math.round((vcMax * 1000) / (Math.PI * D) / 500) * 500}RPM لإطالة عمر الأداة.`);
  } else if (vc < vcMin * 0.5 && rpm > 1000) {
    tips.push(`سرعة السطح ${Math.round(vc)}م/د منخفضة لأداة ⌀${D}mm — يمكن رفع الدوران لتشطيب أنظف.`);
  }

  /* 4) تغذية الغوص Z */
  const fz = config.feedRateZ || 300;
  if (fz > feed * 0.6) {
    tips.push(`تغذية الغوص Z (${fz}) قريبة من تغذية القطع — معظم الأدوات تتحمل غوصاً أبطأ بكثير. الموصى ≤ ${Math.round(feed / 3)}mm/min أو استخدم الهبوط المائل/الحلزوني.`);
  }

  /* 5) أشكال أصغر من قطر الأداة — لن تُقطع كما يتوقع المستخدم */
  const tooSmall = [];
  (shapes || []).forEach((s, i) => {
    if (!s || !s.type) return;
    const b = geometry.shapeBounds(s);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const minDim = s.type === 'circle' ? s.r * 2 : Math.min(w || Infinity, h || Infinity);
    if (minDim > 0 && minDim < D) tooSmall.push(i + 1);
  });
  if (tooSmall.length) {
    tips.push(`⚠ الأشكال رقم (${tooSmall.slice(0, 8).join('، ')}${tooSmall.length > 8 ? '…' : ''}) ` +
      `أصغر من قطر الأداة ⌀${D}mm — ستخرج بأبعاد خاطئة أو تختفي. استخدم أداة أرفع.`);
  }

  /* 6) مادة غير محددة */
  if (!config.material || config.material === 'generic') {
    tips.push('حدد نوع المادة من الإعدادات (خشب/ألمنيوم/أكريليك…) لتحصل على توصيات سرعات أدق.');
  }

  return tips;
}

module.exports = { analyze };
