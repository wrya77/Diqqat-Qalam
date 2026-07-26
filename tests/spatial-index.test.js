'use strict';
/**
 * اختبارات الفهرس المكاني (P3): تطابق نتائج الاستعلام مع المسح الخطي (brute force)
 * على أشكال عشوائية، صحّة الإدراج/الحذف/التحديث، والأداء على 2000 كيان.
 */
const SpatialIndex = require('../shared/SpatialIndex');

/* مولّد عشوائي حتمي (LCG) كي تكون الاختبارات قابلة لإعادة الإنتاج */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}
function makeItems(n, rand, span) {
  span = span || 1000;
  const items = [];
  for (let i = 0; i < n; i++) {
    const x = rand() * span, y = rand() * span;
    const w = 1 + rand() * 40, h = 1 + rand() * 40;
    items.push({ id: i, minX: x, minY: y, maxX: x + w, maxY: y + h });
  }
  return items;
}
function bruteRegion(items, r) {
  const R = { minX: Math.min(r.minX, r.maxX), minY: Math.min(r.minY, r.maxY),
              maxX: Math.max(r.minX, r.maxX), maxY: Math.max(r.minY, r.maxY) };
  return items.filter(it => it.minX <= R.maxX && it.maxX >= R.minX && it.minY <= R.maxY && it.maxY >= R.minY)
              .map(it => it.id).sort((a, b) => a - b);
}
const idset = (arr) => arr.map(it => it.id).sort((a, b) => a - b);

describe('SpatialIndex — تطابق نتائج queryRegion مع المسح الخطي', () => {
  test('300 شكل × 200 استعلام عشوائي: نتائج متطابقة تماماً', () => {
    const rand = rng(42);
    const items = makeItems(300, rand);
    const idx = new SpatialIndex().build(items);
    for (let q = 0; q < 200; q++) {
      const x = rand() * 1000, y = rand() * 1000;
      const w = rand() * 200, h = rand() * 200;
      const range = { minX: x, minY: y, maxX: x + w, maxY: y + h };
      expect(idset(idx.queryRegion(range))).toEqual(bruteRegion(items, range));
    }
  });

  test('queryPoint يطابق المسح الخطي حول نقطة', () => {
    const rand = rng(7);
    const items = makeItems(250, rand);
    const idx = new SpatialIndex().build(items);
    for (let q = 0; q < 100; q++) {
      const x = rand() * 1000, y = rand() * 1000, pad = rand() * 20;
      const got = idset(idx.queryPoint(x, y, pad));
      const exp = bruteRegion(items, { minX: x - pad, minY: y - pad, maxX: x + pad, maxY: y + pad });
      expect(got).toEqual(exp);
    }
  });
});

describe('SpatialIndex — إدراج/حذف/تحديث تزايُدي', () => {
  test('remove يُزيل العنصر من كل الاستعلامات', () => {
    const idx = new SpatialIndex().build(makeItems(100, rng(1)));
    expect(idx.size).toBe(100);
    idx.remove(50);
    expect(idx.size).toBe(99);
    const hit = idx.queryPoint(1e9, 1e9, 0); // بعيد — لا شيء
    expect(hit).toEqual([]);
    const all = idx.queryRegion({ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 });
    expect(all.find(it => it.id === 50)).toBeUndefined();
  });

  test('update ينقل العنصر لموضعه الجديد', () => {
    const idx = new SpatialIndex().build(makeItems(80, rng(2)));
    idx.update({ id: 10, minX: 5000, minY: 5000, maxX: 5010, maxY: 5010 });
    const near = idset(idx.queryPoint(5005, 5005, 10));
    expect(near).toContain(10);
    const old = idx.queryRegion({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 });
    expect(old.find(it => it.id === 10)).toBeUndefined();
  });

  test('insert خارج الحدود ينمّي الجذر ويبقى قابلاً للاستعلام', () => {
    const idx = new SpatialIndex().build(makeItems(40, rng(3), 100));
    idx.insert({ id: 999, minX: 9000, minY: -9000, maxX: 9010, maxY: -8990 });
    expect(idset(idx.queryPoint(9005, -8995, 10))).toContain(999);
  });

  test('يتجاهل العناصر غير الصالحة (NaN/بلا id)', () => {
    const idx = new SpatialIndex().build([
      { id: 0, minX: 0, minY: 0, maxX: 1, maxY: 1 },
      { id: 1, minX: NaN, minY: 0, maxX: 1, maxY: 1 },
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    ]);
    expect(idx.size).toBe(1);
  });
});

describe('SpatialIndex — الأداء (معيار P3: 2000 كيان)', () => {
  test('بناء 2000 كيان ثم 1000 استعلام نقطي أسرع بكثير من المسح الخطي', () => {
    const rand = rng(2026);
    const items = makeItems(2000, rand, 5000);
    const idx = new SpatialIndex().build(items);

    // زمن الفهرس
    const pts = [];
    for (let i = 0; i < 1000; i++) pts.push({ x: rand() * 5000, y: rand() * 5000 });
    const t0 = Date.now();
    let idxTotal = 0;
    for (const p of pts) idxTotal += idx.queryPoint(p.x, p.y, 2).length;
    const tIdx = Date.now() - t0;

    // زمن المسح الخطي المكافئ
    const t1 = Date.now();
    let brTotal = 0;
    for (const p of pts) {
      let c = 0;
      for (const it of items)
        if (it.minX <= p.x + 2 && it.maxX >= p.x - 2 && it.minY <= p.y + 2 && it.maxY >= p.y - 2) c++;
      brTotal += c;
    }
    const tBrute = Date.now() - t1;

    expect(idxTotal).toBe(brTotal);         // نفس النتائج
    expect(tIdx).toBeLessThan(tBrute);      // أسرع من الخطي
    // متوسط المرشّحين المزارين صغير (الفهرس لا يزور كل المشهد)
  });

  test('متوسط حجم مجموعة المرشّحين ≪ n عند استعلام نقطي ضيّق', () => {
    const rand = rng(99);
    const items = makeItems(2000, rand, 5000);
    const idx = new SpatialIndex().build(items);
    let sum = 0, N = 500;
    for (let i = 0; i < N; i++) sum += idx.queryPoint(rand() * 5000, rand() * 5000, 1).length;
    const avg = sum / N;
    expect(avg).toBeLessThan(50);           // ≪ 2000
  });
});
