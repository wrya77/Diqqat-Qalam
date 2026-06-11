/**
 * tools-arrange.js — التحديد المتعدد + المحاذاة والتوزيع والترتيب + أشكال جديدة
 *
 *  التحديد : تحديد الكل Ctrl+A · عكس · إلغاء · Shift+نقر للإضافة · سحب جماعي
 *  المحاذاة: يسار/وسط/يمين/أعلى/منتصف/أسفل (لشكلين فأكثر)
 *  التوزيع : أفقي/رأسي متساوي المسافات (لثلاثة فأكثر)
 *  الترتيب : تقديم/تأخير خطوة · للمقدمة/للخلفية (يحدد تسلسل القطع!)
 *  أشكال  : قلب · صليب · نصف دائرة · هلال · قطرة · درج
 *
 * يُحمَّل بعد tools-pro.js وقبل app.js
 */
(function arrangeTools() {
  'use strict';
  const P = CanvasEditor.prototype;

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */
  const origInit = P.initExtraTools;
  P.initExtraTools = function () {
    if (origInit) origInit.call(this);
    this.msel = new Set();   // فهارس التحديد المتعدد
    this._groupDrag = null;

    // Ctrl+A — تحديد الكل
    document.addEventListener('keydown', e => {
      const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if (inInput) return;
      if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); this.selectAll(); }
    });
  };

  /* ══════════════════════════════════════════════════════════
     التحديد المتعدد
  ══════════════════════════════════════════════════════════ */
  P.selectAll = function () {
    this.msel = new Set(this.shapes.map((_, i) => i));
    this.selectedIdx = this.shapes.length - 1;
    this._updateShapeToolbar(); this.render();
    window.app?.toast?.(`✓ حُدد ${this.msel.size} شكلاً`, 'info');
  };

  P.clearSelection = function () {
    this.msel.clear(); this.selectedIdx = -1;
    this._updateShapeToolbar(); this.render();
  };

  P.invertSelection = function () {
    const next = new Set();
    this.shapes.forEach((_, i) => { if (!this.msel.has(i)) next.add(i); });
    this.msel = next;
    this.selectedIdx = next.size ? [...next][next.size - 1] : -1;
    this._updateShapeToolbar(); this.render();
  };

  // مزامنة msel مع النقر العادي + Shift+نقر للإضافة + السحب الجماعي
  const origOnDown = P._onDown;
  P._onDown = function (e) {
    if (this.tool === 'select' && e.button === 0 && !e.altKey) {
      const pt  = this._evPt(e);
      const hit = this._hitTest(pt);

      if (e.shiftKey) {                      // Shift+نقر: أضف/أزل من التحديد
        if (hit >= 0) {
          if (this.msel.has(hit)) this.msel.delete(hit);
          else this.msel.add(hit);
          this.selectedIdx = this.msel.size ? hit : -1;
          this._updateShapeToolbar(); this.render();
        }
        return;
      }

      if (hit >= 0 && this.msel.size > 1 && this.msel.has(hit)) {
        // سحب جماعي لكل المحدد
        this._saveHistory();
        this._groupDrag = { last: pt };
        return;
      }
    }
    origOnDown.call(this, e);
    // نقرة select عادية: msel = الشكل الوحيد المحدد
    if (this.tool === 'select' && !e.shiftKey && !this._groupDrag) {
      this.msel = this.selectedIdx >= 0 ? new Set([this.selectedIdx]) : new Set();
    }
  };

  const origOnMove = P._onMove;
  P._onMove = function (e) {
    if (this._groupDrag && e.buttons === 1) {
      const r  = this.canvas.getBoundingClientRect();
      const pt = this._snap(this._sToW(e.clientX - r.left, e.clientY - r.top));
      const dx = pt.x - this._groupDrag.last.x, dy = pt.y - this._groupDrag.last.y;
      if (dx || dy) {
        for (const i of this.msel) this._offsetShape(this.shapes[i], dx, dy);
        this._groupDrag.last = pt;
        this.render();
      }
      return;
    }
    origOnMove.call(this, e);
  };

  const origOnUp = P._onUp;
  P._onUp = function (e) {
    if (this._groupDrag) { this._groupDrag = null; this._updateStatus(); return; }
    origOnUp.call(this, e);
  };

  // حذف كل المحدد
  const origDelete = P._deleteSelected;
  P._deleteSelected = function () {
    if (this.msel.size > 1) {
      this._saveHistory();
      [...this.msel].sort((a, b) => b - a).forEach(i => this.shapes.splice(i, 1));
      this.msel.clear(); this.selectedIdx = -1;
      this._updateShapeToolbar(); this.render(); this._updateStatus();
      return;
    }
    origDelete.call(this);
    this.msel.clear();
  };

  // Esc يلغي التحديد المتعدد أيضاً
  const origCancel = P._cancelDraw;
  P._cancelDraw = function () {
    origCancel.call(this);
    if (this.tool === 'select') this.msel.clear();
  };

  // إطار تحديد لكل عنصر محدد
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    if (this.msel && this.msel.size > 1) {
      const { ctx } = this;
      ctx.save();
      ctx.strokeStyle = 'rgba(88,166,255,0.65)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      for (const i of this.msel) {
        const s = this.shapes[i];
        if (!s) continue;
        const b  = this._bounds(s);
        const p1 = this._wToS(b.minX, b.maxY), p2 = this._wToS(b.maxX, b.minY);
        ctx.strokeRect(p1.x - 3, p1.y - 3, (p2.x - p1.x) + 6, (p2.y - p1.y) + 6);
      }
      ctx.restore();
    }
  };

  /* ══════════════════════════════════════════════════════════
     المحاذاة والتوزيع
  ══════════════════════════════════════════════════════════ */
  P._selIndices = function () {
    if (this.msel.size) return [...this.msel];
    return this.selectedIdx >= 0 ? [this.selectedIdx] : [];
  };

  P.alignSelected = function (mode) {
    const idx = this._selIndices();
    if (idx.length < 2) { window.app?.toast?.('حدد شكلين أو أكثر للمحاذاة (Ctrl+A أو Shift+نقر)', 'warn'); return; }
    this._saveHistory();

    const boxes = idx.map(i => ({ i, b: this._bounds(this.shapes[i]) }));
    const minX = Math.min(...boxes.map(o => o.b.minX));
    const maxX = Math.max(...boxes.map(o => o.b.maxX));
    const minY = Math.min(...boxes.map(o => o.b.minY));
    const maxY = Math.max(...boxes.map(o => o.b.maxY));

    for (const { i, b } of boxes) {
      let dx = 0, dy = 0;
      switch (mode) {
        case 'left':    dx = minX - b.minX; break;
        case 'right':   dx = maxX - b.maxX; break;
        case 'hcenter': dx = (minX + maxX) / 2 - (b.minX + b.maxX) / 2; break;
        case 'top':     dy = maxY - b.maxY; break;        // Y صاعد: top = أكبر Y
        case 'bottom':  dy = minY - b.minY; break;
        case 'vcenter': dy = (minY + maxY) / 2 - (b.minY + b.maxY) / 2; break;
      }
      if (dx || dy) this._offsetShape(this.shapes[i], dx, dy);
    }
    this.render(); this._updateStatus();
  };

  P.distributeSelected = function (axis) {
    const idx = this._selIndices();
    if (idx.length < 3) { window.app?.toast?.('التوزيع يحتاج 3 أشكال أو أكثر', 'warn'); return; }
    this._saveHistory();

    const items = idx.map(i => {
      const b = this._bounds(this.shapes[i]);
      return { i, b, c: axis === 'h' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2 };
    }).sort((a, b2) => a.c - b2.c);

    const first = items[0].c, last = items[items.length - 1].c;
    const step  = (last - first) / (items.length - 1);

    items.forEach((it, k) => {
      const target = first + step * k;
      const d = target - it.c;
      if (Math.abs(d) > 1e-9) {
        if (axis === 'h') this._offsetShape(this.shapes[it.i], d, 0);
        else              this._offsetShape(this.shapes[it.i], 0, d);
      }
    });
    this.render(); this._updateStatus();
  };

  /* ══════════════════════════════════════════════════════════
     الترتيب — يحدد تسلسل القطع على الآلة
  ══════════════════════════════════════════════════════════ */
  P.reorderSelected = function (dir) {
    const i = this.selectedIdx;
    if (i < 0 || this.msel.size > 1) {
      window.app?.toast?.('الترتيب يعمل على شكل واحد محدد', 'warn'); return;
    }
    let to = i;
    if (dir === 'forward')  to = Math.min(this.shapes.length - 1, i + 1);
    if (dir === 'backward') to = Math.max(0, i - 1);
    if (dir === 'front')    to = this.shapes.length - 1;
    if (dir === 'back')     to = 0;
    if (to === i) return;

    this._saveHistory();
    const [s] = this.shapes.splice(i, 1);
    this.shapes.splice(to, 0, s);
    this.selectedIdx = to;
    this.msel = new Set([to]);
    this.render(); this._updateStatus();
    window.app?.toast?.(`ترتيب القطع: ${to + 1}/${this.shapes.length}`, 'info');
  };

  /* ══════════════════════════════════════════════════════════
     أشكال جديدة: قلب · صليب · نصف دائرة · هلال · قطرة · درج
  ══════════════════════════════════════════════════════════ */
  const NEW_TOOLS = new Set(['heart', 'cross', 'semicircle', 'crescent', 'teardrop', 'stairs']);

  function buildNewShape(tool, start, end) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const r  = Math.hypot(dx, dy);
    const pts = [];

    switch (tool) {
      case 'heart': {
        // منحنى القلب القياسي مقياسه ~16×16 → نطبّعه على r
        const k = r / 16;
        for (let i = 0; i <= 60; i++) {
          const t = (i / 60) * Math.PI * 2;
          pts.push({
            x: start.x + 16 * Math.pow(Math.sin(t), 3) * k,
            y: start.y + (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * k,
          });
        }
        return { type: 'polyline', points: pts, closed: true };
      }
      case 'cross': {
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
        const w = Math.abs(dx) || 1, h = Math.abs(dy) || 1;
        const t = Math.min(w, h) / 3;             // سماكة الذراع
        const cx = x + w / 2, cy = y + h / 2;
        [[cx - t/2, y], [cx + t/2, y], [cx + t/2, cy - t/2], [x + w, cy - t/2],
         [x + w, cy + t/2], [cx + t/2, cy + t/2], [cx + t/2, y + h], [cx - t/2, y + h],
         [cx - t/2, cy + t/2], [x, cy + t/2], [x, cy - t/2], [cx - t/2, cy - t/2]]
          .forEach(p => pts.push({ x: p[0], y: p[1] }));
        return { type: 'polyline', points: pts, closed: true };
      }
      case 'semicircle': {
        const ang = Math.atan2(dy, dx);           // القاعدة باتجاه السحب
        for (let i = 0; i <= 36; i++) {
          const a = ang + (i / 36) * Math.PI;
          pts.push({ x: start.x + r * Math.cos(a), y: start.y + r * Math.sin(a) });
        }
        return { type: 'polyline', points: pts, closed: true };
      }
      case 'crescent': {
        // قوس خارجي كامل الجانب + قوس داخلي مُزاح
        const off = r * 0.45;
        for (let i = 0; i <= 40; i++) {
          const a = -Math.PI / 2 + (i / 40) * Math.PI;
          pts.push({ x: start.x + r * Math.cos(a), y: start.y + r * Math.sin(a) });
        }
        for (let i = 40; i >= 0; i--) {
          const a = -Math.PI / 2 + (i / 40) * Math.PI;
          pts.push({ x: start.x + off + r * 0.75 * Math.cos(a), y: start.y + r * 0.75 * Math.sin(a) });
        }
        return { type: 'polyline', points: pts, closed: true };
      }
      case 'teardrop': {
        // دائرة سفلية + رأس مدبب أعلى
        for (let i = 0; i <= 48; i++) {
          const t = (i / 48) * Math.PI * 2;
          const bulge = Math.sin(t / 2);          // يضيق نحو الرأس
          pts.push({
            x: start.x + r * 0.65 * Math.sin(t) * bulge,
            y: start.y + r - r * (1 - Math.cos(t)) * 0.95,
          });
        }
        return { type: 'polyline', points: pts, closed: true };
      }
      case 'stairs': {
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
        const w = Math.abs(dx) || 1, h = Math.abs(dy) || 1;
        const steps = 4, sw = w / steps, sh = h / steps;
        pts.push({ x, y });
        for (let i = 0; i < steps; i++) {
          pts.push({ x: x + sw * i,       y: y + sh * (i + 1) });
          pts.push({ x: x + sw * (i + 1), y: y + sh * (i + 1) });
        }
        pts.push({ x: x + w, y });
        return { type: 'polyline', points: pts, closed: true };
      }
    }
    return null;
  }

  const origBuild = P._buildShape;
  P._buildShape = function (start, end) {
    if (NEW_TOOLS.has(this.tool)) return buildNewShape(this.tool, start, end);
    return origBuild.call(this, start, end);
  };

  const origPreview = P._drawPreview;
  P._drawPreview = function (start, end) {
    if (NEW_TOOLS.has(this.tool)) {
      const s = buildNewShape(this.tool, start, end);
      if (s && s.points && s.points.length > 1) {
        const { ctx } = this;
        ctx.beginPath();
        const p0 = this._wToS(s.points[0].x, s.points[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < s.points.length; i++) {
          const p = this._wToS(s.points[i].x, s.points[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath(); ctx.stroke();
      }
      return;
    }
    origPreview.call(this, start, end);
  };
})();
