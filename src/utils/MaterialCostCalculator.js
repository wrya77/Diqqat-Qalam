'use strict';
/**
 * MaterialCostCalculator.js — حاسبة تكلفة المواد الخام الأوتوماتيكية
 * تحسب الكميات المطلوبة والتكلفة الكاملة لأي مشروع CNC.
 */

const MATERIALS = {
  wood: {
    nameAr:        'خشب',
    pricePerM2:    15,    // دولار / م²
    pricePerKg:    2,
    density:       0.6,   // g/cm³
    wasteFactor:   1.15,  // 15% هدر
    commonSizes:   [{ w: 1220, h: 2440, thickness: 18 }, { w: 600, h: 1200, thickness: 12 }],
  },
  aluminum: {
    nameAr:        'ألومنيوم',
    pricePerKg:    3,
    density:       2.7,
    wasteFactor:   1.10,
    commonSizes:   [{ w: 1000, h: 2000, thickness: 3 }, { w: 500, h: 1000, thickness: 6 }],
  },
  steel: {
    nameAr:        'فولاذ',
    pricePerKg:    1.5,
    density:       7.85,
    wasteFactor:   1.08,
    commonSizes:   [{ w: 1000, h: 2000, thickness: 2 }],
  },
  brass: {
    nameAr:        'نحاس أصفر',
    pricePerKg:    8,
    density:       8.5,
    wasteFactor:   1.05,
    commonSizes:   [{ w: 500, h: 500, thickness: 3 }],
  },
  plastic: {
    nameAr:        'بلاستيك',
    pricePerKg:    4,
    density:       1.2,
    wasteFactor:   1.12,
    commonSizes:   [{ w: 1220, h: 2440, thickness: 6 }],
  },
  acrylic: {
    nameAr:        'أكريليك',
    pricePerKg:    7,
    density:       1.19,
    wasteFactor:   1.12,
    commonSizes:   [{ w: 1200, h: 2400, thickness: 5 }],
  },
  pcb: {
    nameAr:        'PCB',
    pricePerKg:    25,
    density:       1.85,
    wasteFactor:   1.20,
    commonSizes:   [{ w: 100, h: 150, thickness: 1.6 }],
  },
};

class MaterialCostCalculator {
  getMaterials() {
    return Object.entries(MATERIALS).map(([id, m]) => ({ id, ...m }));
  }

  calculate(params) {
    const {
      material     = 'generic',
      dimensions   = { width: 100, height: 100, thickness: 10 },
      quantity     = 1,
      shapes       = [],
    } = params;

    const mat = MATERIALS[material] || MATERIALS.aluminum;

    const rawVolumeCm3 = (dimensions.width / 10) * (dimensions.height / 10) * (dimensions.thickness / 10);
    const rawWeightKg  = (rawVolumeCm3 * mat.density) / 1000;
    const materialCostRaw = rawWeightKg * mat.pricePerKg;
    const withWaste       = materialCostRaw * mat.wasteFactor;
    const totalMaterial   = withWaste * quantity;

    const boundingBox    = this._getBoundingBox(shapes);
    const utilization    = boundingBox ? this._calcUtilization(boundingBox, dimensions) : 0;

    const bestStock = this._recommendStock(mat, dimensions);

    return {
      material:       material,
      materialNameAr: mat.nameAr || material,
      dimensions,
      quantity,
      rawWeight:      +rawWeightKg.toFixed(3),
      wastedWeight:   +((rawWeightKg * mat.wasteFactor) - rawWeightKg).toFixed(3),
      costPerUnit:    +withWaste.toFixed(2),
      totalCost:      +totalMaterial.toFixed(2),
      utilization:    utilization ? +utilization.toFixed(1) : null,
      recommendedStock: bestStock,
      currency:       'USD',
      pricePerKg:     mat.pricePerKg,
    };
  }

  optimizeNesting(parts, stockSheet, material = 'generic') {
    if (!parts.length) return { utilization: 0, partsPerSheet: 0 };

    const stock   = stockSheet || (MATERIALS[material] || MATERIALS.aluminum).commonSizes[0];
    const stockArea = stock.w * stock.h;
    let placed = 0, usedArea = 0;

    for (const part of parts) {
      const partArea = (part.w || 100) * (part.h || 100);
      if (usedArea + partArea <= stockArea * 0.85) {
        placed++;
        usedArea += partArea;
      }
    }

    return {
      partsPerSheet:  placed,
      utilization:    +((usedArea / stockArea) * 100).toFixed(1),
      sheetsNeeded:   Math.ceil(parts.length / Math.max(1, placed)),
      stockDimensions: stock,
    };
  }

  _getBoundingBox(shapes) {
    if (!shapes || !shapes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes) {
      const pts = s.points || [{ x: s.x || s.cx || 0, y: s.y || s.cy || 0 }];
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
    }
    return { width: maxX - minX, height: maxY - minY };
  }

  _calcUtilization(bbox, stock) {
    const bboxArea  = bbox.width * bbox.height;
    const stockArea = stock.width * stock.height;
    if (!stockArea) return 0;
    return (bboxArea / stockArea) * 100;
  }

  _recommendStock(mat, dims) {
    const sizes = mat.commonSizes || [];
    return sizes.find(s => s.w >= dims.width && s.h >= dims.height) || null;
  }
}

module.exports = MaterialCostCalculator;
