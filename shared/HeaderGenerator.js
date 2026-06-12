/**
 * HeaderGenerator.js — مولّد رأس وتذييل ملف G-Code
 * وحدة مشتركة (UMD): الخادم يستوردها بـ require، والمتصفح عبر DQ.HeaderGenerator
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.HeaderGenerator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

class HeaderGenerator {
  constructor(config) {
    this.config = config;
  }

  /**
   * توليد رأس الملف
   * @returns {string[]} مصفوفة أسطر
   */
  header() {
    const { config: c } = this;
    const lines = [];
    const ts = new Date().toLocaleString('ar-IQ');

    if (c.addComments) {
      lines.push('; ================================================');
      lines.push('; Diqqat Qalam (دقة قلم) — الكود مولَّد تلقائياً');
      lines.push(`; التاريخ    : ${ts}`);
      lines.push(`; الوحدات   : ${c.units === 'mm' ? 'ميلليمتر' : 'إنش'}`);
      lines.push(`; الأداة    : ⌀${c.toolDiameter}mm | ${c.toolType}`);
      lines.push(`; العمق     : ${c.totalDepth}mm (${c.numPasses} طبقة × ${c.passDepth}mm)`);
      lines.push(`; التغذية   : XY=${c.feedRateXY} Z=${c.feedRateZ} mm/min`);
      lines.push(`; الدوران   : ${c.spindleSpeed} RPM`);
      lines.push('; ================================================');
    }

    lines.push(c.units === 'mm' ? 'G21' : 'G20');
    if (c.addComments) lines[lines.length - 1] += '; الوحدات';

    lines.push('G90');
    if (c.addComments) lines[lines.length - 1] += '; إحداثيات مطلقة';

    lines.push('G17');
    if (c.addComments) lines[lines.length - 1] += '; مستوى XY';

    lines.push('G94');
    if (c.addComments) lines[lines.length - 1] += '; معدل تغذية mm/min';

    // نظام الإحداثيات المختار (G54..G59)
    if (c.coordSystem) {
      lines.push(c.coordSystem);
      if (c.addComments) lines[lines.length - 1] += '; نظام الإحداثيات';
    }

    // تغيير الأداة
    if (c.toolNumber) {
      const T = String(c.toolNumber).padStart(2, '0');
      lines.push(`T${T} M06`);
      if (c.addComments) lines[lines.length - 1] += `; تغيير الأداة T${T}`;
    }

    // D = رقم سجل التعويض في المتحكم (وليس نصف القطر!) — العرف: نفس رقم الأداة
    if (c.compensation === 'left') {
      lines.push(`G41 D${c.toolNumber || 1}`);
      if (c.addComments) lines[lines.length - 1] += '; تعويض أداة يسار';
    } else if (c.compensation === 'right') {
      lines.push(`G42 D${c.toolNumber || 1}`);
      if (c.addComments) lines[lines.length - 1] += '; تعويض أداة يمين';
    }

    lines.push(`${c.spindleCode} S${c.spindleSpeed}`);
    if (c.addComments) lines[lines.length - 1] += '; تشغيل المغزل';

    if (c.coolant) {
      lines.push('M08');
      if (c.addComments) lines[lines.length - 1] += '; تشغيل سائل التبريد';
    }

    lines.push('G04 P2');
    if (c.addComments) lines[lines.length - 1] += '; انتظار تسريع المغزل';

    lines.push(`G00 Z${c.safeHeight.toFixed(3)}`);
    if (c.addComments) lines[lines.length - 1] += '; رفع للارتفاع الآمن';

    return lines;
  }

  /**
   * توليد تذييل الملف
   */
  footer() {
    const { config: c } = this;
    const lines = [];

    if (c.addComments) lines.push('; ===== نهاية البرنامج =====');

    lines.push(`G00 Z${c.safeHeight.toFixed(3)}`);
    if (c.addComments) lines[lines.length - 1] += '; رفع نهائي للارتفاع الآمن';

    // إلغاء التعويض قبل حركة العودة — وإلا فُسّرت حركة العودة بمسار معوَّض
    if (c.compensation !== 'none') {
      lines.push('G40');
      if (c.addComments) lines[lines.length - 1] += '; إلغاء تعويض الأداة';
    }

    lines.push('G00 X0.000 Y0.000');
    if (c.addComments) lines[lines.length - 1] += '; العودة للموضع الصفري';

    if (c.coolant) {
      lines.push('M09');
      if (c.addComments) lines[lines.length - 1] += '; إيقاف سائل التبريد';
    }

    lines.push('M05');
    if (c.addComments) lines[lines.length - 1] += '; إيقاف المغزل';

    lines.push('M30');
    if (c.addComments) lines[lines.length - 1] += '; نهاية البرنامج';

    return lines;
  }

  /**
   * تغيير الأداة أثناء التشغيل
   */
  toolChange(toolNum, toolDiameter, comment = '') {
    const { config: c } = this;
    const lines = [];

    if (c.addComments) lines.push(`; ----- تغيير الأداة T${toolNum} -----`);

    lines.push(`G00 Z${(c.safeHeight + 50).toFixed(3)}`);
    lines.push(`M05`);
    lines.push(`M06 T${toolNum}`);
    if (c.addComments && comment) lines[lines.length - 1] += `; ${comment}`;
    lines.push(`G43 H${toolNum}`);
    if (c.addComments) lines[lines.length - 1] += '; تعويض طول الأداة';
    lines.push(`${c.spindleCode} S${c.spindleSpeed}`);
    lines.push('G04 P2');

    return lines;
  }
}

return HeaderGenerator;
}));
