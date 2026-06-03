/**
 * CuttingForceModel.js — نموذج أكثر دقة لتقدير حدود سرعة التغذية وقوى القطع
 * يدعم تأثير radial engagement (ae)، والتمييز بين slotting وprofiling.
 * الصيغة لا تغني عن اختبار عملي لكنها تحسّن توصيات السرعات.
 */

const geometry = require('../utils/geometry');
const materials = require('../utils/materials');

class CuttingForceModel {
  constructor(options = {}) {
    this.options = options || {};
  }

  // حساب radial engagement (ae) بالـ mm من الإعداد أو من stepover
  _resolveAE(shape, config = {}) {
    const toolD = config.toolDiameter || 3;
    let ae = config.radialEngagement;
    if (ae == null) {
      // استخدام stepover إن وُجد، أو افتراض نصف قطر الأداة
      const stepover = config.stepover || (toolD * 0.5);
      ae = Math.min(toolD, Math.max(0.001, stepover));
    }
    ae = Math.max(0.001, Math.min(ae, toolD));
    return ae;
  }

  // نوع العملية بناءً على نسبة المشاركة العرضية
  _engagementType(ae, toolD) {
    const ratio = ae / toolD;
    if (ratio >= 0.9) return 'slotting';
    if (ratio >= 0.3) return 'heavy profiling';
    return 'profiling';
  }

  // عامل تعقيد يعتمد على النسبة العرضية — يرفع القوة عند زيادة ae
  _engagementFactor(ae, toolD) {
    const r = ae / toolD; // 0..1
    // عامل متزايد بسرعة عند النسب الكبيرة (slotting)
    return 1 + 0.8 * Math.pow(r, 1.2);
  }

  /**
   * يقدّر أقصى feedRate (mm/min) بحيث لا تتجاوز قوة القطع الحد المسموح.
   * صيغة مشتقة من Ft = Kc * area * engagementFactor
   * حيث area ≈ ft * ap * (ae/toolD)
   */
  estimateMaxFeedRate(shape, config = {}) {
    const mat = materials[config.material] || materials.generic;
    const Kc = mat.Kc || materials.generic.Kc; // N/mm^2

    const toolD = config.toolDiameter || 3;
    const flutes = config.toolFlutes || 2;
    const rpm = config.spindleSpeed || 18000;
    const ap = Math.max(0.01, config.passDepth || 1); // mm axial depth per pass

    const ae = this._resolveAE(shape, config);
    const aeRatio = ae / toolD;
    const factor = this._engagementFactor(ae, toolD);

    const maxForce = config.maxCutForce || 300; // N (افتراضي)

    // صيغة: Ft = Kc * ft * ap * (ae/toolD) * factor
    // ft = feedRate / (rpm * flutes)
    // => feedRate = maxForce * rpm * flutes / (Kc * ap * (ae/toolD) * factor)
    const denom = Kc * ap * (aeRatio || 0.0001) * factor;
    const feedRateMax = Math.max(1, Math.round((maxForce * rpm * flutes) / denom));

    // لا نجعل المقدار أكبر من مثلاً 5x السرعة الأساسية كي لا نحصل على قيم شاذة
    const base = config.feedRateXY || 1000;
    return Math.max(1, Math.min(feedRateMax, base * 5));
  }

  /**
   * يقدّر قوى القطع (Ft, Fr) عند feedRate معطى
   */
  estimateCuttingForce(shape, config = {}, feedRate) {
    const mat = materials[config.material] || materials.generic;
    const Kc = mat.Kc || materials.generic.Kc;
    const flutes = config.toolFlutes || 2;
    const rpm = config.spindleSpeed || 18000;
    const ap = Math.max(0.01, config.passDepth || 1);

    const toolD = config.toolDiameter || 3;
    const ae = this._resolveAE(shape, config);
    const aeRatio = ae / toolD;
    const factor = this._engagementFactor(ae, toolD);

    const ft = feedRate / (rpm * flutes); // mm chip thickness per tooth

    // area of chip (relative): ft * ap * (ae/toolD)
    const area = ft * ap * aeRatio; // mm^2

    const Ft = Kc * area * factor; // tangential force (N)
    // تقريبي: القوة الشعاعية ترتبط بـ Ft وaeRatio
    const Fr = Ft * (0.2 + 0.6 * Math.pow(aeRatio, 1.1));

    return {
      Ft: Number(Ft.toFixed(2)),
      Fr: Number(Fr.toFixed(2)),
      ae: Number(ae.toFixed(3)),
      aeRatio: Number(aeRatio.toFixed(3)),
      engagement: this._engagementType(ae, toolD),
      area: Number(area.toFixed(6)),
      factor: Number(factor.toFixed(3)),
    };
  }
}

module.exports = CuttingForceModel;

