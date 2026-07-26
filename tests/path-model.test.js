/** اختبارات نموذج المسار البيزيري — shared/PathModel.js */
const PM = require('../shared/PathModel');

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

describe('PathModel: التحويل بلا فقد', () => {
  test('الدائرة: كل نقاط التفليط على نصف القطر بخطأ ≤ 0.03%', () => {
    const p = PM.fromShape({ type: 'circle', cx: 10, cy: -5, r: 40 });
    expect(p.type).toBe('path');
    expect(p.closed).toBe(true);
    expect(p.anchors).toHaveLength(4);
    const f = PM.flatten(p, 0.001);
    for (const q of f.points) {
      const r = dist(q, { x: 10, y: -5 });
      expect(Math.abs(r - 40) / 40).toBeLessThan(0.0003);
    }
  });

  test('المستطيل: 4 مراسٍ زاوية بلا مقابض', () => {
    const p = PM.fromShape({ type: 'rect', x: 0, y: 0, w: 30, h: 20 });
    expect(p.anchors).toHaveLength(4);
    p.anchors.forEach(a => {
      expect(Math.hypot(a.hin.x, a.hin.y)).toBe(0);
      expect(Math.hypot(a.hout.x, a.hout.y)).toBe(0);
    });
    const b = PM.bounds(p);
    expect(b).toEqual({ minX: 0, maxX: 30, minY: 0, maxY: 20 });
  });

  test('القوس 90°: الأطراف مضبوطة والوسط على نصف القطر', () => {
    const p = PM.fromShape({ type: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: Math.PI / 2, clockwise: false });
    const A = p.anchors;
    expect(dist(A[0], { x: 10, y: 0 })).toBeLessThan(1e-9);
    expect(dist(A[A.length - 1], { x: 0, y: 10 })).toBeLessThan(1e-9);
    const f = PM.flatten(p, 0.001);
    f.points.forEach(q => expect(Math.abs(dist(q, { x: 0, y: 0 }) - 10)).toBeLessThan(0.01));
  });

  test('الفتحة (slot): مسار مغلق يحيط بالمركزين', () => {
    const p = PM.fromShape({ type: 'slot', cx1: 0, cy1: 0, cx2: 20, cy2: 0, r: 5 });
    expect(p.closed).toBe(true);
    const b = PM.bounds(p);
    expect(b.minX).toBeCloseTo(-5, 4);
    expect(b.maxX).toBeCloseTo(25, 4);
    expect(b.minY).toBeCloseTo(-5, 4);
    expect(b.maxY).toBeCloseTo(5, 4);
  });

  test('polyline يمرّ كما هو + خصائص النمط تُحفَظ', () => {
    const p = PM.fromShape({ type: 'polyline', points: [{x:0,y:0},{x:5,y:5},{x:10,y:0}], closed: true, layer: 'cut', depth: 3 });
    expect(p.anchors).toHaveLength(3);
    expect(p.layer).toBe('cut');
    expect(p.depth).toBe(3);
  });
});

describe('PathModel: الحدود والتفليط', () => {
  test('حدود منحنى منتفخ تتجاوز مراسيه', () => {
    // مقطع أفقي بمقابض تصعد — القمة أعلى من المرساتين
    const p = PM.makePath([
      PM.anchor(0, 0, null, { x: 0, y: 10 }, 'corner'),
      PM.anchor(20, 0, { x: 0, y: 10 }, null, 'corner'),
    ], false);
    const b = PM.bounds(p);
    expect(b.maxY).toBeGreaterThan(5);   // القمة عند 7.5
    expect(b.maxY).toBeCloseTo(7.5, 3);
  });

  test('التفليط المتكيّف: تفاوت أدق = نقاط أكثر، وكلها ضمن التفاوت', () => {
    const circle = PM.fromShape({ type: 'circle', cx: 0, cy: 0, r: 100 });
    const rough = PM.flatten(circle, 1).points.length;
    const fine  = PM.flatten(circle, 0.01).points.length;
    expect(fine).toBeGreaterThan(rough * 2);
  });
});

