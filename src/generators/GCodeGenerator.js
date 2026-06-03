/**
 * GCodeGenerator.js — المولّد الرئيسي للـ G-Code
 * يجمع HeaderGenerator + ToolpathGenerator في pipeline كامل
 */

const MachineConfig      = require('../core/MachineConfig');
const HeaderGenerator    = require('./HeaderGenerator');
const ToolpathGenerator  = require('./ToolpathGenerator');

class GCodeGenerator {
  constructor(configOrOptions = {}) {
    this.config = configOrOptions instanceof MachineConfig
      ? configOrOptions
      : new MachineConfig(configOrOptions);

    this._header   = new HeaderGenerator(this.config);
    this._toolpath = new ToolpathGenerator(this.config);
  }

  /**
   * توليد G-Code كامل
   * @param {Array} shapes - الأشكال المعالجة والمُرتَّبة
   * @returns {{ gcode: string, stats: Object }}
   */
  generate(shapes) {
    this._toolpath.resetStats();

    const allLines = [];

    // رأس الملف
    allLines.push(...this._header.header());

    // الطبقات
    const numPasses = this.config.numPasses;

    for (let pass = 1; pass <= numPasses; pass++) {
      const depth = -Math.min(pass * this.config.passDepth, this.config.totalDepth);

      if (this.config.addComments) {
        allLines.push('');
        allLines.push(`; ===== الطبقة ${pass}/${numPasses} — Z${depth.toFixed(3)} mm =====`);
      }

      shapes.forEach((shape, idx) => {
        if (this.config.addComments) {
          allLines.push(`; --- الشكل ${idx + 1}/${shapes.length}: ${shape.type} ---`);
        }
        const shapeLines = this._toolpath.generateShape(shape, depth);
        allLines.push(...shapeLines);
      });
    }

    // التذييل
    allLines.push('');
    allLines.push(...this._header.footer());

    // تطبيق أرقام الأسطر
    const finalLines = this._toolpath.applyLineNumbers(allLines);

    return {
      gcode: finalLines.join('\n'),
      stats: this._buildStats(),
    };
  }

  _buildStats() {
    const { feedRateXY, feedRateZ } = this.config;
    const s = this._toolpath.stats;

    const xyTime  = s.totalXY / feedRateXY;     // min
    const zTime   = s.totalZ  / feedRateZ;       // min
    const totalSec = (xyTime + zTime) * 60;

    const m = Math.floor(totalSec / 60);
    const sec = Math.round(totalSec % 60);

    return {
      estimatedTime: m > 0 ? `${m} دقيقة ${sec > 0 ? sec + ' ثانية' : ''}` : `${sec} ثانية`,
      totalXY:       s.totalXY.toFixed(1) + ' mm',
      totalZ:        s.totalZ.toFixed(1)  + ' mm',
      moves:         s.moves,
      lifts:         s.lifts,
      arcs:          s.arcs,
      passes:        this.config.numPasses,
      lines:         0, // يُحسب بعد join
    };
  }
}

if (typeof module !== 'undefined') module.exports = GCodeGenerator;
