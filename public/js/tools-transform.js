/**
 * tools-transform.js — مقابض التحويل الحر (نمط Illustrator/CorelDraw)
 *
 * عند تحديد شكل واحد بأداة التحديد تظهر:
 *   - 8 مقابض تحجيم على حدوده (الزوايا: محورين · الحواف: محور واحد)
 *   - مقبض تدوير دائري أعلى الشكل
 * Shift أثناء التحجيم = نسبة موحدة · أثناء التدوير = خطوات 15°
 */
(function transformTool() {
  'use strict';
  const P = CanvasEditor.prototype;
  const HANDLE = 7;          // نصف حجم المقبض بالبكسل
  const ROT_OFFSET = 26;     // مسافة مقبض التدوير فوق الشكل

  function clone(s) { return JSON.parse(JSON.stringify(s)); }

  // مواضع المقابض على الشاشة من حدود الشكل
  function handlePositions(ed, s) {
    const b = ed._bounds(s);
    const tl = ed._wToS(b.minX, b.maxY), br = ed._wToS(b.maxX, b.minY);
    const cx = (tl.x + br.x) / 2, cy = (tl.y + br.y) / 2;
    return {
      bounds: b,
      list: [
        { id: 'nw', x: tl.x, y: tl.y }, { id: 'n', x: cx, y: tl.y }, { id: 'ne', x: br.x, y: tl.y },
        { id: 'w',  x: tl.x, y: cy },                                { id: 'e',  x: br.x, y: cy },
        { id: 'sw', x: tl.x, y: br.y }, { id: 's', x: cx, y: br.y }, { id: 'se', x: br.x, y: br.y },
        { id: 'rot', x: cx, y: tl.y - ROT_OFFSET },
      ],
    };
  }

  const CURSORS = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab',
  };

  function activeTarget(ed) {
    if (ed.tool !== 'select' || ed.selectedIdx < 0) return null;
    if (ed.msel && ed.msel.size > 1) return null;
    const s = ed.shapes[ed.selectedIdx];
    if (!s || s.locked) return null;
    return s;
  }

  // تحجيم نص (غير مدعوم في _scaleShape الأساسي)
  function scaleText(s, fx, fy, ax, ay) {
    s.x = ax + (s.x - ax) * fx;
    s.y = ay + (s.y - ay) * fy;
    s.width  = (s.width  || 0) * fx;
    s.height = (s.height || 0) * fy;
    s.strokes = s.strokes.map(st => st.map(p => ({ x: p.x * fx, y: p.y * fy })));
  }

  /* ── رسم المقابض ── */
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    const s = activeTarget(this);
    if (!s) return;
    const { ctx } = this;
    const { list } = handlePositions(this, s);
    ctx.save();
    for (const h of list) {
      if (h.id === 'rot') {
        // خط واصل + دائرة تدوير
        const n = list.find(q => q.id === 'n');
        ctx.strokeStyle = 'rgba(88,166,255,.7)';
        ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(h.x, h.y); ctx.stroke();
        ctx.fillStyle = '#0d1117'; ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(h.x, h.y, HANDLE - 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(h.x, h.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = '#58a6ff'; ctx.fill();
      } else {
        ctx.fillStyle = '#0d1117'; ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.4;
        ctx.fillRect(h.x - HANDLE / 2, h.y - HANDLE / 2, HANDLE, HANDLE);
        ctx.strokeRect(h.x - HANDLE / 2, h.y - HANDLE / 2, HANDLE, HANDLE);
      }
    }
    ctx.restore();
  };

  function hitHandle(ed, e) {
    const s = activeTarget(ed);
    if (!s) return null;
    const r = ed.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const { list, bounds } = handlePositions(ed, s);
    for (const h of list) {
      if (Math.abs(sx - h.x) <= HANDLE + 2 && Math.abs(sy - h.y) <= HANDLE + 2) {
        return { handle: h.id, bounds };
      }
    }
    return null;
  }

  /* ── بدء التحويل ── */
  const origOnDown = P._onDown;
  P._onDown = function (e) {
    if (e.button === 0) {
      const hit = hitHandle(this, e);
      if (hit) {
        const s = this.shapes[this.selectedIdx];
        const b = hit.bounds;
        const r = this.canvas.getBoundingClientRect();
        const cur = this._sToW(e.clientX - r.left, e.clientY - r.top);   // بلا التقاط
        const anchors = {
          nw: { x: b.maxX, y: b.minY }, ne: { x: b.minX, y: b.minY },
          sw: { x: b.maxX, y: b.maxY }, se: { x: b.minX, y: b.maxY },
          n:  { x: (b.minX + b.maxX) / 2, y: b.minY },
          s:  { x: (b.minX + b.maxX) / 2, y: b.maxY },
          e:  { x: b.minX, y: (b.minY + b.maxY) / 2 },
          w:  { x: b.maxX, y: (b.minY + b.maxY) / 2 },
        };
        this._saveHistory();
        this._xf = {
          mode: hit.handle,
          original: clone(s),
          anchor: anchors[hit.handle] || null,
          center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
          start: cur,
        };
        return;
      }
    }
    origOnDown.call(this, e);
  };

  /* ── أثناء السحب ── */
  const origOnMove = P._onMove;
  P._onMove = function (e) {
    // مؤشر تفاعلي فوق المقابض
    if (!this._xf && this.tool === 'select' && e.buttons === 0) {
      const hit = hitHandle(this, e);
      this.canvas.style.cursor = hit ? CURSORS[hit.handle] : 'default';
    }

    if (this._xf && e.buttons === 1) {
      const r = this.canvas.getBoundingClientRect();
      const cur = this._sToW(e.clientX - r.left, e.clientY - r.top);
      const xf = this._xf;
      const s = clone(xf.original);

      if (xf.mode === 'rot') {
        let ang = Math.atan2(cur.y - xf.center.y, cur.x - xf.center.x)
                - Math.atan2(xf.start.y - xf.center.y, xf.start.x - xf.center.x);
        if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);  // 15°
        this._rotateShape(s, ang, xf.center.x, xf.center.y);
      } else {
        const a = xf.anchor;
        const sx0 = xf.start.x - a.x, sy0 = xf.start.y - a.y;
        let fx = Math.abs(sx0) > 0.01 ? (cur.x - a.x) / sx0 : 1;
        let fy = Math.abs(sy0) > 0.01 ? (cur.y - a.y) / sy0 : 1;
        if (xf.mode === 'n' || xf.mode === 's') fx = 1;
        if (xf.mode === 'e' || xf.mode === 'w') fy = 1;
        if (e.shiftKey && fx !== 1 && fy !== 1) { const u = Math.max(Math.abs(fx), Math.abs(fy)); fx = Math.sign(fx) * u; fy = Math.sign(fy) * u; }
        fx = Math.max(0.02, Math.abs(fx)) * Math.sign(fx || 1);
        fy = Math.max(0.02, Math.abs(fy)) * Math.sign(fy || 1);
        if (s.type === 'text') scaleText(s, fx, fy, a.x, a.y);
        else this._scaleShape(s, fx, fy, a.x, a.y);
      }

      this.shapes[this.selectedIdx] = s;
      this.render();
      return;
    }
    origOnMove.call(this, e);
  };

  /* ── إنهاء ── */
  const origOnUp = P._onUp;
  P._onUp = function (e) {
    if (this._xf) {
      this._xf = null;
      this._updateStatus();
      return;
    }
    origOnUp.call(this, e);
  };
})();
