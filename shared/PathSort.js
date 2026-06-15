/**
 * PathSort.js — ترتيب المسارات لتقليل التنقل السريع (NN + 2-opt)
 * وحدة مشتركة (UMD): الخادم يستوردها require، والمتصفح عبر DQ.PathSort
 *
 * نفس منطق src/optimizers/NearestNeighbor لكن متاح للواجهة أيضاً،
 * فيستفيد التوليد الفوري في المتصفح من نفس توفير وقت التشغيل.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./geometry'));
  } else {
    root.DQ = root.DQ || {};
    root.DQ.PathSort = factory(root.DQ.geometry);
  }
}(typeof self !== 'undefined' ? self : this, function (geometry) {

  const D = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

  function totalRapid(shapes, startPos) {
    let total = 0, pos = startPos;
    for (const s of shapes) {
      const st = geometry.shapeStartPoint(s);
      total += D(pos, st);
      pos = geometry.shapeEndPoint(s);
    }
    return total;
  }

  // ترتيب الجار الأقرب مع اختيار اتجاه القطع الأمثل لكل شكل
  function nearestNeighbor(shapes, startPos) {
    const unvisited = shapes.map(s => s);
    const ordered = [];
    let cur = startPos;
    while (unvisited.length) {
      let bi = 0, bd = Infinity, brev = false;
      for (let i = 0; i < unvisited.length; i++) {
        const a = geometry.shapeRawStartPoint(unvisited[i]);
        const b = geometry.shapeRawEndPoint(unvisited[i]);
        const ds = D(cur, a), de = D(cur, b);
        const d = Math.min(ds, de);
        if (d < bd) { bd = d; bi = i; brev = de < ds; }
      }
      const chosen = unvisited.splice(bi, 1)[0];
      chosen.reversed = brev;
      ordered.push(chosen);
      cur = geometry.shapeEndPoint(chosen);
    }
    return ordered;
  }

  // 2-opt صحيح وسريع (تقييم تفاضلي، يعكس اتجاه القطع مع المقطع)
  function twoOpt(shapes, startPos, maxIter) {
    const n = shapes.length;
    if (n < 4 || n > 400) return shapes;
    maxIter = maxIter || 30;
    const nodes = shapes.map(s => ({
      shape: s,
      a: geometry.shapeRawStartPoint(s),
      b: geometry.shapeRawEndPoint(s),
      rev: !!s.reversed,
    }));
    const entry = nd => (nd.rev ? nd.b : nd.a);
    const exit  = nd => (nd.rev ? nd.a : nd.b);

    let improved = true, iter = 0;
    while (improved && iter < maxIter) {
      improved = false; iter++;
      for (let i = 0; i < n - 1; i++) {
        const prevExit = i === 0 ? startPos : exit(nodes[i - 1]);
        for (let j = i + 1; j < n; j++) {
          const ni = nodes[i], nj = nodes[j];
          const hasRight = j + 1 < n;
          const nextEntry = hasRight ? entry(nodes[j + 1]) : null;
          const oldL = D(prevExit, entry(ni));
          const oldR = hasRight ? D(exit(nj), nextEntry) : 0;
          const newL = D(prevExit, exit(nj));
          const newR = hasRight ? D(entry(ni), nextEntry) : 0;
          if (newL + newR < oldL + oldR - 1e-6) {
            let lo = i, hi = j;
            while (lo < hi) { const t = nodes[lo]; nodes[lo] = nodes[hi]; nodes[hi] = t; lo++; hi--; }
            for (let k = i; k <= j; k++) nodes[k].rev = !nodes[k].rev;
            improved = true;
          }
        }
      }
    }
    return nodes.map(nd => { nd.shape.reversed = nd.rev; return nd.shape; });
  }

  /**
   * ترتيب كامل: NN ثم 2-opt. يُرجع { shapes, before, after, saving }.
   * يعمل على نسخ — لا يغيّر مصفوفة الأشكال الأصلية إلا الخاصية reversed.
   */
  function optimize(shapes, startPos) {
    startPos = startPos || { x: 0, y: 0 };
    if (!shapes || shapes.length < 2) {
      return { shapes: shapes || [], before: 0, after: 0, saving: '0%' };
    }
    const before = totalRapid(shapes, startPos);
    let out = nearestNeighbor(shapes.slice(), startPos);
    out = twoOpt(out, startPos);
    const after = totalRapid(out, startPos);
    const pct = before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
    return { shapes: out, before: Math.round(before), after: Math.round(after), saving: pct + '%' };
  }

  return { optimize, nearestNeighbor, twoOpt, totalRapid };
}));
