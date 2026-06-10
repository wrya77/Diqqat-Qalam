/**
 * SVGParser.js — تحليل ملفات SVG واستخراج الأشكال
 * يعمل في المتصفح (DOMParser) وفي Node.js (jsdom)
 */

class SVGParser {
  constructor() {
    // في Node.js نستخدم jsdom إذا كان متوفراً
    if (typeof DOMParser === 'undefined') {
      try {
        const { JSDOM } = require('jsdom');
        this._dom = new JSDOM('');
        this._DOMParser = this._dom.window.DOMParser;
      } catch (e) {
        this._DOMParser = null;
      }
    } else {
      this._DOMParser = DOMParser;
    }
  }

  /**
   * تحليل محتوى SVG
   * @param {string} svgContent
   * @returns {Array} مصفوفة من الأشكال
   */
  parse(svgContent) {
    if (!this._DOMParser) throw new Error('DOMParser غير متوفر');

    const parser = new this._DOMParser();
    const doc    = parser.parseFromString(svgContent, 'image/svg+xml');
    // تحقق من وجود أخطاء التحليل
    if (!doc || !doc.documentElement) throw new Error('Invalid SVG');
    const errors = doc.getElementsByTagName && doc.getElementsByTagName('parsererror');
    if (errors && errors.length > 0) throw new Error('Invalid SVG');

    const svgEl  = doc.documentElement;
    const scale  = this._calcScale(svgEl);
    const shapes = [];
    const matrix = this._parseTransform(svgEl.getAttribute('transform') || '');

    this._traverseNode(svgEl, shapes, scale, matrix);
    return shapes;
  }

  _traverseNode(node, shapes, scale, parentMatrix) {
    const transform = this._composeMatrix(
      parentMatrix,
      this._parseTransform(node.getAttribute ? node.getAttribute('transform') || '' : '')
    );

    for (const child of node.children || []) {
      const tag = child.tagName.toLowerCase().replace(/^svg:/, '');
      let extracted = [];

      switch (tag) {
        case 'line':     extracted = this._parseLine(child, scale);     break;
        case 'rect':     extracted = this._parseRect(child, scale);     break;
        case 'circle':   extracted = this._parseCircle(child, scale);   break;
        case 'ellipse':  extracted = this._parseEllipse(child, scale);  break;
        case 'polyline': extracted = this._parsePolyline(child, scale, false); break;
        case 'polygon':  extracted = this._parsePolyline(child, scale, true);  break;
        case 'path':     extracted = this._parsePath(child.getAttribute('d') || '', scale); break;
        case 'g':
          this._traverseNode(child, shapes, scale, transform);
          continue;
        default: continue;
      }

      // تطبيق التحويل
      extracted.forEach(s => {
        shapes.push(this._applyMatrix(s, transform));
      });
    }
  }

  _calcScale(svgEl) {
    const viewBox = svgEl.getAttribute('viewBox');
    if (!viewBox) return 1;
    const [, , vw] = viewBox.split(/[\s,]+/).map(Number);
    const width = parseFloat(svgEl.getAttribute('width') || vw);
    if (!vw || vw === 0) return 1;
    // نفترض أن وحدة SVG = 1mm إذا لم تُحدَّد (معيار شائع)
    return width / vw;
  }

  _parseLine(el, s) {
    return [{
      type: 'line',
      x1: parseFloat(el.getAttribute('x1') || 0) * s,
      y1: parseFloat(el.getAttribute('y1') || 0) * s,
      x2: parseFloat(el.getAttribute('x2') || 0) * s,
      y2: parseFloat(el.getAttribute('y2') || 0) * s,
    }];
  }

  _parseRect(el, s) {
    const x = parseFloat(el.getAttribute('x') || 0) * s;
    const y = parseFloat(el.getAttribute('y') || 0) * s;
    const w = parseFloat(el.getAttribute('width')  || 0) * s;
    const h = parseFloat(el.getAttribute('height') || 0) * s;
    const rx = parseFloat(el.getAttribute('rx') || 0) * s;
    const ry = parseFloat(el.getAttribute('ry') || rx) * s;

    if (rx > 0 || ry > 0) {
      // مستطيل بزوايا مدوّرة → polyline
      return [this._roundedRectToPolyline(x, y, w, h, rx, ry)];
    }
    return [{ type: 'rect', x, y, w, h }];
  }

