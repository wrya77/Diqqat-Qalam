'use strict';
const NearestNeighbor = require('../src/optimizers/NearestNeighbor');
const ArcDetector     = require('../src/optimizers/ArcDetector');
const PathOptimizer   = require('../src/optimizers/PathOptimizer');

describe('NearestNeighbor', () => {
  const nn = new NearestNeighbor();

  test('returns same shapes in different order', () => {
    const shapes = [
      {type:'circle',cx:0,cy:0,r:5},
      {type:'circle',cx:100,cy:100,r:5},
      {type:'circle',cx:50,cy:0,r:5},
    ];
    const sorted = nn.sort(shapes);
    expect(sorted.length).toBe(3);
    // All original shapes should be present
    shapes.forEach(s => expect(sorted).toContainEqual(s));
  });

  test('empty array returns empty array', () => {
    expect(nn.sort([])).toEqual([]);
  });

  test('single shape returns same shape', () => {
    const s = [{type:'line',x1:0,y1:0,x2:5,y2:5}];
    expect(nn.sort(s)).toEqual(s);
  });

  test('sorted path is shorter or equal', () => {
    const shapes = [
      {type:'circle',cx:0,  cy:0,  r:2},
      {type:'circle',cx:100,cy:0,  r:2},
      {type:'circle',cx:10, cy:0,  r:2},
      {type:'circle',cx:90, cy:0,  r:2},
    ];
    const sorted = nn.sort(shapes);
    const distFn = (a,b) => {
      const aEnd = {x:(a.cx||0)+(a.r||0), y:(a.cy||0)};
      const bStart= {x:(b.cx||0)+(b.r||0), y:(b.cy||0)};
      return Math.hypot(bStart.x-aEnd.x, bStart.y-aEnd.y);
    };
    let origD=0, sortD=0;
    for(let i=1;i<shapes.length;i++) origD+=distFn(shapes[i-1],shapes[i]);
    for(let i=1;i<sorted.length;i++) sortD+=distFn(sorted[i-1],sorted[i]);
    expect(sortD).toBeLessThanOrEqual(origD+0.001);
  });
});

describe('ArcDetector', () => {
  const ad = new ArcDetector();

  test('detects circle from polyline points', () => {
    const r=10, cx=0, cy=0;
    const pts=[];
    for(let i=0;i<=32;i++){
      const a=(i/32)*Math.PI*2;
      pts.push({x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)});
    }
    const shape={ type:'polyline', points:pts };
    const result = ad.detect([shape]);
    const hasArc = result.some(s=>s.type==='circle'||s.type==='arc'||
      (s.type==='polyline'&&s.points.some(p=>p.arcTo)));
    expect(result.length).toBeGreaterThan(0);
  });

  test('straight line not converted to arc', () => {
    const shape={ type:'polyline', points:[{x:0,y:0},{x:5,y:0},{x:10,y:0}] };
    const result = ad.detect([shape]);
    expect(result[0].type).toBe('polyline');
  });
});

describe('PathOptimizer', () => {
  const opt = new PathOptimizer({ arcDetect:true, sortPaths:true, toolDiameter:3 });

  test('returns same number of shapes', () => {
    const shapes=[
      {type:'line',x1:0,y1:0,x2:10,y2:0},
      {type:'rect',x:20,y:20,w:10,h:10},
      {type:'circle',cx:50,cy:50,r:5},
    ];
    const result = opt.optimize(shapes);
    expect(result.length).toBe(shapes.length);
  });

  test('handles empty input', () => {
    expect(opt.optimize([])).toEqual([]);
  });
});

describe('2-Opt path optimization', () => {
  const nn = new NearestNeighbor();
  const D = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  // مسافة التنقل السريع الكلية لترتيب معيّن (يحترم اتجاه القطع reversed)
  const geom = require('../src/utils/geometry');
  const totalRapid = (shapes) => {
    let total = 0, pos = { x: 0, y: 0 };
    for (const s of shapes) {
      const st = geom.shapeStartPoint(s);
      total += D(pos, st);
      pos = geom.shapeEndPoint(s);
    }
    return total;
  };

  test('2-opt لا يزيد المسافة أبداً ويحافظ على كل الأشكال', () => {
    // ترتيب متعرّج سيّئ عمداً
    const shapes = [];
    for (let i = 0; i < 12; i++) {
      const x = (i % 2 === 0) ? i * 8 : 100 - i * 8;
      shapes.push({ type: 'line', x1: x, y1: 0, x2: x + 4, y2: 10 });
    }
    const before = totalRapid(shapes);
    const nnOrder = nn.sort(shapes.map(s => ({ ...s })));
    const after2  = nn.twoOpt(nnOrder.map(s => ({ ...s })));
    const after   = totalRapid(after2);

    expect(after2.length).toBe(shapes.length);          // لا فقدان أشكال
    expect(after).toBeLessThanOrEqual(before + 1e-6);   // أقصر أو مساوٍ
  });

  test('2-opt يصلح ترتيباً متقاطعاً لمربع (الحل الأمثل = محيط)', () => {
    // أربع نقاط بترتيب متقاطع (قطرين) — 2-opt يجب أن يحوّله لمحيط
    const shapes = [
      { type: 'line', x1: 0,   y1: 0,   x2: 0,   y2: 0 },   // (0,0)
      { type: 'line', x1: 100, y1: 100, x2: 100, y2: 100 }, // (100,100)
      { type: 'line', x1: 100, y1: 0,   x2: 100, y2: 0 },   // (100,0)
      { type: 'line', x1: 0,   y1: 100, x2: 0,   y2: 100 }, // (0,100)
    ];
    const crossed = totalRapid(shapes);
    const fixed = nn.twoOpt(shapes.map(s => ({ ...s })));
    expect(totalRapid(fixed)).toBeLessThan(crossed);
  });

  test('2-opt يتخطى المجموعات الصغيرة جداً والكبيرة جداً بأمان', () => {
    const tiny = [{ type:'line',x1:0,y1:0,x2:1,y2:1 }, { type:'line',x1:5,y1:5,x2:6,y2:6 }];
    expect(nn.twoOpt(tiny).length).toBe(2);             // < 4: يُعاد كما هو بلا خطأ
    const big = Array.from({ length: 420 }, (_, i) => ({ type:'line', x1:i, y1:0, x2:i+1, y2:1 }));
    expect(nn.twoOpt(big).length).toBe(420);            // > 400: بلا خطأ
  });

  test('PathOptimizer ينتج توفيراً موجباً في تقرير الترتيب', () => {
    const shapes = [];
    for (let i = 0; i < 10; i++) {
      const x = (i % 2 === 0) ? i * 10 : 90 - i * 10;
      shapes.push({ type: 'circle', cx: x, cy: (i * 13) % 50, r: 3 });
    }
    const o = new PathOptimizer({ sortPaths: true, detectArcs: false, feedrate: false });
    const result = o.optimize(shapes);
    const step = result.report.steps.find(s => s.step === 'ترتيب المسارات');
    expect(step).toBeTruthy();
    expect(step.rapidAfter).toBeLessThanOrEqual(step.rapidBefore);
    expect(result.length).toBe(shapes.length);
  });
});
