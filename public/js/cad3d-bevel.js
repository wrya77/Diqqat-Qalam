/**
 * cad3d-bevel.js — تدوير الحوافّ (Fillet) وشطفها (Chamfer)
 *
 *   نواة هذا التطبيق مثلّثات لا B-Rep، فلا وجود لـ«حافّة» أو «وجه» كأشياء
 *   قائمة بذاتها. لذلك نبني النموذج الناقص أوّلاً ثمّ نشتغل عليه:
 *
 *     ١) لحم الرؤوس وبناء جوار الأوجه
 *     ٢) ضمّ المثلّثات المستوية في «وجوه» مضلّعة (مربّع الصندوق وجهٌ واحد
 *        لا مثلّثان) — بلا هذا يصير القُطر الداخليّ حافّةً تُشطَف
 *     ٣) استخراج حدود كل وجه وتمييز الحوافّ الحادّة
 *     ٤) تقليص كل وجه عن حوافّه المشطوفة، ثمّ جسر بين الوجهين على كل حافّة:
 *        رباعيّ واحد للشطف، وقوسٌ بعدّة قطع للتدوير
 *     ٥) رقعة عند كل رأسٍ تلتقي فيه ثلاث حوافّ فأكثر
 *
 *   الفرق بين الشطف والتدوير هو عدد قطع الجسر فقط: قطعةٌ واحدة تُعطي سطحاً
 *   مستوياً (شطف)، وعدّة قطع على قوسٍ نصف قطره r تُعطي كرةً متدحرجة (تدوير).
 */
