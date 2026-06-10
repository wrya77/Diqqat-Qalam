/**
 * tools-extra.js — 30 أداة رسم إضافية لـ CanvasEditor
 * تُضاف عبر prototype injection؛ تحميل بعد canvas-editor.js وقبل app.js
 */
(function extendCanvasEditor() {
  'use strict';
  const P = CanvasEditor.prototype;

  /* ══════════════════════════════════════════════════════════
     INIT — تشغيل بعد بناء الكلاس مباشرةً
  ══════════════════════════════════════════════════════════ */
  P.initExtraTools = function () {
    // خصائص أدوات جديدة
    this.starPoints       = 5;
    this.starInnerRatio   = 0.4;
    this.cornerRadius     = 8;
    this.chamferSize      = 8;
    this.spiralTurns      = 3;
    this.waveFreq         = 4;
    this.waveAmp          = 8;
    this.zigzagCount      = 8;
    this.gearTeeth        = 12;
    this.donutRatio       = 0.5;
    this.arrowHeadLen     = 8;
    this.arrowHeadWidth   = 5;
    this.hatchSpacing     = 8;
    this.hatchAngle       = 45;
    this.honeycombSize    = 15;
    this.liveHingeGap     = 4;
    this.liveHingeBridge  = 5;
    this.fingerSize       = 10;
    this.voronoiSeeds     = 25;
    this.mazeCellSize     = 12;
    this.starburstLines   = 24;
    this.starburstRings   = 3;
    this.latticeSpacing   = 12;
    this.waveFillSpacing  = 10;
    this.tabCount         = 5;
    this.tabDepth         = 6;

    this._bezierPath = null; // [[cx1,cy1,cx2,cy2,x,y], ...]

    this._bindExtraOptions();
    this._bindExtraKeys();
  };

  /* ══════════════════════════════════════════════════════════
     OPTIONS BINDING
  ══════════════════════════════════════════════════════════ */
  P._bindExtraOptions = function () {
    const bind = (id, prop, parse) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', e => { this[prop] = parse(e.target.value); });
    };
    bind('star-points',       'starPoints',      v => Math.max(3, Math.min(20, parseInt(v)||5)));
    bind('star-inner',        'starInnerRatio',  v => Math.max(0.1, Math.min(0.9, parseFloat(v)||0.4)));
    bind('corner-radius',     'cornerRadius',    v => Math.max(0.5, parseFloat(v)||8));
    bind('chamfer-size',      'chamferSize',     v => Math.max(0.5, parseFloat(v)||8));
    bind('spiral-turns',      'spiralTurns',     v => Math.max(1, Math.min(20, parseFloat(v)||3)));
    bind('wave-freq',         'waveFreq',        v => Math.max(1, Math.min(30, parseFloat(v)||4)));
    bind('wave-amp',          'waveAmp',         v => Math.max(0.5, parseFloat(v)||8));
    bind('zigzag-count',      'zigzagCount',     v => Math.max(2, Math.min(60, parseInt(v)||8)));
    bind('gear-teeth',        'gearTeeth',       v => Math.max(4, Math.min(120, parseInt(v)||12)));
    bind('donut-ratio',       'donutRatio',      v => Math.max(0.1, Math.min(0.95, parseFloat(v)||0.5)));
    bind('hatch-spacing',     'hatchSpacing',    v => Math.max(1, parseFloat(v)||8));
    bind('hatch-angle',       'hatchAngle',      v => parseFloat(v)||45);
    bind('honeycomb-size',    'honeycombSize',   v => Math.max(3, parseFloat(v)||15));
    bind('maze-cell',         'mazeCellSize',    v => Math.max(5, parseFloat(v)||12));
    bind('lattice-spacing',   'latticeSpacing',  v => Math.max(3, parseFloat(v)||12));
    bind('wavefill-spacing',  'waveFillSpacing', v => Math.max(2, parseFloat(v)||10));
    bind('tab-count',         'tabCount',        v => Math.max(2, Math.min(30, parseInt(v)||5)));
    bind('tab-depth',         'tabDepth',        v => Math.max(1, parseFloat(v)||6));
    bind('finger-size',       'fingerSize',      v => Math.max(1, parseFloat(v)||10));
    bind('voronoi-seeds',     'voronoiSeeds',    v => Math.max(5, Math.min(80, parseInt(v)||25)));
    bind('starburst-lines',   'starburstLines',  v => Math.max(4, Math.min(60, parseInt(v)||24)));
    bind('starburst-rings',   'starburstRings',  v => Math.max(1, Math.min(8, parseInt(v)||3)));
    bind('livehinge-gap',     'liveHingeGap',    v => Math.max(1, parseFloat(v)||4));
  };

  /* ══════════════════════════════════════════════════════════
     KEYBOARD SHORTCUTS
  ══════════════════════════════════════════════════════════ */
  P._bindExtraKeys = function () {
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
      const map = {
        'b':'bezier','k':'spline','t':'triangle','y':'star',
        'n':'arrow','d':'donut','i':'spiral','w':'wave',
        'z':'zigzag','o':'gear','x':'crosshair','m':'dimension',
        'q':'lasso',
        'u':'rounded-rect','j':'chamfer-rect',
        '1':'honeycomb','2':'living-hinge','3':'finger-joint',
        '4':'voronoi','5':'maze','6':'starburst',
        '7':'hatch','8':'lattice','9':'wave-fill','0':'tab-slot',
      };
      if (map[e.key]) { e.preventDefault(); this.setTool(map[e.key]); }
    });
  };

  /* ══════════════════════════════════════════════════════════
     PATCH: setTool — إظهار/إخفاء لوحات الخيارات
  ══════════════════════════════════════════════════════════ */
  const origSetTool = P.setTool;
  P.setTool = function (t) {
    document.querySelectorAll('.opt-extra').forEach(el => el.style.display = 'none');
    const optMap = {
      'polygon':      'opt-polygon',
      'slot':         'opt-slot',
      'star':         'opt-star',
      'rounded-rect': 'opt-rrect',
      'chamfer-rect': 'opt-chamfer',
      'spiral':       'opt-spiral',
      'wave':         'opt-wave',
      'zigzag':       'opt-zigzag',
      'gear':         'opt-gear',
      'donut':        'opt-donut',
      'hatch':        'opt-hatch',
      'honeycomb':    'opt-honeycomb',
      'finger-joint': 'opt-finger',
      'living-hinge': 'opt-livehinge',
      'voronoi':      'opt-voronoi',
      'maze':         'opt-maze',
      'starburst':    'opt-starburst',
      'lattice':      'opt-lattice',
      'wave-fill':    'opt-wavefill',
      'tab-slot':     'opt-tabslot',
    };
    const optId = optMap[t];
    if (optId) { const el = document.getElementById(optId); if (el) el.style.display = 'flex'; }

    // reset bezier/spline path state when switching away
    if (t !== 'bezier' && t !== 'spline') this._bezierPath = null;
    origSetTool.call(this, t);
  };

  /* ══════════════════════════════════════════════════════════
     PATCH: _onDown — تعامل مع أدوات متعددة النقرات
  ══════════════════════════════════════════════════════════ */
  const origOnDown = P._onDown;
  P._onDown = function (e) {
    const pt = this._evPt(e);

    if (this.tool === 'bezier' || this.tool === 'spline') {
      if (e.button === 2) { this._finishCurve(); return; }
      if (!this.isDrawing) {
        this.isDrawing = true;
        this.currentPath = [pt];
        this._bezierPath = [pt];
      } else {
        this.currentPath.push(pt);
        this._bezierPath.push(pt);
      }
      this.previewPt = pt;
      this.render();
      return;
    }

    if (this.tool === 'lasso') {
      if (e.button !== 0) return;
      this.isDrawing = true;
      this.currentPath = [pt];
      return;
    }

    origOnDown.call(this, e);
  };

  /* ══════════════════════════════════════════════════════════
     PATCH: _onMove — تتبع الحركة للاسو والمنحنيات
  ══════════════════════════════════════════════════════════ */
  const origOnMove = P._onMove;
  P._onMove = function (e) {
    if (this.tool === 'lasso' && this.isDrawing) {
      const r  = this.canvas.getBoundingClientRect();
      const pt = this._snap(this._sToW(e.clientX - r.left, e.clientY - r.top));
      this.currentPath.push(pt);
      this.previewPt = pt;
      this.render();
      return;
    }
    origOnMove.call(this, e);
  };

  /* ══════════════════════════════════════════════════════════
     PATCH: _onUp — تعامل مع أدوات التوليد المساحي
  ══════════════════════════════════════════════════════════ */
  const GENERATIVE = new Set([
    'honeycomb','living-hinge','finger-joint','voronoi','maze',
    'hatch','lattice','wave-fill','tab-slot','donut','starburst'
  ]);

  const origOnUp = P._onUp;
  P._onUp = function (e) {
    if (this.tool === 'lasso') {
      if (!this.isDrawing || this.currentPath.length < 3) {
        this._cancelDraw(); return;
      }
      this._saveHistory();
      this.shapes.push({ type: 'polyline', points: [...this.currentPath], closed: true });
      this.currentPath = []; this.isDrawing = false; this.previewPt = null;
      this.render(); this._updateStatus();
      return;
    }

    if (GENERATIVE.has(this.tool)) {
      if (!this.isDrawing || !this.startPt) return;
      const pt = this._evPt(e);
      const d  = Math.hypot(pt.x - this.startPt.x, pt.y - this.startPt.y);
      if (d > 1) {
        const generated = this._buildMultiShapes(this.startPt, pt);
        if (generated && generated.length) {
          this._saveHistory();
          this.shapes.push(...generated);
        }
      }
      this.isDrawing = false; this.startPt = null; this.previewPt = null;
      this.render(); this._updateStatus();
      return;
    }

    origOnUp.call(this, e);
  };

  /* ══════════════════════════════════════════════════════════
     PATCH: _onDbl — إنهاء الأدوات متعددة النقرات
  ══════════════════════════════════════════════════════════ */
  const origOnDbl = P._onDbl;
  P._onDbl = function (e) {
    if ((this.tool === 'bezier' || this.tool === 'spline') && this.currentPath && this.currentPath.length >= 2) {
      this._finishCurve(); return;
    }
    origOnDbl.call(this, e);
  };

  P._finishCurve = function () {
    if (!this.currentPath || this.currentPath.length < 2) { this._cancelDraw(); return; }
    const pts = this.tool === 'bezier'
      ? this._sampleBezierChain(this.currentPath)
      : this._sampleCatmullRom(this.currentPath, 20);
    this._saveHistory();
    this.shapes.push({ type: 'polyline', points: pts, closed: false });
    this.currentPath = []; this._bezierPath = null; this.isDrawing = false;
    this.render(); this._updateStatus();
  };

  /* ══════════════════════════════════════════════════════════
     PATCH: _buildShape — أدوات الشكل الواحد
  ══════════════════════════════════════════════════════════ */
  const origBuildShape = P._buildShape;
  P._buildShape = function (start, end) {
    switch (this.tool) {
      case 'triangle':     return this._bTriangle(start, end);
      case 'star':         return this._bStar(start, end);
      case 'arrow':        return this._bArrow(start, end);
      case 'rounded-rect': return this._bRoundedRect(start, end);
      case 'chamfer-rect': return this._bChamferRect(start, end);
      case 'spiral':       return this._bSpiral(start, end);
      case 'wave':         return this._bWave(start, end);
      case 'zigzag':       return this._bZigzag(start, end);
      case 'gear':         return this._bGear(start, end);
      case 'crosshair':    return this._bCrosshair(start, end);
      case 'dimension':    return this._bDimension(start, end);
      case 'bezier':       return null; // handled by _onDbl
      case 'spline':       return null;
      case 'lasso':        return null;
      default:
        if (GENERATIVE.has(this.tool)) return null;
        return origBuildShape.call(this, start, end);
    }
  };

  /* ══════════════════════════════════════════════════════════
     MULTI-SHAPE builder (generative area tools)
  ══════════════════════════════════════════════════════════ */
  P._buildMultiShapes = function (start, end) {
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    switch (this.tool) {
      case 'honeycomb':    return this._genHoneycomb(x, y, w, h);
      case 'living-hinge': return this._genLivingHinge(x, y, w, h);
      case 'finger-joint': return this._genFingerJoint(x, y, w, h);
      case 'voronoi':      return this._genVoronoi(x, y, w, h);
      case 'maze':         return this._genMaze(x, y, w, h);
      case 'hatch':        return this._genHatch(x, y, w, h);
      case 'lattice':      return this._genLattice(x, y, w, h);
      case 'wave-fill':    return this._genWaveFill(x, y, w, h);
      case 'tab-slot':     return this._genTabSlot(x, y, w, h);
      case 'donut':        return this._genDonut(start, end);
      case 'starburst':    return this._genStarburst(start, end);
    }
    return [];
  };

  /* ══════════════════════════════════════════════════════════
     PATCH: _drawPreview
  ══════════════════════════════════════════════════════════ */
  const origDrawPreview = P._drawPreview;
  P._drawPreview = function (start, end) {
    const ctx = this.ctx;
    const box = () => {
      const p = this._wToS(Math.min(start.x,end.x), Math.min(start.y,end.y));
      ctx.beginPath();
      ctx.strokeRect(p.x, p.y, Math.abs(end.x-start.x)*this.scale, Math.abs(end.y-start.y)*this.scale);
    };
    switch (this.tool) {
      case 'triangle':     this._pvTriangle(start, end); break;
      case 'star':         this._pvStar(start, end); break;
      case 'arrow':        this._pvArrow(start, end); break;
      case 'rounded-rect': this._pvRoundedRect(start, end); break;
      case 'chamfer-rect': box(); break;
      case 'spiral':       this._pvSpiral(start, end); break;
      case 'wave':         this._pvWave(start, end); break;
      case 'zigzag':       this._pvZigzag(start, end); break;
      case 'gear':         this._pvGear(start, end); break;
      case 'crosshair':    this._pvCrosshair(start, end); break;
      case 'dimension':    this._pvDimension(start, end); break;
      case 'donut':        this._pvDonut(start, end); break;
      case 'starburst':    this._pvStarburst(start, end); break;
      case 'honeycomb': case 'living-hinge': case 'finger-joint':
      case 'voronoi': case 'maze': case 'hatch': case 'lattice':
      case 'wave-fill': case 'tab-slot': box(); break;
      default: origDrawPreview.call(this, start, end); break;
    }
  };

  /* ══════════════════════════════════════════════════════════
     ── TRIANGLE ──
  ══════════════════════════════════════════════════════════ */
  P._bTriangle = function (start, end) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const r = Math.hypot(dx, dy);
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: start.x + Math.cos(a) * r, y: start.y + Math.sin(a) * r });
    }
    return { type: 'polyline', points: pts, closed: true };
  };
  P._pvTriangle = function (s, e) {
    const ctx = this.ctx, pts = this._bTriangle(s, e).points;
    const sp = pts.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
    sp.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── STAR ──
  ══════════════════════════════════════════════════════════ */
  P._bStar = function (start, end) {
    const r     = Math.hypot(end.x - start.x, end.y - start.y);
    const ri    = r * this.starInnerRatio;
    const n     = this.starPoints;
    const pts   = [];
    for (let i = 0; i < n * 2; i++) {
      const rad = i % 2 === 0 ? r : ri;
      const a   = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: start.x + Math.cos(a) * rad, y: start.y + Math.sin(a) * rad });
    }
    return { type: 'polyline', points: pts, closed: true };
  };
  P._pvStar = function (s, e) {
    const ctx = this.ctx, shp = this._bStar(s, e);
    const sp = shp.points.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
    sp.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── ARROW ──
  ══════════════════════════════════════════════════════════ */
  P._bArrow = function (start, end) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const hl = this.arrowHeadLen, hw = this.arrowHeadWidth / 2;
    const hx = end.x - Math.cos(angle) * hl;
    const hy = end.y - Math.sin(angle) * hl;
    const wx = Math.cos(angle + Math.PI / 2) * hw;
    const wy = Math.sin(angle + Math.PI / 2) * hw;
    const pts = [
      { x: start.x,      y: start.y },
      { x: hx,           y: hy },
      { x: hx + wx,      y: hy + wy },
      { x: end.x,        y: end.y },
      { x: hx - wx,      y: hy - wy },
      { x: hx,           y: hy },
    ];
    return { type: 'polyline', points: pts, closed: false };
  };
  P._pvArrow = P._pvTriangle; // reused below
  P._pvArrow = function (s, e) {
    const ctx = this.ctx, shp = this._bArrow(s, e);
    const sp = shp.points.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
    sp.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── ROUNDED RECT ──
  ══════════════════════════════════════════════════════════ */
  P._bRoundedRect = function (start, end) {
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    const r = Math.min(this.cornerRadius, w / 2, h / 2);
    const pts = [], N = 8;
    const addArc = (cx, cy, startA, endA) => {
      for (let i = 0; i <= N; i++) {
        const a = startA + (endA - startA) * (i / N);
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    };
    addArc(x + r,     y + r,     Math.PI,        Math.PI * 1.5);
    addArc(x + w - r, y + r,     Math.PI * 1.5,  0);
    addArc(x + w - r, y + h - r, 0,              Math.PI / 2);
    addArc(x + r,     y + h - r, Math.PI / 2,    Math.PI);
    return { type: 'polyline', points: pts, closed: true };
  };
  P._pvRoundedRect = function (s, e) {
    const ctx = this.ctx, shp = this._bRoundedRect(s, e);
    const sp = shp.points.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
    sp.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── CHAMFER RECT ──
  ══════════════════════════════════════════════════════════ */
  P._bChamferRect = function (start, end) {
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    const c = Math.min(this.chamferSize, w / 2, h / 2);
    const pts = [
      {x:x+c,y}, {x:x+w-c,y},
      {x:x+w,y:y+c}, {x:x+w,y:y+h-c},
      {x:x+w-c,y:y+h}, {x:x+c,y:y+h},
      {x:x,y:y+h-c}, {x:x,y:y+c},
    ];
    return { type: 'polyline', points: pts, closed: true };
  };

  /* ══════════════════════════════════════════════════════════
     ── SPIRAL ──
  ══════════════════════════════════════════════════════════ */
  P._bSpiral = function (start, end) {
    const rMax = Math.hypot(end.x - start.x, end.y - start.y);
    const turns = this.spiralTurns, steps = turns * 36;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = rMax * t;
      const a = t * turns * Math.PI * 2;
      pts.push({ x: start.x + Math.cos(a) * r, y: start.y + Math.sin(a) * r });
    }
    return { type: 'polyline', points: pts, closed: false };
  };
  P._pvSpiral = function (s, e) {
    const ctx = this.ctx, shp = this._bSpiral(s, e);
    const sp = shp.points.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
    sp.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── WAVE ──
  ══════════════════════════════════════════════════════════ */
  P._bWave = function (start, end) {
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const steps = Math.max(4, Math.round(len / 2));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const along = t * len;
      const perp  = Math.sin(t * this.waveFreq * Math.PI * 2) * this.waveAmp;
      pts.push({
        x: start.x + Math.cos(angle) * along - Math.sin(angle) * perp,
        y: start.y + Math.sin(angle) * along + Math.cos(angle) * perp,
      });
    }
    return { type: 'polyline', points: pts, closed: false };
  };
  P._pvWave = function (s, e) {
    const ctx = this.ctx, shp = this._bWave(s, e);
    const sp = shp.points.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
    sp.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── ZIGZAG ──
  ══════════════════════════════════════════════════════════ */
  P._bZigzag = function (start, end) {
    const len   = Math.hypot(end.x - start.x, end.y - start.y);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const n     = this.zigzagCount;
    const amp   = this.waveAmp;
    const pts   = [];
    for (let i = 0; i <= n; i++) {
      const t     = i / n;
      const along = t * len;
      const perp  = (i % 2 === 0 ? amp : -amp);
      pts.push({
        x: start.x + Math.cos(angle) * along - Math.sin(angle) * perp,
        y: start.y + Math.sin(angle) * along + Math.cos(angle) * perp,
      });
    }
    return { type: 'polyline', points: pts, closed: false };
  };
  P._pvZigzag = function (s, e) {
    const ctx = this.ctx, shp = this._bZigzag(s, e);
    const sp = shp.points.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
    sp.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── GEAR ──
  ══════════════════════════════════════════════════════════ */
  P._bGear = function (start, end) {
    const r     = Math.hypot(end.x - start.x, end.y - start.y);
    const n     = this.gearTeeth;
    const rAdd  = r * 0.12;
    const rDed  = r * 0.12;
    const pts   = [];
    const segs  = n * 4;
    for (let i = 0; i <= segs; i++) {
      const t     = i / segs;
      const phase = (t * n * Math.PI * 2) % (Math.PI * 2 / n);
      const isTip = phase < (Math.PI / n);
      const cr    = isTip ? r + rAdd : r - rDed;
      const a     = t * n * Math.PI * 2;
      pts.push({ x: start.x + Math.cos(a) * cr, y: start.y + Math.sin(a) * cr });
    }
    return { type: 'polyline', points: pts, closed: true };
  };
  P._pvGear = function (s, e) {
    const ctx = this.ctx, shp = this._bGear(s, e);
    const sp = shp.points.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
    sp.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── CROSSHAIR (علامة التمركز) ──
  ══════════════════════════════════════════════════════════ */
  P._bCrosshair = function (start, end) {
    const r = Math.hypot(end.x - start.x, end.y - start.y);
    const cx = start.x, cy = start.y;
    // Return 3 polylines: H line, V line, circle — using polygon group trick
    // Actually return only the circle. We add the lines as separate shapes via multi
    const pts = [];
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return { type: 'polyline', points: pts, closed: true, _crosshair: { cx, cy, r } };
  };
  P._pvCrosshair = function (s, e) {
    const ctx = this.ctx;
    const r = Math.hypot(e.x - s.x, e.y - s.y) * this.scale;
    const c = this._wToS(s.x, s.y);
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x - r * 1.3, c.y); ctx.lineTo(c.x + r * 1.3, c.y);
    ctx.moveTo(c.x, c.y - r * 1.3); ctx.lineTo(c.x, c.y + r * 1.3);
    ctx.stroke();
  };

  /* Override _onUp just for crosshair to emit 3 shapes */
  const origOnUp2 = P._onUp;
  P._onUp = (function (prevOnUp) {
    return function (e) {
      if (this.tool === 'crosshair') {
        if (!this.isDrawing || !this.startPt) return;
        const pt = this._evPt(e);
        const r  = Math.hypot(pt.x - this.startPt.x, pt.y - this.startPt.y);
        if (r > 0.5) {
          this._saveHistory();
          const cx = this.startPt.x, cy = this.startPt.y;
          const N = 32, circlePts = [];
          for (let i = 0; i <= N; i++) {
            const a = (i / N) * Math.PI * 2;
            circlePts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
          }
          this.shapes.push({ type: 'polyline', points: circlePts, closed: true });
          this.shapes.push({ type: 'line', x1: cx - r * 1.4, y1: cy, x2: cx + r * 1.4, y2: cy });
          this.shapes.push({ type: 'line', x1: cx, y1: cy - r * 1.4, x2: cx, y2: cy + r * 1.4 });
        }
        this.isDrawing = false; this.startPt = null; this.previewPt = null;
        this.render(); this._updateStatus();
        return;
      }
      prevOnUp.call(this, e);
    };
  }(P._onUp));

  /* ══════════════════════════════════════════════════════════
     ── DIMENSION LINE ──
  ══════════════════════════════════════════════════════════ */
  P._bDimension = function (start, end) {
    const offset = 6;
    const angle  = Math.atan2(end.y - start.y, end.x - start.x);
    const perp   = angle + Math.PI / 2;
    const ox = Math.cos(perp) * offset, oy = Math.sin(perp) * offset;
    const pts = [
      { x: start.x + ox, y: start.y + oy },
      { x: end.x   + ox, y: end.y   + oy },
    ];
    const hl = 3;
    const a1 = angle + Math.PI, a2 = angle;
    [pts[0], pts[pts.length - 1]].forEach((tip, ti) => {
      const base = ti === 0 ? start : end;
      const ang  = ti === 0 ? a1 : a2;
      pts.push({ x: tip.x + Math.cos(ang + 0.4) * hl, y: tip.y + Math.sin(ang + 0.4) * hl });
      pts.push(tip);
      pts.push({ x: tip.x + Math.cos(ang - 0.4) * hl, y: tip.y + Math.sin(ang - 0.4) * hl });
    });
    return { type: 'polyline', points: pts, closed: false,
             _dimLabel: Math.hypot(end.x - start.x, end.y - start.y).toFixed(2) + ' mm' };
  };
  P._pvDimension = function (s, e) {
    const ctx = this.ctx, shp = this._bDimension(s, e);
    const sp = shp.points.map(p => this._wToS(p.x, p.y));
    ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y); ctx.lineTo(sp[1].x, sp[1].y); ctx.stroke();
    ctx.font = '11px monospace'; ctx.fillStyle = 'rgba(88,166,255,.9)'; ctx.textAlign = 'center';
    ctx.fillText(shp._dimLabel, (sp[0].x + sp[1].x) / 2, (sp[0].y + sp[1].y) / 2 - 5);
    ctx.textAlign = 'start';
  };

  /* ══════════════════════════════════════════════════════════
     ── BEZIER / SPLINE samplers ──
  ══════════════════════════════════════════════════════════ */
  P._sampleBezierChain = function (pts) {
    const out = [];
    const N = 16;
    for (let seg = 0; seg + 1 < pts.length; seg += 1) {
      const p0 = pts[seg], p3 = pts[seg + 1];
      const mid = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
      const p1 = { x: p0.x + (mid.x - p0.x) * 0.5, y: p0.y + (mid.y - p0.y) * 0.5 };
      const p2 = { x: p3.x - (p3.x - mid.x) * 0.5, y: p3.y - (p3.y - mid.y) * 0.5 };
      for (let i = 0; i <= N; i++) {
        const t = i / N, u = 1 - t;
        out.push({
          x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
          y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
        });
      }
    }
    return out;
  };

  P._sampleCatmullRom = function (pts, steps) {
    if (pts.length < 2) return pts;
    const out = [];
    const ext = [pts[0], ...pts, pts[pts.length - 1]];
    for (let i = 1; i < ext.length - 2; i++) {
      const p0=ext[i-1],p1=ext[i],p2=ext[i+1],p3=ext[i+2];
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          y: 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
        });
      }
    }
    return out;
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: DONUT ──
  ══════════════════════════════════════════════════════════ */
  P._genDonut = function (start, end) {
    const r    = Math.hypot(end.x - start.x, end.y - start.y);
    const ri   = r * this.donutRatio;
    const N    = 64;
    const mkCircle = (rad) => {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push({ x: start.x + Math.cos(a) * rad, y: start.y + Math.sin(a) * rad });
      }
      return { type: 'polyline', points: pts, closed: true };
    };
    return [ mkCircle(r), mkCircle(ri) ];
  };
  P._pvDonut = function (s, e) {
    const ctx = this.ctx;
    const r  = Math.hypot(e.x - s.x, e.y - s.y) * this.scale;
    const ri = r * this.donutRatio;
    const c  = this._wToS(s.x, s.y);
    ctx.beginPath(); ctx.arc(c.x, c.y, r,  0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, c.y, ri, 0, Math.PI * 2); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: STARBURST ──
  ══════════════════════════════════════════════════════════ */
  P._genStarburst = function (start, end) {
    const r = Math.hypot(end.x - start.x, end.y - start.y);
    const shapes = [];
    const nl = this.starburstLines, nr = this.starburstRings;
    for (let i = 0; i < nl; i++) {
      const a = (i / nl) * Math.PI * 2;
      shapes.push({ type: 'line', x1: start.x, y1: start.y,
                    x2: start.x + Math.cos(a) * r, y2: start.y + Math.sin(a) * r });
    }
    for (let ri = 1; ri <= nr; ri++) {
      const cr = r * (ri / nr);
      const pts = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push({ x: start.x + Math.cos(a) * cr, y: start.y + Math.sin(a) * cr });
      }
      shapes.push({ type: 'polyline', points: pts, closed: true });
    }
    return shapes;
  };
  P._pvStarburst = function (s, e) {
    const ctx = this.ctx;
    const r = Math.hypot(e.x - s.x, e.y - s.y) * this.scale;
    const c = this._wToS(s.x, s.y);
    const nl = this.starburstLines;
    ctx.beginPath();
    for (let i = 0; i < nl; i++) {
      const a = (i / nl) * Math.PI * 2;
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: HONEYCOMB ──
  ══════════════════════════════════════════════════════════ */
  P._genHoneycomb = function (x, y, w, h) {
    const s = this.honeycombSize;
    const hexW = s * Math.sqrt(3);
    const hexH = s * 2;
    const shapes = [];
    const rows = Math.ceil(h / (hexH * 0.75)) + 2;
    const cols = Math.ceil(w / hexW) + 2;
    for (let row = -1; row < rows; row++) {
      for (let col = -1; col < cols; col++) {
        const cx = x + col * hexW + (row % 2 === 0 ? hexW / 2 : 0);
        const cy = y + row * hexH * 0.75;
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
          const px = cx + Math.cos(a) * s;
          const py = cy + Math.sin(a) * s;
          if (px < x - s || px > x + w + s || py < y - s || py > y + h + s) continue;
          pts.push({ x: px, y: py });
        }
        if (pts.length === 6) shapes.push({ type: 'polyline', points: pts, closed: true });
      }
    }
    return shapes;
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: LIVING HINGE ──
  ══════════════════════════════════════════════════════════ */
  P._genLivingHinge = function (x, y, w, h) {
    const gap    = this.liveHingeGap;
    const bridge = Math.min(this.liveHingeBridge, w / 3);
    const shapes = [];
    let row = 0;
    for (let cy = y + gap / 2; cy < y + h; cy += gap, row++) {
      if (row % 2 === 0) {
        shapes.push({ type: 'line', x1: x, y1: cy, x2: x + w - bridge, y2: cy });
      } else {
        shapes.push({ type: 'line', x1: x + bridge, y1: cy, x2: x + w, y2: cy });
      }
    }
    shapes.push({ type: 'rect', x, y, w, h });
    return shapes;
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: FINGER JOINT ──
  ══════════════════════════════════════════════════════════ */
  P._genFingerJoint = function (x, y, w, h) {
    const fs   = this.fingerSize;
    const cols = Math.floor(w / fs);
    const depth = Math.min(h / 3, fs * 1.5);
    const shapes = [];
    const pts   = [{ x, y: y + depth }];
    for (let i = 0; i < cols; i++) {
      const lx = x + i * fs;
      const rx = lx + fs;
      if (i % 2 === 0) {
        pts.push({ x: lx, y: y + depth });
        pts.push({ x: lx, y });
        pts.push({ x: rx, y });
        pts.push({ x: rx, y: y + depth });
      } else {
        pts.push({ x: lx, y: y + depth });
      }
    }
    pts.push({ x: x + cols * fs, y: y + depth });
    shapes.push({ type: 'polyline', points: pts, closed: false });
    shapes.push({ type: 'line', x1: x, y1: y + depth, x2: x, y2: y + h });
    shapes.push({ type: 'line', x1: x + w, y1: y + depth, x2: x + w, y2: y + h });
    shapes.push({ type: 'line', x1: x, y1: y + h, x2: x + w, y2: y + h });
    return shapes;
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: VORONOI (simplified Fortune approx.) ──
  ══════════════════════════════════════════════════════════ */
  P._genVoronoi = function (x, y, w, h) {
    const n = this.voronoiSeeds;
    const seeds = [];
    // Poisson-like distribution with pseudo-random seed
    let lcg = 1664525;
    const rand = () => { lcg = (lcg * 1664525 + 1013904223) & 0xffffffff; return (lcg >>> 0) / 0xffffffff; };
    for (let i = 0; i < n; i++) seeds.push({ x: x + rand() * w, y: y + rand() * h });

    const shapes = [];
    const gridRes = Math.max(4, Math.min(40, Math.floor(Math.sqrt(w * h) / 6)));
    const gw = w / gridRes, gh = h / gridRes;

    for (let row = 0; row < gridRes; row++) {
      for (let col = 0; col < gridRes; col++) {
        const px = x + (col + 0.5) * gw, py = y + (row + 0.5) * gh;
        let minD = Infinity, minI = 0, secD = Infinity;
        seeds.forEach((s, i) => {
          const d = Math.hypot(px - s.x, py - s.y);
          if (d < minD) { secD = minD; minD = d; minI = i; }
          else if (d < secD) secD = d;
        });
        // if near boundary between two cells, draw a short edge
        if (secD - minD < gw * 0.5) {
          const s1 = seeds[minI];
          const mx = (px * 2 - s1.x * 0.3), my = (py * 2 - s1.y * 0.3);
          shapes.push({ type: 'line',
            x1: Math.max(x, Math.min(x+w, px - gw*0.4)), y1: Math.max(y, Math.min(y+h, py - gh*0.4)),
            x2: Math.max(x, Math.min(x+w, px + gw*0.4)), y2: Math.max(y, Math.min(y+h, py + gh*0.4)),
          });
        }
      }
    }
    return shapes.length ? shapes : [{ type: 'rect', x, y, w, h }];
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: MAZE (Recursive Backtracking) ──
  ══════════════════════════════════════════════════════════ */
  P._genMaze = function (x, y, w, h) {
    const cs   = Math.max(5, this.mazeCellSize);
    const cols = Math.floor(w / cs) || 1;
    const rows = Math.floor(h / cs) || 1;

    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const walls   = {
      right:  Array.from({ length: rows }, () => new Array(cols).fill(true)),
      bottom: Array.from({ length: rows }, () => new Array(cols).fill(true)),
    };

    const dirs = [{r:0,c:1,wall:'right'},{r:0,c:-1,wall:'rightL'},{r:1,c:0,wall:'bottom'},{r:-1,c:0,wall:'bottomU'}];

    let lcg = 42;
    const rand = (n) => { lcg = (lcg * 1664525 + 1013904223) & 0xffffffff; return ((lcg >>> 0) % n); };

    const carve = (r, c) => {
      visited[r][c] = true;
      const order = [0, 1, 2, 3].sort(() => rand(3) - 1);
      for (const di of order) {
        const d = dirs[di];
        const nr = r + d.r, nc = c + d.c;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || visited[nr][nc]) continue;
        if (d.wall === 'right')   walls.right[r][c]   = false;
        if (d.wall === 'rightL')  walls.right[r][nc]  = false;
        if (d.wall === 'bottom')  walls.bottom[r][c]  = false;
        if (d.wall === 'bottomU') walls.bottom[nr][c] = false;
        carve(nr, nc);
      }
    };
    try { carve(0, 0); } catch(e) { /* stack overflow on large mazes — just skip */ }

    const shapes = [];
    // Outer border
    shapes.push({ type: 'rect', x, y, w: cols * cs, h: rows * cs });
    // Internal walls
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c < cols - 1 && walls.right[r][c]) {
          shapes.push({ type: 'line', x1: x+(c+1)*cs, y1: y+r*cs, x2: x+(c+1)*cs, y2: y+(r+1)*cs });
        }
        if (r < rows - 1 && walls.bottom[r][c]) {
          shapes.push({ type: 'line', x1: x+c*cs, y1: y+(r+1)*cs, x2: x+(c+1)*cs, y2: y+(r+1)*cs });
        }
      }
    }
    return shapes;
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: HATCH FILL ──
  ══════════════════════════════════════════════════════════ */
  P._genHatch = function (x, y, w, h) {
    const sp  = this.hatchSpacing;
    const ang = this.hatchAngle * Math.PI / 180;
    const shapes = [];
    const diag = Math.hypot(w, h);
    const cx = x + w / 2, cy = y + h / 2;
    for (let d = -diag; d <= diag; d += sp) {
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const lx1 = cx + d * sin - diag * cos, ly1 = cy - d * cos - diag * sin;
      const lx2 = cx + d * sin + diag * cos, ly2 = cy - d * cos + diag * sin;
      // Clip to bounding box
      const clipped = _clipLine(lx1, ly1, lx2, ly2, x, y, x + w, y + h);
      if (clipped) {
        shapes.push({ type: 'line', x1: clipped[0], y1: clipped[1], x2: clipped[2], y2: clipped[3] });
      }
    }
    return shapes.length ? shapes : [{ type: 'rect', x, y, w, h }];
  };

  /* Cohen-Sutherland line clip helper */
  function _clipLine(x1, y1, x2, y2, minX, minY, maxX, maxY) {
    const INSIDE=0, LEFT=1, RIGHT=2, BOTTOM=4, TOP=8;
    const code = (x, y) => {
      let c = INSIDE;
      if (x < minX) c |= LEFT; else if (x > maxX) c |= RIGHT;
      if (y < minY) c |= TOP;  else if (y > maxY) c |= BOTTOM;
      return c;
    };
    let c1 = code(x1,y1), c2 = code(x2,y2);
    while (true) {
      if (!(c1 | c2)) return [x1,y1,x2,y2];
      if (c1 & c2)    return null;
      const co = c1 || c2;
      let x, y;
      if      (co & BOTTOM) { x = x1 + (x2-x1)*(maxY-y1)/(y2-y1); y = maxY; }
      else if (co & TOP)    { x = x1 + (x2-x1)*(minY-y1)/(y2-y1); y = minY; }
      else if (co & RIGHT)  { y = y1 + (y2-y1)*(maxX-x1)/(x2-x1); x = maxX; }
      else                  { y = y1 + (y2-y1)*(minX-x1)/(x2-x1); x = minX; }
      if (co === c1) { x1=x; y1=y; c1=code(x1,y1); }
      else           { x2=x; y2=y; c2=code(x2,y2); }
    }
  }

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: LATTICE ──
  ══════════════════════════════════════════════════════════ */
  P._genLattice = function (x, y, w, h) {
    const sp = this.latticeSpacing;
    const shapes = [];
    // Diamond lattice (45° crossing lines)
    for (let d = -Math.max(w,h); d <= w + Math.max(w,h); d += sp) {
      const c1 = _clipLine(x+d, y, x, y+d, x, y, x+w, y+h);
      const c2 = _clipLine(x+d, y, x+w+d-h, y+h, x, y, x+w, y+h);
      if (c1) shapes.push({ type:'line', x1:c1[0],y1:c1[1],x2:c1[2],y2:c1[3] });
      if (c2) shapes.push({ type:'line', x1:c2[0],y1:c2[1],x2:c2[2],y2:c2[3] });
    }
    shapes.push({ type: 'rect', x, y, w, h });
    return shapes;
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: WAVE FILL ──
  ══════════════════════════════════════════════════════════ */
  P._genWaveFill = function (x, y, w, h) {
    const sp  = this.waveFillSpacing;
    const amp = sp * 0.4;
    const shapes = [];
    for (let cy = y + sp / 2; cy < y + h; cy += sp) {
      const pts = [];
      const steps = Math.max(4, Math.round(w / 2));
      for (let i = 0; i <= steps; i++) {
        const t  = i / steps;
        const px = x + t * w;
        const py = cy + Math.sin(t * this.waveFreq * Math.PI * 2) * amp;
        pts.push({ x: px, y: Math.max(y, Math.min(y + h, py)) });
      }
      shapes.push({ type: 'polyline', points: pts, closed: false });
    }
    return shapes;
  };

  /* ══════════════════════════════════════════════════════════
     ── GENERATIVE: TAB & SLOT ──
  ══════════════════════════════════════════════════════════ */
  P._genTabSlot = function (x, y, w, h) {
    const n     = this.tabCount;
    const depth = this.tabDepth;
    const tabW  = w / (n * 2 + 1);
    const shapes = [];
    const pts   = [{ x, y: y + depth }];
    for (let i = 0; i < n * 2 + 1; i++) {
      const lx = x + i * tabW;
      const rx = lx + tabW;
      if (i % 2 === 0) {
        // gap
        pts.push({ x: lx, y: y + depth });
      } else {
        // tab protrudes upward
        pts.push({ x: lx, y: y + depth });
        pts.push({ x: lx, y });
        pts.push({ x: rx, y });
        pts.push({ x: rx, y: y + depth });
      }
    }
    pts.push({ x: x + (n * 2 + 1) * tabW, y: y + depth });
    shapes.push({ type: 'polyline', points: pts, closed: false });
    shapes.push({ type: 'line', x1: x, y1: y + depth, x2: x, y2: y + h });
    shapes.push({ type: 'line', x1: x + w, y1: y + depth, x2: x + w, y2: y + h });
    shapes.push({ type: 'line', x1: x, y1: y + h, x2: x + w, y2: y + h });
    return shapes;
  };

})();
