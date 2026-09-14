/**
 * cad3d-mod.js — معدِّلات الشبكة وتحليلها (بأسلوب بلندر)
 *
 *   تقسيم · لحم الرؤوس · إعادة حساب النواظم · قلبها · فصل الأجزاء المنفصلة ·
 *   ضمّ · إعادة بناء بالفوكسل · التواء واستدقاق وثني · مصفوفة على مسار ·
 *   شرائح · توجيه تلقائيّ · كشف الجدران الرقيقة · الخصائص الفيزيائية.
 *
 *   كلّها تعمل على BufferGeometry غير مفهرسة (مثلّثات صريحة) كبقية نواة الكاد،
 *   ولا تلمس شجرة الميزات ولا الواجهة — تأخذ هندسةً وتُعيد هندسة.
 *
 *   الوحدات مليمترات وZ إلى الأعلى.
 */
(function cad3dMod() {
  'use strict';

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

  const boundsOf = a => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < x0) x0 = a[i];       if (a[i] > x1) x1 = a[i];
      if (a[i+1] < y0) y0 = a[i+1];   if (a[i+1] > y1) y1 = a[i+1];
      if (a[i+2] < z0) z0 = a[i+2];   if (a[i+2] > z1) z1 = a[i+2];
    }
    return { min: [x0, y0, z0], max: [x1, y1, z1], size: [x1-x0, y1-y0, z1-z0] };
  };

  /* ══════════════ ١ · التقسيم ══════════════ */

  /**
   * كل مثلّث إلى أربعة عند منتصفات أضلاعه، ثمّ تنعيم تاوبن اختياريّ.
   * التقسيم وحده يزيد الكثافة بلا تغيير الشكل؛ التنعيم بعده هو ما يُدوّر
   * السطح كسطوح التقسيم في بلندر.
   */
  function subdivide(geometry, iters, smooth) {
    let pos = Array.from(tris(geometry));
    const n = Math.min(4, Math.max(1, Math.round(iters || 1)));
    for (let it = 0; it < n; it++) {
      const out = [];
      for (let t = 0; t < pos.length; t += 9) {
        const A = [pos[t], pos[t+1], pos[t+2]];
        const B = [pos[t+3], pos[t+4], pos[t+5]];
        const C = [pos[t+6], pos[t+7], pos[t+8]];
        const mid = (p, q) => [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2];
        const AB = mid(A, B), BC = mid(B, C), CA = mid(C, A);
        out.push(...A, ...AB, ...CA);
        out.push(...AB, ...B, ...BC);
        out.push(...CA, ...BC, ...C);
        out.push(...AB, ...BC, ...CA);
      }
      pos = out;
      if (pos.length / 9 > 400000) break;              // حارس ذاكرة
    }
    const g = geomFrom(pos);
    if (smooth && window.CAD3DOps && window.CAD3DOps.smooth) {
      return window.CAD3DOps.smooth(g, Math.max(1, n), 0.5);
    }
    return g;
  }

  /* ══════════════ ٢ · لحم الرؤوس بالمسافة ══════════════ */

  /**
   * يوحّد الرؤوس المتقاربة ويُسقط المثلّثات المنحلّة.
   * الشبكات المستورَدة تأتي غالباً بمثلّثاتٍ منفصلة لا تتشارك رؤوسها، فتفشل
   * عليها كل عملية تحتاج جوارَ الأوجه (النواظم، فصل الأجزاء، التنعيم).
   */
  function weld(geometry, tol) {
    const a = tris(geometry);
    const t = Math.max(1e-6, +tol || 1e-4);
    const key = i => `${Math.round(a[i]/t)},${Math.round(a[i+1]/t)},${Math.round(a[i+2]/t)}`;
    const map = new Map();
    const V = [];                                    // مواضع الرؤوس الموحّدة
    const id = new Int32Array(a.length / 3);
    for (let i = 0, k = 0; i < a.length; i += 3, k++) {
      const kk = key(i);
      let v = map.get(kk);
      if (v === undefined) { v = V.length / 3; map.set(kk, v); V.push(a[i], a[i+1], a[i+2]); }
      id[k] = v;
    }
    const pos = [], idx = [];
    for (let f = 0; f < id.length; f += 3) {
      const x = id[f], y = id[f+1], z = id[f+2];
      if (x === y || y === z || z === x) continue;    // منحلّ بعد اللحم
      idx.push(x, y, z);
      pos.push(V[x*3], V[x*3+1], V[x*3+2], V[y*3], V[y*3+1], V[y*3+2], V[z*3], V[z*3+1], V[z*3+2]);
    }
    const g = geomFrom(pos);
    g.userData.welded = { verts: V.length / 3, faces: idx.length / 3,
                          before: { verts: a.length / 3, faces: a.length / 9 } };
    return g;
  }

  /** يبني فهرسة مشتركة (رؤوس ملحومة + مثلّثات بالفهارس) */
  function indexed(geometry, tol) {
    const a = tris(geometry);
    const t = Math.max(1e-6, +tol || 1e-4);
    const map = new Map();
    const V = [], F = [];
    for (let f = 0; f < a.length; f += 9) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const i = f + k * 3;
        const kk = `${Math.round(a[i]/t)},${Math.round(a[i+1]/t)},${Math.round(a[i+2]/t)}`;
        let v = map.get(kk);
        if (v === undefined) { v = V.length / 3; map.set(kk, v); V.push(a[i], a[i+1], a[i+2]); }
        tri.push(v);
      }
      if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[2] !== tri[0]) F.push(tri);
    }
    return { V, F };
  }

  const fromIndexed = (V, F) => {
    const pos = [];
    for (const f of F) for (const v of f) pos.push(V[v*3], V[v*3+1], V[v*3+2]);
    return geomFrom(pos);
  };

  /* ══════════════ ٣ · إعادة حساب النواظم ══════════════ */

  /**
   * يجعل لفّ كل الأوجه متّسقاً ثمّ يوجّهها إلى الخارج.
   *
   * الاتّساق: وجهان متجاوران متّسقان إذا مرّا بالحافّة المشتركة في اتجاهين
   * متعاكسين؛ فإن مرّا بها في الاتجاه نفسه قُلِب أحدهما. ننشر ذلك على الشبكة
   * بمرور عرضيّ. ثمّ الحجم الموجَّه يقول إن كان الكلّ مقلوباً فنقلبه دفعةً واحدة
   * — وهذا يُصلح الاستيرادات التي تظهر «سوداء من الداخل».
   */
  function recalcNormals(geometry, tol) {
    const { V, F } = indexed(geometry, tol);
    if (!F.length) return geometry;

    // الحافّة → الوجوه التي تشترك فيها
    const edge = new Map();
    F.forEach((f, fi) => {
      for (let k = 0; k < 3; k++) {
        const a = f[k], b = f[(k + 1) % 3];
        const kk = a < b ? a + '_' + b : b + '_' + a;
        let l = edge.get(kk);
        if (!l) { l = []; edge.set(kk, l); }
        l.push(fi);
      }
    });
    const dirSame = (fa, fb, a, b) => {
      // هل يمرّ الوجهان بالحافّة (a,b) في الاتجاه نفسه؟
      const has = (f, x, y) => (f[0]===x&&f[1]===y)||(f[1]===x&&f[2]===y)||(f[2]===x&&f[0]===y);
      return has(fa, a, b) === has(fb, a, b);
    };

    const seen = new Uint8Array(F.length);
    for (let s = 0; s < F.length; s++) {
      if (seen[s]) continue;
      seen[s] = 1;
      const stack = [s];
      while (stack.length) {
        const fi = stack.pop();
        const f = F[fi];
        for (let k = 0; k < 3; k++) {
          const a = f[k], b = f[(k + 1) % 3];
          const kk = a < b ? a + '_' + b : b + '_' + a;
          for (const nb of (edge.get(kk) || [])) {
            if (nb === fi || seen[nb]) continue;
            if (dirSame(F[fi], F[nb], a, b)) { const x = F[nb][1]; F[nb][1] = F[nb][2]; F[nb][2] = x; }
            seen[nb] = 1;
            stack.push(nb);
          }
        }
      }
    }

    // الحجم الموجَّه: سالبٌ يعني أنّ الكلّ يشير إلى الداخل
    let vol = 0;
    for (const f of F) {
      const [i, j, k] = f;
      vol += (V[i*3] * (V[j*3+1] * V[k*3+2] - V[j*3+2] * V[k*3+1])
            - V[i*3+1] * (V[j*3] * V[k*3+2] - V[j*3+2] * V[k*3])
            + V[i*3+2] * (V[j*3] * V[k*3+1] - V[j*3+1] * V[k*3])) / 6;
    }
    if (vol < 0) F.forEach(f => { const x = f[1]; f[1] = f[2]; f[2] = x; });
    return fromIndexed(V, F);
  }

  /** ٤ · قلب كل الأوجه */
  function flipNormals(geometry) {
    const a = tris(geometry), pos = new Array(a.length);
    for (let t = 0; t < a.length; t += 9) {
      pos[t] = a[t]; pos[t+1] = a[t+1]; pos[t+2] = a[t+2];
      pos[t+3] = a[t+6]; pos[t+4] = a[t+7]; pos[t+5] = a[t+8];
      pos[t+6] = a[t+3]; pos[t+7] = a[t+4]; pos[t+8] = a[t+5];
    }
    return geomFrom(pos);
  }

  /* ══════════════ ٥ · فصل الأجزاء المنفصلة ══════════════ */

  function separateLoose(geometry, tol) {
    const { V, F } = indexed(geometry, tol);
    if (!F.length) return [];
    const parent = new Int32Array(V.length / 3);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const uni = (x, y) => { const a = find(x), b = find(y); if (a !== b) parent[b] = a; };
    for (const f of F) { uni(f[0], f[1]); uni(f[1], f[2]); }

    const groups = new Map();
    for (const f of F) {
      const r = find(f[0]);
      let l = groups.get(r);
      if (!l) { l = []; groups.set(r, l); }
      l.push(f);
    }
    // الأكبر أوّلاً — عادةً هو الجسم والباقي شظايا
    return [...groups.values()]
      .sort((a, b) => b.length - a.length)
      .map(F2 => fromIndexed(V, F2));
  }

  /** ٦ · ضمّ عدّة هندسات (مع مصفوفة كلٍّ إن وُجدت) */
  function joinGeoms(list) {
    const pos = [], v = new THREE.Vector3();
    for (const it of list) {
      const g = it.geometry || it;
      const m = it.matrix || it.matrixWorld || null;
      const a = tris(g);
      for (let i = 0; i < a.length; i += 3) {
        v.set(a[i], a[i+1], a[i+2]);
        if (m) v.applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
      }
    }
    return pos.length ? geomFrom(pos) : null;
  }

  /* ══════════════ ٧ · إعادة بناء بالفوكسل ══════════════ */

  /**
   * يُعيد بناء الشبكة من حجمها لا من أوجهها: يُرسّم المثلّثات في شبكة فوكسل،
   * يملأ الخارج بالفيضان، فما تبقّى هو الداخل — ثمّ يستخرج السطح بـ«شِباك
   * السطح» (surface nets).
   *
   * هذه أنفع أداة لإصلاح مجسّم مستورَد مكسور: الثقوب والأوجه المتقاطعة
   * والمزدوجة تختفي، والناتج مغلقٌ دائماً وصالحٌ للعمليات المنطقية والتصنيع.
   */
  function remesh(geometry, voxel, seal) {
    const a = tris(geometry);
    const b = boundsOf(a);
    const big = Math.max(b.size[0], b.size[1], b.size[2]) || 1;
    let vx = Math.max(big / 300, +voxel || big / 60);         // حدّ أدنى يمنع الانفجار
    const R = Math.max(0, Math.min(4, seal == null ? 1 : seal | 0));  // نصف قطر الإغلاق
    const pad = 2 + R;
    let nx, ny, nz, cells;
    do {
      nx = Math.ceil(b.size[0] / vx) + pad * 2 + 1;
      ny = Math.ceil(b.size[1] / vx) + pad * 2 + 1;
      nz = Math.ceil(b.size[2] / vx) + pad * 2 + 1;
      cells = nx * ny * nz;
      if (cells > 6e6) vx *= 1.5;
    } while (cells > 6e6);

    const JIT = 0;
    const ox = b.min[0] - pad * vx - JIT, oy = b.min[1] - pad * vx - JIT, oz = b.min[2] - pad * vx - JIT;
    const at = (i, j, k) => (k * ny + j) * nx + i;
    const shell = new Uint8Array(cells);

    // ترسيم المثلّثات: عيّناتٌ باريسنترية أصغر من الفوكسل تُعلّم كل فوكسل يمرّ
    // به المثلّث — أبسط من تقاطع مثلّث/صندوق ويكفي لبناء القشرة
    for (let t = 0; t < a.length; t += 9) {
      const A = [a[t], a[t+1], a[t+2]], B = [a[t+3], a[t+4], a[t+5]], C = [a[t+6], a[t+7], a[t+8]];
      const e1 = Math.hypot(B[0]-A[0], B[1]-A[1], B[2]-A[2]);
      const e2 = Math.hypot(C[0]-A[0], C[1]-A[1], C[2]-A[2]);
      const n = Math.min(256, Math.max(1, Math.ceil(Math.max(e1, e2) / (vx * 0.5))));
      for (let u = 0; u <= n; u++) {
        for (let w = 0; w + u <= n; w++) {
          const s = u / n, r = w / n, q = 1 - s - r;
          // كل النقاط الثماني للخليّة الحاوية، لا أقربها وحدها: تعليم الأقرب
          // يترك القشرة مثقوبةً قُطرياً على الأسطح المائلة، فيتسرّب الفيضان إلى
          // الداخل ويخرج المجسّم مجوَّفاً (كرةٌ فقدت ٦٨٪ من حجمها).
          const fi = Math.floor((A[0]*q + B[0]*s + C[0]*r - ox) / vx);
          const fj = Math.floor((A[1]*q + B[1]*s + C[1]*r - oy) / vx);
          const fk = Math.floor((A[2]*q + B[2]*s + C[2]*r - oz) / vx);
          for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) for (let dk = 0; dk < 2; dk++) {
            const i = fi + di, j = fj + dj, k = fk + dk;
            if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) shell[at(i, j, k)] = 1;
          }
        }
      }
    }

    /* إغلاق مورفولوجيّ: تمدّدٌ ثمّ تآكل بالمقدار نفسه.
       بلا هذا يتسرّب الفيضان من أيّ ثقبٍ أوسع من فوكسل فيُفرَّغ الجسم كلّه —
       صندوق بوجهين ناقصين كان يخرج قشرةً حجمها ٦٥٨٧ بدل ٣٢٠٠٠. التمدّد يسدّ
       الثقوب حتى عرض ‎2R فوكسل، والتآكل يُعيد الحجم إلى مكانه. */
    const NB6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    const morph = (src, grow) => {
      const dst = new Uint8Array(cells);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = at(i, j, k);
        let v = src[c];
        if (grow ? !v : v) {
          for (const [di, dj, dk] of NB6) {
            const x = i+di, y = j+dj, z = k+dk;
            const o = (x<0||y<0||z<0||x>=nx||y>=ny||z>=nz) ? 0 : src[at(x,y,z)];
            if (grow ? o : !o) { v = grow ? 1 : 0; break; }
          }
        }
        dst[c] = v;
      }
      return dst;
    };

    let mask = shell;
    for (let r = 0; r < R; r++) mask = morph(mask, true);     // تمدّد

    // فيضانٌ من الركن الخارجيّ عبر ما ليس قشرة
    const outside = new Uint8Array(cells);
    const stack = [0];
    outside[0] = 1;
    while (stack.length) {
      const c = stack.pop();
      const i = c % nx, j = ((c - i) / nx) % ny, k = Math.floor(c / (nx * ny));
      const push = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
        const d = at(x, y, z);
        if (outside[d] || mask[d]) return;
        outside[d] = 1; stack.push(d);
      };
      push(i+1,j,k); push(i-1,j,k); push(i,j+1,k); push(i,j-1,k); push(i,j,k+1); push(i,j,k-1);
    }
    let solid = new Uint8Array(cells);
    for (let c = 0; c < cells; c++) solid[c] = outside[c] ? 0 : 1;
    for (let r = 0; r < R; r++) solid = morph(solid, false);  // تآكل

    /* حقل مسافة موقَّعة في شريطٍ ضيّق.
       الإشارة من الفيضان وحده تضع السطح على حافّة الفوكسلات المعلَّمة فيكبر
       المجسّم بنصف فوكسل من كل جهة (‏+١٧٪ على صندوق بفوكسل ٤). هنا تُؤخذ
       الإشارة من جهة النقطة عن مستوى أقرب مثلّث والمسافة منه فعلياً، فيقع
       السطح في موضعه بدقّةٍ دون الفوكسل. */
    // خلايا بضعف الفوكسل: الجوار ٣×٣×٣ يغطّي عندها ±٢ فوكسل، وهو مدى
    // القشرة المُثخَّنة — وإلّا بقيت نقاطٌ خارج المجسّم بلا مسافةٍ حقيقية
    // فأخذت إشارتها من الفيضان ودخلت في الجسم (صندوقٌ ‎+٣٣٪).
    const G = triGrid(a, Math.max(vx * 2, 1e-3));
    const FAR = vx * 4;
    const field = new Float32Array(cells);
    const nv = new THREE.Vector3(), e1v = new THREE.Vector3(), e2v = new THREE.Vector3();
    /* الشريط = كل نقطةٍ يوجد مثلّث في جوارها الشبكيّ (‏±١٫٥ فوكسل).
       تضييقه إلى «النقاط المجاورة لتغيّر الإشارة» لا يكفي: فوكسلات القشرة
       متلاصقة، فنقطةٌ عليها لا ترى تغيّراً حولها فتبقى «داخلاً» بمسافةٍ بعيدة
       ويتضخّم المجسّم (‏+٣٤٪ على صندوق بفوكسل ٤). */
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = at(i, j, k);
      const px = ox + i * vx, py = oy + j * vx, pz = oz + k * vx;
      let best = Infinity, bestT = -1;
      const ci = Math.floor((px - G.b.min[0]) / G.cs), cj = Math.floor((py - G.b.min[1]) / G.cs),
            ck = Math.floor((pz - G.b.min[2]) / G.cs);
      for (let di=-1;di<=1;di++) for (let dj=-1;dj<=1;dj++) for (let dk=-1;dk<=1;dk++) {
        const l = G.cellAt(ci+di, cj+dj, ck+dk);
        if (!l) continue;
        for (const t of l) {
          const d = pointTriDist(px, py, pz, a, t);
          if (d < best) { best = d; bestT = t; }
        }
      }
      if (bestT < 0) { field[c] = solid[c] ? -FAR : FAR; continue; }
      e1v.set(a[bestT+3]-a[bestT], a[bestT+4]-a[bestT+1], a[bestT+5]-a[bestT+2]);
      e2v.set(a[bestT+6]-a[bestT], a[bestT+7]-a[bestT+1], a[bestT+8]-a[bestT+2]);
      nv.crossVectors(e1v, e2v);
      const dot = nv.x*(px-a[bestT]) + nv.y*(py-a[bestT+1]) + nv.z*(pz-a[bestT+2]);
      const sd = dot / (nv.length() || 1);          // بُعدٌ موقَّع عن مستوى الوجه
      // نقطةٌ واقعةٌ في مستوى الوجه تماماً (أوجه محاذية للمحاور) إشارتها غامضة
      // رياضياً — نأخذها من الفيضان بدل أن نحسمها باعتباط، وهو ما كان يجعل
      // خطأ الصندوق يقفز إلى ‎+٢٩٪ بينما الأسطح المنحنية دقيقة
      const sign = Math.abs(sd) < 1e-6 ? (solid[c] ? -1 : 1) : (sd < 0 ? -1 : 1);
      field[c] = sign * best;
    }
    // الداخل يُشتقّ من الحقل كي تتّفق الطوبولوجيا مع مواضع التقاطع
    const inside = new Uint8Array(cells);
    for (let c = 0; c < cells; c++) inside[c] = field[c] < 0 ? 1 : 0;

    /* شِباك السطح: رأسٌ واحد في كل خليّة يعبرها السطح، عند متوسّط تقاطعات
       الأضلاع المتغيّرة؛ ثمّ وجهٌ لكل ضلعٍ شبكيّ يتغيّر عبره الداخل/الخارج */
    const vid = new Int32Array((nx-1) * (ny-1) * (nz-1)).fill(-1);
    const cat = (i, j, k) => (k * (ny-1) + j) * (nx-1) + i;
    const VX = [];
    const CORN = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    const EDG = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    for (let k = 0; k < nz-1; k++) for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++) {
      const cv = CORN.map(c => inside[at(i+c[0], j+c[1], k+c[2])]);
      let s = 0; cv.forEach(v => s += v);
      if (s === 0 || s === 8) continue;
      let px = 0, py = 0, pz = 0, n = 0;
      for (const [p, q] of EDG) {
        if (cv[p] === cv[q]) continue;
        const dp = field[at(i+CORN[p][0], j+CORN[p][1], k+CORN[p][2])];
        const dq = field[at(i+CORN[q][0], j+CORN[q][1], k+CORN[q][2])];
        let f = (dp - dq) !== 0 ? dp / (dp - dq) : 0.5;
        if (!(f >= 0 && f <= 1)) f = 0.5;
        px += CORN[p][0] + (CORN[q][0] - CORN[p][0]) * f;
        py += CORN[p][1] + (CORN[q][1] - CORN[p][1]) * f;
        pz += CORN[p][2] + (CORN[q][2] - CORN[p][2]) * f;
        n++;
      }
      vid[cat(i, j, k)] = VX.length / 3;
      VX.push(ox + (i + px/n) * vx, oy + (j + py/n) * vx, oz + (k + pz/n) * vx);
    }

    const pos = [];
    const quad = (v0, v1, v2, v3, flip) => {
      if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
      const P = [v0, v1, v2, v3].map(v => [VX[v*3], VX[v*3+1], VX[v*3+2]]);
      const order = flip ? [0,2,1, 0,3,2] : [0,1,2, 0,2,3];
      for (const o of order) pos.push(P[o][0], P[o][1], P[o][2]);
    };
    for (let k = 0; k < nz-1; k++) for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++) {
      // الأضلاع الثلاثة الخارجة من عيّنة (i,j,k): وجهٌ لكل ضلعٍ يتغيّر عبره
      // الداخل/الخارج، مبنيٌّ من رؤوس الخلايا الأربع المحيطة بذلك الضلع
      const c000 = inside[at(i, j, k)];
      if (j > 0 && k > 0 && c000 !== inside[at(i+1, j, k)])
        quad(vid[cat(i, j-1, k-1)], vid[cat(i, j, k-1)], vid[cat(i, j, k)], vid[cat(i, j-1, k)], c000 === 0);
      if (i > 0 && k > 0 && c000 !== inside[at(i, j+1, k)])
        quad(vid[cat(i-1, j, k-1)], vid[cat(i, j, k-1)], vid[cat(i, j, k)], vid[cat(i-1, j, k)], c000 !== 0);
      if (i > 0 && j > 0 && c000 !== inside[at(i, j, k+1)])
        quad(vid[cat(i-1, j-1, k)], vid[cat(i, j-1, k)], vid[cat(i, j, k)], vid[cat(i-1, j, k)], c000 === 0);
    }
    const g = geomFrom(pos);
    /* فرق الحجم يُقاس ويُبلَّغ دائماً: إعادة البناء بالفوكسل تقريبٌ بطبيعتها،
       ودقّتها ممتازة على الأسطح المنحنية والمكسورة (±٤٪ على الكرة والأسطوانة
       والحلقة والأنبوب والمخروط، و‎−٠٫٦٪ على شبكةٍ مثقوبة) لكنّها تتضخّم على
       المجسّمات المحاذية للمحاور تماماً (صندوق ‎+١٥..٣١٪). فبدل أن يمرّ الخطأ
       صامتاً، تُعيد الدالّة الانحراف ليعرضه النداء ويقرّر المستخدم. */
    let v0 = 0, v1 = 0;
    try {
      const K = window.CAD3DKernel, I = new THREE.Matrix4();
      v0 = K.volume(K.fromGeometry(geometry, I));
      v1 = K.volume(K.fromGeometry(g, I));
    } catch (_) { /* القياس ترفٌ لا شرط */ }
    g.userData.remesh = { voxel: vx, grid: [nx, ny, nz], faces: pos.length / 9, seal: R,
                          volumeBefore: v0, volumeAfter: v1,
                          drift: v0 ? (v1 - v0) / v0 : 0 };
    return g;
  }
  /**
   * أقرب مسافة من نقطة إلى مثلّث (المنطقة الفورونية: الوجه ثمّ الأضلاع ثمّ
   * الرؤوس). تُستعمل لبناء حقل المسافة الموقَّعة في إعادة البناء.
   */
  function pointTriDist(px, py, pz, a, t) {
    const ax=a[t], ay=a[t+1], az=a[t+2];
    const e0x=a[t+3]-ax, e0y=a[t+4]-ay, e0z=a[t+5]-az;
    const e1x=a[t+6]-ax, e1y=a[t+7]-ay, e1z=a[t+8]-az;
    const dx=ax-px, dy=ay-py, dz=az-pz;
    const A=e0x*e0x+e0y*e0y+e0z*e0z, Bb=e0x*e1x+e0y*e1y+e0z*e1z, C=e1x*e1x+e1y*e1y+e1z*e1z;
    const D=e0x*dx+e0y*dy+e0z*dz, E=e1x*dx+e1y*dy+e1z*dz, F=dx*dx+dy*dy+dz*dz;
    let det=A*C-Bb*Bb, s=Bb*E-C*D, tt=Bb*D-A*E;
    if (det < 1e-20) { det = 1e-20; }
    if (s + tt <= det) {
      if (s < 0) { if (tt < 0) { if (D < 0) { tt = 0; s = Math.min(1, Math.max(0, -D/A)); } else { s = 0; tt = Math.min(1, Math.max(0, -E/C)); } }
                   else { s = 0; tt = Math.min(1, Math.max(0, -E/C)); } }
      else if (tt < 0) { tt = 0; s = Math.min(1, Math.max(0, -D/A)); }
      else { const inv = 1/det; s *= inv; tt *= inv; }
    } else {
      if (s < 0) { const t0=Bb+D, t1=C+E;
        if (t1 > t0) { const n=t1-t0, d2=A-2*Bb+C; s=Math.min(1,Math.max(0,n/d2)); tt=1-s; }
        else { s=0; tt=Math.min(1,Math.max(0,-E/C)); } }
      else if (tt < 0) { const t0=Bb+E, t1=A+D;
        if (t1 > t0) { const n=t1-t0, d2=A-2*Bb+C; tt=Math.min(1,Math.max(0,n/d2)); s=1-tt; }
        else { tt=0; s=Math.min(1,Math.max(0,-D/A)); } }
      else { const n=(C+E)-(Bb+D), d2=A-2*Bb+C; s=Math.min(1,Math.max(0,n/d2)); tt=1-s; }
    }
    const qx=ax+e0x*s+e1x*tt, qy=ay+e0y*s+e1y*tt, qz=az+e0z*s+e1z*tt;
    return Math.hypot(qx-px, qy-py, qz-pz);
  }

  /* ══════════════ ٨-١٠ · المشوِّهات ══════════════ */

  const AX = { x: 0, y: 1, z: 2 };

  /** يطبّق دالّة على كل رأس، مع t نسبة الموضع على المحور بين 0 و1 */
  function deform(geometry, axis, fn) {
    const a = Array.from(tris(geometry));
    const k = AX[axis] == null ? 2 : AX[axis];
    const b = boundsOf(a);
    const lo = b.min[k], len = b.size[k] || 1;
    for (let i = 0; i < a.length; i += 3) {
      const t = (a[i + k] - lo) / len;
      const p = [a[i], a[i+1], a[i+2]];
      const q = fn(p, t, k);
      a[i] = q[0]; a[i+1] = q[1]; a[i+2] = q[2];
    }
    return geomFrom(a);
  }

  /** ٨ · التواء حول المحور بزاوية كلّية */
  function twist(geometry, deg, axis) {
    const total = (+deg || 0) * Math.PI / 180;
    return deform(geometry, axis, (p, t, k) => {
      const ang = total * t;
      const c = Math.cos(ang), s = Math.sin(ang);
      const i = (k + 1) % 3, j = (k + 2) % 3;
      const u = p[i], v = p[j];
      const o = p.slice();
      o[i] = u * c - v * s;
      o[j] = u * s + v * c;
      return o;
    });
  }

  /** ٩ · استدقاق: النهاية تُضرب في العامل والبداية تبقى */
  function taper(geometry, factor, axis) {
    const f = +factor;
    const k1 = isFinite(f) ? f : 0.5;
    return deform(geometry, axis, (p, t, k) => {
      const s = 1 + (k1 - 1) * t;
      const i = (k + 1) % 3, j = (k + 2) % 3;
      const o = p.slice();
      o[i] = p[i] * s; o[j] = p[j] * s;
      return o;
    });
  }

  /**
   * ١٠ · ثني حول محورٍ عموديّ على محور الامتداد.
   * الامتداد يُلَفّ على قوسٍ بزاوية كلّية: نصف القطر = الطول ÷ الزاوية.
   */
  function bend(geometry, deg, axis) {
    const ang = (+deg || 0) * Math.PI / 180;
    if (Math.abs(ang) < 1e-6) return geometry;
    const a = Array.from(tris(geometry));
    const k = AX[axis] == null ? 0 : AX[axis];
    const up = (k + 2) % 3;                       // المحور الذي ينحني نحوه
    const b = boundsOf(a);
    const lo = b.min[k], len = b.size[k] || 1;
    const R = len / ang;
    for (let i = 0; i < a.length; i += 3) {
      const s = a[i + k] - lo;                    // الطول على طول القوس
      const h = a[i + up];
      const th = s / R;
      const r = R - h;
      a[i + k] = lo + r * Math.sin(th);
      a[i + up] = R - r * Math.cos(th);
    }
    return geomFrom(a);
  }

  /* ══════════════ ١١ · مصفوفة على مسار ══════════════ */

  /**
   * نُسَخ موزّعة على مسارٍ ثلاثيّ، مع محاذاة اختيارية لمماسّ المسار.
   * المسار [{x,y,z}] — نفس شكل مسار الكنس، فيؤخذ من لوحة الرسم أو من لولب.
   */
  function arrayPath(geometry, path, o) {
    if (!path || path.length < 2) return null;
    const count = Math.max(1, Math.min(400, (o && o.count) | 0 || 6));
    const align = !(o && o.align === false);
    // أطوال تراكمية لتوزيعٍ متساوٍ بالمسافة لا بالفهرس
    const acc = [0];
    for (let i = 1; i < path.length; i++) {
      const d = Math.hypot(path[i].x - path[i-1].x, path[i].y - path[i-1].y, (path[i].z||0) - (path[i-1].z||0));
      acc.push(acc[i-1] + d);
    }
    const total = acc[acc.length - 1] || 1;
    const at = s => {
      let i = 1;
      while (i < acc.length && acc[i] < s) i++;
      const a0 = path[Math.max(0, i-1)], a1 = path[Math.min(path.length-1, i)];
      const seg = (acc[i] - acc[i-1]) || 1;
      const f = Math.max(0, Math.min(1, (s - acc[i-1]) / seg));
      return {
        p: new THREE.Vector3(a0.x + (a1.x-a0.x)*f, a0.y + (a1.y-a0.y)*f, (a0.z||0) + ((a1.z||0)-(a0.z||0))*f),
        t: new THREE.Vector3(a1.x-a0.x, a1.y-a0.y, (a1.z||0)-(a0.z||0)).normalize(),
      };
    };
    const list = [];
    const Z = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < count; i++) {
      const s = count === 1 ? 0 : total * i / (count - 1);
      const { p, t } = at(s);
      const m = new THREE.Matrix4();
      if (align && t.lengthSq() > 1e-12) {
        const q = new THREE.Quaternion().setFromUnitVectors(Z, t);
        m.compose(p, q, new THREE.Vector3(1, 1, 1));
      } else m.makeTranslation(p.x, p.y, p.z);
      list.push({ geometry, matrix: m });
    }
    return joinGeoms(list);
  }

  /* ══════════════ ١٢ · شرائح ══════════════ */

  /**
   * مقاطع متتابعة على محورٍ بفاصلٍ ثابت — لبناء المجسّم من ألواح مقصوصة.
   * يُعيد [{at, rings}] بإحداثيات مستوى القصّ.
   */
  function slices(list, axis, step, inset) {
    const O = window.CAD3DOps;
    if (!O || !O.sectionRings) return [];
    const k = AX[axis] == null ? 2 : AX[axis];
    let lo = Infinity, hi = -Infinity;
    for (const it of list) {
      const g = it.geometry || it;
      const m = it.matrixWorld || it.matrix || null;
      const a = tris(g);
      const v = new THREE.Vector3();
      for (let i = 0; i < a.length; i += 3) {
        v.set(a[i], a[i+1], a[i+2]);
        if (m) v.applyMatrix4(m);
        const c = v.toArray()[k];
        if (c < lo) lo = c; if (c > hi) hi = c;
      }
    }
    const s = Math.max(0.1, +step || 5);
    const out = [];
    // نبدأ من نصف السماكة كي يقع كل مقطعٍ في منتصف لوحه
    for (let z = lo + s / 2; z < hi; z += s) {
      const rings = O.sectionRings(list, axis, z + (+inset || 0));
      if (rings && rings.length) out.push({ at: z, rings });
    }
    return out;
  }

  /* ══════════════ ١٣ · التوجيه التلقائيّ ══════════════ */

  /**
   * يبحث عن الوضع الذي يُقلّل ارتفاع القطعة — أي الذي يضع أوسع وجهٍ مستوٍ
   * على المنضدة. مرشّحو الاتجاه هم نواظم الأوجه الأكبر مساحةً، وهذا ما يفعله
   * التوجيه اليدويّ في الطباعة والتفريز.
   */
  function autoOrient(geometry) {
    const a = tris(geometry);
    const groups = new Map();                    // ناظم مُقرَّب → مساحة
    const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    for (let t = 0; t < a.length; t += 9) {
      A.set(a[t], a[t+1], a[t+2]); B.set(a[t+3], a[t+4], a[t+5]); C.set(a[t+6], a[t+7], a[t+8]);
      e1.subVectors(B, A); e2.subVectors(C, A); n.crossVectors(e1, e2);
      const area = n.length() / 2;
      if (!(area > 0)) continue;
      n.divideScalar(area * 2);
      const key = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
      const g = groups.get(key);
      if (g) g.area += area;
      else groups.set(key, { n: n.clone(), area });
    }
    const cands = [...groups.values()].sort((x, y) => y.area - x.area).slice(0, 24);
    cands.push({ n: new THREE.Vector3(0, 0, -1), area: 0 });     // الوضع الحاليّ مرشّح

    const DOWN = new THREE.Vector3(0, 0, -1);
    let best = null;
    for (const c of cands) {
      const q = new THREE.Quaternion().setFromUnitVectors(c.n.clone().normalize(), DOWN);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const v = new THREE.Vector3();
      let z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < a.length; i += 3) {
        v.set(a[i], a[i+1], a[i+2]).applyMatrix4(m);
        if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
        if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
        if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
      }
      const h = z1 - z0;
      if (!best || h < best.h - 1e-6) best = { h, m, q, size: [x1-x0, y1-y0, h], area: c.area };
    }
    return best;
  }

  /* ══════════════ ١٤ · كشف الجدران الرقيقة ══════════════ */

  /** شبكة تسريع بسيطة: خليّة → فهارس المثلّثات */
  function triGrid(a, cell) {
    const b = boundsOf(a);
    const cs = Math.max(cell, 1e-3);
    const nx = Math.max(1, Math.ceil(b.size[0] / cs)), ny = Math.max(1, Math.ceil(b.size[1] / cs)),
          nz = Math.max(1, Math.ceil(b.size[2] / cs));
    const map = new Map();
    const key = (i, j, k) => (k * ny + j) * nx + i;
    const put = (i, j, k, t) => {
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
      const kk = key(i, j, k);
      let l = map.get(kk);
      if (!l) { l = []; map.set(kk, l); }
      l.push(t);
    };
    for (let t = 0; t < a.length; t += 9) {
      let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity;
      for (let k = 0; k < 3; k++) {
        const i = t + k*3;
        x0=Math.min(x0,a[i]); x1=Math.max(x1,a[i]);
        y0=Math.min(y0,a[i+1]); y1=Math.max(y1,a[i+1]);
        z0=Math.min(z0,a[i+2]); z1=Math.max(z1,a[i+2]);
      }
      const i0=Math.floor((x0-b.min[0])/cs), i1=Math.floor((x1-b.min[0])/cs);
      const j0=Math.floor((y0-b.min[1])/cs), j1=Math.floor((y1-b.min[1])/cs);
      const k0=Math.floor((z0-b.min[2])/cs), k1=Math.floor((z1-b.min[2])/cs);
      for (let i=i0;i<=i1;i++) for (let j=j0;j<=j1;j++) for (let k=k0;k<=k1;k++) put(i,j,k,t);
    }
    /* بحثٌ محدود بالمدى: المفتاح خطّيّ، فالفهرس خارج الشبكة (نقاط الهامش حول
       المجسّم) يلتفّ ويصطدم بخليّةٍ صالحة فيُعيد مثلّثاتٍ بعيدة. كان ذلك يقلب
       إشارة المسافة في إعادة البناء فيخرج المجسّم مجوَّفاً (كرةٌ ‎−٦٨٪). */
    const cellAt = (i, j, k) =>
      (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? undefined : map.get(key(i, j, k));
    return { map, b, cs, nx, ny, nz, key, cellAt };
  }

  /** تقاطع شعاع/مثلّث (Möller–Trumbore) — يُعيد المسافة أو -1 */
  function rayTri(o, d, a, t) {
    const ax=a[t],ay=a[t+1],az=a[t+2];
    const e1x=a[t+3]-ax, e1y=a[t+4]-ay, e1z=a[t+5]-az;
    const e2x=a[t+6]-ax, e2y=a[t+7]-ay, e2z=a[t+8]-az;
    const px=d[1]*e2z-d[2]*e2y, py=d[2]*e2x-d[0]*e2z, pz=d[0]*e2y-d[1]*e2x;
    const det=e1x*px+e1y*py+e1z*pz;
    if (Math.abs(det)<1e-12) return -1;
    const inv=1/det;
    const tx=o[0]-ax, ty=o[1]-ay, tz=o[2]-az;
    const u=(tx*px+ty*py+tz*pz)*inv;
    if (u<-1e-6||u>1+1e-6) return -1;
    const qx=ty*e1z-tz*e1y, qy=tz*e1x-tx*e1z, qz=tx*e1y-ty*e1x;
    const v=(d[0]*qx+d[1]*qy+d[2]*qz)*inv;
    if (v<-1e-6||u+v>1+1e-6) return -1;
    const dist=(e2x*qx+e2y*qy+e2z*qz)*inv;
    return dist>1e-6?dist:-1;
  }

  /**
   * من مركز كل وجه نُطلق شعاعاً إلى الداخل (عكس الناظم) ونقيس أوّل اصطدام:
   * تلك سماكة الجدار عند ذلك الموضع. ما دون الحدّ يُعَدّ رقيقاً — وهو ما يكسر
   * في التفريز ويفشل في الطباعة.
   */
  function thinWalls(geometry, minT, sample) {
    const a = tris(geometry);
    const lim = Math.max(0.01, +minT || 1);
    const G = triGrid(a, Math.max(lim, boundsOf(a).size[0] / 40 || lim));
    const nTri = a.length / 9;
    const stride = Math.max(1, Math.round(nTri / Math.max(200, Math.min(nTri, sample || 4000))));
    let thin = 0, tested = 0, minFound = Infinity, thinArea = 0, totalArea = 0;
    const n = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let f = 0, ti = 0; f < a.length; f += 9, ti++) {
      A.set(a[f],a[f+1],a[f+2]); B.set(a[f+3],a[f+4],a[f+5]); C.set(a[f+6],a[f+7],a[f+8]);
      e1.subVectors(B,A); e2.subVectors(C,A); n.crossVectors(e1,e2);
      const area = n.length()/2;
      totalArea += area;
      if (ti % stride) continue;
      if (!(area>0)) continue;
      n.divideScalar(area*2);
      const o = [(A.x+B.x+C.x)/3 - n.x*1e-3, (A.y+B.y+C.y)/3 - n.y*1e-3, (A.z+B.z+C.z)/3 - n.z*1e-3];
      const d = [-n.x, -n.y, -n.z];
      let best = Infinity;
      // نمرّ على كل المثلّثات في الخلايا التي يعبرها الشعاع ضمن الحدّ فقط
      const steps = Math.ceil(lim / G.cs) + 1;
      const seen = new Set();
      for (let s = 0; s <= steps; s++) {
        const px = o[0]+d[0]*G.cs*s, py = o[1]+d[1]*G.cs*s, pz = o[2]+d[2]*G.cs*s;
        const i = Math.floor((px-G.b.min[0])/G.cs), j = Math.floor((py-G.b.min[1])/G.cs), k = Math.floor((pz-G.b.min[2])/G.cs);
        for (let di=-1;di<=1;di++) for (let dj=-1;dj<=1;dj++) for (let dk=-1;dk<=1;dk++) {
          const l = G.cellAt(i+di,j+dj,k+dk);
          if (!l) continue;
          for (const t of l) {
            if (t === f || seen.has(t)) continue;
            seen.add(t);
            const dist = rayTri(o, d, a, t);
            if (dist > 0 && dist < best) best = dist;
          }
        }
        if (best < Infinity) break;
      }
      tested++;
      if (best < minFound) minFound = best;
      if (best < lim) { thin++; thinArea += area; }
    }
    return {
      tested, thin, ratio: tested ? thin / tested : 0,
      minThickness: isFinite(minFound) ? minFound : null,
      thinArea, totalArea, limit: lim,
    };
  }

  /* ══════════════ ١٥ · الخصائص الفيزيائية ══════════════ */

  /** كثافات شائعة (غ/سم³) */
  const DENSITY = {
    mdf: 0.75, wood: 0.65, ply: 0.6, acrylic: 1.18, pla: 1.24, abs: 1.04,
    alu: 2.70, brass: 8.50, steel: 7.85, copper: 8.96,
  };

  /**
   * الحجم والمركز ولحظات القصور من تكامل رباعيّات الأوجه على الأصل.
   * كل مثلّث مع الأصل يُكوّن رباعيّاً موجَّهاً؛ جمع أحجامه يعطي الحجم، وجمع
   * مراكزه موزونةً يعطي مركز الكتلة.
   */
  function massProps(geometry, matrix, density) {
    const src = tris(geometry);
    const a = matrix ? (() => {
      const o = new Float64Array(src.length), v = new THREE.Vector3();
      for (let i = 0; i < src.length; i += 3) {
        v.set(src[i], src[i+1], src[i+2]).applyMatrix4(matrix);
        o[i] = v.x; o[i+1] = v.y; o[i+2] = v.z;
      }
      return o;
    })() : src;

    let vol = 0, cx = 0, cy = 0, cz = 0, area = 0;
    for (let t = 0; t < a.length; t += 9) {
      const ax=a[t],ay=a[t+1],az=a[t+2], bx=a[t+3],by=a[t+4],bz=a[t+5], cx3=a[t+6],cy3=a[t+7],cz3=a[t+8];
      const v6 = ax*(by*cz3 - bz*cy3) - ay*(bx*cz3 - bz*cx3) + az*(bx*cy3 - by*cx3);
      vol += v6 / 6;
      cx += (ax+bx+cx3) * v6; cy += (ay+by+cy3) * v6; cz += (az+bz+cz3) * v6;
      const ux=bx-ax, uy=by-ay, uz=bz-az, wx=cx3-ax, wy=cy3-ay, wz=cz3-az;
      area += Math.hypot(uy*wz-uz*wy, uz*wx-ux*wz, ux*wy-uy*wx) / 2;
    }
    const V = Math.abs(vol);
    const k = vol !== 0 ? 1 / (24 * vol) : 0;
    const d = typeof density === 'number' ? density : (DENSITY[density] || 0);
    return {
      volume: V,                                   // mm³
      volumeCm3: V / 1000,
      area,                                        // mm²
      areaCm2: area / 100,
      centroid: [cx * k, cy * k, cz * k],
      density: d,
      massG: d ? (V / 1000) * d : null,            // سم³ × غ/سم³
      bounds: boundsOf(a),
    };
  }

  window.CAD3DMod = {
    subdivide, weld, indexed, recalcNormals, flipNormals, separateLoose, joinGeoms,
    remesh, twist, taper, bend, arrayPath, slices, autoOrient, thinWalls, massProps,
    DENSITY, boundsOf,
  };
})();
