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

  /**
   * 2-Opt صحيح وسريع — تقييم تفاضلي O(n²) لكل تمريرة.
   * عند عكس المقطع [i..j] يُعكس أيضاً اتجاه قطع كل شكل داخله (rev)،
   * فالحواف الداخلية تبقى بنفس الطول (مسافة متماثلة) ولا يتغير إلا حدّان.
   * المقاطع الكبيرة تُتخطى (NN يكفيها) تجنباً للبطء.
   */
  twoOpt(shapes, startPos = { x: 0, y: 0 }, maxIter = 30) {
    const n = shapes.length;
    if (n < 4 || n > 400) return shapes;   // صغير جداً لا يفيد، كبير جداً يبطئ

    // عقد بإحداثيات بداية/نهاية خام + علم الاتجاه الحالي
    const nodes = shapes.map(s => ({
      shape: s,
      a: geometry.shapeRawStartPoint(s),     // الطرف "الأصلي" الأول
      b: geometry.shapeRawEndPoint(s),       // الطرف "الأصلي" الثاني
      rev: !!s.reversed,
    }));
    const entry = nd => (nd.rev ? nd.b : nd.a);
    const exit  = nd => (nd.rev ? nd.a : nd.b);
    const D = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

    let improved = true, iter = 0;
    while (improved && iter < maxIter) {
      improved = false; iter++;
      for (let i = 0; i < n - 1; i++) {
        const prevExit = i === 0 ? startPos : exit(nodes[i - 1]);
        for (let j = i + 1; j < n; j++) {
          const ni = nodes[i], nj = nodes[j];
          const hasRight = j + 1 < n;
          const nextEntry = hasRight ? entry(nodes[j + 1]) : null;

          // الحدّان قبل العكس
          const oldL = D(prevExit, entry(ni));
          const oldR = hasRight ? D(exit(nj), nextEntry) : 0;

          // بعد العكس: المقطع يُقلب وكل شكل يُعكس اتجاهه
          // أول المقطع الجديد = nj معكوساً، آخره = ni معكوساً
          const newL = D(prevExit, exit(nj));            // entry(flip(nj)) = exit(nj)
          const newR = hasRight ? D(entry(ni), nextEntry) : 0; // exit(flip(ni)) = entry(ni)

          if (newL + newR < oldL + oldR - 1e-6) {
            // طبّق: اعكس الترتيب [i..j] واقلب اتجاه كل عقدة داخله
            let lo = i, hi = j;
            while (lo < hi) { const t = nodes[lo]; nodes[lo] = nodes[hi]; nodes[hi] = t; lo++; hi--; }
            for (let k = i; k <= j; k++) nodes[k].rev = !nodes[k].rev;
            improved = true;
          }
        }
      }
    }

    // أعد بناء مصفوفة الأشكال بالاتجاهات النهائية
    return nodes.map(nd => { nd.shape.reversed = nd.rev; return nd.shape; });
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
