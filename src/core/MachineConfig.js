/**
 * MachineConfig.js — إعدادات المطبعة مع قيم افتراضية وتحقق
 */

class MachineConfig {
  constructor(overrides = {}) {
    this.units          = overrides.units          || 'mm';
    this.toolDiameter   = overrides.toolDiameter   || 3;
    this.toolType       = overrides.toolType       || 'flat';
    this.toolFlutes     = overrides.toolFlutes     || 2;
    this.compensation   = overrides.compensation   || 'none';
    this.totalDepth     = overrides.totalDepth     || 5;
    this.passDepth      = overrides.passDepth      || 1;
    this.safeHeight     = overrides.safeHeight     || 5;
    this.feedRateXY     = overrides.feedRateXY     || 1000;
    this.feedRateZ      = overrides.feedRateZ      || 300;
    this.spindleSpeed   = overrides.spindleSpeed   || 18000;
    this.maxCutForce    = overrides.maxCutForce    || 300; // N — حد تقديري لقوة القطع
    this.material       = overrides.material       || 'generic';
    this.spindleDir     = overrides.spindleDir     || 'CW';    // CW / CCW
    this.origin         = overrides.origin         || 'bottom-left';
    this.arcDetect      = overrides.arcDetect      !== false;
    this.addComments    = overrides.addComments    !== false;
    this.lineNumbers    = overrides.lineNumbers    || false;
    this.lineNumberStep = overrides.lineNumberStep || 10;
    this.coolant        = overrides.coolant        || false;
    this.retractMode    = overrides.retractMode    || 'safe';  // safe / rapid
  }

  get numPasses() {
    return Math.ceil(this.totalDepth / this.passDepth);
  }

  get spindleCode() {
    return this.spindleDir === 'CCW' ? 'M04' : 'M03';
  }

  toJSON() {
    return {
      units: this.units, toolDiameter: this.toolDiameter, toolType: this.toolType,
      toolFlutes: this.toolFlutes, material: this.material, maxCutForce: this.maxCutForce,
      compensation: this.compensation, totalDepth: this.totalDepth,
      passDepth: this.passDepth, safeHeight: this.safeHeight,
      feedRateXY: this.feedRateXY, feedRateZ: this.feedRateZ,
      spindleSpeed: this.spindleSpeed, spindleDir: this.spindleDir,
      origin: this.origin, arcDetect: this.arcDetect,
      addComments: this.addComments, lineNumbers: this.lineNumbers,
      coolant: this.coolant,
    };
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

  toObject() {
    return this.toJSON();
  }

  static getProfiles() {
    return {
      generic:  { name: 'Generic CNC',       feedRateXY: 1000, feedRateZ: 300, spindleSpeed: 18000 },
      grbl:     { name: 'GRBL',              feedRateXY: 800,  feedRateZ: 200, spindleSpeed: 12000 },
      mach3:    { name: 'Mach3',             feedRateXY: 1500, feedRateZ: 500, spindleSpeed: 24000 },
      fanuc:    { name: 'Fanuc',             feedRateXY: 2000, feedRateZ: 500, spindleSpeed: 8000  },
      haas:     { name: 'HAAS',              feedRateXY: 3000, feedRateZ: 800, spindleSpeed: 6000  },
      wood:     { name: 'Wood Routing',      feedRateXY: 2000, feedRateZ: 500, spindleSpeed: 18000 },
      aluminum: { name: 'Aluminum Milling',  feedRateXY: 400,  feedRateZ: 100, spindleSpeed: 12000 },
      pcb:      { name: 'PCB Engraving',     feedRateXY: 300,  feedRateZ: 80,  spindleSpeed: 30000 },
      laser:    { name: 'Laser Cutting',     feedRateXY: 3000, feedRateZ: 1000, spindleSpeed: 0    },
    };
  }
}

if (typeof module !== 'undefined') module.exports = MachineConfig;
