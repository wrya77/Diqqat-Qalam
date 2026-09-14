/**
 * cad3d-subsel.js — الانتقاء على مستوى الوجه والحافّة والرأس
 *
 *   حتى الآن كان أصغر ما يُنتقى هو الجسم كلّه، فكان كل أمرٍ شاملاً: تدوير
 *   «كلّ» الحوافّ الحادّة، لا الحافّة التي تقصدها. هذه الوحدة تضيف الطبقة
 *   الناقصة.
 *
 *   النواة مثلّثات، فالوجه والحافّة يُستخرَجان من نموذج الطوبولوجيا في
 *   cad3d-bevel: المثلّثات المستوية تُضَمّ في وجهٍ واحد، وحدودُها هي الحوافّ.
 *
 *   الانتقاء يُخزَّن **بالإحداثيّ لا بالرقم**: أرقام الرؤوس تُعاد توليدها مع كل
 *   بناء، فمرجعٌ رقميّ يشير بعد أوّل تعديلٍ إلى حافّةٍ أخرى تماماً. مركز الوجه
 *   ومنتصف الحافّة يبقيان ثابتين ما دام الشكل ثابتاً — وهما مقروءان للإنسان.
 */
(function cad3dSubSel() {
  'use strict';

  const V = () => window.CAD3DView;
  const BV = () => window.CAD3DBevel;

  const MODES = ['off', 'face', 'edge', 'vertex'];
  const LABEL = { off: 'جسم', face: 'وجه', edge: 'حافّة', vertex: 'رأس' };

  let mode = 'off';
  let sel = [];                 // [{meshId, kind, gi|key|vi, center:[x,y,z], ...}]
  let hover = null;
  const listeners = [];
  const emit = () => listeners.forEach(f => { try { f(selection()); } catch (_) {} });

  /* ══════════════ ذاكرة الطوبولوجيا ══════════════ */

  const topoCache = new WeakMap();          // geometry → topology

  function topoOf(mesh) {
    const g = (mesh && (mesh.userData.source || mesh.geometry)) || null;
    if (!g) return null;
    let T = topoCache.get(g);
    if (T === undefined) {
      // الزاوية نفسها المستعملة في الشطف (١°) وإلّا اختلف تعريف «الوجه» بين
      // ما تراه منتقىً وما يُشطَف فعلاً
      try { T = BV() ? BV().topology(g, 1e-4, 1) : null; } catch (_) { T = null; }
      topoCache.set(g, T);
    }
    return T;
  }

  const invalidate = () => { clear(true); };

  /* ══════════════ أدوات الشاشة ══════════════ */

  function rectOf() {
    const c = V().canvas();
    return c ? c.getBoundingClientRect() : null;
  }

  function projector() {
    const cam = V().camera(), r = rectOf();
    if (!cam || !r) return null;
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    return p => {
      v.copy(p).project(cam);
      return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
    };
  }

  /** مسافة نقطة إلى قطعة مستقيمة في المستوى */
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  /* ══════════════ الانتقاء ══════════════ */

  /**
   * يحوّل ضربة الشعاع إلى كِيانٍ فرعيّ حسب الوضع الحاليّ.
   * المرجع محلّيّ (قبل مصفوفة الجسم) لأنّ الهندسة المخزَّنة في شجرة الميزات
   * محلّية — والشطف يشتغل عليها هي.
   */
  function entityAt(ev, h) {
    if (!h || !h.object) return null;
    const mesh = h.object;
    const T = topoOf(mesh);
    if (!T) return null;
    const meshId = mesh.userData.id;
    mesh.updateMatrixWorld();
    const M = mesh.matrixWorld;
    const proj = projector();
    const r = rectOf();
    if (!proj || !r) return null;
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;

    const gi = T.triGroup[h.faceIndex];
    if (gi == null || gi < 0) return null;
    const g = T.groups[gi];

    if (mode === 'face') {
      return { meshId, kind: 'face', gi, center: T.groups[gi].center.toArray(),
               area: g.area, normal: g.n.toArray(), tris: g.tris.length };
    }

    // حوافّ حدود الوجه المضروب — نختار أقربها إلى المؤشّر على الشاشة
    const cand = [];
    for (const loop of g.loops) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        const kk = a < b ? a + '_' + b : b + '_' + a;
        const e = T.edges.get(kk);
        if (e) cand.push(e);
      }
    }
    if (!cand.length) return null;

    if (mode === 'vertex') {
      let best = null, bd = Infinity;
      const seen = new Set();
      for (const e of cand) for (const vi of [e.a, e.b]) {
        if (seen.has(vi)) continue;
        seen.add(vi);
        const w = T.P(vi).applyMatrix4(M);
        const s = proj(w);
        const d = Math.hypot(s.x - mx, s.y - my);
        if (d < bd) { bd = d; best = vi; }
      }
      if (best == null) return null;
      return { meshId, kind: 'vertex', vi: best, center: T.P(best).toArray() };
    }

    let best = null, bd = Infinity;
    for (const e of cand) {
      const A = proj(T.P(e.a).applyMatrix4(M)), B = proj(T.P(e.b).applyMatrix4(M));
      const d = segDist(mx, my, A.x, A.y, B.x, B.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return null;
    return { meshId, kind: 'edge', key: (best.a < best.b ? best.a + '_' + best.b : best.b + '_' + best.a),
             center: best.mid.toArray(), len: best.len, angle: best.angle, convex: best.convex };
  }

  const idOf = e => e && (e.meshId + ':' + e.kind + ':' + (e.key != null ? e.key : e.vi != null ? e.vi : e.gi));

  /* نصف قطر التقاط.
     حافّة الصورة الظلّية يمرّ عندها الشعاع بمحاذاة السطح فيُخطئه تماماً —
     ثلاثٌ من أربع حوافّ كانت تُنتقى والرابعة (على الحدّ) لا. فإن أخطأ الشعاع
     أعدناه على حلقةٍ صغيرة حول المؤشّر. المسافات تبقى محسوبةً من موضع المؤشّر
     الأصليّ، فلا ينزاح ما يُنتقى. */
  const RING = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3],
                [8, 0], [-8, 0], [0, 8], [0, -8]];
  function pickNear(ev, h) {
    if (h) return h;
    for (const [dx, dy] of RING) {
      if (!dx && !dy) continue;
      const g = V().pickAt({ clientX: ev.clientX + dx, clientY: ev.clientY + dy });
      if (g) return g;
    }
    return null;
  }

  function pickHook(ev, h) {
    if (mode === 'off') return false;
    const e = entityAt(ev, pickNear(ev, h));
    const add = ev.ctrlKey || ev.metaKey || ev.shiftKey;
    if (!e) { if (!add) { sel = []; paint(); emit(); } return true; }
    const id = idOf(e);
    if (add) {
      const i = sel.findIndex(s => idOf(s) === id);
      if (i >= 0) sel.splice(i, 1); else sel.push(e);
    } else sel = [e];
    paint();
    emit();
    return true;
  }

  let hoverT = 0;
  function hoverHook(ev) {
    if (mode === 'off') return;
    const now = performance.now();
    if (now - hoverT < 40) return;          // الحركة تُطلق عشرات المرّات بالثانية
    hoverT = now;
    const e = entityAt(ev, pickNear(ev, V().pickAt(ev)));
    const a = idOf(e), b = idOf(hover);
    if (a === b) return;
    hover = e;
    paint();
  }

  /* ══════════════ الإبراز ══════════════ */

  const OVER = 'dq-sub-overlay';
  const COL_SEL = 0xffb454, COL_HOV = 0x58a6ff;

  function clearOverlay(mesh) {
    for (const c of mesh.children.slice()) {
      if (c.name === OVER) { mesh.remove(c); c.geometry && c.geometry.dispose(); }
    }
  }

  function paint() {
    const view = V();
    if (!view || !view.ready()) return;
    for (const m of view.all()) clearOverlay(m);

    const draw = (e, color, depth) => {
      if (!e) return;
      const mesh = view.get(e.meshId);
      if (!mesh) return;
      const T = topoOf(mesh);
      if (!T) return;
      let obj = null;

      if (e.kind === 'face') {
        const g = T.groups[e.gi];
        if (!g) return;
        const pos = [];
        for (const fi of g.tris) {
          for (const vi of T.F[fi]) { const p = T.P(vi); pos.push(p.x, p.y, p.z); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
          depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      } else if (e.kind === 'edge') {
        const ed = T.edges.get(e.key);
        if (!ed) return;
        const geo = new THREE.BufferGeometry().setFromPoints([T.P(ed.a), T.P(ed.b)]);
        obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 3 }));
      } else {
        const p = T.P(e.vi);
        const geo = new THREE.BufferGeometry().setFromPoints([p]);
        obj = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 9, sizeAttenuation: false, depthTest: false }));
      }
      obj.name = OVER;
      obj.renderOrder = depth;
      mesh.add(obj);
    };

    if (hover && !sel.some(s => idOf(s) === idOf(hover))) draw(hover, COL_HOV, 996);
    sel.forEach(e => draw(e, COL_SEL, 998));
    view.render();
  }

  /* ══════════════ الواجهة البرمجية ══════════════ */

  function setMode(m) {
    if (MODES.indexOf(m) < 0) m = 'off';
    if (m === mode) return mode;
    mode = m;
    sel = []; hover = null;
    const view = V();
    if (view && view.ready()) {
      view.setPickHook(mode === 'off' ? null : pickHook);
      view.setHoverHook(mode === 'off' ? null : hoverHook);
      // مقبض التحويل يحرّك الجسم كلّه — لا معنى له هنا، ويحجب النقر قرب المركز
      if (view.suppressGizmo) view.suppressGizmo(mode !== 'off');
      paint();
    }
    emit();
    return mode;
  }

  function clear(silent) {
    sel = []; hover = null;
    paint();
    if (!silent) emit();
  }

  const selection = () => sel.map(s => Object.assign({}, s));

  /** مراسي الشطف: مراكز الحوافّ المنتقاة ومراكز الأوجه المنتقاة */
  function anchors() {
    return {
      at: sel.filter(s => s.kind === 'edge').map(s => s.center),
      faces: sel.filter(s => s.kind === 'face').map(s => s.center),
    };
  }

  /** وصفٌ عربيّ لما هو منتقىً — يظهر في شريط المعلومات */
  function describe() {
    if (!sel.length) return '';
    const n = sel.length;
    if (n === 1) {
      const s = sel[0];
      if (s.kind === 'face') return `وجه · مساحة ${s.area.toFixed(2)} مم² · ${s.tris} مثلّث`;
      if (s.kind === 'edge') return `حافّة · طول ${s.len.toFixed(2)} مم · زاوية ${s.angle.toFixed(1)}° · ${s.convex ? 'محدَّبة' : 'مقعَّرة'}`;
      return `رأس · ${s.center.map(v => v.toFixed(2)).join('، ')}`;
    }
    if (n === 2 && sel[0].kind === 'face' && sel[1].kind === 'face') {
      const a = new THREE.Vector3().fromArray(sel[0].normal);
      const b = new THREE.Vector3().fromArray(sel[1].normal);
      const ang = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180 / Math.PI;
      return `وجهان · الزاوية بينهما ${ang.toFixed(2)}°`;
    }
    if (n === 2 && sel[0].kind === 'vertex' && sel[1].kind === 'vertex') {
      const a = new THREE.Vector3().fromArray(sel[0].center);
      const b = new THREE.Vector3().fromArray(sel[1].center);
      return `رأسان · المسافة ${a.distanceTo(b).toFixed(3)} مم`;
    }
    const kinds = sel.map(s => LABEL[s.kind]);
    const tot = sel.reduce((t, s) => t + (s.kind === 'edge' ? s.len : s.kind === 'face' ? s.area : 0), 0);
    const unit = sel.every(s => s.kind === 'edge') ? ` · مجموع الأطوال ${tot.toFixed(2)} مم`
               : sel.every(s => s.kind === 'face') ? ` · مجموع المساحات ${tot.toFixed(2)} مم²` : '';
    return `${n} ${kinds[0]}${unit}`;
  }

  window.CAD3DSub = {
    MODES, LABEL,
    setMode, mode: () => mode,
    selection, clear, invalidate, anchors, describe,
    on: f => listeners.push(f),
    topologyOf: topoOf,
  };
})();
