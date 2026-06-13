/**
 * GCodeGenerator.js — المولّد الرئيسي للـ G-Code
 * يجمع HeaderGenerator + ToolpathGenerator في pipeline كامل
 *
 * وحدة مشتركة (UMD) — المصدر الوحيد للحقيقة:
 *   الخادم  : require('./shared/GCodeGenerator')
 *   المتصفح : window.GCodeGenerator (نفس الكود حرفياً)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./MachineConfig'),
      require('./HeaderGenerator'),
      require('./ToolpathGenerator')
    );
  } else {
    root.DQ = root.DQ || {};
    root.DQ.GCodeGenerator = factory(root.DQ.MachineConfig, root.DQ.HeaderGenerator, root.DQ.ToolpathGenerator);
    // اسم عام للتوافق مع app.js
    root.GCodeGenerator = root.DQ.GCodeGenerator;
  }
}(typeof self !== 'undefined' ? self : this, function (MachineConfig, HeaderGenerator, ToolpathGenerator) {

class GCodeGenerator {
  constructor(configOrOptions = {}) {
    this.config = configOrOptions instanceof MachineConfig
      ? configOrOptions
      : new MachineConfig(configOrOptions);

    this._header   = new HeaderGenerator(this.config);
    this._toolpath = new ToolpathGenerator(this.config);
  }

  /**
   * تطبيق نقطة الصفر: يحوّل إحداثيات التصميم بحيث يطابق صفر البرنامج
   * المكان الذي صفّر عنده المشغّل آلته (زاوية الخامة أو مركزها)
   */
  _applyOrigin(shapes) {
    const origin = this.config.origin || 'bottom-left';
    if (origin === 'bottom-left' || !shapes.length) return shapes;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of shapes) {
      const b = this._bounds(s);
      if (b.minX < minX) minX = b.minX; if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY; if (b.maxY > maxY) maxY = b.maxY;
    }
    if (!isFinite(minX)) return shapes;

    let dx = 0, dy = 0;
    if (origin === 'center')   { dx = -(minX + maxX) / 2; dy = -(minY + maxY) / 2; }
    if (origin === 'top-left') { dx = -minX;              dy = -maxY; }

    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return shapes;
    return shapes.map(s => this._translate(JSON.parse(JSON.stringify(s)), dx, dy));
  }

  _bounds(s) {
    // حدود تشمل strokes النص
    const g = (typeof require === 'function') ? require('./geometry')
            : (typeof DQ !== 'undefined' ? DQ.geometry : null);
    return g.shapeBounds(s);
  }

  _translate(s, dx, dy) {
    switch (s.type) {
      case 'line':   s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; break;
      case 'rect':   s.x += dx; s.y += dy; break;
      case 'circle': case 'arc': case 'ellipse': s.cx += dx; s.cy += dy; break;
      case 'slot':   s.cx1 += dx; s.cy1 += dy; s.cx2 += dx; s.cy2 += dy; break;
      case 'text':   s.x += dx; s.y += dy; break;
      case 'polygon':
        if (s.cx !== undefined) { s.cx += dx; s.cy += dy; }
        /* fallthrough */
      case 'polyline':
        if (s.points) s.points = s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
        break;
    }
    return s;
  }

  /**
   * توليد G-Code كامل
   * @param {Array} shapes - الأشكال المعالجة والمُرتَّبة
   * @returns {{ gcode: string, stats: Object }}
   */
  generate(shapes) {
    this._toolpath.resetStats();
    shapes = this._applyOrigin(shapes);

    const allLines = [];

    // رأس الملف
    allLines.push(...this._header.header());

    // الطبقات
    const numPasses = this.config.numPasses;

    for (let pass = 1; pass <= numPasses; pass++) {
      const depth = -Math.min(pass * this.config.passDepth, this.config.totalDepth);

      if (this.config.addComments) {
        allLines.push('');
        allLines.push(`; ===== الطبقة ${pass}/${numPasses} — Z${depth.toFixed(3)} mm =====`);
      }

      shapes.forEach((shape, idx) => {
        if (this.config.addComments) {
          allLines.push(`; --- الشكل ${idx + 1}/${shapes.length}: ${shape.type} ---`);
        }
        const shapeLines = this._toolpath.generateShape(shape, depth);
        allLines.push(...shapeLines);
      });
    }

    // التذييل
    allLines.push('');
    allLines.push(...this._header.footer());

    // تطبيق أرقام الأسطر
    const finalLines = this._toolpath.applyLineNumbers(allLines);

    const stats = this._buildStats();
    stats.lines = finalLines.length;

    return {
      gcode: finalLines.join('\n'),
      stats,
    };
  }

  _buildStats() {
    const { feedRateXY, feedRateZ } = this.config;
    const s = this._toolpath.stats;

    const xyTime  = s.totalXY / feedRateXY;     // min
    const zTime   = s.totalZ  / feedRateZ;       // min
    const totalSec = (xyTime + zTime) * 60;

    const m = Math.floor(totalSec / 60);
    const sec = Math.round(totalSec % 60);

    return {
      estimatedTime: m > 0 ? `${m} دقيقة ${sec > 0 ? sec + ' ثانية' : ''}` : `${sec} ثانية`,
      totalXY:       s.totalXY.toFixed(1) + ' mm',
      totalZ:        s.totalZ.toFixed(1)  + ' mm',
      moves:         s.moves,
      lifts:         s.lifts,
      arcs:          s.arcs,
      passes:        this.config.numPasses,
      lines:         0, // يُحدَّث في generate بعد العد الفعلي
    };
  }
}

return GCodeGenerator;
}));
