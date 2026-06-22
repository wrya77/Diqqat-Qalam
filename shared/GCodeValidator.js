/**
 * GCodeValidator.js — يفحص G-Code بحثاً عن أخطاء شائعة قبل الإرسال للآلة
 *
 * وحدة مشتركة (UMD) — المصدر الوحيد للحقيقة:
 *   الخادم  : require('./shared/GCodeValidator')
 *   المتصفح : window.GCodeValidator (نفس الكود حرفياً) — يتيح فحص الجاهزية محلياً
 *             دون رحلة شبكة إلى /api/validate-gcode (أسرع بكثير للملفات الكبيرة).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.GCodeValidator = factory();
    // اسم عام للتوافق مع الواجهة
    root.GCodeValidator = root.DQ.GCodeValidator;
  }
}(typeof self !== 'undefined' ? self : this, function () {

'use strict';

class GCodeValidator {
  constructor(machineConfig = {}) {
    this.limits = {
      x: machineConfig.travelX || Infinity,
      y: machineConfig.travelY || Infinity,
      z: machineConfig.travelZ || Infinity,
    };
  }

  validate(gcode) {
    const errors = [], warnings = [];
    const lines = gcode.split('\n');

    let spindleOn = false;
    let hasF = false;
    let lastF = 0;
    let pos = { x: 0, y: 0, z: 0 };
    let modalG = null;

    for (let i = 0; i < lines.length; i++) {
      const raw  = lines[i];
      const ln   = i + 1;
      const line = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').toUpperCase().trim();
      if (!line) continue;

      // Parse tokens
      const tokens = {};
      const re = /([A-Z])([-+]?\d*\.?\d+)/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        tokens[m[1]] = parseFloat(m[2]);
      }

      // Track position
      if (tokens.X !== undefined) pos.x = tokens.X;
      if (tokens.Y !== undefined) pos.y = tokens.Y;
      if (tokens.Z !== undefined) pos.z = tokens.Z;

      // Track feed rate
      if (tokens.F !== undefined) { lastF = tokens.F; hasF = true; }

      // Track spindle
      if (tokens.M === 3 || tokens.M === 4) spindleOn = true;
      if (tokens.M === 5) spindleOn = false;

      // Track modal G
      const g = tokens.G;
      if (g === 0 || g === 1 || g === 2 || g === 3) modalG = g;

      // G01/G02/G03 without F
      const activeG = g !== undefined ? g : modalG;
      if ((activeG === 1 || activeG === 2 || activeG === 3) && !hasF && lastF === 0) {
        errors.push({ line: ln, msg: `G0${activeG} بدون تغذية F (السطر: ${raw.trim()})` });
      }

      // Travel limit checks
      if (this.limits.x < Infinity && Math.abs(pos.x) > this.limits.x) {
        warnings.push({ line: ln, msg: `X=${pos.x.toFixed(2)} يتجاوز الحد (${this.limits.x}mm)` });
      }
      if (this.limits.y < Infinity && Math.abs(pos.y) > this.limits.y) {
        warnings.push({ line: ln, msg: `Y=${pos.y.toFixed(2)} يتجاوز الحد (${this.limits.y}mm)` });
      }
      if (this.limits.z < Infinity && pos.z < -this.limits.z) {
        warnings.push({ line: ln, msg: `Z=${pos.z.toFixed(2)} أعمق من حد Z (${this.limits.z}mm)` });
      }

      // G01 without spindle on
      if ((activeG === 1 || activeG === 2 || activeG === 3) && !spindleOn) {
        warnings.push({ line: ln, msg: `حركة قطع بدون تشغيل المغزل (M03/M04)` });
      }
    }

    // Check spindle state at end
    if (spindleOn) {
      warnings.push({ line: lines.length, msg: 'المغزل لا يزال يعمل في نهاية البرنامج (M05 مفقود؟)' });
    }

    return {
      valid:    errors.length === 0,
      errors,
      warnings,
      summary:  `${errors.length} خطأ, ${warnings.length} تحذير`,
    };
  }
}

return GCodeValidator;
}));
