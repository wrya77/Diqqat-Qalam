/**
 * tools-pro.js — أدوات رسم احترافية لـ CanvasEditor
 *
 *  1. نقش نص (خط أحادي الضربة مناسب للحفر CNC)
 *  2. التقاط ذكي للكائنات OSNAP (نهايات · مراكز · منتصفات)
 *  3. قيد Shift (خط 0/45/90° · مستطيل→مربع · بيضاوي→دائرة)
 *  4. إزاحة المسار Offset (داخل/خارج) للأشكال المغلقة
 *  5. إنشاء أشكال بأبعاد رقمية دقيقة
 *  6. تحريك بالأسهم + نسخ بـ Alt+سحب
 *
 * حقن عبر prototype — يُحمَّل بعد tools-extra.js وقبل app.js
 */
(function proTools() {
  'use strict';
  const P = CanvasEditor.prototype;

  /* ══════════════════════════════════════════════════════════
     خط النقش أحادي الضربة — شبكة 4×6 (y=0 أسفل)
     كل حرف: مصفوفة ضربات، كل ضربة أرقام مسطّحة x,y,x,y...
  ══════════════════════════════════════════════════════════ */
  const FONT = {
    'A': [[0,0, 2,6, 4,0], [0.8,2.2, 3.2,2.2]],
    'B': [[0,0, 0,6, 3,6, 4,5, 4,3.7, 3,3, 0,3], [3,3, 4,2.2, 4,1, 3,0, 0,0]],
    'C': [[4,1, 3,0, 1,0, 0,1, 0,5, 1,6, 3,6, 4,5]],
    'D': [[0,0, 0,6, 2.5,6, 4,4.5, 4,1.5, 2.5,0, 0,0]],
    'E': [[4,0, 0,0, 0,6, 4,6], [0,3, 2.8,3]],
    'F': [[0,0, 0,6, 4,6], [0,3, 2.8,3]],
    'G': [[4,5, 3,6, 1,6, 0,5, 0,1, 1,0, 3,0, 4,1, 4,2.6, 2.2,2.6]],
    'H': [[0,0, 0,6], [4,0, 4,6], [0,3, 4,3]],
    'I': [[1,0, 3,0], [2,0, 2,6], [1,6, 3,6]],
    'J': [[0,1, 1,0, 2.6,0, 3.6,1, 3.6,6]],
    'K': [[0,0, 0,6], [4,6, 0,2.6], [1.4,3.7, 4,0]],
    'L': [[0,6, 0,0, 4,0]],
    'M': [[0,0, 0,6, 2,3.2, 4,6, 4,0]],
    'N': [[0,0, 0,6, 4,0, 4,6]],
    'O': [[1,0, 0,1, 0,5, 1,6, 3,6, 4,5, 4,1, 3,0, 1,0]],
    'P': [[0,0, 0,6, 3,6, 4,5, 4,3.8, 3,2.8, 0,2.8]],
    'Q': [[1,0, 0,1, 0,5, 1,6, 3,6, 4,5, 4,1, 3,0, 1,0], [2.4,1.6, 4.2,-0.4]],
    'R': [[0,0, 0,6, 3,6, 4,5, 4,3.8, 3,2.8, 0,2.8], [1.8,2.8, 4,0]],
    'S': [[4,5, 3,6, 1,6, 0,5, 0,4, 1,3.2, 3,2.8, 4,2, 4,1, 3,0, 1,0, 0,1]],
    'T': [[0,6, 4,6], [2,6, 2,0]],
    'U': [[0,6, 0,1, 1,0, 3,0, 4,1, 4,6]],
    'V': [[0,6, 2,0, 4,6]],
    'W': [[0,6, 1,0, 2,3, 3,0, 4,6]],
    'X': [[0,0, 4,6], [0,6, 4,0]],
    'Y': [[0,6, 2,3.2], [4,6, 2,3.2], [2,3.2, 2,0]],
    'Z': [[0,6, 4,6, 0,0, 4,0]],
    '0': [[1,0, 0,1, 0,5, 1,6, 3,6, 4,5, 4,1, 3,0, 1,0], [0.8,1, 3.2,5]],
    '1': [[0.8,4.8, 2,6, 2,0], [0.8,0, 3.2,0]],
    '2': [[0,5, 1,6, 3,6, 4,5, 4,3.8, 0,0, 4,0]],
    '3': [[0.4,6, 4,6, 2,3.6, 3,3.6, 4,2.6, 4,1, 3,0, 1,0, 0,1]],
    '4': [[3,0, 3,6, 0,1.8, 4.2,1.8]],
    '5': [[4,6, 0.4,6, 0.4,3.4, 2.8,3.6, 4,2.6, 4,1, 3,0, 1,0, 0,1]],
    '6': [[3.8,5.2, 3,6, 1,6, 0,5, 0,1, 1,0, 3,0, 4,1, 4,2, 3,3, 0,2.8]],
    '7': [[0,6, 4,6, 1.6,0]],
    '8': [[1,3.2, 0,4, 0,5, 1,6, 3,6, 4,5, 4,4, 3,3.2, 1,3.2, 0,2.4, 0,1, 1,0, 3,0, 4,1, 4,2.4, 3,3.2]],
    '9': [[4,3.2, 1,3, 0,4, 0,5, 1,6, 3,6, 4,5, 4,1, 3,0, 1,0, 0.2,0.8]],
    '-': [[0.6,3, 3.4,3]],
    '+': [[2,1.2, 2,4.8], [0.2,3, 3.8,3]],
    '.': [[1.8,0, 2.2,0, 2.2,0.4, 1.8,0.4, 1.8,0]],
    ',': [[2.2,0.6, 1.6,-0.8]],
    ':': [[1.85,1, 2.15,1, 2.15,1.4, 1.85,1.4, 1.85,1], [1.85,3.8, 2.15,3.8, 2.15,4.2, 1.85,4.2, 1.85,3.8]],
    '/': [[0.4,0, 3.6,6]],
    '(': [[2.9,6.5, 1.9,5, 1.9,1, 2.9,-0.5]],
    ')': [[1.1,6.5, 2.1,5, 2.1,1, 1.1,-0.5]],
    '°': [[1.4,4.8, 1.4,6, 2.6,6, 2.6,4.8, 1.4,4.8]],
    '#': [[1.2,0, 1.8,6], [2.6,0, 3.2,6], [0.4,2, 3.8,2], [0.6,4, 4,4]],
    '=': [[0.6,2.2, 3.4,2.2], [0.6,3.8, 3.4,3.8]],
    ' ': [],
  };
  const GLYPH_W = 4, GLYPH_H = 6, ADVANCE = 5.6;

  // تحويل نص إلى ضربات بإحداثيات mm نسبية إلى نقطة الأصل (يسار-أسفل)
  function textToStrokes(text, heightMM) {
    const k = heightMM / GLYPH_H;
    const strokes = [];
    let cursorX = 0;
    for (const raw of String(text)) {
      const ch = FONT[raw] ? raw : FONT[raw.toUpperCase()] ? raw.toUpperCase() : null;
      if (ch === null) { cursorX += ADVANCE * k; continue; }
      for (const flat of FONT[ch]) {
        const pts = [];
        for (let i = 0; i < flat.length; i += 2) {
          pts.push({ x: cursorX + flat[i] * k, y: flat[i + 1] * k });
        }
        if (pts.length >= 2) strokes.push(pts);
      }
      cursorX += ADVANCE * k;
    }
    return { strokes, width: Math.max(0, cursorX - 1.6 * k) };
  }

  /* ══════════════════════════════════════════════════════════
     INIT — يلتف على initExtraTools
  ══════════════════════════════════════════════════════════ */
  const origInitExtra = P.initExtraTools;
  P.initExtraTools = function () {
    if (origInitExtra) origInitExtra.call(this);
    this.snapObjects = true;
    this._osnapHit   = null;
    this._shiftKey   = false;
    this._bindProUI();
  };

  P._bindProUI = function () {
    // تتبع Shift للقيد الزاوي
    document.addEventListener('keydown', e => { if (e.key === 'Shift') this._shiftKey = true; });
    document.addEventListener('keyup',   e => { if (e.key === 'Shift') this._shiftKey = false; });

    // مفتاح T لأداة النص
    document.addEventListener('keydown', e => {
      const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if (!inInput && !e.ctrlKey && e.code === 'KeyT') this.setTool('text');
    });

    // تحريك بالأسهم: 1mm — Shift: 10mm — Alt: 0.1mm (يشمل التحديد المتعدد)
    document.addEventListener('keydown', e => {
      const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if (inInput || this.selectedIdx < 0) return;
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      const d = dirs[e.key];
      if (!d) return;
      e.preventDefault();
      const step = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
      const targets = (this.msel && this.msel.size) ? [...this.msel] : [this.selectedIdx];
      this._saveHistory();
      for (const i of targets) {
        if (this.shapes[i]) this._offsetShape(this.shapes[i], d[0] * step, d[1] * step);
      }
      this.render(); this._updateStatus();
    });

    // مربع اختيار: التقاط الكائنات
    document.getElementById('snap-objects')?.addEventListener('change', e => {
      this.snapObjects = e.target.checked;
    });

    // أبعاد دقيقة
    document.getElementById('btn-precise')?.addEventListener('click', () => this._openPreciseDialog());
    document.getElementById('btn-precise-ok')?.addEventListener('click', () => this._insertPreciseShape());
    document.getElementById('precise-type')?.addEventListener('change', e => this._updatePreciseFields(e.target.value));

    // إزاحة المسار
    document.getElementById('st-offset')?.addEventListener('click', () => {
      if (this.selectedIdx < 0) return;
      document.getElementById('dlg-offset')?.showModal();
    });
    document.getElementById('btn-offset-apply')?.addEventListener('click', () => this._applyOffset());

    // نافذة النص
    document.getElementById('btn-text-ok')?.addEventListener('click', () => this._insertText());
  };

  /* ── قلب مجموعة أشكال رأسياً حول مركزها المشترك ──
     (لاستيراد SVG/الصور حيث المحور Y نازل بعكس عالم CNC) */
  P.flipShapesY = function (shapes) {
    if (!shapes || !shapes.length) return shapes;
    let minY = Infinity, maxY = -Infinity;
    for (const s of shapes) {
      const b = this._bounds(s);
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    const cy = (minY + maxY) / 2;
    for (const s of shapes) this._mirrorShape(s, 'v', 0, cy);
    return shapes;
  };

  /* ══════════════════════════════════════════════════════════
     1) OSNAP — التقاط نهايات/مراكز/منتصفات الأشكال
  ══════════════════════════════════════════════════════════ */
  P._osnapCandidates = function (excludeIdx) {
    const out = [];
    const push = (x, y, kind) => out.push({ x, y, kind });
    this.shapes.forEach((s, i) => {
      if (i === excludeIdx) return;
      switch (s.type) {
        case 'line':
          push(s.x1, s.y1, 'end'); push(s.x2, s.y2, 'end');
          push((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, 'mid');
          break;
        case 'rect':
          push(s.x, s.y, 'end'); push(s.x + s.w, s.y, 'end');
          push(s.x + s.w, s.y + s.h, 'end'); push(s.x, s.y + s.h, 'end');
          push(s.x + s.w / 2, s.y + s.h / 2, 'center');
          break;
        case 'circle': case 'arc':
          push(s.cx, s.cy, 'center');
          push(s.cx + s.r, s.cy, 'end'); push(s.cx - s.r, s.cy, 'end');
          push(s.cx, s.cy + s.r, 'end'); push(s.cx, s.cy - s.r, 'end');
          break;
        case 'ellipse':
          push(s.cx, s.cy, 'center');
          break;
        case 'polygon':
          push(s.cx, s.cy, 'center');
          (s.points || []).forEach(p => push(p.x, p.y, 'end'));
          break;
        case 'slot':
          push(s.cx1, s.cy1, 'center'); push(s.cx2, s.cy2, 'center');
          break;
        case 'polyline': {
          const pts = s.points || [];
          if (pts.length) { push(pts[0].x, pts[0].y, 'end'); push(pts[pts.length - 1].x, pts[pts.length - 1].y, 'end'); }
          for (let i = 1; i < pts.length; i++) push((pts[i - 1].x + pts[i].x) / 2, (pts[i - 1].y + pts[i].y) / 2, 'mid');
          break;
        }
        case 'text':
          push(s.x, s.y, 'end');
          break;
      }
    });
    return out;
  };

  // التفاف على _snap: كائنات أولاً ثم الشبكة، مع قيد Shift أثناء الرسم
  const origSnap = P._snap;
  P._snap = function (pt) {
    let result = null;
    this._osnapHit = null;

    if (this.snapObjects && this.tool !== 'hand') {
      const tol = 9 / this.scale;
      const excl = this.tool === 'select' ? this.selectedIdx : -1;
      let best = null, bestD = tol;
      for (const c of this._osnapCandidates(excl)) {
        const d = Math.hypot(c.x - pt.x, c.y - pt.y);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) { this._osnapHit = best; result = { x: best.x, y: best.y }; }
    }

    if (!result) result = origSnap.call(this, pt);

    // قيد Shift أثناء الرسم
    if (this._shiftKey && this.isDrawing && this.startPt) {
      const dx = result.x - this.startPt.x, dy = result.y - this.startPt.y;
      if (this.tool === 'line' || this.tool === 'arrow') {
        // أقرب زاوية من مضاعفات 45°
        const ang  = Math.atan2(dy, dx);
        const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        const len  = Math.hypot(dx, dy);
        result = { x: this.startPt.x + Math.cos(snap) * len, y: this.startPt.y + Math.sin(snap) * len };
      } else if (this.tool === 'rect' || this.tool === 'ellipse' ||
                 this.tool === 'rounded-rect' || this.tool === 'chamfer-rect') {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        result = { x: this.startPt.x + Math.sign(dx || 1) * m, y: this.startPt.y + Math.sign(dy || 1) * m };
      }
    }
    return result;
  };

  // مؤشر بصري للالتقاط
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    if (this._osnapHit) {
      const { ctx } = this;
      const sp = this._wToS(this._osnapHit.x, this._osnapHit.y);
      ctx.save();
      ctx.strokeStyle = '#79c0ff'; ctx.lineWidth = 1.6; ctx.setLineDash([]);
      const z = 6;
      if (this._osnapHit.kind === 'end') {
        ctx.strokeRect(sp.x - z, sp.y - z, z * 2, z * 2);                       // مربع: نهاية
      } else if (this._osnapHit.kind === 'center') {
        ctx.beginPath(); ctx.arc(sp.x, sp.y, z, 0, Math.PI * 2); ctx.stroke();  // دائرة: مركز
        ctx.beginPath(); ctx.moveTo(sp.x - z, sp.y); ctx.lineTo(sp.x + z, sp.y);
        ctx.moveTo(sp.x, sp.y - z); ctx.lineTo(sp.x, sp.y + z); ctx.stroke();
      } else {
        ctx.beginPath();                                                         // مثلث: منتصف
        ctx.moveTo(sp.x, sp.y - z); ctx.lineTo(sp.x + z, sp.y + z);
        ctx.lineTo(sp.x - z, sp.y + z); ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
    }
  };

  /* ══════════════════════════════════════════════════════════
     2) أداة النص + Alt+سحب للنسخ — التفاف على _onDown
  ══════════════════════════════════════════════════════════ */
  const origOnDown = P._onDown;
  P._onDown = function (e) {
    // أداة النص: نقرة تفتح نافذة الإدخال
    if (this.tool === 'text' && e.button === 0) {
      const pt = this._evPt(e);
      this._textAnchor = pt;
      const dlg = document.getElementById('dlg-text');
      if (dlg) {
        document.getElementById('text-pos-label').textContent = `(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`;
        dlg.showModal();
        document.getElementById('text-input')?.focus();
      }
      return;
    }
    // Alt+سحب على شكل = اسحب نسخة
    if (this.tool === 'select' && e.altKey && e.button === 0) {
      const pt = this._evPt(e);
      const hit = this._hitTest(pt);
      if (hit >= 0) {
        this._saveHistory();
        const clone = JSON.parse(JSON.stringify(this.shapes[hit]));
        this.shapes.push(clone);
        this.selectedIdx = this.shapes.length - 1;
        const o = this._shapeOrigin(clone);
        this.dragOffset = { dx: pt.x - o.x, dy: pt.y - o.y };
        this._updateShapeToolbar();
        this.render();
        return;
      }
    }
    origOnDown.call(this, e);
  };

  P._insertText = function () {
    const txt    = (document.getElementById('text-input')?.value || '').trim();
    const height = Math.max(1, parseFloat(document.getElementById('text-height')?.value) || 10);
    if (!txt || !this._textAnchor) { document.getElementById('dlg-text')?.close(); return; }

    const { strokes, width } = textToStrokes(txt, height);
    if (!strokes.length) {
      document.getElementById('dlg-text')?.close();
      window.app?.toast?.('لا أحرف قابلة للنقش — المدعوم: حروف لاتينية وأرقام ورموز أساسية', 'warn');
      return;
    }
    this._saveHistory();
    this.shapes.push({
      type: 'text', text: txt, height,
      x: this._textAnchor.x, y: this._textAnchor.y,
      width, strokes,
    });
    this.selectedIdx = this.shapes.length - 1;
    document.getElementById('dlg-text')?.close();
    this.setTool('select');
    this._updateShapeToolbar();
    this.render(); this._updateStatus();
  };

  /* ── تكامل شكل النص مع المحرر ── */
  const origDrawShape = P._drawShape;
  P._drawShape = function (s) {
    if (s.type !== 'text') return origDrawShape.call(this, s);
    const { ctx } = this;
    ctx.beginPath(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const st of s.strokes) {
      const p0 = this._wToS(s.x + st[0].x, s.y + st[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < st.length; i++) {
        const p = this._wToS(s.x + st[i].x, s.y + st[i].y);
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
    // وسم بالحجم
    ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(88,166,255,0.6)'; ctx.textAlign = 'center';
    const c = this._wToS(s.x + (s.width || 0) / 2, s.y + s.height);
    ctx.fillText(`نص ${s.height}mm`, c.x, c.y - 8);
    ctx.textAlign = 'start';
  };

  const origIsNear = P._isNear;
  P._isNear = function (s, pt, tol) {
    if (s.type !== 'text') return origIsNear.call(this, s, pt, tol);
    const b = { minX: s.x, maxX: s.x + (s.width || 10), minY: s.y, maxY: s.y + s.height };
    const t = tol || 3 / this.scale;
    return pt.x > b.minX - t && pt.x < b.maxX + t && pt.y > b.minY - t && pt.y < b.maxY + t;
  };

  const origShapeOrigin = P._shapeOrigin;
  P._shapeOrigin = function (s) {
    if (s.type === 'text') return { x: s.x, y: s.y };
    return origShapeOrigin.call(this, s);
  };

  const origOffsetShape = P._offsetShape;
  P._offsetShape = function (s, dx, dy) {
    if (s.type === 'text') { s.x += dx; s.y += dy; return; }
    origOffsetShape.call(this, s, dx, dy);
  };

  const origBounds = P._bounds;
  P._bounds = function (s) {
    if (s.type === 'text') {
      return { minX: s.x, maxX: s.x + (s.width || 10), minY: s.y, maxY: s.y + s.height };
    }
    return origBounds.call(this, s);
  };

  const origShapeLen = P._shapeLen;
  P._shapeLen = function (s) {
    if (s.type === 'text') {
      let len = 0;
      for (const st of (s.strokes || []))
        for (let i = 1; i < st.length; i++)
          len += Math.hypot(st[i].x - st[i - 1].x, st[i].y - st[i - 1].y);
      return len;
    }
    return origShapeLen.call(this, s);
  };

  /* ══════════════════════════════════════════════════════════
     3) إزاحة المسار — مخطط داخلي/خارجي
  ══════════════════════════════════════════════════════════ */
  P._applyOffset = function () {
    const dist = Math.max(0.05, parseFloat(document.getElementById('offset-dist')?.value) || 3);
    const dirSel = document.querySelector('input[name="offset-dir"]:checked')?.value || 'out';
    const d = dirSel === 'out' ? dist : -dist;
    const s = this.shapes[this.selectedIdx];
    if (!s) return;

    let result = null;
    switch (s.type) {
      case 'circle':
        if (s.r + d > 0.05) result = { type: 'circle', cx: s.cx, cy: s.cy, r: s.r + d };
        break;
      case 'arc':
        if (s.r + d > 0.05) result = { ...JSON.parse(JSON.stringify(s)), r: s.r + d };
        break;
      case 'ellipse':
        if (s.rx + d > 0.05 && s.ry + d > 0.05)
          result = { type: 'ellipse', cx: s.cx, cy: s.cy, rx: s.rx + d, ry: s.ry + d };
        break;
      case 'rect':
        if (s.w + 2 * d > 0.1 && s.h + 2 * d > 0.1)
          result = { type: 'rect', x: s.x - d, y: s.y - d, w: s.w + 2 * d, h: s.h + 2 * d };
        break;
      case 'slot':
        if (s.r + d > 0.05) result = { ...JSON.parse(JSON.stringify(s)), r: s.r + d };
        break;
      case 'polygon':
      case 'polyline': {
        const pts = s.points || [];
        const closed = s.type === 'polygon' || s.closed;
        if (!closed || pts.length < 3) {
          window.app?.toast?.('الإزاحة تعمل على الأشكال المغلقة فقط', 'warn');
          document.getElementById('dlg-offset')?.close();
          return;
        }
        const off = offsetPolygon(pts, d);
        if (off && off.length >= 3) {
          result = s.type === 'polygon'
            ? { type: 'polygon', cx: s.cx, cy: s.cy, r: (s.r || 0) + d, sides: s.sides, points: off }
            : { type: 'polyline', points: off, closed: true };
        }
        break;
      }
      default:
        window.app?.toast?.('الإزاحة غير مدعومة لهذا الشكل', 'warn');
        document.getElementById('dlg-offset')?.close();
        return;
    }

    document.getElementById('dlg-offset')?.close();
    if (!result) { window.app?.toast?.('المسافة أكبر من حجم الشكل', 'warn'); return; }

    this._saveHistory();
    this.shapes.push(result);
    this.selectedIdx = this.shapes.length - 1;
    this._updateShapeToolbar();
    this.render(); this._updateStatus();
    window.app?.toast?.(`✓ مسار ${dirSel === 'out' ? 'خارجي' : 'داخلي'} بإزاحة ${dist}mm`, 'success');
  };

  // إزاحة مضلع: إزاحة كل حافة باتجاه عمودها (بعيداً عن المركز) ثم تقاطع الحواف المتجاورة
  function offsetPolygon(points, d) {
    const n = points.length;
    if (n < 3) return null;
    const cx = points.reduce((a, p) => a + p.x, 0) / n;
    const cy = points.reduce((a, p) => a + p.y, 0) / n;

    // عمود الحافة المتجه للخارج
    const edgeNormal = (a, b) => {
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.hypot(ex, ey) || 1;
      let nx = -ey / len, ny = ex / len;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // إن كان العمود يقرّب من المركز فهو داخلي — اعكسه
      if (Math.hypot(mx + nx - cx, my + ny - cy) < Math.hypot(mx - cx, my - cy)) { nx = -nx; ny = -ny; }
      return { nx, ny };
    };

    const out = [];
    for (let i = 0; i < n; i++) {
      const pPrev = points[(i - 1 + n) % n], p = points[i], pNext = points[(i + 1) % n];
      const n1 = edgeNormal(pPrev, p), n2 = edgeNormal(p, pNext);
      // حافتان مُزاحتان كخطين — أوجد تقاطعهما
      const a1 = { x: pPrev.x + n1.nx * d, y: pPrev.y + n1.ny * d };
      const b1 = { x: p.x     + n1.nx * d, y: p.y     + n1.ny * d };
      const a2 = { x: p.x     + n2.nx * d, y: p.y     + n2.ny * d };
      const b2 = { x: pNext.x + n2.nx * d, y: pNext.y + n2.ny * d };
      const ix = lineIntersect(a1, b1, a2, b2);
      out.push(ix || { x: p.x + (n1.nx + n2.nx) / 2 * d, y: p.y + (n1.ny + n2.ny) / 2 * d });
    }
    return out;
  }

  function lineIntersect(a1, b1, a2, b2) {
    const d = (a1.x - b1.x) * (a2.y - b2.y) - (a1.y - b1.y) * (a2.x - b2.x);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((a1.x - a2.x) * (a2.y - b2.y) - (a1.y - a2.y) * (a2.x - b2.x)) / d;
    return { x: a1.x + t * (b1.x - a1.x), y: a1.y + t * (b1.y - a1.y) };
  }

  /* ══════════════════════════════════════════════════════════
     4) أبعاد دقيقة — إنشاء أشكال بإدخال رقمي
  ══════════════════════════════════════════════════════════ */
  P._openPreciseDialog = function () {
    this._updatePreciseFields(document.getElementById('precise-type')?.value || 'rect');
    document.getElementById('dlg-precise')?.showModal();
  };

  P._updatePreciseFields = function (type) {
    const rows = {
      'precise-row-wh': type === 'rect' || type === 'ellipse',
      'precise-row-r':  type === 'circle',
      'precise-row-xy2': type === 'line',
    };
    for (const [id, show] of Object.entries(rows)) {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? 'flex' : 'none';
    }
  };

  P._insertPreciseShape = function () {
    const g = id => parseFloat(document.getElementById(id)?.value) || 0;
    const type = document.getElementById('precise-type')?.value || 'rect';
    const x = g('precise-x'), y = g('precise-y');

    let shape = null;
    if (type === 'rect') {
      const w = g('precise-w'), h = g('precise-h');
      if (w > 0 && h > 0) shape = { type: 'rect', x, y, w, h };
    } else if (type === 'circle') {
      const r = g('precise-r');
      if (r > 0) shape = { type: 'circle', cx: x, cy: y, r };
    } else if (type === 'ellipse') {
      const rx = g('precise-w') / 2, ry = g('precise-h') / 2;
      if (rx > 0 && ry > 0) shape = { type: 'ellipse', cx: x, cy: y, rx, ry };
    } else if (type === 'line') {
      const x2 = g('precise-x2'), y2 = g('precise-y2');
      shape = { type: 'line', x1: x, y1: y, x2, y2 };
    }

    document.getElementById('dlg-precise')?.close();
    if (!shape) { window.app?.toast?.('قيم غير صالحة', 'warn'); return; }
    this._saveHistory();
    this.shapes.push(shape);
    this.selectedIdx = this.shapes.length - 1;
    this._updateShapeToolbar();
    this.render(); this._updateStatus();
  };
})();
