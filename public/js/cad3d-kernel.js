/**
 * cad3d-kernel.js — النواة الهندسية ثلاثية الأبعاد (بلا DOM وبلا Three.js)
 *
 * ما تقدّمه:
 *  • CSG حقيقي بشجرة BSP — اتحاد/طرح/تقاطع بين مجسّمات مثلّثية (نواة برامج الكاد).
 *  • جسر ذهاباً وإياباً مع BufferGeometry من Three.
 *  • قياسات: الحجم · مساحة السطح · الصندوق الحاوي · مركز الكتلة.
 *  • تصدير STL (ثنائي) وOBJ، واستيراد STL (ثنائي ونصّي).
 *
 * لماذا BSP: هو ما تستعمله نوى النمذجة المضلّعة (OpenSCAD, csg.js). يقسّم كل
 * مجسّم بمستويات أوجه الآخر فيصير التقاطع مسألة تصنيف داخل/خارج بلا حساب
 * تقاطعات هشّة. ثمنه ذاكرةٌ ووقت أُسّيّان مع كثافة المثلّثات — لذلك حدّ أقصى
 * معلن أدناه بدل انهيار صامت.
 *
 * الوحدات: مليمترات، ومحور Z إلى الأعلى (اصطلاح CNC) — العرض يتكفّل بالتدوير.
 */
