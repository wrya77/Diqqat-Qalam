'use strict';

/**
 * DXFExporter — exports canvas shapes to DXF R12 format
 * Compatible with AutoCAD, LibreCAD, FreeCAD, and most CAM software
 */
class DXFExporter {
  constructor(opts = {}) {
    this.layer  = opts.layer  || '0';
    this.units  = opts.units  || 'mm'; // mm or inch
  }

  export(shapes) {
    const lines = [];

    // Header
    lines.push(
      '0', 'SECTION',
      '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1009',
      '9', '$INSUNITS', '70', this.units === 'inch' ? '1' : '4',
      '0', 'ENDSEC',
    );

    // Entities section
    lines.push('0', 'SECTION', '2', 'ENTITIES');

    for (const s of shapes) {
      const ent = this._shapeToEntity(s);
      if (ent) lines.push(...ent);
    }

    lines.push('0', 'ENDSEC', '0', 'EOF');

    return lines.join('\n');
  }

  _f(n) { return parseFloat(n.toFixed(6)); }

  _shapeToEntity(s) {
    switch (s.type) {
      case 'line':     return this._line(s.x1, s.y1, s.x2, s.y2);
      case 'rect':     return this._rect(s);
      case 'circle':   return this._circle(s.cx, s.cy, s.r);
      case 'arc':      return this._arc(s);
      case 'ellipse':  return this._ellipseApprox(s);
      case 'polygon':  return s.points ? this._lwpolyline(s.points, true) : null;
      case 'slot':     return this._slotEntity(s);
      case 'polyline': return s.points ? this._lwpolyline(s.points, s.closed || false) : null;
      case 'compound': return s.contours
        ? s.contours.filter(r => r && r.length >= 2).flatMap(r => this._lwpolyline(r, true))
        : null;
      default:         return null;
    }
  }

  _line(x1, y1, x2, y2) {
    return [
      '0', 'LINE',
      '8', this.layer,
      '10', this._f(x1), '20', this._f(y1), '30', '0.0',
      '11', this._f(x2), '21', this._f(y2), '31', '0.0',
    ];
  }

  _circle(cx, cy, r) {
    return [
      '0', 'CIRCLE',
      '8', this.layer,
      '10', this._f(cx), '20', this._f(cy), '30', '0.0',
      '40', this._f(r),
    ];
  }

  _arc(s) {
    const sa = ((s.startAngle * 180 / Math.PI) + 360) % 360;
    const ea = ((s.endAngle   * 180 / Math.PI) + 360) % 360;
    return [
      '0', 'ARC',
      '8', this.layer,
      '10', this._f(s.cx), '20', this._f(s.cy), '30', '0.0',
      '40', this._f(s.r),
      '50', this._f(sa),
      '51', this._f(ea),
    ];
  }

  _rect(s) {
    const pts = [
      { x: s.x,       y: s.y },
      { x: s.x + s.w, y: s.y },
      { x: s.x + s.w, y: s.y + s.h },
      { x: s.x,       y: s.y + s.h },
    ];
    return this._lwpolyline(pts, true);
  }

  _lwpolyline(pts, closed) {
    const lines = [
      '0', 'LWPOLYLINE',
      '8', this.layer,
      '90', String(pts.length),
      '70', closed ? '1' : '0',
    ];
    for (const p of pts) {
      lines.push('10', this._f(p.x), '20', this._f(p.y));
    }
    return lines;
  }

  _ellipseApprox(s) {
    // Approximate ellipse with polyline (36 segments)
    const segs = 36;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * 2 * Math.PI;
      pts.push({ x: s.cx + s.rx * Math.cos(a), y: s.cy + s.ry * Math.sin(a) });
    }
    return this._lwpolyline(pts, true);
  }

  _slotEntity(s) {
    const { cx1, cy1, cx2, cy2, r } = s;
    const dx = cx2 - cx1, dy = cy2 - cy1;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return this._circle(cx1, cy1, r);

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
    return this._lwpolyline(pts, true);
  }
}

module.exports = DXFExporter;
