/**
 * tools-vector-pro.js — أدوات المتّجهات الاحترافية (نمط Illustrator / CorelDraw)
 *
 *  تفاعلية (setTool):
 *    arc        ← قوس تفاعلي بثلاث نقرات (يستبدل قوس 270° الثابت القديم)
 *    bezier     ← قلم بيزير بمقابض تحكّم حقيقية (سحب لكل عُقدة)
 *    scissors   ← مقص: قص المسار عند أقرب نقطة إلى النقر
 *    mirror-line← انعكاس التحديد حول خط ترسمه بحرية
 *    eyedropper ← قطّارة: نسخ خصائص القطع من شكل إلى آخر
 *    ruler      ← مسطرة: قياس مسافة/زاوية لحظي (لا يُنشئ شكلاً)
 *
 *  عمليات على التحديد (قوائم + حوار):
 *    offsetPath · outlineStroke · blendShapes · chamferCorners · filletAllCorners · polarArray
 *
 * يُحمَّل بعد كل ملفات tools-*.js (يلفّ أحدث نسخة من معالجات الفأرة والعرض)
 * وقبل menu-bar.js. يعتمد على _toPath و _selIndices و _rotateShape الموجودة.
 */
(function vectorPro() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  /* ═══════════════ مساعدات هندسية ═══════════════ */
  const V = {
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
    mul: (a, s) => ({ x: a.x * s, y: a.y * s }),
    len: (a) => Math.hypot(a.x, a.y),
    norm: (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; },
    dot: (a, b) => a.x * b.x + a.y * b.y,
  };

  function signedArea(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  // نقاط أي شكل (يعيد {points, closed}) عبر _toPath الموجودة
  function shapePoints(ed, s) {
    if (!s) return null;
    if (Array.isArray(s.points) && s.points.length >= 2) {
      return { points: s.points.map(p => ({ x: p.x, y: p.y })), closed: !!s.closed || s.type === 'polygon' };
    }
    const np = ed._toPath(s);
    return np ? { points: np.points, closed: !!np.closed } : null;
  }

  // إعادة تشكيل مسار إلى N نقطة متساوية (للمزج)
  function resample(pts, N, closed) {
    const src = closed ? [...pts, pts[0]] : pts;
    const seg = [];
    let total = 0;
    for (let i = 1; i < src.length; i++) { const d = V.len(V.sub(src[i], src[i - 1])); seg.push(d); total += d; }
    if (total < 1e-6) return Array.from({ length: N }, () => ({ ...pts[0] }));
    const out = [], step = total / (closed ? N : (N - 1));
    let si = 0, acc = 0, dist = 0;
    for (let k = 0; k < N; k++) {
      const target = k * step;
      while (si < seg.length - 1 && acc + seg[si] < target) { acc += seg[si]; si++; }
      const t = seg[si] > 1e-9 ? (target - acc) / seg[si] : 0;
      const a = src[si], b = src[si + 1] || src[si];
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
  }

  // دائرة تمرّ بثلاث نقاط → شكل arc باتجاه صحيح
  function arcFrom3(p1, p2, p3) {
    const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
    if (Math.abs(d) < 1e-9) return null;
    const s1 = p1.x ** 2 + p1.y ** 2, s2 = p2.x ** 2 + p2.y ** 2, s3 = p3.x ** 2 + p3.y ** 2;
    const cx = (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d;
    const cy = (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d;
    const r = Math.hypot(p1.x - cx, p1.y - cy);
    const a1 = Math.atan2(p1.y - cy, p1.x - cx);
    const am = Math.atan2(p2.y - cy, p2.x - cx);
    const a3 = Math.atan2(p3.y - cy, p3.x - cx);
    const norm = (a, s) => (a - s + 4 * Math.PI) % (2 * Math.PI);
    const clockwise = !(norm(am, a1) <= norm(a3, a1));  // هل يمرّ القوس CCW بالنقطة الوسطى؟
    return { type: 'arc', cx, cy, r, startAngle: a1, endAngle: a3, clockwise };
  }

  /* ═══════════════ حوار رقمي قابل لإعادة الاستخدام ═══════════════ */
  function vpPrompt(title, fields) {
    return new Promise((resolve) => {
      let dlg = document.getElementById('dq-vp-dialog');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'dq-vp-dialog';
        dlg.className = 'ext-embed';
        dlg.style.cssText = 'border:1px solid #30363d;border-radius:12px;background:#0d1117;color:#e6edf3;padding:0;min-width:280px;';
        document.body.appendChild(dlg);
      }
      const rows = fields.map(f => `
        <label style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0;font-size:13px">
          <span>${f.label}</span>
          <input type="number" id="vp-f-${f.key}" value="${f.def}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 'any'}"
            style="width:100px;padding:6px 8px;border:1px solid #30363d;border-radius:6px;background:#161b22;color:#e6edf3;text-align:center">
        </label>`).join('');
      dlg.innerHTML = `
        <div style="padding:18px 20px">
          <h3 style="margin:0 0 12px;font-size:15px;color:#58a6ff">${title}</h3>
          ${rows}
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button type="button" id="vp-cancel" style="padding:7px 16px;border:1px solid #30363d;border-radius:6px;background:#21262d;color:#e6edf3;cursor:pointer">إلغاء</button>
            <button type="button" id="vp-ok" style="padding:7px 16px;border:0;border-radius:6px;background:#238636;color:#fff;cursor:pointer;font-weight:600">تطبيق</button>
          </div>
        </div>`;
      // نحسم عبر نقر الأزرار مباشرةً — لا نعتمد على حدث close (قد لا يُطلق في بعض البيئات)
      let settled = false;
      const finish = (val) => {
        if (settled) return; settled = true;
        try { if (dlg.open) dlg.close(); } catch (_) {}
        resolve(val);
      };
      const commit = () => {
        const out = {};
        for (const f of fields) out[f.key] = parseFloat(document.getElementById(`vp-f-${f.key}`).value);
        finish(out);
      };
      dlg.querySelector('#vp-ok').addEventListener('click', commit);
      dlg.querySelector('#vp-cancel').addEventListener('click', () => finish(null));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });  // مفتاح Esc
      fields.forEach(f => document.getElementById(`vp-f-${f.key}`).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
      }));
      try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }
      setTimeout(() => document.getElementById(`vp-f-${fields[0].key}`)?.select(), 30);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     1) إزاحة الكفاف — Offset Path
     ═══════════════════════════════════════════════════════════════ */
  function offsetClosed(pts, dist) {
    const n = pts.length;
    const sign = signedArea(pts) >= 0 ? 1 : -1;  // CCW موجب
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
      const e1 = V.norm(V.sub(cur, prev)), e2 = V.norm(V.sub(next, cur));
      // الأعمدة الخارجة (لمضلع CCW): دوّر الحافة −90°
      const nrm1 = { x: e1.y * sign, y: -e1.x * sign };
      const nrm2 = { x: e2.y * sign, y: -e2.x * sign };
      let bis = V.add(nrm1, nrm2);
      const bl = V.len(bis);
      if (bl < 1e-6) { out.push({ x: cur.x + nrm1.x * dist, y: cur.y + nrm1.y * dist }); continue; }
      bis = V.mul(bis, 1 / bl);
      const cosHalf = Math.max(0.25, V.dot(bis, nrm1));   // مثبّت لتفادي القمم الحادة
      const L = dist / cosHalf;
      out.push({ x: cur.x + bis.x * L, y: cur.y + bis.y * L });
    }
    return out;
  }

  P.offsetPath = async function () {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدّد شكلاً مغلقاً أولاً', 'warn');
    const res = await vpPrompt('إزاحة الكفاف (Offset)', [
      { key: 'd', label: 'المسافة (مم) — موجب = للخارج', def: 3, step: 0.5 },
    ]);
    if (!res || !isFinite(res.d) || res.d === 0) return;
    this._saveHistory();
    let done = 0;
    for (const i of idx) {
      const sp = shapePoints(this, this.shapes[i]);
      if (!sp || !sp.closed || sp.points.length < 3) continue;
      this.shapes[i] = { type: 'polyline', points: offsetClosed(sp.points, res.d), closed: true };
      done++;
    }
    this.render(); this._updateStatus?.();
    toast(done ? `✓ أُزيح ${done} كفاف بمقدار ${res.d}mm` : 'لا أشكال مغلقة صالحة للإزاحة', done ? 'success' : 'warn');
  };

  /* ═══════════════════════════════════════════════════════════════
     2) تفريغ الخط — Outline Stroke (خط مفتوح → شريط مغلق)
     ═══════════════════════════════════════════════════════════════ */
  P.outlineStroke = async function () {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدّد خطاً/مساراً مفتوحاً أولاً', 'warn');
    const res = await vpPrompt('تفريغ الخط (Outline)', [
      { key: 'w', label: 'العرض (مم)', def: 2, min: 0.1, step: 0.2 },
    ]);
    if (!res || !(res.w > 0)) return;
    const hw = res.w / 2;
    this._saveHistory();
    let done = 0;
    for (const i of idx) {
      const sp = shapePoints(this, this.shapes[i]);
      if (!sp || sp.points.length < 2) continue;
      const pts = sp.points;
      // عمود كل عُقدة = متوسط أعمدة الحافتين المجاورتين
      const normals = pts.map((p, k) => {
        const a = pts[k - 1] || p, b = pts[k + 1] || p;
        const e = V.norm(V.sub(b, a));
        return { x: -e.y, y: e.x };
      });
      const left = pts.map((p, k) => ({ x: p.x + normals[k].x * hw, y: p.y + normals[k].y * hw }));
      const right = pts.map((p, k) => ({ x: p.x - normals[k].x * hw, y: p.y - normals[k].y * hw })).reverse();
      this.shapes[i] = { type: 'polyline', points: [...left, ...right], closed: true };
      done++;
    }
    this.render(); this._updateStatus?.();
    toast(done ? `✓ فُرّغ ${done} خط بعرض ${res.w}mm` : 'تعذّر', done ? 'success' : 'warn');
  };

  /* ═══════════════════════════════════════════════════════════════
     3) المزج — Blend بين شكلين
     ═══════════════════════════════════════════════════════════════ */
  P.blendShapes = async function () {
    const idx = this._selIndices();
    if (idx.length !== 2) return toast('حدّد شكلين بالضبط للمزج', 'warn');
    const a = shapePoints(this, this.shapes[idx[0]]), b = shapePoints(this, this.shapes[idx[1]]);
    if (!a || !b) return toast('تعذّر قراءة الشكلين', 'warn');
    const res = await vpPrompt('المزج (Blend)', [
      { key: 'n', label: 'عدد الأشكال الوسيطة', def: 5, min: 1, max: 60, step: 1 },
    ]);
    if (!res || !(res.n >= 1)) return;
    const N = 96, closed = a.closed && b.closed;
    const pa = resample(a.points, N, a.closed), pb = resample(b.points, N, b.closed);
    this._saveHistory();
    const steps = Math.round(res.n);
    const mids = [];
    for (let k = 1; k <= steps; k++) {
      const t = k / (steps + 1);
      mids.push({ type: 'polyline', closed, points: pa.map((p, i) => ({ x: p.x + (pb[i].x - p.x) * t, y: p.y + (pb[i].y - p.y) * t })) });
    }
    // أدرج الوسائط بين الشكلين الأصليين
    this.shapes.push(...mids);
    this.render(); this._updateStatus?.();
    toast(`✓ مُزج بـ ${steps} شكلاً وسيطاً`, 'success');
  };

  /* ═══════════════════════════════════════════════════════════════
     4) شطب الزوايا — Chamfer (قطع مستقيم لكل زاوية)
     ═══════════════════════════════════════════════════════════════ */
  function cornerOp(pts, dist, round) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const A = pts[(i - 1 + n) % n], B = pts[i], C = pts[(i + 1) % n];
      const u1 = V.norm(V.sub(A, B)), u2 = V.norm(V.sub(C, B));
      const l1 = V.len(V.sub(A, B)), l2 = V.len(V.sub(C, B));
      const trim = Math.min(dist, l1 / 2.05, l2 / 2.05);
      if (!(trim > 0.02)) { out.push({ ...B }); continue; }
      const T1 = { x: B.x + u1.x * trim, y: B.y + u1.y * trim };
      const T2 = { x: B.x + u2.x * trim, y: B.y + u2.y * trim };
      if (!round) { out.push(T1, T2); continue; }
      const st = 6;                                   // قوس رباعي ضابطه رأس الزاوية
      for (let k = 0; k <= st; k++) {
        const t = k / st;
        out.push({
          x: (1 - t) ** 2 * T1.x + 2 * (1 - t) * t * B.x + t * t * T2.x,
          y: (1 - t) ** 2 * T1.y + 2 * (1 - t) * t * B.y + t * t * T2.y,
        });
      }
    }
    return out;
  }

  async function applyCorner(ed, round) {
    const idx = ed._selIndices();
    if (!idx.length) return toast('حدّد شكلاً مغلقاً أولاً', 'warn');
    const res = await vpPrompt(round ? 'تدوير كل الزوايا (Fillet)' : 'شطب كل الزوايا (Chamfer)', [
      { key: 'd', label: round ? 'نصف القطر (مم)' : 'مقدار القطع (مم)', def: 5, min: 0.2, step: 0.5 },
    ]);
    if (!res || !(res.d > 0)) return;
    ed._saveHistory();
    let done = 0;
    for (const i of idx) {
      const sp = shapePoints(ed, ed.shapes[i]);
      if (!sp || !sp.closed || sp.points.length < 3) continue;
      ed.shapes[i] = { type: 'polyline', points: cornerOp(sp.points, res.d, round), closed: true };
      done++;
    }
    ed.render(); ed._updateStatus?.();
    toast(done ? `✓ عولجت زوايا ${done} شكل` : 'المطلوب أشكال مغلقة', done ? 'success' : 'warn');
  }
  P.chamferCorners  = function () { return applyCorner(this, false); };
  P.filletAllCorners = function () { return applyCorner(this, true); };

  /* ═══════════════════════════════════════════════════════════════
     5) المصفوفة القطبية — Polar Array
     ═══════════════════════════════════════════════════════════════ */
  P.polarArray = async function () {
    if (this.selectedIdx < 0) return toast('حدّد شكلاً واحداً أولاً', 'warn');
    const b = this._bounds(this.shapes[this.selectedIdx]);
    const res = await vpPrompt('مصفوفة قطبية (Polar Array)', [
      { key: 'n', label: 'عدد النسخ (شامل الأصل)', def: 6, min: 2, max: 200, step: 1 },
      { key: 'cx', label: 'مركز X (مم)', def: +(( b.minX + b.maxX) / 2).toFixed(1), step: 1 },
      { key: 'cy', label: 'مركز Y (مم)', def: +(( b.minY + b.maxY) / 2 - (b.maxY - b.minY)).toFixed(1), step: 1 },
    ]);
    if (!res || !(res.n >= 2)) return;
    const count = Math.round(res.n), src = this.shapes[this.selectedIdx];
    this._saveHistory();
    for (let k = 1; k < count; k++) {
      const clone = JSON.parse(JSON.stringify(src));
      this._rotateShape(clone, (2 * Math.PI * k) / count, res.cx, res.cy);
      this.shapes.push(clone);
    }
    this.render(); this._updateStatus?.();
    toast(`✓ مصفوفة قطبية: ${count} نسخة`, 'success');
  };

  /* ═══════════════════════════════════════════════════════════════
     أدوات تفاعلية — تُلَفّ حول أحدث معالجات الفأرة
     ═══════════════════════════════════════════════════════════════ */
  const OWN = new Set(['arc', 'bezier', 'scissors', 'mirror-line', 'eyedropper', 'ruler']);

  const origSetTool = P.setTool;
  P.setTool = function (t) {
    // نظّف حالة أدواتنا عند التبديل
    this._arcC = null; this._pen = null; this._penDrag = null;
    this._mirrorA = null; this._eyeSrc = null; this._rulerA = null; this._rulerB = null;
    origSetTool.call(this, t);
  };

  const origOnDown = P._onDown;
  P._onDown = function (e) {
    const t = this.tool;
    if (!OWN.has(t)) return origOnDown.call(this, e);
    const pt = this._evPt(e);

    /* ── قوس تفاعلي بثلاث نقرات ── */
    if (t === 'arc') {
      if (e.button === 2) { this._arcC = null; this.render(); return; }
      if (!this._arcC) this._arcC = [];
      this._arcC.push(pt);
      if (this._arcC.length === 3) {
        const arc = arcFrom3(this._arcC[0], this._arcC[1], this._arcC[2]);
        this._arcC = null;
        if (arc) { this._saveHistory(); this.shapes.push(arc); this._updateStatus?.(); }
        else toast('النقاط على استقامة واحدة — لا قوس', 'warn');
      }
      this.render(); return;
    }

    /* ── قلم بيزير بمقابض ── */
    if (t === 'bezier') {
      if (e.button === 2) { this._finishPen(); return; }
      if (!this._pen) this._pen = [];
      // ابدأ عُقدة جديدة؛ السحب يحدّد المقبض الخارج
      this._pen.push({ x: pt.x, y: pt.y, ho: { x: 0, y: 0 } });
      this._penDrag = this._pen[this._pen.length - 1];
      this.render(); return;
    }

    /* ── المقص: قص المسار عند أقرب نقطة ── */
    if (t === 'scissors') {
      this._scissorsAt(pt); return;
    }

    /* ── الانعكاس حول خط: ابدأ الخط ── */
    if (t === 'mirror-line') {
      this._mirrorA = pt; this.previewPt = pt; this.isDrawing = true; return;
    }

    /* ── القطّارة: المصدر ثم الأهداف ── */
    if (t === 'eyedropper') {
      const hit = this._hitTest(pt);
      if (hit < 0) { toast('انقر على شكل', 'info'); return; }
      if (!this._eyeSrc) {
        this._eyeSrc = this._styleOf(this.shapes[hit]);
        toast('◉ نُسخت الخصائص — انقر الأشكال الهدف', 'info');
      } else {
        this._saveHistory();
        Object.assign(this.shapes[hit], this._eyeSrc);
        this.render();
        toast('✓ طُبّقت الخصائص', 'success');
      }
      return;
    }

    /* ── المسطرة: ابدأ القياس ── */
    if (t === 'ruler') {
      this._rulerA = pt; this._rulerB = pt; this.isDrawing = true; this.render(); return;
    }
  };

  const origOnMove = P._onMove;
  P._onMove = function (e) {
    const t = this.tool;
    if (!OWN.has(t)) return origOnMove.call(this, e);
    const r = this.canvas.getBoundingClientRect();
    const pt = this._snap(this._sToW(e.clientX - r.left, e.clientY - r.top));
    // حدّث قراءة الإحداثيات
    const ex = document.getElementById('cur-x'), ey = document.getElementById('cur-y');
    if (ex) ex.textContent = pt.x.toFixed(3); if (ey) ey.textContent = pt.y.toFixed(3);
    this.previewPt = pt;

    if (t === 'bezier' && this._penDrag && e.buttons === 1) {
      this._penDrag.ho = { x: pt.x - this._penDrag.x, y: pt.y - this._penDrag.y };
      this.render(); return;
    }
    if (t === 'mirror-line' && this._mirrorA && e.buttons === 1) { this.render(); return; }
    if (t === 'ruler' && this._rulerA && e.buttons === 1) { this._rulerB = pt; this.render(); return; }
    if (t === 'arc' && this._arcC) { this.render(); return; }
    this.render();
  };

  const origOnUp = P._onUp;
  P._onUp = function (e) {
    const t = this.tool;
    if (!OWN.has(t)) return origOnUp.call(this, e);
    if (t === 'bezier') { this._penDrag = null; return; }
    if (t === 'ruler')  { this.isDrawing = false; return; }  // أبقِ القراءة ظاهرة
    if (t === 'mirror-line' && this._mirrorA) {
      const b = this._evPt(e);
      if (V.len(V.sub(b, this._mirrorA)) > 0.5) this._reflectSelection(this._mirrorA, b);
      this._mirrorA = null; this.isDrawing = false; this.previewPt = null; this.render();
      return;
    }
  };

  const origOnDbl = P._onDbl;
  P._onDbl = function (e) {
    if (this.tool === 'bezier' && this._pen && this._pen.length >= 2) { this._finishPen(); return; }
    origOnDbl.call(this, e);
  };

  /* ── إنهاء قلم البيزير: عيّنات مكعّبة بين العُقَد ── */
  P._finishPen = function () {
    const nodes = this._pen || [];
    if (nodes.length < 2) { this._pen = null; this._penDrag = null; this.render(); return; }
    const out = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      const c1 = { x: a.x + a.ho.x, y: a.y + a.ho.y };
      const c2 = { x: b.x - b.ho.x, y: b.y - b.ho.y };   // مقبض داخل b = عكس الخارج
      const seg = Math.max(8, Math.round(V.len(V.sub(b, a)) / 2));
      for (let k = (i === 0 ? 0 : 1); k <= seg; k++) {
        const u = k / seg, m = 1 - u;
        out.push({
          x: m ** 3 * a.x + 3 * m * m * u * c1.x + 3 * m * u * u * c2.x + u ** 3 * b.x,
          y: m ** 3 * a.y + 3 * m * m * u * c1.y + 3 * m * u * u * c2.y + u ** 3 * b.y,
        });
      }
    }
    this._saveHistory();
    this.shapes.push({ type: 'polyline', points: out, closed: false });
    this._pen = null; this._penDrag = null; this.isDrawing = false;
    this.render(); this._updateStatus?.();
  };

  /* ── المقص ── */
  P._scissorsAt = function (pt) {
    const i = this._hitTest(pt);
    if (i < 0) return toast('انقر على مسار لقصّه', 'info');
    const sp = shapePoints(this, this.shapes[i]);
    if (!sp || sp.points.length < 3) return toast('لا يمكن قص هذا الشكل', 'warn');
    const pts = sp.closed ? [...sp.points, sp.points[0]] : sp.points;
    // أقرب نقطة على المسار
    let bi = 0, bt = 0, bd = Infinity;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1], ab = V.sub(b, a), L = V.dot(ab, ab) || 1;
      let u = Math.max(0, Math.min(1, V.dot(V.sub(pt, a), ab) / L));
      const proj = { x: a.x + ab.x * u, y: a.y + ab.y * u }, d = V.len(V.sub(pt, proj));
      if (d < bd) { bd = d; bi = k; bt = u; }
    }
    const cut = { x: pts[bi].x + (pts[bi + 1].x - pts[bi].x) * bt, y: pts[bi].y + (pts[bi + 1].y - pts[bi].y) * bt };
    this._saveHistory();
    let part1, part2;
    if (sp.closed) {
      // افتح المسار المغلق عند نقطة القص → مسار واحد مفتوح يبدأ وينتهي عندها
      const rolled = [cut, ...pts.slice(bi + 1, pts.length - 1), ...pts.slice(0, bi + 1), cut];
      this.shapes.splice(i, 1, { type: 'polyline', points: rolled, closed: false });
      this.render(); this._updateStatus?.();
      return toast('✂ فُتح المسار المغلق عند نقطة القص', 'success');
    } else {
      part1 = { type: 'polyline', points: [...pts.slice(0, bi + 1), cut], closed: false };
      part2 = { type: 'polyline', points: [cut, ...pts.slice(bi + 1)], closed: false };
      this.shapes.splice(i, 1, part1, part2);
    }
    this.render(); this._updateStatus?.();
    toast('✂ قُصّ المسار إلى جزأين', 'success');
  };

  /* ── القطّارة: خصائص القطع القابلة للنسخ ── */
  P._styleOf = function (s) {
    const keys = ['layer', 'color', 'feed', 'plunge', 'depth', 'toolDiameter', 'cutSide',
                  'passes', 'disabled', 'tabsEnabled', 'lineType', 'power', 'speed'];
    const o = {};
    for (const k of keys) if (s[k] !== undefined) o[k] = s[k];
    return o;
  };

  /* ── الانعكاس حول خط عبر نقطتين ── */
  function reflectPt(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L;
    const foot = { x: a.x + dx * t, y: a.y + dy * t };
    return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
  }
  P._reflectSelection = function (a, b) {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدّد أشكالاً أولاً ثم ارسم محور الانعكاس', 'warn');
    this._saveHistory();
    for (const i of idx) {
      const sp = shapePoints(this, this.shapes[i]);
      if (!sp) continue;
      this.shapes.push({ type: 'polyline', points: sp.points.map(p => reflectPt(p, a, b)), closed: sp.closed });
    }
    this.render(); this._updateStatus?.();
    toast(`✓ انعكست ${idx.length} نسخة حول المحور`, 'success');
  };

  /* ═══════════════ عرض إضافي فوق اللوحة ═══════════════ */
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    const ctx = this.ctx; if (!ctx) return;

    // قوس قيد الإنشاء
    if (this.tool === 'arc' && this._arcC && this._arcC.length) {
      ctx.save(); ctx.strokeStyle = '#3fb950'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
      const pts = [...this._arcC]; if (this.previewPt) pts.push(this.previewPt);
      if (pts.length >= 3) {
        const arc = arcFrom3(pts[0], pts[1], pts[2]);
        if (arc) { const c = this._wToS(arc.cx, arc.cy); ctx.beginPath(); ctx.arc(c.x, c.y, arc.r * this.scale, -arc.startAngle, -arc.endAngle, arc.clockwise); ctx.stroke(); }
      } else if (pts.length === 2) {
        const p0 = this._wToS(pts[0].x, pts[0].y), p1 = this._wToS(pts[1].x, pts[1].y);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      this._arcC.forEach(p => { const sp = this._wToS(p.x, p.y); ctx.fillStyle = '#3fb950'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, 7); ctx.fill(); });
      ctx.restore();
    }

    // قلم البيزير: المسار + المقابض
    if (this.tool === 'bezier' && this._pen && this._pen.length) {
      ctx.save();
      const nodes = this._pen;
      ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i], b = nodes[i + 1];
        const A = this._wToS(a.x, a.y), C1 = this._wToS(a.x + a.ho.x, a.y + a.ho.y);
        const C2 = this._wToS(b.x - b.ho.x, b.y - b.ho.y), B = this._wToS(b.x, b.y);
        ctx.moveTo(A.x, A.y); ctx.bezierCurveTo(C1.x, C1.y, C2.x, C2.y, B.x, B.y);
      }
      // امتداد حيّ نحو المؤشر
      if (this.previewPt && !this._penDrag) {
        const a = nodes[nodes.length - 1], A = this._wToS(a.x, a.y), Pv = this._wToS(this.previewPt.x, this.previewPt.y);
        ctx.moveTo(A.x, A.y); ctx.lineTo(Pv.x, Pv.y);
      }
      ctx.stroke();
      nodes.forEach(n => {
        const N = this._wToS(n.x, n.y);
        ctx.fillStyle = '#0d1117'; ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(N.x - 4, N.y - 4, 8, 8); ctx.fill(); ctx.stroke();
        if (n.ho.x || n.ho.y) {
          const H = this._wToS(n.x + n.ho.x, n.y + n.ho.y), H2 = this._wToS(n.x - n.ho.x, n.y - n.ho.y);
          ctx.strokeStyle = 'rgba(88,166,255,0.6)'; ctx.beginPath(); ctx.moveTo(H2.x, H2.y); ctx.lineTo(H.x, H.y); ctx.stroke();
          ctx.fillStyle = '#58a6ff'; [H, H2].forEach(h => { ctx.beginPath(); ctx.arc(h.x, h.y, 3, 0, 7); ctx.fill(); });
        }
      });
      ctx.restore();
    }

    // محور الانعكاس
    if (this.tool === 'mirror-line' && this._mirrorA && this.previewPt) {
      const a = this._wToS(this._mirrorA.x, this._mirrorA.y), b = this._wToS(this.previewPt.x, this.previewPt.y);
      ctx.save(); ctx.strokeStyle = '#d29922'; ctx.setLineDash([7, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }

    // المسطرة: خط + قراءة مسافة/زاوية
    if (this.tool === 'ruler' && this._rulerA && this._rulerB) {
      const a = this._wToS(this._rulerA.x, this._rulerA.y), b = this._wToS(this._rulerB.x, this._rulerB.y);
      const dx = this._rulerB.x - this._rulerA.x, dy = this._rulerB.y - this._rulerA.y;
      const dist = Math.hypot(dx, dy), ang = (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1);
      ctx.save(); ctx.strokeStyle = '#f778ba'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      [a, b].forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fillStyle = '#f778ba'; ctx.fill(); });
      const label = `${dist.toFixed(2)} مم  ∠${ang}°`;
      ctx.font = '12px monospace'; const w = ctx.measureText(label).width;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.fillStyle = 'rgba(13,17,23,0.9)'; ctx.fillRect(mx - w / 2 - 6, my - 22, w + 12, 18);
      ctx.fillStyle = '#f778ba'; ctx.textAlign = 'center'; ctx.fillText(label, mx, my - 9); ctx.textAlign = 'start';
      ctx.restore();
    }
  };

  console.log('[vector-pro] أدوات المتّجهات الاحترافية جاهزة');
})();
