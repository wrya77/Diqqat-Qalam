/**
 * simulator-3d.js — 2D Toolpath Simulator (rewritten)
 * Auto-fit, pan/zoom, tool indicator, accurate arc drawing
 */
class GCodeSimulator {
  constructor(canvasId) {
    this.canvas  = document.getElementById(canvasId);
    this.ctx     = this.canvas?.getContext('2d');
    this.lines   = [];
    this.moves   = [];   // parsed move objects
    this.idx     = 0;
    this.playing = false;
    this.speed   = 60;
    this.pos     = { x:0, y:0, z:5 };

    // viewport
    this.scale   = 3;
    this.pan     = { x:0, y:0 };

    this.colors = {
      rapid: '#f85149',   // red — G0
      cut:   '#3fb950',   // green — G1 cutting
      lift:  '#d29922',   // amber — G1 retracting
      arc:   '#79c0ff',   // cyan — G2/G3
      tool:  '#ffffff',
      bg:    '#0a0e14',
      grid:  '#161b22',
      grid2: '#21262d',
      axis:  '#30363d',
    };

    this._raf      = null;
    this._dragging = false;
    this._dragStart= { x:0, y:0, panStart:{ x:0, y:0 } };

    if (this.canvas) {
      this._resize();
      this._setupControls();
      this._setupInteraction();
      window.addEventListener('resize', () => this._resize());
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  load(gcodeText) {
    this.lines = (gcodeText || '').split('\n')
      .map(l => l.split(';')[0].replace(/\([^)]*\)/g, '').trim().toUpperCase())
      .filter(l => l.length > 0);
    this.moves  = [];
    this.idx    = 0;
    this.pos    = { x:0, y:0, z:5 };

    // Pre-parse all moves to find bounds → auto-fit
    this._parseAll();
    this._autoFit();
    this._renderFull(0);
    this._updateUI(0);
  }

  play()  {
    if (!this.playing && this.lines.length) {
      this.playing = true;
      this._loop();
    }
  }
  pause() {
    this.playing = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }
  step()  {
    if (!this.playing && this.idx < this.moves.length) {
      this.idx++;
      this._renderFull(this.idx);
      this._updateUI(this.idx);
    }
  }
  reset() {
    this.pause();
    this.idx = 0;
    this._renderFull(0);
    this._updateUI(0);
  }

  // ── Controls ────────────────────────────────────────────────────────────────
  _setupControls() {
    document.getElementById('sim-play')?.addEventListener('click',  () => this.play());
    document.getElementById('sim-pause')?.addEventListener('click', () => this.pause());
    document.getElementById('sim-step')?.addEventListener('click',  () => this.step());
    document.getElementById('sim-reset')?.addEventListener('click', () => this.reset());
    document.getElementById('sim-fit')?.addEventListener('click',   () => { this._autoFit(); this._renderFull(this.idx); });
    document.getElementById('sim-speed')?.addEventListener('input', e => {
      this.speed = +e.target.value;
      const lbl = document.getElementById('sim-spd-lbl');
      if (lbl) lbl.textContent = '×' + this.speed;
    });
  }

  _setupInteraction() {
    const c = this.canvas;
    // Zoom with wheel
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
      const rect   = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // zoom toward mouse position
      this.pan.x = mx - (mx - this.pan.x) * factor;
      this.pan.y = my - (my - this.pan.y) * factor;
      this.scale *= factor;
      this._renderFull(this.idx);
    }, { passive: false });

    // Pan with drag
    c.addEventListener('mousedown', e => {
      this._dragging  = true;
      this._dragStart = { x: e.clientX, y: e.clientY, panStart: { ...this.pan } };
    });
    c.addEventListener('mousemove', e => {
      if (!this._dragging) return;
      this.pan.x = this._dragStart.panStart.x + (e.clientX - this._dragStart.x);
      this.pan.y = this._dragStart.panStart.y + (e.clientY - this._dragStart.y);
      this._renderFull(this.idx);
    });
    c.addEventListener('mouseup',   () => { this._dragging = false; });
    c.addEventListener('mouseleave',() => { this._dragging = false; });