(function cad3dKernel() {
  'use strict';

  const EPS = 1e-5;
  const MAX_TRIS = 120000;   // فوقها ترفض العملية بدل أن تجمّد المتصفّح

  /* ══════════════ رأس ومستوٍ ومضلّع ══════════════ */

  function V(x, y, z, n) {
    return { x, y, z, n: n || { x: 0, y: 0, z: 1 } };
  }
  const vclone = v => ({ x: v.x, y: v.y, z: v.z, n: { x: v.n.x, y: v.n.y, z: v.n.z } });
  const vflip  = v => { v.n.x = -v.n.x; v.n.y = -v.n.y; v.n.z = -v.n.z; return v; };
  const vlerp  = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
    n: { x: a.n.x + (b.n.x - a.n.x) * t, y: a.n.y + (b.n.y - a.n.y) * t, z: a.n.z + (b.n.z - a.n.z) * t },
  });

  /* مستوٍ بصيغة n·p = w */
  function planeFrom(a, b, c) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) return null;                 // مثلّث منهار — يُسقَط
    nx /= L; ny /= L; nz /= L;
    return { x: nx, y: ny, z: nz, w: nx * a.x + ny * a.y + nz * a.z };
  }
  const planeFlip = p => ({ x: -p.x, y: -p.y, z: -p.z, w: -p.w });

  const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

  /**
   * يقسّم مضلّعاً بمستوٍ ويوزّعه على السلال الأربع.
   * هذا قلب الخوارزمية كلّها؛ أي خطأ هنا يُنتج مجسّمات مثقوبة.
   */
  function splitPolygon(plane, poly, cpFront, cpBack, front, back) {
    let polyType = 0;
    const types = [];
    for (const v of poly.verts) {
      const t = plane.x * v.x + plane.y * v.y + plane.z * v.z - plane.w;
      const type = t < -EPS ? BACK : (t > EPS ? FRONT : COPLANAR);
      polyType |= type;
      types.push(type);
    }

    if (polyType === COPLANAR) {
      const d = plane.x * poly.plane.x + plane.y * poly.plane.y + plane.z * poly.plane.z;
      (d > 0 ? cpFront : cpBack).push(poly);
      return;
    }
    if (polyType === FRONT) { front.push(poly); return; }
    if (polyType === BACK)  { back.push(poly);  return; }

    const f = [], b = [];
    const n = poly.verts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ti = types[i], tj = types[j];
      const vi = poly.verts[i], vj = poly.verts[j];
      if (ti !== BACK)  f.push(vi);
      if (ti !== FRONT) b.push(ti !== BACK ? vclone(vi) : vi);
      if ((ti | tj) === SPANNING) {
        const denom = plane.x * (vj.x - vi.x) + plane.y * (vj.y - vi.y) + plane.z * (vj.z - vi.z);
        const t = (plane.w - (plane.x * vi.x + plane.y * vi.y + plane.z * vi.z)) / denom;
        const v = vlerp(vi, vj, t);
        f.push(v); b.push(vclone(v));
      }
    }
    if (f.length >= 3) front.push(mkPoly(f));
    if (b.length >= 3) back.push(mkPoly(b));
  }

  function mkPoly(verts) {
    const p = planeFrom(verts[0], verts[1], verts[2]);
    return p ? { verts, plane: p } : null;
  }
  const okPoly = p => !!p;

  /* ══════════════ عقدة BSP ══════════════ */

  function Node(polys) {
    this.plane = null; this.front = null; this.back = null; this.polys = [];
    if (polys && polys.length) this.build(polys);
  }

  Node.prototype.invert = function () {
    // معالجة تكرارية بمكدس — العمق قد يبلغ آلاف المستويات فينفجر المكدس الأصلي
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      for (const p of n.polys) { p.verts.reverse().forEach(vflip); p.plane = planeFlip(p.plane); }
      if (n.plane) n.plane = planeFlip(n.plane);
      const t = n.front; n.front = n.back; n.back = t;
      if (n.front) stack.push(n.front);
      if (n.back)  stack.push(n.back);
    }
    return this;
  };

  Node.prototype.clipPolygons = function (polys) {
    if (!this.plane) return polys.slice();
    let front = [], back = [];
    for (const p of polys) splitPolygon(this.plane, p, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  };

  Node.prototype.clipTo = function (bsp) {
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      n.polys = bsp.clipPolygons(n.polys);
      if (n.front) stack.push(n.front);
      if (n.back)  stack.push(n.back);
    }
    return this;
  };

  Node.prototype.allPolygons = function () {
    const out = [], stack = [this];
    while (stack.length) {
      const n = stack.pop();
      for (const p of n.polys) out.push(p);
      if (n.front) stack.push(n.front);
      if (n.back)  stack.push(n.back);
    }
    return out;
  };

  Node.prototype.build = function (polys) {
    // تكرارية بمكدس لنفس سبب invert
    const stack = [[this, polys]];
    while (stack.length) {
      const [node, list] = stack.pop();
      if (!list.length) continue;
      if (!node.plane) node.plane = list[0].plane;
      const front = [], back = [];
      for (const p of list) splitPolygon(node.plane, p, node.polys, node.polys, front, back);
      if (front.length) { node.front = node.front || new Node(); stack.push([node.front, front]); }
      if (back.length)  { node.back  = node.back  || new Node(); stack.push([node.back,  back]); }
    }
    return this;
  };

  /* ══════════════ العمليات الثلاث ══════════════ */

  function guard(a, b) {
    const n = a.length + b.length;
    if (n > MAX_TRIS) {
      const e = new Error(`المجسّمان فيهما ${n} وجهاً — فوق الحدّ ${MAX_TRIS}. بسّط الشبكة أوّلاً.`);
      e.code = 'TOO_DENSE';
      throw e;
    }
  }

  function csgUnion(a, b) {
    guard(a, b);
    const A = new Node(a.map(clonePoly)), B = new Node(b.map(clonePoly));
    A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
    A.build(B.allPolygons());
    return A.allPolygons();
  }

  function csgSubtract(a, b) {
    guard(a, b);
    const A = new Node(a.map(clonePoly)), B = new Node(b.map(clonePoly));
    A.invert(); A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
    A.build(B.allPolygons()); A.invert();
    return A.allPolygons();
  }

  function csgIntersect(a, b) {
    guard(a, b);
    const A = new Node(a.map(clonePoly)), B = new Node(b.map(clonePoly));
    A.invert(); B.clipTo(A); B.invert(); A.clipTo(B); B.clipTo(A);
    A.build(B.allPolygons()); A.invert();
    return A.allPolygons();
  }

  const clonePoly = p => ({ verts: p.verts.map(vclone), plane: { ...p.plane } });

  /* ══════════════ الجسر مع Three ══════════════ */

  /** BufferGeometry (+ مصفوفة تحويل اختيارية) ← مضلّعات */
  function fromGeometry(geom, matrix) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal ? g.attributes.normal.array : null;
    const m = matrix || null;
    // مصفوفة الاتجاهات للنواظم = معكوس منقول الجزء 3×3
    let nm = null;
    if (m) { nm = new THREE.Matrix3().getNormalMatrix(m); }
    const v3 = new THREE.Vector3(), n3 = new THREE.Vector3();
    const polys = [];
    for (let i = 0; i < pos.length; i += 9) {
      const vs = [];
      for (let k = 0; k < 3; k++) {
        const o = i + k * 3;
        v3.set(pos[o], pos[o + 1], pos[o + 2]);
        if (m) v3.applyMatrix4(m);
        if (nor) { n3.set(nor[o], nor[o + 1], nor[o + 2]); if (nm) n3.applyMatrix3(nm).normalize(); }
        else n3.set(0, 0, 1);
        vs.push(V(v3.x, v3.y, v3.z, { x: n3.x, y: n3.y, z: n3.z }));
      }
      const p = mkPoly(vs);
      if (okPoly(p)) polys.push(p);
    }
    return polys;
  }

  /** مضلّعات ← BufferGeometry (مثلّثات، غير مفهرسة) */
  function toGeometry(polys) {
    const pos = [], nor = [];
    for (const p of polys) {
      for (let i = 2; i < p.verts.length; i++) {         // مروحة مثلّثات
        const tri = [p.verts[0], p.verts[i - 1], p.verts[i]];
        for (const v of tri) {
          pos.push(v.x, v.y, v.z);
          nor.push(p.plane.x, p.plane.y, p.plane.z);      // ناظم الوجه: حوافّ حادّة كالكاد
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  const triCount = polys => polys.reduce((s, p) => s + Math.max(0, p.verts.length - 2), 0);

  /* ══════════════ القياسات ══════════════ */

  /** حجم مغلق موجّه — مجموع أحجام رباعيّات السطوح من المبدأ */
  function volume(polys) {
    let v = 0;
    for (const p of polys) {
      for (let i = 2; i < p.verts.length; i++) {
        const a = p.verts[0], b = p.verts[i - 1], c = p.verts[i];
        v += (a.x * (b.y * c.z - b.z * c.y)
            - a.y * (b.x * c.z - b.z * c.x)
            + a.z * (b.x * c.y - b.y * c.x)) / 6;
      }
    }
    return Math.abs(v);
  }

  function surfaceArea(polys) {
    let s = 0;
    for (const p of polys) {
      for (let i = 2; i < p.verts.length; i++) {
        const a = p.verts[0], b = p.verts[i - 1], c = p.verts[i];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      }
    }
    return s;
  }

  function bounds(polys) {
    const b = { minX: Infinity, minY: Infinity, minZ: Infinity,
                maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const p of polys) for (const v of p.verts) {
      if (v.x < b.minX) b.minX = v.x; if (v.x > b.maxX) b.maxX = v.x;
      if (v.y < b.minY) b.minY = v.y; if (v.y > b.maxY) b.maxY = v.y;
      if (v.z < b.minZ) b.minZ = v.z; if (v.z > b.maxZ) b.maxZ = v.z;
    }
    return isFinite(b.minX) ? b : null;
  }

  /** مركز الكتلة لجسم متجانس — بمجموع مراكز رباعيّات السطوح موزونةً بحجومها */
  function centroid(polys) {
    let vx = 0, vy = 0, vz = 0, vt = 0;
    for (const p of polys) {
      for (let i = 2; i < p.verts.length; i++) {
        const a = p.verts[0], b = p.verts[i - 1], c = p.verts[i];
        const d = (a.x * (b.y * c.z - b.z * c.y)
                 - a.y * (b.x * c.z - b.z * c.x)
                 + a.z * (b.x * c.y - b.y * c.x)) / 6;
        vt += d;
        vx += d * (a.x + b.x + c.x) / 4;
        vy += d * (a.y + b.y + c.y) / 4;
        vz += d * (a.z + b.z + c.z) / 4;
      }
    }
    if (Math.abs(vt) < 1e-9) return null;
    return { x: vx / vt, y: vy / vt, z: vz / vt };
  }

  /* ══════════════ STL / OBJ ══════════════ */

  /** STL ثنائي من BufferGeometry — الصيغة القياسية لتبادل الكاد والطباعة */
  function exportSTL(geoms) {
    const tris = [];
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    for (const { geometry, matrix } of geoms) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const pos = g.attributes.position.array;
      const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
      for (let i = 0; i < pos.length; i += 9) {
        const P = [];
        for (let k = 0; k < 3; k++) {
          v.set(pos[i + k * 3], pos[i + k * 3 + 1], pos[i + k * 3 + 2]);
          if (matrix) v.applyMatrix4(matrix);
          P.push(v.x, v.y, v.z);
        }
        nn.set(0, 0, 0);
        const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2];
        const wx = P[6] - P[0], wy = P[7] - P[1], wz = P[8] - P[2];
        nn.set(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
        if (nn.lengthSq() > 0) nn.normalize();
        if (nm) { /* الناظم محسوب من الرؤوس المحوَّلة سلفاً */ }
        tris.push([nn.x, nn.y, nn.z, ...P]);
      }
    }
    const buf = new ArrayBuffer(84 + tris.length * 50);
    const dv = new DataView(buf);
    const head = 'Diqqat Qalam CAD — binary STL';
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) : 32);
    dv.setUint32(80, tris.length, true);
    let o = 84;
    for (const t of tris) {
      for (let i = 0; i < 12; i++) { dv.setFloat32(o, t[i], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }

  function exportOBJ(geoms, names) {
    const L = ['# Diqqat Qalam CAD'];
    let base = 1;
    const v = new THREE.Vector3();
    geoms.forEach(({ geometry, matrix }, gi) => {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const pos = g.attributes.position.array;
      L.push('o ' + ((names && names[gi]) || ('solid' + (gi + 1))));
      for (let i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]);
        if (matrix) v.applyMatrix4(matrix);
        L.push(`v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`);
      }
      const n = pos.length / 3;
      for (let i = 0; i < n; i += 3) L.push(`f ${base + i} ${base + i + 1} ${base + i + 2}`);
      base += n;
    });
    return L.join('\n');
  }

  /** استيراد STL — يكشف الثنائي من النصّي تلقائياً */
  function importSTL(buffer) {
    const dv = new DataView(buffer);
    const n = buffer.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    const binaryLen = 84 + n * 50;
    // الفحص الحاسم: هل يطابق الطول المعلن حجم الملف؟ الترويسة قد تبدأ بـsolid
    // في ملفات ثنائية أيضاً، فلا يصحّ الاعتماد عليها وحدها.
    const isBinary = n > 0 && binaryLen === buffer.byteLength;
    const pos = [];
    if (isBinary) {
      let o = 84;
      for (let i = 0; i < n; i++) {
        o += 12;                                   // الناظم يُعاد حسابه
        for (let k = 0; k < 9; k++) { pos.push(dv.getFloat32(o, true)); o += 4; }
        o += 2;
      }
    } else {
      const txt = new TextDecoder().decode(buffer);
      const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
      let m;
      while ((m = re.exec(txt))) pos.push(+m[1], +m[2], +m[3]);
    }
    if (pos.length < 9) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  window.CAD3DKernel = {
    EPS, MAX_TRIS,
    fromGeometry, toGeometry, triCount,
    union: csgUnion, subtract: csgSubtract, intersect: csgIntersect,
    volume, surfaceArea, bounds, centroid,
    exportSTL, exportOBJ, importSTL,
  };
})();
