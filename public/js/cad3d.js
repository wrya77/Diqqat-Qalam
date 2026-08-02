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
  let host = null, treeEl = null, infoEl = null;

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
    for (const f of feats) if (f.kind === 'boolean') f.src.forEach(id => consumed.add(id));

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
      #pane-cad3d{display:flex;flex-direction:column;min-height:0;overflow:hidden}
      .c3-bar{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:3px;padding:5px 6px;
        background:var(--bg1,#0d1117);border-bottom:1px solid var(--border,#30363d)}
      .c3-sep{width:1px;align-self:stretch;background:var(--border,#30363d);margin:2px 3px}
      .c3-b{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:6px;
        border:1px solid transparent;background:none;cursor:pointer;color:var(--text2,#b1bac4);
        font-family:inherit;font-size:11.5px;font-weight:600;white-space:nowrap;
        transition:background .14s ease,color .14s ease,border-color .14s ease}
      .c3-b:hover{background:var(--bg3,#1c2128);color:var(--text,#e6edf3)}
      .c3-b.on{background:color-mix(in srgb,var(--accent,#2f81f7) 18%,transparent);
        border-color:var(--accent,#2f81f7);color:var(--accent-h,#58a6ff)}
      .c3-b svg{width:13px;height:13px}
      .c3-main{flex:1 1 auto;min-height:0;display:flex}
      .c3-view{flex:1 1 auto;min-width:0;position:relative;background:#0b1016}
      .c3-side{flex:0 0 190px;display:flex;flex-direction:column;min-height:0;
        background:var(--bg2,#161b22);border-inline-start:1px solid var(--border,#30363d)}
      .c3-h{flex:0 0 auto;padding:6px 9px;font-size:11px;font-weight:700;color:var(--text3,#8b949e);
        border-bottom:1px solid var(--border,#30363d)}
      .c3-tree{flex:1 1 auto;overflow-y:auto;padding:4px}
      .c3-row{display:flex;align-items:center;gap:5px;padding:5px 7px;border-radius:6px;
        cursor:pointer;font-size:12px;color:var(--text2,#b1bac4);
        transition:background .12s ease,color .12s ease}
      .c3-row:hover{background:var(--bg3,#1c2128)}
      .c3-row.on{background:color-mix(in srgb,var(--accent,#2f81f7) 20%,transparent);
        color:var(--accent-h,#58a6ff)}
      .c3-row.bad{color:#f85149}
      .c3-row .n{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .c3-row .e{flex:0 0 auto;width:18px;text-align:center;opacity:.6}
      .c3-row .e:hover{opacity:1}
      .c3-info{flex:0 0 auto;padding:7px 9px;font-size:11px;line-height:1.75;
        color:var(--text3,#8b949e);border-top:1px solid var(--border,#30363d)}
      .c3-info b{color:var(--text2,#b1bac4);font-weight:600}
      .c3-empty{padding:14px 10px;font-size:11.5px;color:var(--text3,#8b949e);line-height:1.8}
      @media (max-width:900px){.c3-side{flex-basis:150px}}
    `;
    document.head.appendChild(s);
  }

  const ico = n => { try { return window.DQIcon ? window.DQIcon(n) : ''; } catch (_) { return ''; } };

  function buildUI(pane) {
    injectCSS();
    pane.innerHTML = '';

    const bar = document.createElement('div');
    bar.className = 'c3-bar';
    const grp = (items) => {
      items.forEach(it => {
        if (it === '|') { const s = document.createElement('span'); s.className = 'c3-sep'; bar.appendChild(s); return; }
        const b = document.createElement('button');
        b.className = 'c3-b'; b.type = 'button';
        b.innerHTML = (it.icon ? ico(it.icon) : '') + `<span>${it.t}</span>`;
        b.title = it.title || it.t;
        if (it.id) b.id = it.id;
        b.addEventListener('click', it.fn);
        bar.appendChild(b);
      });
    };

    grp([
      { t: 'صندوق', icon: 'cube', fn: () => opPrimitive('box') },
      { t: 'أسطوانة', fn: () => opPrimitive('cylinder') },
      { t: 'كرة', fn: () => opPrimitive('sphere') },
      { t: 'مخروط', fn: () => opPrimitive('cone') },
      { t: 'أنبوب', fn: () => opPrimitive('tube') },
      { t: 'حلقة', fn: () => opPrimitive('torus') },
      '|',
      { t: 'بثق', icon: 'arrow-up', title: 'بثق الشكل المحدَّد في لوحة الرسم', fn: opExtrude },
      { t: 'تدوير', icon: 'rotate', fn: opRevolve },
      { t: 'كنس', fn: opSweep },
      { t: 'تجسير', fn: opLoft },
      '|',
      { t: 'اتحاد', fn: () => opBoolean('uni') },
      { t: 'طرح', fn: () => opBoolean('sub') },
      { t: 'تقاطع', fn: () => opBoolean('int') },
      '|',
      { t: 'نقل', id: 'c3-gz-move', fn: () => setGizmo('move') },
      { t: 'تدوير·', id: 'c3-gz-rotate', fn: () => setGizmo('rotate') },
      { t: 'تحجيم', id: 'c3-gz-scale', fn: () => setGizmo('scale') },
      { t: 'دقيق…', fn: opTransform },
      { t: 'حذف', icon: 'trash', fn: opDelete },
      '|',
      { t: 'ملاءمة', icon: 'fit-view', fn: () => V().fit() },
      { t: 'مجسّم', id: 'c3-ortho', title: 'تبديل بين الإسقاط المتعامد والمنظور', fn: toggleOrtho },
      { t: 'مظلّل', id: 'c3-mode', title: 'وضع الإظهار', fn: cycleMode },
      { t: 'مقطع', id: 'c3-sec', fn: toggleSection },
      { t: 'قياس', id: 'c3-meas', fn: toggleMeasure },
      '|',
      { t: 'STL', icon: 'download', title: 'تصدير STL', fn: opExportSTL },
      { t: 'OBJ', fn: opExportOBJ },
      { t: 'استيراد', fn: opImportSTL },
    ]);

    const main = document.createElement('div'); main.className = 'c3-main';
    const view = document.createElement('div'); view.className = 'c3-view'; view.id = 'c3-view';
    const side = document.createElement('div'); side.className = 'c3-side';
    const h = document.createElement('div'); h.className = 'c3-h'; h.textContent = 'شجرة الميزات';
    treeEl = document.createElement('div'); treeEl.className = 'c3-tree';
    infoEl = document.createElement('div'); infoEl.className = 'c3-info';
    side.append(h, treeEl, infoEl);
    main.append(view, side);
    pane.append(bar, main);
    host = view;

    // المساقط القياسية شريطٌ سفليّ صغير
    const vbar = document.createElement('div');
    vbar.className = 'c3-bar';
    vbar.style.borderTop = '1px solid var(--border,#30363d)';
    vbar.style.borderBottom = 'none';
    const views = [['أعلى', 'top'], ['أسفل', 'bottom'], ['أمام', 'front'], ['خلف', 'back'],
                   ['يمين', 'right'], ['يسار', 'left'], ['متساوي', 'iso']];
    views.forEach(([t, v]) => {
      const b = document.createElement('button');
      b.className = 'c3-b'; b.type = 'button'; b.textContent = t;
      b.addEventListener('click', () => V().setView(v));
      vbar.appendChild(b);
    });
    const hint = document.createElement('span');
    hint.style.cssText = 'margin-inline-start:auto;font-size:10.5px;color:var(--text3,#8b949e);align-self:center';
    hint.textContent = 'سحب: تدوير · Shift+سحب أو يمين: تحريك · عجلة: تكبير · نقر مزدوج: مركز التدوير · ١-٧ مساقط · F ملاءمة';
    vbar.appendChild(hint);
    pane.appendChild(vbar);
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
      row.className = 'c3-row' + (sel.has(f.id) ? ' on' : '') + (f.error ? ' bad' : '');
      const dim = consumed.has(f.id) ? ';opacity:.45' : '';
      row.style.cssText = dim;
      row.innerHTML = `<span class="n" title="${f.error || f.name}">${f.name}</span>
        <span class="e" title="تحرير المعاملات">✎</span>`;
      row.addEventListener('click', e => {
        if (e.target.classList.contains('e')) { opEdit(f.id); return; }
        v.setSelection([f.id]);
        renderTree(); updateInfo();
      });
      treeEl.appendChild(row);
    });
  }

  function updateInfo() {
    if (!infoEl) return;
    const v = V(), k = K();
    const sel = v.getSelection();
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
    const b = document.getElementById('c3-ortho');
    if (b) { b.classList.toggle('on', n); b.querySelector('span').textContent = n ? 'متعامد' : 'مجسّم'; }
  }
  const MODES = [['shaded', 'مظلّل'], ['shaded-edges', 'بحوافّ'], ['wire', 'هيكليّ'], ['xray', 'شفّاف']];
  function cycleMode() {
    const v = V();
    const i = MODES.findIndex(m => m[0] === v.mode());
    const nx = MODES[(i + 1) % MODES.length];
    v.setMode(nx[0]);
    const b = document.getElementById('c3-mode');
    if (b) b.querySelector('span').textContent = nx[1];
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

  /* ══════════════ الإقلاع ══════════════ */

  async function open() {
    const pane = document.getElementById('pane-cad3d');
    if (!pane) return;
    if (!booted) {
      const ok = await ensureThree();
      if (!ok) { pane.innerHTML = '<div class="c3-empty">تعذّر تحميل محرّك العرض ثلاثيّ الأبعاد.</div>'; return; }
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
      booted = true;
      renderTree(); updateInfo();
    }
    requestAnimationFrame(() => { V().resize(); V().render(); });
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
    if (needOpen) W.open('output', {
      zone: 'left',
      w: Math.round(Math.min(860, Math.max(520, window.innerWidth * 0.5))),
    });
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
