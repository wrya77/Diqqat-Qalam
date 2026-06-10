'use strict';
/**
 * CostEstimator.js — حاسبة التكلفة الأوتوماتيكية وإنشاء عروض الأسعار
 * تحسب تكلفة المواد + وقت الماكينة + ربح المشغّل.
 */

class CostEstimator {
  constructor(rates = {}) {
    this.rates = {
      machineHourlyRate: rates.machineHourlyRate || 50,   // دولار/ساعة
      operatorHourlyRate: rates.operatorHourlyRate || 20, // دولار/ساعة
      overhead: rates.overhead || 1.25,                   // معامل مصاريف إضافية
      profitMargin: rates.profitMargin || 0.30,           // هامش ربح 30%
      setupTime: rates.setupTime || 15,                   // دقائق إعداد
      currency: rates.currency || 'USD',
    };

    this.materialPrices = {
      wood:      { pricePerKg: 2,   density: 0.6  },
      aluminum:  { pricePerKg: 3,   density: 2.7  },
      steel:     { pricePerKg: 1.5, density: 7.85 },
      brass:     { pricePerKg: 8,   density: 8.5  },
      plastic:   { pricePerKg: 4,   density: 1.2  },
      generic:   { pricePerKg: 3,   density: 2.7  },
    };
  }

  estimate(params) {
    const {
      gcode,
      stats,
      material      = 'generic',
      stockDimensions = { x: 100, y: 100, z: 20 },
      toolDiameter   = 6,
      quantity       = 1,
    } = params;

    const machineTimeMin   = this._extractMachineTime(stats, gcode);
    const totalTimeMin     = machineTimeMin + this.rates.setupTime;
    const machineTimeCost  = (totalTimeMin / 60) * this.rates.machineHourlyRate;
    const operatorTimeCost = (this.rates.setupTime / 60) * this.rates.operatorHourlyRate;
    const materialCost     = this._calcMaterialCost(material, stockDimensions);
    const toolWearCost     = this._calcToolWear(gcode, toolDiameter);

    const subtotal  = (machineTimeCost + operatorTimeCost + materialCost + toolWearCost) * quantity;
    const withOH    = subtotal * this.rates.overhead;
    const total     = withOH * (1 + this.rates.profitMargin);

    return {
      breakdown: {
        machineTime:   { minutes: machineTimeMin, cost: +machineTimeCost.toFixed(2) },
        setupTime:     { minutes: this.rates.setupTime, cost: +operatorTimeCost.toFixed(2) },
        material:      { material, dimensions: stockDimensions, cost: +materialCost.toFixed(2) },
        toolWear:      { cost: +toolWearCost.toFixed(2) },
        quantity,
      },
      subtotal:      +subtotal.toFixed(2),
      overhead:      +(withOH - subtotal).toFixed(2),
      profit:        +(total - withOH).toFixed(2),
      total:         +total.toFixed(2),
      currency:      this.rates.currency,
      pricePerUnit:  +(total / quantity).toFixed(2),
      generatedAt:   new Date().toISOString(),
    };
  }

  generateQuote(estimate, clientInfo = {}) {
    const lines = [
      '═══════════════════════════════════════',
      '         عرض سعر — دقة قلم CNC         ',
      '═══════════════════════════════════════',
      `التاريخ: ${new Date().toLocaleDateString('ar-EG')}`,
      `رقم العرض: Q-${Date.now()}`,
      '',
      `العميل: ${clientInfo.name || 'غير محدد'}`,
      `المشروع: ${clientInfo.project || 'CNC Job'}`,
      '',
      '─── تفاصيل التكلفة ───────────────────',
      `وقت الآلة (${estimate.breakdown.machineTime.minutes} دقيقة):   ${estimate.breakdown.machineTime.cost} ${estimate.currency}`,
      `وقت الإعداد (${estimate.breakdown.setupTime.minutes} دقيقة):   ${estimate.breakdown.setupTime.cost} ${estimate.currency}`,
      `المواد الخام (${estimate.breakdown.material.material}):         ${estimate.breakdown.material.cost} ${estimate.currency}`,
      `استهلاك الأداة:                       ${estimate.breakdown.toolWear.cost} ${estimate.currency}`,
      `المصاريف الإضافية:                    ${estimate.overhead} ${estimate.currency}`,
      `هامش الربح:                           ${estimate.profit} ${estimate.currency}`,
      '─────────────────────────────────────',
      `الكمية: × ${estimate.breakdown.quantity}`,
      `سعر الوحدة: ${estimate.pricePerUnit} ${estimate.currency}`,
      `الإجمالي: ${estimate.total} ${estimate.currency}`,
      '═══════════════════════════════════════',
      'دقة قلم — برنامج توليد G-Code الاحترافي',
    ];
    return lines.join('\n');
  }

  updateRates(newRates) {
    Object.assign(this.rates, newRates);
  }

  _extractMachineTime(stats, gcode) {
    if (stats && stats.estimatedTime) return stats.estimatedTime;
    if (!gcode) return 10;
    const lines = gcode.split('\n').filter(l => l.trim());
    return Math.max(5, lines.length * 0.05);
  }

  _calcMaterialCost(material, dims) {
    const info = this.materialPrices[material] || this.materialPrices.generic;
    const volumeCm3 = (dims.x * dims.y * dims.z) / 1000;
    const weightKg  = (volumeCm3 * info.density) / 1000;
    return weightKg * info.pricePerKg;
  }

  _calcToolWear(gcode, toolDiameter) {
    if (!gcode) return 0;
    const moves = (gcode.match(/G0[01]/g) || []).length;
    const wearFactor = toolDiameter >= 6 ? 0.001 : 0.003;
    return moves * wearFactor;
  }
}

module.exports = CostEstimator;