    // Touch
    let lastTouchDist = 0, lastTouchPan = null;
    c.addEventListener('touchstart', e => {
      if (e.touches.length === 1) lastTouchPan = { x: e.touches[0].clientX, y: e.touches[0].clientY, panStart: { ...this.pan } };
      if (e.touches.length === 2) lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }, { passive: true });
    c.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && lastTouchPan) {
        this.pan.x = lastTouchPan.panStart.x + (e.touches[0].clientX - lastTouchPan.x);
        this.pan.y = lastTouchPan.panStart.y + (e.touches[0].clientY - lastTouchPan.y);
        this._renderFull(this.idx);
      }
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (lastTouchDist) { this.scale *= d / lastTouchDist; this._renderFull(this.idx); }
        lastTouchDist = d;
      }
    }, { passive: true });
  }

  // ── Resize canvas to fill its container ────────────────────────────────────
  _resize() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const w = Math.max(200, rect.width  - 4);
    const h = Math.max(150, rect.height - 4);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width  = w;
      this.canvas.height = h;
      this._renderFull(this.idx);
    }
  }

  // ── Pre-parse all G-code moves ──────────────────────────────────────────────
  _parseAll() {
    this.moves = [];
    let cur = { x:0, y:0, z:5 };
    let modalG = 0;  // last G modal

    for (const raw of this.lines) {
      const params = {};
      raw.replace(/([A-Z])(-?[\d.]+)/g, (_, k, v) => { params[k] = parseFloat(v); });

      if (params.G !== undefined) modalG = params.G;
      const g  = params.G !== undefined ? params.G : modalG;
      const nx = params.X !== undefined ? params.X : cur.x;
      const ny = params.Y !== undefined ? params.Y : cur.y;
      const nz = params.Z !== undefined ? params.Z : cur.z;

      if (g === 0 || g === 1 || g === 2 || g === 3) {
        this.moves.push({
          type: g,
          x0: cur.x, y0: cur.y, z0: cur.z,
          x1: nx,    y1: ny,    z1: nz,
          I: params.I || 0,
          J: params.J || 0,
        });
        cur = { x: nx, y: ny, z: nz };
      }
    }
  }

  // ── Compute bounding box of all moves → center & scale ─────────────────────
  _autoFit() {
    if (!this.moves.length || !this.canvas) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const m of this.moves) {
      if (m.type === 2 || m.type === 3) {
        // Arc bounds: sample points
        const cx = m.x0 + m.I, cy = m.y0 + m.J;
        const r  = Math.hypot(m.I, m.J);
        const sa = Math.atan2(m.y0 - cy, m.x0 - cx);
        const ea = Math.atan2(m.y1 - cy, m.x1 - cx);
        const ccw = m.type === 3;
        const pts = this._arcPoints(cx, cy, r, sa, ea, ccw, 24);
        pts.forEach(p => {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
      } else {
        minX = Math.min(minX, m.x0, m.x1); maxX = Math.max(maxX, m.x0, m.x1);
        minY = Math.min(minY, m.y0, m.y1); maxY = Math.max(maxY, m.y0, m.y1);
      }
    }

    if (!isFinite(minX)) { this.scale = 3; this.pan = { x: 40, y: 40 }; return; }

    const pad   = 40;
    const cw    = this.canvas.width  - pad * 2;
    const ch    = this.canvas.height - pad * 2;
    const dw    = maxX - minX || 1;
    const dh    = maxY - minY || 1;

    this.scale  = Math.min(cw / dw, ch / dh) * 0.9;
    this.scale  = Math.max(0.5, Math.min(this.scale, 500));

    // Center (no Y-flip)
    const drawW = dw * this.scale;
    const drawH = dh * this.scale;
    this.pan.x  = (this.canvas.width  - drawW) / 2 - minX * this.scale;
    this.pan.y  = (this.canvas.height - drawH) / 2 - minY * this.scale;
  }

  // ── Main render: draw grid + moves[0..n] ───────────────────────────────────
  _renderFull(upToIdx) {
    if (!this.ctx || !this.canvas) return;
    this._clear();
    this._drawGrid();

    for (let i = 0; i < Math.min(upToIdx, this.moves.length); i++) {
      this._renderMove(this.moves[i]);
    }

    // Tool position indicator
    if (this.moves.length) {
      const last = upToIdx > 0 ? this.moves[Math.min(upToIdx, this.moves.length) - 1] : null;
      const tx   = last ? last.x1 : 0;
      const ty   = last ? last.y1 : 0;
      const tp   = this._w2s(tx, ty);
      this._drawToolHead(tp.x, tp.y);
    }
  }

  _renderMove(m) {
    const c = this.ctx;
    if (m.type === 0) {
      // Rapid — dashed thin line
      c.setLineDash([4, 4]);
      this._drawSegment(m.x0, m.y0, m.x1, m.y1, this.colors.rapid, 0.8);
      c.setLineDash([]);
    } else if (m.type === 1) {
      const cutting = m.z1 < -0.001 || m.z0 < -0.001;
      this._drawSegment(m.x0, m.y0, m.x1, m.y1, cutting ? this.colors.cut : this.colors.lift, cutting ? 1.5 : 0.8);
    } else if (m.type === 2 || m.type === 3) {
      this._drawArcMove(m);
    }
  }

  _drawSegment(x1, y1, x2, y2, color, lw) {
    const c = this.ctx;
    const a = this._w2s(x1, y1), b = this._w2s(x2, y2);
    if (Math.hypot(b.x-a.x, b.y-a.y) < 0.1) return;
    c.beginPath();
    c.strokeStyle = color;
    c.lineWidth   = lw;
    c.lineCap     = 'round';
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }

  _drawArcMove(m) {
    // Center in world coords
    const cx = m.x0 + m.I;
    const cy = m.y0 + m.J;
    const r  = Math.hypot(m.I, m.J);
    const sa = Math.atan2(m.y0 - cy, m.x0 - cx);
    const ea = Math.atan2(m.y1 - cy, m.x1 - cx);
    const ccw = m.type === 3;

    // Full circle check (start ≈ end with G02/G03)
    const isFullCircle = Math.abs(m.x0 - m.x1) < 0.001 && Math.abs(m.y0 - m.y1) < 0.001;

    const cv  = this._w2s(cx, cy);
    const rs  = r * this.scale;

    const c2 = this.ctx;
    c2.beginPath();
    c2.strokeStyle = this.colors.arc;
    c2.lineWidth   = 1.8;

    if (isFullCircle) {
      c2.arc(cv.x, cv.y, rs, 0, Math.PI * 2);
    } else {
      // No Y-flip: angles are same as world coords
      // G02 (ccw=false) → canvas anticlockwise=true (visually CCW = math CW in Y-down)
      c2.arc(cv.x, cv.y, rs, sa, ea, !ccw);
    }
    c2.stroke();
  }

  // ── Tool head indicator ─────────────────────────────────────────────────────
  _drawToolHead(sx, sy) {
    const c = this.ctx;
    const r = 5;
    c.beginPath();
    c.arc(sx, sy, r, 0, Math.PI * 2);
    c.fillStyle   = 'rgba(255,255,255,0.15)';
    c.strokeStyle = this.colors.tool;
    c.lineWidth   = 1.5;
    c.fill();
    c.stroke();
    // crosshair
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth   = 0.8;
    c.beginPath(); c.moveTo(sx - r - 4, sy); c.lineTo(sx + r + 4, sy); c.stroke();
    c.beginPath(); c.moveTo(sx, sy - r - 4); c.lineTo(sx, sy + r + 4); c.stroke();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  _arcPoints(cx, cy, r, sa, ea, ccw, n) {
    const pts = [];
    let totalAngle;
    if (ccw) {
      totalAngle = ea > sa ? ea - sa : ea - sa + 2 * Math.PI;
    } else {
      totalAngle = sa > ea ? sa - ea : sa - ea + 2 * Math.PI;
    }
    for (let i = 0; i <= n; i++) {
      const t   = i / n;
      const ang = ccw ? sa + totalAngle * t : sa - totalAngle * t;
      pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
    }
    return pts;
  }

  // World → Screen (no Y-flip — matches canvas editor coordinate system)
  _w2s(wx, wy) {
    return {
      x: wx * this.scale + this.pan.x,
      y: wy * this.scale + this.pan.y,
    };
  }

  _clear() {
    const { ctx, canvas } = this;
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _drawGrid() {
    const { ctx, canvas, scale, pan } = this;

    // Choose grid spacing in world units
    let worldStep = 1;
    const targets = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 200, 500];
    for (const t of targets) {
      if (t * scale >= 20) { worldStep = t; break; }
    }

    const minorStep = worldStep * scale;
    const majorStep = minorStep * 5;

    // Draw grid lines
    ctx.lineWidth = 0.5;

    // Vertical
    const startXworld = Math.floor(-pan.x / scale / worldStep) * worldStep;
    for (let wx = startXworld; wx * scale + pan.x < canvas.width + minorStep; wx += worldStep) {
      const sx = wx * scale + pan.x;
      ctx.strokeStyle = (Math.round(wx / worldStep) % 5 === 0) ? this.colors.grid2 : this.colors.grid;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke();
    }

    // Horizontal (no Y-flip)
    const startYworld = Math.floor(-pan.y / scale / worldStep) * worldStep;
    for (let wy = startYworld; wy * scale + pan.y < canvas.height + minorStep; wy += worldStep) {
      const sy = wy * scale + pan.y;
      ctx.strokeStyle = (Math.round(wy / worldStep) % 5 === 0) ? this.colors.grid2 : this.colors.grid;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke();
    }

    // Axes
    const ox = this._w2s(0, 0);
    ctx.strokeStyle = this.colors.axis;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(ox.x, 0); ctx.lineTo(ox.x, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, ox.y); ctx.lineTo(canvas.width, ox.y); ctx.stroke();

    // Origin label
    ctx.fillStyle  = this.colors.axis;
    ctx.font       = '10px monospace';
    ctx.fillText('0', ox.x + 4, ox.y - 4);

    // Scale label
    const labelMM   = worldStep >= 1 ? worldStep + 'mm' : worldStep * 1000 + 'µm';
    const barStart  = 10, barEnd = barStart + minorStep;
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.moveTo(barStart, canvas.height - 12); ctx.lineTo(barEnd, canvas.height - 12); ctx.stroke();
    ctx.fillStyle   = '#58a6ff';
    ctx.font        = '10px sans-serif';
    ctx.fillText(labelMM, barEnd + 4, canvas.height - 8);
  }

  // ── Animation loop ──────────────────────────────────────────────────────────
  _loop() {
    if (!this.playing) return;
    const steps = Math.max(1, Math.floor(this.speed / 10));
    const was   = this.idx;
    this.idx    = Math.min(this.idx + steps, this.moves.length);

    if (this.idx > was) this._renderFull(this.idx);
    this._updateUI(this.idx);

    if (this.idx >= this.moves.length) { this.playing = false; return; }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _updateUI(idx) {
    const total = this.moves.length;
    const pct   = total ? Math.round(idx / total * 100) : 0;
    const fill  = document.getElementById('sim-prog-fill');
    if (fill) fill.style.width = pct + '%';
    const pctEl = document.getElementById('sim-pct');
    if (pctEl) pctEl.textContent = pct + '%';
    const lnEl  = document.getElementById('sim-ln');
    if (lnEl)  lnEl.textContent = 'سطر: ' + idx + '/' + total;
  }
}
