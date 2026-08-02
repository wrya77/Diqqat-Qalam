/**
 * tools-invent5.js — خمس أدوات أصيلة لا توجد في أي برنامج تصميم
 *
 * كل أداة هنا تجيب سؤالاً لا يطرحه برنامج رسم عادي، لأنه سؤال عن
 * **القطعة الفيزيائية** التي ستخرج من الآلة لا عن الصورة على الشاشة.
 *
 *  1) نقطة الاتزان  (balance)        ← أداة: مركز ثقل التصميم + ثقب تعليق يجعل
 *                                       اللوحة تتدلّى مستوية تماماً.
 *  2) الشدّ الموضعي (stretch-band)   ← أداة: يمطّ منطقة بعينها ويُبقي ما قبلها
 *                                       ثابتاً وما بعدها صلباً — كشيدة الخط العربي
 *                                       بالمليمتر (ليس Puppet Warp ولا Free Distort).
 *  3) كاشف الهشاشة  (fragility)      ← فعل: يجد «الأعناق» التي يقلّ فيها عرض الخامة
 *                                       عن حدّ الأمان فتنكسر القطعة عند القطع.
 *  4) ظلّ النقش     (engrave-shadow) ← فعل: يعرض الظلّ الذي سيلقيه النقش الغائر
 *                                       تحت زاوية إضاءة — لقراءة اللافتة قبل قطعها.
 *  5) معايرة الواقع (calibrate)      ← فعل: تُدخل مقاس قطعة اختبار كما قِسته
 *                                       بالقدمة، فيحسب خطأ الآلة ويصحّح التصميم كلّه.
 *
 * الأداتان التفاعليتان تُسجَّلان عبر ToolManager (بنية P1) — لا لفّ بروتوتايب
 * ولا اعتماد على ترتيب التحميل. الأفعال الثلاثة دوالّ على البروتوتايب.
 */
