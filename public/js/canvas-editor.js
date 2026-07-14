/**
 * canvas-editor.js — Full Interactive Drawing Editor
 */
class CanvasEditor {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx    = this.canvas.getContext('2d');

    this.tool     = 'select';
    this.shapes   = [];
    this.history  = [];
    this.redoStack= [];

    this.isDrawing   = false;
    this.startPt     = null;
    this.previewPt   = null;
    this.currentPath = [];

    this.selectedIdx = -1;
    this.dragOffset  = null;

    this.scale  = 2.0;
    this.offset = { x:60, y:60 };

    this.gridSize = 10;
    this.showGrid = true;
    this.snapGrid = true;
    this._resizing = false;
    this._aiHighlights = new Set();

    this.polygonSides = 6;
    this.slotRadius   = 5;
    this._clipboard   = null;

    try {
      this._resizeObserver = new ResizeObserver(() => {
        if (!this._resizing) {
          this._resizing = true;
          requestAnimationFrame(() => { this._resize(); this._resizing = false; });
        }
      });
      this._resizeObserver.observe(this.canvas.parentElement);
    } catch(e) {
      window.addEventListener('resize', () => this._resize());
    }
    this._resize();
    this._bindEvents();
    this.render();
    if (typeof this.initExtraTools === 'function') this.initExtraTools();
  }

  /* ────────── INIT ────────── */
  _resize() {
    const area = this.canvas.parentElement;
    const w = area.clientWidth  || 800;
    const h = area.clientHeight || 600;
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width  = w;
    this.canvas.height = h;
    // أول تهيئة: ضع نقطة الصفر أسفل-يسار كما في آلات CNC
    if (!this._originInit) {
      this.offset.y = h - 60;
      this._originInit = true;
    }
    this.render();
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown',  e => this._onDown(e));
    let moveThrottle = false;
    c.addEventListener('mousemove',  e => {
      if (moveThrottle) return;
      moveThrottle = true;
      requestAnimationFrame(() => { moveThrottle = false; this._onMove(e); });
    });
    c.addEventListener('mouseup',    e => this._onUp(e));
    c.addEventListener('dblclick',   e => this._onDbl(e));
    c.addEventListener('wheel',      e => this._onWheel(e), { passive:false });
    c.addEventListener('contextmenu',e => { e.preventDefault(); this._cancelDraw(); });

    document.addEventListener('keydown', e => {
      const inInput = e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA' || e.target.isContentEditable;
      // نعتمد e.code (الموضع الفيزيائي للمفتاح) لا e.key، لأن التخطيط العربي
      // يجعل e.key='ش' بدل 'a' فتفشل كل الاختصارات. e.code يبقى 'KeyA' أياً كانت اللغة.
      const code = e.code;

      // ── اختصارات Ctrl/Cmd ──
      if (e.ctrlKey || e.metaKey) {
        if (inInput) return;  // داخل الحقول: اترك Ctrl للمتصفح (نسخ/لصق/تحديد النص)
        if (code==='KeyZ') { e.preventDefault(); this.undo();        return; }
        if (code==='KeyY') { e.preventDefault(); this.redo();        return; }
        if (code==='KeyC') {                     this._copy();       return; }
        if (code==='KeyV') { e.preventDefault(); this._paste();      return; }
        if (code==='KeyD') { e.preventDefault(); this._duplicate();  return; }
        if (code==='KeyA') { e.preventDefault(); this.selectAll?.(); return; }  // تحديد كل الأشكال
        if (e.key==='Delete'||e.key==='Backspace') { e.preventDefault(); this.deleteAll?.(); return; }
        return;  // أي اختصار Ctrl آخر: لا تُستثار أدوات الحرف الواحد
      }

      if (inInput) return;
      if (e.altKey) return;
      if (e.key==='Escape')                       this._cancelDraw();
      if (e.key==='Delete'||e.key==='Backspace')  this._deleteSelected();
      if (code==='KeyV') this.setTool('select');
      if (code==='KeyH') this.setTool('hand');
      if (code==='KeyL') this.setTool('line');
      if (code==='KeyR') this.setTool('rect');
      if (code==='KeyC') this.setTool('circle');
      if (code==='KeyE') this.setTool('ellipse');
      if (code==='KeyA') this.setTool('arc');
      if (code==='KeyG') this.setTool('polygon');
      if (code==='KeyS') this.setTool('slot');
      if (code==='KeyP') this.setTool('polyline');
      if (code==='KeyF') this.setTool('freehand');
      if (code==='KeyZ' && !e.ctrlKey && !e.metaKey) this.setTool('zoom');
    });

    document.getElementById('polygon-sides')?.addEventListener('change', e => {
      this.polygonSides = Math.max(3, Math.min(64, parseInt(e.target.value) || 6));
    });
    document.getElementById('slot-width')?.addEventListener('change', e => {
      this.slotRadius = Math.max(0.5, parseFloat(e.target.value) / 2 || 5);
    });
  }

  /* ────────── COORDINATE UTILS ──────────
     عرض CNC قياسي: المحور Y صاعد، نقطة الصفر أسفل-يسار —
     ما تراه على الشاشة يطابق اتجاه القطعة على الآلة */
  _sToW(sx, sy) { return { x:(sx-this.offset.x)/this.scale, y:(this.offset.y-sy)/this.scale }; }
  _wToS(wx, wy) { return { x:wx*this.scale+this.offset.x,  y:this.offset.y-wy*this.scale }; }

  _snap(pt) {
    if (!this.snapGrid) return pt;
    const g = this.gridSize;
    return { x: Math.round(pt.x/g)*g, y: Math.round(pt.y/g)*g };
  }

  _evPt(e) {
    const r = this.canvas.getBoundingClientRect();
    return this._snap(this._sToW(e.clientX-r.left, e.clientY-r.top));
  }

  /* ────────── MOUSE EVENTS ────────── */
  _onDown(e) {
    const pt = this._evPt(e);

    if (e.button === 1 || this.tool === 'hand') {
      this._panStart = { ex:e.clientX, ey:e.clientY, ox:this.offset.x, oy:this.offset.y };
      if (this.tool === 'hand') this.canvas.style.cursor = 'grabbing';
      return;
    }

    // أداة التكبير: نقرة = تكبير، Alt+نقرة = تصغير — حول نقطة المؤشر
    if (this.tool === 'zoom') { this._zoomAt(pt, e.altKey ? 1/1.3 : 1.3); return; }

    // أدوات العُقَد (تحرير/إضافة/حذف/تحويل نقاط الربط)
    if (this.tool && this.tool.indexOf('node') === 0) { this._nodeDown(pt); return; }

    if (this.tool === 'select') {
      this.selectedIdx = this._hitTest(pt);
      if (this.selectedIdx >= 0) {
        this.dragOffset = { dx: pt.x - this._shapeOrigin(this.shapes[this.selectedIdx]).x,
                            dy: pt.y - this._shapeOrigin(this.shapes[this.selectedIdx]).y };
      }
      this._updateShapeToolbar();
      this.render();
      return;
    }

    if (this.tool === 'polyline') {
      if (!this.isDrawing) { this.isDrawing=true; this.currentPath=[pt]; }
      else { this.currentPath.push(pt); }
      this.render();
      return;
    }

    if (this.tool === 'freehand') {
      this.isDrawing = true;
      this.currentPath = [pt];
      return;
    }

    this.isDrawing = true;
    this.startPt   = pt;
  }

  _onMove(e) {
    const r  = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;

    if (this._panStart) {
      this.offset.x = this._panStart.ox + (e.clientX - this._panStart.ex);
      this.offset.y = this._panStart.oy + (e.clientY - this._panStart.ey);
      this.render(); return;
    }

    const pt = this._snap(this._sToW(sx, sy));
    const cx = pt.x.toFixed(3), cy = pt.y.toFixed(3);
    if (this._lastX !== cx) { const el=document.getElementById('cur-x'); if(el) el.textContent=cx; this._lastX=cx; }
    if (this._lastY !== cy) { const el=document.getElementById('cur-y'); if(el) el.textContent=cy; this._lastY=cy; }

    if (this._nodeDrag && e.buttons===1) { this._nodeMoveTo(pt); return; }

    if (this.tool === 'select' && this.selectedIdx>=0 && e.buttons===1 && this.dragOffset) {
      this._moveShape(this.shapes[this.selectedIdx], pt.x-this.dragOffset.dx, pt.y-this.dragOffset.dy);
      this.render(); return;
    }

    if (this.tool === 'freehand' && this.isDrawing) {
      this.currentPath.push(pt);
      this.render(); return;
    }

    this.previewPt = pt;
    if (this.isDrawing) this.render();
    // Update snap indicator even when not drawing
    else if (this.snapGrid && this.tool !== 'select' && this.tool !== 'hand') {
      this.render();
    }
  }

  _onUp(e) {
    if (this._panStart) {
      this._panStart = null;
      if (this.tool === 'hand') this.canvas.style.cursor = 'grab';
      return;
    }
    if (this._nodeDrag) { this._nodeDrag = null; this._updateStatus?.(); return; }
    if (!this.isDrawing || !this.startPt) return;
    if (this.tool==='polyline' || this.tool==='freehand') return;

    const pt = this._evPt(e);
    const d  = Math.hypot(pt.x-this.startPt.x, pt.y-this.startPt.y);

    if (d > 0.01) {
      this._saveHistory();
      const shape = this._buildShape(this.startPt, pt);
      if (shape) this.shapes.push(shape);
    }

    this.isDrawing = false; this.startPt=null; this.previewPt=null;
    this.render(); this._updateStatus();
  }

  _onDbl(e) {
    if (this.tool==='polyline' && this.currentPath.length>=2) this._finishPolyline();
    else if (this.tool==='freehand' && this.currentPath.length>=2) this._finishFreehand();
  }

  _onWheel(e) {
    e.preventDefault();
    const r  = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f  = e.deltaY < 0 ? 1.1 : 0.9;
    this.offset.x = mx - f*(mx-this.offset.x);
    this.offset.y = my - f*(my-this.offset.y);
    this.scale = Math.max(0.05, Math.min(50, this.scale*f));
    const el = document.getElementById('canvas-zoom');
    if (el) el.textContent = Math.round(this.scale/2*100)+'%';
    this.render();
  }

  /* ────────── ZOOM TOOL ────────── */
  _zoomAt(pt, f) {
    const before = this._wToS(pt.x, pt.y);
    this.scale = Math.max(0.05, Math.min(50, this.scale * f));
    const after = this._wToS(pt.x, pt.y);
    this.offset.x += before.x - after.x;
    this.offset.y += before.y - after.y;
    const el = document.getElementById('canvas-zoom');
    if (el) el.textContent = Math.round(this.scale/2*100) + '%';
    this.render();
  }

  /* ────────── NODE (ANCHOR) EDITING — أدوات على نمط Illustrator ────────── */
  // مسار قابل للتحرير = يملك مصفوفة نقاط (بولي‌خط، مضلع، حر، مستورد SVG…)
  _editablePts(s) { return (s && Array.isArray(s.points) && s.points.length >= 2) ? s.points : null; }

  _pickEditable(pt) {
    if (this.selectedIdx >= 0 && this._editablePts(this.shapes[this.selectedIdx])) return this.selectedIdx;
    const i = this._hitTest(pt);
    if (i >= 0 && this._editablePts(this.shapes[i])) { this.selectedIdx = i; this._updateShapeToolbar?.(); return i; }
    return -1;
  }

  _hitAnchor(pts, pt) {
    const tol = 9 / this.scale;
    let best = -1, bd = tol;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pt.x, pts[i].y - pt.y);
      if (d <= bd) { bd = d; best = i; }
    }
    return best;
  }

  _distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx*dx + dy*dy;
    if (!L) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x)*dx + (p.y - a.y)*dy) / L;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t*dx), p.y - (a.y + t*dy));
  }

  _nearestSeg(pts, pt, closed) {
    const n = pts.length, m = closed ? n : n - 1;
    let best = -1, bd = Infinity;
    for (let i = 0; i < m; i++) {
      const d = this._distToSeg(pt, pts[i], pts[(i+1) % n]);
      if (d < bd) { bd = d; best = i; }
    }
    return (best >= 0 && bd <= 14 / this.scale) ? best : -1;
  }

  _nodeDown(pt) {
    let idx = this._pickEditable(pt);
    if (idx < 0) {
      // شكل بارامتري (مستطيل/دائرة…) تحت المؤشر؟ حوّله تلقائياً إلى مسار كي يصبح قابلاً للتحرير
      const hit = this._hitTest(pt);
      if (hit >= 0 && !this._editablePts(this.shapes[hit])) {
        const np = this._toPath(this.shapes[hit]);
        if (np) {
          this._saveHistory();
          this.shapes[hit] = np; this.selectedIdx = hit; idx = hit;
          window.app?.toast?.('حُوّل الشكل إلى مسار — حرّر عُقَده الآن', 'info');
        }
      }
      if (idx < 0) {
        this.selectedIdx = hit; this._updateShapeToolbar?.(); this.render();
        if (this.selectedIdx < 0) window.app?.toast?.('انقر على شكل لتحرير عُقَده', 'info');
        return;
      }
    }
    const s = this.shapes[idx], pts = s.points;
    const ai = this._hitAnchor(pts, pt);
    const mode = this.tool === 'node-add' ? 'add'
               : this.tool === 'node-del' ? 'del'
               : this.tool === 'node-conv' ? 'conv' : 'move';

    if (mode === 'del') {
      if (ai >= 0 && pts.length > 2) { this._saveHistory(); pts.splice(ai, 1); this.render(); this._updateStatus?.(); }
      else if (ai >= 0) window.app?.toast?.('لا يمكن الحذف — يلزم نقطتان على الأقل', 'warn');
      return;
    }
    if (mode === 'conv') {
      // تحويل الزاوية إلى نقطة أنعم بتقريبها من متوسط جارَيها
      if (ai >= 0 && pts.length >= 3) {
        this._saveHistory();
        const a = pts[(ai - 1 + pts.length) % pts.length], b = pts[(ai + 1) % pts.length];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pts[ai] = { x: (pts[ai].x + mid.x) / 2, y: (pts[ai].y + mid.y) / 2 };
        this.render();
      }
      return;
    }
    if (mode === 'add') {
      const seg = this._nearestSeg(pts, pt, s.closed);
      if (seg >= 0) { this._saveHistory(); pts.splice(seg + 1, 0, { x: pt.x, y: pt.y }); this.render(); this._updateStatus?.(); }
      else window.app?.toast?.('اقترب أكثر من المسار لإضافة نقطة', 'info');
      return;
    }
    // move
    if (ai >= 0) { this._saveHistory(); this._nodeDrag = { idx, ai }; }
  }

  _nodeMoveTo(pt) {
    const s = this.shapes[this._nodeDrag.idx];
    if (!s || !s.points) return;
    s.points[this._nodeDrag.ai] = { x: pt.x, y: pt.y };
    this.render();
  }

  _drawNodes() {
    if (!this.tool || this.tool.indexOf('node') !== 0) return;
    const s = this.shapes[this.selectedIdx], pts = this._editablePts(s);
    if (!pts) return;
    const ctx = this.ctx;
    ctx.save(); ctx.setLineDash([]);
    for (let i = 0; i < pts.length; i++) {
      const sp = this._wToS(pts[i].x, pts[i].y);
      const active = this._nodeDrag && this._nodeDrag.ai === i;
      ctx.fillStyle = active ? '#3fb950' : '#0d1117';
      ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(sp.x - 4, sp.y - 4, 8, 8); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  /* ── تحويل أي شكل إلى مسار نقاط قابل للتحرير (نفس هندسة الرسم) ── */
  _toPath(s) {
    if (!s) return null;
    const N = 64;
    const poly = (points, closed) => ({ type: 'polyline', points, closed });
    switch (s.type) {
      case 'polyline':
        return poly(s.points.map(p => ({ x: p.x, y: p.y })), !!s.closed);
      case 'polygon':
        return poly(s.points.map(p => ({ x: p.x, y: p.y })), true);
      case 'line':
        return poly([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], false);
      case 'rect':
        return poly([{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y },
                     { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }], true);
      case 'circle': {
        const p = []; for (let i = 0; i < N; i++) { const a = 2*Math.PI*i/N; p.push({ x: s.cx + s.r*Math.cos(a), y: s.cy + s.r*Math.sin(a) }); }
        return poly(p, true);
      }
      case 'ellipse': {
        const rx = s.rx||1, ry = s.ry||1, p = [];
        for (let i = 0; i < N; i++) { const a = 2*Math.PI*i/N; p.push({ x: s.cx + rx*Math.cos(a), y: s.cy + ry*Math.sin(a) }); }
        return poly(p, true);
      }
      case 'arc': {
        let sweep = s.endAngle - s.startAngle;
        if (s.clockwise) { if (sweep > 0) sweep -= 2*Math.PI; } else { if (sweep < 0) sweep += 2*Math.PI; }
        const steps = Math.max(8, Math.ceil(Math.abs(sweep)/(2*Math.PI)*N)), p = [];
        for (let i = 0; i <= steps; i++) { const a = s.startAngle + sweep*i/steps; p.push({ x: s.cx + s.r*Math.cos(a), y: s.cy + s.r*Math.sin(a) }); }
        return poly(p, false);
      }
      case 'slot': {
        const a = Math.atan2(s.cy2 - s.cy1, s.cx2 - s.cx1), r = s.r||1, half = N/2, p = [];
        for (let i = 0; i <= half; i++) { const t = a - Math.PI/2 + Math.PI*i/half; p.push({ x: s.cx2 + r*Math.cos(t), y: s.cy2 + r*Math.sin(t) }); }
        for (let i = 0; i <= half; i++) { const t = a + Math.PI/2 + Math.PI*i/half; p.push({ x: s.cx1 + r*Math.cos(t), y: s.cy1 + r*Math.sin(t) }); }
        return poly(p, true);
      }
      case 'compound':
        return (s.contours && s.contours[0] && s.contours[0].length >= 2)
          ? poly(s.contours[0].map(p => ({ x: p.x, y: p.y })), true) : null;
      default:
        return (Array.isArray(s.points) && s.points.length >= 2)
          ? poly(s.points.map(p => ({ x: p.x, y: p.y })), s.closed !== false) : null;
    }
  }

  /* ── «تحويل إلى مسار» للأشكال المحددة — يفتح كل شكل للتحرير بالعُقَد ── */
  convertSelectedToPath() {
    const idxs = new Set();
    if (this.selectedIdx >= 0) idxs.add(this.selectedIdx);
    if (this.msel) for (const i of this.msel) idxs.add(i);
    if (!idxs.size) { window.app?.toast?.('حدد شكلاً أولاً', 'warn'); return; }
    let converted = 0, already = 0;
    this._saveHistory();
    for (const i of idxs) {
      const s = this.shapes[i];
      if (s && (s.type === 'polyline')) { already++; continue; }
      const np = this._toPath(s);
      if (np) { this.shapes[i] = np; converted++; }
    }
    this.render(); this._updateShapeToolbar?.(); this._updateStatus?.();
    if (converted) window.app?.toast?.(`✅ حُوّل ${converted} شكل إلى مسار قابل للتحرير`, 'success');
    else window.app?.toast?.('الأشكال المحددة مسارات بالفعل', 'info');
  }

  /* ────────── SHAPE BUILDING ────────── */
  _buildShape(start, end) {
    const dx = end.x-start.x, dy = end.y-start.y;
    switch (this.tool) {
      case 'line':    return { type:'line', x1:start.x,y1:start.y, x2:end.x,y2:end.y };
      case 'rect':    return { type:'rect', x:Math.min(start.x,end.x), y:Math.min(start.y,end.y),
                                w:Math.abs(dx), h:Math.abs(dy) };
      case 'circle':  return { type:'circle', cx:start.x,cy:start.y, r:Math.hypot(dx,dy) };
      case 'ellipse': return { type:'ellipse', cx:start.x,cy:start.y,
                                rx:Math.abs(dx)||1, ry:Math.abs(dy)||1 };
      case 'arc':     return { type:'arc', cx:start.x,cy:start.y, r:Math.hypot(dx,dy),
                                startAngle:0, endAngle:Math.PI*1.5, clockwise:true };
      case 'polygon': {
        const r = Math.hypot(dx,dy);
        const sides = this.polygonSides;
        const pts = [];
        for(let i=0;i<sides;i++){
          const a=(i/sides)*Math.PI*2-Math.PI/2;
          pts.push({x:start.x+Math.cos(a)*r, y:start.y+Math.sin(a)*r});
        }
        return { type:'polygon', cx:start.x, cy:start.y, r, sides, points:pts };
      }
      case 'slot': {
        const el = document.getElementById('slot-width');
        const r = el ? Math.max(0.5, parseFloat(el.value)/2) : this.slotRadius;
        return { type:'slot', cx1:start.x, cy1:start.y, cx2:end.x, cy2:end.y, r };
      }
      default: return null;
    }
  }

  _finishPolyline() {
    if (this.currentPath.length < 2) { this._cancelDraw(); return; }
    this._saveHistory();
    this.shapes.push({ type:'polyline', points:[...this.currentPath], closed:false });
    this.currentPath=[]; this.isDrawing=false;
    this.render(); this._updateStatus();
  }

  _finishFreehand() {
    if (this.currentPath.length < 2) { this._cancelDraw(); return; }
    const simp = this._rdp(this.currentPath, 0.5);
    this._saveHistory();
    this.shapes.push({ type:'polyline', points:simp, closed:false });
    this.currentPath=[]; this.isDrawing=false;
    this.render(); this._updateStatus();
  }

  _rdp(pts, eps) {
    if (pts.length <= 2) return pts;
    let dmax=0, idx=0;
    for (let i=1;i<pts.length-1;i++){
      const d=this._ptLineDist(pts[i],pts[0],pts[pts.length-1]);
      if(d>dmax){dmax=d;idx=i;}
    }
    if(dmax>eps){
      const r1=this._rdp(pts.slice(0,idx+1),eps);
      const r2=this._rdp(pts.slice(idx),eps);
      return [...r1.slice(0,-1),...r2];
    }
    return [pts[0],pts[pts.length-1]];
  }

  _ptLineDist(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(!len) return Math.hypot(p.x-a.x,p.y-a.y);
    return Math.abs(dx*(a.y-p.y)-(a.x-p.x)*dy)/len;
  }

  /* ────────── SELECTION ────────── */
  _hitTest(pt) {
    for (let i=this.shapes.length-1;i>=0;i--) {
      if (this._isNear(this.shapes[i],pt)) return i;
    }
    return -1;
  }

  _isNear(s,pt,tol=3/this.scale){
    switch(s.type){
      case 'line':     return this._ptLineDist(pt,{x:s.x1,y:s.y1},{x:s.x2,y:s.y2})<tol;
      case 'rect':     return pt.x>s.x-tol&&pt.x<s.x+s.w+tol&&pt.y>s.y-tol&&pt.y<s.y+s.h+tol;
      case 'circle':   { const d=Math.hypot(pt.x-s.cx,pt.y-s.cy); return Math.abs(d-s.r)<tol; }
      case 'arc':      { const d=Math.hypot(pt.x-s.cx,pt.y-s.cy); return Math.abs(d-s.r)<tol; }
      case 'ellipse': {
        const nx=(pt.x-s.cx)/(s.rx||1), ny=(pt.y-s.cy)/(s.ry||1);
        return Math.abs(Math.hypot(nx,ny)-1) < tol / Math.min(s.rx||1,s.ry||1) * 2;
      }
      case 'polygon': {
        if(!s.points||!s.points.length) return false;
        for(let i=0;i<s.points.length;i++){
          const n=s.points[(i+1)%s.points.length];
          if(this._ptLineDist(pt,s.points[i],n)<tol) return true;
        }
        return false;
      }
      case 'slot': {
        const dx=s.cx2-s.cx1,dy=s.cy2-s.cy1,len=Math.hypot(dx,dy);
        if(len<0.001) return Math.abs(Math.hypot(pt.x-s.cx1,pt.y-s.cy1)-s.r)<tol;
        const t2=Math.max(0,Math.min(1,((pt.x-s.cx1)*dx+(pt.y-s.cy1)*dy)/(len*len)));
        const px=s.cx1+t2*dx, py=s.cy1+t2*dy;
        return Math.abs(Math.hypot(pt.x-px,pt.y-py)-s.r)<tol;
      }
      case 'polyline': for(let i=1;i<s.points.length;i++){
        if(this._ptLineDist(pt,s.points[i-1],s.points[i])<tol) return true;
      } return false;
      case 'compound': {
        if(!s.contours) return false;
        for(const ring of s.contours){
          if(!ring||ring.length<2) continue;
          for(let i=0;i<ring.length;i++){
            const n=ring[(i+1)%ring.length];
            if(this._ptLineDist(pt,ring[i],n)<tol) return true;
          }
        }
        return false;
      }
      default: return false;
    }
  }

  _shapeOrigin(s) {
    switch(s.type){
      case 'line':     return {x:s.x1,y:s.y1};
      case 'rect':     return {x:s.x,y:s.y};
      case 'circle':   return {x:s.cx,y:s.cy};
      case 'arc':      return {x:s.cx,y:s.cy};
      case 'ellipse':  return {x:s.cx,y:s.cy};
      case 'polygon':  return {x:s.cx,y:s.cy};
      case 'slot':     return {x:s.cx1,y:s.cy1};
      case 'polyline': return s.points[0]||{x:0,y:0};
      case 'compound': return (s.contours&&s.contours[0]&&s.contours[0][0])||{x:0,y:0};
      default:         return {x:0,y:0};
    }
  }

  _moveShape(s, nx, ny) {
    const o = this._shapeOrigin(s);
    const dx=nx-o.x, dy=ny-o.y;
    this._offsetShape(s, dx, dy);
  }

  _offsetShape(s, dx, dy) {
    switch(s.type){
      case 'line':     s.x1+=dx;s.y1+=dy;s.x2+=dx;s.y2+=dy; break;
      case 'rect':     s.x+=dx;s.y+=dy; break;
      case 'circle':   s.cx+=dx;s.cy+=dy; break;
      case 'arc':      s.cx+=dx;s.cy+=dy; break;
      case 'ellipse':  s.cx+=dx;s.cy+=dy; break;
      case 'polygon':
        s.cx+=dx;s.cy+=dy;
        if(s.points) s.points=s.points.map(p=>({...p,x:p.x+dx,y:p.y+dy}));
        break;
      case 'slot':     s.cx1+=dx;s.cy1+=dy;s.cx2+=dx;s.cy2+=dy; break;
      case 'polyline': s.points=s.points.map(p=>({...p,x:p.x+dx,y:p.y+dy})); break;
      case 'compound':
        if(s.contours) s.contours=s.contours.map(r=>r.map(p=>({x:p.x+dx,y:p.y+dy})));
        break;
    }
  }

  _deleteSelected() {
    if (this.selectedIdx<0) return;
    this._saveHistory();
    this.shapes.splice(this.selectedIdx,1);
    this.selectedIdx=-1;
    this._updateShapeToolbar();
    this.render(); this._updateStatus();
  }

  _cancelDraw() {
    this.isDrawing=false; this.startPt=null;
    this.previewPt=null; this.currentPath=[];
    if (this.tool === 'select') { this.selectedIdx=-1; this._updateShapeToolbar(); }
    this.render();
  }

  /* ────────── CLIPBOARD (Copy/Paste/Duplicate) ────────── */
  _copy() {
    if (this.selectedIdx < 0 || this.selectedIdx >= this.shapes.length) return;
    this._clipboard = JSON.parse(JSON.stringify(this.shapes[this.selectedIdx]));
    this._updateShapeToolbar();
  }

  _paste() {
    if (!this._clipboard) return;
    this._saveHistory();
    const clone = JSON.parse(JSON.stringify(this._clipboard));
    this._offsetShape(clone, 10, 10);
    this.shapes.push(clone);
    this.selectedIdx = this.shapes.length - 1;
    this._updateShapeToolbar();
    this.render(); this._updateStatus();
  }

  _duplicate() {
    if (this.selectedIdx < 0) return;
    this._copy();
    this._paste();
  }

  /* ────────── TRANSFORM: MIRROR ────────── */
  mirrorSelected(axis) {
    if (this.selectedIdx < 0) return;
    this._saveHistory();
    const s = this.shapes[this.selectedIdx];
    const b = this._bounds(s);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this._mirrorShape(s, axis, cx, cy);
    this.render();
  }

  _mirrorShape(s, axis, cx, cy) {
    const mx = (x) => axis==='h' ? 2*cx - x : x;
    const my = (y) => axis==='v' ? 2*cy - y : y;
    switch(s.type){
      case 'line':
        s.x1=mx(s.x1); s.y1=my(s.y1); s.x2=mx(s.x2); s.y2=my(s.y2); break;
      case 'rect':
        if(axis==='h') s.x = 2*cx - s.x - s.w;
        else s.y = 2*cy - s.y - s.h;
        break;
      case 'circle': s.cx=mx(s.cx); s.cy=my(s.cy); break;
      case 'arc':
        s.cx=mx(s.cx); s.cy=my(s.cy);
        if(axis==='h'){
          const sa=Math.PI-s.startAngle, ea=Math.PI-s.endAngle;
          s.startAngle=ea; s.endAngle=sa; s.clockwise=!s.clockwise;
        } else {
          const sa=-s.startAngle, ea=-s.endAngle;
          s.startAngle=ea; s.endAngle=sa; s.clockwise=!s.clockwise;
        }
        break;
      case 'ellipse': s.cx=mx(s.cx); s.cy=my(s.cy); break;
      case 'polygon':
        s.cx=mx(s.cx); s.cy=my(s.cy);
        if(s.points) s.points=s.points.map(p=>({...p,x:mx(p.x),y:my(p.y)}));
        break;
      case 'slot':
        s.cx1=mx(s.cx1); s.cy1=my(s.cy1);
        s.cx2=mx(s.cx2); s.cy2=my(s.cy2); break;
      case 'polyline':
        s.points=s.points.map(p=>({...p,x:mx(p.x),y:my(p.y)})); break;
      case 'compound':
        if(s.contours) s.contours=s.contours.map(r=>r.map(p=>({x:mx(p.x),y:my(p.y)})));
        break;
    }
  }

  /* ────────── TRANSFORM: ROTATE ────────── */
  rotateSelected(angleDeg) {
    if (this.selectedIdx < 0) return;
    this._saveHistory();
    const s = this.shapes[this.selectedIdx];
    const b = this._bounds(s);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this._rotateShape(s, angleDeg * Math.PI / 180, cx, cy);
    this.render();
  }

  _rotateShape(s, theta, cx, cy) {
    const rot = (x, y) => ({
      x: cx + (x-cx)*Math.cos(theta) - (y-cy)*Math.sin(theta),
      y: cy + (x-cx)*Math.sin(theta) + (y-cy)*Math.cos(theta)
    });
    switch(s.type){
      case 'line': {
        const p1=rot(s.x1,s.y1),p2=rot(s.x2,s.y2);
        s.x1=p1.x;s.y1=p1.y;s.x2=p2.x;s.y2=p2.y; break;
      }
      case 'rect': {
        const pts=[rot(s.x,s.y),rot(s.x+s.w,s.y),rot(s.x+s.w,s.y+s.h),rot(s.x,s.y+s.h)];
        Object.assign(s,{type:'polyline',points:pts,closed:true});
        delete s.x;delete s.y;delete s.w;delete s.h; break;
      }
      case 'circle': { const c=rot(s.cx,s.cy);s.cx=c.x;s.cy=c.y; break; }
      case 'arc': {
        const c=rot(s.cx,s.cy);s.cx=c.x;s.cy=c.y;
        s.startAngle+=theta;s.endAngle+=theta; break;
      }
      case 'ellipse': { const c=rot(s.cx,s.cy);s.cx=c.x;s.cy=c.y; break; }
      case 'polygon': {
        const c=rot(s.cx,s.cy);s.cx=c.x;s.cy=c.y;
        if(s.points) s.points=s.points.map(p=>{const r=rot(p.x,p.y);return{...p,x:r.x,y:r.y};});
        break;
      }
      case 'slot': {
        const p1=rot(s.cx1,s.cy1),p2=rot(s.cx2,s.cy2);
        s.cx1=p1.x;s.cy1=p1.y;s.cx2=p2.x;s.cy2=p2.y; break;
      }
      case 'polyline': {
        s.points=s.points.map(p=>{const r=rot(p.x,p.y);return{...p,x:r.x,y:r.y};}); break;
      }
      case 'compound':
        if(s.contours) s.contours=s.contours.map(r=>r.map(p=>{const rp=rot(p.x,p.y);return{x:rp.x,y:rp.y};}));
        break;
    }
  }

  /* ────────── TRANSFORM: SCALE ────────── */
  scaleSelected(factorX, factorY) {
    if (this.selectedIdx < 0) return;
    this._saveHistory();
    const s = this.shapes[this.selectedIdx];
    const b = this._bounds(s);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this._scaleShape(s, factorX, factorY||factorX, cx, cy);
    this.render();
  }

  _scaleShape(s, fx, fy, cx, cy) {
    const sc = (x,y) => ({ x: cx+(x-cx)*fx, y: cy+(y-cy)*fy });
    switch(s.type){
      case 'line': {
        const p1=sc(s.x1,s.y1),p2=sc(s.x2,s.y2);
        s.x1=p1.x;s.y1=p1.y;s.x2=p2.x;s.y2=p2.y; break;
      }
      case 'rect': {
        const p=sc(s.x,s.y);s.x=p.x;s.y=p.y;s.w*=fx;s.h*=fy; break;
      }
      case 'circle': {
        const c=sc(s.cx,s.cy);s.cx=c.x;s.cy=c.y;s.r*=(fx+fy)/2; break;
      }
      case 'arc': {
        const c=sc(s.cx,s.cy);s.cx=c.x;s.cy=c.y;s.r*=(fx+fy)/2; break;
      }
      case 'ellipse': {
        const c=sc(s.cx,s.cy);s.cx=c.x;s.cy=c.y;s.rx*=fx;s.ry*=fy; break;
      }
      case 'polygon': {
        const c=sc(s.cx,s.cy);s.cx=c.x;s.cy=c.y;s.r*=(fx+fy)/2;
        if(s.points) s.points=s.points.map(p=>{const sp=sc(p.x,p.y);return{...p,x:sp.x,y:sp.y};});
        break;
      }
      case 'slot': {
        const p1=sc(s.cx1,s.cy1),p2=sc(s.cx2,s.cy2);
        s.cx1=p1.x;s.cy1=p1.y;s.cx2=p2.x;s.cy2=p2.y;s.r*=(fx+fy)/2; break;
      }
      case 'polyline': {
        s.points=s.points.map(p=>{const sp=sc(p.x,p.y);return{...p,x:sp.x,y:sp.y};}); break;
      }
      case 'compound':
        if(s.contours) s.contours=s.contours.map(r=>r.map(p=>{const sp=sc(p.x,p.y);return{x:sp.x,y:sp.y};}));
        break;
    }
  }

  /* ────────── TRANSFORM: ARRAY ────────── */
  arraySelected(opts) {
    if (this.selectedIdx < 0) return;
    this._saveHistory();
    const s = this.shapes[this.selectedIdx];
    const copies = [];

    if (opts.type === 'rect') {
      const { rows=3, cols=3, spacingX=20, spacingY=20 } = opts;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (row === 0 && col === 0) continue;
          const clone = JSON.parse(JSON.stringify(s));
          this._offsetShape(clone, col * spacingX, row * spacingY);
          copies.push(clone);
        }
      }
    } else if (opts.type === 'circular') {
      const { count=6, radius=30 } = opts;
      const b = this._bounds(s);
      const bx = (b.minX + b.maxX) / 2, by = (b.minY + b.maxY) / 2;
      for (let i = 1; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const clone = JSON.parse(JSON.stringify(s));
        this._offsetShape(clone, radius * Math.cos(angle) - bx + bx, radius * Math.sin(angle));
        this._offsetShape(clone, radius * Math.cos(angle), radius * Math.sin(angle));
        copies.push(clone);
      }
    }

    this.shapes.push(...copies);
    this.render(); this._updateStatus();
  }

  /* ────────── SHAPE TOOLBAR ────────── */
  _updateShapeToolbar() {
    const bar = document.getElementById('shape-toolbar');
    if (!bar) return;
    const hasSel = this.selectedIdx >= 0 && this.selectedIdx < this.shapes.length;
    bar.style.display = hasSel ? 'flex' : 'none';
    const pasteBtn = document.getElementById('st-paste');
    if (pasteBtn) pasteBtn.classList.toggle('has-clipboard', !!this._clipboard);
  }

  /* ────────── HISTORY ────────── */
  _saveHistory() {
    this.history.push(JSON.parse(JSON.stringify(this.shapes)));
    this.redoStack=[];
    if(this.history.length>50) this.history.shift();
  }

  undo() {
    if(!this.history.length) return;
    this.redoStack.push(JSON.parse(JSON.stringify(this.shapes)));
    this.shapes=this.history.pop();
    this.selectedIdx=-1; this._updateShapeToolbar();
    this.render(); this._updateStatus();
  }

  redo() {
    if(!this.redoStack.length) return;
    this.history.push(JSON.parse(JSON.stringify(this.shapes)));
    this.shapes=this.redoStack.pop();
    this.selectedIdx=-1; this._updateShapeToolbar();
    this.render(); this._updateStatus();
  }

  clear() {
    this._saveHistory();
    this.shapes=[]; this.selectedIdx=-1;
    this.currentPath=[]; this.isDrawing=false;
    this._updateShapeToolbar();
    this.render(); this._updateStatus();
  }

  /* ────────── RENDER ────────── */
  render() {
    const {ctx,canvas} = this;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#0d1117';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    if(this.showGrid) this._drawGrid();
    this._drawAxes();

    this.shapes.forEach((s,i) => {
      const sel = i===this.selectedIdx;
      const aiHL = this._aiHighlights && this._aiHighlights.has(i);

      if(aiHL){ ctx.shadowColor='rgba(255,211,61,.35)'; ctx.shadowBlur=12; ctx.strokeStyle='#ffd33d'; ctx.lineWidth=3; }
      else { ctx.shadowBlur=0; ctx.strokeStyle=sel?'#f85149':(s.stroke||'#2f81f7'); ctx.lineWidth=sel?2:1.5; }

      ctx.setLineDash([]);
      this._drawShape(s);

      const o=this._shapeOrigin(s), sp=this._wToS(o.x,o.y);
      ctx.fillStyle=aiHL?'#ffd33d':(sel?'#f85149':'#58a6ff');
      ctx.beginPath(); ctx.arc(sp.x,sp.y,3,0,Math.PI*2); ctx.fill();

      // Selection handles
      if(sel){ this._drawSelectionBox(s); }

      ctx.shadowBlur=0; ctx.shadowColor='transparent';
    });

    this._drawNodes();

    if(this.isDrawing && this.startPt && this.previewPt){
      ctx.strokeStyle='#3fb950'; ctx.lineWidth=1.5; ctx.setLineDash([6,3]);
      this._drawPreview(this.startPt, this.previewPt);
      ctx.setLineDash([]);
    }

    if(this.currentPath.length>0){
      ctx.strokeStyle='#3fb950'; ctx.lineWidth=1.5; ctx.setLineDash([6,3]);
      ctx.beginPath();
      const p0=this._wToS(this.currentPath[0].x,this.currentPath[0].y);
      ctx.moveTo(p0.x,p0.y);
      this.currentPath.forEach(p=>{ const s=this._wToS(p.x,p.y); ctx.lineTo(s.x,s.y); });
      if(this.previewPt){ const pv=this._wToS(this.previewPt.x,this.previewPt.y); ctx.lineTo(pv.x,pv.y); }
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Snap visual indicator
    if(this.snapGrid && this.previewPt && this.tool!=='select' && this.tool!=='hand'){
      const sp=this._wToS(this.previewPt.x, this.previewPt.y);
      ctx.save();
      ctx.strokeStyle='rgba(255,140,0,0.9)'; ctx.lineWidth=1.5; ctx.setLineDash([]);
      const sz=7;
      ctx.beginPath();
      ctx.moveTo(sp.x-sz,sp.y); ctx.lineTo(sp.x+sz,sp.y);
      ctx.moveTo(sp.x,sp.y-sz); ctx.lineTo(sp.x,sp.y+sz);
      ctx.stroke();
      ctx.strokeStyle='rgba(255,140,0,0.3)';
      ctx.beginPath(); ctx.arc(sp.x,sp.y,5,0,Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }

  _drawSelectionBox(s) {
    const {ctx}=this;
    const b=this._bounds(s);
    const p1=this._wToS(b.minX,b.minY), p2=this._wToS(b.maxX,b.maxY);
    ctx.save();
    ctx.strokeStyle='rgba(248,81,73,0.5)'; ctx.lineWidth=1; ctx.setLineDash([4,3]);
    ctx.strokeRect(p1.x-3,p1.y-3,(p2.x-p1.x)+6,(p2.y-p1.y)+6);
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawGrid() {
    const {ctx,canvas,gridSize,scale,offset}=this;
    let step=gridSize*scale;
    if(step<0.1) return;
    while(step<8) step*=5;
    ctx.strokeStyle='#161b22'; ctx.lineWidth=0.5;
    const startX=offset.x%step, startY=offset.y%step;
    for(let x=startX;x<canvas.width;x+=step){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke(); }
    for(let y=startY;y<canvas.height;y+=step){ ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke(); }
  }

  _drawAxes() {
    const {ctx,canvas,offset}=this;
    ctx.strokeStyle='#21262d'; ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(0,offset.y);ctx.lineTo(canvas.width,offset.y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(offset.x,0);ctx.lineTo(offset.x,canvas.height);ctx.stroke();
    const o=this._wToS(0,0);
    ctx.fillStyle='#30363d'; ctx.font='10px monospace';
    ctx.fillText('0,0',o.x+4,o.y-4);
  }

  _drawShape(s) {
    const {ctx}=this;
    ctx.beginPath(); ctx.lineCap='round'; ctx.lineJoin='round';
    switch(s.type){
      case 'line': { const a=this._wToS(s.x1,s.y1),b=this._wToS(s.x2,s.y2); ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y); break; }
      case 'rect': { const p=this._wToS(s.x,s.y+s.h); ctx.rect(p.x,p.y,s.w*this.scale,s.h*this.scale); break; }
      case 'circle': { const c=this._wToS(s.cx,s.cy); ctx.arc(c.x,c.y,s.r*this.scale,0,Math.PI*2); break; }
      case 'ellipse': { const c=this._wToS(s.cx,s.cy); ctx.ellipse(c.x,c.y,(s.rx||1)*this.scale,(s.ry||1)*this.scale,0,0,Math.PI*2); break; }
      case 'arc': { const c=this._wToS(s.cx,s.cy); ctx.arc(c.x,c.y,s.r*this.scale,-s.startAngle,-s.endAngle,s.clockwise); break; }
      case 'polygon': {
        if(!s.points||s.points.length<3) break;
        const p0=this._wToS(s.points[0].x,s.points[0].y); ctx.moveTo(p0.x,p0.y);
        for(let i=1;i<s.points.length;i++){ const p=this._wToS(s.points[i].x,s.points[i].y); ctx.lineTo(p.x,p.y); }
        ctx.closePath(); break;
      }
      case 'slot': {
        const p1=this._wToS(s.cx1,s.cy1),p2=this._wToS(s.cx2,s.cy2);
        const dx=p2.x-p1.x,dy=p2.y-p1.y,len=Math.hypot(dx,dy),r=(s.r||1)*this.scale;
        if(len<0.001){ctx.arc(p1.x,p1.y,r,0,Math.PI*2);break;}
        const angle=Math.atan2(dy,dx);
        ctx.arc(p2.x,p2.y,r,angle-Math.PI/2,angle+Math.PI/2,false);
        ctx.arc(p1.x,p1.y,r,angle+Math.PI/2,angle-Math.PI/2,false);
        ctx.closePath(); break;
      }
      case 'polyline': {
        if(!s.points||s.points.length<2) break;
        const p0=this._wToS(s.points[0].x,s.points[0].y); ctx.moveTo(p0.x,p0.y);
        s.points.forEach(p=>{ const ps=this._wToS(p.x,p.y); ctx.lineTo(ps.x,ps.y); });
        if(s.closed) ctx.closePath(); break;
      }
      case 'compound': {
        if(!s.contours) break;
        for(const ring of s.contours){
          if(!ring||ring.length<2) continue;
          const r0=this._wToS(ring[0].x,ring[0].y); ctx.moveTo(r0.x,r0.y);
          for(let i=1;i<ring.length;i++){ const p=this._wToS(ring[i].x,ring[i].y); ctx.lineTo(p.x,p.y); }
          ctx.closePath();
        }
        break;
      }
    }
    // تعبئة اختيارية (نظام الألوان) — لون مصمت أو تدرّج — evenodd لإبقاء فجوات compound فارغة
    if(s.fill && s.type!=='line'){
      ctx.save(); ctx.fillStyle=this._resolveFill(s.fill,s); ctx.globalAlpha=(ctx.globalAlpha||1)*0.35; ctx.fill('evenodd'); ctx.restore();
    }
    ctx.stroke();
    this._drawDimLabel(s);
  }

  // يحوّل وصف التعبئة إلى نمط canvas: نص لوني مصمت، أو تدرّج خطي/شعاعي
  _resolveFill(fill, s){
    if(typeof fill==='string') return fill;
    if(!fill || !Array.isArray(fill.stops) || !fill.stops.length) return '#888';
    const b=this._bounds(s);
    const p1=this._wToS(b.minX,b.minY), p2=this._wToS(b.maxX,b.maxY);
    const cx=(p1.x+p2.x)/2, cy=(p1.y+p2.y)/2;
    let g;
    if(fill.type==='radial'){
      const r=Math.max(Math.abs(p2.x-p1.x),Math.abs(p2.y-p1.y))/2 || 1;
      g=this.ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    } else {
      const a=(fill.angle||0)*Math.PI/180, hw=Math.abs(p2.x-p1.x)/2, hh=Math.abs(p2.y-p1.y)/2;
      const dx=Math.cos(a)*hw, dy=Math.sin(a)*hh;
      g=this.ctx.createLinearGradient(cx-dx,cy-dy,cx+dx,cy+dy);
    }
    fill.stops.forEach(st=>{ try{ g.addColorStop(Math.max(0,Math.min(1,st.offset)),st.color); }catch(e){} });
    return g;
  }

  /* ─── AI highlight helpers ─── */
  highlightIndices(indices) {
    this._aiHighlights=new Set(Array.isArray(indices)?indices.map(i=>Number(i)).filter(n=>Number.isFinite(n)):[]);
    this.render();
  }
  addHighlightIndex(i) {
    if(!Number.isFinite(i)) return;
    if(!this._aiHighlights) this._aiHighlights=new Set();
    if(i>=0&&i<(this.shapes||[]).length){ this._aiHighlights.add(Number(i)); this.render(); }
  }
  removeHighlightIndex(i) { if(this._aiHighlights){this._aiHighlights.delete(Number(i));this.render();} }
  clearHighlights() { if(this._aiHighlights&&this._aiHighlights.size){this._aiHighlights.clear();this.render();} }

  _drawDimLabel(s) {
    const {ctx}=this;
    ctx.font='10px monospace'; ctx.fillStyle='rgba(88,166,255,0.6)'; ctx.textAlign='center';
    switch(s.type){
      case 'line': { const d=Math.hypot(s.x2-s.x1,s.y2-s.y1),mp=this._wToS((s.x1+s.x2)/2,(s.y1+s.y2)/2); ctx.fillText(d.toFixed(1)+'mm',mp.x,mp.y-5); break; }
      case 'rect': { const c=this._wToS(s.x+s.w/2,s.y+s.h/2); ctx.fillText(`${s.w.toFixed(1)}×${s.h.toFixed(1)}`,c.x,c.y); break; }
      case 'circle': { const p=this._wToS(s.cx+s.r,s.cy); ctx.fillText('⌀'+((s.r*2).toFixed(1)),p.x+15,p.y); break; }
      case 'ellipse': { const c=this._wToS(s.cx,s.cy); ctx.fillText(`${(s.rx*2).toFixed(1)}×${(s.ry*2).toFixed(1)}`,c.x,c.y-((s.ry||1)*this.scale+8)); break; }
      case 'polygon': { const p=this._wToS(s.cx,s.cy-(s.r||0)); ctx.fillText(`${s.sides}×⌀${((s.r||0)*2).toFixed(1)}`,p.x,p.y-6); break; }
      case 'slot': { const d=Math.hypot(s.cx2-s.cx1,s.cy2-s.cy1),mp=this._wToS((s.cx1+s.cx2)/2,(s.cy1+s.cy2)/2); ctx.fillText(`${(d+s.r*2).toFixed(1)}×${(s.r*2).toFixed(1)}`,mp.x,mp.y-(s.r||0)*this.scale-5); break; }
    }
    ctx.textAlign='start';
  }

  _drawPreview(start, end) {
    const {ctx}=this;
    switch(this.tool){
      case 'line': { const a=this._wToS(start.x,start.y),b=this._wToS(end.x,end.y); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); break; }
      case 'rect': { const p=this._wToS(Math.min(start.x,end.x),Math.max(start.y,end.y)); ctx.beginPath();ctx.strokeRect(p.x,p.y,Math.abs(end.x-start.x)*this.scale,Math.abs(end.y-start.y)*this.scale); break; }
      case 'circle': { const c=this._wToS(start.x,start.y); ctx.beginPath();ctx.arc(c.x,c.y,Math.hypot(end.x-start.x,end.y-start.y)*this.scale,0,Math.PI*2);ctx.stroke(); break; }
      case 'ellipse': { const c=this._wToS(start.x,start.y),rx=Math.abs(end.x-start.x)*this.scale,ry=Math.abs(end.y-start.y)*this.scale; if(rx>0.1&&ry>0.1){ctx.beginPath();ctx.ellipse(c.x,c.y,rx,ry,0,0,Math.PI*2);ctx.stroke();} break; }
      case 'arc': { const c=this._wToS(start.x,start.y); ctx.beginPath();ctx.arc(c.x,c.y,Math.hypot(end.x-start.x,end.y-start.y)*this.scale,0,-Math.PI*1.5,true);ctx.stroke(); break; }
      case 'polygon': {
        const r=Math.hypot(end.x-start.x,end.y-start.y)*this.scale,cs=this._wToS(start.x,start.y),sides=this.polygonSides;
        ctx.beginPath();
        for(let i=0;i<=sides;i++){ const a=(i/sides)*Math.PI*2-Math.PI/2,x=cs.x+Math.cos(a)*r,y=cs.y+Math.sin(a)*r; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); }
        ctx.stroke(); break;
      }
      case 'slot': {
        const el=document.getElementById('slot-width');
        const rW=el?Math.max(0.5,parseFloat(el.value)/2):this.slotRadius;
        const p1s=this._wToS(start.x,start.y),p2s=this._wToS(end.x,end.y);
        const dx=p2s.x-p1s.x,dy=p2s.y-p1s.y,len=Math.hypot(dx,dy),r=rW*this.scale;
        if(len<0.001){ctx.beginPath();ctx.arc(p1s.x,p1s.y,r,0,Math.PI*2);ctx.stroke();break;}
        const angle=Math.atan2(dy,dx);
        ctx.beginPath();ctx.arc(p2s.x,p2s.y,r,angle-Math.PI/2,angle+Math.PI/2,false);ctx.arc(p1s.x,p1s.y,r,angle+Math.PI/2,angle-Math.PI/2,false);ctx.closePath();ctx.stroke(); break;
      }
    }
  }

  /* ────────── STATUS ────────── */
  _updateStatus() {
    const sc=document.getElementById('shape-count'),pl=document.getElementById('path-length');
    if(sc) sc.textContent=`أشكال: ${this.shapes.length}`;
    if(pl){ let t=0; this.shapes.forEach(s=>{t+=this._shapeLen(s);}); pl.textContent=`مسار: ${t.toFixed(1)} mm`; }
    this._scheduleAutosave();
  }

  /* ────────── AUTOSAVE (localStorage, debounced) ────────── */
  _scheduleAutosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem('dq_autosave', JSON.stringify({
          shapes: this.shapes,
          savedAt: new Date().toISOString(),
        }));
      } catch (e) { /* quota exceeded — skip silently */ }
    }, 1200);
  }

  // يُستدعى من App عند الإقلاع — يرجع true إذا استُرجع تصميم سابق
  restoreAutosave() {
    try {
      const raw = localStorage.getItem('dq_autosave');
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.shapes) || !saved.shapes.length) return false;
      this.shapes = saved.shapes;
      this.render(); this._updateStatus();
      return true;
    } catch (e) { return false; }
  }

  _shapeLen(s){
    switch(s.type){
      case 'line':     return Math.hypot(s.x2-s.x1,s.y2-s.y1);
      case 'rect':     return 2*(s.w+s.h);
      case 'circle':   return 2*Math.PI*s.r;
      case 'arc':      return (s.r||0)*Math.abs((s.endAngle||0)-(s.startAngle||0));
      case 'ellipse': { const a=Math.max(s.rx||1,s.ry||1),b2=Math.min(s.rx||1,s.ry||1); return Math.PI*(3*(a+b2)-Math.sqrt((3*a+b2)*(a+3*b2))); }
      case 'polygon': { if(!s.points||s.points.length<3) return 0; let l=0; for(let i=0;i<s.points.length;i++){const n=s.points[(i+1)%s.points.length];l+=Math.hypot(n.x-s.points[i].x,n.y-s.points[i].y);} return l; }
      case 'slot': { const d=Math.hypot(s.cx2-s.cx1,s.cy2-s.cy1); return 2*d+2*Math.PI*(s.r||0); }
      case 'polyline': { let l=0; for(let i=1;i<s.points.length;i++) l+=Math.hypot(s.points[i].x-s.points[i-1].x,s.points[i].y-s.points[i-1].y); return l; }
      case 'compound': { let l=0; for(const r of (s.contours||[])){ for(let i=0;i<r.length;i++){ const n=r[(i+1)%r.length]; l+=Math.hypot(n.x-r[i].x,n.y-r[i].y); } } return l; }
      default: return 0;
    }
  }

  /* ────────── PUBLIC API ────────── */
  setTool(t) {
    this.tool=t; this._cancelDraw();
    document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
    const isNode = t && t.indexOf('node')===0;
    const cursors={select:'default',hand:'grab',zoom:'zoom-in'};
    this.canvas.style.cursor=cursors[t]||'crosshair';
    const optPoly=document.getElementById('opt-polygon'),optSlot=document.getElementById('opt-slot');
    if(optPoly) optPoly.style.display=t==='polygon'?'flex':'none';
    if(optSlot) optSlot.style.display=t==='slot'   ?'flex':'none';
    // أدوات العُقَد تُحرّر الشكل المحدد — نُبقي التحديد كي تظهر نقاط الربط فوراً
    if(t!=='select' && !isNode){ this.selectedIdx=-1; this._updateShapeToolbar(); }
    this.render();
  }

  // نسخة عميقة آمنة للتعديل (للتوليد/الحفظ الذي قد يضبط reversed)
  getShapes() { return JSON.parse(JSON.stringify(this.shapes)); }

  // قراءة فورية بلا استنساخ — للمستهلكين الذين يقرأون فقط (فحص الجاهزية).
  // لا تعدّل المصفوفة المُعادة.
  peekShapes() { return this.shapes || []; }

  addShapesFromSVG(shapes) {
    this._saveHistory();
    this.shapes.push(...shapes);
    this.fitToView();
    this._updateStatus();
  }

  fitToView() {
    if(!this.shapes.length) return;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    this.shapes.forEach(s=>{ const b=this._bounds(s); minX=Math.min(minX,b.minX);maxX=Math.max(maxX,b.maxX);minY=Math.min(minY,b.minY);maxY=Math.max(maxY,b.maxY); });
    const pad=50,W=this.canvas.width-2*pad,H=this.canvas.height-2*pad;
    this.scale=Math.min(W/((maxX-minX)||1),H/((maxY-minY)||1),20);
    this.offset.x=pad-minX*this.scale;this.offset.y=pad+maxY*this.scale;
    this.render();
  }

  _bounds(s){
    switch(s.type){
      case 'line':     return {minX:Math.min(s.x1,s.x2),maxX:Math.max(s.x1,s.x2),minY:Math.min(s.y1,s.y2),maxY:Math.max(s.y1,s.y2)};
      case 'rect':     return {minX:s.x,maxX:s.x+s.w,minY:s.y,maxY:s.y+s.h};
      case 'circle':   return {minX:s.cx-s.r,maxX:s.cx+s.r,minY:s.cy-s.r,maxY:s.cy+s.r};
      case 'arc':      return {minX:s.cx-s.r,maxX:s.cx+s.r,minY:s.cy-s.r,maxY:s.cy+s.r};
      case 'ellipse':  return {minX:s.cx-(s.rx||0),maxX:s.cx+(s.rx||0),minY:s.cy-(s.ry||0),maxY:s.cy+(s.ry||0)};
      case 'polygon':  return {minX:s.cx-(s.r||0),maxX:s.cx+(s.r||0),minY:s.cy-(s.r||0),maxY:s.cy+(s.r||0)};
      case 'slot':     return {minX:Math.min(s.cx1,s.cx2)-(s.r||0),maxX:Math.max(s.cx1,s.cx2)+(s.r||0),minY:Math.min(s.cy1,s.cy2)-(s.r||0),maxY:Math.max(s.cy1,s.cy2)+(s.r||0)};
      case 'polyline': { const xs=s.points.map(p=>p.x),ys=s.points.map(p=>p.y); return {minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)}; }
      case 'compound': {
        let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for(const r of (s.contours||[])) for(const p of r){ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
        return isFinite(minX)?{minX,maxX,minY,maxY}:{minX:0,maxX:0,minY:0,maxY:0};
      }
      default: return {minX:0,maxX:100,minY:0,maxY:100};
    }
  }

  setGrid(size) { this.gridSize=size; this.render(); }
  setShowGrid(v){ this.showGrid=v; this.render(); }
  setSnap(v)    { this.snapGrid=v; }
}
