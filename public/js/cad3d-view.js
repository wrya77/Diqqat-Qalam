/**
 * cad3d-view.js — نافذة العرض ثلاثية الأبعاد بمعايير برامج الكاد
 *
 *  • تحكّم مداريّ مكتوب يدوياً (لا OrbitControls في النسخة المرفقة من Three)
 *  • كاميرتان: منظوريّة وإسقاطيّة متعامدة — الثانية هي وضع الكاد الحقيقيّ
 *  • سبعة مساقط قياسية + ملاءمة تلقائية
 *  • أوضاع الإظهار: مظلّل · مظلّل بحوافّ · هيكليّ · شفّاف
 *  • مستوى مقطع حيّ على أي محور (تقنية clippingPlanes)
 *  • انتقاء بالأشعّة مع إبراز، وقياس مسافة بين نقطتين على السطح
 *  • مقبض تحويل: نقل على المحاور · تدوير حول المحاور · تحجيم منتظم
 *
 *  اصطلاح: Z إلى الأعلى (كالكاد وCNC) لا Y كافتراض Three.
 */
(function cad3dView() {
  'use strict';

  const DEG = Math.PI / 180;

  let host = null, renderer = null, scene = null, solids = null, helpers = null;
  let camP = null, camO = null, cam = null, ortho = false;
  let need = false, raf = 0, sized = { w: 0, h: 0 };
  let clip = null, clipOn = false;
  let mode = 'shaded';
  let gizmo = null, gizmoMode = 'move', gizmoTarget = null;
  let measure = { on: false, pts: [], obj: null };
  const listeners = { select: [], change: [], measure: [] };

  /* حالة المدار: مسافة وزاويتان ومركز.
     المركز يُنشأ داخل mount لا هنا — Three يُحمَّل كسولاً، وأي استعمال له وقت
     تعريف الوحدة يُسقِط الملف كلّه بـReferenceError صامت. */
  const orb = { r: 320, th: 45 * DEG, ph: 55 * DEG, t: null };

  const emit = (k, v) => listeners[k].forEach(f => { try { f(v); } catch (_) {} });
  const on = (k, f) => { if (listeners[k]) listeners[k].push(f); };

  /**
   * @param now يرسم فوراً بدل انتظار الإطار التالي.
   * لازمٌ قبل قراءة اللوحة (لقطة/تصدير): requestAnimationFrame لا يُطلق إطلاقاً
   * حين تكون اللوحة مخفيّة، فتُقرأ ذاكرة رسمٍ فارغة.
   */
  function requestRender(now) {
    if (now) { cancelAnimationFrame(raf); need = false; draw(); return; }
    if (need) return;
    need = true;
    raf = requestAnimationFrame(() => { need = false; draw(); });
  }

  /* ══════════════ الإنشاء ══════════════ */

  function mount(container) {
    if (renderer) { if (container && container !== host) { host = container; host.appendChild(renderer.domElement); resize(); } return true; }
    if (typeof THREE === 'undefined') return false;
    host = container;
    orb.t = new THREE.Vector3(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.localClippingEnabled = true;
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none';
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1016);
    solids  = new THREE.Group(); scene.add(solids);
    helpers = new THREE.Group(); scene.add(helpers);

    // إضاءة استوديو من ثلاثة اتجاهات — تُظهر الحوافّ بلا مبالغة
    scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x1b2430, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(1, -1.2, 1.6);
    const fill = new THREE.DirectionalLight(0xbcd4ef, 0.35); fill.position.set(-1.4, 0.8, 0.5);
    const rim = new THREE.DirectionalLight(0xffffff, 0.25); rim.position.set(0.2, 1.4, -1);
    scene.add(key, fill, rim);

    camP = new THREE.PerspectiveCamera(45, 1, 0.05, 200000);
    camO = new THREE.OrthographicCamera(-100, 100, 100, -100, -100000, 200000);
    camP.up.set(0, 0, 1); camO.up.set(0, 0, 1);
    cam = camP;

    buildHelpers();
    buildGizmo();
    bind();
    resize();
    updateCam();
    return true;
  }

  function buildHelpers() {
    const grid = new THREE.GridHelper(400, 40, 0x2b3a4d, 0x18222e);
    grid.rotation.x = Math.PI / 2;                     // إلى مستوى XY لأن Z للأعلى
    grid.name = 'grid';
    helpers.add(grid);

    const ax = new THREE.Group(); ax.name = 'axes';
    const mkAxis = (v, c) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), v]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color: c }));
    };
    ax.add(mkAxis(new THREE.Vector3(60, 0, 0), 0xff5f56));
    ax.add(mkAxis(new THREE.Vector3(0, 60, 0), 0x5ad469));
    ax.add(mkAxis(new THREE.Vector3(0, 0, 60), 0x4ea1ff));
    helpers.add(ax);
  }

  /* ══════════════ المواد وأوضاع الإظهار ══════════════ */

  const MAT = () => new THREE.MeshStandardMaterial({
    color: 0x9fb3c8, metalness: 0.15, roughness: 0.55,
    side: THREE.DoubleSide, flatShading: false,
  });

  function applyMode(m) {
    mode = m || 'shaded';
    solids.children.forEach(o => {
      const mat = o.material;
      if (!mat) return;
      mat.wireframe = (mode === 'wire');
      mat.transparent = (mode === 'xray');
      mat.opacity = (mode === 'xray') ? 0.32 : 1;
      mat.depthWrite = (mode !== 'xray');
      const e = o.userData.edges;
      if (e) e.visible = (mode === 'shaded-edges' || mode === 'wire');
      mat.needsUpdate = true;
    });
    requestRender();
  }

  /* ══════════════ إدارة المجسّمات ══════════════ */

  function addSolid(geometry, meta) {
    const mat = MAT();
    if (meta && meta.color != null) mat.color.setHex(meta.color);
    if (clipOn && clip) mat.clippingPlanes = [clip];
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.userData = Object.assign({ id: (meta && meta.id) || ('s' + Date.now().toString(36)) }, meta || {});

    const eg = new THREE.EdgesGeometry(geometry, 24);
    const edges = new THREE.LineSegments(eg,
      new THREE.LineBasicMaterial({ color: 0x0c1219, transparent: true, opacity: 0.55 }));
    edges.visible = (mode === 'shaded-edges');
    if (clipOn && clip) edges.material.clippingPlanes = [clip];
    mesh.add(edges);
    mesh.userData.edges = edges;

    solids.add(mesh);
    applyMode(mode);
    requestRender();
    return mesh;
  }

  const byId = id => solids.children.find(o => o.userData.id === id) || null;

  function removeSolid(id) {
    const m = byId(id);
    if (!m) return false;
    disposeMesh(m);
    solids.remove(m);
    if (gizmoTarget === m) attachGizmo(null);
    requestRender();
    return true;
  }

  function disposeMesh(m) {
    m.geometry?.dispose?.();
    m.material?.dispose?.();
    const e = m.userData.edges;
    if (e) { e.geometry?.dispose?.(); e.material?.dispose?.(); }
  }

  function clearSolids() {
    solids.children.slice().forEach(m => { disposeMesh(m); solids.remove(m); });
    attachGizmo(null);
    requestRender();
  }

  function replaceGeometry(id, geometry) {
    const m = byId(id);
    if (!m) return false;
    m.geometry.dispose();
    m.geometry = geometry;
    const e = m.userData.edges;
    if (e) { e.geometry.dispose(); e.geometry = new THREE.EdgesGeometry(geometry, 24); }
    requestRender();
    return true;
  }

  /* ══════════════ الانتقاء ══════════════ */

  let selected = new Set();

  function setSelection(ids) {
    selected = new Set(ids || []);
    solids.children.forEach(m => {
      const on = selected.has(m.userData.id);
      m.material.emissive.setHex(on ? 0x1d4a7a : 0x000000);
      const e = m.userData.edges;
      if (e) e.material.color.setHex(on ? 0x58a6ff : 0x0c1219);
    });
    const first = selected.size === 1 ? byId([...selected][0]) : null;
    attachGizmo(first);
    requestRender();
    // الإطلاق من هنا لا من معالج النقر وحده — وإلّا بقيت الشجرة غير محدَّثة
    // حين يأتي التحديد من الواجهة البرمجية أو من إعادة البناء
    emit('select', getSelection());
  }
  const getSelection = () => [...selected];

  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    const nd = new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(nd, cam);
    // الحوافّ أبناءُ الشبكات، فنمنع التقاطها بالتقاطع غير المتعمّق
    const hits = ray.intersectObjects(solids.children, false);
    return hits.length ? hits[0] : null;
  }

  /* ══════════════ التحكّم المداريّ ══════════════ */

  function bind() {
    const el = renderer.domElement;
    let drag = null;

    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('mousedown', e => {
      el.focus();
      if (gizmo && gizmo.visible && e.button === 0 && gizmoDown(e)) return;
      if (measure.on && e.button === 0) { measureClick(e); return; }
      const pan = e.button === 1 || e.button === 2 || e.shiftKey;
      drag = { x: e.clientX, y: e.clientY, pan, moved: false, btn: e.button };
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (gizmoMove(e)) return;
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) panBy(dx, dy); else orbitBy(dx, dy);
    });
    window.addEventListener('mouseup', e => {
      if (gizmoUp()) { drag = null; return; }
      if (drag && !drag.moved && drag.btn === 0 && !measure.on) {
        const h = pick(e);
        if (h) {
          const id = h.object.userData.id;
          if (e.ctrlKey || e.metaKey) {
            const s = new Set(selected);
            s.has(id) ? s.delete(id) : s.add(id);
            setSelection([...s]);
          } else setSelection([id]);
        } else setSelection([]);
      }
      drag = null;
    });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    el.addEventListener('dblclick', e => {
      const h = pick(e);
      if (h) { orb.t.copy(h.point); updateCam(); }      // تدوير حول ما نقرتَه
    });

    el.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      const views = { '1': 'front', '2': 'back', '3': 'left', '4': 'right', '5': 'top', '6': 'bottom', '7': 'iso' };
      if (views[e.key]) { setView(views[e.key]); e.preventDefault(); return; }
      if (k === 'f') { fit(); e.preventDefault(); }
      if (k === 'o') { setOrtho(!ortho); e.preventDefault(); }
    });

    window.addEventListener('resize', () => resize());
    // اللوحة قد تُفتح وهي مخفيّة (٠×٠) فلا يصلها أي حدث حين تظهر — المراقب
    // يلتقط ظهورها وتغيّر عرض العمود معاً، وهو الضمانة الوحيدة الموثوقة
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => resize());
      ro.observe(host);
    }
  }

  function orbitBy(dx, dy) {
    orb.th -= dx * 0.0075;
    orb.ph = Math.max(0.02, Math.min(Math.PI - 0.02, orb.ph - dy * 0.0075));
    updateCam();
  }

  function panBy(dx, dy) {
    const r = renderer.domElement.getBoundingClientRect();
    // مقدار الإزاحة بوحدات العالم عند مستوى الهدف
    const k = ortho
      ? (camO.top - camO.bottom) / camO.zoom / r.height
      : 2 * orb.r * Math.tan(camP.fov * DEG / 2) / r.height;
    const right = new THREE.Vector3(), up = new THREE.Vector3();
    cam.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    orb.t.addScaledVector(right, -dx * k);
    orb.t.addScaledVector(up, dy * k);
    updateCam();
  }

  function zoomBy(f) {
    orb.r = Math.max(1, Math.min(200000, orb.r * f));
    updateCam();
  }

  function updateCam() {
    const s = Math.sin(orb.ph), c = Math.cos(orb.ph);
    const p = new THREE.Vector3(
      orb.t.x + orb.r * s * Math.cos(orb.th),
      orb.t.y + orb.r * s * Math.sin(orb.th),
      orb.t.z + orb.r * c);
    camP.position.copy(p); camP.lookAt(orb.t);
    camO.position.copy(p); camO.lookAt(orb.t);
    const r = sized.h ? sized.w / sized.h : 1;
    const half = orb.r * 0.55;
    camO.left = -half * r; camO.right = half * r; camO.top = half; camO.bottom = -half;
    camO.updateProjectionMatrix();
    camP.updateProjectionMatrix();
    updateGizmoScale();
    requestRender();
    emit('change', null);
  }

  function setOrtho(v) {
    ortho = !!v;
    cam = ortho ? camO : camP;
    updateCam();
  }

  const VIEWS = {
    top:    [0, 0.001], bottom: [0, Math.PI - 0.001],
    front:  [-Math.PI / 2, Math.PI / 2], back: [Math.PI / 2, Math.PI / 2],
    right:  [0, Math.PI / 2], left: [Math.PI, Math.PI / 2],
    iso:    [45 * DEG, 55 * DEG],
  };

  function setView(name) {
    const v = VIEWS[name];
    if (!v) return;
    orb.th = v[0]; orb.ph = v[1];
    updateCam();
  }

  function fit(pad) {
    const box = new THREE.Box3();
    let any = false;
    solids.children.forEach(m => { box.expandByObject(m); any = true; });
    if (!any) { orb.t.set(0, 0, 0); orb.r = 320; updateCam(); return; }
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z) || 40;
    orb.t.copy(c);
    orb.r = d * (pad || 2.1);
    updateCam();
  }

  function resize() {
    if (!renderer || !host) return;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    if (w === sized.w && h === sized.h) return;
    sized = { w, h };
    renderer.setSize(w, h, false);
    camP.aspect = w / h;
    updateCam();
  }

  /* ══════════════ مستوى المقطع ══════════════ */

  function setSection(opt) {
    if (!opt || !opt.on) {
      clipOn = false;
      solids.children.forEach(m => {
        m.material.clippingPlanes = null;
        if (m.userData.edges) m.userData.edges.material.clippingPlanes = null;
      });
      requestRender();
      return;
    }
    const n = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[opt.axis || 'z'];
    const dir = opt.flip ? n.clone().negate() : n.clone();
    clip = new THREE.Plane(dir, -(opt.offset || 0) * (opt.flip ? -1 : 1));
    clipOn = true;
    solids.children.forEach(m => {
      m.material.clippingPlanes = [clip];
      if (m.userData.edges) m.userData.edges.material.clippingPlanes = [clip];
    });
    requestRender();
  }

  /* ══════════════ القياس ══════════════ */

  function setMeasure(on2) {
    measure.on = !!on2;
    measure.pts = [];
    clearMeasure();
    renderer.domElement.style.cursor = measure.on ? 'crosshair' : '';
    requestRender();
  }

  function clearMeasure() {
    if (measure.obj) { helpers.remove(measure.obj); measure.obj = null; }
  }

  function measureClick(ev) {
    const h = pick(ev);
    if (!h) return;
    measure.pts.push(h.point.clone());
    if (measure.pts.length === 2) {
      const [a, b] = measure.pts;
      clearMeasure();
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      measure.obj = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffcc55 }));
      helpers.add(measure.obj);
      const d = a.distanceTo(b);
      emit('measure', { a, b, d,
        dx: Math.abs(b.x - a.x), dy: Math.abs(b.y - a.y), dz: Math.abs(b.z - a.z) });
      measure.pts = [];
    }
    requestRender();
  }

  /* ══════════════ مقبض التحويل ══════════════ */

  function buildGizmo() {
    gizmo = new THREE.Group();
    gizmo.visible = false;
    gizmo.renderOrder = 999;
    helpers.add(gizmo);
    rebuildGizmo();
  }

  function rebuildGizmo() {
    gizmo.children.slice().forEach(c => {
      c.geometry?.dispose?.(); c.material?.dispose?.(); gizmo.remove(c);
    });
    const AX = [
      { k: 'x', c: 0xff5f56, v: new THREE.Vector3(1, 0, 0) },
      { k: 'y', c: 0x5ad469, v: new THREE.Vector3(0, 1, 0) },
      { k: 'z', c: 0x4ea1ff, v: new THREE.Vector3(0, 0, 1) },
    ];
    const M = c => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 });
    if (gizmoMode === 'move') {
      for (const a of AX) {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 22, 10), M(a.c));
        shaft.position.copy(a.v).multiplyScalar(11);
        orientTo(shaft, a.v);
        shaft.userData.axis = a.k;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(2, 6, 12), M(a.c));
        tip.position.copy(a.v).multiplyScalar(25);
        orientTo(tip, a.v);
        tip.userData.axis = a.k;
        gizmo.add(shaft, tip);
      }
    } else if (gizmoMode === 'rotate') {
      for (const a of AX) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(20, 0.7, 8, 48), M(a.c));
        if (a.k === 'x') ring.rotation.y = Math.PI / 2;
        if (a.k === 'y') ring.rotation.x = Math.PI / 2;
        ring.userData.axis = a.k;
        gizmo.add(ring);
      }
    } else {
      for (const a of AX) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 20, 8), M(a.c));
        bar.position.copy(a.v).multiplyScalar(10);
        orientTo(bar, a.v);
        bar.userData.axis = a.k;
        const cube = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 3.4), M(a.c));
        cube.position.copy(a.v).multiplyScalar(21);
        cube.userData.axis = a.k;
        gizmo.add(bar, cube);
      }
      const c = new THREE.Mesh(new THREE.BoxGeometry(4.4, 4.4, 4.4), M(0xffffff));
      c.userData.axis = 'all';
      gizmo.add(c);
    }
    updateGizmoScale();
    requestRender();
  }

  function orientTo(mesh, v) {
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
  }

  function setGizmoMode(m) {
    gizmoMode = m;
    rebuildGizmo();
  }

  function attachGizmo(mesh) {
    gizmoTarget = mesh || null;
    gizmo.visible = !!mesh;
    if (mesh) {
      const b = new THREE.Box3().setFromObject(mesh);
      gizmo.position.copy(b.getCenter(new THREE.Vector3()));
    }
    updateGizmoScale();
    requestRender();
  }

  /** المقبض بحجم ثابت على الشاشة مهما بعُدت الكاميرا — شرط قابلية الإمساك */
  function updateGizmoScale() {
    if (!gizmo || !gizmo.visible || !cam) return;
    const s = ortho ? orb.r / 260 : gizmo.position.distanceTo(cam.position) / 260;
    gizmo.scale.setScalar(Math.max(0.05, s) * 1.6);
  }

  let gdrag = null;

  function gizmoDown(ev) {
    if (!gizmo.visible || !gizmoTarget) return false;
    const r = renderer.domElement.getBoundingClientRect();
    const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1,
                                -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 3 };
    ray.setFromCamera(nd, cam);
    const hits = ray.intersectObjects(gizmo.children, false);
    if (!hits.length) return false;
    const axis = hits[0].object.userData.axis;
    const dir = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0),
                  z: new THREE.Vector3(0, 0, 1), all: new THREE.Vector3(1, 1, 1) }[axis];
    // مستوى الإسقاط: يحوي المحور ويواجه الكاميرا قدر الإمكان
    const camDir = new THREE.Vector3(); cam.getWorldDirection(camDir);
    const n = axis === 'all' ? camDir.clone().negate()
            : dir.clone().cross(camDir).cross(dir).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, gizmo.position.clone());
    const p0 = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, p0)) return false;
    gdrag = { axis, dir, plane, p0, start: gizmoTarget.position.clone(),
              rot: gizmoTarget.rotation.clone(), scl: gizmoTarget.scale.clone(),
              gizmo0: gizmo.position.clone() };
    ev.preventDefault();
    return true;
  }

  function gizmoMove(ev) {
    if (!gdrag) return false;
    const r = renderer.domElement.getBoundingClientRect();
    const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1,
                                -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(nd, cam);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(gdrag.plane, p)) return true;
    const d = p.clone().sub(gdrag.p0);

    if (gizmoMode === 'move') {
      const amt = gdrag.axis === 'all' ? d : gdrag.dir.clone().multiplyScalar(d.dot(gdrag.dir));
      gizmoTarget.position.copy(gdrag.start.clone().add(amt));
      gizmo.position.copy(gdrag.gizmo0.clone().add(amt));
    } else if (gizmoMode === 'rotate') {
      const c = gdrag.gizmo0;
      const a0 = gdrag.p0.clone().sub(c), a1 = p.clone().sub(c);
      const ang = Math.atan2(a0.clone().cross(a1).dot(gdrag.dir), a0.dot(a1));
      const e = gdrag.rot.clone();
      e[gdrag.axis] = gdrag.rot[gdrag.axis] + ang;
      gizmoTarget.rotation.set(e.x, e.y, e.z);
    } else {
      const len0 = gdrag.p0.distanceTo(gdrag.gizmo0) || 1;
      const k = Math.max(0.02, p.distanceTo(gdrag.gizmo0) / len0);
      if (gdrag.axis === 'all') gizmoTarget.scale.copy(gdrag.scl.clone().multiplyScalar(k));
      else {
        const s = gdrag.scl.clone();
        s[gdrag.axis] = gdrag.scl[gdrag.axis] * k;
        gizmoTarget.scale.copy(s);
      }
    }
    gizmoTarget.updateMatrixWorld();
    requestRender();
    return true;
  }

  function gizmoUp() {
    if (!gdrag) return false;
    gdrag = null;
    if (gizmoTarget) emit('change', { id: gizmoTarget.userData.id, transform: true });
    return true;
  }

  /* ══════════════ الرسم ══════════════ */

  function draw() {
    if (!renderer) return;
    resize();
    renderer.render(scene, cam);
  }

  function unmount() {
    if (!renderer) return;
    cancelAnimationFrame(raf);
    clearSolids();
    renderer.dispose();
    renderer.domElement.remove();
    renderer = null; scene = null; host = null; sized = { w: 0, h: 0 };
  }

  const snapshot = () => {
    if (!renderer) return null;
    draw();                                   // إطار طازج قبل القراءة
    return renderer.domElement.toDataURL('image/png');
  };

  window.CAD3DView = {
    mount, unmount, resize, render: requestRender, snapshot,
    addSolid, removeSolid, clearSolids, replaceGeometry,
    get: byId, all: () => solids ? solids.children.slice() : [],
    setSelection, getSelection,
    setView, fit, setOrtho, isOrtho: () => ortho,
    setMode, mode: () => mode,
    setSection, setMeasure, setGizmoMode, gizmoMode: () => gizmoMode,
    showGrid: v => { const g = helpers.getObjectByName('grid'); if (g) g.visible = v; requestRender(); },
    showAxes: v => { const a = helpers.getObjectByName('axes'); if (a) a.visible = v; requestRender(); },
    camera: () => cam, scene: () => scene, on,
    ready: () => !!renderer,
  };
  function setMode(m) { applyMode(m); }
})();
