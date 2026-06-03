/**
 * gcode-generator.js — Browser Version
 * Converts geometric shapes to CNC G-Code
 * Works in both browser and Node.js (UMD)
 */
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GCodeGenerator = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {

class GCodeGenerator {
  constructor(config = {}) {
    this.cfg = {
      units:         config.units          || 'mm',
      toolDiameter:  parseFloat(config.toolDiameter)  || 3,
      toolType:      config.toolType       || 'flat',
      toolNumber:    parseInt(config.toolNumber) || 1,
      compensation:  config.compensation   || 'none',
      totalDepth:    parseFloat(config.totalDepth)    || 5,
      passDepth:     parseFloat(config.passDepth)     || 1,
      safeHeight:    parseFloat(config.safeHeight)    || 5,
      feedRateXY:    parseFloat(config.feedRateXY)    || 1000,
      feedRateZ:     parseFloat(config.feedRateZ)     || 300,
      spindleSpeed:  parseInt(config.spindleSpeed)    || 18000,
      spindleDir:    config.spindleDir     || 'cw',
      origin:        config.origin         || 'bottom-left',
      coordSystem:   config.coordSystem    || 'G54',
      arcDetect:     config.arcDetect      !== false,
      addComments:   config.addComments    !== false,
      lineNumbers:   config.lineNumbers    || false,
    };

    this.lines   = [];
    this.lineNum = 10;
    this.pos     = { x: 0, y: 0, z: this.cfg.safeHeight };
    this.stats   = { moves: 0, lifts: 0, totalXY: 0, totalZ: 0, passes: 0 };
  }

  /* ═══════════════ PUBLIC: generate ═══════════════ */
  generate(shapes) {
    this.lines   = [];
    this.lineNum = 10;
    this.pos     = { x: 0, y: 0, z: this.cfg.safeHeight };
    this.stats   = { moves: 0, lifts: 0, totalXY: 0, totalZ: 0, passes: 0 };

    const numPasses = Math.max(1, Math.ceil(this.cfg.totalDepth / this.cfg.passDepth));
    this.stats.passes = numPasses;

    this._header();

    for (let pass = 1; pass <= numPasses; pass++) {
      const depth = -(Math.min(pass * this.cfg.passDepth, this.cfg.totalDepth));
      if (this.cfg.addComments) {
        this._cmt(`━━ طبقة ${pass}/${numPasses} — عمق ${Math.abs(depth).toFixed(3)} mm ━━`);
      }
      for (let i = 0; i < shapes.length; i++) {
        if (this.cfg.addComments) {
          this._cmt(`شكل ${i+1}: ${shapes[i].type}`);
        }
        this._cutShape(shapes[i], depth);
      }
    }

    this._footer();

    return { gcode: this.lines.join('\n'), stats: this._calcStats() };
  }

  /* ═══════════════ HEADER / FOOTER ═══════════════ */
  _header() {
    const ts = new Date().toLocaleString('ar-IQ');
    if (this.cfg.addComments) {
      this._cmt(`═══════════════════════════════════`);
      this._cmt(` Diqqat Qalam (دقة قلم) — ${ts}`);
      this._cmt(` أداة: ⌀${this.cfg.toolDiameter}mm ${this.cfg.toolType}`);
      this._cmt(` عمق: ${this.cfg.totalDepth}mm / طبقة: ${this.cfg.passDepth}mm`);
      this._cmt(` F-XY:${this.cfg.feedRateXY} F-Z:${this.cfg.feedRateZ} S:${this.cfg.spindleSpeed}`);
      this._cmt(`═══════════════════════════════════`);
    }

    // Program number
    this._out('O0001', 'رقم البرنامج');

    // Units
    this._out(this.cfg.units === 'mm' ? 'G21' : 'G20',
              this.cfg.units === 'mm' ? 'وحدات: ميلليمتر' : 'وحدات: إنش');

    // Absolute, XY plane
    this._out('G90 G17', 'إحداثيات مطلقة، مستوى XY');

    // Coordinate system
    this._out(this.cfg.coordSystem, `نظام الإحداثيات ${this.cfg.coordSystem}`);

    // Cancel any existing cutter comp
    this._out('G40', 'إلغاء تعويض الأداة');

    // Tool change
    const T = String(this.cfg.toolNumber).padStart(2, '0');
    this._out(`T${T} M06`, `تغيير الأداة T${T}`);

    // Tool compensation
    if (this.cfg.compensation !== 'none') {
      const code = this.cfg.compensation === 'left' ? 'G41' : 'G42';
      this._out(`${code} D${this.cfg.toolNumber}`, 'تعويض الأداة');
    }

    // Spindle on
    const sCode = this.cfg.spindleDir === 'ccw' ? 'M04' : 'M03';
    this._out(`${sCode} S${this.cfg.spindleSpeed}`, `تشغيل المغزل ${this.cfg.spindleSpeed} RPM`);

    // Dwell for spindle spin-up
    this._out('G04 P2', 'انتظار 2 ثانية');

    // Lift to safe height
    this._liftTo(this.cfg.safeHeight);
  }

  _footer() {
    if (this.cfg.addComments) this._cmt('━━ نهاية البرنامج ━━');

    // Return to safe height
    this._liftTo(this.cfg.safeHeight);

    // Cancel cutter comp
    if (this.cfg.compensation !== 'none') {
      this._out('G40', 'إلغاء التعويض');
    }

    // Return home XY
    this._out('G00 X0.000 Y0.000', 'العودة للبيت');

    // Spindle off, coolant off
    this._out('M05', 'إيقاف المغزل');
    this._out('M09', 'إيقاف سائل التبريد');

    // End program
    this._out('M30', 'نهاية البرنامج');
  }

  /* ═══════════════ SHAPE ROUTER ═══════════════ */
  _cutShape(shape, depth) {
    switch (shape.type) {
      case 'line':     this._cutLine(shape, depth);     break;
      case 'rect':     this._cutRect(shape, depth);     break;
      case 'circle':   this._cutCircle(shape, depth);   break;
      case 'arc':      this._cutArc(shape, depth);      break;
      case 'polyline': this._cutPolyline(shape, depth); break;
      default: if (this.cfg.addComments) this._cmt(`⚠ شكل غير مدعوم: ${shape.type}`);
    }
  }

  /* ═══════════════ SHAPE CUTTERS ═══════════════ */
  _cutLine(s, depth) {
    this._rapidXY(s.x1, s.y1);
    this._plunge(depth);
    this._feedXY(s.x2, s.y2);
    this._retract();
  }

  _cutRect(s, depth) {
    const { x, y, w, h } = s;
    this._rapidXY(x, y);
    this._plunge(depth);
    this._feedXY(x + w, y);
    this._feedXY(x + w, y + h);
    this._feedXY(x,     y + h);
    this._feedXY(x,     y);       // close
    this._retract();
  }

  _cutCircle(s, depth) {
    const { cx, cy, r } = s;
    const startX = cx + r;
    const startY = cy;

    this._rapidXY(startX, startY);
    this._plunge(depth);

    if (this.cfg.arcDetect) {
      // G02 full circle: I = cx - startX = -r
      this._out(
        `G02 X${this._f(startX)} Y${this._f(startY)} I${this._f(-r)} J${this._f(0)} F${this.cfg.feedRateXY}`,
        'دائرة كاملة'
      );
      this.stats.moves++;
    } else {
      // Approximate with segments
      const seg = 72;
      for (let i = 1; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        this._feedXY(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
    }
    this._retract();
  }

  _cutArc(s, depth) {
    const { cx, cy, r, startAngle = 0, endAngle = Math.PI, clockwise = true } = s;
    const sx = cx + r * Math.cos(startAngle);
    const sy = cy + r * Math.sin(startAngle);
    const ex = cx + r * Math.cos(endAngle);
    const ey = cy + r * Math.sin(endAngle);
    const I  = cx - sx;
    const J  = cy - sy;

    this._rapidXY(sx, sy);
    this._plunge(depth);

    const code = clockwise ? 'G02' : 'G03';
    this._out(
      `${code} X${this._f(ex)} Y${this._f(ey)} I${this._f(I)} J${this._f(J)} F${this.cfg.feedRateXY}`,
      `قوس ${clockwise ? 'عكس ع.س' : 'ع.س'}`
    );
    this.stats.moves++;
    this._retract();
  }

  _cutPolyline(s, depth) {
    if (!s.points || s.points.length < 2) return;

    this._rapidXY(s.points[0].x, s.points[0].y);
    this._plunge(depth);

    for (let i = 1; i < s.points.length; i++) {
      const pt = s.points[i];
      // Arc segment?
      if (pt.arcTo) {
        const { cx, cy, cw } = pt.arcTo;
        const I = cx - s.points[i-1].x;
        const J = cy - s.points[i-1].y;
        const code = cw ? 'G02' : 'G03';
        this._out(
          `${code} X${this._f(pt.x)} Y${this._f(pt.y)} I${this._f(I)} J${this._f(J)} F${this.cfg.feedRateXY}`,
          'قوس'
        );
        this.stats.moves++;
        this.pos.x = pt.x; this.pos.y = pt.y;
      } else {
        this._feedXY(pt.x, pt.y);
      }
    }

    if (s.closed) {
      this._feedXY(s.points[0].x, s.points[0].y);
    }
    this._retract();
  }

  /* ═══════════════ MOTION PRIMITIVES ═══════════════ */
  _rapidXY(x, y) {
    const d = this._dist(this.pos.x, this.pos.y, x, y);
    if (d < 0.001) return;
    this._out(`G00 X${this._f(x)} Y${this._f(y)}`, 'تنقل سريع');
    this.stats.moves++;
    this.stats.totalXY += d;
    this.pos.x = x; this.pos.y = y;
  }

  _feedXY(x, y) {
    const d = this._dist(this.pos.x, this.pos.y, x, y);
    if (d < 0.001) return;
    this._out(`G01 X${this._f(x)} Y${this._f(y)} F${this.cfg.feedRateXY}`, 'قطع');
    this.stats.moves++;
    this.stats.totalXY += d;
    this.pos.x = x; this.pos.y = y;
  }

  _plunge(depth) {
    if (Math.abs(this.pos.z - depth) < 0.001) return;
    this._out(`G01 Z${this._f(depth)} F${this.cfg.feedRateZ}`, `نزول ${Math.abs(depth).toFixed(3)}mm`);
    this.stats.totalZ += Math.abs(this.pos.z - depth);
    this.pos.z = depth;
  }

  _retract() {
    this._liftTo(this.cfg.safeHeight);
    this.stats.lifts++;
  }

  _liftTo(z) {
    if (Math.abs(this.pos.z - z) < 0.001) return;
    this._out(`G00 Z${this._f(z)}`, 'رفع');
    this.stats.totalZ += Math.abs(this.pos.z - z);
    this.pos.z = z;
  }

  /* ═══════════════ OUTPUT HELPERS ═══════════════ */
  _out(code, comment = '') {
    let line = '';
    if (this.cfg.lineNumbers) {
      line += `N${this.lineNum.toString().padStart(4,'0')} `;
      this.lineNum += 10;
    }
    line += code;
    if (comment && this.cfg.addComments) line += `  ; ${comment}`;
    this.lines.push(line);
  }

  _cmt(text) {
    if (this.cfg.addComments) this.lines.push(`; ${text}`);
  }

  _f(n) { return Number(n).toFixed(3); }

  _dist(x1, y1, x2, y2) {
    return Math.sqrt((x2-x1)**2 + (y2-y1)**2);
  }

  /* ═══════════════ STATISTICS ═══════════════ */
  _calcStats() {
    const { feedRateXY, feedRateZ, spindleSpeed, totalDepth, passDepth } = this.cfg;
    const numPasses = Math.ceil(totalDepth / passDepth);
    const xyMin  = this.stats.totalXY / feedRateXY;
    const zMin   = this.stats.totalZ  / feedRateZ;
    const totalS = (xyMin + zMin) * 60;

    const m  = Math.floor(totalS / 60);
    const s  = Math.round(totalS % 60);
    const timeStr = m > 0 ? `${m}د ${s}ث` : `${s}ث`;

    return {
      estimatedTime: timeStr,
      totalXY:  this.stats.totalXY.toFixed(1) + ' mm',
      totalZ:   this.stats.totalZ.toFixed(1) + ' mm',
      moves:    this.stats.moves,
      lifts:    this.stats.lifts,
      passes:   numPasses,
      lines:    this.lines.length,
    };
  }
}

return GCodeGenerator;
}));
