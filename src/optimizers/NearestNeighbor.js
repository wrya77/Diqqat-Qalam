/**
 * NearestNeighbor.js — خوارزمية الجار الأقرب لترتيب المسارات
 * تقلّل من إجمالي مسافة التنقل السريع بين الأشكال
 */

const geometry = require('../utils/geometry');

class NearestNeighbor {
  /**
   * إعادة ترتيب الأشكال
   * @param {Array}  shapes   - الأشكال
   * @param {Object} startPos - موضع البداية { x, y }
   * @returns {{ ordered, totalRapidBefore, totalRapidAfter, saving }}
   */
  sort(shapes, startPos = { x: 0, y: 0 }) {
    if (!shapes || shapes.length === 0) return [];
    if (shapes.length === 1) return shapes;

    // حساب المسافة الكلية قبل الترتيب
    const totalBefore = this._totalRapid(shapes, startPos);

    // خوارزمية الجار الأقرب — تأخذ بعين الاعتبار إمكانية قلب اتجاه الشكل
    const unvisited = shapes.map((s, i) => ({ shape: s, idx: i }));
    const ordered   = [];
    let current     = startPos;

    while (unvisited.length > 0) {
      let bestIdx = 0, bestDist = Infinity, bestReverse = false;

      unvisited.forEach((item, i) => {
        const rawStart = geometry.shapeRawStartPoint(item.shape);
        const rawEnd   = geometry.shapeRawEndPoint(item.shape);

        const distStart = geometry.distance(current.x, current.y, rawStart.x, rawStart.y);
        const distEnd   = geometry.distance(current.x, current.y, rawEnd.x, rawEnd.y);

        const dist = Math.min(distStart, distEnd);
        if (dist < bestDist) {
          bestDist = dist; bestIdx = i; bestReverse = distEnd < distStart;
        }
      });

      const chosen = unvisited.splice(bestIdx, 1)[0];
      // ضع علامة على الشكل ما إذا احتجنا لقلبه
      chosen.shape.reversed = !!bestReverse;
      ordered.push(chosen.shape);

      // نقطة نهاية الشكل كموضع حالي
      current = this._shapeEndPoint(chosen.shape);
    }

    const totalAfter = this._totalRapid(ordered, startPos);
    const pct = totalBefore > 0
      ? Math.round((1 - totalAfter / totalBefore) * 100)
      : 0;

    // ارجع كمصفوفة لكن أرفق إحصاءات كمفاتيح ليتوافق مع الواجهتين
    ordered.totalRapidBefore = Math.round(totalBefore);
    ordered.totalRapidAfter  = Math.round(totalAfter);
    ordered.saving           = `${Math.max(0, pct)}%`;
    ordered.ordered          = ordered;
    return ordered;
  }

  // 2-Opt تحسين إضافي
  twoOpt(shapes, startPos = { x: 0, y: 0 }, maxIter = 100) {
    let current = [...shapes];
    let improved = true;
    let iter = 0;

    while (improved && iter < maxIter) {
      improved = false;
      iter++;
      for (let i = 1; i < current.length - 1; i++) {
        for (let j = i + 1; j < current.length; j++) {
          const before = this._totalRapid(current, startPos);
          // قلب القطعة من i إلى j
          const next = [
            ...current.slice(0, i),
            ...current.slice(i, j + 1).reverse(),
            ...current.slice(j + 1),
          ];
          const after = this._totalRapid(next, startPos);
          if (after < before - 0.001) {
            current = next;
            improved = true;
          }
        }
      }
    }

    return current;
  }

  _totalRapid(shapes, startPos) {
    let total = 0;
    let pos   = startPos;
    shapes.forEach(s => {
      const start = geometry.shapeStartPoint(s);
      total += geometry.distance(pos.x, pos.y, start.x, start.y);
      pos    = this._shapeEndPoint(s);
    });
    return total;
  }

  _shapeEndPoint(shape) {
    return geometry.shapeEndPoint(shape);
  }
}

if (typeof module !== 'undefined') module.exports = NearestNeighbor;
