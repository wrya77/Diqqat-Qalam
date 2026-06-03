/**
 * validator.js — التحقق من صحة الإدخالات
 */

const validator = {
  // التحقق من إعدادات المطبعة
  validateConfig(config) {
    const errors = [];

    if (!config) { errors.push('الإعدادات مفقودة'); return errors; }

    if (config.toolDiameter <= 0)  errors.push('قطر الأداة يجب أن يكون أكبر من 0');
    if (config.totalDepth <= 0)    errors.push('العمق الكلي يجب أن يكون أكبر من 0');
    if (config.passDepth <= 0)     errors.push('عمق الطبقة يجب أن يكون أكبر من 0');
    if (config.passDepth > config.totalDepth)
      errors.push('عمق الطبقة أكبر من العمق الكلي');
    if (config.safeHeight <= 0)    errors.push('ارتفاع السلامة يجب أن يكون أكبر من 0');
    if (config.feedRateXY <= 0)    errors.push('سرعة التغذية XY يجب أن تكون أكبر من 0');
    if (config.feedRateZ <= 0)     errors.push('سرعة التغذية Z يجب أن تكون أكبر من 0');
    if (config.spindleSpeed <= 0)  errors.push('سرعة الدوران يجب أن تكون أكبر من 0');
    if (!['mm', 'inch'].includes(config.units))
      errors.push('الوحدة يجب أن تكون mm أو inch');

    return errors;
  },

  // التحقق من قائمة الأشكال
  validateShapes(shapes) {
    const errors = [];

    if (!Array.isArray(shapes))       { errors.push('الأشكال يجب أن تكون مصفوفة'); return errors; }
    if (shapes.length === 0)          errors.push('لا توجد أشكال للمعالجة');

    shapes.forEach((shape, i) => {
      const shapeErrors = this.validateShape(shape);
      shapeErrors.forEach(e => errors.push(`الشكل ${i + 1}: ${e}`));
    });

    return errors;
  },

  // التحقق من شكل واحد
  validateShape(shape) {
    const errors = [];
    if (!shape || !shape.type) { errors.push('نوع الشكل مفقود'); return errors; }

    switch (shape.type) {
      case 'line':
        if (shape.x1 === undefined || shape.y1 === undefined ||
            shape.x2 === undefined || shape.y2 === undefined)
          errors.push('إحداثيات الخط غير مكتملة');
        break;
      case 'rect':
        if (shape.x === undefined || shape.y === undefined)
          errors.push('موضع المستطيل غير مكتمل');
        if (!shape.w || !shape.h || shape.w <= 0 || shape.h <= 0)
          errors.push('أبعاد المستطيل غير صحيحة');
        break;
      case 'circle':
        if (shape.cx === undefined || shape.cy === undefined)
          errors.push('مركز الدائرة غير مكتمل');
        if (!shape.r || shape.r <= 0)
          errors.push('نصف قطر الدائرة غير صحيح');
        break;
      case 'arc':
        if (shape.cx === undefined || shape.cy === undefined)
          errors.push('مركز القوس غير مكتمل');
        if (!shape.r || shape.r <= 0)
          errors.push('نصف قطر القوس غير صحيح');
        break;
      case 'polyline':
        if (!Array.isArray(shape.points) || shape.points.length < 2)
          errors.push('الخط المتعدد يحتاج نقطتين على الأقل');
        break;
      default:
        errors.push(`نوع الشكل غير مدعوم: ${shape.type}`);
    }

    return errors;
  },

  // تقرير التحقق
  report(configErrors, shapeErrors) {
    const all = [...configErrors, ...shapeErrors];
    return {
      valid:  all.length === 0,
      errors: all,
      summary: all.length === 0
        ? '✅ جميع البيانات صحيحة'
        : `❌ ${all.length} خطأ في البيانات`,
    };
  },
};

if (typeof module !== 'undefined') module.exports = validator;
