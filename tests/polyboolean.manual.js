/**
 * اختبار يدوي لـ PolyBoolean — يقيس مساحة النتيجة بأخذ عيّنات شبكية
 * بقاعدة even-odd (مستقلّة عن اتجاه المسار) ويقارنها بقيم معروفة تحليلياً.
 * يشغَّل: node tests/polyboolean.manual.js
 */
const PB = require('../shared/PolyBoolean');

function rect(x0, y0, x1, y1) { return [[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]]; }

// مساحة المنطقة الناتجة عبر أخذ عيّنات شبكية (even-odd)
function area(polys, step = 0.05) {
  if (!polys.length) return 0;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const r of polys) for (const p of r) {
    minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
  }
  let inside = 0, total = 0;
  for (let x=minX+step/2; x<maxX; x+=step)
    for (let y=minY+step/2; y<maxY; y+=step) {
      total++;
      if (PB._pointInPolys(x, y, polys)) inside++;
    }
  return (inside/total) * (maxX-minX) * (maxY-minY);
}

let pass = 0, fail = 0;
function check(name, got, expected, tol = expected*0.03 + 0.5) {
  const ok = Math.abs(got - expected) <= tol;
  (ok ? (pass++) : (fail++));
  console.log(`${ok?'✓':'✗'} ${name}: got ${got.toFixed(2)} expected ${expected} (±${tol.toFixed(2)})`);
}

/* 1) مربّعان متداخلان: A=[0,10]² , B=[5,15]² (تداخل 25) */
const A = rect(0,0,10,10), B = rect(5,5,15,15);
check('overlap union',      area(PB.union(A,B)),      175);
check('overlap intersect',  area(PB.intersect(A,B)),  25);
check('overlap difference', area(PB.difference(A,B)), 75);
check('overlap xor',        area(PB.xor(A,B)),        150);

/* 2) احتواء: كبير [0,20]² , صغير [5,10]² داخله */
const Big = rect(0,0,20,20), Small = rect(5,5,10,10);
check('contain union',      area(PB.union(Big,Small)),      400);
check('contain intersect',  area(PB.intersect(Big,Small)),  25);
check('contain difference (ring/hole)', area(PB.difference(Big,Small)), 375);

/* 3) منفصلان تماماً */
const D1 = rect(0,0,10,10), D2 = rect(20,20,30,30);
check('disjoint union',      area(PB.union(D1,D2)),      200);
check('disjoint intersect',  area(PB.intersect(D1,D2)),  0);
check('disjoint difference', area(PB.difference(D1,D2)), 100);

/* 4) مثلّث × مربّع (غير محوري) */
const tri = [[{x:0,y:0},{x:20,y:0},{x:10,y:20}]];          // مساحة 200
const sq  = rect(5,-5,15,5);                                 // يقطع قاعدة المثلّث
const ti  = area(PB.intersect(tri, sq));
console.log(`  (مثلّث∩مربّع = ${ti.toFixed(2)})`);
check('triangle∩square > 0', ti > 10 ? 1 : 0, 1, 0.1);

console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
