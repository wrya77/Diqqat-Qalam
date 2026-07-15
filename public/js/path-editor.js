/**
 * path-editor.js — تكامل نموذج المسار البيزيري (P0) مع المحرر
 *
 *  يعلّم المحرر النوع الجديد type:'path' (مراسٍ بمقابض — shared/PathModel):
 *   - رسم bezierCurveTo حقيقي + حدود مضبوطة + التقاط + تحويلات تحوّل المقابض
 *   - أدوات العُقَد على المسارات: سحب المراسي والمقابض، Alt = كسر النعومة،
 *     node-add يقسم المقطع de Casteljau (يحافظ على الشكل)، node-conv يبدّل
 *     زاوية ↔ ناعمة — سلوك Illustrator
 *   - قلم البيزير يُخرج مساراً حياً (لا polyline مفلّطة) والنقر قرب البداية يغلقه
 *   - «تحويل إلى مسار» يصير بلا فقد (دائرة تبقى دائرة رياضياً)
 *
 *  يُحمَّل مباشرة بعد canvas-editor.js فتكون لفّاته الأعمق: أغلفة الألوان
 *  والطبقات فوقه تعمل على المسارات كأي شكل. لا مساس بأي id/class.
 */
(function pathEditor() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const PM = (typeof DQ !== 'undefined' && DQ.PathModel) || null;
  if (!PM) { console.warn('path-editor: PathModel غير محمّل'); return; }
  const P = CanvasEditor.prototype;
  const isPath = PM.isPath;

  /* ═══════════════ 1) الرسم ═══════════════ */
  const origDraw = P._drawShape;
  P._drawShape = function (s) {
    if (!isPath(s)) return origDraw.call(this, s);
    const { ctx } = this;
    ctx.beginPath(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const segs = PM.segments(s);
    if (segs.length) {
      const p0 = this._wToS(segs[0].p0.x, segs[0].p0.y);
      ctx.moveTo(p0.x, p0.y);
      for (const g of segs) {
        const c1 = this._wToS(g.c1.x, g.c1.y), c2 = this._wToS(g.c2.x, g.c2.y), p1 = this._wToS(g.p1.x, g.p1.y);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p1.x, p1.y);
      }
      if (s.closed) ctx.closePath();
    }
    if (s.fill) {
      ctx.save(); ctx.fillStyle = this._resolveFill(s.fill, s);
      ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.35; ctx.fill('evenodd'); ctx.restore();
    }
    ctx.stroke();
  };

  /* ═══════════════ 2) الهندسة الأساسية ═══════════════ */
  const origToPath = P._toPath;
  P._toPath = function (s) {
    if (!isPath(s)) return origToPath.call(this, s);
    // تفليط متكيّف 0.02mm — أدقّ من N=64 الثابتة وأخفّ للأشكال الصغيرة
    const f = PM.flatten(s, 0.02);
    return { type: 'polyline', points: f.points, closed: f.closed };
  };

  const origBounds = P._bounds;
  P._bounds = function (s) { return isPath(s) ? PM.bounds(s) : origBounds.call(this, s); };

  const origNear = P._isNear;
  P._isNear = function (s, pt, tol) {
    if (!isPath(s)) return origNear.call(this, s, pt, tol);
    const n = PM.nearest(s, pt);
    return !!n && n.dist < (tol || 3 / this.scale);
  };

  const origOrigin = P._shapeOrigin;
  P._shapeOrigin = function (s) {
    return isPath(s) ? { x: s.anchors[0]?.x || 0, y: s.anchors[0]?.y || 0 } : origOrigin.call(this, s);
  };

  const origOffset = P._offsetShape;
  P._offsetShape = function (s, dx, dy) { isPath(s) ? PM.translate(s, dx, dy) : origOffset.call(this, s, dx, dy); };

  const origRotate = P._rotateShape;
  P._rotateShape = function (s, th, cx, cy) { isPath(s) ? PM.rotate(s, th, cx, cy) : origRotate.call(this, s, th, cx, cy); };

  const origScale = P._scaleShape;
  P._scaleShape = function (s, fx, fy, cx, cy) { isPath(s) ? PM.scale(s, fx, fy, cx, cy) : origScale.call(this, s, fx, fy, cx, cy); };

  /* ═══════════════ 3) تحرير العُقَد بالمقابض ═══════════════ */
  const NODE_TOOLS = new Set(['node', 'node-add', 'node-del', 'node-conv']);

  function hitPathAnchor(ed, s, pt) {
    const tol = 9 / ed.scale;
    let best = -1, bd = tol;
    s.anchors.forEach((a, i) => {
      const d = Math.hypot(a.x - pt.x, a.y - pt.y);
      if (d <= bd) { bd = d; best = i; }
    });
    return best;
  }

  /* مقبض تحت المؤشر: {i, side:'hin'|'hout'} — يُفحص قبل المراسي (المقبض فوقها بصرياً) */
  function hitPathHandle(ed, s, pt) {
    const tol = 8 / ed.scale;
    let best = null, bd = tol;
    s.anchors.forEach((a, i) => {
      for (const side of ['hin', 'hout']) {
        const h = a[side];
        if (Math.hypot(h.x, h.y) < 1e-9) continue;
        const d = Math.hypot(a.x + h.x - pt.x, a.y + h.y - pt.y);
        if (d <= bd) { bd = d; best = { i, side }; }
      }
    });
    return best;
  }

  const origNodeDown = P._nodeDown;
  P._nodeDown = function (pt) {
    // أي شكل تحت المؤشر؟ الأشكال البارامترية تتحوّل هنا مساراً بيزيرياً بلا فقد
    let idx = (this.selectedIdx >= 0 && isPath(this.shapes[this.selectedIdx])) ? this.selectedIdx : -1;
    if (idx < 0) {
      const hit = this._hitTest(pt);
      if (hit >= 0 && isPath(this.shapes[hit])) { idx = hit; this.selectedIdx = hit; this._updateShapeToolbar?.(); }
      else if (hit >= 0 && this.shapes[hit].type !== 'polyline') {
        const np = PM.fromShape(this.shapes[hit]);
        if (np) {
          this._saveHistory();
          this.shapes[hit] = np; this.selectedIdx = hit; idx = hit;
          this._updateShapeToolbar?.();
          window.app?.toast?.('حُوّل الشكل إلى مسار بيزيري — حرّر مراسيه ومقابضه', 'info');
        }
      }
    }
    if (idx < 0) return origNodeDown.call(this, pt);   // polyline قديمة → المحرّر النقطي القائم

    const s = this.shapes[idx];
    const mode = this.tool === 'node-add' ? 'add'
               : this.tool === 'node-del' ? 'del'
               : this.tool === 'node-conv' ? 'conv' : 'move';

    if (mode === 'add') {
      const n = PM.nearest(s, pt);
      if (n && n.dist <= 14 / this.scale) {
        this._saveHistory();
        PM.splitSegment(s, n.segIdx, n.t);
        this.render(); this._updateStatus?.();
      } else window.app?.toast?.('اقترب أكثر من المسار لإضافة مرساة', 'info');
      return;
    }

    const ai = hitPathAnchor(this, s, pt);

    if (mode === 'del') {
      if (ai >= 0) {
        if (PM.removeAnchor(s, ai)) { this._saveHistory(); this.render(); this._updateStatus?.(); }
        else window.app?.toast?.('لا يمكن الحذف — يلزم مرساتان على الأقل', 'warn');
      }
      return;
    }
    if (mode === 'conv') {
      if (ai >= 0) {
        this._saveHistory();
        PM.setKind(s, ai, s.anchors[ai].kind === 'smooth' ? 'corner' : 'smooth');
        this.render();
      }
      return;
    }

    // move: المقبض أولاً (فوق المرساة بصرياً)، ثم المرساة
    const h = hitPathHandle(this, s, pt);
    if (h) { this._saveHistory(); this._pDrag = { idx, kind: 'handle', i: h.i, side: h.side }; return; }
    if (ai >= 0) { this._saveHistory(); this._pDrag = { idx, kind: 'anchor', i: ai }; return; }
  };

  const origOnMove = P._onMove;
  P._onMove = function (e) {
    const d = this._pDrag;
    if (d && e.buttons === 1) {
      const s = this.shapes[d.idx];
      if (!s || !isPath(s)) { this._pDrag = null; return; }
      const pt = this._evPt(e);
      const a = s.anchors[d.i];
      if (d.kind === 'anchor') {
        a.x = pt.x; a.y = pt.y;               // المقابض نسبية — تتبع المرساة تلقائياً
      } else {
        // Alt أثناء سحب المقبض = كسر النعومة (سلوك Illustrator)
        if (e.altKey && a.kind === 'smooth') a.kind = 'corner';
        a[d.side] = { x: pt.x - a.x, y: pt.y - a.y };
        PM.syncSmooth(a, d.side);
      }
      this.render(); this._updateStatus?.();
      return;
    }
    return origOnMove.call(this, e);
  };

  const origOnUp = P._onUp;
  P._onUp = function (e) {
    if (this._pDrag) { this._pDrag = null; this._updateShapeToolbar?.(); return; }
    return origOnUp.call(this, e);
  };

  /* ═══════════════ 4) عرض المراسي والمقابض ═══════════════ */
  const AC = '#58a6ff';
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    if (!NODE_TOOLS.has(this.tool)) return;
    const s = this.selectedIdx >= 0 ? this.shapes[this.selectedIdx] : null;
    if (!s || !isPath(s)) return;
    const ctx = this.ctx; if (!ctx) return;
    ctx.save();
    for (const a of s.anchors) {
      const p = this._wToS(a.x, a.y);
      // خطا المقبضين + عقدتاهما
      for (const side of ['hin', 'hout']) {
        const h = a[side];
        if (Math.hypot(h.x, h.y) < 1e-9) continue;
        const q = this._wToS(a.x + h.x, a.y + h.y);
        ctx.strokeStyle = 'rgba(88,166,255,.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.fillStyle = AC;
        ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, 7); ctx.fill();
      }
      // المرساة: مربع — ممتلئ للناعمة، مفرّغ للزاوية
      ctx.strokeStyle = AC; ctx.lineWidth = 1.5;
      ctx.fillStyle = a.kind === 'smooth' ? AC : (this._canvasTheme?.bg || '#0d1117');
      ctx.beginPath(); ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  };

  /* ═══════════════ 5) بعد تحميل كل الوحدات (DOMContentLoaded) ═══════════════
     _finishPen يعرّفه tools-vector-pro (يُحمَّل بعدنا) فنستبدله هنا لا عند التحميل */
  function boot() {
    /* القلم يُخرج مساراً بيزيرياً حياً — لا polyline مفلّطة */
    P._finishPen = function (close) {
      const nodes = this._pen || [];
      if (nodes.length < 2) { this._pen = null; this._penDrag = null; this.render(); return; }
      const path = PM.fromPenNodes(nodes, !!close);
      this._saveHistory();
      this.shapes.push(path);
      this._pen = null; this._penDrag = null; this.isDrawing = false;
      this.selectedIdx = this.shapes.length - 1;
      this._updateShapeToolbar?.(); this.render(); this._updateStatus?.();
      window.app?.toast?.(close ? '⬡ أُغلق المسار البيزيري' : '✓ مسار بيزيري', 'success');
    };

    /* نقرة قرب مرساة البداية تُغلق مسار القلم (سلوك Illustrator) */
    const outerDown = P._onDown;
    P._onDown = function (e) {
      if (this.tool === 'bezier' && this._pen && this._pen.length >= 2 && e.button === 0) {
        const pt = this._evPt(e);
        const p0 = this._pen[0];
        if (Math.hypot(pt.x - p0.x, pt.y - p0.y) <= 8 / this.scale) { this._finishPen(true); return; }
      }
      return outerDown.call(this, e);
    };

    /* Boolean/CNC تجمع النقاط عبر _toClosedPoints (tools-cnc) — علّمه المسارات */
    const origClosed = P._toClosedPoints;
    if (origClosed) {
      P._toClosedPoints = function (s, step) {
        if (!isPath(s)) return origClosed.call(this, s, step);
        if (!s.closed) return null;
        return PM.flatten(s, Math.min((step || 1.5) / 8, 0.05)).points;
      };
    }

    /* «تحويل إلى مسار» بلا فقد: دائرة تبقى دائرة رياضياً (مراسٍ بمقابض κ) */
    P.convertSelectedToPath = function () {
      const idxs = new Set();
      if (this.selectedIdx >= 0) idxs.add(this.selectedIdx);
      if (this.msel) for (const i of this.msel) idxs.add(i);
      if (!idxs.size) { window.app?.toast?.('حدد شكلاً أولاً', 'warn'); return; }
      let converted = 0, already = 0;
      this._saveHistory();
      for (const i of idxs) {
        const s = this.shapes[i];
        if (!s || isPath(s)) { already++; continue; }
        const np = PM.fromShape(s);
        if (np) { this.shapes[i] = np; converted++; }
      }
      this.render(); this._updateShapeToolbar?.(); this._updateStatus?.();
      if (converted) window.app?.toast?.(`✓ حُوّل ${converted} شكل إلى مسار بيزيري${already ? ` (${already} مسار أصلاً)` : ''}`, 'success');
      else window.app?.toast?.('المحدد مسار بالفعل', 'info');
    };
  }
  // سكربتات defer تنفَّذ عند readyState='interactive' — قبل أن يعرّف tools-vector-pro
  // قلمه. الانتظار حتى DOMContentLoaded (بعد كل defer) يضمن أن تجاوزاتنا هي الأخيرة.
  if (document.readyState === 'complete') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
