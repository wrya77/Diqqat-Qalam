/**
 * tools-cnc.js — 20 أداة CNC احترافية + تحويل اللاسو لتحديد حقيقي
 *
 *  قطع   : جسور تثبيت Tabs · رصف على الخامة · دائرة براغي · عكس الاتجاه
 *          نقطة البداية · تعطيل من G-Code · ترقيم تسلسل القطع · أسهم الاتجاه
 *  تحرير : قفل · تدوير ±90 · تدوير الزوايا Fillet · دمج مسارات · معلومات وموضع
 *  إدراج : علامة مركز · مستطيل إحاطة · سهم مزدوج · إطار · قوس بثلاث نقاط
 *  عرض   : تكبير 1:1
 *
 * يُحمَّل بعد tools-arrange.js وقبل menu-bar.js
 */
(function cncTools() {
  'use strict';
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  /* ══════════════════ مساعدات هندسية ══════════════════ */

  // تحويل أي شكل مغلق إلى نقاط كثيفة (للجسور والزوايا)
  P._toClosedPoints = function (s, step = 1.5) {
    switch (s.type) {
      case 'rect': {
        const pts = [];
        const edges = [
          [s.x, s.y, s.x + s.w, s.y], [s.x + s.w, s.y, s.x + s.w, s.y + s.h],
          [s.x + s.w, s.y + s.h, s.x, s.y + s.h], [s.x, s.y + s.h, s.x, s.y],
        ];
        for (const [x1, y1, x2, y2] of edges) {
          const len = Math.hypot(x2 - x1, y2 - y1);
          const n = Math.max(1, Math.ceil(len / step));
          for (let i = 0; i < n; i++) pts.push({ x: x1 + (x2 - x1) * i / n, y: y1 + (y2 - y1) * i / n });
        }
        return pts;
      }
      case 'circle': {
        const pts = [], n = Math.max(24, Math.ceil(2 * Math.PI * s.r / step));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 2 * Math.PI;
          pts.push({ x: s.cx + s.r * Math.cos(a), y: s.cy + s.r * Math.sin(a) });
        }
        return pts;
      }
      case 'ellipse': {
        const pts = [], n = Math.max(32, Math.ceil(Math.PI * (s.rx + s.ry) / step));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 2 * Math.PI;
          pts.push({ x: s.cx + s.rx * Math.cos(a), y: s.cy + s.ry * Math.sin(a) });
        }
        return pts;
      }
      case 'polygon':  return s.points ? [...s.points] : null;
      case 'polyline': return (s.closed && s.points) ? [...s.points] : null;
      default: return null;
    }
  };

  /* ══════════════════ 1-2) تدوير ±90 ══════════════════ */
  P.rotate90 = function (dir) {
    if (this.selectedIdx < 0) return toast('حدد شكلاً أولاً', 'warn');
    this.rotateSelected(dir * 90);
  };

  /* ══════════════════ 3) عكس اتجاه القطع ══════════════════ */
  P.reverseSelected = function () {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدد شكلاً أولاً', 'warn');
    this._saveHistory();
    let n = 0;
    for (const i of idx) {
      const s = this.shapes[i];
      if (s.type === 'polyline' || s.type === 'polygon') { s.points.reverse(); n++; }
      else if (s.type === 'line') { [s.x1, s.x2] = [s.x2, s.x1]; [s.y1, s.y2] = [s.y2, s.y1]; n++; }
      else if (s.type === 'arc') { [s.startAngle, s.endAngle] = [s.endAngle, s.startAngle]; s.clockwise = !s.clockwise; n++; }
      else if (s.type === 'circle') { s.reversed = !s.reversed; n++; }
    }
    this.render();
    toast(`↔ عُكس اتجاه ${n} مسار (Climb ⇄ Conventional)`, 'success');
  };

  /* ══════════════════ 4) قفل ══════════════════ */
  P.toggleLockSelected = function () {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدد شكلاً أولاً', 'warn');
    this._saveHistory();
    const lock = !this.shapes[idx[0]].locked;
    for (const i of idx) this.shapes[i].locked = lock;
    if (lock) { this.msel.clear(); this.selectedIdx = -1; this._updateShapeToolbar(); }
    this.render();
    toast(lock ? '🔒 قُفل — لن يتحرك بالخطأ (فك القفل من القائمة كائن)' : '🔓 فُك القفل', 'info');
  };

  P.unlockAll = function () {
    this._saveHistory();
    let n = 0;
    for (const s of this.shapes) if (s.locked) { s.locked = false; n++; }
    this.render();
    toast(n ? `🔓 فُك قفل ${n} شكل` : 'لا أشكال مقفلة');
  };

  // المقفل لا يُلتقط بالنقر
  const origHitTest = P._hitTest;
  P._hitTest = function (pt) {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      if (this.shapes[i].locked) continue;
      if (this._isNear(this.shapes[i], pt)) return i;
    }
    return -1;
  };

  /* ══════════════════ 5) تعطيل من G-Code ══════════════════ */
  P.toggleDisableSelected = function () {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدد شكلاً أولاً', 'warn');
    this._saveHistory();
    const dis = !this.shapes[idx[0]].disabled;
    for (const i of idx) this.shapes[i].disabled = dis;
    this.render();
    toast(dis ? '⊘ مُعطل — لن يدخل في G-Code' : '✓ مُفعل — سيُقطع', 'info');
  };

  // المعطل لا يدخل التوليد
  const origGetShapes = P.getShapes;
  P.getShapes = function () {
    return origGetShapes.call(this).filter(s => !s.disabled);
  };

  // عرض المقفل باهتاً والمعطل شبه شفاف
  const origDrawShape = P._drawShape;
  P._drawShape = function (s) {
    const { ctx } = this;
    if (s.disabled || s.locked) {
      ctx.save();
      ctx.globalAlpha = s.disabled ? 0.25 : 0.55;
      if (s.disabled) ctx.setLineDash([5, 4]);
      origDrawShape.call(this, s);
      ctx.restore();
      return;
    }
    origDrawShape.call(this, s);
  };

  /* ══════════════════ 6) جسور التثبيت Tabs ══════════════════ */
  P.applyTabs = function (count, width) {
    const s = this.shapes[this.selectedIdx];
    if (!s) return toast('حدد شكلاً مغلقاً أولاً', 'warn');
    const pts = this._toClosedPoints(s);
    if (!pts || pts.length < 8) return toast('الجسور تعمل على الأشكال المغلقة فقط', 'warn');

    // المحيط التراكمي
    const cum = [0];
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1], b = pts[i % pts.length];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const L = cum[pts.length];
    if (width * count >= L * 0.8) return toast('الجسور أعرض من المحيط!', 'warn');

    // نقطة على المحيط عند مسافة d
    const at = (d) => {
      d = ((d % L) + L) % L;
      let i = 0;
      while (i < pts.length - 1 && cum[i + 1] < d) i++;
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const seg = cum[i + 1] - cum[i] || 1;
      const t = (d - cum[i]) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, idx: i };
    };

    // مقاطع القطع بين الجسور
    const segs = [];
    for (let k = 0; k < count; k++) {
      const gapCenter = (k + 0.5) * (L / count);
      const start = gapCenter + width / 2;            // نهاية الجسر = بداية القطع
      const end   = gapCenter - width / 2 + L / count * 0; // بداية الجسر التالي... نحسب لكل مقطع
      segs.push(start);
    }

    const newShapes = [];
    for (let k = 0; k < count; k++) {
      const segStart = (k + 0.5) * (L / count) + width / 2;
      const segEnd   = ((k + 1.5) % count === 0 ? count + 0.5 : k + 1.5) * (L / count) - width / 2;
      const from = segStart, to = (k + 1.5) * (L / count) - width / 2;
      // اجمع النقاط من from إلى to
      const segPts = [at(from)];
      let d = Math.ceil(from);
      // أدرج رؤوس المضلع الواقعة داخل المقطع
      for (let i = 0; i < pts.length; i++) {
        let cd = cum[i];
        // اجعل cd ضمن نافذة from..to (مع الالتفاف)
        while (cd < from) cd += L;
        if (cd < to) segPts.push({ ...pts[i], _d: cd });
      }
      segPts.sort((a, b2) => (a._d ?? from) - (b2._d ?? from));
      segPts.push(at(to));
      const clean = segPts.map(p => ({ x: p.x, y: p.y }));
      if (clean.length >= 2) newShapes.push({ type: 'polyline', points: clean, closed: false });
    }

    if (!newShapes.length) return toast('تعذر إنشاء الجسور', 'error');
    this._saveHistory();
    this.shapes.splice(this.selectedIdx, 1, ...newShapes);
    this.selectedIdx = -1; this.msel.clear();
    this._updateShapeToolbar();
    this.render(); this._updateStatus();
    toast(`✓ ${count} جسور تثبيت بعرض ${width}mm — القطعة لن تطير`, 'success');
  };

  /* ══════════════════ 7) تدوير الزوايا Fillet ══════════════════ */
  P.applyFillet = function (r) {
    const s = this.shapes[this.selectedIdx];
    if (!s) return toast('حدد شكلاً أولاً', 'warn');
    let pts = null;
    if (s.type === 'rect') pts = [{x:s.x,y:s.y},{x:s.x+s.w,y:s.y},{x:s.x+s.w,y:s.y+s.h},{x:s.x,y:s.y+s.h}];
    else if (s.type === 'polygon' || (s.type === 'polyline' && s.closed)) pts = s.points;
    if (!pts || pts.length < 3) return toast('تدوير الزوايا للمضلعات المغلقة فقط', 'warn');

    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const A = pts[(i - 1 + n) % n], B = pts[i], C = pts[(i + 1) % n];
      const v1 = { x: A.x - B.x, y: A.y - B.y }, v2 = { x: C.x - B.x, y: C.y - B.y };
      const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
      const u1 = { x: v1.x / l1, y: v1.y / l1 }, u2 = { x: v2.x / l2, y: v2.y / l2 };
      const cosT = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
      const theta = Math.acos(cosT);
      const trim = Math.min(r / Math.tan(theta / 2), l1 / 2.2, l2 / 2.2);
      if (!isFinite(trim) || trim < 0.05 || theta > Math.PI - 0.05) { out.push({ ...B }); continue; }
      const T1 = { x: B.x + u1.x * trim, y: B.y + u1.y * trim };
      const T2 = { x: B.x + u2.x * trim, y: B.y + u2.y * trim };
      // قوس تقريبي بين T1 و T2 (منحنى رباعي ضابطه رأس الزاوية)
      const steps = 6;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        out.push({
          x: (1 - t) ** 2 * T1.x + 2 * (1 - t) * t * B.x + t * t * T2.x,
          y: (1 - t) ** 2 * T1.y + 2 * (1 - t) * t * B.y + t * t * T2.y,
        });
      }
    }
    this._saveHistory();
    this.shapes[this.selectedIdx] = { type: 'polyline', points: out, closed: true };
    this.render(); this._updateStatus();
    toast(`✓ زوايا مدورة بنصف قطر ~${r}mm`, 'success');
  };

  /* ══════════════════ 8) نقطة بداية القطع ══════════════════ */
  P.cycleStartPoint = function () {
    const s = this.shapes[this.selectedIdx];
    if (!s || !((s.type === 'polyline' && s.closed) || s.type === 'polygon') || !s.points?.length)
      return toast('نقطة البداية للمسارات المغلقة فقط', 'warn');
    this._saveHistory();
    const shift = Math.max(1, Math.round(s.points.length / 8));
    s.points = [...s.points.slice(shift), ...s.points.slice(0, shift)];
    this.render();
    toast('◉ تحركت نقطة بداية القطع — كرر للمزيد', 'info');
  };

  /* ══════════════════ 9) معلومات وموضع دقيق ══════════════════ */
  P.openShapeInfo = function () {
    const s = this.shapes[this.selectedIdx];
    if (!s) return toast('حدد شكلاً أولاً', 'warn');
    const b = this._bounds(s);
    document.getElementById('si-x').value = b.minX.toFixed(2);
    document.getElementById('si-y').value = b.minY.toFixed(2);
    document.getElementById('si-w').textContent = (b.maxX - b.minX).toFixed(2);
    document.getElementById('si-h').textContent = (b.maxY - b.minY).toFixed(2);
    document.getElementById('si-len').textContent = this._shapeLen(s).toFixed(1);
    document.getElementById('si-type').textContent = s.type + (s.disabled ? ' (معطل)' : '') + (s.locked ? ' 🔒' : '');
    document.getElementById('dlg-shapeinfo').showModal();
  };

  P.applyShapeInfo = function () {
    const s = this.shapes[this.selectedIdx];
    if (!s) return;
    const b = this._bounds(s);
    const nx = parseFloat(document.getElementById('si-x').value);
    const ny = parseFloat(document.getElementById('si-y').value);
    if (isFinite(nx) && isFinite(ny)) {
      this._saveHistory();
      this._offsetShape(s, nx - b.minX, ny - b.minY);
      this.render(); this._updateStatus();
    }
    document.getElementById('dlg-shapeinfo').close();
  };

  /* ══════════════════ 10) دمج المسارات ══════════════════ */
  P.joinSelected = function () {
    const idx = this._selIndices().filter(i => {
      const s = this.shapes[i];
      return s.type === 'polyline' && !s.closed;
    });
    if (idx.length < 2) return toast('حدد مسارين مفتوحين أو أكثر للدمج', 'warn');
    this._saveHistory();
    const merged = [];
    let cur = [...this.shapes[idx[0]].points];
    for (let k = 1; k < idx.length; k++) {
      const pts = this.shapes[idx[k]].points;
      const endC = cur[cur.length - 1];
      // صل من الطرف الأقرب
      const dStart = Math.hypot(pts[0].x - endC.x, pts[0].y - endC.y);
      const dEnd   = Math.hypot(pts[pts.length - 1].x - endC.x, pts[pts.length - 1].y - endC.y);
      cur = cur.concat(dEnd < dStart ? [...pts].reverse() : pts);
    }
    idx.sort((a, b) => b - a).forEach(i => this.shapes.splice(i, 1));
    this.shapes.push({ type: 'polyline', points: cur, closed: false });
    this.selectedIdx = this.shapes.length - 1;
    this.msel = new Set([this.selectedIdx]);
    this._updateShapeToolbar(); this.render(); this._updateStatus();
    toast(`✓ دُمجت ${idx.length} مسارات في مسار واحد`, 'success');
  };

  /* ══════════════════ 11) علامة مركز ══════════════════ */
  P.insertCenterMark = function () {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدد شكلاً أولاً', 'warn');
    this._saveHistory();
    for (const i of idx) {
      const b = this._bounds(this.shapes[i]);
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      const sz = Math.max(3, Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.15);
      this.shapes.push({ type: 'line', x1: cx - sz, y1: cy, x2: cx + sz, y2: cy });
      this.shapes.push({ type: 'line', x1: cx, y1: cy - sz, x2: cx, y2: cy + sz });
    }
    this.render(); this._updateStatus();
    toast('✛ أُدرجت علامات المركز (للتثقيب الدقيق)', 'success');
  };

  /* ══════════════════ 12) مستطيل إحاطة ══════════════════ */
  P.insertBoundingBox = function () {
    const idx = this._selIndices().length ? this._selIndices() : this.shapes.map((_, i) => i);
    if (!idx.length) return toast('لا أشكال', 'warn');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const i of idx) {
      const b = this._bounds(this.shapes[i]);
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    }
    this._saveHistory();
    this.shapes.push({ type: 'rect', x: minX, y: minY, w: maxX - minX, h: maxY - minY, disabled: true });
    this.render(); this._updateStatus();
    toast('⬚ مستطيل إحاطة (معطل من القطع — حدود الخامة)', 'success');
  };

  /* ══════════════════ 13) رصف على الخامة Nesting ══════════════════ */
  P.applyNesting = function (sheetW, sheetH, gap) {
    const idx = this._selIndices().length > 1 ? this._selIndices() : this.shapes.map((_, i) => i).filter(i => !this.shapes[i].locked);
    if (!idx.length) return toast('لا أشكال للرصف', 'warn');

    const items = idx.map(i => {
      const b = this._bounds(this.shapes[i]);
      return { i, b, w: b.maxX - b.minX, h: b.maxY - b.minY };
    }).sort((a, b2) => b2.h - a.h);

    this._saveHistory();
    let x = gap, y = gap, rowH = 0, placed = 0;
    for (const it of items) {
      if (x + it.w + gap > sheetW) { x = gap; y += rowH + gap; rowH = 0; }
      if (y + it.h + gap > sheetH) break;   // امتلأت الخامة
      this._offsetShape(this.shapes[it.i], x - it.b.minX, y - it.b.minY);
      x += it.w + gap;
      rowH = Math.max(rowH, it.h);
      placed++;
    }
    // حدود الخامة كمرجع (معطلة من القطع)
    this.shapes.push({ type: 'rect', x: 0, y: 0, w: sheetW, h: sheetH, disabled: true, locked: true });
    this.fitToView(); this._updateStatus();
    toast(placed === items.length
      ? `✓ رُصفت ${placed} قطعة على خامة ${sheetW}×${sheetH}mm`
      : `⚠ رُصف ${placed}/${items.length} — البقية لا تتسع`, placed === items.length ? 'success' : 'warn');
  };

  /* ══════════════════ 14) دائرة براغي ══════════════════ */
  P.applyBoltCircle = function (cx, cy, n, circleD, holeD) {
    this._saveHistory();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI - Math.PI / 2;
      this.shapes.push({
        type: 'circle',
        cx: cx + (circleD / 2) * Math.cos(a),
        cy: cy + (circleD / 2) * Math.sin(a),
        r: holeD / 2,
      });
    }
    this.render(); this._updateStatus();
    toast(`✓ ${n} ثقوب ⌀${holeD}mm على دائرة ⌀${circleD}mm`, 'success');
  };

  /* ══════════════════ 15) تكبير 1:1 ══════════════════ */
  P.zoom100 = function () {
    const c = this._sToW(this.canvas.width / 2, this.canvas.height / 2);
    this.scale = 2;
    const sc = this._wToS(c.x, c.y);
    this.offset.x += this.canvas.width / 2 - sc.x;
    this.offset.y += this.canvas.height / 2 - sc.y;
    const el = document.getElementById('canvas-zoom');
    if (el) el.textContent = '100%';
    this.render();
  };

  /* ══════════════════ 16-17) ترقيم القطع + أسهم الاتجاه ══════════════════ */
  P.toggleCutOrder  = function () { this.showCutOrder  = !this.showCutOrder;  this.render(); toast(this.showCutOrder  ? '① أرقام تسلسل القطع ظاهرة' : 'أُخفيت الأرقام'); };
  P.toggleDirection = function () { this.showDirection = !this.showDirection; this.render(); toast(this.showDirection ? '➤ أسهم اتجاه القطع ظاهرة' : 'أُخفيت الأسهم'); };

  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    const { ctx } = this;
    if (this.showCutOrder) {
      ctx.save();
      ctx.font = 'bold 11px Tajawal, monospace';
      let order = 1;
      for (const s of this.shapes) {
        if (s.disabled) continue;
        const o = this._shapeOrigin(s);
        const p = this._wToS(o.x, o.y);
        ctx.fillStyle = '#d29922';
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(order++), p.x, p.y);
      }
      ctx.restore();
    }
    if (this.showDirection) {
      ctx.save();
      ctx.fillStyle = '#79c0ff';
      for (const s of this.shapes) {
        if (s.disabled) continue;
        let a = null, b = null;
        if (s.type === 'line') { a = { x: s.x1, y: s.y1 }; b = { x: s.x2, y: s.y2 }; }
        else if ((s.type === 'polyline' || s.type === 'polygon') && s.points?.length > 1) {
          const m = Math.floor(s.points.length / 2);
          a = s.points[m - 1]; b = s.points[m];
        } else if (s.type === 'circle') {
          a = { x: s.cx + s.r, y: s.cy }; b = { x: s.cx + s.r, y: s.cy + (s.reversed ? 1 : -1) };
        }
        if (!a || !b) continue;
        const pa = this._wToS(a.x, a.y), pb = this._wToS(b.x, b.y);
        const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 4); ctx.lineTo(-4, -4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  };

  /* ══════════════════ 18-20) أشكال: سهم مزدوج · إطار · قوس 3 نقاط ══════════════════ */
  const origBuild = P._buildShape;
  P._buildShape = function (start, end) {
    if (this.tool === 'double-arrow') {
      const dx = end.x - start.x, dy = end.y - start.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) return null;
      const u = { x: dx / len, y: dy / len }, v = { x: -u.y, y: u.x };
      const hw = Math.max(2, len * 0.06), hh = Math.max(5, len * 0.16);
      const p = (base, du, dv) => ({ x: base.x + u.x * du + v.x * dv, y: base.y + u.y * du + v.y * dv });
      return { type: 'polyline', closed: true, points: [
        p(start, 0, 0), p(start, hh, hh * 0.7), p(start, hh, hw),
        p(end, -hh, hw), p(end, -hh, hh * 0.7), p(end, 0, 0),
        p(end, -hh, -hh * 0.7), p(end, -hh, -hw),
        p(start, hh, -hw), p(start, hh, -hh * 0.7),
      ]};
    }
    if (this.tool === 'frame') {
      const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
      const t = Math.max(2, Math.min(w, h) * 0.15);
      if (w < 4 || h < 4) return null;
      // أُدرج الداخلي يدوياً — التاريخ حُفظ في _onUp قبل البناء
      this.shapes.push({ type: 'rect', x: x + t, y: y + t, w: w - 2 * t, h: h - 2 * t });
      return { type: 'rect', x, y, w, h };
    }
    return origBuild.call(this, start, end);
  };

  // قوس بثلاث نقاط — آلة حالات بالنقرات
  const origOnDown = P._onDown;
  P._onDown = function (e) {
    if (this.tool === 'arc3' && e.button === 0) {
      const pt = this._evPt(e);
      if (!this._arc3) this._arc3 = [];
      this._arc3.push(pt);
      if (this._arc3.length === 3) {
        const [p1, p2, p3] = this._arc3;
        const arc = circleFrom3(p1, p2, p3);
        this._arc3 = null;
        if (arc) {
          this._saveHistory();
          this.shapes.push(arc);
          this._updateStatus();
        } else toast('النقاط على استقامة واحدة — لا قوس', 'warn');
      }
      this.render();
      return;
    }
    if (this.tool !== 'arc3') this._arc3 = null;

    /* لاسو = تحديد حقيقي (يستبدل سلوك الرسم القديم) */
    if (this.tool === 'lasso' && e.button === 0) {
      this.isDrawing = true;
      this.currentPath = [this._evPt(e)];
      this._lassoSelect = true;
      return;
    }
    origOnDown.call(this, e);
  };

  const origOnUp = P._onUp;
  P._onUp = function (e) {
    if (this.tool === 'lasso' && this._lassoSelect) {
      this._lassoSelect = false;
      const poly = this.currentPath || [];
      this.currentPath = []; this.isDrawing = false; this.previewPt = null;
      if (poly.length >= 3) {
        const inside = (p) => {
          let c = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            if ((poly[i].y > p.y) !== (poly[j].y > p.y) &&
                p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
          }
          return c;
        };
        // بدّل الأداة أولاً — setTool يستدعي _cancelDraw الذي يمسح msel
        this.setTool('select');
        this.msel = new Set();
        this.shapes.forEach((s, i) => {
          if (s.locked) return;
          const b = this._bounds(s);
          if (inside({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })) this.msel.add(i);
        });
        this.selectedIdx = this.msel.size ? [...this.msel][this.msel.size - 1] : -1;
        this._updateShapeToolbar();
        toast(this.msel.size ? `◌ حُدد ${this.msel.size} شكلاً باللاسو` : 'لا شيء داخل اللاسو');
      }
      this.render();
      return;
    }
    origOnUp.call(this, e);
  };

  // معاينة قوس الثلاث نقاط
  const origPreview = P._drawPreview;
  P._drawPreview = function (start, end) {
    if (this.tool === 'arc3' && this._arc3?.length) {
      const { ctx } = this;
      ctx.save(); ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const p0 = this._wToS(this._arc3[0].x, this._arc3[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < this._arc3.length; i++) {
        const p = this._wToS(this._arc3[i].x, this._arc3[i].y);
        ctx.lineTo(p.x, p.y);
      }
      if (this.previewPt) {
        const p = this._wToS(this.previewPt.x, this.previewPt.y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke(); ctx.restore();
      return;
    }
    origPreview.call(this, start, end);
  };

  function circleFrom3(p1, p2, p3) {
    const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
    if (Math.abs(d) < 1e-9) return null;
    const s1 = p1.x ** 2 + p1.y ** 2, s2 = p2.x ** 2 + p2.y ** 2, s3 = p3.x ** 2 + p3.y ** 2;
    const cx = (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d;
    const cy = (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d;
    const r = Math.hypot(p1.x - cx, p1.y - cy);
    let a1 = Math.atan2(p1.y - cy, p1.x - cx);
    let am = Math.atan2(p2.y - cy, p2.x - cx);
    let a3 = Math.atan2(p3.y - cy, p3.x - cx);
    // الاتجاه: يجب أن يمر القوس بالنقطة الوسطى
    const ccwContains = (s, m, e2) => {
      const norm = (a) => (a - s + 2 * Math.PI * 2) % (2 * Math.PI);
      return norm(m) <= norm(e2);
    };
    const clockwise = !ccwContains(a1, am, a3);
    return { type: 'arc', cx, cy, r, startAngle: a1, endAngle: a3, clockwise };
  }

  /* ══════════════════ ربط نوافذ الحوار ══════════════════ */
  const origInit = P.initExtraTools;
  P.initExtraTools = function () {
    if (origInit) origInit.call(this);
    this.showCutOrder = false;
    this.showDirection = false;

    document.getElementById('btn-tabs-apply')?.addEventListener('click', () => {
      const c = Math.max(2, parseInt(document.getElementById('tabs-count')?.value) || 4);
      const w = Math.max(0.5, parseFloat(document.getElementById('tabs-width')?.value) || 5);
      document.getElementById('dlg-tabs').close();
      this.applyTabs(c, w);
    });
    document.getElementById('btn-fillet-apply')?.addEventListener('click', () => {
      const r = Math.max(0.2, parseFloat(document.getElementById('fillet-radius')?.value) || 5);
      document.getElementById('dlg-fillet').close();
      this.applyFillet(r);
    });
    document.getElementById('btn-nesting-apply')?.addEventListener('click', () => {
      const w = Math.max(10, parseFloat(document.getElementById('nest-w')?.value) || 600);
      const h = Math.max(10, parseFloat(document.getElementById('nest-h')?.value) || 400);
      const g = Math.max(0, parseFloat(document.getElementById('nest-gap')?.value) || 5);
      document.getElementById('dlg-nesting').close();
      this.applyNesting(w, h, g);
    });
    document.getElementById('btn-bolt-apply')?.addEventListener('click', () => {
      const cx = parseFloat(document.getElementById('bolt-cx')?.value) || 0;
      const cy = parseFloat(document.getElementById('bolt-cy')?.value) || 0;
      const n  = Math.max(2, parseInt(document.getElementById('bolt-n')?.value) || 6);
      const D  = Math.max(1, parseFloat(document.getElementById('bolt-d')?.value) || 60);
      const hd = Math.max(0.2, parseFloat(document.getElementById('bolt-hole')?.value) || 6);
      document.getElementById('dlg-boltcircle').close();
      this.applyBoltCircle(cx, cy, n, D, hd);
    });
    document.getElementById('btn-si-apply')?.addEventListener('click', () => this.applyShapeInfo());

    // أزرار شريط الشكل المحدد
    const bind = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    bind('st-rot90l',     () => this.rotate90(1));
    bind('st-rot90r',     () => this.rotate90(-1));
    bind('st-reverse',    () => this.reverseSelected());
    bind('st-lock',       () => this.toggleLockSelected());
    bind('st-disable',    () => this.toggleDisableSelected());
    bind('st-tabs',       () => { if (this.selectedIdx >= 0) document.getElementById('dlg-tabs').showModal(); });
    bind('st-fillet',     () => { if (this.selectedIdx >= 0) document.getElementById('dlg-fillet').showModal(); });
    bind('st-startpoint', () => this.cycleStartPoint());
    bind('st-info',       () => this.openShapeInfo());
  };
})();
