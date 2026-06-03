/**
 * units.js — تحويل الوحدات بين ميلليمتر وإنش
 */

const MM_PER_INCH = 25.4;

const units = {
  mmToInch(mm)   { return mm / MM_PER_INCH; },
  inchToMm(inch) { return inch * MM_PER_INCH; },

  // تحويل قيمة حسب الوحدة المستهدفة
  convert(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) return value;
    if (fromUnit === 'mm' && toUnit === 'inch') return this.mmToInch(value);
    if (fromUnit === 'inch' && toUnit === 'mm') return this.inchToMm(value);
    return value;
  },

  // تحويل شكل كامل
  convertShape(shape, fromUnit, toUnit) {
    if (fromUnit === toUnit) return shape;
    const s = c => this.convert(c, fromUnit, toUnit);
    const clone = JSON.parse(JSON.stringify(shape));

    switch (clone.type) {
      case 'line':
        clone.x1 = s(clone.x1); clone.y1 = s(clone.y1);
        clone.x2 = s(clone.x2); clone.y2 = s(clone.y2);
        break;
      case 'rect':
        clone.x = s(clone.x); clone.y = s(clone.y);
        clone.w = s(clone.w); clone.h = s(clone.h);
        break;
      case 'circle': case 'arc':
        clone.cx = s(clone.cx); clone.cy = s(clone.cy); clone.r = s(clone.r);
        break;
      case 'polyline':
        clone.points = clone.points.map(p => ({ x: s(p.x), y: s(p.y) }));
        break;
    }
    return clone;
  },

  // تحويل مجموعة أشكال
  convertShapes(shapes, fromUnit, toUnit) {
    return shapes.map(s => this.convertShape(s, fromUnit, toUnit));
  },

  // تنسيق عرض
  format(value, unit, decimals = 3) {
    return `${value.toFixed(decimals)} ${unit}`;
  },

  // رمز G-Code للوحدة
  gcode(unit) {
    return unit === 'inch' ? 'G20' : 'G21';
  },
};

if (typeof module !== 'undefined') module.exports = units;
