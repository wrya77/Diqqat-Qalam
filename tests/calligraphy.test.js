'use strict';
const CE = require('../shared/CalligraphyEngine');

// مربع em بسيط (وحدات الخط، y لأعلى): 100×200
const SQUARE = [
  { type: 'M', x: 0,   y: 0   },
  { type: 'L', x: 100, y: 0   },
  { type: 'L', x: 100, y: 200 },
  { type: 'L', x: 0,   y: 200 },
  { type: 'Z' },
];

describe('CalligraphyEngine.flatten', () => {
  test('يحوّل أوامر المضلّع إلى كنتور مغلق', () => {
    const cs = CE.flatten(SQUARE, 1);
    expect(cs.length).toBe(1);
    const c = cs[0];
    // Z يُعيد نقطة البداية → 5 نقاط
    expect(c.length).toBe(5);
    expect(c[0]).toEqual({ x: 0, y: 0 });
    expect(c[c.length - 1]).toEqual({ x: 0, y: 0 });
  });

  test('يسطّح منحنى تربيعي إلى عدة قطع بين الطرفين', () => {
    const cmds = [
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 50, y1: 100, x: 100, y: 0 },
    ];
    const c = CE.flatten(cmds, 0.5)[0];
    expect(c.length).toBeGreaterThan(2);
    expect(c[0]).toEqual({ x: 0, y: 0 });
    const last = c[c.length - 1];
    expect(last.x).toBeCloseTo(100, 3);
    expect(last.y).toBeCloseTo(0, 3);
    // القمة يجب أن تتجاوز نصف ارتفاع نقطة التحكم
    expect(Math.max(...c.map(p => p.y))).toBeGreaterThan(20);
  });

  test('تساهل أقل ⇒ نقاط أكثر', () => {
    const cmds = [{ type: 'M', x: 0, y: 0 }, { type: 'C', x1: 0, y1: 100, x2: 100, y2: 100, x: 100, y: 0 }];
    const coarse = CE.flatten(cmds, 5)[0].length;
    const fine   = CE.flatten(cmds, 0.1)[0].length;
    expect(fine).toBeGreaterThan(coarse);
  });
});

describe('CalligraphyEngine.signedArea', () => {
  test('عكس عقارب الساعة (y لأعلى) ⇒ موجب', () => {
    expect(CE.signedArea([{x:0,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}])).toBeGreaterThan(0);
  });
  test('عقارب الساعة ⇒ سالب', () => {
    expect(CE.signedArea([{x:0,y:0},{x:0,y:200},{x:100,y:200},{x:100,y:0}])).toBeLessThan(0);
  });
});

describe('CalligraphyEngine.layout', () => {
  test('يقيس حسب الارتفاع ويضع الحروف بتقدّم RTL', () => {
    const res = CE.layout({
      run: [
        { glyphId: 1, ax: 120, ay: 0, dx: 0, dy: 0 },
        { glyphId: 1, ax: 120, ay: 0, dx: 0, dy: 0 },
      ],
      glyphPaths: { 1: SQUARE },
      unitsPerEm: 1000,
      heightMM: 20,
    });
    expect(res.glyphCount).toBe(2);
    expect(res.contourCount).toBe(2);
    expect(res.scale).toBeCloseTo(0.1, 4);   // 20mm / 200 units
    expect(res.height).toBeCloseTo(20, 3);
    expect(res.width).toBeCloseTo(22, 3);     // (120 + 100) * 0.1
    // الأصل منقول إلى (0,0)
    let minX = Infinity, minY = Infinity;
    for (const c of res.contours) for (const p of c) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
    expect(minX).toBeCloseTo(0, 6);
    expect(minY).toBeCloseTo(0, 6);
  });

  test('إدخال فارغ ⇒ نتيجة فارغة آمنة', () => {
    const res = CE.layout({ run: [], glyphPaths: {}, unitsPerEm: 1000, heightMM: 20 });
    expect(res.contours.length).toBe(0);
    expect(res.width).toBe(0);
  });
});

describe('CalligraphyEngine.contoursToShapes', () => {
  test('يحذف نقطة الإغلاق المكرّرة ويُنتج مضلّعات', () => {
    const shapes = CE.contoursToShapes([
      [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10},{x:0,y:0}],
    ], { feedRate: 800 });
    expect(shapes.length).toBe(1);
    expect(shapes[0].type).toBe('polygon');
    expect(shapes[0].points.length).toBe(4);   // النقطة المكرّرة محذوفة
    expect(shapes[0].feedRate).toBe(800);
  });

  test('يتجاهل الكنتورات الصغيرة جداً', () => {
    expect(CE.contoursToShapes([[{x:0,y:0},{x:1,y:1}]], {}).length).toBe(0);
  });
});

describe('CalligraphyEngine.listFonts', () => {
  test('يضم الأنماط الأربعة', () => {
    const ids = CE.listFonts().map(f => f.id);
    expect(ids).toEqual(expect.arrayContaining(['amiri', 'cairo', 'reem', 'ruqaa']));
  });
});
