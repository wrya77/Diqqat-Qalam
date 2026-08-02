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
    }
    v.setSelection(sel.filter(id => !consumed.has(id) && feats.some(f => f.id === id)));
    renderTree();
    updateInfo();
    v.render();
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
      cylinder: [{ key: 'r', label: 'نصف القطر (mm)', def: 20 }, { key: 'h', label: 'الارتفاع (mm)', def: 40 }, { key: 'seg', label: 'التقسيمات', def: 48 }],
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
        { key: 'segments', label: 'التقسيمات', def: 48, min: 3, max: 256 },
      ]);
      if (!r) return;
      p = r;
    }
    p.rings = rings;
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
    addFeature('loft', { ringsA: rd(idx[0]), ringsB: rd(idx[1]), height: h, steps: 12 });
    rebuild(); V().fit();
    toast('تمّ التجسير', 'success');
  }

  function opBoolean(op) {
    const sel = V().getSelection();
    if (sel.length !== 2) { toast('حدّد مجسّمين اثنين في العرض ثلاثيّ الأبعاد', 'warn'); return; }
    const names = { uni: 'اتحاد', sub: 'طرح', int: 'تقاطع' };
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
      { key: 'segments', label: 'التقسيمات', def: P.segments ?? 48 });
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

      /* ── الشريط العلويّ ──
         يلتفّ ولا يمرّر: الشريط الممرَّر يُخفي أزراره خلف حافّته فيبدو ناقصاً.
         وكل زرّ أيقونة **مع نصّ** — الأيقونة وحدها في ٢٨px لا تُقرأ. */
      .c3-top{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:3px;
        padding:6px 7px;background:var(--bg1,#0d1117);
        border-bottom:1px solid var(--border,#30363d)}
      .c3-sep{flex:0 0 auto;width:1px;align-self:stretch;background:var(--border,#30363d);margin:2px 5px}
      .c3-grow{flex:1 1 auto;min-width:4px}

      .c3-ic{flex:0 0 auto;min-height:28px;display:inline-flex;align-items:center;gap:5px;
        padding:0 9px;border:1px solid var(--border,#30363d);border-radius:7px;
        background:var(--bg2,#161b22);cursor:pointer;color:var(--text2,#b1bac4);
        font-family:inherit;font-size:11.5px;font-weight:600;white-space:nowrap;
        transition:background .14s ease,color .14s ease,border-color .14s ease}
      .c3-ic:hover{background:var(--bg3,#1c2128);color:var(--text,#e6edf3);
        border-color:var(--text3,#8b949e)}
      .c3-ic.on{background:color-mix(in srgb,var(--accent,#2f81f7) 22%,transparent);
        border-color:var(--accent,#2f81f7);color:var(--accent-h,#58a6ff)}
      .c3-ic svg{width:14px;height:14px;flex:0 0 auto}
      .c3-ic .lbl{font-size:11.5px;font-weight:600}

      /* ── الريل الجانبيّ: مجموعات أدوات بمثلّث انبثاق ── */
      .c3-main{flex:1 1 auto;min-height:0;display:flex}
      .c3-rail{flex:0 0 auto;width:40px;display:flex;flex-direction:column;gap:2px;
        padding:5px 3px;overflow-y:auto;overflow-x:hidden;
        background:var(--bg1,#0d1117);border-inline-end:1px solid var(--border,#30363d)}
      .c3-slot{position:relative;flex:0 0 auto}
      .c3-t{width:34px;height:32px;display:flex;align-items:center;justify-content:center;
        border:1px solid transparent;border-radius:7px;background:none;cursor:pointer;padding:0;
        color:var(--text2,#b1bac4);transition:background .14s ease,color .14s ease,border-color .14s ease}
      .c3-t:hover{background:var(--bg3,#1c2128);color:var(--text,#e6edf3)}
      .c3-t.on{background:color-mix(in srgb,var(--accent,#2f81f7) 20%,transparent);
        border-color:var(--accent,#2f81f7);color:var(--accent-h,#58a6ff)}
      .c3-t svg{width:17px;height:17px}
      .c3-arw{position:absolute;inset-block-end:2px;inset-inline-end:2px;width:0;height:0;
        border-inline-start:4px solid transparent;border-block-end:4px solid var(--text3,#8b949e);
        pointer-events:none}
      /* الانبثاق مثبَّت بالنافذة لا بالريل: الريل له overflow-y:auto، والـCSS
         يحوّل عندها overflow-x من visible إلى auto قسراً — فأي ابن يخرج عن
         عرضه الأربعين بكسلاً يُقصّ ويختفي. لهذا كانت الأدوات «لا تفتح». */
      .c3-fly{position:fixed;z-index:2500;display:none;min-width:186px;padding:4px;
        border-radius:9px;background:var(--bg2,#161b22);
        border:1px solid var(--border,#30363d);box-shadow:0 16px 40px rgba(0,0,0,.55)}
      .c3-slot.open .c3-fly{display:block}
      .c3-fi{display:flex;align-items:center;gap:7px;width:100%;padding:6px 8px;border:none;
        border-radius:6px;background:none;cursor:pointer;color:var(--text2,#b1bac4);
        font-family:inherit;font-size:12px;font-weight:600;text-align:start;white-space:nowrap;
        transition:background .12s ease,color .12s ease}
      .c3-fi:hover{background:var(--bg3,#1c2128);color:var(--text,#e6edf3)}
      .c3-fi svg{width:14px;height:14px;flex:0 0 auto;opacity:.85}
      .c3-fi .k{margin-inline-start:auto;font-size:10px;opacity:.55;font-weight:700}

      /* تلميح عائم — الأسماء لا تُزحم الشريط بل تظهر عند المرور */
      .c3-tip{position:fixed;z-index:2600;pointer-events:none;padding:4px 9px;border-radius:6px;
        font-size:11.5px;font-weight:600;white-space:nowrap;opacity:0;
        background:#0d1117;color:#e6edf3;border:1px solid var(--accent,#2f81f7);
        box-shadow:0 8px 22px rgba(0,0,0,.5);transition:opacity .12s ease}
      .c3-tip.on{opacity:1}

      /* ── الكانفس وطبقة الـHUD فوقه ── */
      .c3-view{flex:1 1 auto;min-width:0;position:relative;background:#0b1016}
      .c3-hud{position:absolute;inset:0;pointer-events:none;z-index:5}
      .c3-hud > *{pointer-events:auto}
      .c3-cube{position:absolute;inset-block-start:8px;inset-inline-end:8px;
        display:grid;grid-template-columns:repeat(3,22px);grid-template-rows:repeat(3,22px);gap:2px}
      .c3-cb{border:1px solid var(--border,#30363d);border-radius:5px;cursor:pointer;padding:0;
        background:color-mix(in srgb,#0d1117 78%,transparent);color:var(--text3,#8b949e);
        font-family:inherit;font-size:9.5px;font-weight:800;
        transition:background .14s ease,color .14s ease,border-color .14s ease}
      .c3-cb:hover{background:var(--accent,#2f81f7);color:#fff;border-color:var(--accent,#2f81f7)}
      .c3-cb.mid{background:color-mix(in srgb,var(--accent,#2f81f7) 24%,#0d1117);
        color:var(--accent-h,#58a6ff)}
      .c3-stat{position:absolute;inset-block-end:8px;inset-inline-start:8px;display:flex;gap:6px;
        align-items:center;padding:4px 9px;border-radius:7px;font-size:11px;font-weight:600;
        background:color-mix(in srgb,#0d1117 82%,transparent);color:var(--text3,#8b949e);
        border:1px solid var(--border,#30363d)}
      .c3-stat b{color:var(--accent-h,#58a6ff);font-weight:800}
      .c3-hint{position:absolute;inset-block-end:8px;inset-inline-end:8px;padding:4px 9px;
        border-radius:7px;font-size:10.5px;background:color-mix(in srgb,#0d1117 82%,transparent);
        color:var(--text3,#8b949e);border:1px solid var(--border,#30363d);max-width:52%;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

      /* ── لوحة الشجرة ── */
      .c3-side{flex:0 0 200px;display:flex;flex-direction:column;min-height:0;
        background:var(--bg2,#161b22);border-inline-start:1px solid var(--border,#30363d)}
      .c3-h{flex:0 0 auto;display:flex;align-items:center;gap:5px;padding:6px 9px;font-size:11px;
        font-weight:700;color:var(--text3,#8b949e);border-bottom:1px solid var(--border,#30363d)}
      .c3-h .c3-ic{width:22px;height:20px;margin-inline-start:auto}
      .c3-tree{flex:1 1 auto;overflow-y:auto;padding:4px}
      .c3-row{display:flex;align-items:center;gap:5px;padding:5px 7px;border-radius:6px;
        cursor:pointer;font-size:12px;color:var(--text2,#b1bac4);
        transition:background .12s ease,color .12s ease}
      .c3-row:hover{background:var(--bg3,#1c2128)}
      .c3-row.on{background:color-mix(in srgb,var(--accent,#2f81f7) 20%,transparent);
        color:var(--accent-h,#58a6ff)}
      .c3-row.bad{color:#f85149}
      .c3-row.off{opacity:.42}
      .c3-row .n{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .c3-row .a{flex:0 0 auto;width:17px;text-align:center;opacity:.55;font-size:11px}
      .c3-row .a:hover{opacity:1}
      .c3-row svg{width:13px;height:13px;flex:0 0 auto;opacity:.8}
      .c3-info{flex:0 0 auto;padding:7px 9px;font-size:11px;line-height:1.75;
        color:var(--text3,#8b949e);border-top:1px solid var(--border,#30363d)}
      .c3-info b{color:var(--text2,#b1bac4);font-weight:600}
      .c3-empty{padding:14px 10px;font-size:11.5px;color:var(--text3,#8b949e);line-height:1.8}
      /* الطيّ يُقاس على عرض اللوحة نفسها لا على النافذة — استعلام الوسائط
         يقيس النافذة فلا يُجدي داخل عمودٍ ضيّق في شاشةٍ عريضة. */
      .c3-side.hid{display:none}
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

    /* الشريط العلويّ */
    const top = document.createElement('div');
    top.className = 'c3-top';
    for (const it of TOP) {
      if (it.sep) { const s = document.createElement('span'); s.className = 'c3-sep'; top.appendChild(s); continue; }
      if (it.grow) { const s = document.createElement('span'); s.className = 'c3-grow'; top.appendChild(s); continue; }
      const b = document.createElement('button');
      b.className = 'c3-ic'; b.type = 'button';
      b.innerHTML = (it.icon ? ico(it.icon) : '') +
                    (it.lbl ? `<span class="lbl">${it.lbl}</span>` : '');
      b.setAttribute('aria-label', it.name);
      if (it.id) b.id = it.id;
      tipFor(b, it.name);
      b.addEventListener('click', () => it.fn(b));
      top.appendChild(b);
    }

    /* الريل الجانبيّ */
    const main = document.createElement('div'); main.className = 'c3-main';
    const rail = document.createElement('div'); rail.className = 'c3-rail';
    RAIL.forEach(g => {
      const slot = document.createElement('div'); slot.className = 'c3-slot';
      const b = document.createElement('button');
      b.className = 'c3-t'; b.type = 'button';
      b.innerHTML = ico(g.icon);
      b.setAttribute('aria-label', g.name);
      tipFor(b, g.name + (g.items.length > 1 ? ` (${g.items.length})` : ''));
      slot.appendChild(b);
      if (g.items.length > 1) {
        const arw = document.createElement('span'); arw.className = 'c3-arw';
        slot.appendChild(arw);
        const fly = document.createElement('div'); fly.className = 'c3-fly';
        g.items.forEach(it => {
          const fi = document.createElement('button');
          fi.className = 'c3-fi'; fi.type = 'button';
          fi.innerHTML = (it.icon ? ico(it.icon) : ico(g.icon)) +
            `<span>${it.t}</span>` + (it.key ? `<span class="k">${it.key}</span>` : '');
          fi.addEventListener('click', () => { closeFlyouts(); it.fn(); });
          fly.appendChild(fi);
        });
        slot.appendChild(fly);
        b.addEventListener('click', e => {
          e.stopPropagation();
          const was = slot.classList.contains('open');
          closeFlyouts();
          if (was) return;
          slot.classList.add('open');
          placeFly(b, fly);
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
    row2.style.cssText = 'position:absolute;inset-block-start:80px;inset-inline-end:8px;display:flex;gap:2px';
    [['أمام', 'front'], ['خلف', 'back'], ['ملاءمة', 'fit']].forEach(([t, v]) => {
      const b = document.createElement('button');
      b.className = 'c3-cb'; b.type = 'button'; b.textContent = t;
      b.style.width = '38px'; b.style.height = '20px';
      b.addEventListener('click', () => (v === 'fit' ? V().fit() : V().setView(v)));
      row2.appendChild(b);
    });

    statEl = document.createElement('div'); statEl.className = 'c3-stat';
    const hint = document.createElement('div'); hint.className = 'c3-hint';
    hint.textContent = 'سحب: تدوير · Shift/يمين: تحريك · عجلة: تكبير · ١-٧ مساقط · F ملاءمة';
    hud.append(cube, row2, statEl, hint);
    view.appendChild(hud);

    /* لوحة الشجرة */
    const side = document.createElement('div'); side.className = 'c3-side';
    const h = document.createElement('div'); h.className = 'c3-h';
    h.innerHTML = '<span>شجرة الميزات</span>';
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
        if (sidePinned) return;
        const w = pane.clientWidth;
        side.classList.toggle('hid', w < 520);
        syncSideBtn();
      });
      ro.observe(pane);
    }
  }

  let sideEl = null, sidePinned = false;
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
    document.querySelectorAll('#pane-cad .c3-slot.open').forEach(s => s.classList.remove('open'));
  }

  function renderTree() {
    if (!treeEl) return;
    const v = V();
    const sel = new Set(v.getSelection());
    const consumed = new Set();
    for (const f of feats) if (f.kind === 'boolean') f.src.forEach(id => consumed.add(id));

    if (!feats.length) {
      treeEl.innerHTML = `<div class="c3-empty">لا ميزات بعد.<br>ابدأ بمجسّم أوّليّ، أو حدّد شكلاً في
        لوحة الرسم ثم اضغط «بثق».</div>`;
      return;
    }
    treeEl.innerHTML = '';
    feats.forEach(f => {
      const row = document.createElement('div');
      row.className = 'c3-row' + (sel.has(f.id) ? ' on' : '') + (f.error ? ' bad' : '') +
                      (f.off ? ' off' : '');
      if (consumed.has(f.id)) row.style.cssText = 'opacity:.45';
      const kind = KINDS[f.kind] || {};
      row.innerHTML = ico(kind.icon || 'cube') +
        `<span class="n" title="${f.error || f.name}">${f.name}</span>` +
        `<span class="a" data-a="eye" title="إخفاء / إظهار">${f.off ? '◌' : '◉'}</span>` +
        `<span class="a" data-a="edit" title="تحرير المعاملات">✎</span>`;
      row.addEventListener('click', e => {
        const a = e.target.dataset && e.target.dataset.a;
        if (a === 'edit') { opEdit(f.id); return; }
        if (a === 'eye') { v.setSelection([f.id]); opToggleHide(); return; }
        v.setSelection([f.id]);
        renderTree(); updateInfo();
      });
      row.addEventListener('dblclick', () => opEdit(f.id));
      treeEl.appendChild(row);
    });
  }

  function updateInfo() {
    const v = V(), k = K();
    const sel = v.getSelection();
    if (statEl) {
      const shown = v.all().filter(m => m.visible).length;
      statEl.innerHTML = `<b>${feats.length}</b> ميزة · <b>${shown}</b> ظاهر` +
        (sel.length ? ` · <b>${sel.length}</b> محدَّد` : '');
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
    V().render(); renderTree();
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
    if (u) u.style.opacity = undoStack.length ? '1' : '.4';
    if (r) r.style.opacity = redoStack.length ? '1' : '.4';
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
      { t: 'تقطيع بمستوٍ', fn: OPS.split },
    ] });

    railGroup({ icon: 'duplicate', name: 'تكرار ومرآة', items: [
      { t: 'نسخة', icon: 'duplicate', fn: OPS.duplicate },
      { t: 'مرآة', icon: 'mirror-h', fn: OPS.mirror },
      { t: 'مصفوفة خطّية', icon: 'dist-h', fn: OPS.linear },
      { t: 'مصفوفة دائرية', icon: 'polar', fn: OPS.circular },
    ] });

    railGroup({ icon: 'wrench', name: 'تعديل المجسّم', items: [
      { t: 'تفريغ (قشرة)', fn: OPS.shell },
      { t: 'تسميك السطح', fn: OPS.offset },
      { t: 'غلاف محدّب', fn: OPS.hull },
      { t: 'تبسيط الشبكة', fn: OPS.decimate },
      { t: 'توسيط على الأصل', fn: OPS.center },
      { t: 'حذف', icon: 'trash', fn: opDelete },
    ] });

    railGroup({ icon: 'move', name: 'تحويل', items: [
      { t: 'نقل', icon: 'move', fn: () => setGizmo('move') },
      { t: 'تدوير', icon: 'rotate', fn: () => setGizmo('rotate') },
      { t: 'تحجيم', icon: 'scale', fn: () => setGizmo('scale') },
      { t: 'قيم دقيقة…', fn: opTransform },
    ] });

    railGroup({ icon: 'ruler', name: 'قياس', items: [
      { t: 'مسافة بين نقطتين', icon: 'ruler', fn: toggleMeasure },
      { t: 'المظروف والحجم', fn: opBBox },
    ] });

    railGroup({ icon: 'cpu', name: 'تصنيع CNC', items: [
      { t: 'مسار تخشين ثلاثيّ المحاور', icon: 'cpu', fn: opRoughing },
      { t: 'إسقاط الظلّ إلى الرسم', icon: 'shapes', fn: opProject2D },
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
      if (e.ctrlKey || e.altKey || e.metaKey) return;
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