describe('PathModel: عمليات العُقَد', () => {
  test('تقسيم مقطع يحافظ على الشكل (de Casteljau)', () => {
    const p = PM.fromShape({ type: 'circle', cx: 0, cy: 0, r: 10 });
    const before = PM.flatten(p, 0.005).points;
    const at = PM.splitSegment(p, 0, 0.5);
    expect(at).toBe(1);
    expect(p.anchors).toHaveLength(5);
    const after = PM.flatten(p, 0.005).points;
    // كل نقطة قبلية لها نظيرة قريبة بعدياً
    for (let i = 0; i < before.length; i += 7) {
      const q = before[i];
      const d = Math.min(...after.map(w => dist(w, q)));
      expect(d).toBeLessThan(0.02);
    }
  });

  test('syncSmooth يعكس اتجاه المقبض ويحفظ طول المقابل', () => {
    const a = PM.anchor(0, 0, { x: -3, y: 0 }, { x: 5, y: 0 }, 'smooth');
    a.hout = { x: 0, y: 4 };            // المستخدم سحب المقبض الخارج لأعلى
    PM.syncSmooth(a, 'hout');
    expect(a.hin.x).toBeCloseTo(0, 9);
    expect(a.hin.y).toBeCloseTo(-3, 9); // معاكس الاتجاه بطوله الأصلي 3
  });

  test('setKind(smooth) يبني مقابض على مماس الجارين', () => {
    const p = PM.makePath([PM.anchor(0,0), PM.anchor(10,0), PM.anchor(20,10)], false);
    PM.setKind(p, 1, 'smooth');
    const a = p.anchors[1];
    const lin = Math.hypot(a.hin.x, a.hin.y), lout = Math.hypot(a.hout.x, a.hout.y);
    expect(lin).toBeGreaterThan(0);
    expect(lout).toBeGreaterThan(0);
    // متعاكسان
    expect(a.hin.x * lout + a.hout.x * lin).toBeCloseTo(0, 6);
    expect(a.hin.y * lout + a.hout.y * lin).toBeCloseTo(0, 6);
  });
});

describe('PathModel: التحويلات', () => {
  test('الدوران 90° لدائرة محوّلة يبقيها دائرة', () => {
    const p = PM.fromShape({ type: 'circle', cx: 20, cy: 0, r: 5 });
    PM.rotate(p, Math.PI / 2, 0, 0);
    const b = PM.bounds(p);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 6);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(20, 6);
    PM.flatten(p, 0.001).points.forEach(q =>
      expect(Math.abs(dist(q, { x: 0, y: 20 }) - 5)).toBeLessThan(0.01));
  });

  test('التحجيم غير المنتظم يحوّل المقابض (دائرة → بيضوي مضبوط)', () => {
    const p = PM.fromShape({ type: 'circle', cx: 0, cy: 0, r: 10 });
    PM.scale(p, 2, 1, 0, 0);
    const b = PM.bounds(p);
    expect(b.maxX).toBeCloseTo(20, 3);
    expect(b.maxY).toBeCloseTo(10, 3);
    // نقطة 45°: على البيضوي (x/20)²+(y/10)² = 1
    const f = PM.flatten(p, 0.001);
    f.points.forEach(q => {
      const e = (q.x / 20) ** 2 + (q.y / 10) ** 2;
      expect(Math.abs(e - 1)).toBeLessThan(0.002);
    });
  });

  test('undo عبر JSON: المسار قابل للاستنساخ بلا فقد', () => {
    const p = PM.fromShape({ type: 'circle', cx: 1, cy: 2, r: 3 });
    const clone = JSON.parse(JSON.stringify(p));
    expect(clone).toEqual(p);
    expect(PM.isPath(clone)).toBe(true);
  });
});

