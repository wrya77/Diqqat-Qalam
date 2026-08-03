/**
 * cad3d.js — مساحة العمل ثلاثية الأبعاد: المستند وشجرة الميزات والواجهة
 *
 *  النموذج بارامتريّ بتاريخ ميزات كبرامج الكاد: كل عملية تُحفظ كميزة بمعاملاتها،
 *  وتعديل معامل يُعيد بناء الميزة وكل ما بُني فوقها. الشجرة قابلة للتحرير والحذف
 *  وإعادة الترتيب البصريّ، والنتيجة تُصدَّر STL/OBJ أو تُعاد إلى مسار CNC.
 *
 *  المصدر الثنائيّ: أشكال المحرّر تُحوَّل بـ_shapeToContours إلى حلقات، وتُلتقط
 *  لقطةً داخل الميزة — فتعديل التصميم لاحقاً لا يكسر المجسّم إلا بطلب «تحديث».
 *
 *  Three.js يُحمَّل كسولاً عند أوّل فتح للتبويب (٦٠٠ك.ب لا تُحمَّل بلا داعٍ).
 */
(function cad3d() {
  'use strict';

  const toast = (m, t) => window.app?.toast?.(m, t || 'info');
  const ed = () => window.app?.editor || window.editor || null;
  const K = () => window.CAD3DKernel;
  const B = () => window.CAD3DBuild;
  const V = () => window.CAD3DView;

  let booted = false, threeReady = false, loading = null;
  let feats = [];              // شجرة الميزات
  let seq = 1;
  let host = null, treeEl = null, infoEl = null, statEl = null;
  const undoStack = [], redoStack = [];

  /* ══════════════ تحميل Three كسولاً ══════════════ */

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('تعذّر تحميل ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensureThree() {
    if (typeof THREE !== 'undefined') { threeReady = true; return true; }
    if (loading) return loading;
    loading = (async () => {
      try { await loadScript('/vendor/three.min.js'); }
      catch (_) { await loadScript('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js'); }
      threeReady = typeof THREE !== 'undefined';
      return threeReady;
    })();
    return loading;
  }

  /* ══════════════ الميزات ══════════════ */

  const uid = () => 'f' + (seq++) + Date.now().toString(36).slice(-3);

  const KINDS = {
    box:      { name: 'صندوق',    icon: 'cube' },
    cylinder: { name: 'أسطوانة',  icon: 'circle' },
    cone:     { name: 'مخروط',    icon: 'triangle' },
    sphere:   { name: 'كرة',      icon: 'circle' },
    torus:    { name: 'حلقة',     icon: 'circle' },
    tube:     { name: 'أنبوب',    icon: 'circle' },
    wedge:    { name: 'إسفين',    icon: 'triangle' },
    extrude:  { name: 'بثق',      icon: 'arrow-up' },
    revolve:  { name: 'تدوير',    icon: 'rotate' },
    sweep:    { name: 'كنس',      icon: 'pen' },
    loft:     { name: 'تجسير',    icon: 'blend' },
    boolean:  { name: 'عملية',    icon: 'blend' },
    import:   { name: 'مستورد',   icon: 'download' },
  };

  function addFeature(kind, params, src) {
    const f = {
      id: uid(), kind, params: params || {}, src: src || [],
      name: KINDS[kind] ? KINDS[kind].name : kind,
      color: 0x9fb3c8,
      tf: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      hidden: false,
    };
    feats.push(f);
    return f;
  }

  /** يبني هندسة ميزةٍ واحدة؛ يُعيد BufferGeometry أو null */
  function buildOne(f, geomOf) {
    const b = B();
    switch (f.kind) {
      case 'box': case 'cylinder': case 'cone': case 'sphere':
      case 'torus': case 'tube': case 'wedge':
        return b.primitive(f.kind, f.params);
      case 'extrude': return b.extrude(f.params.rings || [], f.params);
      case 'revolve': return b.revolve(f.params.rings || [], f.params);
      case 'sweep':   return b.sweep(f.params.rings || [], f.params.path || [], f.params);
      case 'loft':    return b.loft(f.params.ringsA || [], f.params.ringsB || [], f.params);
      case 'import':  return f.params.geometry || null;
      case 'op': {
        const S = geomOf(f.src[0]);
        if (!S) return null;
        const O = window.CAD3DOps;
        if (!O) return null;
        // تُخبز مصفوفة المصدر في الرؤوس أوّلاً، وإلّا عملت المرآة والمصفوفة
        // حول الأصل لا حول موضع المجسّم الفعليّ
        const g = S.geometry.clone().applyMatrix4(S.matrix);
        const P = f.params;
        switch (P.op) {
          case 'shell':   return O.shell(g, P.t);
          case 'offset':  return O.offsetSurface(g, P.d);
          case 'mirror':  return O.mirror(g, P.axis);
          case 'linear':  return O.linearPattern(g, P);
          case 'circular':return O.circularPattern(g, P);
          case 'hull':    return O.convexHull(g);
          case 'decimate':return O.decimate(g, P.cell);
          case 'center':  return O.centerOrigin(g, P.mode);
          case 'smooth':  return O.smooth(g, P.iters, P.lambda);
          case 'splitA':  { const r = O.splitByPlane(g, P.axis, P.offset); return r && r.a; }
          case 'splitB':  { const r = O.splitByPlane(g, P.axis, P.offset); return r && r.b; }
          case 'copy':    return g;
          default: return null;
        }
      }
      case 'boolean': {
        const A = geomOf(f.src[0]), Bg = geomOf(f.src[1]);
        if (!A || !Bg) return null;
        const k = K();
        const pa = k.fromGeometry(A.geometry, A.matrix);
        const pb = k.fromGeometry(Bg.geometry, Bg.matrix);
        const op = f.params.op === 'sub' ? k.subtract : (f.params.op === 'int' ? k.intersect : k.union);
        return k.toGeometry(op(pa, pb));
      }
      default: return null;
    }
  }

  function matrixOf(f) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.tf.rx, f.tf.ry, f.tf.rz));
    m.compose(new THREE.Vector3(f.tf.px, f.tf.py, f.tf.pz), q,
              new THREE.Vector3(f.tf.sx || 1, f.tf.sy || 1, f.tf.sz || 1));
    return m;
  }

  /** إعادة بناء المستند كاملاً — بسيطة وصحيحة؛ الشجرة صغيرة عادةً */
  function rebuild() {
    const v = V();
    if (!v || !v.ready()) return;
    const sel = v.getSelection();
    v.clearSolids();

    const built = new Map();               // id → {geometry, matrix}
    const consumed = new Set();
    // أي ميزة تستهلك مصادرها — إلا «نسخة» فهي تُبقي الأصل ظاهراً
    for (const f of feats) {
      if (f.kind === 'op' && f.params.op === 'copy') continue;
      if (f.kind === 'op' && String(f.params.op).startsWith('split') && f.params.keepSrc) continue;
      f.src.forEach(id => consumed.add(id));
    }

    for (const f of feats) {
      let g = null;
      try { g = buildOne(f, id => built.get(id) || null); }
      catch (err) {
        f.error = err.message || String(err);
        toast(`تعذّرت ميزة «${f.name}»: ${f.error}`, 'error');
        continue;
      }
      f.error = null;
      if (!g) { f.error = 'لم تنتج هندسة'; continue; }
      built.set(f.id, { geometry: g, matrix: matrixOf(f) });
      if (consumed.has(f.id) || f.hidden) continue;
      const mesh = v.addSolid(g, { id: f.id, color: f.color, name: f.name });
      mesh.position.set(f.tf.px, f.tf.py, f.tf.pz);
      mesh.rotation.set(f.tf.rx, f.tf.ry, f.tf.rz);
      mesh.scale.set(f.tf.sx || 1, f.tf.sy || 1, f.tf.sz || 1);
      // الخامة والإخفاء صفتان للميزة لا للشبكة — والشبكة تُبنى من جديد في كل
      // إعادة بناء، فلولا إعادة تطبيقهما هنا لعاد المجسّم رماديّاً وظاهراً بعد
      // أوّل تعديل معامل
      const M = MATS[f.mat];
      if (M) {
        mesh.material.color.setHex(M.color);
        mesh.material.metalness = M.metalness;
        mesh.material.roughness = M.roughness;
        mesh.material.needsUpdate = true;
      }
      if (f.off) mesh.visible = false;
    }
    // العزل والتفجير حالتان بصريّتان على شبكاتٍ لم تعد موجودة — تُصفَّران
    isolated = false; exploded = 0;
    document.getElementById('c3-iso')?.classList.remove('on');
    document.getElementById('c3-exp')?.classList.remove('on');

    v.setSelection(sel.filter(id => !consumed.has(id) && feats.some(f => f.id === id)));
    renderTree();
    updateInfo();
    v.render();
    saveSession();
  }

  const featById = id => feats.find(f => f.id === id) || null;

  /* ══════════════ جسر الأشكال الثنائية ══════════════ */

  /** حلقات الأشكال المحدَّدة في محرّر الرسم (أو كلّها إن لم يُحدَّد شيء) */
  function selectedRings() {
    const e = ed();
    if (!e || !e._shapeToContours) return null;
    let idx = [];
    if (e.msel && e.msel.size) idx = [...e.msel];
    else if (e.selectedIndex != null && e.selectedIndex >= 0) idx = [e.selectedIndex];
    else idx = e.shapes.map((_, i) => i);
    const rings = [];
    for (const i of idx) {
      const s = e.shapes[i];
      if (!s) continue;
      const rs = e._shapeToContours(s);
      if (rs) for (const r of rs) if (r && r.length >= 3) rings.push(r.map(p => ({ x: p.x, y: p.y })));
    }
    return rings.length ? rings : null;
  }

  /** مسار ثلاثيّ من شكل ثنائيّ محدَّد — للكنس */
  function selectedPath() {
    const e = ed();
    if (!e || !e._shapeToContours) return null;
    const idx = e.msel && e.msel.size ? [...e.msel] : [];
    if (idx.length < 2) return null;
    const s = e.shapes[idx[idx.length - 1]];
    const rs = s && e._shapeToContours(s);
    if (!rs || !rs[0]) return null;
    return rs[0].map(p => ({ x: p.x, y: -p.y, z: 0 }));
  }

  /* ══════════════ العمليات ══════════════ */

  async function opPrimitive(kind) {
    const F = {
      box:      [{ key: 'w', label: 'العرض (mm)', def: 40 }, { key: 'd', label: 'العمق (mm)', def: 40 }, { key: 'h', label: 'الارتفاع (mm)', def: 20 }],
      cylinder: [{ key: 'r', label: 'نصف القطر (mm)', def: 20 }, { key: 'h', label: 'الارتفاع (mm)', def: 40 }, { key: 'seg', label: 'التقسيمات (صفر = تلقائيّ)', def: 0, min: 0, max: 256 }],
      cone:     [{ key: 'r', label: 'نصف قطر القاعدة', def: 20 }, { key: 'h', label: 'الارتفاع (mm)', def: 40 }],
      sphere:   [{ key: 'r', label: 'نصف القطر (mm)', def: 20 }],
      torus:    [{ key: 'r', label: 'نصف القطر الكبير', def: 25 }, { key: 'r2', label: 'نصف قطر المقطع', def: 6 }],
      tube:     [{ key: 'r', label: 'نصف القطر الخارجيّ', def: 20 }, { key: 'r2', label: 'الداخليّ', def: 12 }, { key: 'h', label: 'الارتفاع', def: 40 }],
      wedge:    [{ key: 'w', label: 'العرض', def: 40 }, { key: 'd', label: 'العمق', def: 40 }, { key: 'h', label: 'الارتفاع', def: 20 }],
    }[kind];
    let p = {};
    if (window.DQPrompt && F) {
      const r = await window.DQPrompt(KINDS[kind].name, F);
      if (!r) return;
      p = r;
    }
    snapshot();
    addFeature(kind, p);
    rebuild();
    V().fit();
    toast(`أُضيف ${KINDS[kind].name}`, 'success');
  }

  async function opExtrude() {
    const rings = selectedRings();
    if (!rings) { toast('حدّد شكلاً في لوحة الرسم أوّلاً', 'warn'); return; }
    let p = { height: 10, draft: 0, bevel: 0 };
    if (window.DQPrompt) {
      const r = await window.DQPrompt('بثق إلى مجسّم', [
        { key: 'height', label: 'الارتفاع (mm)', def: 10, min: 0.1 },
        { key: 'draft', label: 'زاوية الميل (°)', def: 0, min: -45, max: 45 },
        { key: 'bevel', label: 'شطف الحوافّ (mm)', def: 0, min: 0 },
      ]);
      if (!r) return;
      p = r;
    }
    p.rings = rings;
    snapshot();
    const f = addFeature('extrude', p);
    f.name = `بثق (${rings.length} حلقة)`;
    rebuild(); V().fit();
    toast('تمّ البثق', 'success');
  }

  async function opRevolve() {
    const rings = selectedRings();
    if (!rings) { toast('حدّد مقطعاً في لوحة الرسم أوّلاً', 'warn'); return; }
    let p = { axis: 'y', angle: 360, segments: 48 };
    if (window.DQPrompt) {
      const r = await window.DQPrompt('تدوير المقطع', [
        { key: 'axis', label: 'المحور', type: 'select', def: 'y',
          options: [{ v: 'y', t: 'رأسيّ' }, { v: 'x', t: 'أفقيّ' }] },
        { key: 'angle', label: 'الزاوية (°)', def: 360, min: 1, max: 360 },
        { key: 'segments', label: 'التقسيمات', def: 96, min: 3, max: 512 },
      ]);
      if (!r) return;
      p = r;
    }
    p.rings = rings;
    snapshot();
    addFeature('revolve', p);
    rebuild(); V().fit();
    toast('تمّ التدوير', 'success');
  }

  async function opSweep() {
    const e = ed();
    const idx = e && e.msel ? [...e.msel] : [];
    if (idx.length < 2) { toast('حدّد شكلين: المقطع ثم المسار (آخر محدَّد = المسار)', 'warn'); return; }
    const path = selectedPath();
    const secIdx = idx.slice(0, -1);
    const rings = [];
    for (const i of secIdx) {
      const rs = e._shapeToContours(e.shapes[i]);
      if (rs) rs.forEach(r => rings.push(r.map(p => ({ x: p.x, y: p.y }))));
    }
    if (!rings.length || !path) { toast('تعذّر قراءة المقطع أو المسار', 'error'); return; }
    snapshot();
    addFeature('sweep', { rings, path, caps: true });
    rebuild(); V().fit();
    toast('تمّ الكنس على المسار', 'success');
  }

  async function opLoft() {
    const e = ed();
    const idx = e && e.msel ? [...e.msel] : [];
    if (idx.length !== 2) { toast('حدّد مقطعين اثنين للتجسير بينهما', 'warn'); return; }
    const rd = i => (e._shapeToContours(e.shapes[i]) || []).map(r => r.map(p => ({ x: p.x, y: p.y })));
    let h = 20;
    if (window.DQPrompt) {
      const r = await window.DQPrompt('تجسير بين مقطعين', [{ key: 'height', label: 'الارتفاع (mm)', def: 20 }]);
      if (!r) return;
      h = r.height;
    }
    snapshot();
    addFeature('loft', { ringsA: rd(idx[0]), ringsB: rd(idx[1]), height: h, steps: 12 });
    rebuild(); V().fit();
    toast('تمّ التجسير', 'success');
  }

  function opBoolean(op) {
    const sel = V().getSelection();
    if (sel.length !== 2) { toast('حدّد مجسّمين اثنين في العرض ثلاثيّ الأبعاد', 'warn'); return; }
    const names = { uni: 'اتحاد', sub: 'طرح', int: 'تقاطع' };
    snapshot();
    const f = addFeature('boolean', { op }, sel.slice());
    f.name = names[op] || 'عملية';
    // النتيجة تحلّ محلّ مصدريها في ترتيب الشجرة
    rebuild();
    if (f.error) { feats = feats.filter(x => x !== f); rebuild(); return; }
    V().setSelection([f.id]);
    toast(`تمّ ${names[op]} المجسّمين`, 'success');
  }

  async function opTransform() {
    const sel = V().getSelection();
    if (sel.length !== 1) { toast('حدّد مجسّماً واحداً', 'warn'); return; }
    const f = featById(sel[0]);
    if (!f || !window.DQPrompt) return;
    const r = await window.DQPrompt('تحويل دقيق', [
      { key: 'px', label: 'إزاحة X', def: +f.tf.px.toFixed(3) },
      { key: 'py', label: 'إزاحة Y', def: +f.tf.py.toFixed(3) },
      { key: 'pz', label: 'إزاحة Z', def: +f.tf.pz.toFixed(3) },
      { key: 'rz', label: 'دوران Z (°)', def: +(f.tf.rz * 180 / Math.PI).toFixed(2) },
      { key: 's',  label: 'تحجيم منتظم', def: +f.tf.sx.toFixed(3), min: 0.01 },
    ]);
    if (!r) return;
    snapshot();
    f.tf.px = r.px; f.tf.py = r.py; f.tf.pz = r.pz;
    f.tf.rz = r.rz * Math.PI / 180;
    f.tf.sx = f.tf.sy = f.tf.sz = r.s || 1;
    rebuild();
  }

  async function opEdit(id) {
    const f = featById(id);
    if (!f || !window.DQPrompt) return;
    const P = f.params;
    const fields = [];
    if (f.kind === 'extrude') fields.push(
      { key: 'height', label: 'الارتفاع (mm)', def: P.height ?? 10 },
      { key: 'draft', label: 'الميل (°)', def: P.draft ?? 0 },
      { key: 'bevel', label: 'الشطف (mm)', def: P.bevel ?? 0 });
    else if (f.kind === 'revolve') fields.push(
      { key: 'angle', label: 'الزاوية (°)', def: P.angle ?? 360, min: 1, max: 360 },
      { key: 'segments', label: 'التقسيمات', def: P.segments ?? 96 });
    else if (f.kind === 'loft') fields.push({ key: 'height', label: 'الارتفاع', def: P.height ?? 20 });
    else if (['box', 'wedge'].includes(f.kind)) fields.push(
      { key: 'w', label: 'العرض', def: P.w ?? 40 }, { key: 'd', label: 'العمق', def: P.d ?? 40 },
      { key: 'h', label: 'الارتفاع', def: P.h ?? 20 });
    else if (['cylinder', 'cone', 'tube'].includes(f.kind)) fields.push(
      { key: 'r', label: 'نصف القطر', def: P.r ?? 20 },
      { key: 'r2', label: 'نصف قطر ثانٍ', def: P.r2 ?? 12 },
      { key: 'h', label: 'الارتفاع', def: P.h ?? 40 });
    else if (f.kind === 'sphere') fields.push({ key: 'r', label: 'نصف القطر', def: P.r ?? 20 });
    else if (f.kind === 'torus') fields.push(
      { key: 'r', label: 'الكبير', def: P.r ?? 25 }, { key: 'r2', label: 'المقطع', def: P.r2 ?? 6 });
    else if (f.kind === 'boolean') fields.push({ key: 'op', label: 'العملية', type: 'select', def: P.op || 'uni',
      options: [{ v: 'uni', t: 'اتحاد' }, { v: 'sub', t: 'طرح' }, { v: 'int', t: 'تقاطع' }] });
    else { toast('هذه الميزة بلا معاملات قابلة للتحرير', 'info'); return; }

    fields.push({ key: '__name', label: 'الاسم', type: 'text', def: f.name });
    const r = await window.DQPrompt('تحرير: ' + f.name, fields);
    if (!r) return;
    snapshot();
    for (const k of Object.keys(r)) {
      if (k === '__name') { f.name = r[k] || f.name; continue; }
      f.params[k] = r[k];
    }
    rebuild();
    toast('أُعيد بناء الميزة وما فوقها', 'success');
  }

  function opDelete() {
    const sel = V().getSelection();
    if (!sel.length) { toast('لا يوجد محدَّد', 'warn'); return; }
    snapshot();
    // حذف ميزة يحذف كل ما بُني عليها — وإلا صارت الشجرة معلّقة على العدم
    const drop = new Set(sel);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of feats) {
        if (drop.has(f.id)) continue;
        if (f.src.some(id => drop.has(id))) { drop.add(f.id); grew = true; }
      }
    }
    feats = feats.filter(f => !drop.has(f.id));
    rebuild();
    toast(`حُذفت ${drop.size} ميزة`, 'success');
  }

  /* ══════════════ الاستيراد والتصدير ══════════════ */

  function opImportSTL() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.stl';
    inp.onchange = () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => {
        const g = K().importSTL(fr.result);
        if (!g) { toast('تعذّرت قراءة ملف STL', 'error'); return; }
        snapshot();
        const f = addFeature('import', { geometry: g });
        f.name = file.name.replace(/\.stl$/i, '');
        rebuild(); V().fit();
        toast(`استُورد ${f.name}`, 'success');
      };
      fr.readAsArrayBuffer(file);
    };
    inp.click();
  }

  function visibleGeoms() {
    const v = V();
    return v.all().map(m => ({ geometry: m.geometry, matrix: m.matrixWorld.clone(), name: m.userData.name }));
  }

  function download(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }

  function opExportSTL() {
    const gs = visibleGeoms();
    if (!gs.length) { toast('لا يوجد مجسّم للتصدير', 'warn'); return; }
    gs.forEach(g => g.geometry.computeBoundingBox());
    download(new Blob([K().exportSTL(gs)], { type: 'model/stl' }), 'diqqat-qalam.stl');
    toast(`صُدِّر STL — ${gs.length} مجسّم`, 'success');
  }

  function opExportOBJ() {
    const gs = visibleGeoms();
    if (!gs.length) { toast('لا يوجد مجسّم للتصدير', 'warn'); return; }
    download(new Blob([K().exportOBJ(gs, gs.map(g => g.name))], { type: 'text/plain' }), 'diqqat-qalam.obj');
    toast('صُدِّر OBJ', 'success');
  }

  /* ══════════════ الواجهة ══════════════ */

  function injectCSS() {
    if (document.getElementById('cad3d-css')) return;
    const s = document.createElement('style');
    s.id = 'cad3d-css';
    s.textContent = `
      /* لا بدّ من .active — مُحدِّد المُعرِّف يتغلّب على قاعدة .out-pane المخفية
         فتبقى اللوحة ظاهرةً دائماً وتنكشف مع بقية الألسنة عند ملء الشاشة. */
      #pane-cad.active{display:flex;flex-direction:column;min-height:0;overflow:hidden}

      /* ══ رموز المساحة ══
         مصدر واحد لكل لون ومقاس هنا، مشتقّ من متغيّرات السمة العامّة — فتبديل
         السمة يسري تلقائياً، وتصغير الأدوات يصير تعديل رقمٍ واحد لا مطاردة
         عشرين قاعدة. تُعلَن أيضاً على العناصر المنقولة إلى body (الانبثاق
         والتلميح وقائمة السياق) لأنّها تخرج من شجرة اللوحة فتفقد وراثتها. */
      #pane-cad,.c3-fly,.c3-tip{
        --c3-bar:var(--bg1,#0d1117); --c3-panel:var(--bg2,#161b22); --c3-hi:var(--bg3,#1c2128);
        --c3-line:var(--border,#30363d); --c3-fg:var(--text,#e6edf3);
        --c3-fg2:var(--text2,#b1bac4); --c3-fg3:var(--text3,#8b949e);
        --c3-acc:var(--accent,#2f81f7); --c3-acc2:var(--accent-h,#58a6ff);
        --c3-sel:color-mix(in srgb,var(--accent,#2f81f7) 20%,transparent);
        --c3-r:7px;            /* نصف قطر موحّد */
        --c3-chip:23px;        /* ارتفاع رقاقة الشريط */
        --c3-rail:34px;        /* عرض الريل */
        --c3-ico:13px;         /* أيقونة الشريط */
      }

      /* ── الشريط العلويّ ──
         يلتفّ ولا يمرّر: الشريط الممرَّر يُخفي أزراره خلف حافّته فيبدو ناقصاً.
         وكل زرّ أيقونة **مع نصّ** — الأيقونة وحدها لا تُقرأ في هذا المقاس.
         الأزرار تُجمَّع في كتلٍ محدودة بإطار (segmented) بدل خطوط فاصلة عارية:
         الكتلة تحمل معنى «هذه أدوات مترابطة»، ولا تنكسر داخلياً عند الالتفاف. */
      .c3-top{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:4px;
        padding:5px 6px;background:var(--c3-bar);border-bottom:1px solid var(--c3-line)}
      .c3-grp{flex:0 0 auto;display:inline-flex;align-items:center;gap:1px;padding:2px;
        border:1px solid var(--c3-line);border-radius:9px;background:var(--c3-panel)}
      .c3-grow{flex:1 1 auto;min-width:4px}

      .c3-ic{flex:0 0 auto;min-height:var(--c3-chip);display:inline-flex;align-items:center;
        gap:4px;padding:0 7px;border:1px solid transparent;border-radius:6px;
        background:transparent;cursor:pointer;color:var(--c3-fg2);
        font-family:inherit;font-size:10.5px;font-weight:600;white-space:nowrap;
        transition:background .14s ease,color .14s ease,border-color .14s ease}
      .c3-ic:hover{background:var(--c3-hi);color:var(--c3-fg)}
      .c3-ic.on{background:var(--c3-sel);border-color:var(--c3-acc);color:var(--c3-acc2)}
      .c3-ic:disabled{opacity:.38;cursor:default}
      .c3-ic:disabled:hover{background:transparent;color:var(--c3-fg2)}
      .c3-ic svg{width:var(--c3-ico);height:var(--c3-ico);flex:0 0 auto}
      .c3-ic .lbl{font-size:10.5px;font-weight:600;letter-spacing:.1px}

      /* ── الريل الجانبيّ: مجموعات أدوات بمثلّث انبثاق ── */
      .c3-main{flex:1 1 auto;min-height:0;display:flex}
      .c3-rail{flex:0 0 auto;width:var(--c3-rail);display:flex;flex-direction:column;gap:1px;
        padding:4px 2px;overflow-y:auto;overflow-x:hidden;
        background:var(--c3-bar);border-inline-end:1px solid var(--c3-line)}
      .c3-rail::-webkit-scrollbar{width:5px}
      .c3-rail::-webkit-scrollbar-thumb{background:var(--c3-line);border-radius:3px}
      .c3-slot{position:relative;flex:0 0 auto;align-self:center}
      .c3-t{width:28px;height:26px;display:flex;align-items:center;justify-content:center;
        border:1px solid transparent;border-radius:6px;background:none;cursor:pointer;padding:0;
        color:var(--c3-fg2);transition:background .14s ease,color .14s ease,border-color .14s ease}
      .c3-t:hover{background:var(--c3-hi);color:var(--c3-fg)}
      .c3-t.on,.c3-slot.open .c3-t{background:var(--c3-sel);border-color:var(--c3-acc);
        color:var(--c3-acc2)}
      .c3-t svg{width:15px;height:15px}
      .c3-arw{position:absolute;inset-block-end:1px;inset-inline-end:1px;width:0;height:0;
        border-inline-start:3.5px solid transparent;border-block-end:3.5px solid var(--c3-fg3);
        pointer-events:none}

      /* ــ الانبثاق والقوائم ــ
         مثبَّت بالنافذة لا بالريل: الريل له overflow-y:auto، والـCSS يحوّل عندها
         overflow-x من visible إلى auto قسراً — فأي ابن يخرج عن عرضه يُقصّ
         ويختفي. لهذا كانت الأدوات «لا تفتح». */
      .c3-fly{position:fixed;z-index:2500;display:none;min-width:196px;max-width:280px;
        padding:4px;border-radius:10px;background:var(--c3-panel);
        border:1px solid var(--c3-line);box-shadow:0 18px 44px rgba(0,0,0,.55);
        max-height:76vh;overflow-y:auto;overscroll-behavior:contain}
      .c3-slot.open .c3-fly,.c3-fly.open{display:block;animation:c3in .13s ease}
      @keyframes c3in{from{opacity:0;transform:translateY(-5px)}}
      .c3-fh{display:flex;align-items:center;gap:5px;padding:5px 8px 6px;font-size:9.5px;
        font-weight:800;letter-spacing:.4px;color:var(--c3-fg3);text-transform:uppercase}
      .c3-fh svg{width:12px;height:12px;opacity:.75}
      .c3-fs{height:1px;margin:3px 6px;background:var(--c3-line)}
      .c3-fi{display:flex;align-items:center;gap:7px;width:100%;padding:5px 8px;border:none;
        border-radius:6px;background:none;cursor:pointer;color:var(--c3-fg2);
        font-family:inherit;font-size:11.5px;font-weight:600;text-align:start;white-space:nowrap;
        transition:background .1s ease,color .1s ease}
      .c3-fi:hover,.c3-fi.cur{background:var(--c3-hi);color:var(--c3-fg)}
      .c3-fi.cur{box-shadow:inset 2px 0 0 var(--c3-acc)}
      .c3-fi svg{width:13px;height:13px;flex:0 0 auto;opacity:.8}
      .c3-fi .k{margin-inline-start:auto;padding:1px 5px;border-radius:4px;font-size:9.5px;
        font-weight:700;color:var(--c3-fg3);background:var(--c3-bar);
        border:1px solid var(--c3-line)}
      /* كتلٌ مهاجرة من الشريط إلى قائمة «المزيد»: الأزرار نفسها تُنقل بمعرّفاتها
         فتبقى أزرار الحالة (الإظهار، المقطع، العزل) تعمل وتُضيء كما هي */
      .c3-fly .c3-grp{display:flex;flex-direction:column;gap:1px;padding:0;border:none;
        background:none;width:100%}
      .c3-fly .c3-grp + .c3-grp{margin-top:3px;padding-top:3px;border-top:1px solid var(--c3-line)}
      .c3-fly .c3-ic{width:100%;justify-content:flex-start;padding:5px 8px;font-size:11.5px;
        border-radius:6px}
      .c3-fly .c3-ic .lbl{font-size:11.5px}

      /* تلميح عائم — الأسماء لا تُزحم الشريط بل تظهر عند المرور */
      .c3-tip{position:fixed;z-index:2600;pointer-events:none;padding:3px 8px;border-radius:6px;
        font-size:11px;font-weight:600;white-space:nowrap;opacity:0;
        background:var(--c3-bar);color:var(--c3-fg);border:1px solid var(--c3-acc);
        box-shadow:0 8px 22px rgba(0,0,0,.5);transition:opacity .12s ease}
      .c3-tip.on{opacity:1}

      /* ── الكانفس وطبقة الـHUD فوقه ── */
      .c3-view{flex:1 1 auto;min-width:0;position:relative;background:#0b1016}
      .c3-hud{position:absolute;inset:0;pointer-events:none;z-index:5}
      .c3-hud > *{pointer-events:auto}
      /* الخلايا تتّسع لأطول كلمة عربية فيها («مجسّم» ٢٧px عند ٩px) — التصغير
         دون قياس النصّ كان يُخرج الكلمات من خلاياها فتتراكب */
      .c3-cube{position:absolute;inset-block-start:7px;inset-inline-end:7px;
        display:grid;grid-template-columns:repeat(3,30px);grid-template-rows:repeat(3,20px);gap:1px;
        padding:2px;border-radius:8px;background:color-mix(in srgb,#0d1117 62%,transparent);
        border:1px solid var(--c3-line);backdrop-filter:blur(4px)}
      .c3-cb{border:1px solid transparent;border-radius:4px;cursor:pointer;padding:0;
        background:transparent;color:var(--c3-fg3);overflow:hidden;
        font-family:inherit;font-size:9px;font-weight:800;
        transition:background .14s ease,color .14s ease}
      .c3-cb:hover{background:var(--c3-acc);color:#fff}
      .c3-cb.mid{background:var(--c3-sel);color:var(--c3-acc2)}
      .c3-row2{position:absolute;inset-block-start:78px;inset-inline-end:7px;display:flex;gap:1px;
        padding:2px;border-radius:8px;background:color-mix(in srgb,#0d1117 62%,transparent);
        border:1px solid var(--c3-line);backdrop-filter:blur(4px)}
      .c3-row2 .c3-cb{width:34px;height:18px}

      .c3-stat{position:absolute;inset-block-end:7px;inset-inline-start:7px;display:flex;gap:7px;
        align-items:center;padding:3px 8px;border-radius:7px;font-size:10.5px;font-weight:600;
        background:color-mix(in srgb,#0d1117 78%,transparent);color:var(--c3-fg3);
        border:1px solid var(--c3-line);backdrop-filter:blur(4px)}
      .c3-stat b{color:var(--c3-acc2);font-weight:800}
      .c3-stat i{font-style:normal;opacity:.4}
      .c3-hint{position:absolute;inset-block-end:7px;inset-inline-end:7px;padding:3px 8px;
        border-radius:7px;font-size:10px;background:color-mix(in srgb,#0d1117 78%,transparent);
        color:var(--c3-fg3);border:1px solid var(--c3-line);max-width:50%;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;backdrop-filter:blur(4px)}
      /* مؤشّر انشغال — العمليات الثقيلة كانت تُجمّد اللوحة بلا أي علامة حياة */
      .c3-busy{position:absolute;inset-block-start:50%;inset-inline-start:50%;
        transform:translate(-50%,-50%);display:none;align-items:center;gap:8px;padding:9px 15px;
        border-radius:10px;font-size:12px;font-weight:700;color:var(--c3-fg);
        background:color-mix(in srgb,#0d1117 90%,transparent);border:1px solid var(--c3-acc);
        box-shadow:0 14px 40px rgba(0,0,0,.6)}
      .c3-busy.on{display:flex}
      .c3-busy::before{content:'';width:13px;height:13px;border-radius:50%;
        border:2px solid var(--c3-line);border-top-color:var(--c3-acc);animation:c3spin .7s linear infinite}
      @keyframes c3spin{to{transform:rotate(360deg)}}

      /* ── لوحة الشجرة ── */
      .c3-side{flex:0 0 192px;display:flex;flex-direction:column;min-height:0;
        background:var(--c3-panel);border-inline-start:1px solid var(--c3-line)}
      .c3-h{flex:0 0 auto;display:flex;align-items:center;gap:5px;padding:5px 8px;font-size:10px;
        font-weight:800;letter-spacing:.3px;color:var(--c3-fg3);
        border-bottom:1px solid var(--c3-line)}
      .c3-h .cnt{margin-inline-start:auto;padding:0 5px;border-radius:9px;font-size:9.5px;
        background:var(--c3-bar);border:1px solid var(--c3-line)}
      .c3-tree{flex:1 1 auto;overflow-y:auto;padding:3px}
      .c3-row{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:5px;
        cursor:pointer;font-size:11.5px;color:var(--c3-fg2);
        transition:background .1s ease,color .1s ease}
      .c3-row:hover{background:var(--c3-hi)}
      .c3-row.on{background:var(--c3-sel);color:var(--c3-acc2)}
      .c3-row.bad{color:#f85149}
      .c3-row.off{opacity:.42}
      .c3-row.drag{opacity:.4}
      .c3-row.over{box-shadow:inset 0 2px 0 var(--c3-acc)}
      .c3-row .n{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .c3-row .n input{width:100%;padding:0 2px;border:1px solid var(--c3-acc);border-radius:3px;
        background:var(--c3-bar);color:var(--c3-fg);font:inherit}
      /* أزرار الصفّ صامتة حتى المرور — الشجرة تبقى قابلة للمسح بلمحة */
      .c3-row .a{flex:0 0 auto;width:15px;height:15px;display:flex;align-items:center;
        justify-content:center;opacity:0;transition:opacity .1s ease}
      .c3-row .a svg{width:11px;height:11px}
      .c3-row:hover .a,.c3-row.on .a{opacity:.6}
      .c3-row .a:hover{opacity:1}
      .c3-row.off .a[data-a="eye"]{opacity:.75}
      .c3-row > svg{width:12px;height:12px;flex:0 0 auto;opacity:.75}
      .c3-info{flex:0 0 auto;padding:6px 8px;font-size:10.5px;line-height:1.7;
        color:var(--c3-fg3);border-top:1px solid var(--c3-line)}
      .c3-info b{color:var(--c3-fg2);font-weight:600}
      .c3-empty{padding:12px 9px;font-size:11px;color:var(--c3-fg3);line-height:1.75}
      /* الطيّ يُقاس على عرض اللوحة نفسها لا على النافذة — استعلام الوسائط
         يقيس النافذة فلا يُجدي داخل عمودٍ ضيّق في شاشةٍ عريضة. */
      .c3-side.hid{display:none}

      /* وصولية: حلقة تركيز ظاهرة للوحة المفاتيح، واحترام تقليل الحركة */
      #pane-cad :focus-visible,.c3-fly :focus-visible{outline:2px solid var(--c3-acc);
        outline-offset:1px}
      @media (prefers-reduced-motion:reduce){
        #pane-cad *,.c3-fly *,.c3-tip{transition:none!important;animation:none!important}
      }
    `;
    document.head.appendChild(s);
  }

  const ico = n => { try { return window.DQIcon ? window.DQIcon(n) : ''; } catch (_) { return ''; } };

  /* تلميح عائم واحد يخدم كل الأزرار — أرخص من عنوان لكل زرّ */
  let tipEl = null;
  /** النصّ يُقرأ من dataset عند كل مرور لا يُلتقط عند التسجيل — فأزرار الحالة
      تُحدِّث تسميتها بتغيير data-tip وحده، بلا حاجة إلى span داخل الزرّ. */
  function tipFor(el, text) {
    if (text != null) el.dataset.tip = text;
    el.addEventListener('mouseenter', () => {
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'c3-tip'; document.body.appendChild(tipEl); }
      tipEl.textContent = el.dataset.tip || '';
      const r = el.getBoundingClientRect();
      tipEl.style.insetInlineStart = 'auto';
      tipEl.classList.add('on');
      const tw = tipEl.offsetWidth;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(6, Math.min(window.innerWidth - tw - 6, left));
      tipEl.style.left = left + 'px';
      tipEl.style.top = (r.bottom + 6) + 'px';
    });
    const off = () => tipEl && tipEl.classList.remove('on');
    el.addEventListener('mouseleave', off);
    el.addEventListener('click', off);
  }

  /* ══════════════ سجلّ الأوامر — وحدات أخرى تضيف إليه ══════════════ */
  const RAIL = [];        // [{icon, name, items:[{t, icon, fn, key}]}]
  const TOP = [];         // [{icon|lbl, name, fn, id, sep}]

  function railGroup(def) { RAIL.push(def); return def; }
  function topItem(def) { TOP.push(def); return def; }

  function buildUI(pane) {
    injectCSS();
    pane.innerHTML = '';

    /* الشريط العلويّ — كتلٌ مقسَّمة: كل فاصل يغلق كتلةً ويفتح التالية */
    const top = document.createElement('div');
    top.className = 'c3-top';
    let grp = null;
    const newGrp = () => { grp = document.createElement('div'); grp.className = 'c3-grp'; top.appendChild(grp); };
    for (const it of TOP) {
      if (it.sep) { grp = null; continue; }
      if (it.grow) {
        grp = null;
        const s = document.createElement('span'); s.className = 'c3-grow'; top.appendChild(s);
        continue;
      }
      if (!grp) newGrp();
      const b = document.createElement('button');
      b.className = 'c3-ic'; b.type = 'button';
      b.innerHTML = (it.icon ? ico(it.icon) : '') +
                    (it.lbl ? `<span class="lbl">${it.lbl}</span>` : '');
      b.setAttribute('aria-label', it.name);
      if (it.id) b.id = it.id;
      tipFor(b, it.name);
      b.addEventListener('click', () => it.fn(b));
      grp.appendChild(b);
    }
    // أوّل كتلة (تراجع/إعادة) وما بعد الفاصل المطّاط (التصدير) تبقى دائماً
    const groups = [...top.querySelectorAll('.c3-grp')];
    if (groups[0]) groups[0].dataset.keep = '1';
    let past = false;
    [...top.children].forEach(el => {
      if (el.classList.contains('c3-grow')) past = true;
      else if (past && el.classList.contains('c3-grp')) el.dataset.keep = '1';
    });

    /* كتلة «المزيد» — تستقبل ما لا يتّسع بدل أن يلتفّ الشريط على أربعة صفوف
       فيبتلع نصف الكانفس */
    moreGrp = document.createElement('div');
    moreGrp.className = 'c3-grp'; moreGrp.dataset.keep = '1';
    moreGrp.style.display = 'none';
    moreBtn = document.createElement('button');
    moreBtn.className = 'c3-ic'; moreBtn.type = 'button'; moreBtn.id = 'c3-more';
    moreBtn.innerHTML = ico('more-h') + '<span class="lbl">المزيد</span>';
    moreBtn.setAttribute('aria-label', 'أدوات إضافية');
    tipFor(moreBtn, 'أدوات إضافية لم تتّسع في الشريط');
    moreFly = document.createElement('div');
    moreFly.className = 'c3-fly';
    moreFly.setAttribute('role', 'menu');
    moreFly.innerHTML = `<div class="c3-fh">${ico('more-h')}<span>أدوات إضافية</span></div>`;
    moreFly.addEventListener('click', () => setTimeout(closeFlyouts, 0));
    moreGrp.append(moreBtn, moreFly);
    const growEl = top.querySelector('.c3-grow');
    top.insertBefore(moreGrp, growEl || null);
    moreBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = moreFly.classList.contains('open');
      closeFlyouts();
      if (open) return;
      moreFly.classList.add('open');
      placeFly(moreBtn, moreFly);
      armFly(moreFly, moreBtn);
    });
    topEl = top;

    /* الريل الجانبيّ */
    const main = document.createElement('div'); main.className = 'c3-main';
    const rail = document.createElement('div'); rail.className = 'c3-rail';
    RAIL.forEach(g => {
      const slot = document.createElement('div'); slot.className = 'c3-slot';
      const b = document.createElement('button');
      b.className = 'c3-t'; b.type = 'button';
      b.innerHTML = ico(g.icon);
      b.setAttribute('aria-label', g.name);
      b.setAttribute('aria-haspopup', g.items.length > 1 ? 'menu' : 'false');
      const nItems = g.items.filter(x => !x.sep).length;
      tipFor(b, g.name + (nItems > 1 ? ` (${nItems})` : ''));
      slot.appendChild(b);
      if (g.items.length > 1) {
        const arw = document.createElement('span'); arw.className = 'c3-arw';
        slot.appendChild(arw);
        const fly = buildFly(g);
        slot.appendChild(fly);
        b.addEventListener('click', e => {
          e.stopPropagation();
          const was = slot.classList.contains('open');
          closeFlyouts();
          if (was) return;
          slot.classList.add('open');
          b.setAttribute('aria-expanded', 'true');
          placeFly(b, fly);
          armFly(fly, b);
        });
      } else {
        b.addEventListener('click', () => g.items[0].fn());
      }
      rail.appendChild(slot);
    });
    document.addEventListener('click', closeFlyouts);

    /* الكانفس + الـHUD */
    const view = document.createElement('div'); view.className = 'c3-view'; view.id = 'c3-view';
    const hud = document.createElement('div'); hud.className = 'c3-hud';

    const cube = document.createElement('div'); cube.className = 'c3-cube';
    const CUBE = [
      ['', 'أعلى', ''], ['يسار', 'مجسّم', 'يمين'], ['', 'أسفل', ''],
    ];
    const VMAP = { 'أعلى': 'top', 'أسفل': 'bottom', 'يمين': 'right', 'يسار': 'left', 'مجسّم': 'iso' };
    CUBE.flat().forEach(t => {
      const b = document.createElement('button');
      b.className = 'c3-cb' + (t === 'مجسّم' ? ' mid' : '');
      b.type = 'button';
      b.textContent = t;
      if (!t) { b.style.visibility = 'hidden'; b.disabled = true; }
      else { b.setAttribute('aria-label', 'مسقط ' + t); b.addEventListener('click', () => V().setView(VMAP[t])); }
      cube.appendChild(b);
    });
    const row2 = document.createElement('div');
    row2.className = 'c3-row2';
    [['أمام', 'front'], ['خلف', 'back'], ['ملاءمة', 'fit']].forEach(([t, v]) => {
      const b = document.createElement('button');
      b.className = 'c3-cb'; b.type = 'button'; b.textContent = t;
      b.addEventListener('click', () => (v === 'fit' ? V().fit() : V().setView(v)));
      row2.appendChild(b);
    });

    statEl = document.createElement('div'); statEl.className = 'c3-stat';
    hintEl = document.createElement('div'); hintEl.className = 'c3-hint';
    hintEl.textContent = 'سحب: تدوير · Shift/يمين: تحريك · عجلة: تكبير · ١-٧ مساقط · F ملاءمة';
    busyEl = document.createElement('div'); busyEl.className = 'c3-busy';
    hud.append(cube, row2, statEl, hintEl, busyEl);
    view.appendChild(hud);

    /* قائمة سياق على العرض — الزرّ الأيمن يفتح أوامر التحديد مباشرةً */
    view.addEventListener('contextmenu', e => { e.preventDefault(); openContext(e.clientX, e.clientY); });

    /* لوحة الشجرة */
    const side = document.createElement('div'); side.className = 'c3-side';
    const h = document.createElement('div'); h.className = 'c3-h';
    h.innerHTML = '<span>شجرة الميزات</span><span class="cnt" id="c3-cnt">0</span>';
    treeEl = document.createElement('div'); treeEl.className = 'c3-tree';
    infoEl = document.createElement('div'); infoEl.className = 'c3-info';
    side.append(h, treeEl, infoEl);

    main.append(rail, view, side);
    pane.append(top, main);
    host = view;
    sideEl = side;

    /* الشجرة تنطوي تلقائياً حين يضيق العمود، وتعود حين يتّسع — ما لم يفرض
       المستخدم حالةً بنفسه من زرّ الشريط. */
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (!sidePinned) {
          const w = pane.clientWidth;
          side.classList.toggle('hid', w < 520);
          syncSideBtn();
        }
        layoutTopSoon();
      });
      ro.observe(pane);
    }
    layoutTopSoon();
  }

  let topEl = null, moreGrp = null, moreFly = null, moreBtn = null;

  /**
   * يوزّع كتل الشريط بين الشريط نفسه وقائمة «المزيد» حتى لا يتجاوز صفّين.
   * الشريط الملتفّ على أربعة صفوف كان يقتطع ١٣٧px من ارتفاع العرض في عمودٍ
   * ضيّق — وهذا ثمنٌ لا تدفعه برامج الكاد. تُنقل الكتل نفسها بأزرارها
   * ومعرّفاتها، فتبقى أزرار الحالة تعمل وتُضيء داخل القائمة كما في الشريط.
   */
  let layoutT = 0;
  /** إعادة توزيعٍ متأخّرة: اللوحة تتحرّك بانتقال CSS، والمراقب يقيس أثناءه فيقرّر
      على عرضٍ لحظيّ ثم لا يعود. تشغيلةٌ ثانية بعد استقرار الانتقال تصحّح القرار. */
  function layoutTopSoon() {
    layoutTop();
    clearTimeout(layoutT);
    layoutT = setTimeout(layoutTop, 300);
  }

  function layoutTop() {
    if (!topEl || !moreFly || !moreGrp) return;
    // لا تُعِد الترتيب والقائمة مفتوحة — الأزرار ستُنتزع من تحت المؤشّر
    if (moreFly.classList.contains('open')) return;
    // أعِد كل شيء إلى الشريط ثم اقتطع من جديد — القياس على وضعٍ نظيف
    [...moreFly.querySelectorAll('.c3-grp')].forEach(g => topEl.insertBefore(g, moreGrp));
    moreGrp.style.display = 'none';

    const rowsOf = () => new Set([...topEl.querySelectorAll(':scope > .c3-grp')]
      .filter(g => g.offsetParent).map(g => Math.round(g.getBoundingClientRect().top))).size;
    const movable = () => [...topEl.querySelectorAll(':scope > .c3-grp')].filter(g => !g.dataset.keep);

    let guard = 0;
    while (rowsOf() > 2 && movable().length && guard++ < 20) {
      moreGrp.style.display = '';
      const list = movable();
      moreFly.appendChild(list[list.length - 1]);
    }
    if (!moreFly.querySelector('.c3-grp')) moreGrp.style.display = 'none';
  }

  let sideEl = null, sidePinned = false, hintEl = null, busyEl = null;

  /** مؤشّر انشغال: العمليات الثقيلة (التخشين، الغلاف، التنعيم) تحجب الخيط
      الرئيسيّ لثوانٍ — بلا هذا تبدو اللوحة معطّلة. */
  function busy(text) {
    if (!busyEl) return Promise.resolve();
    busyEl.textContent = text || 'جارٍ الحساب…';
    busyEl.classList.add('on');
    // إطارٌ كامل قبل بدء الحساب، وإلّا رُسم المؤشّر بعد انتهاء العملية
    return new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));
  }
  const unbusy = () => busyEl && busyEl.classList.remove('on');

  /** يبني انبثاق مجموعةٍ من الريل: عنوان القسم ثم بنوده */
  function buildFly(g) {
    const fly = document.createElement('div');
    fly.className = 'c3-fly';
    fly.setAttribute('role', 'menu');
    const head = document.createElement('div');
    head.className = 'c3-fh';
    head.innerHTML = ico(g.icon) + `<span>${g.name}</span>`;
    fly.appendChild(head);
    g.items.forEach(it => {
      if (it.sep) { const d = document.createElement('div'); d.className = 'c3-fs'; fly.appendChild(d); return; }
      const fi = document.createElement('button');
      fi.className = 'c3-fi'; fi.type = 'button'; fi.setAttribute('role', 'menuitem');
      fi.innerHTML = (it.icon ? ico(it.icon) : ico(g.icon)) +
        `<span>${it.t}</span>` + (it.key ? `<span class="k">${it.key}</span>` : '');
      fi.addEventListener('click', () => { closeFlyouts(); it.fn(); });
      fly.appendChild(fi);
    });
    return fly;
  }

  /**
   * إبحار بلوحة المفاتيح داخل انبثاقٍ مفتوح: ↑↓ Home End للتنقّل، Enter للتنفيذ،
   * Esc للإغلاق مع إعادة التركيز إلى الزرّ. قائمةٌ لا تُفتح إلا بالفأرة ليست
   * قائمةً احترافية.
   */
  function armFly(fly, btn) {
    // قائمة «المزيد» تحوي أزرار الشريط نفسها (.c3-ic) لا بنود انبثاق
    const items = () => [...fly.querySelectorAll('.c3-fi,.c3-ic')];
    let i = -1;
    const mark = () => items().forEach((el, k) => el.classList.toggle('cur', k === i));
    const step = d => {
      const L = items(); if (!L.length) return;
      i = (i + d + L.length + (i < 0 ? (d > 0 ? 0 : 1) : 0)) % L.length;
      mark(); L[i].scrollIntoView({ block: 'nearest' });
    };
    const onKey = e => {
      const k = e.key;
      if (k === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (k === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (k === 'Home') { e.preventDefault(); i = -1; step(1); }
      else if (k === 'End') { e.preventDefault(); i = items().length; step(-1); }
      else if (k === 'Enter' || k === ' ') { const L = items(); if (L[i]) { e.preventDefault(); L[i].click(); } }
      else if (k === 'Escape') { e.preventDefault(); closeFlyouts(); btn && btn.focus(); }
    };
    // التموضع يتبع الزرّ: تمريرُ الريل أو تغييرُ حجم النافذة كان يترك القائمة
    // معلّقةً في مكانها القديم لأنّها fixed
    const follow = () => {
      if (!btn) return;                       // قائمة السياق حرّة الموضع، لا زرّ تتبعه
      if (fly.closest('.c3-slot.open') || fly.classList.contains('open')) placeFly(btn, fly);
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    flyTeardown = () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
      flyTeardown = null;
    };
  }
  let flyTeardown = null;

  function toggleSide() {
    if (!sideEl) return;
    sidePinned = true;
    sideEl.classList.toggle('hid');
    syncSideBtn();
    setTimeout(() => { V().resize(); V().render(); }, 60);
  }
  function syncSideBtn() {
    const b = document.getElementById('c3-side');
    if (b && sideEl) b.classList.toggle('on', sideEl.classList.contains('hid'));
  }

  /** يضع الانبثاق بجانب الزرّ ويبقيه كاملاً داخل النافذة */
  function placeFly(btn, fly) {
    const r = btn.getBoundingClientRect();
    fly.style.top = '0px'; fly.style.left = '0px';   // قياس قبل التموضع
    const w = fly.offsetWidth, h = fly.offsetHeight;
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    let left = rtl ? r.left - w - 6 : r.right + 6;
    if (left < 4 || left + w > window.innerWidth - 4) left = rtl ? r.right + 6 : r.left - w - 6;
    left = Math.max(4, Math.min(window.innerWidth - w - 4, left));
    const top = Math.max(4, Math.min(window.innerHeight - h - 4, r.top));
    fly.style.left = left + 'px';
    fly.style.top = top + 'px';
  }

  function closeFlyouts() {
    document.querySelectorAll('#pane-cad .c3-slot.open').forEach(s => {
      s.classList.remove('open');
      s.querySelector('.c3-t')?.setAttribute('aria-expanded', 'false');
    });
    if (moreFly) {
      moreFly.classList.remove('open');
      moreBtn?.setAttribute('aria-expanded', 'false');
    }
    if (flyTeardown) flyTeardown();
    if (ctxEl) { ctxEl.remove(); ctxEl = null; }
  }

  /* ══════════════ قائمة السياق (الزرّ الأيمن) ══════════════ */

  let ctxEl = null;
  /** بنود القائمة تُبنى لحظةَ الفتح لتعكس التحديد الفعليّ */
  function contextItems() {
    const n = V().getSelection().length;
    const L = [];
    if (n) {
      L.push({ t: 'تحرير المعاملات…', icon: 'pencil', fn: () => opEdit(V().getSelection()[0]) });
      L.push({ t: 'إعادة تسمية', icon: 'text-vertical', fn: () => beginRename(V().getSelection()[0]) });
      L.push({ sep: true });
      L.push({ t: 'نسخة', icon: 'duplicate', fn: OPS.duplicate });
      L.push({ t: 'قيم تحويل دقيقة…', icon: 'move', fn: opTransform });
      L.push({ t: 'الخامة…', icon: 'wood', fn: opMaterial });
      L.push({ sep: true });
      if (n === 2) {
        L.push({ t: 'اتحاد', icon: 'blend', key: 'U', fn: () => opBoolean('uni') });
        L.push({ t: 'طرح', icon: 'blend', key: 'S', fn: () => opBoolean('sub') });
        L.push({ t: 'تقاطع', icon: 'blend', key: 'I', fn: () => opBoolean('int') });
        L.push({ sep: true });
      }
      L.push({ t: 'تكبير على التحديد', icon: 'zoom-in', fn: opZoomSel });
      L.push({ t: 'عزل التحديد', icon: 'isolate', fn: opIsolate });
      L.push({ t: 'إخفاء / إظهار', icon: 'eye', key: 'H', fn: opToggleHide });
      L.push({ t: 'إنزال إلى الأرضية', icon: 'floor', fn: opDropFloor });
      L.push({ sep: true });
      L.push({ t: 'حذف', icon: 'trash', key: 'Del', fn: opDelete });
    } else {
      L.push({ t: 'صندوق جديد', icon: 'cube', fn: () => opPrimitive('box') });
      L.push({ t: 'أسطوانة جديدة', icon: 'circle', fn: () => opPrimitive('cylinder') });
      L.push({ sep: true });
      L.push({ t: 'ملاءمة العرض', icon: 'fit-view', key: 'F', fn: () => V().fit() });
      L.push({ t: 'تحديد الكلّ', icon: 'bbox', key: 'Ctrl+A', fn: selectAll });
      L.push({ t: 'المظروف والحجم', icon: 'gauge', fn: opBBox });
    }
    return L;
  }

  function openContext(x, y) {
    closeFlyouts();
    const fly = buildFly({ icon: 'more-h', name: 'أوامر سريعة', items: contextItems() });
    fly.classList.add('open');
    document.body.appendChild(fly);
    ctxEl = fly;
    const w = fly.offsetWidth, h = fly.offsetHeight;
    fly.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, x)) + 'px';
    fly.style.top = Math.max(4, Math.min(window.innerHeight - h - 4, y)) + 'px';
    armFly(fly, null);
  }

  let lastRow = null;                 // مرساة Shift للتحديد المدى

  function renderTree() {
    if (!treeEl) return;
    const v = V();
    const sel = new Set(v.getSelection());
    const consumed = new Set();
    for (const f of feats) if (f.kind === 'boolean') f.src.forEach(id => consumed.add(id));
    const cnt = document.getElementById('c3-cnt');
    if (cnt) cnt.textContent = String(feats.length);

    if (!feats.length) {
      treeEl.innerHTML = `<div class="c3-empty">لا ميزات بعد.<br>ابدأ بمجسّم أوّليّ، أو حدّد شكلاً في
        لوحة الرسم ثم اضغط «بثق».</div>`;
      return;
    }
    treeEl.innerHTML = '';
    feats.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'c3-row' + (sel.has(f.id) ? ' on' : '') + (f.error ? ' bad' : '') +
                      (f.off ? ' off' : '');
      row.dataset.id = f.id;
      row.dataset.i = String(i);
      row.draggable = true;
      if (consumed.has(f.id)) row.style.opacity = '.45';
      const kind = KINDS[f.kind] || {};
      row.innerHTML = ico(kind.icon || 'cube') +
        `<span class="n" title="${f.error || f.name}">${f.name}</span>` +
        `<span class="a" data-a="eye" title="إخفاء / إظهار">${ico(f.off ? 'dot-off' : 'dot-on')}</span>` +
        `<span class="a" data-a="edit" title="تحرير المعاملات">${ico('pencil')}</span>`;

      row.addEventListener('click', e => {
        // closest لا dataset المباشر: الأزرار صارت أيقونات SVG، فهدف النقر هو
        // <svg> أو <path> بداخلها لا الـspan الحامل للسمة
        const hit = e.target.closest && e.target.closest('[data-a]');
        const a = hit && hit.dataset.a;
        if (a === 'edit') { opEdit(f.id); return; }
        if (a === 'eye') { v.setSelection([f.id]); opToggleHide(); return; }
        // Ctrl يضيف/يزيل، Shift يمدّ من آخر صفّ — كسلوك الطبقات المعتاد
        if (e.ctrlKey || e.metaKey) {
          const cur = new Set(v.getSelection());
          cur.has(f.id) ? cur.delete(f.id) : cur.add(f.id);
          v.setSelection([...cur]);
        } else if (e.shiftKey && lastRow != null) {
          const a0 = Math.min(lastRow, i), b0 = Math.max(lastRow, i);
          v.setSelection(feats.slice(a0, b0 + 1).map(x => x.id));
        } else {
          v.setSelection([f.id]);
          lastRow = i;
        }
        renderTree(); updateInfo();
      });
      row.addEventListener('dblclick', e => {
        if (e.target.closest('.n')) beginRename(f.id);
        else opEdit(f.id);
      });
      row.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        if (!sel.has(f.id)) { v.setSelection([f.id]); renderTree(); updateInfo(); }
        openContext(e.clientX, e.clientY);
      });

      /* سحبٌ لإعادة الترتيب */
      row.addEventListener('dragstart', e => {
        dragId = f.id; row.classList.add('drag');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', f.id); } catch (_) {}
      });
      row.addEventListener('dragend', () => { dragId = null; renderTree(); });
      row.addEventListener('dragover', e => {
        if (!dragId || dragId === f.id) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        treeEl.querySelectorAll('.c3-row.over').forEach(r => r.classList.remove('over'));
        row.classList.add('over');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('over');
        if (dragId && dragId !== f.id) moveFeature(dragId, i);
        dragId = null;
      });

      treeEl.appendChild(row);
    });
  }

  let dragId = null;

  /**
   * ينقل ميزةً إلى موضعٍ جديد في الشجرة. الترتيب ليس تجميلياً: البناء تسلسليّ،
   * فالميزة يجب أن تبقى بعد كل مصادرها وقبل كل مستهلكيها — وإلّا بُنيت على
   * هندسةٍ لم تُحسب بعد. النقل المخالف يُرفض بدل أن يكسر المستند صامتاً.
   */
  function moveFeature(id, to) {
    const from = feats.findIndex(f => f.id === id);
    if (from < 0 || from === to) return;
    const next = feats.slice();
    const [f] = next.splice(from, 1);
    next.splice(to, 0, f);
    const pos = new Map(next.map((x, i) => [x.id, i]));
    for (const x of next) {
      if (x.src.some(s => pos.has(s) && pos.get(s) > pos.get(x.id))) {
        toast('لا يمكن نقل الميزة قبل مصدرها', 'warn');
        return;
      }
    }
    snapshot();
    feats = next;
    rebuild();
  }

  /** إعادة تسمية مباشرة داخل الصفّ (F2 أو نقر مزدوج على الاسم) */
  function beginRename(id) {
    const f = featById(id);
    const row = treeEl && treeEl.querySelector(`.c3-row[data-id="${id}"]`);
    if (!f || !row) return;
    const holder = row.querySelector('.n');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = f.name;
    holder.textContent = ''; holder.appendChild(inp);
    inp.focus(); inp.select();
    let done = false;
    const commit = ok => {
      if (done) return;
      done = true;
      if (ok && inp.value.trim()) { f.name = inp.value.trim(); saveSession(); }
      renderTree();
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
    });
    inp.addEventListener('blur', () => commit(true));
  }

  function selectAll() {
    const ids = V().all().map(m => m.userData.id);
    V().setSelection(ids);
    renderTree(); updateInfo();
  }

  function updateInfo() {
    const v = V(), k = K();
    const sel = v.getSelection();
    if (statEl) {
      const vis = v.all().filter(m => m.visible);
      let tri = 0;
      vis.forEach(m => {
        const p = m.geometry.attributes && m.geometry.attributes.position;
        tri += p ? (m.geometry.index ? m.geometry.index.count : p.count) / 3 : 0;
      });
      const G = { move: 'نقل', rotate: 'تدوير', scale: 'تحجيم' }[v.gizmoMode()] || '—';
      statEl.innerHTML =
        `<span><b>${feats.length}</b> ميزة</span><i>·</i>` +
        `<span><b>${vis.length}</b> ظاهر</span><i>·</i>` +
        `<span><b>${Math.round(tri).toLocaleString('en')}</b> مثلّث</span><i>·</i>` +
        `<span>${G}</span>` +
        (sel.length ? `<i>·</i><span><b>${sel.length}</b> محدَّد</span>` : '') +
        '<i>·</i><span>mm</span>';
    }
    if (!infoEl) return;
    if (sel.length !== 1) {
      infoEl.innerHTML = `<b>${feats.length}</b> ميزة · <b>${v.all().length}</b> مجسّم ظاهر`;
      return;
    }
    const m = v.get(sel[0]);
    if (!m) { infoEl.textContent = ''; return; }
    const polys = k.fromGeometry(m.geometry, m.matrixWorld);
    const b = k.bounds(polys);
    const vol = k.volume(polys), area = k.surfaceArea(polys);
    const d = b ? `${(b.maxX - b.minX).toFixed(1)} × ${(b.maxY - b.minY).toFixed(1)} × ${(b.maxZ - b.minZ).toFixed(1)}` : '—';
    infoEl.innerHTML =
      `<b>الأبعاد:</b> ${d} mm<br>` +
      `<b>الحجم:</b> ${(vol / 1000).toFixed(2)} cm³<br>` +
      `<b>السطح:</b> ${(area / 100).toFixed(2)} cm²<br>` +
      `<b>الأوجه:</b> ${k.triCount(polys).toLocaleString('en')}`;
  }

  /* أزرار الحالة */
  function setGizmo(m) {
    V().setGizmoMode(m);
    ['move', 'rotate', 'scale'].forEach(k =>
      document.getElementById('c3-gz-' + k)?.classList.toggle('on', k === m));
  }
  function toggleOrtho() {
    const v = V(), n = !v.isOrtho();
    v.setOrtho(n);
    setLabel('c3-ortho', n ? 'إسقاط متعامد (فعّال)' : 'إسقاط منظوريّ', n);
  }

  /** يحدّث تسمية زرّ حالة: التلميح وaria معاً، بلا افتراض وجود span بداخله */
  function setLabel(id, text, on) {
    const b = document.getElementById(id);
    if (!b) return;
    b.dataset.tip = text;
    b.setAttribute('aria-label', text);
    if (on != null) b.classList.toggle('on', !!on);
  }
  const MODES = [['shaded', 'مظلّل'], ['shaded-edges', 'بحوافّ'], ['wire', 'هيكليّ'], ['xray', 'شفّاف']];
  function cycleMode() {
    const v = V();
    const i = MODES.findIndex(m => m[0] === v.mode());
    const nx = MODES[(i + 1) % MODES.length];
    v.setMode(nx[0]);
    setLabel('c3-mode', 'وضع الإظهار: ' + nx[1], nx[0] !== 'shaded');
  }
  let secOn = false, secOff = 0;
  async function toggleSection() {
    const v = V();
    secOn = !secOn;
    document.getElementById('c3-sec')?.classList.toggle('on', secOn);
    if (!secOn) { v.setSection({ on: false }); return; }
    let axis = 'z', flip = false;
    if (window.DQPrompt) {
      const r = await window.DQPrompt('مستوى المقطع', [
        { key: 'axis', label: 'المحور', type: 'select', def: 'z',
          options: [{ v: 'x', t: 'X' }, { v: 'y', t: 'Y' }, { v: 'z', t: 'Z' }] },
        { key: 'offset', label: 'الإزاحة (mm)', def: 0 },
        { key: 'flip', label: 'اعكس الجهة', type: 'check', def: false },
      ]);
      if (!r) { secOn = false; document.getElementById('c3-sec')?.classList.remove('on'); return; }
      axis = r.axis; secOff = r.offset; flip = r.flip;
    }
    v.setSection({ on: true, axis, offset: secOff, flip });
  }
  let measOn = false;
  function toggleMeasure() {
    measOn = !measOn;
    V().setMeasure(measOn);
    document.getElementById('c3-meas')?.classList.toggle('on', measOn);
    if (measOn) toast('انقر نقطتين على سطح المجسّم لقياس المسافة', 'info');
  }

  /* ══════════════ الثلاثون: عمليات على مجسّم قائم ══════════════ */

  const one = () => {
    const s = V().getSelection();
    if (s.length !== 1) { toast('حدّد مجسّماً واحداً في العرض ثلاثيّ الأبعاد', 'warn'); return null; }
    return s[0];
  };

  function pushOp(srcId, params, name) {
    snapshot();
    const f = addFeature('op', params, [srcId]);
    f.name = name;
    rebuild();
    if (f.error) { feats = feats.filter(x => x !== f); rebuild(); return false; }
    V().setSelection([f.id]);
    toast(name + ' ✓', 'success');
    return true;
  }

  async function ask(title, fields) {
    if (!window.DQPrompt) return {};
    return window.DQPrompt(title, fields);
  }

  const OPS = {
    async shell() {
      const id = one(); if (!id) return;
      const r = await ask('تفريغ (قشرة)', [{ key: 't', label: 'سماكة الجدار (mm)', def: 2, min: 0.1 }]);
      if (r) pushOp(id, { op: 'shell', t: r.t }, `تفريغ ${r.t}mm`);
    },
    async offset() {
      const id = one(); if (!id) return;
      const r = await ask('تسميك السطح', [{ key: 'd', label: 'المقدار (mm، سالب = للداخل)', def: 1 }]);
      if (r) pushOp(id, { op: 'offset', d: r.d }, `تسميك ${r.d}mm`);
    },
    async mirror() {
      const id = one(); if (!id) return;
      const r = await ask('مرآة', [{ key: 'axis', label: 'المحور', type: 'select', def: 'x',
        options: [{ v: 'x', t: 'X' }, { v: 'y', t: 'Y' }, { v: 'z', t: 'Z' }] }]);
      if (r) pushOp(id, { op: 'mirror', axis: r.axis }, 'مرآة ' + r.axis.toUpperCase());
    },
    async linear() {
      const id = one(); if (!id) return;
      const r = await ask('مصفوفة خطّية', [
        { key: 'count', label: 'العدد', def: 4, min: 1, max: 200 },
        { key: 'dx', label: 'تباعد X', def: 50 }, { key: 'dy', label: 'تباعد Y', def: 0 },
        { key: 'dz', label: 'تباعد Z', def: 0 }]);
      if (r) pushOp(id, { op: 'linear', ...r }, `مصفوفة خطّية ×${r.count}`);
    },
    async circular() {
      const id = one(); if (!id) return;
      const r = await ask('مصفوفة دائرية', [
        { key: 'count', label: 'العدد', def: 6, min: 1, max: 360 },
        { key: 'angle', label: 'الزاوية الكلّية (°)', def: 360, min: 1, max: 360 },
        { key: 'radius', label: 'نصف القطر', def: 0 },
        { key: 'axis', label: 'المحور', type: 'select', def: 'z',
          options: [{ v: 'z', t: 'Z' }, { v: 'x', t: 'X' }, { v: 'y', t: 'Y' }] }]);
      if (r) pushOp(id, { op: 'circular', ...r }, `مصفوفة دائرية ×${r.count}`);
    },
    async hull() { const id = one(); if (id) pushOp(id, { op: 'hull' }, 'غلاف محدّب'); },
    async decimate() {
      const id = one(); if (!id) return;
      const r = await ask('تبسيط الشبكة', [{ key: 'cell', label: 'حجم الخليّة (mm)', def: 1, min: 0.05 }]);
      if (r) pushOp(id, { op: 'decimate', cell: r.cell }, `تبسيط ${r.cell}mm`);
    },
    async center() {
      const id = one(); if (!id) return;
      const r = await ask('توسيط على الأصل', [{ key: 'mode', label: 'الوضع', type: 'select', def: 'base',
        options: [{ v: 'base', t: 'القاعدة على Z=0' }, { v: 'mid', t: 'المركز على الأصل' }] }]);
      if (r) pushOp(id, { op: 'center', mode: r.mode }, 'توسيط');
    },
    duplicate() { const id = one(); if (id) pushOp(id, { op: 'copy' }, 'نسخة'); },
    async split() {
      const id = one(); if (!id) return;
      const r = await ask('تقطيع بمستوٍ', [
        { key: 'axis', label: 'المحور', type: 'select', def: 'z',
          options: [{ v: 'z', t: 'Z' }, { v: 'x', t: 'X' }, { v: 'y', t: 'Y' }] },
        { key: 'offset', label: 'الإزاحة (mm)', def: 0 },
        { key: 'both', label: 'أبقِ الجزأين', type: 'check', def: true }]);
      if (!r) return;
      snapshot();
      const a = addFeature('op', { op: 'splitA', axis: r.axis, offset: r.offset, keepSrc: !!r.both }, [id]);
      a.name = 'قطعة سفلى';
      if (r.both) {
        const b = addFeature('op', { op: 'splitB', axis: r.axis, offset: r.offset, keepSrc: true }, [id]);
        b.name = 'قطعة عليا';
      }
      // المصدر يُستهلك في الحالتين
      const srcF = featById(id); if (srcF) srcF.hidden = true;
      rebuild();
      toast('قُطع المجسّم', 'success');
    },
    async helix() {
      const rings = selectedRings();
      if (!rings) { toast('حدّد مقطعاً في لوحة الرسم أوّلاً', 'warn'); return; }
      const r = await ask('لولب / زنبرك', [
        { key: 'radius', label: 'نصف القطر (mm)', def: 20 },
        { key: 'pitch', label: 'الخطوة لكل لفّة (mm)', def: 6 },
        { key: 'turns', label: 'عدد اللفّات', def: 4, min: 0.1 },
        { key: 'segments', label: 'تقسيم اللفّة', def: 48, min: 8 }]);
      if (!r) return;
      snapshot();
      const path = window.CAD3DOps.helixPath(r);
      const f = addFeature('sweep', { rings, path, caps: true });
      f.name = `لولب ${r.turns} لفّة`;
      rebuild(); V().fit();
      toast('تمّ اللولب', 'success');
    },
  };

  /* ══════════════ عشر أدوات إضافية ══════════════ */

  /** مظروف عالميّ لقائمة مجسّمات (أو للمحدَّد) */
  function bboxOf(ids) {
    const list = (ids && ids.length ? ids.map(id => V().get(id)) : V().all()).filter(Boolean);
    if (!list.length) return null;
    const b = new THREE.Box3();
    list.forEach(m => b.expandByObject(m));
    return b;
  }

  /** يضيف ميزةَ قاطعٍ ثم يطرحها من الهدف — أساس الثقب والجيب والنقش */
  function cutWith(targetId, cutter, name, op) {
    const b = addFeature('boolean', { op: op || 'sub' }, [targetId, cutter.id]);
    b.name = name;
    rebuild();
    if (b.error) {
      feats = feats.filter(x => x !== b && x !== cutter);
      rebuild();
      return false;
    }
    V().setSelection([b.id]);
    toast(name + ' ✓', 'success');
    return true;
  }

  /* ١ · ثقب */
  async function opDrill() {
    const id = one(); if (!id) return;
    const box = bboxOf([id]); if (!box) return;
    const r = await ask('ثقب', [
      { key: 'dia', label: 'القطر (mm)', def: 6, min: 0.1 },
      { key: 'x', label: 'الموضع X', def: +((box.min.x + box.max.x) / 2).toFixed(2) },
      { key: 'y', label: 'الموضع Y', def: +((box.min.y + box.max.y) / 2).toFixed(2) },
      { key: 'depth', label: 'العمق (mm — صفر = نافذ)', def: 0, min: 0 },
    ]);
    if (!r) return;
    snapshot();
    const through = !(r.depth > 0);
    const h = through ? (box.max.z - box.min.z) + 4 : r.depth + 1;
    const cyl = addFeature('cylinder', { r: Math.max(0.05, r.dia / 2), h });
    cyl.name = `مثقب ⌀${r.dia}`;
    cyl.tf.px = r.x; cyl.tf.py = r.y;
    // المولّد يبني الأسطوانة حول مركزها، فمنتصف الثقب لا قاعدته
    cyl.tf.pz = through ? (box.min.z + box.max.z) / 2 : box.max.z - r.depth / 2 + 0.5;
    cutWith(id, cyl, `ثقب ⌀${r.dia}${through ? ' نافذ' : ' ' + r.depth + 'mm'}`);
  }

  /* ٢ · جيب مستطيل */
  async function opPocket() {
    const id = one(); if (!id) return;
    const box = bboxOf([id]); if (!box) return;
    const r = await ask('جيب مستطيل', [
      { key: 'w', label: 'العرض (mm)', def: +Math.max(5, (box.max.x - box.min.x) * 0.5).toFixed(1), min: 0.1 },
      { key: 'd', label: 'العمق الأفقيّ (mm)', def: +Math.max(5, (box.max.y - box.min.y) * 0.5).toFixed(1), min: 0.1 },
      { key: 'depth', label: 'عمق الحفر (mm)', def: 5, min: 0.1 },
      { key: 'x', label: 'المركز X', def: +((box.min.x + box.max.x) / 2).toFixed(2) },
      { key: 'y', label: 'المركز Y', def: +((box.min.y + box.max.y) / 2).toFixed(2) },
    ]);
    if (!r) return;
    snapshot();
    const bx = addFeature('box', { w: r.w, d: r.d, h: r.depth + 1 });
    bx.name = 'قاطع جيب';
    bx.tf.px = r.x; bx.tf.py = r.y;
    bx.tf.pz = box.max.z - r.depth / 2 + 0.5;
    cutWith(id, bx, `جيب ${r.w}×${r.d}×${r.depth}`);
  }

  /* ٣ و٤ · نقش الرسم في المجسّم / إبرازه عليه */
  async function stampDrawing(mode) {
    const id = one(); if (!id) return;
    const rings = selectedRings();
    if (!rings) { toast('حدّد الرسم المطلوب في لوحة الرسم أوّلاً', 'warn'); return; }
    const box = bboxOf([id]); if (!box) return;
    const eng = mode === 'engrave';
    const r = await ask(eng ? 'نقش الرسم في المجسّم' : 'إبراز الرسم على المجسّم', [
      { key: 'depth', label: eng ? 'عمق النقش (mm)' : 'ارتفاع البروز (mm)', def: 1.5, min: 0.05 },
      { key: 'scale', label: 'تحجيم الرسم', def: 1, min: 0.01 },
    ]);
    if (!r) return;
    snapshot();
    // زيادة صغيرة تضمن اختراق السطح العلويّ: مستويان متلامسان تماماً ينتجان
    // أوجهاً متطابقة يعجز عنها أي CSG
    const over = 0.2;
    const p = { rings, height: r.depth + over, draft: 0, bevel: 0 };
    const f = addFeature('extrude', p);
    f.name = eng ? 'ختم نقش' : 'ختم بروز';
    if (r.scale !== 1) { f.tf.sx = f.tf.sy = r.scale; f.tf.sz = 1; }
    f.tf.pz = eng ? box.max.z - r.depth : box.max.z - over;
    cutWith(id, f, eng ? `نقش ${r.depth}mm` : `بروز ${r.depth}mm`, eng ? 'sub' : 'uni');
  }

  /* ٥ · محاذاة المجسّمات */
  async function opAlign() {
    const sel = V().getSelection();
    if (sel.length < 2) { toast('حدّد مجسّمين فأكثر للمحاذاة', 'warn'); return; }
    const r = await ask('محاذاة المحدَّد', [
      { key: 'axis', label: 'المحور', type: 'select', def: 'x',
        options: [{ v: 'x', t: 'X' }, { v: 'y', t: 'Y' }, { v: 'z', t: 'Z' }] },
      { key: 'mode', label: 'الطرف', type: 'select', def: 'mid',
        options: [{ v: 'min', t: 'الأدنى' }, { v: 'mid', t: 'المركز' }, { v: 'max', t: 'الأقصى' }] },
    ]);
    if (!r) return;
    const all = bboxOf(sel); if (!all) return;
    const key = { x: 'px', y: 'py', z: 'pz' }[r.axis];
    const target = r.mode === 'min' ? all.min[r.axis]
                 : r.mode === 'max' ? all.max[r.axis]
                 : (all.min[r.axis] + all.max[r.axis]) / 2;
    snapshot();
    sel.forEach(id => {
      const f = featById(id), b = bboxOf([id]);
      if (!f || !b) return;
      const cur = r.mode === 'min' ? b.min[r.axis] : r.mode === 'max' ? b.max[r.axis]
                : (b.min[r.axis] + b.max[r.axis]) / 2;
      f.tf[key] += target - cur;
    });
    rebuild();
    toast(`حوذيت ${sel.length} مجسّمات`, 'success');
  }

  /* ٦ · توزيع متساوٍ */
  async function opDistribute() {
    const sel = V().getSelection();
    if (sel.length < 3) { toast('التوزيع يحتاج ثلاثة مجسّمات فأكثر', 'warn'); return; }
    const r = await ask('توزيع متساوٍ', [
      { key: 'axis', label: 'المحور', type: 'select', def: 'x',
        options: [{ v: 'x', t: 'X' }, { v: 'y', t: 'Y' }, { v: 'z', t: 'Z' }] },
      { key: 'gap', label: 'فجوة ثابتة بدل توزيع المراكز (mm، صفر = تلقائيّ)', def: 0, min: 0 },
    ]);
    if (!r) return;
    const key = { x: 'px', y: 'py', z: 'pz' }[r.axis];
    const items = sel.map(id => ({ f: featById(id), b: bboxOf([id]) }))
      .filter(o => o.f && o.b)
      .map(o => Object.assign(o, {
        c: (o.b.min[r.axis] + o.b.max[r.axis]) / 2,
        len: o.b.max[r.axis] - o.b.min[r.axis],
      }))
      .sort((a, b) => a.c - b.c);
    if (items.length < 3) return;
    snapshot();
    if (r.gap > 0) {
      // فجوة ثابتة: نرصّ بدءاً من حافّة الأوّل
      let edge = items[0].b.max[r.axis];
      for (let i = 1; i < items.length; i++) {
        const o = items[i];
        const want = edge + r.gap + o.len / 2;
        o.f.tf[key] += want - o.c;
        edge = want + o.len / 2;
      }
    } else {
      const a = items[0].c, z = items[items.length - 1].c;
      const stp = (z - a) / (items.length - 1);
      items.forEach((o, i) => { if (i && i < items.length - 1) o.f.tf[key] += (a + stp * i) - o.c; });
    }
    rebuild();
    toast(`وُزِّعت ${items.length} مجسّمات على ${r.axis.toUpperCase()}`, 'success');
  }

  /* ٧ · إنزال إلى الأرضية */
  function opDropFloor() {
    const sel = V().getSelection();
    const ids = sel.length ? sel : V().all().map(m => m.userData.id);
    if (!ids.length) { toast('لا مجسّم', 'warn'); return; }
    snapshot();
    // معاً لا فرادى: مجموعةٌ تُنزَل ككتلة واحدة فتحفظ تراصفها
    const b = bboxOf(ids); if (!b) return;
    const dz = -b.min.z;
    ids.forEach(id => { const f = featById(id); if (f) f.tf.pz += dz; });
    rebuild();
    toast(`أُنزل إلى Z=0 (إزاحة ${dz.toFixed(2)}mm)`, 'success');
  }

  /* ٨ · تحجيم إلى مقاس */
  async function opScaleTo() {
    const id = one(); if (!id) return;
    const b = bboxOf([id]); if (!b) return;
    const s = b.getSize(new THREE.Vector3());
    const r = await ask('تحجيم إلى مقاس', [
      { key: 'axis', label: 'البُعد المرجعيّ', type: 'select', def: 'x',
        options: [{ v: 'x', t: `العرض X (${s.x.toFixed(2)})` },
                  { v: 'y', t: `العمق Y (${s.y.toFixed(2)})` },
                  { v: 'z', t: `الارتفاع Z (${s.z.toFixed(2)})` }] },
      { key: 'size', label: 'المقاس المطلوب (mm)', def: +s.x.toFixed(2), min: 0.01 },
      { key: 'keep', label: 'أبقِ القاعدة على مستواها', type: 'check', def: true },
    ]);
    if (!r) return;
    const cur = s[r.axis];
    if (!(cur > 1e-6)) { toast('البُعد المرجعيّ صفر', 'error'); return; }
    const k = r.size / cur;
    const f = featById(id); if (!f) return;
    snapshot();
    // التحجيم يقع حول أصل الميزة لا حول المجسّم، فينزلق المجسّم بعيداً. نقيس
    // مظروفه بعد التحجيم ونعيده إلى مكانه — في مكانه يكبر، لا يهاجر.
    const c0 = b.getCenter(new THREE.Vector3()), baseZ = b.min.z;
    f.tf.sx *= k; f.tf.sy *= k; f.tf.sz *= k;
    rebuild();
    const nb = bboxOf([id]);
    if (nb) {
      const c1 = nb.getCenter(new THREE.Vector3());
      f.tf.px += c0.x - c1.x;
      f.tf.py += c0.y - c1.y;
      f.tf.pz += r.keep ? (baseZ - nb.min.z) : (c0.z - c1.z);
      rebuild();
    }
    toast(`حُجِّم ×${k.toFixed(3)} — البُعد ${r.axis.toUpperCase()} = ${r.size}mm`, 'success');
  }

  /* ٩ · تنعيم الشبكة */
  async function opSmooth() {
    const id = one(); if (!id) return;
    const r = await ask('تنعيم الشبكة', [
      { key: 'iters', label: 'عدد الدورات', def: 2, min: 1, max: 20 },
      { key: 'lambda', label: 'قوّة التنعيم (0.05–0.9)', def: 0.5, min: 0.05, max: 0.9, step: 0.05 },
    ]);
    if (!r) return;
    await busy('جارٍ تنعيم الشبكة…');
    try { pushOp(id, { op: 'smooth', iters: r.iters, lambda: r.lambda }, `تنعيم ×${r.iters}`); }
    finally { unbusy(); }
  }

  /* ١٠ · مقطع أفقيّ → لوحة الرسم */
  async function opSectionTo2D() {
    const e = ed();
    if (!e) { toast('محرّر الرسم غير متاح', 'error'); return; }
    const meshes = V().all().filter(m => m.visible);
    if (!meshes.length) { toast('لا مجسّم لقطعه', 'warn'); return; }
    const b = bboxOf(null);
    const r = await ask('مقطع إلى مخطّط ثنائيّ', [
      { key: 'axis', label: 'المستوى عموديّ على', type: 'select', def: 'z',
        options: [{ v: 'z', t: 'Z (مقطع أفقيّ)' }, { v: 'x', t: 'X' }, { v: 'y', t: 'Y' }] },
      { key: 'offset', label: 'الارتفاع / الإزاحة (mm)',
        def: b ? +((b.min.z + b.max.z) / 2).toFixed(2) : 0 },
    ]);
    if (!r) return;
    await busy('جارٍ حساب المقطع…');
    let rings = [];
    try { rings = window.CAD3DOps.sectionRings(meshes, r.axis, r.offset) || []; }
    finally { unbusy(); }
    if (!rings.length) { toast('المستوى لا يقطع أيّ مجسّم عند هذه الإزاحة', 'warn'); return; }
    e._saveHistory?.();
    // العالم ثلاثيّ الأبعاد Y للأعلى والكانفس Y للأسفل — نعكس كما في الإسقاط
    rings.forEach(ring => e.shapes.push({
      type: 'polyline', closed: true,
      points: ring.map(p => ({ x: p.x, y: -p.y })),
    }));
    e.render?.();
    toast(`أُضيف المقطع — ${rings.length} حلقة في لوحة الرسم`, 'success');
  }

  /* إضافيّ · كتلة الخام حول المجسّم */
  async function opStock() {
    const b = bboxOf(V().getSelection());
    if (!b) { toast('لا مجسّم', 'warn'); return; }
    const s = b.getSize(new THREE.Vector3());
    const r = await ask('كتلة الخام', [
      { key: 'mx', label: 'هامش X (mm)', def: 5, min: 0 },
      { key: 'my', label: 'هامش Y (mm)', def: 5, min: 0 },
      { key: 'mz', label: 'هامش Z علويّ (mm)', def: 2, min: 0 },
    ]);
    if (!r) return;
    snapshot();
    const f = addFeature('box', { w: s.x + r.mx * 2, d: s.y + r.my * 2, h: s.z + r.mz });
    f.name = `خام ${(s.x + r.mx * 2).toFixed(0)}×${(s.y + r.my * 2).toFixed(0)}×${(s.z + r.mz).toFixed(0)}`;
    f.tf.px = (b.min.x + b.max.x) / 2;
    f.tf.py = (b.min.y + b.max.y) / 2;
    f.tf.pz = b.min.z + (s.z + r.mz) / 2;
    f.mat = 'wood';
    rebuild();
    toast('أُضيفت كتلة الخام — استخدم «شفّاف» في وضع الإظهار لرؤية القطعة داخلها', 'success');
  }

  /* إضافيّ · تقرير قابلية التصنيع */
  async function opReport() {
    const meshes = V().all().filter(m => m.visible);
    if (!meshes.length) { toast('لا مجسّم', 'warn'); return; }
    const r = await ask('تقرير قابلية التصنيع', [
      { key: 'limit', label: 'حدّ التدلّي المسموح (° عن الأفق)', def: 45, min: 1, max: 89 },
    ]);
    if (!r) return;
    await busy('جارٍ تحليل الأوجه…');
    let rep = null, vol = 0;
    try {
      rep = window.CAD3DOps.overhangReport(meshes, r.limit);
      const k = K();
      meshes.forEach(m => { vol += k.volume(k.fromGeometry(m.geometry, m.matrixWorld)); });
    } finally { unbusy(); }
    if (!rep) return;
    const pct = (rep.ratio * 100).toFixed(1);
    if (infoEl) {
      infoEl.innerHTML =
        `<b>تقرير التصنيع</b><br>` +
        `<b>الارتفاع:</b> ${(rep.maxZ - rep.minZ).toFixed(2)} mm<br>` +
        `<b>الحجم:</b> ${(vol / 1000).toFixed(2)} cm³<br>` +
        `<b>المساحة:</b> ${(rep.total / 100).toFixed(2)} cm²<br>` +
        `<b>أوجه متدلّية:</b> ${pct}% (${rep.badTri.toLocaleString('en')} من ${rep.tri.toLocaleString('en')})<br>` +
        `<b>المثلّثات:</b> ${rep.tri.toLocaleString('en')}`;
    }
    toast(rep.ratio > 0.02
      ? `${pct}% من السطح متدلٍّ فوق ${r.limit}° — يحتاج دعماً في الطباعة أو قلباً في التفريز`
      : `لا تدلّي يُذكر (${pct}%) — قابل للتصنيع ثلاثيّ المحاور`,
      rep.ratio > 0.02 ? 'warn' : 'success');
  }

  /* ══════════════ عرض · خامات · عزل · تفجير ══════════════ */

  const MATS = {
    steel:  { name: 'فولاذ',  color: 0xb8c4cf, metalness: 0.85, roughness: 0.32 },
    brass:  { name: 'نحاس',   color: 0xd6a94a, metalness: 0.9,  roughness: 0.28 },
    alu:    { name: 'ألمنيوم', color: 0xd9dde2, metalness: 0.78, roughness: 0.4 },
    wood:   { name: 'خشب',    color: 0xb5813f, metalness: 0.02, roughness: 0.82 },
    plastic:{ name: 'بلاستيك', color: 0x5aa9e6, metalness: 0.05, roughness: 0.5 },
    mdf:    { name: 'MDF',    color: 0xc8a67a, metalness: 0,    roughness: 0.95 },
    clay:   { name: 'افتراضيّ', color: 0x9fb3c8, metalness: 0.15, roughness: 0.55 },
  };

  async function opMaterial() {
    const sel = V().getSelection();
    if (!sel.length) { toast('حدّد مجسّماً أو أكثر', 'warn'); return; }
    const r = await ask('الخامة', [{ key: 'm', label: 'اختر', type: 'select', def: 'steel',
      options: Object.entries(MATS).map(([v, o]) => ({ v, t: o.name })) }]);
    if (!r) return;
    snapshot();
    const M = MATS[r.m];
    sel.forEach(id => {
      const f = featById(id), mesh = V().get(id);
      if (f) f.mat = r.m;
      if (mesh) {
        mesh.material.color.setHex(M.color);
        mesh.material.metalness = M.metalness;
        mesh.material.roughness = M.roughness;
        mesh.material.needsUpdate = true;
      }
    });
    V().render();
    toast('الخامة: ' + M.name, 'success');
  }

  let isolated = false;
  function opIsolate() {
    const sel = new Set(V().getSelection());
    if (!isolated && !sel.size) { toast('حدّد ما تريد عزله', 'warn'); return; }
    isolated = !isolated;
    V().all().forEach(m => { m.visible = !isolated || sel.has(m.userData.id); });
    V().render();
    document.getElementById('c3-iso')?.classList.toggle('on', isolated);
    toast(isolated ? 'عزل التحديد' : 'إظهار الكلّ', 'info');
  }

  function opToggleHide() {
    const sel = V().getSelection();
    if (!sel.length) { toast('حدّد مجسّماً', 'warn'); return; }
    sel.forEach(id => {
      const f = featById(id), m = V().get(id);
      if (f) f.off = !f.off;
      if (m) m.visible = !(f && f.off);
    });
    V().render(); renderTree(); saveSession();
  }

  let exploded = 0;
  function opExplode() {
    const list = V().all();
    if (list.length < 2) { toast('التفجير يحتاج مجسّمين فأكثر', 'warn'); return; }
    exploded = exploded ? 0 : 1;
    const c = new THREE.Vector3();
    const box = new THREE.Box3();
    list.forEach(m => box.expandByObject(m));
    box.getCenter(c);
    list.forEach(m => {
      const f = featById(m.userData.id);
      if (!f) return;
      if (!f.__ex) {
        const b = new THREE.Box3().setFromObject(m);
        f.__ex = b.getCenter(new THREE.Vector3()).sub(c).normalize().multiplyScalar(
          Math.max(20, box.getSize(new THREE.Vector3()).length() * 0.28));
      }
      m.position.set(
        f.tf.px + (exploded ? f.__ex.x : 0),
        f.tf.py + (exploded ? f.__ex.y : 0),
        f.tf.pz + (exploded ? f.__ex.z : 0));
    });
    V().render();
    document.getElementById('c3-exp')?.classList.toggle('on', !!exploded);
  }

  /* ══════════════ تراجع / إعادة ══════════════ */

  const serialize = () => JSON.stringify(feats.map(f => ({
    id: f.id, kind: f.kind, name: f.name, src: f.src, color: f.color, mat: f.mat || null,
    tf: f.tf, hidden: f.hidden, off: !!f.off,
    params: f.kind === 'import' ? { __imported: true } : f.params,
  })));

  function snapshot() {
    undoStack.push(serialize());
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
    syncUndo();
  }

  function restore(json) {
    const keep = new Map(feats.map(f => [f.id, f]));
    feats = JSON.parse(json).map(o => {
      const old = keep.get(o.id);
      // الهندسة المستوردة لا تُسلسَل — نستعيدها من الميزة القديمة إن بقيت
      const params = o.params && o.params.__imported && old ? old.params : o.params;
      return Object.assign({}, o, { params: params || {} });
    }).filter(f => !(f.kind === 'import' && !f.params.geometry));
    rebuild();
  }

  /* ══════════════ حفظ تلقائيّ للجلسة ══════════════ */

  const SKEY = 'dq3d.session';
  let saveT = 0;
  /**
   * الشجرة تُحفَظ محلّياً بعد كل تعديل، فإغلاق اللسان أو تحديث الصفحة لا يبتلع
   * عمل ساعة. الهندسة المستوردة لا تُسلسَل (ميغابايتات في localStorage)، فتُسقَط
   * ميزاتها عند الاستعادة كما في فتح المشروع.
   */
  function saveSession() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try {
        if (!feats.length) { localStorage.removeItem(SKEY); return; }
        localStorage.setItem(SKEY, JSON.stringify({ v: 1, t: Date.now(), feats: JSON.parse(serialize()) }));
      } catch (_) { /* الحصّة ممتلئة أو التخزين محجوب — الحفظ التلقائيّ ترفٌ لا شرط */ }
    }, 400);
  }

  function loadSession() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (_) { return false; }
    if (!d || !Array.isArray(d.feats) || !d.feats.length) return false;
    const keep = d.feats.filter(f => f.kind !== 'import');
    if (!keep.length) return false;
    feats = keep;
    seq = feats.length + 1;
    rebuild();
    const mins = Math.round((Date.now() - (d.t || Date.now())) / 60000);
    toast(`استُعيدت جلسة ثلاثيّ الأبعاد (${feats.length} ميزة${mins > 1 ? ` · منذ ${mins} دقيقة` : ''})`, 'info');
    return true;
  }

  function opUndo() {
    if (!undoStack.length) { toast('لا تراجع', 'info'); return; }
    redoStack.push(serialize());
    restore(undoStack.pop());
    syncUndo(); toast('تراجع', 'info');
  }
  function opRedo() {
    if (!redoStack.length) { toast('لا إعادة', 'info'); return; }
    undoStack.push(serialize());
    restore(redoStack.pop());
    syncUndo(); toast('إعادة', 'info');
  }
  function syncUndo() {
    const u = document.getElementById('c3-undo'), r = document.getElementById('c3-redo');
    // التعطيل الحقيقيّ لا مجرّد تعتيم: الزرّ الشفّاف كان يبقى قابلاً للنقر
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  /* ══════════════ مشروع ثلاثيّ · استيراد OBJ · صورة ══════════════ */

  function opSaveProject() {
    if (!feats.length) { toast('لا شيء لحفظه', 'warn'); return; }
    const blob = new Blob([JSON.stringify({ v: 1, feats: JSON.parse(serialize()) }, null, 1)],
      { type: 'application/json' });
    download(blob, 'diqqat-qalam-3d.json');
    toast('حُفظ المشروع ثلاثيّ الأبعاد', 'success');
  }

  function opLoadProject() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const d = JSON.parse(fr.result);
          if (!d || !Array.isArray(d.feats)) throw new Error('صيغة غير معروفة');
          snapshot();
          feats = d.feats.filter(x => x.kind !== 'import');
          const dropped = d.feats.length - feats.length;
          rebuild(); V().fit();
          toast(dropped ? `فُتح المشروع — أُسقطت ${dropped} ميزة مستوردة (هندستها ليست في الملف)`
                        : 'فُتح المشروع', dropped ? 'warn' : 'success');
        } catch (e) { toast('تعذّرت قراءة الملف: ' + e.message, 'error'); }
      };
      fr.readAsText(f);
    };
    inp.click();
  }

  function opImportOBJ() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.obj';
    inp.onchange = () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => {
        const V3 = [], pos = [];
        for (const line of String(fr.result).split('\n')) {
          const p = line.trim().split(/\s+/);
          if (p[0] === 'v') V3.push([+p[1], +p[2], +p[3]]);
          else if (p[0] === 'f' && p.length >= 4) {
            const idx = p.slice(1).map(t => {
              const n = parseInt(t.split('/')[0], 10);
              return n < 0 ? V3.length + n : n - 1;
            });
            for (let i = 2; i < idx.length; i++) {          // مروحة للمضلّعات
              for (const k of [idx[0], idx[i - 1], idx[i]]) {
                const v = V3[k];
                if (v) pos.push(v[0], v[1], v[2]);
              }
            }
          }
        }
        if (pos.length < 9) { toast('لم أجد أوجهاً في الملف', 'error'); return; }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
        snapshot();
        const f = addFeature('import', { geometry: g });
        f.name = file.name.replace(/\.obj$/i, '');
        rebuild(); V().fit();
        toast(`استُورد ${f.name} — ${pos.length / 9} وجهاً`, 'success');
      };
      fr.readAsText(file);
    };
    inp.click();
  }

  function opSnapshotPNG() {
    const d = V().snapshot();
    if (!d) return;
    const a = document.createElement('a');
    a.href = d; a.download = 'diqqat-qalam-3d.png';
    document.body.appendChild(a); a.click(); a.remove();
    toast('حُفظت صورة العرض', 'success');
  }

  /* ══════════════ جسر التصنيع ══════════════ */

  async function opRoughing() {
    const meshes = V().all().filter(m => m.visible);
    if (!meshes.length) { toast('لا مجسّم لحساب مساره', 'warn'); return; }
    const r = await ask('مسار تخشين ثلاثيّ المحاور', [
      { key: 'step', label: 'خطوة العيّنة (mm)', def: 1, min: 0.2 },
      { key: 'stepDown', label: 'عمق كل طبقة (mm)', def: 2, min: 0.2 },
      { key: 'stepOver', label: 'تباعد الممرّات (mm)', def: 2, min: 0.2 },
      { key: 'stock', label: 'بدل التشطيب (mm)', def: 0.3 },
      { key: 'feed', label: 'تغذية القطع (mm/min)', def: 800, min: 50 },
    ]);
    if (!r) return;
    toast('جارٍ حساب خريطة الارتفاعات…', 'info');
    await new Promise(res => setTimeout(res, 30));
    const O = window.CAD3DOps;
    const hm = O.heightmap(meshes, r.step);
    if (!hm) { toast('تعذّر بناء الخريطة', 'error'); return; }
    if (hm.error) { toast(hm.error, 'error'); return; }
    const out = O.roughingGCode(hm, r);
    if (!out) { toast('تعذّر توليد المسار', 'error'); return; }
    download(new Blob([out.gcode], { type: 'text/plain' }), 'roughing-3axis.nc');
    toast(`مسار التخشين: ${out.levels} طبقة · ${out.moves.toLocaleString('en')} حركة — نُزّل .nc`, 'success');
  }

  async function opProject2D() {
    const e = ed();
    if (!e) { toast('محرّر الرسم غير متاح', 'error'); return; }
    const meshes = V().all().filter(m => m.visible);
    if (!meshes.length) { toast('لا مجسّم لإسقاطه', 'warn'); return; }
    const r = await ask('إسقاط الظلّ إلى مخطّط ثنائيّ', [
      { key: 'step', label: 'دقّة العيّنة (mm)', def: 0.8, min: 0.2 }]);
    if (!r) return;
    const O = window.CAD3DOps;
    const hm = O.heightmap(meshes, r.step);
    if (!hm || hm.error) { toast(hm ? hm.error : 'تعذّر الإسقاط', 'error'); return; }
    const rings = O.chain(O.silhouette(hm));
    if (!rings.length) { toast('لم أجد حدوداً للظلّ', 'warn'); return; }
    e._saveHistory?.();
    // إحداثيات العالم ثلاثيّ الأبعاد Y للأعلى، والكانفس Y للأسفل — نعكس
    rings.forEach(ring => e.shapes.push({
      type: 'polyline', closed: true,
      points: ring.map(p => ({ x: p.x, y: -p.y })),
    }));
    e.render?.();
    toast(`أُسقط الظلّ — ${rings.length} حلقة في لوحة الرسم`, 'success');
  }

  /* ══════════════ قياسات إضافية ══════════════ */

  function opBBox() {
    const sel = V().getSelection();
    const list = sel.length ? sel.map(id => V().get(id)).filter(Boolean) : V().all();
    if (!list.length) { toast('لا مجسّم', 'warn'); return; }
    const box = new THREE.Box3();
    list.forEach(m => box.expandByObject(m));
    const s = box.getSize(new THREE.Vector3());
    const k = K3();
    let vol = 0;
    list.forEach(m => { vol += k.volume(k.fromGeometry(m.geometry, m.matrixWorld)); });
    toast(`المظروف ${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)} mm · ` +
          `الحجم ${(vol / 1000).toFixed(2)} cm³`, 'success');
  }
  const K3 = () => window.CAD3DKernel;

  /* ══════════════ تسجيل الأوامر في الشريط والريل ══════════════ */

  function defineCommands() {
    if (RAIL.length) return;

    railGroup({ icon: 'cube', name: 'مجسّمات أوّلية', items: [
      { t: 'صندوق', icon: 'cube', fn: () => opPrimitive('box') },
      { t: 'أسطوانة', fn: () => opPrimitive('cylinder') },
      { t: 'كرة', fn: () => opPrimitive('sphere') },
      { t: 'مخروط', fn: () => opPrimitive('cone') },
      { t: 'أنبوب مجوّف', fn: () => opPrimitive('tube') },
      { t: 'حلقة', fn: () => opPrimitive('torus') },
      { t: 'إسفين', fn: () => opPrimitive('wedge') },
    ] });

    railGroup({ icon: 'arrow-up', name: 'من لوحة الرسم', items: [
      { t: 'بثق', icon: 'arrow-up', fn: opExtrude },
      { t: 'تدوير حول محور', icon: 'rotate', fn: opRevolve },
      { t: 'كنس على مسار', icon: 'pen', fn: opSweep },
      { t: 'تجسير بين مقطعين', icon: 'blend', fn: opLoft },
      { t: 'لولب / زنبرك', icon: 'polar', fn: OPS.helix },
    ] });

    railGroup({ icon: 'blend', name: 'عمليات منطقية', items: [
      { t: 'اتحاد', fn: () => opBoolean('uni'), key: 'U' },
      { t: 'طرح', fn: () => opBoolean('sub'), key: 'S' },
      { t: 'تقاطع', fn: () => opBoolean('int'), key: 'I' },
      { t: 'تقطيع بمستوٍ', icon: 'section', fn: OPS.split },
    ] });

    railGroup({ icon: 'drill', name: 'حفر ونقش', items: [
      { t: 'ثقب…', icon: 'drill', fn: opDrill },
      { t: 'جيب مستطيل…', icon: 'pocket', fn: opPocket },
      { sep: true },
      { t: 'نقش الرسم في المجسّم…', icon: 'engrave', fn: () => stampDrawing('engrave') },
      { t: 'إبراز الرسم على المجسّم…', icon: 'emboss', fn: () => stampDrawing('emboss') },
    ] });

    railGroup({ icon: 'align-hcenter', name: 'ترتيب المجسّمات', items: [
      { t: 'محاذاة…', icon: 'align-hcenter', fn: opAlign },
      { t: 'توزيع متساوٍ…', icon: 'dist-h', fn: opDistribute },
      { t: 'إنزال إلى الأرضية', icon: 'floor', fn: opDropFloor },
      { t: 'تحجيم إلى مقاس…', icon: 'scale', fn: opScaleTo },
    ] });

    railGroup({ icon: 'duplicate', name: 'تكرار ومرآة', items: [
      { t: 'نسخة', icon: 'duplicate', fn: OPS.duplicate },
      { t: 'مرآة', icon: 'mirror-h', fn: OPS.mirror },
      { t: 'مصفوفة خطّية', icon: 'dist-h', fn: OPS.linear },
      { t: 'مصفوفة دائرية', icon: 'polar', fn: OPS.circular },
    ] });

    railGroup({ icon: 'wrench', name: 'تعديل المجسّم', items: [
      { t: 'تفريغ (قشرة)', fn: OPS.shell },
      { t: 'تسميك السطح', icon: 'offset', fn: OPS.offset },
      { t: 'تنعيم الشبكة…', icon: 'smooth', fn: opSmooth },
      { t: 'غلاف محدّب', icon: 'cap', fn: OPS.hull },
      { t: 'تبسيط الشبكة', icon: 'simplify', fn: OPS.decimate },
      { t: 'توسيط على الأصل', icon: 'crosshair', fn: OPS.center },
      { sep: true },
      { t: 'حذف', icon: 'trash', key: 'Del', fn: opDelete },
    ] });

    railGroup({ icon: 'move', name: 'تحويل', items: [
      { t: 'نقل', icon: 'move', fn: () => setGizmo('move') },
      { t: 'تدوير', icon: 'rotate', fn: () => setGizmo('rotate') },
      { t: 'تحجيم', icon: 'scale', fn: () => setGizmo('scale') },
      { t: 'قيم دقيقة…', fn: opTransform },
    ] });

    railGroup({ icon: 'ruler', name: 'قياس وتحليل', items: [
      { t: 'مسافة بين نقطتين', icon: 'ruler', fn: toggleMeasure },
      { t: 'المظروف والحجم', icon: 'bbox', fn: opBBox },
      { t: 'تقرير قابلية التصنيع…', icon: 'gauge', fn: opReport },
    ] });

    railGroup({ icon: 'cpu', name: 'تصنيع CNC', items: [
      { t: 'مسار تخشين ثلاثيّ المحاور', icon: 'cpu', fn: opRoughing },
      { t: 'كتلة الخام…', icon: 'stock', fn: opStock },
      { sep: true },
      { t: 'إسقاط الظلّ إلى الرسم', icon: 'shapes', fn: opProject2D },
      { t: 'مقطع إلى الرسم…', icon: 'section', fn: opSectionTo2D },
    ] });

    railGroup({ icon: 'download', name: 'ملفّات', items: [
      { t: 'تصدير STL', icon: 'download', fn: opExportSTL },
      { t: 'تصدير OBJ', fn: opExportOBJ },
      { t: 'صورة PNG للعرض', icon: 'image', fn: opSnapshotPNG },
      { t: 'استيراد STL', fn: opImportSTL },
      { t: 'استيراد OBJ', fn: opImportOBJ },
      { t: 'حفظ مشروع ثلاثيّ', fn: opSaveProject },
      { t: 'فتح مشروع ثلاثيّ', fn: opLoadProject },
    ] });

    /* الشريط العلويّ */
    topItem({ icon: 'rot-left', lbl: 'تراجع', name: 'تراجع (Ctrl+Z)', id: 'c3-undo', fn: opUndo });
    topItem({ icon: 'rot-right', lbl: 'إعادة', name: 'إعادة (Ctrl+Y)', id: 'c3-redo', fn: opRedo });
    topItem({ sep: true });
    topItem({ icon: 'fit-view', lbl: 'ملاءمة', name: 'ملاءمة العرض (F)', fn: () => V().fit() });
    topItem({ icon: 'zoom-in', lbl: 'تكبير', name: 'تكبير على التحديد', fn: opZoomSel });
    topItem({ icon: 'ortho', lbl: 'متعامد', name: 'إسقاط متعامد / منظور (O)', id: 'c3-ortho', fn: toggleOrtho });
    topItem({ sep: true });
    topItem({ icon: 'blend', lbl: 'الإظهار', name: 'وضع الإظهار: مظلّل', id: 'c3-mode', fn: cycleMode });
    topItem({ icon: 'wood', lbl: 'خامة', name: 'الخامة', fn: opMaterial });
    topItem({ icon: 'grid', lbl: 'الشبكة', name: 'الشبكة', id: 'c3-grid', fn: toggleGrid });
    topItem({ icon: 'section', lbl: 'مقطع', name: 'مستوى المقطع', id: 'c3-sec', fn: toggleSection });
    topItem({ sep: true });
    topItem({ icon: 'eye', lbl: 'إخفاء', name: 'إخفاء / إظهار المحدَّد', fn: opToggleHide });
    topItem({ icon: 'isolate', lbl: 'عزل', name: 'عزل التحديد', id: 'c3-iso', fn: opIsolate });
    topItem({ icon: 'explode', lbl: 'تفجير', name: 'تفجير العرض', id: 'c3-exp', fn: opExplode });
    topItem({ icon: 'sidebar', lbl: 'الشجرة', name: 'طيّ / بسط شجرة الميزات', id: 'c3-side', fn: toggleSide });
    topItem({ grow: true });
    topItem({ icon: 'cpu', lbl: 'تخشين', name: 'مسار تخشين ثلاثيّ المحاور → G-Code', fn: opRoughing });
    topItem({ icon: 'download', lbl: 'STL', name: 'تصدير STL', fn: opExportSTL });
  }

  function opZoomSel() {
    const sel = V().getSelection();
    if (!sel.length) { V().fit(); return; }
    V().fitTo(sel);
  }

  let gridOn = true;
  function toggleGrid() {
    gridOn = !gridOn;
    V().showGrid(gridOn); V().showAxes(gridOn);
    document.getElementById('c3-grid')?.classList.toggle('on', !gridOn);
  }

  /* ══════════════ الإقلاع ══════════════ */

  async function open() {
    const pane = document.getElementById('pane-cad');
    if (!pane) return;
    if (!booted) {
      const ok = await ensureThree();
      if (!ok) { pane.innerHTML = '<div class="c3-empty">تعذّر تحميل محرّك العرض ثلاثيّ الأبعاد.</div>'; return; }
      defineCommands();
      buildUI(pane);
      const v = V();
      if (!v.mount(host)) { pane.innerHTML = '<div class="c3-empty">تعذّر تهيئة WebGL.</div>'; return; }
      v.on('select', () => { renderTree(); updateInfo(); });
      v.on('change', e => {
        if (!e || !e.transform) return;
        const f = featById(e.id), m = v.get(e.id);
        if (!f || !m) return;
        f.tf.px = m.position.x; f.tf.py = m.position.y; f.tf.pz = m.position.z;
        f.tf.rx = m.rotation.x; f.tf.ry = m.rotation.y; f.tf.rz = m.rotation.z;
        f.tf.sx = m.scale.x; f.tf.sy = m.scale.y; f.tf.sz = m.scale.z;
        updateInfo();
      });
      v.on('measure', d => toast(
        `المسافة ${d.d.toFixed(2)} mm — Δx ${d.dx.toFixed(2)} · Δy ${d.dy.toFixed(2)} · Δz ${d.dz.toFixed(2)}`, 'success'));
      setGizmo('move');
      v.setView('iso'); v.fit();
      wireKeys3D();
      booted = true;
      syncUndo();
      renderTree(); updateInfo();
      // الجلسة السابقة تُستعاد بعد اكتمال التهيئة لا قبلها — rebuild يحتاج عرضاً جاهزاً
      if (loadSession()) v.fit();
    }
    requestAnimationFrame(() => { V().resize(); V().render(); });
  }

  /** اختصارات تعمل فقط حين تكون مساحة الثري دي هي الظاهرة */
  function wireKeys3D() {
    document.addEventListener('keydown', e => {
      const pane = document.getElementById('pane-cad');
      if (!pane || !pane.classList.contains('active')) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = (e.key || '').toLowerCase();
      if (e.ctrlKey && k === 'z') { e.preventDefault(); opUndo(); return; }
      if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); opRedo(); return; }
      if (e.ctrlKey && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (e.ctrlKey && k === 'd' && !e.shiftKey) { e.preventDefault(); OPS.duplicate(); return; }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (k === 'escape') {
        // إفلات متدرّج: أغلق القوائم، وإلّا ألغِ التحديد
        if (document.querySelector('#pane-cad .c3-slot.open') || ctxEl) closeFlyouts();
        else { V().setSelection([]); renderTree(); updateInfo(); }
        return;
      }
      if (k === 'f2') {
        const s = V().getSelection();
        if (s.length === 1) { e.preventDefault(); beginRename(s[0]); }
        return;
      }
      const M = { u: () => opBoolean('uni'), s: () => opBoolean('sub'), i: () => opBoolean('int'),
                  m: () => setGizmo('move'), r: () => setGizmo('rotate'), t: () => setGizmo('scale'),
                  h: opToggleHide, delete: opDelete, backspace: opDelete };
      if (M[k]) { e.preventDefault(); M[k](); }
    });
  }

  /* التبويب يُدار بنفس آلية بقية ألسنة الإخراج */
  function wire() {
    document.addEventListener('click', e => {
      const t = e.target.closest && e.target.closest('.otab[data-tab="cad"]');
      if (t) setTimeout(open, 30);
    });
    // بند القائمة يُوزَّع من جدول ACTIONS في menu-bar.js (يوقف الانتشار هناك)
    // اختصار: Ctrl+Shift+D
    document.addEventListener('keydown', e => {
      if (!e.ctrlKey || !e.shiftKey || (e.key || '').toLowerCase() !== 'd') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      reveal();
    });
  }

  /**
   * التبويب يسكن لوحة الإخراج، وهي مغلقة في مساحة «رسم» — فالنقر على اللسان
   * وحده لا يكفي: نفتح اللوحة أوّلاً ثم ننتظر إعادة الرسم قبل تفعيل اللسان.
   */
  function reveal() {
    const W = window.WorkspaceDock;
    const needOpen = W && W.active && W.active() && !W.isOpen('output');
    // عمودٌ خاصّ بعرض نصف الشاشة تقريباً — العرض ثلاثيّ الأبعاد داخل عمود
    // جانبيّ ضيّق يخرج بكانفس بعرض عشرات البكسلات، أي بلا فائدة
    const want = Math.round(Math.min(900, Math.max(560, window.innerWidth * 0.46)));
    if (needOpen) W.open('output', { zone: 'left', w: want });
    // مفتوحة سلفاً لكن ضيّقة (عمود «CNC» ٤٠٠px): بعد الريل والشجرة لا يبقى
    // للعرض إلا ~١٦٠px — فنوسّعها إلى حدّ صالح للعمل بدل تركها مخنوقة
    else if (W) W.widen('output', want);
    setTimeout(() => {
      const tab = document.querySelector('.otab[data-tab="cad"]');
      if (tab) { tab.click(); tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      else open();
      setTimeout(() => { if (window.CAD3DView?.ready()) { CAD3DView.resize(); CAD3DView.render(); } }, 260);
    }, needOpen ? 160 : 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  window.CAD3D = {
    open, reveal, rebuild,
    features: () => feats.map(f => ({ id: f.id, kind: f.kind, name: f.name, src: f.src.slice(), error: f.error || null })),
    add: (kind, params, src) => { const f = addFeature(kind, params, src); rebuild(); return f.id; },
    remove: opDelete,
    boolean: opBoolean,
    extrude: opExtrude,
    exportSTL: opExportSTL,
    clear: () => { feats = []; rebuild(); },
    ready: () => booted,
  };
})();