  _roundedRectToPolyline(x, y, w, h, rx, ry) {
    const r = Math.min(rx, ry, w / 2, h / 2);
    const pts = [];
    const segs = 8;
    const corners = [
      { cx: x + r,     cy: y + r,     startAngle: Math.PI,       sweep: Math.PI / 2 },
      { cx: x + w - r, cy: y + r,     startAngle: -Math.PI / 2,  sweep: Math.PI / 2 },
      { cx: x + w - r, cy: y + h - r, startAngle: 0,             sweep: Math.PI / 2 },
      { cx: x + r,     cy: y + h - r, startAngle: Math.PI / 2,   sweep: Math.PI / 2 },
    ];
    corners.forEach(({ cx, cy, startAngle, sweep }) => {
      for (let i = 0; i <= segs; i++) {
        const a = startAngle + (i / segs) * sweep;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    });
    return { type: 'polyline', points: pts, closed: true };
  }

  _parseCircle(el, s) {
    return [{
      type: 'circle',
      cx: parseFloat(el.getAttribute('cx') || 0) * s,
      cy: parseFloat(el.getAttribute('cy') || 0) * s,
      r:  parseFloat(el.getAttribute('r')  || 0) * s,
    }];
  }

  _parseEllipse(el, s) {
    const cx = parseFloat(el.getAttribute('cx') || 0) * s;
    const cy = parseFloat(el.getAttribute('cy') || 0) * s;
    const rx = parseFloat(el.getAttribute('rx') || 0) * s;
    const ry = parseFloat(el.getAttribute('ry') || 0) * s;
    // تحويل إلى polyline
    const pts = [];
    const segs = 72;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * 2 * Math.PI;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return [{ type: 'polyline', points: pts, closed: true }];
  }

  _parsePolyline(el, s, closed) {
    const raw    = el.getAttribute('points') || '';
    const nums   = raw.trim().split(/[\s,]+/).map(Number);
    const points = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      points.push({ x: nums[i] * s, y: nums[i + 1] * s });
    }
    return [{ type: 'polyline', points, closed }];
  }

  _parsePath(d, s) {
    const shapes  = [];
    const cmds    = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];
    let cx = 0, cy = 0, startX = 0, startY = 0;
    let current = null;

    const nums = str =>
      (str.match(/-?[\d.]+(?:e[-+]?\d+)?/gi) || []).map(Number);

    const flush = () => {
      if (current && current.points.length > 1) {
        shapes.push(current);
      }
      current = null;
    };

    const ensure = () => {
      if (!current) current = { type: 'polyline', points: [{ x: cx * s, y: cy * s }] };
    };

    const moveTo = (x, y) => {
      flush();
      cx = x; cy = y; startX = x; startY = y;
    };

    const lineTo = (x, y) => {
      ensure();
      current.points.push({ x: x * s, y: y * s });
      cx = x; cy = y;
    };

    cmds.forEach(cmd => {
      const type = cmd[0];
      const n    = nums(cmd.slice(1));

      switch (type) {
        case 'M': moveTo(n[0], n[1]);
          for (let i = 2; i + 1 < n.length; i += 2) lineTo(n[i], n[i + 1]);
          break;
        case 'm': moveTo(cx + n[0], cy + n[1]);
          for (let i = 2; i + 1 < n.length; i += 2) lineTo(cx + n[i], cy + n[i + 1]);
          break;
        case 'L': for (let i = 0; i + 1 < n.length; i += 2) lineTo(n[i], n[i + 1]); break;
        case 'l': for (let i = 0; i + 1 < n.length; i += 2) lineTo(cx + n[i], cy + n[i + 1]); break;
        case 'H': lineTo(n[0], cy); break;
        case 'h': lineTo(cx + n[0], cy); break;
        case 'V': lineTo(cx, n[0]); break;
        case 'v': lineTo(cx, cy + n[0]); break;
        case 'Z': case 'z':
          ensure();
          if (current) {
            current.closed = true;
            current.points.push({ x: startX * s, y: startY * s });
          }
          flush();
          cx = startX; cy = startY;
          break;
        case 'C': case 'c': {
          // Cubic Bezier → تقريب بـ polyline
          const abs = type === 'C';
          for (let i = 0; i + 5 < n.length; i += 6) {
            const [x1, y1, x2, y2, ex, ey] = abs
              ? [n[i], n[i+1], n[i+2], n[i+3], n[i+4], n[i+5]]
              : [cx+n[i], cy+n[i+1], cx+n[i+2], cy+n[i+3], cx+n[i+4], cy+n[i+5]];
            ensure();
            const segs = 16;
            for (let t = 1 / segs; t <= 1 + 1e-6; t += 1 / segs) {
              const mt = 1 - t;
              const bx = mt**3*cx + 3*mt**2*t*x1 + 3*mt*t**2*x2 + t**3*ex;
              const by = mt**3*cy + 3*mt**2*t*y1 + 3*mt*t**2*y2 + t**3*ey;
              current.points.push({ x: bx * s, y: by * s });
            }
            cx = ex; cy = ey;
          }
          break;
        }
        case 'A': case 'a': {
          // Arc SVG → polyline تقريب
          for (let i = 0; i + 6 < n.length; i += 7) {
            const abs = type === 'A';
            const rx = n[i], ry = n[i+1];
            // const xRot = n[i+2]; // neglect rotation for simplicity
            const largeArc = n[i+3], sweep = n[i+4];
            const tx = abs ? n[i+5] : cx + n[i+5];
            const ty = abs ? n[i+6] : cy + n[i+6];
            ensure();
            const arcPts = this._svgArcToPoints(cx, cy, rx, ry, largeArc, sweep, tx, ty);
            arcPts.forEach(p => current.points.push({ x: p.x * s, y: p.y * s }));
            cx = tx; cy = ty;
          }
          break;
        }
      }
    });