describe('PathModel: ملاءمة الأقواس toArcs (لإخراج G2/G3)', () => {
  const sampleErr = (path, prims) => {
    // أقصى انحراف لعينات المنحنى عن أقرب عنصر مُلاءم
    const pd = (p, pr) => pr.kind === 'arc'
      ? Math.abs(Math.hypot(p.x - pr.cx, p.y - pr.cy) - pr.r)
      : (() => {
          const dx = pr.x2 - pr.x1, dy = pr.y2 - pr.y1, L2 = dx * dx + dy * dy;
          const t = L2 > 1e-18 ? Math.max(0, Math.min(1, ((p.x - pr.x1) * dx + (p.y - pr.y1) * dy) / L2)) : 0;
          return Math.hypot(p.x - (pr.x1 + dx * t), p.y - (pr.y1 + dy * t));
        })();
    let worst = 0;
    for (const s of PM.segments(path))
      for (let k = 0; k <= 40; k++) {
        const p = PM.evalSeg(s, k / 40);
        const e = Math.min(...prims.map(pr => pd(p, pr)));
        if (e > worst) worst = e;
      }
    return worst;
  };

  test('دائرة محوّلة → أقواس فقط بنصف قطر مضبوط ومجموع قوسي 360°', () => {
    const p = PM.fromShape({ type: 'circle', cx: 5, cy: -3, r: 25 });
    const prims = PM.toArcs(p, 0.01);
    expect(prims.length).toBeGreaterThan(0);
    let sweep = 0;
    for (const pr of prims) {
      expect(pr.kind).toBe('arc');
      expect(Math.abs(pr.r - 25)).toBeLessThan(0.02);
      expect(Math.hypot(pr.cx - 5, pr.cy + 3)).toBeLessThan(0.02);
      sweep += pr.sweep;
    }
    expect(sweep).toBeCloseTo(2 * Math.PI, 2);
  });

  test('مستطيل → خطوط فقط', () => {
    const p = PM.fromShape({ type: 'rect', x: 0, y: 0, w: 30, h: 20 });
    const prims = PM.toArcs(p, 0.01);
    expect(prims).toHaveLength(4);
    prims.forEach(pr => expect(pr.kind).toBe('line'));
  });

  test('منحنى S حر: سلسلة متصلة تنتهي بطرفَي المسار وانحرافها ≤ التفاوت', () => {
    const p = PM.makePath([
      PM.anchor(0, 0, null, { x: 15, y: 20 }, 'smooth'),
      PM.anchor(40, 0, { x: -15, y: 20 }, { x: 15, y: -20 }, 'smooth'),
      PM.anchor(80, 0, { x: -15, y: -20 }, null, 'smooth'),
    ], false);
    const prims = PM.toArcs(p, 0.01);
    expect(prims.length).toBeGreaterThan(1);
    // الاتصال: نهاية كل عنصر = بداية التالي، والطرفان مضبوطان
    for (let i = 1; i < prims.length; i++) {
      expect(prims[i].x1).toBeCloseTo(prims[i - 1].x2, 9);
      expect(prims[i].y1).toBeCloseTo(prims[i - 1].y2, 9);
    }
    expect(dist({ x: prims[0].x1, y: prims[0].y1 }, { x: 0, y: 0 })).toBeLessThan(1e-6);
    const last = prims[prims.length - 1];
    expect(dist({ x: last.x2, y: last.y2 }, { x: 80, y: 0 })).toBeLessThan(1e-6);
    expect(sampleErr(p, prims)).toBeLessThan(0.015);
  });

  test('عدد الأقواس أقل بكثير من نقاط التفليط بنفس الدقة', () => {
    const p = PM.fromShape({ type: 'circle', cx: 0, cy: 0, r: 100 });
    const prims = PM.toArcs(p, 0.01);
    const flat = PM.flatten(p, 0.01).points;
    expect(prims.length).toBeLessThan(flat.length / 5);
  });
});

describe('PathModel: أقرب نقطة والقلم', () => {
  test('nearest يجد أقرب نقطة على دائرة', () => {
    const p = PM.fromShape({ type: 'circle', cx: 0, cy: 0, r: 10 });
    const n = PM.nearest(p, { x: 30, y: 0 });
    expect(n.dist).toBeCloseTo(20, 2);
    expect(dist(n.pt, { x: 10, y: 0 })).toBeLessThan(0.05);
  });

  test('fromPenNodes: عقدة مسحوبة = smooth بمقبضين متعاكسين', () => {
    const p = PM.fromPenNodes([
      { x: 0, y: 0, ho: { x: 5, y: 0 } },
      { x: 10, y: 10, ho: { x: 0, y: 0 } },
    ], false);
    expect(p.anchors[0].kind).toBe('smooth');
    expect(p.anchors[0].hin).toEqual({ x: 0, y: 0 });   // طرف مفتوح — بلا داخل
    expect(p.anchors[1].kind).toBe('corner');
  });
});
