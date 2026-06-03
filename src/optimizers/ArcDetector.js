/**
 * ArcDetector.js — اكتشاف الأقواس في مسارات polyline
 * يحوّل سلاسل من الخطوط المستقيمة إلى G02/G03 حيثما أمكن
 */

const geometry = require('../utils/geometry');

class ArcDetector {
  constructor(options = {}) {
    this.tolerance    = options.tolerance    || 0.05;  // mm — دقة تطابق القوس
    this.minArcAngle  = options.minArcAngle  || 0.2;   // راديان — أصغر قوس يُحوَّل
    this.minPoints    = options.minPoints    || 5;     // أقل عدد نقاط للكشف
  }

  /**
   * فحص جميع الأشكال واستبدال polylines بأقواس حيثما أمكن
   */
  processShapes(shapes) {
    return shapes.map(s => {
      if (s.type === 'polyline' && s.points && s.points.length >= this.minPoints) {
        return this._processPolyline(s);
      }
      return s;
    }).flat();
  }

  // واجهة قديمة: alias لـ processShapes
  detect(shapes) {
    return this.processShapes(shapes);
  }

  _processPolyline(shape) {
    const pts    = shape.points;
    const result = [];
    let i = 0;

    while (i < pts.length) {
      // محاولة تطابق قوس يبدأ من pts[i]
      const arc = this._tryFitArc(pts, i);

      if (arc) {
        result.push(arc.shape);
        i = arc.endIdx;
      } else {
        // نقطة عادية — أضفها لـ polyline حالية
        if (result.length === 0 || result[result.length - 1].type !== 'polyline') {
          result.push({ type: 'polyline', points: [pts[i]], closed: false });
        } else {
          result[result.length - 1].points.push(pts[i]);
        }
        i++;
      }
    }

    // تنظيف: حذف polylines ذات نقطة واحدة
    return result.filter(s => {
      if (s.type === 'polyline') return s.points.length >= 2;
      return true;
    });
  }

  _tryFitArc(pts, startIdx) {
    if (startIdx + this.minPoints > pts.length) return null;

    // جرّب أعداداً مختلفة من النقاط
    for (let n = Math.min(pts.length - startIdx, 40); n >= this.minPoints; n--) {
      const segment = pts.slice(startIdx, startIdx + n);
      const fit     = this._fitCircle(segment);

      if (!fit) continue;
      if (!this._verifyArcFit(segment, fit.cx, fit.cy, fit.r)) continue;

      const startAngle = Math.atan2(pts[startIdx].y - fit.cy, pts[startIdx].x - fit.cx);
      const endIdx     = startIdx + n - 1;
      const endAngle   = Math.atan2(pts[endIdx].y - fit.cy, pts[endIdx].x - fit.cx);

      // تحديد الاتجاه
      const clockwise = this._isClockwise(segment);

      // حساب زاوية القوس
      let span = endAngle - startAngle;
      if (clockwise && span > 0) span -= 2 * Math.PI;
      if (!clockwise && span < 0) span += 2 * Math.PI;

      if (Math.abs(span) < this.minArcAngle) continue;

      return {
        shape: {
          type: 'arc',
          cx:   fit.cx,
          cy:   fit.cy,
          r:    fit.r,
          startAngle,
          endAngle,
          clockwise,
        },
        endIdx: startIdx + n,
      };
    }

    return null;
  }

  // تناسب دائرة بطريقة المربعات الصغرى
  _fitCircle(pts) {
    const n  = pts.length;
    if (n < 3) return null;

    let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
    let sumX3 = 0, sumY3 = 0, sumXY = 0, sumX2Y = 0, sumXY2 = 0;

    pts.forEach(({ x, y }) => {
      sumX += x; sumY += y;
      sumX2 += x*x; sumY2 += y*y;
      sumX3 += x*x*x; sumY3 += y*y*y;
      sumXY += x*y; sumX2Y += x*x*y; sumXY2 += x*y*y;
    });

    const A = 2 * (sumX2 - sumX * sumX / n);
    const B = 2 * (sumXY - sumX * sumY / n);
    const C = 2 * (sumY2 - sumY * sumY / n);
    const D = sumX3 + sumXY2 - sumX * (sumX2 + sumY2) / n;
    const E = sumX2Y + sumY3 - sumY * (sumX2 + sumY2) / n;

    const denom = A * C - B * B;
    if (Math.abs(denom) < 1e-10) return null;

    const cx = (D * C - B * E) / denom;
    const cy = (A * E - D * B) / denom;
    const r  = Math.sqrt((sumX2 - 2*cx*sumX + n*cx*cx + sumY2 - 2*cy*sumY + n*cy*cy) / n);

    return { cx, cy, r };
  }

  _verifyArcFit(pts, cx, cy, r) {
    for (const { x, y } of pts) {
      const dist = Math.abs(Math.sqrt((x-cx)**2 + (y-cy)**2) - r);
      if (dist > this.tolerance) return false;
    }
    return true;
  }

  _isClockwise(pts) {
    let sum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      sum += (pts[i+1].x - pts[i].x) * (pts[i+1].y + pts[i].y);
    }
    return sum > 0;
  }
}

if (typeof module !== 'undefined') module.exports = ArcDetector;