    flush();
    return shapes;
  }

  // تحويل قوس SVG إلى نقاط
  _svgArcToPoints(x1, y1, rx, ry, largeArc, sweep, x2, y2) {
    const pts  = [];
    const mx   = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx   = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const d    = Math.sqrt(dx * dx + dy * dy);
    if (d === 0) return pts;
    const r    = Math.max(rx, ry, d);
    const h    = Math.sqrt(Math.max(0, r * r - d * d)) / d;
    const sign = largeArc === sweep ? -1 : 1;
    const cx   = mx + sign * h * (-dy);
    const cy   = my + sign * h * dx;
    const startAngle = Math.atan2(y1 - cy, x1 - cx);
    let   endAngle   = Math.atan2(y2 - cy, x2 - cx);

    if (sweep === 0 && endAngle > startAngle) endAngle -= 2 * Math.PI;
    if (sweep === 1 && endAngle < startAngle) endAngle += 2 * Math.PI;

    const segs = Math.max(8, Math.round(Math.abs(endAngle - startAngle) * r));
    for (let i = 0; i <= segs; i++) {
      const a = startAngle + (i / segs) * (endAngle - startAngle);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  _parseTransform(str) {
    const m = [1, 0, 0, 1, 0, 0]; // identity
    if (!str) return m;

    const translate = str.match(/translate\(([^)]+)\)/);
    const scale     = str.match(/scale\(([^)]+)\)/);
    const rotate    = str.match(/rotate\(([^)]+)\)/);

    if (translate) {
      const [tx, ty = 0] = translate[1].split(/[\s,]+/).map(Number);
      m[4] += tx; m[5] += ty;
    }
    if (scale) {
      const [sx, sy = sx] = scale[1].split(/[\s,]+/).map(Number);
      m[0] *= sx; m[3] *= sy;
    }
    if (rotate) {
      const [deg] = rotate[1].split(/[\s,]+/).map(Number);
      const r = deg * Math.PI / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      const [a, b, c, dd, e, f] = m;
      m[0] = a * cos + c * sin;
      m[1] = b * cos + dd * sin;
      m[2] = -a * sin + c * cos;
      m[3] = -b * sin + dd * cos;
    }
    return m;
  }

  _composeMatrix(a, b) {
    return [
      a[0]*b[0] + a[2]*b[1],
      a[1]*b[0] + a[3]*b[1],
      a[0]*b[2] + a[2]*b[3],
      a[1]*b[2] + a[3]*b[3],
      a[0]*b[4] + a[2]*b[5] + a[4],
      a[1]*b[4] + a[3]*b[5] + a[5],
    ];
  }

  _applyMatrix(shape, m) {
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0)
      return shape;

    const tx = (x, y) => ({ x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] });
    const clone = JSON.parse(JSON.stringify(shape));

    switch (clone.type) {
      case 'line': {
        const a = tx(clone.x1, clone.y1), b = tx(clone.x2, clone.y2);
        clone.x1 = a.x; clone.y1 = a.y; clone.x2 = b.x; clone.y2 = b.y;
        break;
      }
      case 'rect': {
        const a = tx(clone.x, clone.y);
        clone.x = a.x; clone.y = a.y;
        // w/h أبقيها كما هي (لا تدوير على المستطيل)
        break;
      }
      case 'circle': case 'arc': {
        const c = tx(clone.cx, clone.cy);
        clone.cx = c.x; clone.cy = c.y;
        break;
      }
      case 'polyline':
        clone.points = clone.points.map(p => tx(p.x, p.y));
        break;
    }
    return clone;
  }
}

if (typeof module !== 'undefined') module.exports = SVGParser;