(function cad3dBevel() {
  'use strict';

  const D = () => window.CAD3DMod;
  const EPS = 1e-6;

  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const key2 = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  const toV3 = p => {
    if (!p) return null;
    if (Array.isArray(p)) return v3(+p[0] || 0, +p[1] || 0, +p[2] || 0);
    if (typeof p.x === 'number') return v3(p.x, p.y, p.z);
    return null;
  };

  /* ══════════════ ١ · نموذج الحوافّ والوجوه ══════════════ */

  /**
   * يبني من شبكة مثلّثات: رؤوساً ملحومة، ووجوهاً مستوية مضمومة، وحوافَّ
   * بينها مع زواياها ثنائية السطح.
   */
  function topology(geometry, tol, planarDeg) {
    const { V, F, S } = D().indexed(geometry, tol || 1e-4);
    if (!F.length) return null;

    const P = i => v3(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]);
    const fnorm = f => {
      const a = P(f[0]), b = P(f[1]), c = P(f[2]);
      return b.clone().sub(a).cross(c.clone().sub(a));
    };
    const N = F.map(f => { const n = fnorm(f); const L = n.length(); return L > EPS ? n.divideScalar(L) : v3(0, 0, 1); });
    const area = F.map(f => fnorm(f).length() / 2);

    // الحافّة → المثلّثات التي تشترك فيها
    const eMap = new Map();
    F.forEach((f, fi) => {
      for (let k = 0; k < 3; k++) {
        const kk = key2(f[k], f[(k + 1) % 3]);
        let l = eMap.get(kk);
        if (!l) { l = []; eMap.set(kk, l); }
        l.push(fi);
      }
    });

    // ضمّ المثلّثات المستوية: انتشارٌ عبر الحوافّ التي زاويتها تحت الحدّ
    const cosPlanar = Math.cos((planarDeg == null ? 1 : planarDeg) * Math.PI / 180);
    const group = new Int32Array(F.length).fill(-1);
    const groups = [];
    for (let s = 0; s < F.length; s++) {
      if (group[s] >= 0) continue;
      const gi = groups.length;
      const tris = [];
      const stack = [s];
      group[s] = gi;
      while (stack.length) {
        const fi = stack.pop();
        tris.push(fi);
        const f = F[fi];
        for (let k = 0; k < 3; k++) {
          for (const nb of (eMap.get(key2(f[k], f[(k + 1) % 3])) || [])) {
            if (nb === fi || group[nb] >= 0) continue;
            if (N[fi].dot(N[nb]) >= cosPlanar) { group[nb] = gi; stack.push(nb); }
          }
        }
      }
      // ناظم الوجه = متوسّط موزون بالمساحة (أدقّ من ناظم مثلّثٍ واحد)
      const n = v3(0, 0, 0);
      let A = 0;
      tris.forEach(t => { n.addScaledVector(N[t], area[t]); A += area[t]; });
      groups.push({ tris, n: n.normalize(), area: A });
    }

    /* حدود كل وجه: الحوافّ التي تظهر مرّةً واحدة داخل المجموعة.
       تُرتَّب حلقةً بتتبّع الاتجاه المُوجَّه كما في المثلّثات، فيبقى اللفّ
       متّسقاً مع ناظم الوجه. */
    groups.forEach(g => {
      const dir = new Map();                  // "a>b" مرّةً واحدة = حافّة حدّ
      for (const fi of g.tris) {
        const f = F[fi];
        for (let k = 0; k < 3; k++) {
          const a = f[k], b = f[(k + 1) % 3];
          const rev = b + '>' + a;
          if (dir.has(rev)) dir.delete(rev);   // داخليّة: مرّت في الاتجاهين
          else dir.set(a + '>' + b, [a, b]);
        }
      }
      const next = new Map();
      for (const [, [a, b]] of dir) next.set(a, b);
      const loops = [];
      const used = new Set();
      for (const [a] of next) {
        if (used.has(a)) continue;
        const loop = [];
        let cur = a, guard = 0;
        while (cur != null && !used.has(cur) && guard++ < 100000) {
          used.add(cur); loop.push(cur); cur = next.get(cur);
        }
        if (loop.length >= 3) loops.push(loop);
      }
      g.loops = loops;
    });

    // حوافّ الحدّ بين وجهين + زاويتها
    const edges = new Map();
    groups.forEach((g, gi) => {
      for (const loop of g.loops) {
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i], b = loop[(i + 1) % loop.length];
          const kk = key2(a, b);
          let e = edges.get(kk);
          if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), g: [] }; edges.set(kk, e); }
          if (!e.g.includes(gi)) e.g.push(gi);
        }
      }
    });
    for (const e of edges.values()) {
      if (e.g.length !== 2) { e.angle = 0; e.convex = true; continue; }
      const nA = groups[e.g[0]].n, nB = groups[e.g[1]].n;
      e.angle = Math.acos(Math.max(-1, Math.min(1, nA.dot(nB)))) * 180 / Math.PI;
      /* التحدّب: هل يقع اتجاه (nA+nB) خارج الجسم؟ نقيسه بموضع رأسٍ مقابل.
         المرجع يجب أن يكون من مثلّثٍ **ملاصقٍ لهذه الحافّة** لا من أوّل مثلّثٍ
         في الوجه: الوجه الواحد قد يضمّ عشرات المثلّثات (كحلقة أعلى الأنبوب)،
         فيقع المرجع على الطرف الآخر منه ويخرج الحكم معكوساً — ثمان عشرة من
         ستّين حافّةً على فوهة الأنبوب كانت تُحسب محدَّبةً وهي مقعَّرة، فتُشطَف
         في الاتجاه الخطأ ويكبر حجم الجسم بدل أن يصغر. */
      const mid = P(e.a).add(P(e.b)).multiplyScalar(0.5);
      const out = nA.clone().add(nB).normalize();
      const adj = eMap.get(key2(e.a, e.b)) || [];
      let ref = null;
      for (const ti of adj) {
        for (const vi of F[ti]) if (vi !== e.a && vi !== e.b) { ref = P(vi); break; }
        if (ref) break;
      }
      e.convex = ref ? ref.clone().sub(mid).dot(out) < 0 : true;
    }

    /* مركز كل وجه ومركز كل حافّة — مرساةُ الانتقاء.
       أرقام الرؤوس تتغيّر مع أي إعادة بناء، فحفظُ اختيار المستخدم برقمٍ هشّ.
       الإحداثيّ يبقى صحيحاً ما دام الشكل هو نفسه، ويقرؤه الإنسان عند التنقيح. */
    groups.forEach(g => {
      const c = v3(0, 0, 0);
      let w = 0;
      for (const fi of g.tris) {
        const f = F[fi];
        const m = P(f[0]).add(P(f[1])).add(P(f[2])).divideScalar(3);
        c.addScaledVector(m, area[fi]); w += area[fi];
      }
      g.center = w > EPS ? c.divideScalar(w) : c;
    });
    for (const e of edges.values()) {
      e.mid = P(e.a).add(P(e.b)).multiplyScalar(0.5);
      e.len = P(e.a).distanceTo(P(e.b));
    }

    // المثلّث المرسوم → الوجه الذي ينتمي إليه (للانتقاء بالأشعّة)
    const triGroup = new Int32Array((S[S.length - 1] || 0) + 1).fill(-1);
    F.forEach((_, fi) => { triGroup[S[fi]] = group[fi]; });

    return { V, F, S, P, groups, edges, eMap, triGroup, N, area };
  }

  /* ══════════════ ٢ · الشطف والتدوير ══════════════ */

  /**
   * @param o {dist, segments, angle, mode}
   *   dist     عرض الشطف أو نصف قطر التدوير (mm)
   *   segments ١ = شطف مستوٍ · أكثر = تدوير بقوس
   *   angle    أقلّ زاوية بين وجهين تُعدّ حافّةً حادّة (°)
   *   mode     'convex' (الافتراضيّ) · 'concave' · 'all'
   */
  function bevel(geometry, o) {
    const T = topology(geometry, 1e-4, 1);
    if (!T) return null;
    const opt = Object.assign({ dist: 2, segments: 1, angle: 25, mode: 'convex' }, o || {});
    const d = Math.max(1e-4, +opt.dist || 2);
    const segs = Math.max(1, Math.min(24, Math.round(opt.segments || 1)));
    const { V, P, groups, edges } = T;

    /* أيّ الحوافّ تُشطَف؟ إمّا كلّ حافّةٍ حادّة (الوضع الشامل)، وإمّا ما انتقاه
       المستخدم — يصل إلينا كإحداثيّات مراكز حوافّ (at) أو مراكز أوجه (faces)
       تُشطَف كلّ حدودها. الإحداثيّ لا الرقم: أرقام الرؤوس تتبدّل مع كل بناء. */
    const picked = new Set();
    const anchors = [].concat(opt.at || [], []).map(toV3).filter(Boolean);
    const faceAnchors = (opt.faces || []).map(toV3).filter(Boolean);

    if (anchors.length || faceAnchors.length) {
      const tolA = Math.max(1e-3, +opt.pickTol || 0.35);
      for (const [kk, e] of edges) {
        if (e.g.length !== 2) continue;
        if (anchors.some(a => a.distanceTo(e.mid) <= tolA)) { picked.add(kk); continue; }
        if (faceAnchors.length && e.g.some(gi => {
          const c = groups[gi] && groups[gi].center;
          return c && faceAnchors.some(a => a.distanceTo(c) <= tolA);
        })) picked.add(kk);
      }
    } else {
      for (const [kk, e] of edges) {
        if (e.g.length !== 2 || e.angle < opt.angle) continue;
        if (opt.mode === 'convex' && !e.convex) continue;
        if (opt.mode === 'concave' && e.convex) continue;
        picked.add(kk);
      }
    }
    if (!picked.size) return null;

    /* كم يتقلّص الوجه عن كلّ حافّة؟
     *
     *   الشطف يُعرَّف بعرضه، فالتقلّص هو d نفسه مهما كانت الزاوية.
     *
     *   أمّا التدوير فيُعرَّف بنصف القطر، والكرة التي نصف قطرها r تلامس الوجهين
     *   على بُعد r/tan(ψ/2) من الحافّة، حيث ψ زاوية الإسفين الذي تجلس فيه
     *   الكرة = ١٨٠° ناقص الزاوية بين الناظمين (وهي نفسها للحافّة المحدَّبة
     *   والمقعَّرة). كان التقلّص يُؤخذ r دائماً — وهو صحيحٌ عند ٩٠° فقط
     *   (tan45 = ١)، ولهذا خرجت كلّ قياسات الصندوق مضبوطة تماماً وبقي العطب
     *   مستتراً. على حافّة قاعدة المخروط (الزاوية الداخلية ٦٩٫٤°) يلزم
     *   ١٫٤٤ ضعفاً، فكان التدوير يقتطع نصف ما ينبغي: ٨٥ مم³ بدل ١٦٨. */
    const setbackOf = e => {
      if (segs === 1) return d;
      const psi = (180 - (e.angle || 0)) * Math.PI / 360;   // ψ/2 بالتقدير الدائريّ
      const t = Math.tan(psi);
      if (!(t > 1e-4)) return d * 50;      // إسفينٌ شبه منطبق — تقلّصٌ هائل، يُقصّ لاحقاً
      return Math.min(d / t, d * 50);
    };

    /* موضع الركن المُقلَّص: لكل (وجه، رأس) نحلّ نقطةً تبعد التقلّص المناسب عن
       كلّ حافّةٍ مشطوفة تلامسه داخل مستوى الوجه. حلقتان مستقيمتان ⇒ نظام ٢×٢. */
    const inset = new Map();                  // "gi:vi" → Vector3
    const cornerOf = (gi, vi) => inset.get(gi + ':' + vi);

    groups.forEach((g, gi) => {
      const n = g.n;
      for (const loop of g.loops) {
        const L = loop.length;
        for (let i = 0; i < L; i++) {
          const vi = loop[i];
          const prev = loop[(i - 1 + L) % L], next = loop[(i + 1) % L];
          const p = P(vi);
          // الاتجاه الداخليّ لكل حافّة داخل مستوى الوجه
          // الحلقة ملفوفة عكس عقارب الساعة حول الناظم، فداخل الوجه يقع يسار
          // اتجاه السير — أي n×e لا e×n. العكس يُزيح الوجوه إلى الخارج فيكبر
          // المجسّم بدل أن يُشطَف (٤٠ → ٤٦ على الصندوق).
          const inDir = (from, to) => {
            const e = P(to).clone().sub(P(from)).normalize();
            return n.clone().cross(e).normalize();
          };
          const nPrev = inDir(prev, vi);             // ناظم الحافّة (prev→vi)
          const nNext = inDir(vi, next);
          const offPrev = picked.has(key2(prev, vi)) ? setbackOf(edges.get(key2(prev, vi))) : 0;
          const offNext = picked.has(key2(vi, next)) ? setbackOf(edges.get(key2(vi, next))) : 0;
          let q;
          if (offPrev === 0 && offNext === 0) q = p.clone();
          else {
            // نبحث عن q = p + α·nPrev + β·nNext بحيث (q−p)·nPrev = offPrev
            // و(q−p)·nNext = offNext
            const a11 = nPrev.dot(nPrev), a12 = nNext.dot(nPrev);
            const a21 = nPrev.dot(nNext), a22 = nNext.dot(nNext);
            const det = a11 * a22 - a12 * a21;
            if (Math.abs(det) < 1e-9) {
              const nn = offPrev ? nPrev : nNext;
              q = p.clone().addScaledVector(nn, offPrev || offNext);
            } else {
              const al = (offPrev * a22 - offNext * a12) / det;
              const be = (a11 * offNext - a21 * offPrev) / det;
              q = p.clone().addScaledVector(nPrev, al).addScaledVector(nNext, be);
            }
          }
          inset.set(gi + ':' + vi, q);
        }
      }
    });

    const pos = [];
    const push = (a, b, c) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); };
    /* دفعٌ موجَّه: يقلب المثلّث إن كان ناظمه يشير إلى داخل الجسم.
       جسور الحوافّ تُبنى من ركنَي وجهين، وترتيب المجموعتين (أيّهما A) يأتي من
       جدول التجاور لا من الهندسة — فنصف الجسور كانت تخرج مقلوبة. الشبكة تبقى
       مغلقة (كل حافّة مرّتين) لكنّ الحجم يُحسب خطأً: ٢٠٩٢٨ بدل ٣٠٣٥٧. */
    /* المثلّثات المنحلّة تُرفَض — والفحص يجري بدقّة **التخزين** لا بدقّة الحساب.
       مروحة الركن تصل كلّ قطعةٍ من حلقة الأقواس بقمّة الكرة، وقد تقع القمّة على
       بُعد ١٠⁻⁷ من إحدى نقاط الحلقة: مثلّثٌ سليمٌ تماماً بحساب الـdouble، لكنّ
       الهندسة تُخزَّن Float32 (خطوتها عند إحداثيٍّ ١٤ نحو ١٠⁻⁶)، فتنطبق النقطتان
       عند التحويل ويصير المثلّث ذا مساحةٍ صفر **بعد** الدفع. مساحته صفر فلا
       يتغيّر الحجم — لكنّ الحافّة تُعَدّ في أربعة مثلّثات بدل اثنين فتبدو
       الشبكة مفتوحة وهي مغلقة (٤٨ على مخروطٍ بستّين ضلعاً).
       ولهذا لا ينفع حدٌّ مطلق على الحاصل الاتّجاهيّ: الانحلال لم يقع بعد وقت
       الفحص. نُقرّب الرؤوس إلى Float32 أوّلاً فنفحص ما سيُخزَّن فعلاً. */
    const f32 = v => v3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));
    const pushOut = (a, b, c, outward) => {
      const A = f32(a), Bv = f32(b), C = f32(c);
      const n = Bv.clone().sub(A).cross(C.clone().sub(A));
      if (n.lengthSq() === 0) return;
      if (n.dot(outward) >= 0) push(a, b, c); else push(a, c, b);
    };

    const arcAt = new Map();       // "vi:edgeKey" → قوس الحافّة عند ذلك الرأس

    /* جسر كل حافّة مشطوفة */
    for (const kk of picked) {
      const e = edges.get(kk);
      const [gA, gB] = e.g;
      const a0 = cornerOf(gA, e.a), a1 = cornerOf(gA, e.b);
      const b0 = cornerOf(gB, e.a), b1 = cornerOf(gB, e.b);
      if (!a0 || !a1 || !b0 || !b1) continue;

      const outward = groups[gA].n.clone().add(groups[gB].n).normalize();
      if (segs === 1) {
        pushOut(a0, a1, b1, outward); pushOut(a0, b1, b0, outward);   // شطف: رباعيّ مستوٍ
        // طرفا الشطف يُسجَّلان كقوسٍ من قطعتين، ليقرأهما شقّ الوجوه بالطريقة نفسها
        arcAt.set(e.a + ':' + kk, { pts: [a0, b0], gA, gB });
        arcAt.set(e.b + ':' + kk, { pts: [a1, b1], gA, gB });
        continue;
      }
      /* تدوير: قوسٌ حول محور الحافّة. مركز الكرة المتدحرجة يقع على تقاطع
         المستويين المُزاحين، ونصف قطرها المسافة إلى نقطتَي البداية. */
      const axis = P(e.b).clone().sub(P(e.a)).normalize();
      /* القوس يُبنى بإقحامٍ كرويّ بين الشعاعين لا بتدويرٍ صلب حول محور الحافّة.
         حين لا تُشطَف كلّ حوافّ الركن يكون ركن أحد الوجهين مُزاحاً في اتجاهين
         والآخر في اتجاهٍ واحد، فيختلف طولا الشعاعين ولا يكون الثاني عمودياً
         على المحور — فالتدوير الصلب لا يصل إليه أبداً: كان القوس ينتهي عند
         (20,16,20) بينما ركن الوجه عند (16,16,20)، فتُفتح الشبكة (٢٠ حافّة
         حرّة) ويخرج حجمٌ أكبر من الصندوق نفسه وهو محال.
         الإقحام الكرويّ يبدأ وينتهي عند الركنين بالضبط بحكم البناء، وهو مطابقٌ
         تماماً للتدوير الصلب حين يتساوى الشعاعان (حالة الشطف الشامل). */
      const arc = (s0, s1) => {
        const c = centerFor(s0, s1, groups[gA].n, groups[gB].n, axis, e.convex);
        const r0 = s0.clone().sub(c), r1 = s1.clone().sub(c);
        const L0 = r0.length(), L1 = r1.length();
        const out = [];
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          out.push(c.clone().addScaledVector(slerpV(r0, r1, t), L0 + (L1 - L0) * t));
        }
        return out;
      };
      const A = arc(a0, b0), B = arc(a1, b1);
      // نحتفظ بالقوسين لبناء رقعة الركن الكروية لاحقاً
      arcAt.set(e.a + ":" + kk, { pts: A, gA, gB });
      arcAt.set(e.b + ":" + kk, { pts: B, gA, gB });
      for (let i = 0; i < segs; i++) {
        pushOut(A[i], B[i], B[i + 1], outward);
        pushOut(A[i], B[i + 1], A[i + 1], outward);
      }
    }

    /* رقع الأركان: كل رأسٍ تلتقي عنده حافّتان مشطوفتان فأكثر */
    const atVert = new Map();
    for (const kk of picked) {
      const e = edges.get(kk);
      for (const vi of [e.a, e.b]) {
        let l = atVert.get(vi);
        if (!l) { l = []; atVert.set(vi, l); }
        l.push(e);
      }
    }
    /* أيّ الأوجه تلتقي عند كل رأس — يلزم لإغلاق نهاية الشطف الجزئيّ */
    const vertFaces = new Map();
    groups.forEach((g, gi) => {
      for (const loop of g.loops) for (const vi of loop) {
        let l = vertFaces.get(vi);
        if (!l) { l = new Set(); vertFaces.set(vi, l); }
        l.add(gi);
      }
    });

    for (const [vi, list] of atVert) {
      /* حافّتان تلتقيان عند رأس: في الشطف يتلامس الجسران فعلاً (قِيس مغلقاً
         وبحجمٍ مضبوط)، أمّا في التدوير فقد يشترك القوسان في طرفيهما ويسلكان
         مسارين مختلفين، فبينهما عدسةٌ كرويّة تبقى مفتوحة — ٢٤ حافّةً حرّة عند
         قطعتين و٢٠٠ عند ٢٤، وحجمٌ أكبر من الصندوق الأصليّ وهو محال. فتُبنى
         الرقعة الكرويّة نفسها من حافّتين فصاعداً. */
      if (list.length < (segs === 1 ? 3 : 2)) continue;
      const gs = new Set();
      list.forEach(e => e.g.forEach(g => gs.add(g)));
      const nAvg = v3(0, 0, 0);
      gs.forEach(gi => nAvg.add(groups[gi].n));
      if (nAvg.lengthSq() < EPS) continue;
      nAvg.normalize();

      if (segs === 1) {
        /* الشطف: ركن الشطف مستوٍ فعلاً، فمروحةٌ مسطّحة بين أركان الوجوه هي
           الشكل الصحيح تماماً (قِيس ٠٫٠٠٪ على صندوق). */
        const pts = [];
        gs.forEach(gi => { const q = cornerOf(gi, vi); if (q) pts.push(q); });
        if (pts.length < 3) continue;
        const ux = (Math.abs(nAvg.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0)).cross(nAvg).normalize();
        const uy = nAvg.clone().cross(ux).normalize();
        const mid = pts.reduce((s, p) => s.add(p.clone()), v3(0, 0, 0)).divideScalar(pts.length);
        pts.sort((p, q) => Math.atan2(p.clone().sub(mid).dot(uy), p.clone().sub(mid).dot(ux)) -
                           Math.atan2(q.clone().sub(mid).dot(uy), q.clone().sub(mid).dot(ux)));
        for (let i = 1; i < pts.length - 1; i++) pushOut(pts[0], pts[i], pts[i + 1], nAvg);
        continue;
      }

      /* التدوير: الكرة المتدحرجة تترك عند الركن رقعةً **كرويّة** لا مستوية.
         ملؤها بمثلّثٍ مسطّح يقتطع حجماً حقيقياً — قِيس نقصٌ ١٫٢٪ عند نصف قطر ٣
         و٥٫٢٪ عند ٦. فنبني مركز الكرة (النقطة التي تبعد r عن كل الوجوه
         الملاصقة) ونصل أقواس الحوافّ حوله مروحةً على سطح الكرة. */
      const c = ballCenter([...gs].map(gi => groups[gi].n), P(vi), d);
      if (!c) continue;
      // حلقة الحدّ: أقواس الحوافّ الملتقية عند هذا الرأس، مسلسلةً بأركان الوجوه
      const segsAt = list.map(e => arcAt.get(vi + ':' + key2(e.a, e.b))).filter(Boolean);
      if (segsAt.length < 2) continue;
      const loop = [];
      const used = new Set();
      let cur = segsAt[0], guard = 0;
      let pts2 = cur.pts.slice();
      used.add(0);
      loop.push(...pts2);
      while (used.size < segsAt.length && guard++ < 64) {
        const tail = loop[loop.length - 1];
        let best = -1, rev = false, bd = Infinity;
        segsAt.forEach((s2, i) => {
          if (used.has(i)) return;
          const d0 = s2.pts[0].distanceTo(tail), d1 = s2.pts[s2.pts.length - 1].distanceTo(tail);
          if (d0 < bd) { bd = d0; best = i; rev = false; }
          if (d1 < bd) { bd = d1; best = i; rev = true; }
        });
        if (best < 0) break;
        used.add(best);
        const ps = rev ? segsAt[best].pts.slice().reverse() : segsAt[best].pts.slice();
        loop.push(...ps.slice(1));               // لا تكرّر نقطة الوصل
      }
      if (loop.length < 3) continue;

      /* حلقةٌ لا تحيط بمساحة = لا شيء يُسَدّ.
         عند رأسٍ تلتقي فيه حافّتان منتقاتان يشترك القوسان في طرفيهما. فإن
         اختلف مساراهما بينهما (كحافّة قاعدة المخروط: تباعدٌ ٠٫١ مم) فبينهما
         عدسةٌ حقيقية تستحقّ الرقعة. وإن انطبقا (كحلقتَي الأنبوب، حيث الوجهان
         الجانبيّان متناظران تماماً) فالحلقة تذهب وتعود على المسار نفسه: مساحتها
         صفر، والمروحة عليها تُخرج كلّ مثلّثٍ **مرّتين** — ٤٦٤ مثلّثاً مكرَّراً
         حرفياً، فتُعَدّ الحافّة في أربعة مثلّثات وتبدو الشبكة مفتوحة.
         مساحة الحلقة (بطريقة Newell) تفرّق بين الحالتين بلا افتراضٍ عن الشكل. */
      const nw = v3(0, 0, 0);
      for (let i = 0; i < loop.length; i++) {
        nw.add(loop[i].clone().cross(loop[(i + 1) % loop.length]));
      }
      if (nw.length() / 2 < 1e-6 * d * d) continue;

      // القمّة على الكرة في اتجاه متوسّط الحلقة — تجعل الرقعة منتفخة كالكرة
      const mid = loop.reduce((s, p) => s.add(p.clone()), v3(0, 0, 0)).divideScalar(loop.length);
      const apex = c.clone().addScaledVector(mid.clone().sub(c).normalize(), d);
      for (let i = 0; i < loop.length; i++) {
        const A = loop[i], Bp = loop[(i + 1) % loop.length];
        if (A.distanceTo(Bp) < 1e-9) continue;
        pushOut(A, Bp, apex, nAvg);
      }
    }

    /* ── شقّ أركان الأوجه المُنهية ──
       حين لا تُشطَف كلُّ الحوافّ، ينتهي الشطف في منتصف الجسم. الوجه الثالث
       الملاصق لذلك الرأس لا حافّةَ له منتقاة، فيبقى ركنه على الرأس الأصليّ
       بينما انزاح جاراه — فيبرز منه لسانٌ مسطّح فوق سطح الشطف، والحلقة تبقى
       مفتوحة عند نقطة T (قِيس ٦٣٩٤٠ بدل ٦٣٨٢٠ على صندوق ٤٠).

       العلاج ليس رقعةً تُضاف بل شقُّ الركن نفسه: الوجه المُنهي يدخل الرأس من
       جهة جاره الأوّل فيجب أن يوافق ركنَه، ويخرج من جهة جاره الثاني فيوافق
       ركنه هو — أي أنّ الرأس الواحد يصير في حلقته نقطتين (أو قوساً كاملاً في
       التدوير) بدل نقطة. */
    const other = (e, gi) => (e.g[0] === gi ? e.g[1] : e.g[0]);
    const seqAt = new Map();                  // "gi:vi" → [Vector3, …]
    groups.forEach((g, gi) => {
      for (const loop of g.loops) {
        const L = loop.length;
        for (let i = 0; i < L; i++) {
          const vi = loop[i];
          const prev = loop[(i - 1 + L) % L], next = loop[(i + 1) % L];
          const kPrev = key2(prev, vi), kNext = key2(vi, next);
          if (picked.has(kPrev) || picked.has(kNext)) continue;   // ركنٌ مُزاح سلفاً
          if (!atVert.has(vi)) continue;                          // لا شطف عند هذا الرأس
          const ePrev = edges.get(kPrev), eNext = edges.get(kNext);
          const qA = ePrev && ePrev.g.length === 2 ? cornerOf(other(ePrev, gi), vi) : null;
          const qB = eNext && eNext.g.length === 2 ? cornerOf(other(eNext, gi), vi) : null;
          if (!qA || !qB) continue;
          if (qA.distanceTo(qB) < 1e-9) continue;                 // الجاران متّفقان: لا شقّ

          /* بين النقطتين يمرّ طرف الجسر. في التدوير هو قوسٌ منحنٍ لا وترٌ
             مستقيم، فنأخذ نقاطه كلّها وإلّا بقي فرقُ الانتفاخ مفتوحاً. */
          let seq = [qA, qB];
          for (const e of atVert.get(vi)) {
            const a = arcAt.get(vi + ':' + key2(e.a, e.b));
            if (!a || a.pts.length < 2) continue;
            const s = a.pts[0], t = a.pts[a.pts.length - 1];
            if (s.distanceTo(qA) < 1e-9 && t.distanceTo(qB) < 1e-9) { seq = a.pts.slice(); break; }
            if (t.distanceTo(qA) < 1e-9 && s.distanceTo(qB) < 1e-9) { seq = a.pts.slice().reverse(); break; }
          }
          seqAt.set(gi + ':' + vi, seq);
        }
      }
    });

    /* الوجوه المقلَّصة — تُثلَّث في مستواها ثمّ تُعاد إلى الفضاء */
    groups.forEach((g, gi) => {
      const n = g.n;
      // أساس محلّيّ للمستوى
      const ax = Math.abs(n.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0);
      const ux = ax.clone().cross(n).normalize();
      const uy = n.clone().cross(ux).normalize();
      const org = cornerOf(gi, g.loops[0][0]) || P(g.loops[0][0]);
      const to2 = p => new THREE.Vector2(p.clone().sub(org).dot(ux), p.clone().sub(org).dot(uy));
      const to3 = v => org.clone().addScaledVector(ux, v.x).addScaledVector(uy, v.y);

      const ptsOf = vi => seqAt.get(gi + ':' + vi) || [cornerOf(gi, vi)];
      const rings = g.loops.map(loop => {
        const out = [];
        for (const vi of loop) for (const p of ptsOf(vi)) if (p) out.push(to2(p));
        return out;
      }).filter(r => r.length >= 3);
      if (!rings.length) return;
      // الحلقة الأكبر مساحةً هي الحدّ الخارجيّ والبقية ثقوب
      const areaOf = r => { let s = 0; for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };
      let outer = rings[0], oi = 0;
      rings.forEach((r, i) => { if (Math.abs(areaOf(r)) > Math.abs(areaOf(outer))) { outer = r; oi = i; } });
      const holes = rings.filter((_, i) => i !== oi);
      if (areaOf(outer) < 0) outer = outer.slice().reverse();
      holes.forEach(h => { if (areaOf(h) > 0) h.reverse(); });
      let tri;
      try { tri = THREE.ShapeUtils.triangulateShape(outer, holes); }
      catch (_) { return; }
      const all = outer.concat(...holes);
      for (const t of tri) {
        const [A, B, C] = t.map(i => to3(all[i]));
        pushOut(A, B, C, n);
      }
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    g.userData.bevel = { edges: picked.size, corners: [...atVert.values()].filter(l => l.length >= 3).length,
                         dist: d, segments: segs, open: openEdges(pos) };
    return g;
  }

  /**
   * مركز الكرة المتدحرجة عند ركن: النقطة التي تبعد r عن كل الوجوه الملاصقة.
   * ثلاثة وجوه ⇒ نظامٌ محدَّد؛ أكثر ⇒ حلٌّ بالمربّعات الصغرى عبر المعادلات
   * الطبيعية (AᵀA)c = Aᵀb مع تنظيمٍ خفيف يمنع الانفراد.
   */
  function ballCenter(normals, through, r) {
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 0, 0];
    for (const n of normals) {
      const rhs = n.dot(through) - r;
      const v = [n.x, n.y, n.z];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) A[i * 3 + j] += v[i] * v[j];
        b[i] += v[i] * rhs;
      }
    }
    const lam = 1e-6 * Math.max(1e-9, A[0] + A[4] + A[8]);
    for (let i = 0; i < 3; i++) { A[i * 3 + i] += lam; b[i] += lam * [through.x, through.y, through.z][i]; }
    const M = [[A[0], A[1], A[2], b[0]], [A[3], A[4], A[5], b[1]], [A[6], A[7], A[8], b[2]]];
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let rr = c + 1; rr < 3; rr++) if (Math.abs(M[rr][c]) > Math.abs(M[piv][c])) piv = rr;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      if (piv !== c) { const t = M[c]; M[c] = M[piv]; M[piv] = t; }
      for (let rr = 0; rr < 3; rr++) {
        if (rr === c) continue;
        const f = M[rr][c] / M[c][c];
        for (let k = c; k < 4; k++) M[rr][k] -= f * M[c][k];
      }
    }
    return v3(M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]);
  }

  /**
   * عدد الحوافّ التي لا تظهر مرّتين بالضبط — أي مقياس انفتاح الشبكة.
   * أشكالٌ نادرة (قمّة المخروط: ستّون حافّة تلتقي في رأسٍ واحد) ما تزال تُخرج
   * شبكةً مفتوحة، ولا يجوز أن تمرّ صامتة: مجسّمٌ مفتوح يُفسد الحجم والـCSG
   * وملفّ الطباعة. نقيسها هنا ليُخبَر بها المستخدم بدل أن يكتشفها على الآلة.
   */
  function openEdges(pos) {
    const m = new Map();
    const key = (i) => `${Math.round(pos[i] * 1e4)},${Math.round(pos[i+1] * 1e4)},${Math.round(pos[i+2] * 1e4)}`;
    for (let i = 0; i < pos.length; i += 9) {
      const K = [key(i), key(i + 3), key(i + 6)];
      for (let k = 0; k < 3; k++) {
        const a = K[k], b = K[(k + 1) % 3];
        if (a === b) continue;
        const kk = a < b ? a + '|' + b : b + '|' + a;
        m.set(kk, (m.get(kk) || 0) + 1);
      }
    }
    let bad = 0;
    for (const v of m.values()) if (v !== 2) bad++;
    return bad;
  }

  /** اتجاه الدوران من r0 إلى r1 حول المحور */
  function rotSign(r0, r1, axis) {
    return r0.clone().cross(r1).dot(axis) >= 0 ? 1 : -1;
  }

  /** إقحام كرويّ بين اتجاهي شعاعين — يصل إلى الطرفين بالضبط */
  function slerpV(A, B, t) {
    const a = A.clone().normalize(), b = B.clone().normalize();
    const d = Math.max(-1, Math.min(1, a.dot(b)));
    const om = Math.acos(d);
    if (om < 1e-6) return a.lerp(b, t).normalize();
    if (Math.PI - om < 1e-6) return a;                 // متعاكسان: لا مستوى محدَّد
    const s = Math.sin(om);
    return a.multiplyScalar(Math.sin((1 - t) * om) / s)
            .add(b.multiplyScalar(Math.sin(t * om) / s)).normalize();
  }

  /**
   * مركز القوس: النقطة التي تبعد المسافة نفسها عن نقطتَي البداية وتقع على
   * تقاطع المستويين المارّين بهما عمودياً على وجهيهما.
   */
  function centerFor(p0, p1, nA, nB, axis, convex) {
    // نحلّ داخل المستوى العموديّ على المحور
    const u = nA.clone().sub(axis.clone().multiplyScalar(nA.dot(axis))).normalize();
    const w = nB.clone().sub(axis.clone().multiplyScalar(nB.dot(axis))).normalize();
    // c = p0 + s·u = p1 + t·w  ⇒  نحلّ بالإسقاط على قاعدتين
    const dv = p1.clone().sub(p0);
    const a11 = u.dot(u), a12 = -u.dot(w), a21 = w.dot(u), a22 = -w.dot(w);
    const b1 = dv.dot(u), b2 = dv.dot(w);
    const det = a11 * a22 - a12 * a21;
    if (Math.abs(det) < 1e-9) return p0.clone().add(p1).multiplyScalar(0.5);
    const s = (b1 * a22 - a12 * b2) / det;
    const c = p0.clone().addScaledVector(u, s);
    return c;
  }

  window.CAD3DBevel = { bevel, topology };
})();
