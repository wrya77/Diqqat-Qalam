/**
 * MachineConfig.js — إعدادات الآلة مع قيم افتراضية وتحقق
 * وحدة مشتركة (UMD): الخادم يستوردها بـ require، والمتصفح عبر DQ.MachineConfig
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.MachineConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

const num = (v, fallback) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

class MachineConfig {
  constructor(overrides = {}) {
    this.units          = overrides.units          || 'mm';
    this.toolDiameter   = num(overrides.toolDiameter, 3);
    this.toolType       = overrides.toolType       || 'flat';
    this.toolFlutes     = num(overrides.toolFlutes, 2);
    this.toolNumber     = Math.max(1, Math.round(num(overrides.toolNumber, 1)));
    this.compensation   = overrides.compensation   || 'none';
    this.totalDepth     = num(overrides.totalDepth, 5);
    this.passDepth      = Math.max(0.01, num(overrides.passDepth, 1));
    this.safeHeight     = num(overrides.safeHeight, 5);
    this.feedRateXY     = num(overrides.feedRateXY, 1000);
    this.feedRateZ      = num(overrides.feedRateZ, 300);
    this.spindleSpeed   = num(overrides.spindleSpeed, 18000);
    this.maxCutForce    = num(overrides.maxCutForce, 300); // N — حد تقديري لقوة القطع
    this.material       = overrides.material       || 'generic';
    // قبول cw/CW/ccw/CCW
    this.spindleDir     = String(overrides.spindleDir || 'CW').toUpperCase();
    this.origin         = overrides.origin         || 'bottom-left';
    this.coordSystem    = overrides.coordSystem    || 'G54';
    this.plungeStrategy = overrides.plungeStrategy || 'straight'; // straight / ramp / helical
    this.rampAngle      = num(overrides.rampAngle, 3);
    this.arcDetect      = overrides.arcDetect      !== false;
    this.addComments    = overrides.addComments    !== false;
    this.lineNumbers    = overrides.lineNumbers    || false;
    this.lineNumberStep = num(overrides.lineNumberStep, 10);
    this.coolant        = overrides.coolant        || false;
    this.retractMode    = overrides.retractMode    || 'safe';  // safe / rapid
  }

  get numPasses() {
    return Math.max(1, Math.ceil(this.totalDepth / this.passDepth));
  }

  get spindleCode() {
    return this.spindleDir === 'CCW' ? 'M04' : 'M03';
  }

  toJSON() {
    return {
      units: this.units, toolDiameter: this.toolDiameter, toolType: this.toolType,
      toolFlutes: this.toolFlutes, toolNumber: this.toolNumber,
      material: this.material, maxCutForce: this.maxCutForce,
      compensation: this.compensation, totalDepth: this.totalDepth,
      passDepth: this.passDepth, safeHeight: this.safeHeight,
      feedRateXY: this.feedRateXY, feedRateZ: this.feedRateZ,
      spindleSpeed: this.spindleSpeed, spindleDir: this.spindleDir,
      origin: this.origin, coordSystem: this.coordSystem,
      plungeStrategy: this.plungeStrategy, rampAngle: this.rampAngle,
      arcDetect: this.arcDetect, addComments: this.addComments,
      lineNumbers: this.lineNumbers, coolant: this.coolant,
    };
  }

  toObject() {
    return this.toJSON();
  }

  // قوالب جاهزة
  static woodRouting() {
    return new MachineConfig({
      toolDiameter: 6, toolType: 'flat',
      totalDepth: 18, passDepth: 3,
      feedRateXY: 2000, feedRateZ: 500, spindleSpeed: 18000,
    });
  }

  static aluminumMilling() {
    return new MachineConfig({
      toolDiameter: 4, toolType: 'flat',
      totalDepth: 5, passDepth: 0.5,
      feedRateXY: 400, feedRateZ: 100, spindleSpeed: 12000,
      coolant: true,
    });
  }

  static pcbEngraving() {
    return new MachineConfig({
      toolDiameter: 0.2, toolType: 'vbit',
      totalDepth: 0.1, passDepth: 0.1,
      feedRateXY: 300, feedRateZ: 80, spindleSpeed: 30000,
    });
  }

  static laserCutting() {
    return new MachineConfig({
      toolDiameter: 0, toolType: 'laser',
      totalDepth: 0, passDepth: 0,
      feedRateXY: 3000, feedRateZ: 1000, spindleSpeed: 0,
    });
  }

  static getProfiles() {
    return {
      generic:   { name: 'Generic CNC',          feedRateXY: 1000, feedRateZ: 300, spindleSpeed: 18000 },
      ncstudio:  { name: 'NcStudio / Weihong',   feedRateXY: 2500, feedRateZ: 600, spindleSpeed: 18000 },
      richauto:  { name: 'RichAuto DSP',         feedRateXY: 2500, feedRateZ: 600, spindleSpeed: 18000 },
      syntec:    { name: 'Syntec',               feedRateXY: 2000, feedRateZ: 500, spindleSpeed: 15000 },
      grbl:      { name: 'GRBL',                 feedRateXY: 800,  feedRateZ: 200, spindleSpeed: 12000 },
      mach3:     { name: 'Mach3',                feedRateXY: 1500, feedRateZ: 500, spindleSpeed: 24000 },
      mach4:     { name: 'Mach4',                feedRateXY: 1500, feedRateZ: 500, spindleSpeed: 24000 },
      linuxcnc:  { name: 'LinuxCNC',             feedRateXY: 1500, feedRateZ: 400, spindleSpeed: 18000 },
      fanuc:     { name: 'Fanuc',                feedRateXY: 2000, feedRateZ: 500, spindleSpeed: 8000  },
      sinumerik: { name: 'Siemens Sinumerik',    feedRateXY: 2000, feedRateZ: 500, spindleSpeed: 8000  },
      haas:      { name: 'HAAS',                 feedRateXY: 3000, feedRateZ: 800, spindleSpeed: 6000  },
      wood:      { name: 'Wood Routing',         feedRateXY: 2000, feedRateZ: 500, spindleSpeed: 18000 },
      aluminum:  { name: 'Aluminum Milling',     feedRateXY: 400,  feedRateZ: 100, spindleSpeed: 12000 },
      pcb:       { name: 'PCB Engraving',        feedRateXY: 300,  feedRateZ: 80,  spindleSpeed: 30000 },
      laser:     { name: 'Laser Cutting',        feedRateXY: 3000, feedRateZ: 1000, spindleSpeed: 0    },
    };
  }
}

return MachineConfig;
}));
