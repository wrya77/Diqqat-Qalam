/**
 * ToolpathGenerator.js — مولّد مسار الأداة لكل شكل
 * يتولى تحويل كل شكل هندسي إلى أوامر G-Code حركية
 * وحدة مشتركة (UMD): الخادم يستوردها بـ require، والمتصفح عبر DQ.ToolpathGenerator
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./geometry'), require('./PocketGenerator'));
  } else {
    root.DQ = root.DQ || {};
    root.DQ.ToolpathGenerator = factory(root.DQ.geometry, root.DQ.PocketGenerator);
  }
}(typeof self !== 'undefined' ? self : this, function (geometry, PocketGenerator) {

class ToolpathGenerator {
  constructor(config) {
    this.config = config;
    this.pos    = { x: 0, y: 0, z: config.safeHeight };
    this.stats  = { moves: 0, lifts: 0, totalXY: 0, totalZ: 0, arcs: 0 };
    this._lineNum = 10;
  }

  resetStats() {
    this.stats    = { moves: 0, lifts: 0, totalXY: 0, totalZ: 0, arcs: 0 };
    this.pos      = { x: 0, y: 0, z: this.config.safeHeight };
    this._lineNum = 10;
  }

  /**
   * توليد G-Code لشكل واحد على عمق محدد
   * @returns {string[]}
   */
  generateShape(shape, depth) {
    // Pocket mode: fill interior
    if (shape.machineOp === 'pocket') return this._genPocket(shape, depth);

    switch (shape.type) {
      case 'line':     return this._genLine(shape, depth);
      case 'rect':     return this._genRect(shape, depth);
      case 'circle':   return this._genCircle(shape, depth);
      case 'arc':      return this._genArc(shape, depth);
      case 'ellipse':  return this._genEllipse(shape, depth);
      case 'polygon':  return this._genPolygon(shape, depth);
      case 'slot':     return this._genSlot(shape, depth);
      case 'polyline': return this._genPolyline(shape, depth);
      case 'text':     return this._genText(shape, depth);
      default:
        return this.config.addComments ? [`; شكل غير مدعوم: ${shape.type}`] : [];
    }
  }

  // نقش نص — strokes: مصفوفة ضربات، كل ضربة نقاط mm نسبية إلى (x,y)
  _genText(s, depth) {
    if (!s.strokes || !s.strokes.length) return [];
    const lines = [];
    const feed = s.feedRate || this.config.feedRateXY;
    if (this.config.addComments) lines.push(`; نقش نص: "${(s.text || '').slice(0, 40)}"`);
    for (const stroke of s.strokes) {
      if (!stroke || stroke.length < 2) continue;
      lines.push(...this._rapidTo(s.x + stroke[0].x, s.y + stroke[0].y));
      lines.push(...this._plunge(depth, s));
      for (let i = 1; i < stroke.length; i++) {
        lines.push(...this._feedTo(s.x + stroke[i].x, s.y + stroke[i].y, depth, '', feed));
      }
      lines.push(...this._retract());
    }
    return lines;
  }

  _genEllipse(s, depth) {
    const lines = [];
    const { cx, cy, rx, ry } = s;
    const feed = s.feedRate || this.config.feedRateXY;
    const segs = Math.max(36, Math.round(Math.PI * (3*(rx+ry) - Math.sqrt((3*rx+ry)*(rx+3*ry))) / 0.5));
    lines.push(...this._rapidTo(cx + rx, cy));
    lines.push(...this._plunge(depth, s));
    for (let i = 1; i <= segs; i++) {
      const a = (i / segs) * 2 * Math.PI;
      lines.push(...this._feedTo(cx + rx * Math.cos(a), cy + ry * Math.sin(a), depth, '', feed));
    }
    lines.push(...this._retract());
    return lines;
  }

  _genPolygon(s, depth) {
    if (!s.points || s.points.length < 3) return [];
    return this._genPolyline({ ...s, type: 'polyline', closed: true }, depth);
  }

  _genSlot(s, depth) {
    const { cx1, cy1, cx2, cy2, r } = s;
    const dx = cx2 - cx1, dy = cy2 - cy1, len = Math.hypot(dx, dy);
    if (len < 0.001) return this._genCircle({ cx: cx1, cy: cy1, r, feedRate: s.feedRate }, depth);
    const angle = Math.atan2(dy, dx);
    const segs = 18;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = angle - Math.PI/2 + (i / segs) * Math.PI;
      pts.push({ x: cx2 + r * Math.cos(a), y: cy2 + r * Math.sin(a) });
    }
    for (let i = 0; i <= segs; i++) {
      const a = angle + Math.PI/2 + (i / segs) * Math.PI;
      pts.push({ x: cx1 + r * Math.cos(a), y: cy1 + r * Math.sin(a) });
    }
    return this._genPolyline({ ...s, type: 'polyline', points: pts, closed: true }, depth);
  }

  _genPocket(s, depth) {
    const pocketGen = new PocketGenerator(this.config);
    const scanLines = pocketGen.generateScanLines(s, depth);
    if (!scanLines.length) return this.config.addComments ? ['; جيب: لا مسارات'] : [];
    const lines = [];
    const feed = s.feedRate || this.config.feedRateXY;
    if (this.config.addComments) lines.push(`; بداية جيب ${s.type}`);
    // Plunge at first point
    lines.push(...this._rapidTo(scanLines[0][0].x, scanLines[0][0].y));
    lines.push(...this._plunge(depth, s));
    for (const scanLine of scanLines) {
      if (!scanLine.length) continue;
      lines.push(...this._rapidTo(scanLine[0].x, scanLine[0].y));
      for (let i = 1; i < scanLine.length; i++) {
        lines.push(...this._feedTo(scanLine[i].x, scanLine[i].y, depth, '', feed));
      }
    }
    lines.push(...this._retract());
    return lines;
  }

  _genLine(s, depth) {
    const lines = [];
    // دعم الانعكاس: استخدم نقاط البداية/النهاية من geometry
    const start = geometry.shapeStartPoint(s);
    const end   = geometry.shapeEndPoint(s);
    const feed  = s.feedRate || this.config.feedRateXY;

    lines.push(...this._rapidTo(start.x, start.y));
    lines.push(...this._plunge(depth, s));
    lines.push(...this._feedTo(end.x, end.y, depth, '', feed));
    lines.push(...this._retract());
    return lines;
  }

  _genRect(s, depth) {
    const lines = [];
    const { x, y, w, h } = s;
    const feed = s.feedRate || this.config.feedRateXY;
    lines.push(...this._rapidTo(x, y));
    lines.push(...this._plunge(depth, s));
    lines.push(...this._feedTo(x + w, y,     depth, '', feed));
    lines.push(...this._feedTo(x + w, y + h, depth, '', feed));
    lines.push(...this._feedTo(x,     y + h, depth, '', feed));
    lines.push(...this._feedTo(x,     y,     depth, 'إغلاق', feed));
    lines.push(...this._retract());
    return lines;
  }

  _genCircle(s, depth) {
    const lines = [];
    const { cx, cy, r } = s;
    const startX = cx + r;
    const feed = s.feedRate || this.config.feedRateXY;
    lines.push(...this._rapidTo(startX, cy));
    lines.push(...this._plunge(depth, s));

    if (this.config.arcDetect) {
      const ln = `G02 X${this._f(startX)} Y${this._f(cy)} I${this._f(-r)} J${this._f(0)} F${feed}`;
      lines.push(this._addComment(ln, 'دائرة كاملة CW'));
      this.stats.moves++; this.stats.arcs++;
      this.stats.totalXY += 2 * Math.PI * r;
    } else {
      // تقريب بخطوط
      const segs = Math.max(36, Math.round(2 * Math.PI * r / 0.5));
      for (let i = 1; i <= segs; i++) {
        const a = (i / segs) * 2 * Math.PI;
        lines.push(...this._feedTo(cx + r * Math.cos(a), cy + r * Math.sin(a), depth, '', feed));
      }
    }

    lines.push(...this._retract());
    return lines;
  }

  _genArc(s, depth) {
    const lines = [];
    const { cx, cy, r, startAngle, endAngle, clockwise } = s;
    const sx = cx + r * Math.cos(startAngle);
    const sy = cy + r * Math.sin(startAngle);
    const ex = cx + r * Math.cos(endAngle);
    const ey = cy + r * Math.sin(endAngle);
    const i  = cx - sx, j = cy - sy;
    const feed = s.feedRate || this.config.feedRateXY;

    lines.push(...this._rapidTo(sx, sy));
    lines.push(...this._plunge(depth, s));

    const code = clockwise ? 'G02' : 'G03';
    const ln   = `${code} X${this._f(ex)} Y${this._f(ey)} I${this._f(i)} J${this._f(j)} F${feed}`;
    lines.push(this._addComment(ln, `قوس ${clockwise ? 'CW' : 'CCW'}`));
    this.stats.moves++; this.stats.arcs++;
    this.stats.totalXY += r * Math.abs(endAngle - startAngle);

    this.pos.x = ex; this.pos.y = ey;

    lines.push(...this._retract());
    return lines;
  }

  _genPolyline(s, depth) {
    if (!s.points || s.points.length < 2) return [];
    const lines = [];
    const pts = s.reversed ? Array.from(s.points).reverse() : s.points;
    const feed = s.feedRate || this.config.feedRateXY;

    lines.push(...this._rapidTo(pts[0].x, pts[0].y));
    lines.push(...this._plunge(depth, s));

    for (let i = 1; i < pts.length; i++) {
      lines.push(...this._feedTo(pts[i].x, pts[i].y, depth, '', feed));
    }
    if (s.closed && pts.length > 2) {
      lines.push(...this._feedTo(pts[0].x, pts[0].y, depth, 'إغلاق', feed));
    }

    lines.push(...this._retract());
    return lines;
  }

  // ===== حركات أساسية =====
  _rapidTo(x, y) {
    const dist = geometry.distance(this.pos.x, this.pos.y, x, y);
    if (dist < 0.001) return [];
    const ln = `G00 X${this._f(x)} Y${this._f(y)}`;
    this.stats.moves++;
    this.stats.totalXY += dist;
    this.pos.x = x; this.pos.y = y;
    return [this._addComment(ln, '')];
  }

  _feedTo(x, y, z, comment = '', feed = null) {
    const dist = geometry.distance(this.pos.x, this.pos.y, x, y);
    if (dist < 0.001) return [];
    const f = feed || this.config.feedRateXY;
    const ln = `G01 X${this._f(x)} Y${this._f(y)} Z${this._f(z)} F${f}`;
    this.stats.moves++;
    this.stats.totalXY += dist;
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    return [comment && this.config.addComments ? `${ln}  ; ${comment}` : ln];
  }

  _plunge(depth, shape) {
    if (Math.abs(this.pos.z - depth) < 0.001) return [];
    const strategy = this.config.plungeStrategy || 'straight';
    const dist = Math.abs(this.pos.z - depth);

    // Helical: للدوائر فقط عندما يطلب المستخدم helical
    if (strategy === 'helical' && shape && shape.type === 'circle') {
      return this._helicalPlunge(shape, depth);
    }
    // Ramp: هبوط مائل خطي
    if (strategy === 'ramp') {
      return this._rampPlunge(depth);
    }
    // Straight (الافتراضي)
    const ln = `G01 Z${this._f(depth)} F${this.config.feedRateZ}`;
    this.stats.totalZ += dist;
    this.pos.z = depth;
    return [this._addComment(ln, `نزول ${Math.abs(depth).toFixed(2)}mm`)];
  }

  // هبوط حلزوني للدوائر — G02 مع تنزيل تدريجي في Z
  _helicalPlunge(shape, targetZ) {
    const lines = [];
    const { cx, cy, r } = shape;
    const startZ  = this.pos.z;
    const depthDiff = Math.abs(startZ - targetZ);
    const feed      = Math.min(this.config.feedRateXY, this.config.feedRateZ * 3);

    // نقطة البداية على محيط الدائرة
    const startX = cx + r;
    const startY = cy;

    // تحرك سريع للنقطة إذا لزم
    if (Math.abs(this.pos.x - startX) > 0.001 || Math.abs(this.pos.y - startY) > 0.001) {
      lines.push(`G00 X${this._f(startX)} Y${this._f(startY)}`);
      this.pos.x = startX; this.pos.y = startY;
    }

    // عدد اللفات: 1 لفة لكل 0.5mm عمق (الحد الأدنى لفة واحدة)
    const turns = Math.max(1, Math.ceil(depthDiff / 0.5));
    const zStep = -depthDiff / turns;

    lines.push(this._addComment('; بداية الهبوط الحلزوني', ''));
    for (let i = 1; i <= turns; i++) {
      const z = startZ + zStep * i;
      // دائرة كاملة مع هبوط Z تدريجي
      const ln = `G02 X${this._f(startX)} Y${this._f(startY)} I${this._f(-r)} J${this._f(0)} Z${this._f(z)} F${feed}`;
      lines.push(this._addComment(ln, `حلزون ${i}/${turns}`));
      this.stats.moves++; this.stats.arcs++;
      this.stats.totalXY += 2 * Math.PI * r;
      this.stats.totalZ  += Math.abs(zStep);
    }

    this.pos.x = startX; this.pos.y = startY; this.pos.z = targetZ;
    return lines;
  }

  // هبوط مائل — G01 بزاوية 3° افتراضياً
  _rampPlunge(targetZ) {
    const lines    = [];
    const startZ   = this.pos.z;
    const depthDiff = Math.abs(startZ - targetZ);
    const angleRad  = ((this.config.rampAngle || 3) * Math.PI) / 180;
    const rampLength = depthDiff / Math.tan(angleRad);
    const feed      = Math.min(this.config.feedRateXY, this.config.feedRateZ * 4);

    // تحريك مائل في محور X
    const endX = this.pos.x + rampLength;
    const ln   = `G01 X${this._f(endX)} Y${this._f(this.pos.y)} Z${this._f(targetZ)} F${feed}`;
    lines.push(this._addComment(ln, `هبوط مائل ${(this.config.rampAngle || 3)}°`));
    this.stats.moves++;
    this.stats.totalXY += rampLength;
    this.stats.totalZ  += depthDiff;
    this.pos.x = endX; this.pos.z = targetZ;
    return lines;
  }

  _retract() {
    const { safeHeight } = this.config;
    if (Math.abs(this.pos.z - safeHeight) < 0.001) return [];
    const dist = Math.abs(this.pos.z - safeHeight);
    const ln   = `G00 Z${this._f(safeHeight)}`;
    this.stats.totalZ += dist;
    this.stats.lifts++;
    this.pos.z = safeHeight;
    return [this._addComment(ln, 'رفع')];
  }

  _addComment(line, comment) {
    if (this.config.addComments && comment) return `${line}  ; ${comment}`;
    return line;
  }

  _f(v) { return Number(v).toFixed(3); }

  applyLineNumbers(lines) {
    if (!this.config.lineNumbers) return lines;
    return lines.map(l => {
      if (l.startsWith(';') || !l.trim()) return l;
      const numbered = `N${this._lineNum} ${l}`;
      this._lineNum += this.config.lineNumberStep || 10;
      return numbered;
    });
  }
}

return ToolpathGenerator;
}));
