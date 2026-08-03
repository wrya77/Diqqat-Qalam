/**
 * cad3d-ops.js — عمليات النمذجة المتقدّمة وجسر التصنيع
 *
 *  تفريغ · مرآة · مصفوفة خطّية ودائرية · لولب · تقطيع بمستوى · غلاف محدّب
 *  تسميك · تبسيط شبكة · توسيط · وخريطة ارتفاعات تُولّد مسار تخشين ثلاثيّ
 *  المحاور بصيغة G-Code، وإسقاط ظلّ المجسّم إلى مخطّط ثنائيّ في المحرّر.
 *
 *  كلّها تعمل على BufferGeometry غير مفهرسة (مثلّثات صريحة) لتتوافق مع نواة
 *  CSG. الوحدات مليمترات وZ إلى الأعلى.
 */
(function cad3dOps() {
  'use strict';

  const K = () => window.CAD3DKernel;

  /* ══════════════ أدوات مشتركة ══════════════ */

  const tris = g => {
    const n = g.index ? g.toNonIndexed() : g;
    return n.attributes.position.array;
  };

  function geomFrom(pos) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  /** يدمج شبكات في واحدة (بعد تطبيق مصفوفة كلٍّ منها إن وُجدت) */
  function merge(list) {
    const pos = [], v = new THREE.Vector3();
    for (const it of list) {
      const g = it.geometry || it;
      const m = it.matrix || null;
      const a = tris(g);
      for (let i = 0; i < a.length; i += 3) {
        v.set(a[i], a[i + 1], a[i + 2]);
        if (m) v.applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
      }
    }
    return pos.length ? geomFrom(pos) : null;
  }

  /* ══════════════ ١ · تسميك وإزاحة السطح ══════════════ */

  /**
   * يزيح كل رأس على ناظمه المتوسّط بمقدار d.
   * الناظم المتوسّط يُحسب بجمع نواظم الأوجه المشتركة في الرأس — لذلك يلزم
   * تجميع الرؤوس المتطابقة أوّلاً، وإلّا تحرّك كل مثلّث وحده وتفكّك الشبكة.
   */
  function offsetSurface(geometry, d) {
    const a = tris(geometry);
    const key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    const acc = new Map();
    for (let i = 0; i < a.length; i += 9) {
      const ax = a[i], ay = a[i + 1], az = a[i + 2];
      const bx = a[i + 3], by = a[i + 4], bz = a[i + 5];
      const cx = a[i + 6], cy = a[i + 7], cz = a[i + 8];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx - ax, wy = cy - ay, wz = cz - az;
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L; ny /= L; nz /= L;
      // النواظم تُجمَّع **فريدةً** لا لكل مثلّث: الوجه المستوي الواحد قد
      // ينقسم إلى مثلّثين فيُحسب مرّتين، فينحرف اتجاه المنصّف وتختلّ السماكة.
      const nk = `${Math.round(nx * 1e3)},${Math.round(ny * 1e3)},${Math.round(nz * 1e3)}`;
      for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
        const k = key(x, y, z);
        let e = acc.get(k);
        if (!e) { e = new Map(); acc.set(k, e); }
        if (!e.has(nk)) e.set(nk, [nx, ny, nz]);
      }
    }
    /**
     * لكل رأس: نحلّ موضعه الجديد بحيث يقع على **كل** مستوياته وقد أُزيحت d.
     *   nᵢ·p = nᵢ·v + d   لكل مستوٍ i
     * بالمعادلات الطبيعية (AᵀA)p = Aᵀb مع تنظيم تيخونوف يجذب الحلّ نحو v حين
     * تكون المستويات ناقصة الرتبة (سطح مستوٍ = مستوٍ واحد فقط).
     * هذا يُعطي السماكة الصحيحة مهما تكرّرت النواظم أو تقاربت — وهو ما يفشل
     * فيه متوسّط النواظم عند حافّة الأسطوانة (وجهان جانبيّان شبه متوازيين).
     */
    const pos = new Array(a.length);
    const solved = new Map();
    for (let i = 0; i < a.length; i += 3) {
      const k = key(a[i], a[i + 1], a[i + 2]);
      let p = solved.get(k);
      if (!p) {
        const e = acc.get(k);
        const v = [a[i], a[i + 1], a[i + 2]];
        if (!e || !e.size) { p = v; }
        else {
          const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 0, 0];
          for (const n of e.values()) {
            const rhs = n[0] * v[0] + n[1] * v[1] + n[2] * v[2] + d;
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < 3; c++) A[r * 3 + c] += n[r] * n[c];
              b[r] += n[r] * rhs;
            }
          }
          const lam = 1e-4 * Math.max(1e-9, A[0] + A[4] + A[8]);
          for (let r = 0; r < 3; r++) { A[r * 3 + r] += lam; b[r] += lam * v[r]; }
          p = solve3(A, b) || v;
          // حارس: قفزة أكبر من ٤ أضعاف السماكة تعني ركناً شبه منحلّ
          const jump = Math.hypot(p[0] - v[0], p[1] - v[1], p[2] - v[2]);
          const cap = Math.abs(d) * 4 + 1e-6;
          if (jump > cap) {
            const s = cap / jump;
            p = [v[0] + (p[0] - v[0]) * s, v[1] + (p[1] - v[1]) * s, v[2] + (p[2] - v[2]) * s];
          }
        }
        solved.set(k, p);
      }
      pos[i] = p[0]; pos[i + 1] = p[1]; pos[i + 2] = p[2];
    }
    return geomFrom(pos);
  }

  /** حلّ نظام 3×3 بحذف غاوس مع محور جزئيّ */
  function solve3(A, b) {
    const M = [[A[0], A[1], A[2], b[0]], [A[3], A[4], A[5], b[1]], [A[6], A[7], A[8], b[2]]];
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      if (piv !== c) { const t = M[c]; M[c] = M[piv]; M[piv] = t; }
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  /** تفريغ: الأصل ناقص نسخةً مُزاحةً للداخل بسماكة t */
  function shell(geometry, t) {
    const th = Math.max(0.1, +t || 1);
    const inner = offsetSurface(geometry, -th);
    const k = K();
    return k.toGeometry(k.subtract(k.fromGeometry(geometry), k.fromGeometry(inner)));
  }

  /* ══════════════ ٢ · مرآة ══════════════ */

  /** الانعكاس يقلب اتجاه الأوجه، فنعكس ترتيب رؤوس كل مثلّث */
  function mirror(geometry, axis) {
    const a = tris(geometry), pos = [];
    const s = { x: [-1, 1, 1], y: [1, -1, 1], z: [1, 1, -1] }[axis || 'x'];
    for (let i = 0; i < a.length; i += 9) {
      const P = [];
      for (let k = 0; k < 3; k++)
        P.push([a[i + k * 3] * s[0], a[i + k * 3 + 1] * s[1], a[i + k * 3 + 2] * s[2]]);
      pos.push(...P[2], ...P[1], ...P[0]);
    }
    return geomFrom(pos);
  }

  /* ══════════════ ٣ · المصفوفات ══════════════ */

  function linearPattern(geometry, o) {
    const n = Math.max(1, Math.min(200, (o.count | 0) || 3));
    const list = [];
    for (let i = 0; i < n; i++) {
      list.push({ geometry, matrix: new THREE.Matrix4().makeTranslation(
        (+o.dx || 0) * i, (+o.dy || 0) * i, (+o.dz || 0) * i) });
    }
    return merge(list);
  }

  function circularPattern(geometry, o) {
    const n = Math.max(1, Math.min(360, (o.count | 0) || 6));
    const total = (+o.angle || 360) * Math.PI / 180;
    const ax = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[o.axis || 'z'];
    const full = Math.abs((+o.angle || 360) - 360) < 1e-6;
    const step = total / (full ? n : Math.max(1, n - 1));
    const list = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Matrix4().makeRotationAxis(ax, step * i);
      if (+o.radius) m.multiply(new THREE.Matrix4().makeTranslation(+o.radius, 0, 0));
      list.push({ geometry, matrix: m });
    }
    return merge(list);
  }

  /* ══════════════ ٤ · اللولب ══════════════ */

  /** مسار حلزونيّ يُمرَّر لبانية الكنس — منه تُصنع الخيوط والزنبركات */
  function helixPath(o) {
    const r = +o.radius || 20, pitch = +o.pitch || 5;
    const turns = Math.max(0.1, +o.turns || 3);
    const seg = Math.max(8, Math.min(3000, Math.round(turns * (o.segments || 48))));
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, a = t * turns * Math.PI * 2;
      pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), z: t * turns * pitch });
    }
    return pts;
  }

  /* ══════════════ ٥ · التقطيع بمستوٍ ══════════════ */

  /** يعيد {a, b}: الجزءان على جانبَي المستوى — بقصّ CSG بصندوق نصف فضائيّ */
  function splitByPlane(geometry, axis, offset) {
    const k = K();
    const polys = k.fromGeometry(geometry);
    const b = k.bounds(polys);
    if (!b) return null;
    const big = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * 4 + 100;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = (b.minZ + b.maxZ) / 2;
    const off = +offset || 0;
    const half = (sign) => {
      const g = new THREE.BoxGeometry(big, big, big);
      const m = new THREE.Matrix4();
      const p = { x: cx, y: cy, z: cz };
      p[axis] = off + sign * big / 2;
      m.makeTranslation(p.x, p.y, p.z);
      return k.fromGeometry(g, m);
    };
    return {
      a: k.toGeometry(k.intersect(polys, half(-1))),
      b: k.toGeometry(k.intersect(polys, half(+1))),
    };
  }

  /* ══════════════ ٦ · الغلاف المحدّب ══════════════ */

  /**
   * غلاف محدّب تزايديّ: نبدأ برباعيّ سطوح، ثم لكل نقطة خارجه نحذف الأوجه
   * التي «تراها» ونخيط الحدّ الأفقيّ بالنقطة. O(n·f) — يكفي لعشرات الآلاف.
   */
  function convexHull(geometry) {
    const a = tris(geometry);
    const seen = new Set(), P = [];
    for (let i = 0; i < a.length; i += 3) {
      const k = `${Math.round(a[i] * 1e3)},${Math.round(a[i + 1] * 1e3)},${Math.round(a[i + 2] * 1e3)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      P.push(new THREE.Vector3(a[i], a[i + 1], a[i + 2]));
    }
    if (P.length < 4) return null;

    // رباعيّ سطوح ابتدائيّ غير منحلّ
    const i0 = 0;
    let i1 = -1, best = 0;
    for (let i = 1; i < P.length; i++) { const d = P[i].distanceToSquared(P[i0]); if (d > best) { best = d; i1 = i; } }
    if (i1 < 0) return null;
    let i2 = -1; best = 0;
    for (let i = 1; i < P.length; i++) {
      if (i === i1) continue;
      const d = new THREE.Vector3().subVectors(P[i1], P[i0])
        .cross(new THREE.Vector3().subVectors(P[i], P[i0])).lengthSq();
      if (d > best) { best = d; i2 = i; }
    }
    if (i2 < 0) return null;
    const nrm = new THREE.Vector3().subVectors(P[i1], P[i0])
      .cross(new THREE.Vector3().subVectors(P[i2], P[i0])).normalize();
    let i3 = -1; best = 1e-7;
    for (let i = 1; i < P.length; i++) {
      const d = Math.abs(new THREE.Vector3().subVectors(P[i], P[i0]).dot(nrm));
      if (d > best) { best = d; i3 = i; }
    }
    if (i3 < 0) return null;

    const faces = [];
    const addFace = (x, y, z) => {
      const n = new THREE.Vector3().subVectors(P[y], P[x])
        .cross(new THREE.Vector3().subVectors(P[z], P[x])).normalize();
      const w = n.dot(P[x]);
      faces.push({ v: [x, y, z], n, w });
    };
    const inside = (i, j, k2, ref) => {
      const n = new THREE.Vector3().subVectors(P[j], P[i])
        .cross(new THREE.Vector3().subVectors(P[k2], P[i])).normalize();
      return n.dot(P[ref]) - n.dot(P[i]) > 0;
    };
    const quad = [i0, i1, i2, i3];
    for (const [x, y, z, o] of [[i0, i1, i2, i3], [i0, i2, i3, i1], [i0, i3, i1, i2], [i1, i3, i2, i0]]) {
      if (inside(x, y, z, o)) addFace(x, z, y); else addFace(x, y, z);
    }

    for (let pi = 0; pi < P.length; pi++) {
      if (quad.includes(pi)) continue;
      const p = P[pi];
      const visible = faces.filter(f => f.n.dot(p) - f.w > 1e-7);
      if (!visible.length) continue;
      const edge = new Map();
      for (const f of visible) {
        for (let e = 0; e < 3; e++) {
          const x = f.v[e], y = f.v[(e + 1) % 3];
          const k1 = x + ',' + y, k2 = y + ',' + x;
          if (edge.has(k2)) edge.delete(k2); else edge.set(k1, [x, y]);
        }
      }
      for (const f of visible) faces.splice(faces.indexOf(f), 1);
      for (const [x, y] of edge.values()) addFace(x, y, pi);
    }

    const pos = [];
    for (const f of faces) for (const i of f.v) pos.push(P[i].x, P[i].y, P[i].z);
    return pos.length ? geomFrom(pos) : null;
  }

  /* ══════════════ ٧ · تبسيط الشبكة ══════════════ */

  /**
   * تبسيط بتجميع الرؤوس على شبكة مكعّبة: كل رأس يُسحب إلى مركز خليّته،
   * والمثلّثات المنهارة تُحذف. سريع ومستقرّ — وهو ما يكفي لتخفيف ملفات STL.
   */
  function decimate(geometry, cell) {
    const a = tris(geometry);
    const c = Math.max(0.05, +cell || 1);
    const q = v => Math.round(v / c) * c;
    const pos = [];
    for (let i = 0; i < a.length; i += 9) {
      const P = [];
      for (let k = 0; k < 3; k++) P.push([q(a[i + k * 3]), q(a[i + k * 3 + 1]), q(a[i + k * 3 + 2])]);
      const same = (x, y) => x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
      if (same(P[0], P[1]) || same(P[1], P[2]) || same(P[0], P[2])) continue;
      pos.push(...P[0], ...P[1], ...P[2]);
    }
    return pos.length ? geomFrom(pos) : null;
  }

  /* ══════════════ ٨ · التوسيط ══════════════ */

  function centerOrigin(geometry, mode) {
    const g = geometry.clone();
    g.computeBoundingBox();
    const b = g.boundingBox;
    const c = b.getCenter(new THREE.Vector3());
    const dz = mode === 'base' ? -b.min.z : -c.z;
    g.translate(-c.x, -c.y, dz);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  /* ══════════════ ٩ · خريطة الارتفاعات ══════════════ */

  /**
   * يُسقط أشعّة من فوق المجسّم على شبكة منتظمة فيُعيد أعلى Z عند كل خليّة.
   * هذه هي الطريقة التي تعمل بها برامج التصنيع ثلاثيّ المحاور: كل ما يهمّ
   * الأداة النازلة عمودياً هو أعلى سطح تحتها.
   */
  function heightmap(meshes, step) {
    const s = Math.max(0.2, +step || 1);
    const box = new THREE.Box3();
    meshes.forEach(m => box.expandByObject(m));
    if (box.isEmpty()) return null;
    const nx = Math.max(2, Math.ceil((box.max.x - box.min.x) / s) + 1);
    const ny = Math.max(2, Math.ceil((box.max.y - box.min.y) / s) + 1);
    if (nx * ny > 400000) return { error: `الشبكة ${nx}×${ny} كبيرة — كبّر خطوة العيّنة` };
    const ray = new THREE.Raycaster();
    const dir = new THREE.Vector3(0, 0, -1);
    const top = box.max.z + 10;
    const Z = new Float32Array(nx * ny).fill(box.min.z);
    const o = new THREE.Vector3();
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        o.set(box.min.x + i * s, box.min.y + j * s, top);
        ray.set(o, dir);
        const hit = ray.intersectObjects(meshes, false);
        Z[j * nx + i] = hit.length ? hit[0].point.z : box.min.z;
      }
    }
    return { nx, ny, step: s, minX: box.min.x, minY: box.min.y,
             minZ: box.min.z, maxZ: box.max.z, z: Z };
  }

  /**
   * مسار تخشين ثلاثيّ المحاور: ممرّات ذهاباً وإياباً على محور X، بطبقات
   * متتابعة نزولاً، والأداة لا تنزل تحت سطح الخريطة عند كل نقطة.
   */
  function roughingGCode(hm, o) {
    if (!hm || hm.error) return null;
    const stepDown = Math.max(0.2, +o.stepDown || 2);
    const stepOver = Math.max(0.2, +o.stepOver || 2);
    const feed = Math.max(50, +o.feed || 800);
    const plunge = Math.max(20, +o.plunge || 300);
    const safeZ = +o.safeZ || (hm.maxZ + 5);
    const stock = +o.stock || 0;                    // بدل تشطيب

    const rows = Math.max(1, Math.round(stepOver / hm.step));
    const zAt = (i, j) => hm.z[Math.min(hm.ny - 1, j) * hm.nx + Math.min(hm.nx - 1, i)] + stock;

    const L = [];
    L.push('; دقة قلم — تخشين ثلاثيّ المحاور من مجسّم');
    L.push(`; الشبكة ${hm.nx}×${hm.ny} · خطوة ${hm.step}mm · نزول ${stepDown}mm · تباعد ${stepOver}mm`);
    L.push(`; المدى Z من ${hm.minZ.toFixed(2)} إلى ${hm.maxZ.toFixed(2)}`);
    L.push('G21', 'G90', 'G17', `G00 Z${safeZ.toFixed(3)}`);

    const levels = [];
    for (let z = hm.maxZ - stepDown; z > hm.minZ; z -= stepDown) levels.push(z);
    levels.push(hm.minZ);

    let moves = 0;
    for (const level of levels) {
      L.push(`; ── طبقة Z=${level.toFixed(3)} ──`);
      let dir = 1;
      for (let j = 0; j < hm.ny; j += rows) {
        const y = hm.minY + j * hm.step;
        const iStart = dir > 0 ? 0 : hm.nx - 1;
        const iEnd = dir > 0 ? hm.nx : -1;
        let first = true;
        for (let i = iStart; i !== iEnd; i += dir) {
          const x = hm.minX + i * hm.step;
          const zc = Math.max(level, zAt(i, j));
          if (first) {
            L.push(`G00 Z${safeZ.toFixed(3)}`);
            L.push(`G00 X${x.toFixed(3)} Y${y.toFixed(3)}`);
            L.push(`G01 Z${zc.toFixed(3)} F${plunge}`);
            first = false;
          } else {
            L.push(`G01 X${x.toFixed(3)} Y${y.toFixed(3)} Z${zc.toFixed(3)} F${feed}`);
          }
          moves++;
        }
        dir = -dir;
      }
    }
    L.push(`G00 Z${safeZ.toFixed(3)}`, 'M05', 'M30');
    return { gcode: L.join('\n'), moves, levels: levels.length };
  }

  /* ══════════════ ١٠ · إسقاط الظلّ إلى مخطّط ثنائيّ ══════════════ */

  /**
   * حدود ظلّ المجسّم على مستوى XY بمربّعات مسيرة (marching squares) على
   * خريطة إشغال مشتقّة من خريطة الارتفاعات.
   */
  function silhouette(hm) {
    if (!hm || hm.error) return null;
    const occ = (i, j) => (i >= 0 && j >= 0 && i < hm.nx && j < hm.ny &&
      hm.z[j * hm.nx + i] > hm.minZ + 1e-4) ? 1 : 0;
    const segs = [];
    const px = (i, j) => ({ x: hm.minX + i * hm.step, y: hm.minY + j * hm.step });
    for (let j = -1; j < hm.ny; j++) {
      for (let i = -1; i < hm.nx; i++) {
        const a = occ(i, j), b = occ(i + 1, j), c = occ(i + 1, j + 1), d = occ(i, j + 1);
        const code = a | (b << 1) | (c << 2) | (d << 3);
        if (code === 0 || code === 15) continue;
        const P = px(i, j), Q = px(i + 1, j + 1);
        const mx = (P.x + Q.x) / 2, my = (P.y + Q.y) / 2;
        const T = { x: mx, y: P.y }, R = { x: Q.x, y: my }, B = { x: mx, y: Q.y }, Lf = { x: P.x, y: my };
        const push = (u, v) => segs.push([u, v]);
        // الحالات الستّ عشرة مختصرةً إلى أربع حوافّ
        if (a !== b) push(T, a ? Lf : R);
        if (b !== c) push(R, b ? T : B);
        if (c !== d) push(B, c ? R : Lf);
        if (d !== a) push(Lf, d ? B : T);
      }
    }
    return segs;
  }

  /** يصل القطع المتناثرة إلى حلقات مغلقة */
  function chain(segs, tol) {
    const t = tol || 1e-3;
    const key = p => `${Math.round(p.x / t)},${Math.round(p.y / t)}`;
    const map = new Map();
    for (const [a, b] of segs) {
      for (const [x, y] of [[a, b], [b, a]]) {
        const k = key(x);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push({ from: x, to: y });
      }
    }
    const used = new Set(), rings = [];
    for (const [a, b] of segs) {
      const id = key(a) + '>' + key(b);
      if (used.has(id)) continue;
      const ring = [a];
      let cur = b, prev = a;
      used.add(id); used.add(key(b) + '>' + key(a));
      for (let guard = 0; guard < 100000; guard++) {
        ring.push(cur);
        const next = (map.get(key(cur)) || []).find(e => {
          const eid = key(e.from) + '>' + key(e.to);
          return !used.has(eid) && key(e.to) !== key(prev);
        });
        if (!next) break;
        used.add(key(next.from) + '>' + key(next.to));
        used.add(key(next.to) + '>' + key(next.from));
        prev = cur; cur = next.to;
        if (key(cur) === key(ring[0])) break;
      }
      if (ring.length >= 4) rings.push(ring);
    }
    return rings;
  }

  window.CAD3DOps = {
    merge, offsetSurface, shell, mirror,
    linearPattern, circularPattern, helixPath,
    splitByPlane, convexHull, decimate, centerOrigin,
    heightmap, roughingGCode, silhouette, chain,
  };
})();
