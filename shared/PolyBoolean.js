/**
 * PolyBoolean.js — العمليات المنطقية على المضلّعات (Boolean ops)
 *
 *   توحيد (union) · تقاطع (intersect) · طرح (difference) · استبعاد (xor)
 *
 * خوارزمية Greiner–Hormann معمّمة على عدة مسارات (contours) مع دعم الثقوب
 * بقاعدة even-odd. كل شكل يُمثَّل كـ "مضلّع" = مصفوفة مسارات مغلقة، وكل مسار
 * مصفوفة نقاط {x,y}. النتيجة مصفوفة مسارات مغلقة (الثقوب مسارات منفصلة).
 *
 * وحدة مشتركة (UMD): الخادم يستوردها بـ require، المتصفح عبر DQ.PolyBoolean.
 * مصدر أصلي بالكامل — لا تبعيات خارجية.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.PolyBoolean = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;

  /* ──────────────────────────────────────────────────────────
     مساعدات أساسية
  ────────────────────────────────────────────────────────── */

  // اختبار النقطة داخل مضلّع (قاعدة even-odd عبر كل المسارات → يحترم الثقوب)
  function pointInPolys(x, y, polys) {
    let inside = false;
    for (const ring of polys) {
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = ring[i], b = ring[j];
        if (((a.y > y) !== (b.y > y)) &&
            (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)) {
          inside = !inside;
        }
      }
    }
    return inside;
  }

  // مساحة مسار موقّعة (لإزالة المسارات الصغيرة جداً)
  function signedArea(ring) {
    let a = 0;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
    }
    return a / 2;
  }

  // إزاحة عشوائية شبه-حتمية صغيرة جداً لتفادي الحالات الشاذّة (تقاطع عند رأس)
  // المقدار دون الميكرون عند مقياس mm — لا أثر عملي على القطع.
  function perturb(polys, scale) {
    const d = 1e-7 * (scale || 1);
    let k = 0;
    return polys.map(ring => ring.map(p => {
      // نمط دوّار ثابت حتى تكون النتيجة قابلة لإعادة الإنتاج
      const a = (k++ * 2.39996323) ; // الزاوية الذهبية بالراديان
      return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
    }));
  }

  function bboxDiag(polys) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of polys) for (const p of ring) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) return 1;
    return Math.hypot(maxX - minX, maxY - minY) || 1;
  }

  /* ──────────────────────────────────────────────────────────
     قائمة الرؤوس المترابطة (Greiner–Hormann)
  ────────────────────────────────────────────────────────── */

  function Vertex(x, y) {
    return {
      x, y,
      next: null, prev: null,
      intersect: false, entry: false, visited: false,
      neighbour: null, alpha: 0,
    };
  }

  // يبني حلقة مترابطة دائرياً من مصفوفة نقاط؛ يعيد قائمة رؤوس "حقيقية"
  function buildRing(points) {
    const verts = points.map(p => Vertex(p.x, p.y));
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      verts[i].next = verts[(i + 1) % n];
      verts[i].prev = verts[(i - 1 + n) % n];
    }
    return verts; // verts[0] رأس بداية حقيقي
  }

  // إدراج رأس تقاطع بين a و a.next حسب ترتيب alpha
  function insertIntersection(v, a) {
    let c = a;
    while (c.next.intersect && c.next.alpha < v.alpha) c = c.next;
    v.next = c.next; v.prev = c;
    c.next.prev = v; c.next = v;
  }

  // تقاطع قطعتين [p1,p2] و [q1,q2] — يعيد {x,y,aP,aQ} للتقاطع الحقيقي فقط
  function segIntersect(p1, p2, q1, q2) {
    const dpx = p2.x - p1.x, dpy = p2.y - p1.y;
    const dqx = q2.x - q1.x, dqy = q2.y - q1.y;
    const denom = dpx * dqy - dpy * dqx;
    if (Math.abs(denom) < EPS) return null; // متوازيان
    const aP = ((q1.x - p1.x) * dqy - (q1.y - p1.y) * dqx) / denom;
    const aQ = ((q1.x - p1.x) * dpy - (q1.y - p1.y) * dpx) / denom;
    if (aP <= EPS || aP >= 1 - EPS || aQ <= EPS || aQ >= 1 - EPS) return null;
    return { x: p1.x + aP * dpx, y: p1.y + aP * dpy, aP, aQ };
  }

  /* ──────────────────────────────────────────────────────────
     النواة: عملية على مضلّعين
     subject / clip : مصفوفة مسارات (نقاط {x,y})
     op : 'union' | 'intersect' | 'difference' | 'xor'
  ────────────────────────────────────────────────────────── */

  function operate(subject, clip, op) {
    subject = sanitize(subject);
    clip    = sanitize(clip);
    if (!subject.length) return op === 'union' ? clone(clip) : (op === 'xor' ? clone(clip) : []);
    if (!clip.length)    return op === 'intersect' ? [] : clone(subject);

    if (op === 'xor') {
      return operate(operate(subject, clip, 'difference'),
                     operate(clip, subject, 'difference'), 'union');
    }

    const scale = Math.max(bboxDiag(subject), bboxDiag(clip));
    // إزاحة المقصّ فقط لتفادي التطابقات الحادّة
    const clipP = perturb(clip, scale);

    // قوائم مترابطة
    const subjRings = subject.map(buildRing);
    const clipRings = clipP.map(buildRing);

    // مصفوفات النقاط الأصلية لاختبارات الاحتواء (even-odd)
    const subjPts = subject;
    const clipPts = clipP;

    // ── المرحلة 1: إيجاد كل التقاطعات وإدراجها ──
    const subjInter = [];
    for (const sRing of subjRings) {
      for (const sv of sRing) {
        const s1 = sv, s2 = nextReal(sv);
        for (const cRing of clipRings) {
          for (const cv of cRing) {
            const c1 = cv, c2 = nextReal(cv);
            const hit = segIntersect(s1, s2, c1, c2);
            if (!hit) continue;
            const vs = Vertex(hit.x, hit.y); vs.intersect = true; vs.alpha = hit.aP;
            const vc = Vertex(hit.x, hit.y); vc.intersect = true; vc.alpha = hit.aQ;
            vs.neighbour = vc; vc.neighbour = vs;
            insertIntersection(vs, s1);
            insertIntersection(vc, c1);
            subjInter.push(vs);
          }
        }
      }
    }

    // ── لا تقاطعات: قرار بالاحتواء ──
    if (subjInter.length === 0) {
      return resolveDisjoint(subject, clip, subjPts, clipPts, op);
    }

    // ── المرحلة 2: تعليم دخول/خروج ──
    // أعلام القلب لكل عملية: [قلب الموضوع, قلب المقصّ]
    const flips = {
      intersect:  [false, false],
      union:      [true,  true],
      difference: [false, true],   // subject − clip
    }[op];

    markEntries(subjRings, clipPts, flips[0]);
    markEntries(clipRings, subjPts, flips[1]);

    // ── المرحلة 3: تتبّع النتيجة ──
    // تبدأ من كل تقاطع غير مُعالَج على الموضوع، وتمشي للأمام عند "الدخول"
    // وللخلف عند "الخروج"، قافزةً إلى الجار عند كل تقاطع حتى تُغلَق الحلقة.
    const result = [];
    for (const start of subjInter) {
      if (start.visited) continue;
      const contour = [];
      let cur = start;
      let guard = 0, GMAX = (subjInter.length * 4 + 16) * 8;
      do {
        cur.visited = true;
        if (cur.neighbour) cur.neighbour.visited = true;
        const forward = cur.entry;
        contour.push({ x: cur.x, y: cur.y });           // نقطة التقاطع نفسها
        do {                                            // امشِ حتى التقاطع التالي
          cur = forward ? cur.next : cur.prev;
          if (!cur.intersect) contour.push({ x: cur.x, y: cur.y });
        } while (!cur.intersect);
        cur = cur.neighbour;                            // اقفز إلى المضلّع الآخر
      } while (cur && cur !== start && ++guard < GMAX);
      if (contour.length >= 3) result.push(contour);
    }

    return cleanResult(result);
  }

  /* ──────────────────────────────────────────────────────────
     مساعدات النواة
  ────────────────────────────────────────────────────────── */

  // الرأس الحقيقي التالي في الحلقة (يتخطّى رؤوس التقاطع المُدرَجة)
  function nextReal(v) {
    let c = v.next;
    while (c.intersect) c = c.next;
    return c;
  }

  function markEntries(rings, otherPts, flip) {
    for (const ring of rings) {
      // أول رأس حقيقي يحدّد حالة البداية
      const first = ring[0];
      let status = pointInPolys(first.x, first.y, otherPts); // true = داخل
      if (flip) status = !status;
      // امشِ على القائمة كاملةً (حقيقية + تقاطعية) بدءاً من first
      let v = first;
      do {
        if (v.intersect) {
          v.entry = !status;
          status = !status;
        }
        v = v.next;
      } while (v !== first);
    }
  }

  // عند انعدام التقاطعات: نعتمد على الاحتواء التام
  function resolveDisjoint(subject, clip, subjPts, clipPts, op) {
    const sInC = ringInside(subject[0], clipPts);   // الموضوع داخل المقصّ؟
    const cInS = ringInside(clip[0], subjPts);       // المقصّ داخل الموضوع؟

    switch (op) {
      case 'union':
        if (sInC) return clone(clip);
        if (cInS) return clone(subject);
        return clone(subject).concat(clone(clip)); // منفصلان → مساران
      case 'intersect':
        if (sInC) return clone(subject);
        if (cInS) return clone(clip);
        return []; // منفصلان تماماً
      case 'difference':
        if (cInS) return clone(subject).concat(clone(clip).map(r => r.slice().reverse())); // ثقب
        if (sInC) return [];        // الموضوع مبتلَع كلياً
        return clone(subject);      // منفصلان
      default: return clone(subject);
    }
  }

  function ringInside(ring, polys) {
    // نعتبر المسار داخلاً إذا كانت نقطة تمثيلية منه داخل الآخر
    const p = ring[0];
    return pointInPolys(p.x, p.y, polys);
  }

  /* ──────────────────────────────────────────────────────────
     تنظيف المدخلات والمخرجات
  ────────────────────────────────────────────────────────── */

  function clone(polys) { return polys.map(r => r.map(p => ({ x: p.x, y: p.y }))); }

  // يزيل النقاط المكرّرة المتتالية ويغلق الحلقات ويسقط المسارات المنهارة
  function sanitize(polys) {
    if (!Array.isArray(polys)) return [];
    const out = [];
    for (let ring of polys) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const r = [];
      for (const p of ring) {
        if (!r.length || Math.hypot(p.x - r[r.length - 1].x, p.y - r[r.length - 1].y) > 1e-6) {
          r.push({ x: p.x, y: p.y });
        }
      }
      // أسقط نقطة الإغلاق المكرّرة إن وُجدت
      if (r.length > 1 && Math.hypot(r[0].x - r[r.length - 1].x, r[0].y - r[r.length - 1].y) < 1e-6) r.pop();
      if (r.length >= 3) out.push(r);
    }
    return out;
  }

  // ينظّف نتيجة التتبّع: يزيل التكرار والمسارات الضئيلة جداً
  function cleanResult(result) {
    const out = [];
    for (const ring of result) {
      const r = [];
      for (const p of ring) {
        if (!r.length || Math.hypot(p.x - r[r.length - 1].x, p.y - r[r.length - 1].y) > 1e-6) r.push(p);
      }
      if (r.length > 1 && Math.hypot(r[0].x - r[r.length - 1].x, r[0].y - r[r.length - 1].y) < 1e-6) r.pop();
      if (r.length >= 3 && Math.abs(signedArea(r)) > 1e-4) out.push(r);
    }
    return out;
  }

  /* ──────────────────────────────────────────────────────────
     الواجهة العامة
  ────────────────────────────────────────────────────────── */

  return {
    operate,
    union:      (a, b) => operate(a, b, 'union'),
    intersect:  (a, b) => operate(a, b, 'intersect'),
    difference: (a, b) => operate(a, b, 'difference'),
    xor:        (a, b) => operate(a, b, 'xor'),
    // أدوات مساعدة مكشوفة للاختبار
    _pointInPolys: pointInPolys,
    _signedArea: signedArea,
  };
}));
