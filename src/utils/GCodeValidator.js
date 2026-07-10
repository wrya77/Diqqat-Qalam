'use strict';

/**
 * GCodeValidator — validates G-code for common errors before sending to machine
 */
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

      // Track position — and whether THIS line actually commands motion.
      // Cutting checks must only fire on real moves, otherwise the modal G
      // (which persists) would flag every following non-motion line (M05,
      // S-word, comments…) as a duplicate error.
      const hasMotion = tokens.X !== undefined || tokens.Y !== undefined || tokens.Z !== undefined;
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

      const activeG   = g !== undefined ? g : modalG;
      const isCutting = (activeG === 1 || activeG === 2 || activeG === 3) && hasMotion;

      // Cutting move without any feed rate
      if (isCutting && !hasF && lastF === 0) {
        errors.push({ line: ln, msg: `G0${activeG} بدون تغذية F (السطر: ${raw.trim()})` });
      }

      // Travel limit checks — only on lines that actually move
      if (hasMotion) {
        if (this.limits.x < Infinity && Math.abs(pos.x) > this.limits.x) {
          warnings.push({ line: ln, msg: `X=${pos.x.toFixed(2)} يتجاوز الحد (${this.limits.x}mm)` });
        }
        if (this.limits.y < Infinity && Math.abs(pos.y) > this.limits.y) {
          warnings.push({ line: ln, msg: `Y=${pos.y.toFixed(2)} يتجاوز الحد (${this.limits.y}mm)` });
        }
        if (this.limits.z < Infinity && pos.z < -this.limits.z) {
          warnings.push({ line: ln, msg: `Z=${pos.z.toFixed(2)} أعمق من حد Z (${this.limits.z}mm)` });
        }
      }

      // Cutting move without the spindle running
      if (isCutting && !spindleOn) {
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

module.exports = GCodeValidator;
