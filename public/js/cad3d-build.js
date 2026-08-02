/**
 * cad3d-build.js — بانية المجسّمات: من مضلّعات ثنائية الأبعاد إلى شبكات ثلاثية
 *
 *  • extrude — بثق بارتفاع وزاوية ميل (draft) وشطف حوافّ (bevel)
 *  • revolve — تدوير مقطع حول محور بزاوية جزئية أو كاملة مع أغطية
 *  • sweep   — كنس مقطع على مسار بنقل موازٍ للإطار (بلا التواء)
 *  • loft    — تجسير بين مقطعين بإعادة تشكيل متساوية العدد
 *  • مجسّمات أوّلية: صندوق · أسطوانة · كرة · مخروط · حلقة · أنبوب · إسفين
 *
 *  اصطلاح المحاور: تصميم الكانفس (x,y) وY إلى الأسفل → عالم ثلاثيّ (x, -y, z)
 *  وZ إلى الأعلى. الانعكاس ضروريّ وإلّا خرج المجسّم مقلوباً عن التصميم.
 */
(function cad3dBuild() {
  'use strict';

  const TAU = Math.PI * 2;

  /* ══════════════ أدوات المضلّعات ══════════════ */

  function ringArea(r) {
    let a = 0;
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i], q = r[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  function pointInRing(pt, r) {
    let hit = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a.y > pt.y) !== (b.y > pt.y) &&
          pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  }

  /** يزيل النقاط المتلاصقة ويغلق الحلقة ضمناً (بلا تكرار أوّل نقطة) */
  function clean(r, tol) {
    const t = tol || 1e-6, out = [];
    for (const p of r) {
      const q = out[out.length - 1];
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) > t) out.push({ x: p.x, y: p.y });
    }
    while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x,
                                        out[0].y - out[out.length - 1].y) <= t) out.pop();
    return out;
  }

  /**
   * يفرز الحلقات إلى أشكال {outer, holes} بعمق التداخل:
   * عمق زوجيّ ⇒ حدّ خارجيّ، فرديّ ⇒ ثقب داخل أقرب حدّ يحويه.
   */
  function groupRings(rings) {
    const rs = rings.map(r => clean(r)).filter(r => r.length >= 3 && Math.abs(ringArea(r)) > 1e-9);
    const depth = rs.map((r, i) => {
      let d = 0;
      const pt = r[0];
      rs.forEach((o, j) => { if (j !== i && pointInRing(pt, o)) d++; });
      return d;
    });
    const shapes = [];
    rs.forEach((r, i) => { if (depth[i] % 2 === 0) shapes.push({ outer: r, holes: [], idx: i }); });
    rs.forEach((r, i) => {
      if (depth[i] % 2 === 0) return;
      // الثقب ينتمي لأصغر حدّ خارجيّ يحويه
      let best = null, bestA = Infinity;
      for (const s of shapes) {
        if (!pointInRing(r[0], s.outer)) continue;
        const a = Math.abs(ringArea(s.outer));
        if (a < bestA) { bestA = a; best = s; }
      }
      (best || shapes[0])?.holes.push(r);
    });
    // توحيد الاتجاه: الحدّ عكس عقارب الساعة والثقب معها — شرط التثليث
    for (const s of shapes) {
      if (ringArea(s.outer) < 0) s.outer.reverse();
      s.holes.forEach(h => { if (ringArea(h) > 0) h.reverse(); });
    }
    return shapes;
  }

  /** إعادة تشكيل حلقة إلى n نقطة موزّعة بالتساوي على المحيط */
  function resample(r, n) {
    const N = r.length, seg = [];
    let total = 0;
    for (let i = 0; i < N; i++) {
      const a = r[i], b = r[(i + 1) % N];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      seg.push(d); total += d;
    }
    if (total < 1e-9) return r.slice();
    const out = [];
    let acc = 0, si = 0, sAcc = 0;
    const step = total / n;
    for (let k = 0; k < n; k++) {
      const target = k * step;
      while (si < N - 1 && sAcc + seg[si] < target) { sAcc += seg[si]; si++; }
      const t = seg[si] > 1e-12 ? (target - sAcc) / seg[si] : 0;
      const a = r[si], b = r[(si + 1) % N];
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      acc = target;
    }
    return out;
  }

  /**
   * إزاحة حلقة بمقدار d (موجب للخارج) بمنصّفات الزوايا.
   * تقريب بسيط يكفي لزوايا الميل الصغيرة؛ يُسقِط الحلقة إن انعكس اتجاهها.
   */
  function offsetRing(r, d) {
    if (Math.abs(d) < 1e-9) return r.slice();
    const n = r.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = r[i], a = r[(i - 1 + n) % n], b = r[(i + 1) % n];
      let ax = p.x - a.x, ay = p.y - a.y, bx = b.x - p.x, by = b.y - p.y;
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      ax /= la; ay /= la; bx /= lb; by /= lb;
      // ناظما الضلعين للخارج (الحلقة عكس عقارب الساعة)
      let nx = (ay + by), ny = -(ax + bx);
      const ln = Math.hypot(nx, ny);
      if (ln < 1e-9) { out.push({ x: p.x, y: p.y }); continue; }
      nx /= ln; ny /= ln;
      const cosH = Math.max(0.25, Math.sqrt(Math.max(0, (1 + (ax * bx + ay * by)) / 2)));
      out.push({ x: p.x + nx * d / cosH, y: p.y + ny * d / cosH });
    }
    const before = ringArea(r), after = ringArea(out);
    if (before * after <= 0) return null;      // انقلب الاتجاه ⇒ اختفت الحلقة
    return out;
  }

  /* ══════════════ بناء الشبكة ══════════════ */

  const V2 = (x, y) => new THREE.Vector2(x, y);

  /**
   * عكس محور Y يتمّ هنا **قبل** التطبيع لا داخل البواني.
   * السبب: العكس تحويلٌ مرآتيّ يقلب اتجاه دوران كل حلقة، فلو تمّ لاحقاً لصارت
   * الحلقة الخارجية مع عقارب الساعة وانقلبت نواظم الأغطية والجدران — وهو ما
   * كان يُنتج أحجاماً خاطئة في البثق المائل والتجسير والكنس.
   */
  const mirrorRings = rings => rings.map(r => r.map(p => ({ x: p.x, y: -p.y })));
  const prep = rings => groupRings(mirrorRings(rings));

  /** يبني THREE.Shape من {outer, holes} — الإحداثيات معكوسة ومطبَّعة سلفاً */
  function toThreeShape(s) {
    const sh = new THREE.Shape(s.outer.map(p => V2(p.x, p.y)));
    for (const h of s.holes) sh.holes.push(new THREE.Path(h.map(p => V2(p.x, p.y))));
    return sh;
  }

  /** يثلّث غطاءً عند ارتفاع z؛ flip يعكس اتجاه الوجه (للغطاء السفليّ) */
  function capTris(shape, z, flip, out) {
    const contour = shape.outer.map(p => V2(p.x, p.y));
    const holes = shape.holes.map(h => h.map(p => V2(p.x, p.y)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = contour.concat(...holes);
    for (const f of faces) {
      const t = flip ? [f[2], f[1], f[0]] : f;
      for (const i of t) out.push(all[i].x, all[i].y, z);
    }
  }

  function geomFrom(pos) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  /* ══════════════ البثق ══════════════ */

  /**
   * @param rings حلقات ثنائية الأبعاد بإحداثيات التصميم
   * @param o {height, draft (درجات), bevel, bevelSize, steps}
   */
  function extrude(rings, o) {
    const op = Object.assign({ height: 10, draft: 0, bevel: 0, steps: 1 }, o || {});
    const shapes = prep(rings);
    if (!shapes.length) return null;
    const h = Math.max(0.01, +op.height || 10);
    const draft = +op.draft || 0;

    // بلا ميل: مولّد Three أدقّ وأسرع، ويمنحنا شطف الحوافّ مجّاناً
    if (Math.abs(draft) < 1e-4) {
      // الشطف: bevelOffset الافتراضيّ صفر فيتمدّد المقطع للخارج ويكبر المجسّم.
      // الكاد يقتطع للداخل — فنُزيح بـ-bev ونخصم سماكة الشطف من العمق ليبقى
      // المجسّم داخل مظروفه المطلوب تماماً.
      const bev = Math.max(0, Math.min(+op.bevel || 0, h / 2.05));
      const geoms = shapes.map(s => new THREE.ExtrudeGeometry(toThreeShape(s), {
        depth: Math.max(0.01, h - 2 * bev), steps: Math.max(1, op.steps | 0),
        bevelEnabled: bev > 0,
        bevelThickness: bev, bevelSize: bev, bevelOffset: -bev,
        bevelSegments: bev > 0 ? 3 : 0,
        curveSegments: 12,
      }));
      return mergeGeoms(geoms);
    }

    // بميل: بناء يدويّ طبقةً طبقة بإزاحة الحلقات
    const t = Math.tan(draft * Math.PI / 180);
    const steps = Math.min(64, Math.max(2, Math.ceil(h / Math.max(0.5, h / 12))));
    const pos = [];
    for (const s of shapes) {
      const levels = [];
      for (let i = 0; i <= steps; i++) {
        const z = h * i / steps;
        const d = -t * z;                       // ميل موجب ⇒ تضييق للأعلى
        const outer = offsetRing(s.outer, d);
        if (!outer) break;                      // انطبق المقطع — نتوقّف عند آخر مستوٍ سليم
        const holes = s.holes.map(x => offsetRing(x, -d)).filter(Boolean);
        levels.push({ outer, holes, z });
      }
      if (levels.length < 2) continue;
      capTris(levels[0], levels[0].z, true, pos);
      capTris(levels[levels.length - 1], levels[levels.length - 1].z, false, pos);
      for (let i = 0; i < levels.length - 1; i++) wall(levels[i], levels[i + 1], pos);
    }
    return pos.length ? geomFrom(pos) : null;
  }

  /** جدار بين مستويين لهما نفس بنية الحلقات */
  function wall(a, b, pos) {
    const pair = (ra, rb, flip) => {
      const n = Math.min(ra.length, rb.length);
      if (n < 3) return;
      const A = ra.length === n ? ra : resample(ra, n);
      const B = rb.length === n ? rb : resample(rb, n);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p0 = [A[i].x, A[i].y, a.z], p1 = [A[j].x, A[j].y, a.z];
        const q0 = [B[i].x, B[i].y, b.z], q1 = [B[j].x, B[j].y, b.z];
        if (flip) pos.push(...p0, ...q0, ...q1, ...p0, ...q1, ...p1);
        else      pos.push(...p0, ...q1, ...q0, ...p0, ...p1, ...q1);
      }
    };
    pair(a.outer, b.outer, false);
    const n = Math.min(a.holes.length, b.holes.length);
    for (let i = 0; i < n; i++) pair(a.holes[i], b.holes[i], true);
  }

  function mergeGeoms(list) {
    const gs = list.filter(Boolean);
    if (!gs.length) return null;
    if (gs.length === 1) return gs[0];
    const pos = [];
    for (const g0 of gs) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      const a = g.attributes.position.array;
      for (let i = 0; i < a.length; i++) pos.push(a[i]);
    }
    return geomFrom(pos);
  }

  /* ══════════════ التدوير ══════════════ */

  /**
   * يدوّر المقطع حول محور التصميم المختار.
   * axis: 'x' يدوّر حول المحور الأفقيّ · 'y' حول الرأسيّ.
   * المقطع يجب أن يقع كلّه في جهة واحدة من المحور، وإلّا انقلب على نفسه.
   */
  function revolve(rings, o) {
    const op = Object.assign({ axis: 'y', angle: 360, segments: 48 }, o || {});
    const shapes = prep(rings);
    if (!shapes.length) return null;
    const ang = Math.max(1, Math.min(360, +op.angle || 360)) * Math.PI / 180;
    const full = Math.abs(ang - TAU) < 1e-6;
    const seg = Math.max(3, Math.min(256, op.segments | 0 || 48));
    const vert = op.axis === 'y';

    // نقل المقطع ليلامس المحور من جهة واحدة
    let min = Infinity;
    for (const s of shapes) for (const r of [s.outer, ...s.holes]) for (const p of r)
      min = Math.min(min, vert ? p.x : p.y);
    const shift = min < 0 ? -min : 0;

    const pos = [];
    const map = (p, th) => {
      const u = (vert ? p.x : p.y) + shift;      // نصف القطر
      const v = vert ? p.y : p.x;                // الإحداثيّ على المحور
      return vert
        ? [u * Math.cos(th), u * Math.sin(th), v]           // حول Z بعد القلب
        : [v, u * Math.cos(th), u * Math.sin(th)];          // حول X
    };

    for (const s of shapes) {
      const loops = [s.outer, ...s.holes];
      for (let li = 0; li < loops.length; li++) {
        const r = loops[li];
        const flip = li > 0;
        for (let k = 0; k < seg; k++) {
          const t0 = ang * k / seg, t1 = ang * (k + 1) / seg;
          for (let i = 0; i < r.length; i++) {
            const a = r[i], b = r[(i + 1) % r.length];
            const A0 = map(a, t0), B0 = map(b, t0), A1 = map(a, t1), B1 = map(b, t1);
            if (flip) pos.push(...A0, ...B1, ...B0, ...A0, ...A1, ...B1);
            else      pos.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
          }
        }
      }
      if (!full) {                                  // غطاءان عند طرفَي القوس
        const contour = s.outer.map(p => V2(p.x, p.y));
        const holes = s.holes.map(h => h.map(p => V2(p.x, p.y)));
        const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
        const all = s.outer.concat(...s.holes);
        for (const th of [0, ang]) {
          const flip = th === 0;
          for (const f of faces) {
            const tri = flip ? [f[2], f[1], f[0]] : f;
            for (const i of tri) pos.push(...map(all[i], th));
          }
        }
      }
    }
    return pos.length ? geomFrom(pos) : null;
  }

  /* ══════════════ الكنس على مسار ══════════════ */

  /**
   * ينقل المقطع على مسار ثلاثيّ الأبعاد بنقلٍ موازٍ للإطار — يمنع الالتواء
   * الذي يصيب طريقة Frenet عند الأجزاء المستقيمة.
   */
  function sweep(rings, path3, o) {
    const op = Object.assign({ closed: false, caps: true }, o || {});
    const shapes = prep(rings);
    if (!shapes.length || !path3 || path3.length < 2) return null;

    const P = path3.map(p => new THREE.Vector3(p.x, p.y, p.z || 0));
    const N = P.length;
    const tang = [];
    for (let i = 0; i < N; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)];
      tang.push(b.clone().sub(a).normalize());
    }
    // إطار ابتدائيّ عموديّ على المماس
    let up = Math.abs(tang[0].z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const U = [], W = [];
    let u = up.clone().cross(tang[0]).normalize();
    for (let i = 0; i < N; i++) {
      if (i > 0) {                     // نقل موازٍ: أدر الإطار بأقلّ دوران
        const q = new THREE.Quaternion().setFromUnitVectors(tang[i - 1], tang[i]);
        u = u.clone().applyQuaternion(q).normalize();
      }
      const w = tang[i].clone().cross(u).normalize();
      U.push(u.clone()); W.push(w.clone());
    }

    const pos = [];
    const place = (p, i) => {
      const o2 = P[i];
      return [
        o2.x + U[i].x * p.x + W[i].x * p.y,
        o2.y + U[i].y * p.x + W[i].y * p.y,
        o2.z + U[i].z * p.x + W[i].z * p.y,
      ];
    };
    for (const s of shapes) {
      const loops = [s.outer, ...s.holes];
      loops.forEach((r, li) => {
        const flip = li > 0;
        const last = op.closed ? N : N - 1;
        for (let i = 0; i < last; i++) {
          const j = (i + 1) % N;
          for (let k = 0; k < r.length; k++) {
            const m = (k + 1) % r.length;
            const A0 = place(r[k], i), B0 = place(r[m], i);
            const A1 = place(r[k], j), B1 = place(r[m], j);
            if (flip) pos.push(...A0, ...B1, ...B0, ...A0, ...A1, ...B1);
            else      pos.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
          }
        }
      });
      if (op.caps && !op.closed) {
        const contour = s.outer.map(p => V2(p.x, p.y));
        const holes = s.holes.map(h => h.map(p => V2(p.x, p.y)));
        const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
        const all = s.outer.concat(...s.holes);
        [[0, true], [N - 1, false]].forEach(([i, flip]) => {
          for (const f of faces) {
            const tri = flip ? [f[2], f[1], f[0]] : f;
            for (const ix of tri) pos.push(...place(all[ix], i));
          }
        });
      }
    }
    return pos.length ? geomFrom(pos) : null;
  }

  /* ══════════════ التجسير ══════════════ */

  function loft(ringsA, ringsB, o) {
    const op = Object.assign({ height: 20, steps: 1 }, o || {});
    const A = prep(ringsA), B = prep(ringsB);
    if (!A.length || !B.length) return null;
    const h = +op.height || 20;
    const n = Math.max(24, Math.min(400, Math.max(A[0].outer.length, B[0].outer.length)));
    const a = resample(A[0].outer, n), b = resample(B[0].outer, n);
    const pos = [];
    capTris({ outer: a, holes: A[0].holes }, 0, true, pos);
    capTris({ outer: b, holes: B[0].holes }, h, false, pos);
    const steps = Math.max(1, Math.min(64, op.steps | 0 || 1));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const lvl = t => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t }));
      const L0 = lvl(t0), L1 = lvl(t1), z0 = h * t0, z1 = h * t1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p0 = [L0[i].x, L0[i].y, z0], p1 = [L0[j].x, L0[j].y, z0];
        const q0 = [L1[i].x, L1[i].y, z1], q1 = [L1[j].x, L1[j].y, z1];
        pos.push(...p0, ...q1, ...q0, ...p0, ...p1, ...q1);
      }
    }
    return geomFrom(pos);
  }

  /* ══════════════ المجسّمات الأوّلية ══════════════ */

  const prim = {
    box:      p => new THREE.BoxGeometry(p.w || 40, p.d || 40, p.h || 20),
    cylinder: p => new THREE.CylinderGeometry(p.r || 20, p.r2 != null ? p.r2 : (p.r || 20),
                                              p.h || 40, p.seg || 48),
    cone:     p => new THREE.ConeGeometry(p.r || 20, p.h || 40, p.seg || 48),
    sphere:   p => new THREE.SphereGeometry(p.r || 20, p.seg || 40, Math.max(8, (p.seg || 40) / 2)),
    torus:    p => new THREE.TorusGeometry(p.r || 25, p.r2 || 6, 20, p.seg || 60),
    tube:     p => tubeGeom(p),
    wedge:    p => wedgeGeom(p),
  };

  /** أنبوب مجوّف = أسطوانة ناقصة أسطوانة — يُبنى مباشرةً بلا CSG لسرعته */
  function tubeGeom(p) {
    const R = p.r || 20, r = Math.min(R - 0.2, p.r2 != null ? p.r2 : R * 0.6), h = p.h || 40;
    const seg = Math.max(8, p.seg || 48), pos = [];
    for (let i = 0; i < seg; i++) {
      const a0 = TAU * i / seg, a1 = TAU * (i + 1) / seg;
      const co = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
      const O0 = [R * co[0], R * co[1]], O1 = [R * co[2], R * co[3]];
      const I0 = [r * co[0], r * co[1]], I1 = [r * co[2], r * co[3]];
      const z0 = -h / 2, z1 = h / 2;
      // الجدار الخارجيّ
      pos.push(O0[0], O0[1], z0, O1[0], O1[1], z0, O1[0], O1[1], z1);
      pos.push(O0[0], O0[1], z0, O1[0], O1[1], z1, O0[0], O0[1], z1);
      // الجدار الداخليّ (معكوس)
      pos.push(I0[0], I0[1], z0, I1[0], I1[1], z1, I1[0], I1[1], z0);
      pos.push(I0[0], I0[1], z0, I0[0], I0[1], z1, I1[0], I1[1], z1);
      // الحلقتان العلويّة والسفليّة
      pos.push(O0[0], O0[1], z1, O1[0], O1[1], z1, I1[0], I1[1], z1);
      pos.push(O0[0], O0[1], z1, I1[0], I1[1], z1, I0[0], I0[1], z1);
      pos.push(O0[0], O0[1], z0, I1[0], I1[1], z0, O1[0], O1[1], z0);
      pos.push(O0[0], O0[1], z0, I0[0], I0[1], z0, I1[0], I1[1], z0);
    }
    return geomFrom(pos);
  }

  function wedgeGeom(p) {
    const w = p.w || 40, d = p.d || 40, h = p.h || 20;
    const A = [0, 0, 0], B = [w, 0, 0], C = [w, d, 0], D = [0, d, 0];
    const E = [0, 0, h], F = [0, d, h];
    const pos = [];
    const tri = (...v) => pos.push(...v[0], ...v[1], ...v[2]);
    tri(A, C, B); tri(A, D, C);          // القاعدة
    tri(A, B, E); tri(B, F, E);          // الوجه المائل (مثلّثان)
    tri(B, C, F); tri(D, F, C);          // الجانبان
    tri(A, E, D); tri(D, E, F);
    return geomFrom(pos);
  }

  function primitive(kind, params) {
    const f = prim[kind];
    if (!f) return null;
    const g = f(params || {});
    // مولّدات Three تبني حول محور Y؛ عالمنا Z إلى الأعلى فنُدير مرّة واحدة
    if (['cylinder', 'cone', 'sphere', 'torus'].includes(kind)) {
      g.rotateX(Math.PI / 2);
      g.computeBoundingBox(); g.computeBoundingSphere();
    }
    return g;
  }

  window.CAD3DBuild = {
    extrude, revolve, sweep, loft, primitive,
    groupRings, ringArea, resample, offsetRing, primitives: Object.keys(prim),
  };
})();