(function inventFive() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };

  /* ══════════════ أدوات مساعدة هندسية ══════════════ */

  /** كل الأشكال (أو المحددة) كمضلّعات نقاط في إحداثيات العالم */
  function polysOf(ed, indices) {
    const out = [];
    const list = indices && indices.length ? indices : ed.shapes.map((_, i) => i);
    for (const i of list) {
      const s = ed.shapes[i];
      if (!s || s.disabled) continue;
      let p = null;
      try { p = ed._toPath(s); } catch (_) { p = null; }
      if (p && p.points && p.points.length > 1) out.push({ i, pts: p.points, closed: !!p.closed });
    }
    return out;
  }

  /** مساحة ومركز ثقل مضلّع مغلق (صيغة رباط الحذاء) */
  function polyAreaCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const f = p.x * q.y - q.x * p.y;
      a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
    }
    a /= 2;
    if (Math.abs(a) < 1e-12) return null;
    return { area: a, cx: cx / (6 * a), cy: cy / (6 * a) };
  }

  /** مركز ثقل التصميم كله: مجموع موزون بالمساحات (الثقوب بمساحة سالبة تُطرح ذاتياً) */
  function designCentroid(ed, indices) {
    const polys = polysOf(ed, indices).filter(p => p.closed);
    let A = 0, sx = 0, sy = 0;
    for (const p of polys) {
      const c = polyAreaCentroid(p.pts);
      if (!c) continue;
      A += c.area; sx += c.cx * c.area; sy += c.cy * c.area;
    }
    if (Math.abs(A) < 1e-9) {
      // لا مساحات مغلقة — ارجع لمركز الصندوق المحيط كتقريب مفيد
      const all = polysOf(ed, indices);
      if (!all.length) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of all) for (const q of p.pts) {
        if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
        if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, area: 0, approx: true };
    }
    return { x: sx / A, y: sy / A, area: Math.abs(A), approx: false };
  }

  /** أصغر مسافة من نقطة إلى قطعة مستقيمة */
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  /** عيّنات على طول مضلّع بخطوة ثابتة — كل عيّنة تحمل رقم ضلعها الأصلي */
  function sample(pts, closed, step) {
    const out = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      const k = Math.max(1, Math.round(d / step));
      for (let j = 0; j < k; j++) {
        out.push({ x: p.x + (q.x - p.x) * j / k, y: p.y + (q.y - p.y) * j / k, seg: i });
      }
    }
    return out;
  }

  /* ══════════════ 1) نقطة الاتزان ══════════════ */

  P.balanceInfo = function () { return designCentroid(this, this._selIndices?.() || []); };

  /** يضع ثقب تعليق فوق مركز الثقل تماماً — فتتدلّى القطعة مستوية */
  P.placeHangHole = function (dia) {
    const c = designCentroid(this, this._selIndices?.() || []);
    if (!c) { toast('لا توجد أشكال لحساب الاتزان', 'warn'); return; }
    const idx = this._selIndices?.() || [];
    const polys = polysOf(this, idx);
    let maxY = -Infinity;
    for (const p of polys) for (const q of p.pts) if (q.y > maxY) maxY = q.y;
    if (!isFinite(maxY)) { toast('لا توجد أشكال لحساب الاتزان', 'warn'); return; }

    const r = Math.max(0.5, (+dia || 5) / 2);
    const y = maxY - r * 2.4;            // داخل الحافة العليا بمسافة آمنة
    this._saveHistory();
    this.shapes.push({ type: 'circle', cx: c.x, cy: y, r, layer: 'default', name: 'ثقب تعليق' });
    this.selectedIdx = this.shapes.length - 1;
    this.msel?.clear?.();
    this.render(); this._updateStatus?.(); this._updateShapeToolbar?.();
    toast(`⚖ ثقب تعليق Ø${(r * 2).toFixed(1)}mm فوق مركز الثقل (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`, 'success');
  };

  const balanceTool = {
    cursor: 'crosshair',
    onDown() { this.placeHangHole(5); return true; },
    onDraw(ctx) {
      const c = designCentroid(this, this._selIndices?.() || []);
      if (!c) return;
      const s = this._wToS(c.x, c.y);
      ctx.save();
      // خط الشاقول: القطعة تتدلّى على هذا الخط
      ctx.strokeStyle = 'rgba(210,153,34,.55)';
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, this.canvas.height); ctx.stroke();
      ctx.setLineDash([]);
      // علامة مركز الثقل (رمز الاتزان: ربعان معتمان متقابلان)
      ctx.translate(s.x, s.y);
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(13,17,23,.75)'; ctx.fill();
      ctx.strokeStyle = '#d29922'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = '#d29922';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 8, -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 8, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill();
      ctx.font = '11px var(--font-mono, monospace)';
      ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'left';
      const lbl = c.approx ? 'مركز تقريبي (لا مساحات مغلقة)'
                           : `مركز الثقل · ${c.area.toFixed(1)} mm²`;
      ctx.fillText(lbl, 14, 4);
      ctx.fillText('انقر لوضع ثقب تعليق', 14, 18);
      ctx.restore();
    },
  };

  /* ══════════════ 2) الشدّ الموضعي (الكشيدة) ══════════════ */

  /** يمطّ الأشكال المحددة عند x0 بمقدار d، بمنطقة تدرّج عرضها w */
  P.stretchAt = function (x0, d, w) {
    const idx = this._selIndices?.() || [];
    if (!idx.length) { toast('حدّد شكلاً أولاً ثم اسحب أفقياً للشدّ', 'warn'); return false; }
    if (Math.abs(d) < 1e-6) return false;
    const soft = Math.max(0.001, w || 0);
    const lo = x0 - soft / 2, hi = x0 + soft / 2;
    const shift = px => (px <= lo ? 0 : px >= hi ? d : d * (px - lo) / (hi - lo));

    this._saveHistory();
    for (const i of idx) {
      const s = this.shapes[i];
      if (!s || s.locked) continue;
      // حوّل إلى مسار حتى تُمطّ الأشكال الأوّلية (مستطيل/دائرة) لا تُزاح فقط
      let p = s;
      if (s.type !== 'polyline' && s.type !== 'polygon') {
        try { p = this._toPath(s); } catch (_) { p = null; }
        if (!p || !p.points) continue;
        p = { type: 'polyline', points: p.points, closed: !!p.closed,
              layer: s.layer, stroke: s.stroke, fill: s.fill, name: s.name };
        this.shapes[i] = p;
      }
      const pts = p.points;
      // قسّم القطع المارّة بمنطقة التدرّج كي ينحني الشدّ بدل أن يُميل ضلعاً كاملاً
      const dense = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        dense.push({ x: a.x, y: a.y });
        if (k === pts.length - 1 && !p.closed) break;
        const crosses = (a.x < hi && b.x > lo) || (b.x < hi && a.x > lo);
        if (!crosses) continue;
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.min(24, Math.max(2, Math.ceil(seg / Math.max(0.4, soft / 4))));
        for (let j = 1; j < n; j++) dense.push({ x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n });
      }
      p.points = dense.map(q => ({ x: q.x + shift(q.x), y: q.y }));
    }
    this.render(); this._updateStatus?.(); this._updateShapeToolbar?.();
    return true;
  };

  const SOFT_DEFAULT = 4;   // مم — عرض منطقة التدرّج (Shift = قطع حادّ)
  const stretchTool = {
    cursor: 'ew-resize',
    onDown(pt, e) {
      this._stretch = { x0: pt.x, x: pt.x, soft: e && e.shiftKey ? 0.2 : SOFT_DEFAULT };
      this.render();
      return true;
    },
    onMove(pt) {
      if (!this._stretch) return false;
      this._stretch.x = pt.x;
      this.render();
      return true;
    },
    onUp(pt) {
      const st = this._stretch;
      if (!st) return false;
      this._stretch = null;
      const d = pt.x - st.x0;
      if (this.stretchAt(st.x0, d, st.soft)) {
        toast(`↔ شُدّت المنطقة عند ${st.x0.toFixed(1)}mm بمقدار ${d >= 0 ? '+' : ''}${d.toFixed(2)}mm`, 'success');
      }
      this.render();
      return true;
    },
    onDraw(ctx) {
      const st = this._stretch;
      if (!st) return;
      const a = this._wToS(st.x0 - st.soft / 2, 0), b = this._wToS(st.x0 + st.soft / 2, 0);
      const cur = this._wToS(st.x, 0);
      ctx.save();
      ctx.fillStyle = 'rgba(47,129,247,.16)';
      ctx.fillRect(Math.min(a.x, b.x), 0, Math.abs(b.x - a.x) || 1, this.canvas.height);
      ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cur.x, 0); ctx.lineTo(cur.x, this.canvas.height); ctx.stroke();
      ctx.fillStyle = '#e6edf3'; ctx.font = '11px var(--font-mono, monospace)'; ctx.textAlign = 'center';
      ctx.fillText(`${(st.x - st.x0) >= 0 ? '+' : ''}${(st.x - st.x0).toFixed(2)} mm`, cur.x, 14);
      ctx.restore();
    },
  };

  /* ══════════════ 3) كاشف الهشاشة ══════════════ */

  /**
   * يجد «الأعناق»: نقاط يقلّ فيها عرض الخامة بين مسارين (أو بين شقّي المسار
   * نفسه) عن حدّ الأمان — وهي التي تنكسر أثناء القطع أو عند فكّ القطعة.
   * يختلف عن فاحص القطع: ذاك يقيس ما إذا كانت **الأداة** تدخل، وهذا يقيس
   * ما إذا كانت **الخامة** تصمد.
   */
  P.scanFragility = function (minWidth) {
    const limit = +minWidth > 0 ? +minWidth : (this._fragMin || 2);
    this._fragMin = limit;
    const polys = polysOf(this, []);
    if (polys.length === 0) { toast('لا توجد أشكال لفحصها', 'warn'); return []; }

    const STEP = Math.max(0.35, limit / 3);
    const sets = polys.map(p => ({ i: p.i, pts: sample(p.pts, p.closed, STEP), src: p }));
    const total = sets.reduce((n, s) => n + s.pts.length, 0);
    if (total > 9000) toast('التصميم كبير — الفحص قد يستغرق لحظة…', 'info');

    const hits = [];
    for (let a = 0; a < sets.length; a++) {
      const A = sets[a];
      for (let ia = 0; ia < A.pts.length; ia++) {
        const p = A.pts[ia];
        let best = Infinity, bq = null;
        for (let b = a; b < sets.length; b++) {
          const B = sets[b];
          const pts = B.src.pts, n = B.src.closed ? pts.length : pts.length - 1;
          for (let k = 0; k < n; k++) {
            if (b === a) {
              // ضلع العيّنة نفسه وجاراه ليسا «عنقاً» بل استمراريّة المسار.
              // ما عداهما — بما فيه الضلع المقابل — عرض خامة حقيقي يُقاس.
              const prev = (p.seg - 1 + n) % n, next = (p.seg + 1) % n;
              if (k === p.seg || k === prev || k === next) continue;
            }
            const q1 = pts[k], q2 = pts[(k + 1) % pts.length];
            const d = distToSeg(p.x, p.y, q1.x, q1.y, q2.x, q2.y);
            if (d < best) { best = d; bq = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 }; }
          }
        }
        if (best < limit && bq) hits.push({ x: p.x, y: p.y, w: best, to: bq });
      }
    }
    // ضغط النتائج: احتفظ بأسوأ نقطة في كل عنق (تجميع بالمسافة)
    hits.sort((u, v) => u.w - v.w);
    const kept = [];
    for (const h of hits) {
      if (kept.some(k => Math.hypot(k.x - h.x, k.y - h.y) < limit * 3)) continue;
      kept.push(h);
      if (kept.length >= 60) break;
    }
    this._fragile = kept;
    this.render();
    if (!kept.length) toast(`✅ لا أعناق أرقّ من ${limit}mm — التصميم متماسك`, 'success');
    else toast(`⚠ ${kept.length} عنق هشّ — الأرقّ ${kept[0].w.toFixed(2)}mm (الحدّ ${limit}mm)`, 'warn');
    return kept;
  };

  P.clearFragility = function () { this._fragile = null; this.render(); };

  P.promptFragility = function () {
    const v = prompt('أقلّ عرض خامة آمن (مم) — أرقّ من ذلك يُعدّ عنقاً هشّاً:', String(this._fragMin || 2));
    if (v == null) return;
    const n = parseFloat(v);
    if (!(n > 0)) { toast('قيمة غير صالحة', 'error'); return; }
    this.scanFragility(n);
  };

  /* ══════════════ 4) ظلّ النقش ══════════════ */

  P.toggleEngraveShadow = function () {
    this._engShadow = !this._engShadow;
    this.render();
    toast(this._engShadow ? '🌘 ظلّ النقش: يُعرض (زاوية الإضاءة ٤٥°)' : 'ظلّ النقش: مُطفأ', 'info');
    return this._engShadow;
  };

  /* ══════════════ 5) معايرة الواقع ══════════════ */

  /**
   * تُدخل المقاس الاسمي والمقاس المقيس بالقدمة لقطعة اختبار، فتُحسب:
   *   عامل التصحيح = الاسمي ÷ المقيس  → يُطبَّق تحجيماً على التصميم كلّه
   *   الكيرف الضمني = (الاسمي − المقيس) ÷ ٢  → عرض ما تأكله الأداة من كل جانب
   */
  P.calibrateFromMeasured = function (nominal, measured) {
    const nom = +nominal, mea = +measured;
    if (!(nom > 0) || !(mea > 0)) { toast('قيمتان موجبتان مطلوبتان', 'error'); return null; }
    const factor = nom / mea;
    const kerf = (nom - mea) / 2;
    if (Math.abs(factor - 1) < 1e-6) { toast('لا انحراف — الآلة مضبوطة', 'success'); return { factor, kerf }; }
    if (factor < 0.5 || factor > 2) { toast('الانحراف أكبر من الضعف — تحقّق من القياس', 'error'); return null; }

    const polys = polysOf(this, []);
    if (!polys.length) { toast('لا توجد أشكال للتصحيح', 'warn'); return null; }
    let minX = Infinity, minY = Infinity;
    for (const p of polys) for (const q of p.pts) { if (q.x < minX) minX = q.x; if (q.y < minY) minY = q.y; }

    this._saveHistory();
    const sc = (v, o) => o + (v - o) * factor;
    for (const s of this.shapes) {
      if (!s || s.locked) continue;
      switch (s.type) {
        case 'line': s.x1 = sc(s.x1, minX); s.x2 = sc(s.x2, minX); s.y1 = sc(s.y1, minY); s.y2 = sc(s.y2, minY); break;
        case 'rect': s.x = sc(s.x, minX); s.y = sc(s.y, minY); s.w *= factor; s.h *= factor; break;
        case 'circle': case 'arc': s.cx = sc(s.cx, minX); s.cy = sc(s.cy, minY); s.r *= factor; break;
        case 'ellipse': s.cx = sc(s.cx, minX); s.cy = sc(s.cy, minY); s.rx *= factor; s.ry *= factor; break;
        case 'polygon': s.cx = sc(s.cx, minX); s.cy = sc(s.cy, minY); s.r *= factor; break;
        case 'slot': s.cx1 = sc(s.cx1, minX); s.cx2 = sc(s.cx2, minX);
                     s.cy1 = sc(s.cy1, minY); s.cy2 = sc(s.cy2, minY); s.r *= factor; break;
        case 'polyline': s.points = s.points.map(q => ({ x: sc(q.x, minX), y: sc(q.y, minY) })); break;
        case 'compound': s.contours = (s.contours || []).map(r => r.map(q => ({ x: sc(q.x, minX), y: sc(q.y, minY) }))); break;
        case 'text': s.x = sc(s.x, minX); s.y = sc(s.y, minY);
                     if (s.width) s.width *= factor; if (s.height) s.height *= factor; break;
        default: break;
      }
    }
    this.render(); this._updateStatus?.(); this._updateShapeToolbar?.();
    const pct = ((factor - 1) * 100).toFixed(3);
    toast(`📏 صُحّح التصميم ${pct > 0 ? '+' : ''}${pct}% · الكيرف الضمني ${kerf.toFixed(3)}mm/جانب`, 'success');
    return { factor, kerf };
  };

  P.promptCalibrate = function () {
    const nom = prompt('المقاس الاسمي في التصميم (مم) — مثلاً ضلع مربّع الاختبار:', '100');
    if (nom == null) return;
    const mea = prompt('المقاس كما قِسته على القطعة المقطوعة (مم):', nom);
    if (mea == null) return;
    this.calibrateFromMeasured(nom, mea);
  };

  /* ══════════════ الرسم الإضافي (هشاشة + ظلّ) ══════════════ */
  const origPaintOverlays = P._paintOverlays;
  P._paintOverlays = function () {
    origPaintOverlays.call(this);
    const ctx = this.ctx;

    if (this._fragile && this._fragile.length) {
      ctx.save();
      for (const h of this._fragile) {
        const a = this._wToS(h.x, h.y), b = this._wToS(h.to.x, h.to.y);
        ctx.strokeStyle = '#f85149'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(248,81,73,.28)'; ctx.fill();
        ctx.strokeStyle = '#f85149'; ctx.lineWidth = 1; ctx.stroke();
      }
      const worst = this._fragile[0];
      const w = this._wToS(worst.x, worst.y);
      ctx.font = '11px var(--font-mono, monospace)'; ctx.fillStyle = '#f85149'; ctx.textAlign = 'left';
      ctx.fillText(`${worst.w.toFixed(2)}mm`, w.x + 10, w.y - 8);
      ctx.restore();
    }
  };

  /* الظلّ يُرسم تحت الأشكال: نلفّ _paintShape فنُسقط ظلّاً بمقدار العمق */
  const origPaintShape = P._paintShape;
  P._paintShape = function (i) {
    if (this._engShadow) {
      const s = this.shapes[i];
      if (s && !s.disabled) {
        const depth = +(s.maxDepth || this._defaultDepth || 3);
        const off = Math.max(1, depth * 1.6) * this.scale * 0.35;
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(off, off);              // زاوية إضاءة ٤٥° من أعلى-يسار
        ctx.globalAlpha = 0.34;
        // brightness(0) يُسوّد أي لون يرسمه _drawShape — فيخرج ظلّاً لا نسخة ملوّنة
        ctx.filter = 'blur(1.2px) brightness(0)';
        try { this._drawShape(s); } finally { ctx.restore(); }
      }
    }
    return origPaintShape.call(this, i);
  };

  /* ══════════════ التسجيل عبر ToolManager (بنية P1) ══════════════ */
  const origInstall = P._installCore;
  P._installCore = function () {
    origInstall.call(this);
    if (!this.tools) return;     // بلا ToolManager: تبقى الأفعال الثلاثة متاحة
    this.tools.register('balance', balanceTool);
    this.tools.register('stretch-band', stretchTool);
  };

  /* أفعال الشريط (data-act) — تُضاف لسجلّ tools-rail-flyout إن وُجد */
  function wireActs() {
    const A = window.DQToolAct;
    if (!A) return false;
    A.fragility = () => window.app?.editor?.promptFragility();
    A['engrave-shadow'] = () => window.app?.editor?.toggleEngraveShadow();
    A.calibrate = () => window.app?.editor?.promptCalibrate();
    return true;
  }
  if (!wireActs()) {
    // tools-rail-flyout.js يُحمَّل بعدنا — أعد المحاولة بعد جاهزية الصفحة
    document.addEventListener('DOMContentLoaded', wireActs);
    setTimeout(wireActs, 0);
  }
})();
