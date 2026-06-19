/**
 * simulator-three.js — عرض ثلاثي الأبعاد لمسار الأداة (Three.js)
 *
 * - يحمّل Three.js من CDN عند أول استخدام فقط (lazy)
 * - يحلل G-Code إلى مقاطع (rapid / cut / arc) بإحداثيات X,Y,Z حقيقية
 * - تدوير بالسحب، تكبير بالعجلة، تحريك بالسحب الأيمن
 * - تشغيل متحرك يرسم المسار تدريجياً مع مؤشر الأداة
 */
const Toolpath3D = (() => {
  'use strict';

  const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';

  let _loaded = false, _loading = null;
  let scene, camera, renderer, raf = null;
  let wrap, canvasHost;
  let pathGeom = null, pathObj = null, toolMesh = null;
  let segments = [];          // [{x0,y0,z0,x1,y1,z1,kind}]
  let visible = 0;            // عدد المقاطع المرسومة (للتشغيل المتحرك)
  let playing = false;
  let bounds = null;
  let interacting = false;    // أثناء السحب/التكبير — نُبقي الحلقة حيّة
  let needsRender = false;    // علم «أعد الرسم» — رسمٌ عند الطلب بدل حلقة دائمة

  // اطلب إطاراً واحداً وأيقظ الحلقة إن كانت نائمة — يمنع تشغيل rAF بلا داعٍ
  function requestRender() {
    needsRender = true;
    if (!raf && renderer) raf = requestAnimationFrame(loop);
  }

  // كرة مدارية بسيطة بدل OrbitControls
  const orbit = { theta: -Math.PI / 4, phi: Math.PI / 4, radius: 220, target: { x: 0, y: 0, z: 0 } };

  const COLORS = { rapid: 0xf85149, cut: 0x3fb950, arc: 0x79c0ff };

  /* ── تحميل Three.js عند الطلب ── */
  function loadThree() {
    if (_loaded) return Promise.resolve();
    if (_loading) return _loading;
    _loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = THREE_CDN;
      s.onload  = () => { _loaded = true; resolve(); };
      s.onerror = () => reject(new Error('تعذر تحميل Three.js'));
      document.head.appendChild(s);
    });
    return _loading;
  }

  /* ── محلل G-Code مصغّر → مقاطع ثلاثية ── */
  function parseGCode(text) {
    const segs = [];
    let x = 0, y = 0, z = 5, mode = 0;
    const lines = (text || '').split('\n');

    for (let raw of lines) {
      const line = raw.split(';')[0].replace(/\([^)]*\)/g, '').trim().toUpperCase();
      if (!line) continue;

      const g = line.match(/G0*([0123])\b/);
      if (g) mode = parseInt(g[1]);
      if (!/[XYZIJ]/.test(line) && !g) continue;

      const val = (axis) => {
        const m = line.match(new RegExp(axis + '(-?\\d*\\.?\\d+)'));
        return m ? parseFloat(m[1]) : null;
      };

      const nx = val('X') ?? x, ny = val('Y') ?? y, nz = val('Z') ?? z;

      if ((mode === 2 || mode === 3) && (val('I') !== null || val('J') !== null)) {
        // قوس: تقسيمه لمقاطع مستقيمة
        const i = val('I') || 0, j = val('J') || 0;
        const cx = x + i, cy = y + j;
        const r  = Math.hypot(i, j);
        let a0 = Math.atan2(y - cy, x - cx);
        let a1 = Math.atan2(ny - cy, nx - cx);
        if (mode === 2) { if (a1 >= a0) a1 -= 2 * Math.PI; }   // CW
        else            { if (a1 <= a0) a1 += 2 * Math.PI; }   // CCW
        const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) * r / 0.8));
        let px = x, py = y;
        for (let s = 1; s <= steps; s++) {
          const a  = a0 + (a1 - a0) * (s / steps);
          const qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
          const qz = z + (nz - z) * (s / steps);
          segs.push({ x0: px, y0: py, z0: z, x1: qx, y1: qy, z1: qz, kind: 'arc' });
          px = qx; py = qy;
        }
      } else if (nx !== x || ny !== y || nz !== z) {
        segs.push({ x0: x, y0: y, z0: z, x1: nx, y1: ny, z1: nz, kind: mode === 0 ? 'rapid' : 'cut' });
      }
      x = nx; y = ny; z = nz;
    }
    return segs;
  }

  /* ── بناء المشهد ── */
  function buildScene() {
    const w = wrap.clientWidth || 600, h = wrap.clientHeight || 400;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e14);

    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100000);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvasHost.innerHTML = '';
    canvasHost.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(400, 40, 0x21262d, 0x161b22);
    grid.rotation.x = Math.PI / 2;   // مستوى XY (Z للأعلى كما في CNC)
    scene.add(grid);

    const axes = new THREE.AxesHelper(40);
    scene.add(axes);

    // مؤشر الأداة
    toolMesh = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 6, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    toolMesh.rotation.x = Math.PI / 2;  // رأس المخروط للأسفل باتجاه -Z
    scene.add(toolMesh);

    bindInteraction();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!renderer || !wrap || wrap.style.display === 'none') return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    requestRender();
  }

  /* ── تفاعل: تدوير / تكبير / تحريك ── */
  function bindInteraction() {
    const el = renderer.domElement;
    let drag = null;

    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('mousedown', e => {
      drag = { x: e.clientX, y: e.clientY, btn: e.button,
               theta: orbit.theta, phi: orbit.phi,
               tx: orbit.target.x, ty: orbit.target.y };
      interacting = true;
      requestRender();
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.btn === 2) {           // سحب أيمن = تحريك
        const k = orbit.radius / 600;
        orbit.target.x = drag.tx - dx * k;
        orbit.target.y = drag.ty + dy * k;
      } else {                         // سحب أيسر = تدوير
        orbit.theta = drag.theta - dx * 0.008;
        orbit.phi   = Math.min(Math.PI - 0.05, Math.max(0.05, drag.phi - dy * 0.008));
      }
      requestRender();
    });
    window.addEventListener('mouseup', () => { drag = null; interacting = false; requestRender(); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      orbit.radius *= e.deltaY > 0 ? 1.12 : 0.89;
      orbit.radius = Math.max(10, Math.min(50000, orbit.radius));
      requestRender();
    }, { passive: false });
  }

  function updateCamera() {
    const { theta, phi, radius, target } = orbit;
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.sin(phi) * Math.sin(theta),
      target.z + radius * Math.cos(phi)
    );
    camera.up.set(0, 0, 1);            // Z للأعلى
    camera.lookAt(target.x, target.y, target.z);
  }

  /* ── بناء هندسة المسار ── */
  function buildPath() {
    if (pathObj) { scene.remove(pathObj); pathGeom.dispose(); pathObj.material.dispose(); }

    const positions = new Float32Array(segments.length * 6);
    const colors    = new Float32Array(segments.length * 6);
    const c = new THREE.Color();

    segments.forEach((s, i) => {
      positions.set([s.x0, s.y0, s.z0, s.x1, s.y1, s.z1], i * 6);
      c.setHex(COLORS[s.kind] || COLORS.cut);
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    });

    pathGeom = new THREE.BufferGeometry();
    pathGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pathGeom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    pathGeom.setDrawRange(0, 0);

    pathObj = new THREE.LineSegments(pathGeom,
      new THREE.LineBasicMaterial({ vertexColors: true }));
    scene.add(pathObj);

    // الحدود + ملاءمة الكاميرا
    bounds = null;
    segments.forEach(s => {
      if (!bounds) bounds = { minX: s.x0, maxX: s.x0, minY: s.y0, maxY: s.y0 };
      bounds.minX = Math.min(bounds.minX, s.x0, s.x1);
      bounds.maxX = Math.max(bounds.maxX, s.x0, s.x1);
      bounds.minY = Math.min(bounds.minY, s.y0, s.y1);
      bounds.maxY = Math.max(bounds.maxY, s.y0, s.y1);
    });
    fit();
  }

  function fit() {
    if (!bounds) return;
    orbit.target.x = (bounds.minX + bounds.maxX) / 2;
    orbit.target.y = (bounds.minY + bounds.maxY) / 2;
    orbit.target.z = 0;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 20);
    orbit.radius = span * 1.6;
    orbit.theta  = -Math.PI / 4;
    orbit.phi    = Math.PI / 4;
  }

  /* ── حلقة الرسم — تعمل عند الطلب فقط (تشغيل/تفاعل) ثم تنام ── */
  function loop() {
    if (playing && visible < segments.length) {
      visible = Math.min(segments.length, visible + Math.max(1, Math.floor(segments.length / 600)));
      pathGeom.setDrawRange(0, visible * 2);
      if (visible >= segments.length) playing = false;
      updateHud();
      needsRender = true;
    }

    if (needsRender) {
      const tip = visible > 0 ? segments[visible - 1] : null;
      if (toolMesh) {
        if (tip) toolMesh.position.set(tip.x1, tip.y1, tip.z1 + 3);
        toolMesh.visible = !!tip;
      }
      updateCamera();
      renderer.render(scene, camera);
      needsRender = false;
    }

    // واصل فقط ما دام هناك تشغيل متحرك أو تفاعل مستمر — وإلا نَم (raf=null)
    if (playing || interacting) raf = requestAnimationFrame(loop);
    else raf = null;
  }

  function updateHud() {
    const el = document.getElementById('sim3d-progress');
    if (el) el.textContent = segments.length
      ? Math.round(visible / segments.length * 100) + '%' : '--';
  }

  /* ── واجهة عامة ── */
  async function show(gcode) {
    wrap       = document.getElementById('sim3d-wrap');
    canvasHost = document.getElementById('sim3d-canvas-host');
    if (!wrap || !canvasHost) return;

    await loadThree();
    if (!scene) buildScene();

    segments = parseGCode(gcode);
    visible  = segments.length;     // اعرض المسار كاملاً ابتداءً
    buildPath();
    pathGeom.setDrawRange(0, visible * 2);
    updateHud();

    resize();
    requestRender();                // ارسم إطاراً واحداً ثم نَم حتى التفاعل
  }

  function hide() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    playing = false;
    interacting = false;
  }

  function play()  { visible = 0; playing = true; requestRender(); }
  function pause() { playing = !playing; if (playing) requestRender(); }

  return { show, hide, play, pause, fit: () => { fit(); requestRender(); } };
})();
