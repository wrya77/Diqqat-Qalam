/**
 * geometry.js — حسابات هندسية أساسية
 */

const geometry = {
  // المسافة بين نقطتين
  distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  },

  // نقطة المنتصف
  midpoint(x1, y1, x2, y2) {
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  },

  // زاوية بين نقطتين (راديان)
  angle(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
  },

  // تحويل درجات → راديان
  toRad(deg) { return deg * Math.PI / 180; },

  // تحويل راديان → درجات
  toDeg(rad) { return rad * 180 / Math.PI; },

  // هل النقطة على الخط؟
  pointOnLine(px, py, x1, y1, x2, y2, tolerance = 0.1) {
    const d  = this.distance(x1, y1, x2, y2);
    const d1 = this.distance(px, py, x1, y1);
    const d2 = this.distance(px, py, x2, y2);
    return Math.abs(d1 + d2 - d) < tolerance;
  },

  // حدود الشكل
  shapeBounds(shape) {
    switch (shape.type) {
      case 'line':
        return {
          minX: Math.min(shape.x1, shape.x2), maxX: Math.max(shape.x1, shape.x2),
          minY: Math.min(shape.y1, shape.y2), maxY: Math.max(shape.y1, shape.y2),
        };
      case 'rect':
        return {
          minX: shape.x, maxX: shape.x + shape.w,
          minY: shape.y, maxY: shape.y + shape.h,
        };
      case 'circle': case 'arc':
        return {
          minX: shape.cx - shape.r, maxX: shape.cx + shape.r,
          minY: shape.cy - shape.r, maxY: shape.cy + shape.r,
        };
      case 'polyline': {
        if (!shape.points || shape.points.length === 0)
          return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        const xs = shape.points.map(p => p.x);
        const ys = shape.points.map(p => p.y);
        return {
          minX: Math.min(...xs), maxX: Math.max(...xs),
          minY: Math.min(...ys), maxY: Math.max(...ys),
        };
      }
      default:
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
  },

  // نقطة بداية الشكل
  shapeStartPoint(shape) {
    // دعم الخاصية `reversed`: إذا كانت true، نعيد نقطة النهاية كـ start
    const rawStart = this.shapeRawStartPoint(shape);
    const rawEnd   = this.shapeRawEndPoint(shape);
    return shape && shape.reversed ? rawEnd : rawStart;
  },

  // نقطة نهاية الشكل (مراعاة reversed)
  shapeEndPoint(shape) {
    const rawStart = this.shapeRawStartPoint(shape);
    const rawEnd   = this.shapeRawEndPoint(shape);
    return shape && shape.reversed ? rawStart : rawEnd;
  },

  // نقاط بدء/نهاية خام تتجاهل الخاصية `reversed`
  shapeRawStartPoint(shape) {
    switch (shape.type) {
      case 'line':     return { x: shape.x1, y: shape.y1 };
      case 'rect':     return { x: shape.x,  y: shape.y  };
      case 'circle':   return { x: shape.cx + shape.r, y: shape.cy };
      case 'arc':      return {
        x: shape.cx + shape.r * Math.cos(shape.startAngle || 0),
        y: shape.cy + shape.r * Math.sin(shape.startAngle || 0),
      };
      case 'polyline':
        return shape.points && shape.points.length > 0
          ? { x: shape.points[0].x, y: shape.points[0].y }
          : { x: 0, y: 0 };
      default:
        return { x: 0, y: 0 };
    }
  },

  shapeRawEndPoint(shape) {
    switch (shape.type) {
      case 'line':     return { x: shape.x2, y: shape.y2 };
      case 'rect':     return { x: shape.x,  y: shape.y  }; // closed rect returns same
      case 'circle':   return { x: shape.cx + shape.r, y: shape.cy };
      case 'arc': {
        const a = shape.endAngle || 0;
        return { x: shape.cx + shape.r * Math.cos(a), y: shape.cy + shape.r * Math.sin(a) };
      }
      case 'polyline':
        return shape.closed || shape.points.length === 0
          ? shape.points[0]
          : shape.points[shape.points.length - 1];
      default:
        return { x: 0, y: 0 };
    }
  },

  // طول الشكل
  shapeLength(shape) {
    switch (shape.type) {
      case 'line':
        return this.distance(shape.x1, shape.y1, shape.x2, shape.y2);
      case 'rect':
        return 2 * (shape.w + shape.h);
      case 'circle':
        return 2 * Math.PI * shape.r;
      case 'arc': {
        const span = Math.abs((shape.endAngle || 0) - (shape.startAngle || 0));
        return shape.r * span;
      }
      case 'polyline': {
        if (!shape.points || shape.points.length < 2) return 0;
        let len = 0;
        for (let i = 1; i < shape.points.length; i++) {
          len += this.distance(
            shape.points[i - 1].x, shape.points[i - 1].y,
            shape.points[i].x,     shape.points[i].y
          );
        }
        if (shape.closed && shape.points.length > 2) {
          const last = shape.points[shape.points.length - 1];
          len += this.distance(last.x, last.y, shape.points[0].x, shape.points[0].y);
        }
        return len;
      }
      default: return 0;
    }
  },

  // تبسيط مسار (Ramer-Douglas-Peucker)
  simplifyPath(points, epsilon = 0.5) {
    if (points.length <= 2) return points;
    let dmax = 0, idx = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
      const d = this._pointLineDistance(points[i], points[0], points[end]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > epsilon) {
      const r1 = this.simplifyPath(points.slice(0, idx + 1), epsilon);
      const r2 = this.simplifyPath(points.slice(idx), epsilon);
      return [...r1.slice(0, -1), ...r2];
    }
    return [points[0], points[end]];
  },

  _pointLineDistance(pt, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return this.distance(pt.x, pt.y, a.x, a.y);
    return Math.abs(dx * (a.y - pt.y) - (a.x - pt.x) * dy) / len;
  },

  // تقاطع خطين
  lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(d) < 1e-10) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  },
};

if (typeof module !== 'undefined') module.exports = geometry;
