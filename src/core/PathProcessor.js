/**
 * PathProcessor.js — المعالج الأساسي للمسارات
 * يربط جميع مراحل المعالجة من الأشكال الخام حتى G-Code
 */

const geometry      = require('../utils/geometry');
const units         = require('../utils/units');
const validator     = require('../utils/validator');
const MachineConfig = require('./MachineConfig');

class PathProcessor {
  constructor(config = {}) {
    this.config = config instanceof MachineConfig
      ? config
      : new MachineConfig(config);
  }

  /**
   * المعالجة الكاملة: أشكال → G-Code جاهز
   * @param {Array} rawShapes - الأشكال من المحرر أو المحلل
   * @returns {{ gcode, stats, errors, warnings }}
   */
  process(rawShapes) {
    const errors   = [];
    const warnings = [];

    // 1. التحقق من الصحة
    const configErrors = validator.validateConfig(this.config);
    const shapeErrors  = validator.validateShapes(rawShapes);
    errors.push(...configErrors, ...shapeErrors);

    if (errors.length > 0) {
      return { gcode: '', stats: null, errors, warnings };
    }

    // 2. تحويل الوحدات إذا لزم
    let shapes = rawShapes;
    // (الأشكال دائماً بـ mm داخلياً؛ التحويل للـ G-Code يحدث في المولّد)

    // 3. تصفية الأشكال الصغيرة جداً
    const minLen = 0.001;
    shapes = shapes.filter(s => {
      const len = geometry.shapeLength(s);
      if (len < minLen) {
        warnings.push(`تم تجاهل شكل طوله ${len.toFixed(4)} mm (أصغر من الحد الأدنى)`);
        return false;
      }
      return true;
    });

    // 4. التحقق من الحدود إذا حُدّدت
    const boundsWarnings = this._checkBounds(shapes);
    warnings.push(...boundsWarnings);

    // 5. إرجاع الأشكال المعالجة جاهزة للمحسّن والمولّد
    return { shapes, errors, warnings };
  }

  // حساب إحصائيات المسار
  calcStats(shapes) {
    let totalLength = 0;
    let shapeCount  = { line: 0, rect: 0, circle: 0, arc: 0, polyline: 0, other: 0 };

    shapes.forEach(s => {
      totalLength += geometry.shapeLength(s);
      shapeCount[s.type] = (shapeCount[s.type] || 0) + 1;
    });

    const passes   = this.config.numPasses;
    const cuttingLen = totalLength * passes;
    const cuttingTime = cuttingLen / this.config.feedRateXY;  // minutes

    return {
      shapeCount,
      totalShapes:  shapes.length,
      totalLength:  totalLength.toFixed(2) + ' mm',
      passes,
      cuttingLength: cuttingLen.toFixed(2) + ' mm',
      estimatedCuttingTime: this._formatTime(cuttingTime * 60),
    };
  }

  // التحقق من تجاوز حدود الآلة (إن حُدّدت)
  _checkBounds(shapes) {
    const { travelX, travelY, travelZ, totalDepth } = this.config;
    if (!travelX && !travelY) return [];
    const warnings = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    shapes.forEach(s => {
      const bounds = geometry.shapeBounds(s);
      if (!bounds) return;
      minX = Math.min(minX, bounds.x);
      maxX = Math.max(maxX, bounds.x + (bounds.w || 0));
      minY = Math.min(minY, bounds.y);
      maxY = Math.max(maxY, bounds.y + (bounds.h || 0));
    });

    if (travelX && (maxX - minX) > travelX)
      warnings.push(`⚠️ عرض التصميم ${(maxX - minX).toFixed(1)}mm يتجاوز حد الآلة X=${travelX}mm`);
    if (travelY && (maxY - minY) > travelY)
      warnings.push(`⚠️ ارتفاع التصميم ${(maxY - minY).toFixed(1)}mm يتجاوز حد الآلة Y=${travelY}mm`);
    if (travelZ && totalDepth > travelZ)
      warnings.push(`⚠️ العمق الكلي ${totalDepth}mm يتجاوز حد الآلة Z=${travelZ}mm`);

    return warnings;
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m === 0) return `${s} ثانية`;
    return `${m} دقيقة ${s > 0 ? s + ' ثانية' : ''}`;
  }
}

if (typeof module !== 'undefined') module.exports = PathProcessor;
