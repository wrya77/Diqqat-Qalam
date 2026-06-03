/**
 * HeaderGenerator.js — مولّد رأس وتذييل ملف G-Code
 */

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

    if (c.compensation === 'left') {
      lines.push(`G41 D${(c.toolDiameter / 2).toFixed(3)}`);
      if (c.addComments) lines[lines.length - 1] += '; تعويض أداة يسار';
    } else if (c.compensation === 'right') {
      lines.push(`G42 D${(c.toolDiameter / 2).toFixed(3)}`);
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

    lines.push('G00 X0.000 Y0.000');
    if (c.addComments) lines[lines.length - 1] += '; العودة للموضع الصفري';

    if (c.compensation !== 'none') {
      lines.push('G40');
      if (c.addComments) lines[lines.length - 1] += '; إلغاء تعويض الأداة';
    }

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
   * تغيير الأداة
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

if (typeof module !== 'undefined') module.exports = HeaderGenerator;
