/**
 * PocketGenerator — تعبئة الجيوب بمسح zig-zag للأشكال المغلقة
 * وحدة مشتركة (UMD): الخادم يستوردها بـ require، والمتصفح عبر DQ.PocketGenerator
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.PocketGenerator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

class PocketGenerator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate zig-zag scan lines for pocket milling
   * Returns array of scan lines (each line = array of {x,y} points)
   */
  generateScanLines(shape, _depth, stepoverFraction = 0.5) {
    const toolDia  = this.config.toolDiameter || 3;
    const stepY    = Math.max(0.1, toolDia * stepoverFraction);
    const wallOff  = toolDia / 2;
    const bounds   = this._bounds(shape);

    const lines = [];
    let dir = 1;

    for (let y = bounds.minY + wallOff; y <= bounds.maxY - wallOff + 0.001; y += stepY) {
      const xs = this._intersect(shape, y);
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);

      const pts = [];
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x1 = xs[i]   + wallOff;
        const x2 = xs[i+1] - wallOff;
        if (x1 >= x2 - 0.01) continue;
        if (dir > 0) { pts.push({ x: x1, y }, { x: x2, y }); }
        else          { pts.push({ x: x2, y }, { x: x1, y }); }
      }
      if (pts.length >= 2) { lines.push(pts); dir *= -1; }
    }

    return lines;
  }

  _bounds(s) {
    switch (s.type) {
      case 'rect':     return { minX: s.x, maxX: s.x + s.w, minY: s.y, maxY: s.y + s.h };
      case 'circle':   return { minX: s.cx - s.r, maxX: s.cx + s.r, minY: s.cy - s.r, maxY: s.cy + s.r };
      case 'ellipse':  return { minX: s.cx - s.rx, maxX: s.cx + s.rx, minY: s.cy - s.ry, maxY: s.cy + s.ry };
      case 'slot':     return {
        minX: Math.min(s.cx1, s.cx2) - s.r, maxX: Math.max(s.cx1, s.cx2) + s.r,
        minY: Math.min(s.cy1, s.cy2) - s.r, maxY: Math.max(s.cy1, s.cy2) + s.r
      };
      case 'polygon':
      case 'polyline': {
        if (!s.points || !s.points.length) return { minX:0,maxX:1,minY:0,maxY:1 };
        const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y);
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      }
      default: return { minX:0,maxX:100,minY:0,maxY:100 };
    }
  }

  /** Find X intersections of horizontal scan line Y=y with shape boundary */
  _intersect(s, y) {
    const xs = [];
    switch (s.type) {
      case 'rect': {
        if (y > s.y && y < s.y + s.h) xs.push(s.x, s.x + s.w);
        break;
      }
      case 'circle': {
        const dy = y - s.cy;
        if (Math.abs(dy) < s.r) {
          const dx = Math.sqrt(s.r * s.r - dy * dy);
          xs.push(s.cx - dx, s.cx + dx);
        }
        break;
      }
      case 'ellipse': {
        const dy = y - s.cy;
        if (s.ry > 0 && Math.abs(dy) < s.ry) {
          const dx = s.rx * Math.sqrt(1 - (dy / s.ry) ** 2);
          xs.push(s.cx - dx, s.cx + dx);
        }
        break;
      }
      case 'slot': {
        const { cx1, cy1, cx2, cy2, r } = s;
        // End cap 1
        const dy1 = y - cy1;
        if (Math.abs(dy1) <= r) { const dx = Math.sqrt(r*r - dy1*dy1); xs.push(cx1-dx, cx1+dx); }
        // End cap 2
        const dy2 = y - cy2;
        if (Math.abs(dy2) <= r) { const dx = Math.sqrt(r*r - dy2*dy2); xs.push(cx2-dx, cx2+dx); }
        if (xs.length === 0) break;
        // Take outermost
        xs.sort((a,b) => a-b);
        return [xs[0], xs[xs.length-1]];
      }
      case 'polygon':
      case 'polyline': {
        const pts = s.points;
        if (!pts || pts.length < 3) break;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const p1 = pts[i], p2 = pts[(i+1) % n];
          if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
            const t = (y - p1.y) / (p2.y - p1.y);
            xs.push(p1.x + t * (p2.x - p1.x));
          }
        }
        break;
      }
    }
    return xs;
  }
}

return PocketGenerator;
}));
