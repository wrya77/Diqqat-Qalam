/**
 * tools-live-transform.js — أدوات Illustrator التفاعلية الناقصة
 *
 *   rotate         ← تدوير حيّ: نقرة تضبط المحور، سحب يدوّر (Shift = خطوات 15°)
 *   scale          ← تحجيم حيّ: سحب يكبّر/يصغّر حول المحور (Shift = حفظ التناسب)
 *   free-transform ← تحويل حر: صندوق بمقابض — الزوايا تحجّم، المقبض العلوي يدوّر
 *   eraser         ← ممحاة: اسحب فرشاة دائرية فتمحو نقاط المسار تحتها
 *   knife          ← سكين: ارسم خطاً عبر شكل مغلق فينقسم إلى قطعتين
 *   blend          ← مزج: حدّد شكلين فتُولَّد أشكال وسيطة متدرّجة بينهما
 *
 * كلها تعيد استخدام مساعدات المحرر: _bounds · _toPath · _rotateShape · _scaleShape
 * · _selIndices · _saveHistory · _evPt · _wToS. لا هندسة جديدة في shared/.
 * يُحمَّل بعد tools-illustrator.js.
 */
(function liveTransformTools() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  const OWN = new Set(['rotate', 'scale', 'free-transform', 'eraser', 'knife', 'blend']);

  /* ═══════════════ مساعدات ═══════════════ */

  const idxs = e => (e._selIndices ? e._selIndices() : (e.selectedIdx >= 0 ? [e.selectedIdx] : []));

  function selBounds(e, list) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    list.forEach(i => {
      const b = e._bounds(e.shapes[i]);
      if (b.minX < minX) minX = b.minX; if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY; if (b.maxY > maxY) maxY = b.maxY;
    });
    if (!isFinite(minX)) return null;
    return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
  }

  // نقاط أي شكل عبر _toPath (نفس عقد tools-illustrator)
  function pathOf(e, s) {
    if (!s) return null;
    if (Array.isArray(s.points) && s.points.length >= 2) {
      return { points: s.points.map(p => ({ x: p.x, y: p.y })), closed: !!s.closed || s.type === 'polygon' };
    }
    const np = e._toPath ? e._toPath(s) : null;
    return (np && np.points && np.points.length >= 2) ? { points: np.points.map(p => ({ x: p.x, y: p.y })), closed: !!np.closed } : null;
  }

  const styleOf = s => ({ layer: s.layer, depth: s.depth, color: s.color, stroke: s.stroke });

  /* تقاطع قطعة AB مع قطعة CD — يعيد {t, pt} أو null (t على AB) */
  function segInt(a, b, c, d) {
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { t, pt: { x: a.x + t * rx, y: a.y + t * ry } };
  }

  /* إعادة أخذ عيّنات مسار إلى n نقطة متساوية المسافة القوسية */
  function resample(pts, closed, n) {
    const p = closed ? [...pts, pts[0]] : pts;
    const seg = [];
    let total = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const d = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
      seg.push(d); total += d;
    }
    if (total < 1e-9) return Array.from({ length: n }, () => ({ x: p[0].x, y: p[0].y }));
    const out = [];
    const step = total / (closed ? n : n - 1);
    let si = 0, acc = 0;
    for (let k = 0; k < n; k++) {
      let target = k * step;
      while (si < seg.length - 1 && acc + seg[si] < target) { acc += seg[si]; si++; }
      const r = seg[si] > 1e-9 ? (target - acc) / seg[si] : 0;
      out.push({ x: p[si].x + (p[si + 1].x - p[si].x) * r, y: p[si].y + (p[si + 1].y - p[si].y) * r });
    }
    return out;
  }

  /* ═══════════════ تنظيف الحالة عند تبديل الأداة ═══════════════ */
  const origSetTool = P.setTool;
  P.setTool = function (t) {
    this._xfPivot = null; this._xfDrag = null; this._ftBox = null;
    this._eraseTrail = null; this._knifeA = null; this._knifeB = null;
    origSetTool.call(this, t);
    if (t === 'free-transform') this._ftSync?.();
  };

  /* ═══════════════ تحويل حر: بناء الصندوق ═══════════════ */
  P._ftSync = function () {
    const list = idxs(this);
    this._ftBox = list.length ? selBounds(this, list) : null;
    this.render();
  };

  // مقابض الصندوق في إحداثيات العالم: 4 زوايا + 4 منتصفات + مقبض دوران
  function ftHandles(b) {
    return [
      { id: 'nw', x: b.minX, y: b.maxY }, { id: 'n', x: b.cx, y: b.maxY }, { id: 'ne', x: b.maxX, y: b.maxY },
      { id: 'w', x: b.minX, y: b.cy }, { id: 'e', x: b.maxX, y: b.cy },
      { id: 'sw', x: b.minX, y: b.minY }, { id: 's', x: b.cx, y: b.minY }, { id: 'se', x: b.maxX, y: b.minY },
      { id: 'rot', x: b.cx, y: b.maxY + Math.max(b.h * 0.14, 4) },
    ];
  }

  // النقطة الثابتة المقابلة لكل مقبض
  function anchorFor(id, b) {
    const map = {
      nw: { x: b.maxX, y: b.minY }, ne: { x: b.minX, y: b.minY },
      sw: { x: b.maxX, y: b.maxY }, se: { x: b.minX, y: b.maxY },
      n: { x: b.cx, y: b.minY }, s: { x: b.cx, y: b.maxY },
      w: { x: b.maxX, y: b.cy }, e: { x: b.minX, y: b.cy },
    };
    return map[id];
  }

  /* ═══════════════ الفأرة ═══════════════ */
  const origOnDown = P._onDown;
  P._onDown = function (e) {
    if (!OWN.has(this.tool)) return origOnDown.call(this, e);
    const pt = this._evPt(e);
    const list = idxs(this);

    /* ── تدوير / تحجيم: نقرة يمنى تعيد ضبط المحور ── */
    if (this.tool === 'rotate' || this.tool === 'scale') {
      if (!list.length) { toast('حدّد شكلاً أولاً (أداة التحديد V)', 'warn'); return; }
      const b = selBounds(this, list);
      if (e.button === 2 || e.altKey) { this._xfPivot = pt; this.render(); toast('◎ ضُبط المحور', 'info'); return; }
      const piv = this._xfPivot || { x: b.cx, y: b.cy };
      this._saveHistory();
      this._xfDrag = {
        piv, start: pt, applied: 0, fx: 1, fy: 1,
        a0: Math.atan2(pt.y - piv.y, pt.x - piv.x),
        d0: Math.max(Math.hypot(pt.x - piv.x, pt.y - piv.y), 1e-6),
        list,
      };
      this.isDrawing = true;
      return;
    }

    /* ── تحويل حر: أمسك مقبضاً ── */
    if (this.tool === 'free-transform') {
      if (!list.length) { toast('حدّد شكلاً أولاً (أداة التحديد V)', 'warn'); return; }
      const b = selBounds(this, list);
      this._ftBox = b;
      const tol = 7 / this.scale;   // 7px بمقياس الشاشة
      const h = ftHandles(b).find(h2 => Math.hypot(h2.x - pt.x, h2.y - pt.y) <= tol);
      if (!h) { toast('امسك أحد مقابض الصندوق', 'info'); return; }
      this._saveHistory();
      this._xfDrag = h.id === 'rot'
        ? { mode: 'rot', piv: { x: b.cx, y: b.cy }, applied: 0, a0: Math.atan2(pt.y - b.cy, pt.x - b.cx), list, b }
        : { mode: 'scale', id: h.id, anchor: anchorFor(h.id, b), fx: 1, fy: 1, list, b };
      this.isDrawing = true;
      return;
    }

    /* ── ممحاة: ابدأ أثر الفرشاة ── */
    if (this.tool === 'eraser') {
      this._saveHistory();
      this._eraseTrail = [pt];
      this.isDrawing = true;
      this._eraseAt(pt);
      return;
    }

    /* ── سكين: ابدأ الخط ── */
    if (this.tool === 'knife') {
      this._knifeA = pt; this._knifeB = pt; this.isDrawing = true; return;
    }

    /* ── مزج: يعمل بالتحديد لا بالنقر ── */
    if (this.tool === 'blend') { this._blendSelection(); return; }
  };

  const origOnMove = P._onMove;
  P._onMove = function (e) {
    if (!OWN.has(this.tool)) return origOnMove.call(this, e);
    const pt = this._evPt(e);
    this.previewPt = pt;
    const ex = document.getElementById('cur-x'), ey = document.getElementById('cur-y');
    if (ex) ex.textContent = pt.x.toFixed(3); if (ey) ey.textContent = pt.y.toFixed(3);

    const d = this._xfDrag;

    if (this.tool === 'rotate' && d && e.buttons === 1) {
      let ang = Math.atan2(pt.y - d.piv.y, pt.x - d.piv.x) - d.a0;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);   // خطوات 15°
      const delta = ang - d.applied;
      if (Math.abs(delta) > 1e-7) {
        d.list.forEach(i => this.shapes[i] && this._rotateShape(this.shapes[i], delta, d.piv.x, d.piv.y));
        d.applied = ang;
        this.render(); this._updateStatus?.();
      }
      return;
    }

    if (this.tool === 'scale' && d && e.buttons === 1) {
      const dist = Math.max(Math.hypot(pt.x - d.piv.x, pt.y - d.piv.y), 1e-6);
      const f = dist / d.d0;
      // نطبّق النسبة التفاضلية فقط — التحجيم تراكمي على نفس الأشكال
      const step = f / (d.fx || 1);
      if (Math.abs(step - 1) > 1e-6) {
        d.list.forEach(i => this.shapes[i] && this._scaleShape(this.shapes[i], step, step, d.piv.x, d.piv.y));
        d.fx = f;
        this.render(); this._updateStatus?.();
      }
      return;
    }

    if (this.tool === 'free-transform' && d && e.buttons === 1) {
      if (d.mode === 'rot') {
        let ang = Math.atan2(pt.y - d.piv.y, pt.x - d.piv.x) - d.a0;
        if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
        const delta = ang - d.applied;
        if (Math.abs(delta) > 1e-7) {
          d.list.forEach(i => this.shapes[i] && this._rotateShape(this.shapes[i], delta, d.piv.x, d.piv.y));
          d.applied = ang;
          this.render(); this._updateStatus?.();
        }
        return;
      }
      // تحجيم من المقبض حول النقطة المقابلة
      const b = d.b, a = d.anchor;
      const horiz = /[ew]/.test(d.id), vert = /[ns]/.test(d.id);
      let fx = 1, fy = 1;
      if (horiz) { const w0 = b.maxX - a.x || a.x - b.minX; fx = Math.abs(w0) > 1e-6 ? (pt.x - a.x) / (d.id.includes('e') ? (b.maxX - a.x) : (b.minX - a.x)) : 1; }
      if (vert) { const h0 = d.id.includes('n') ? (b.maxY - a.y) : (b.minY - a.y); fy = Math.abs(h0) > 1e-6 ? (pt.y - a.y) / h0 : 1; }
      if (e.shiftKey && horiz && vert) { const m = Math.max(Math.abs(fx), Math.abs(fy)); fx = Math.sign(fx || 1) * m; fy = Math.sign(fy || 1) * m; }
      fx = clampF(fx); fy = clampF(fy);
      const sx = fx / d.fx, sy = fy / d.fy;
      if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) {
        d.list.forEach(i => this.shapes[i] && this._scaleShape(this.shapes[i], sx, sy, a.x, a.y));
        d.fx = fx; d.fy = fy;
        this.render(); this._updateStatus?.();
      }
      return;
    }

    if (this.tool === 'eraser' && this._eraseTrail && e.buttons === 1) {
      this._eraseTrail.push(pt); this._eraseAt(pt); return;
    }
    if (this.tool === 'knife' && this._knifeA && e.buttons === 1) { this._knifeB = pt; this.render(); return; }
    this.render();
  };

  const clampF = f => (!isFinite(f) || Math.abs(f) < 0.01) ? 0.01 : Math.max(-20, Math.min(20, f));

  const origOnUp = P._onUp;
  P._onUp = function (e) {
    if (!OWN.has(this.tool)) return origOnUp.call(this, e);
    this.isDrawing = false;

    if (this.tool === 'rotate' && this._xfDrag) {
      const deg = Math.round(this._xfDrag.applied * 180 / Math.PI);
      this._xfDrag = null;
      if (deg) toast(`↻ دوران ${deg}°`, 'success');
      this._updateShapeToolbar?.(); this.render(); return;
    }
    if (this.tool === 'scale' && this._xfDrag) {
      const pct = Math.round(this._xfDrag.fx * 100);
      this._xfDrag = null;
      if (pct !== 100) toast(`⤢ تحجيم ${pct}%`, 'success');
      this._updateShapeToolbar?.(); this.render(); return;
    }
    if (this.tool === 'free-transform') {
      this._xfDrag = null; this._ftSync(); this._updateShapeToolbar?.(); return;
    }
    if (this.tool === 'eraser' && this._eraseTrail) {
      this._eraseTrail = null;
      this._updateShapeToolbar?.(); this._updateStatus?.(); this.render(); return;
    }
    if (this.tool === 'knife' && this._knifeA) {
      const a = this._knifeA, b = this._evPt(e);
      this._knifeA = null; this._knifeB = null;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) this._knifeCut(a, b);
      this.previewPt = null; this.render();
      return;
    }
  };

  /* ═══════════════ الممحاة ═══════════════ */
  P._eraseAt = function (pt) {
    const r = Math.max((this.toolDiameter || 3) * 1.2, 6 / this.scale);   // نصف قطر الفرشاة
    let touched = false;
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      if (s.locked) continue;
      const p = pathOf(this, s);
      if (!p) continue;
      const keep = p.points.filter(q => Math.hypot(q.x - pt.x, q.y - pt.y) > r);
      if (keep.length === p.points.length) continue;
      touched = true;
      if (keep.length < 2) { this.shapes.splice(i, 1); continue; }
      // المسح يفتح الشكل المغلق ويحوّله إلى مسار حرّ
      this.shapes[i] = { ...styleOf(s), type: 'polyline', points: keep, closed: false, name: s.name };
    }
    if (touched) { this.selectedIdx = -1; this.msel?.clear?.(); this.render(); }
  };

  /* ═══════════════ السكين ═══════════════ */
  P._knifeCut = function (a, b) {
    const targets = idxs(this).length ? idxs(this) : this.shapes.map((_, i) => i);
    let cuts = 0;
    // من الأعلى للأسفل — الاستبدال يغيّر طول المصفوفة
    for (let k = targets.length - 1; k >= 0; k--) {
      const i = targets[k];
      const s = this.shapes[i];
      if (!s || s.locked) continue;
      const p = pathOf(this, s);
      if (!p || !p.closed || p.points.length < 3) continue;

      const pts = p.points;
      const hits = [];
      for (let j = 0; j < pts.length; j++) {
        const c = pts[j], d = pts[(j + 1) % pts.length];
        const x = segInt(c, d, a, b);
        if (x) hits.push({ seg: j, t: x.t, pt: x.pt });
      }
      if (hits.length !== 2) continue;   // نقطعه فقط عندما يعبر السكين الحدّ مرتين
      hits.sort((m, n) => (m.seg - n.seg) || (m.t - n.t));
      const [h1, h2] = hits;

      const partA = [h1.pt];
      for (let j = h1.seg + 1; j <= h2.seg; j++) partA.push(pts[j % pts.length]);
      partA.push(h2.pt);

      const partB = [h2.pt];
      for (let j = h2.seg + 1; j <= h1.seg + pts.length; j++) partB.push(pts[j % pts.length]);
      partB.push(h1.pt);

      if (partA.length < 3 || partB.length < 3) continue;
      if (!cuts) this._saveHistory();
      const base = styleOf(s);
      this.shapes.splice(i, 1,
        { ...base, type: 'polyline', points: partA, closed: true, name: (s.name || 'قطعة') + ' أ' },
        { ...base, type: 'polyline', points: partB, closed: true, name: (s.name || 'قطعة') + ' ب' });
      cuts++;
    }
    if (cuts) {
      this.selectedIdx = -1; this.msel?.clear?.();
      this._updateShapeToolbar?.(); this._updateStatus?.();
      toast(`🔪 قُطع ${cuts} شكل إلى قطعتين`, 'success');
    } else {
      toast('مرّر السكين عبر شكل مغلق بحيث يعبر حدّه مرتين', 'warn');
    }
  };

  /* ═══════════════ المزج ═══════════════ */
  P._blendSelection = function (steps) {
    const list = idxs(this);
    if (list.length !== 2) { toast('حدّد شكلين بالضبط للمزج (Shift+نقر)', 'warn'); return; }
    const A = pathOf(this, this.shapes[list[0]]), B = pathOf(this, this.shapes[list[1]]);
    if (!A || !B) { toast('تعذّر قراءة مسار أحد الشكلين', 'warn'); return; }
    const n = Math.max(2, Math.min(24, steps || +(window.prompt('عدد الأشكال الوسيطة (1–24):', '4') || 0) || 0));
    if (!n) return;
    const RES = 64;
    const pa = resample(A.points, A.closed, RES);
    let pb = resample(B.points, B.closed, RES);

    // دوّر مسار B ليبدأ من أقرب نقطة لبداية A — يمنع التواء المزج
    let best = 0, bestD = Infinity;
    for (let r = 0; r < RES; r++) {
      const d = Math.hypot(pb[r].x - pa[0].x, pb[r].y - pa[0].y);
      if (d < bestD) { bestD = d; best = r; }
    }
    pb = [...pb.slice(best), ...pb.slice(0, best)];

    this._saveHistory();
    const base = styleOf(this.shapes[list[0]]);
    const closed = A.closed && B.closed;
    for (let k = 1; k <= n; k++) {
      const u = k / (n + 1);
      this.shapes.push({
        ...base, type: 'polyline', closed,
        points: pa.map((p, j) => ({ x: p.x + (pb[j].x - p.x) * u, y: p.y + (pb[j].y - p.y) * u })),
        name: `مزج ${k}`,
      });
    }
    this.render(); this._updateStatus?.();
    toast(`◈ وُلّد ${n} شكل وسيط`, 'success');
  };

  /* ═══════════════ العرض فوق اللوحة ═══════════════ */
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    const ctx = this.ctx; if (!ctx) return;
    const AC = '#58a6ff';

    // محور التدوير/التحجيم
    if ((this.tool === 'rotate' || this.tool === 'scale')) {
      const list = idxs(this);
      if (list.length) {
        const b = selBounds(this, list);
        const piv = this._xfDrag?.piv || this._xfPivot || (b && { x: b.cx, y: b.cy });
        if (piv) {
          const p = this._wToS(piv.x, piv.y);
          ctx.save();
          ctx.strokeStyle = AC; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x + 9, p.y);
          ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x, p.y + 9); ctx.stroke();
          // خط حيّ نحو المؤشر + قراءة الزاوية/النسبة
          const d = this._xfDrag;
          if (d && this.previewPt) {
            const c = this._wToS(this.previewPt.x, this.previewPt.y);
            ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c.x, c.y); ctx.stroke();
            ctx.setLineDash([]);
            const txt = this.tool === 'rotate'
              ? `${Math.round(d.applied * 180 / Math.PI)}°`
              : `${Math.round((d.fx || 1) * 100)}%`;
            ctx.font = '600 12px monospace'; ctx.fillStyle = AC;
            ctx.fillText(txt, c.x + 10, c.y - 8);
          }
          ctx.restore();
        }
      }
    }

    // صندوق التحويل الحر
    if (this.tool === 'free-transform') {
      const list = idxs(this);
      const b = list.length ? selBounds(this, list) : null;
      if (b) {
        const tl = this._wToS(b.minX, b.maxY), br = this._wToS(b.maxX, b.minY);
        ctx.save();
        ctx.strokeStyle = AC; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.setLineDash([]);
        ftHandles(b).forEach(h => {
          const s = this._wToS(h.x, h.y);
          ctx.fillStyle = h.id === 'rot' ? AC : '#0d1117';
          ctx.strokeStyle = AC; ctx.lineWidth = 1.5;
          ctx.beginPath();
          if (h.id === 'rot') { ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill(); }
          else { ctx.rect(s.x - 3.5, s.y - 3.5, 7, 7); ctx.fill(); ctx.stroke(); }
        });
        const rp = this._wToS(b.cx, b.maxY), rh = ftHandles(b).find(h => h.id === 'rot');
        const rs = this._wToS(rh.x, rh.y);
        ctx.strokeStyle = AC; ctx.beginPath(); ctx.moveTo(rp.x, rp.y); ctx.lineTo(rs.x, rs.y); ctx.stroke();
        ctx.restore();
      }
    }

    // فرشاة الممحاة
    if (this.tool === 'eraser' && this.previewPt) {
      const r = Math.max((this.toolDiameter || 3) * 1.2, 6 / this.scale) * this.scale;
      const p = this._wToS(this.previewPt.x, this.previewPt.y);
      ctx.save();
      ctx.strokeStyle = '#f85149'; ctx.lineWidth = 1.3; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
      ctx.restore();
    }

    // خط السكين
    if (this.tool === 'knife' && this._knifeA && this._knifeB) {
      const a = this._wToS(this._knifeA.x, this._knifeA.y), b = this._wToS(this._knifeB.x, this._knifeB.y);
      ctx.save();
      ctx.strokeStyle = '#f85149'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }
  };
})();
