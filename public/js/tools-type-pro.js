/**
 * tools-type-pro.js — أدوات النصّ الستّ من إليستريتور + إصلاح هندسة النصّ المنقوش
 *
 *   type-path          نص على مسار        — يتبع حرفاً حرفاً مع دوران المماس
 *   vertical-type      نص عمودي           — أحرف مكدّسة رأسياً حيث تنقر
 *   vertical-type-path نص عمودي على مسار  — الحرف قائم والسطر يتبع المسار
 *   area-type          نص في منطقة        — يتدفّق داخل شكل مغلق
 *   vertical-area      نص عمودي في منطقة  — أعمدة من اليمين لليسار داخل شكل
 *   touch-type         نوع اللمس          — انقل/كبّر/دوّر حرفاً واحداً في كلمة
 *
 * `typeOnPath` و`verticalType` موجودتان أصلاً في `tools-illustrator.js` بوصفهما
 * **أمرين** يبدآن بحوار. هنا تصير أدواتٍ: تختار الأداة ثم تنقر على المسار أو
 * الموضع، فالسياق يأتي من النقرة لا من التحديد المسبق — وهذا سلوك إليستريتور.
 *
 * لماذا حرفٌ لكل شكل: `typeOnPath` تخبز النصّ كلّه في شكل `text` واحد، فلا
 * سبيل بعدها لتحريك حرف بمفرده — وهذا بالضبط ما تفعله أداة Touch Type. هنا
 * كل حرف شكلٌ مستقلّ بمساراته المنقوشة، فيقبل التحريك والتكبير والتدوير.
 *
 * ═══ إصلاح جانبي ضروري ═══
 * النصّ المنقوش يُخزَّن `{type:'text', x:0, y:0, width:0, strokes:[…]}` وإحداثيات
 * `strokes` عالمية مطلقة. لكن `tools-pro.js` يحسب هندسة النصّ من `x/y/width`
 * وحدها، فينتج عن ذلك ثلاثة أعطال حقيقية: النصّ المنقوش **لا يُنقر عليه** في
 * موضعه (صندوقه عند الأصل)، و**لا يتحرّك** (تُزاح x/y ولا تُزاح المسارات)،
 * و**حدوده خاطئة** فتفسد الملاءمة والمحاذاة والتحديد المستطيلي. الإصلاح هنا:
 * حين توجد `strokes` تُحسب الهندسة منها.
 */
(function toolsTypePro() {
  'use strict';

  const toast = (m, t) => window.app?.toast?.(m, t);

  /* ══════ هندسة المسار ══════ */
  function pathPoints(s) {
    const PM = window.DQ && window.DQ.PathModel;
    if (s.points && s.points.length > 1) return s.points.map(p => ({ x: p.x, y: p.y }));
    if (s.type === 'line') return [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
    if (PM) {
      try {
        const p = PM.isPath(s) ? s : PM.fromShape(s);
        if (p) {
          const f = PM.flatten(p, 0.05);
          if (f?.points?.length > 1) {
            const pts = f.points.map(q => ({ x: q.x, y: q.y }));
            if (p.closed) pts.push({ ...pts[0] });
            return pts;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  const pathLen = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; };

  function pointAt(pts, t) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 1e-12) continue;
      if (acc + d >= t) {
        const u = (t - acc) / d;
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, ang: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      acc += d;
    }
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    return { x: b.x, y: b.y, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  function inside(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-12) + a.x) c = !c;
    }
    return c;
  }

  const strokeBounds = st => {
    let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const s of st) for (const p of s) {
      if (p.x < b.minX) b.minX = p.x; if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y; if (p.y > b.maxY) b.maxY = p.y;
    }
    return isFinite(b.minX) ? b : null;
  };

  function boot() {
    const C = (typeof CanvasEditor !== 'undefined') ? CanvasEditor : window.CanvasEditor;
    if (!C || !C.prototype) return;
    const P = C.prototype;
    if (P.__typePro) return;
    P.__typePro = true;

    /* ═══════════ إصلاح هندسة النصّ المنقوش ═══════════ */
    const hasStrokes = s => s && s.type === 'text' && Array.isArray(s.strokes) && s.strokes.length;

    const origNear = P._isNear;
    P._isNear = function (s, pt, tol) {
      if (!hasStrokes(s)) return origNear.call(this, s, pt, tol);
      const t = tol || 4 / this.scale;
      for (const st of s.strokes)
        for (let i = 1; i < st.length; i++)
          if (this._ptLineDist(pt, st[i - 1], st[i]) < t) return true;
      // داخل صندوق الأحرف أيضاً — النقر على «جوف» الحرف يجب أن يمسكه.
      // بلا تسامح هنا: التسامح فوق حدّ الصندوق يجعل الأحرف المتجاورة تتنازع
      // النقرة، فيلتقطها صاحب الفهرس الأعلى لا الحرف الذي تحته المؤشر فعلاً.
      const b = strokeBounds(s.strokes);
      return !!b && pt.x > b.minX && pt.x < b.maxX && pt.y > b.minY && pt.y < b.maxY;
    };

    const origBounds = P._bounds;
    P._bounds = function (s) {
      if (!hasStrokes(s)) return origBounds.call(this, s);
      return strokeBounds(s.strokes) || origBounds.call(this, s);
    };

    const origOffset = P._offsetShape;
    P._offsetShape = function (s, dx, dy) {
      if (!hasStrokes(s)) return origOffset.call(this, s, dx, dy);
      s.x = (s.x || 0) + dx; s.y = (s.y || 0) + dy;
      for (const st of s.strokes) for (const p of st) { p.x += dx; p.y += dy; }
    };

    const origOrigin = P._shapeOrigin;
    P._shapeOrigin = function (s) {
      if (!hasStrokes(s)) return origOrigin.call(this, s);
      const b = strokeBounds(s.strokes);
      return b ? { x: b.minX, y: b.minY } : { x: s.x || 0, y: s.y || 0 };
    };

    /* ═══════════ توليد أحرف منقوشة ═══════════ */
    const ilPrompt = (...a) => (window.DQPrompt ? window.DQPrompt(...a) : Promise.resolve(null));

    // حرف واحد → شكل نصّ مستقلّ بمساراته في مكانها
    function charShape(ed, ch, h, place, meta) {
      const g = ed._textToStrokes(ch, h);
      if (!g.strokes.length) return null;
      const w = g.width || h * 0.6;
      const baked = g.strokes.map(st => st.map(p => place(p, w)));
      return Object.assign({ type: 'text', text: ch, height: h, x: 0, y: 0, width: w, strokes: baked, layer: 'default' }, meta || {});
    }

    function ensureEngine(ed) {
      if (ed._textToStrokes) return true;
      toast('محرك النقش غير محمّل', 'error');
      return false;
    }

    /* ═══ نص على مسار (أفقي أو عمودي) ═══ */
    P.placeTypeOnPath = async function (idx, vertical) {
      if (!ensureEngine(this)) return;
      const base = this.shapes[idx];
      const raw = base && pathPoints(base);
      if (!raw || raw.length < 2) { toast('انقر على مسار (خط/منحنى/مضلّع)', 'warn'); return; }

      const res = await ilPrompt(vertical ? 'نص عمودي على مسار' : 'نص على مسار', [
        { key: 'text',   label: 'النص (لاتيني/أرقام)', type: 'text', def: 'DIQQAT' },
        { key: 'height', label: 'ارتفاع الحرف (mm)', def: 8, min: 1 },
        { key: 'offset', label: 'إزاحة البداية (mm)', def: 2, min: 0 },
        { key: 'gap',    label: 'تباعد إضافي (mm)', def: 1, min: 0 },
        { key: 'side',   label: 'الجهة', type: 'select', def: 'above', options: [
          { v: 'above', t: 'فوق المسار' }, { v: 'on', t: 'على المسار' }, { v: 'below', t: 'تحت المسار' }] },
      ]);
      if (!res || !String(res.text).trim()) return;

      const total = pathLen(raw), h = Math.max(1, res.height);
      const lift = res.side === 'above' ? h * 0.15 : res.side === 'below' ? -(h * 1.15) : -h / 2;
      const made = [];
      let cursor = Math.max(0, res.offset);

      for (const ch of String(res.text)) {
        if (ch === ' ') { cursor += h * 0.55; continue; }
        const g = this._textToStrokes(ch, h);
        const w = g.width || h * 0.6;
        if (!g.strokes.length) { cursor += w + res.gap; continue; }
        if (cursor + w > total) { toast(`المسار أقصر من النصّ — وُضع ${made.length} حرفاً`, 'warn'); break; }
        const at = pointAt(raw, cursor + w / 2);
        // العمودي يضيف ربع لفّة فيقف الحرف على المسار بدل أن يستلقي عليه
        const ang = at.ang + (vertical ? Math.PI / 2 : 0);
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const s = charShape(this, ch, h, (p, ww) => {
          const lx = p.x - ww / 2, ly = p.y + lift;
          return { x: at.x + lx * cos - ly * sin, y: at.y + lx * sin + ly * cos };
        }, { name: vertical ? 'حرف عمودي على مسار' : 'حرف على مسار' });
        if (s) made.push(s);
        cursor += w + res.gap;
      }
      if (!made.length) { toast('لا أحرف قابلة للنقش — المدعوم: لاتينية وأرقام', 'warn'); return; }

      this._saveHistory();
      const from = this.shapes.length;
      this.shapes.push(...made);
      this.msel = new Set(made.map((_, i) => from + i));
      this.selectedIdx = this.shapes.length - 1;
      this._sceneVersion = (this._sceneVersion | 0) + 1;
      this.render(); this._updateStatus?.(); this._updateShapeToolbar?.();
      toast(`✓ ${made.length} حرفاً على المسار`, 'success');
    };

    /* ═══ نص عمودي عند نقطة ═══ */
    P.placeVerticalTypeAt = async function (pt) {
      if (!ensureEngine(this)) return;
      const res = await ilPrompt('نص عمودي', [
        { key: 'text',   label: 'النص (لاتيني/أرقام)', type: 'text', def: 'CNC' },
        { key: 'height', label: 'ارتفاع الحرف (mm)', def: 10, min: 1 },
        { key: 'gap',    label: 'فجوة بين الأحرف (mm)', def: 3, min: 0 },
      ]);
      if (!res || !String(res.text).trim()) return;
      const h = Math.max(1, res.height);
      const made = [];
      let y = pt.y;
      for (const ch of String(res.text)) {
        if (ch === ' ') { y -= h * 0.7; continue; }
        const s = charShape(this, ch, h, (p, w) => ({ x: pt.x + p.x - w / 2, y: y + p.y }), { name: 'حرف عمودي' });
        if (s) made.push(s);
        y -= h + res.gap;
      }
      if (!made.length) { toast('لا أحرف قابلة للنقش', 'warn'); return; }
      this._saveHistory();
      const from = this.shapes.length;
      this.shapes.push(...made);
      this.msel = new Set(made.map((_, i) => from + i));
      this.selectedIdx = this.shapes.length - 1;
      this._sceneVersion = (this._sceneVersion | 0) + 1;
      this.render(); this._updateStatus?.(); this._updateShapeToolbar?.();
      toast(`✓ نص عمودي: ${made.length} حرفاً`, 'success');
    };

    /* ═══ نص في منطقة — أفقي أو عمودي ═══ */
    P.placeAreaType = async function (idx, vertical) {
      if (!ensureEngine(this)) return;
      const host = this.shapes[idx];
      const poly = host && pathPoints(host);
      if (!poly || poly.length < 3) { toast('انقر داخل شكل مغلق (مستطيل/دائرة/مضلّع)', 'warn'); return; }

      const res = await ilPrompt(vertical ? 'نص عمودي في منطقة' : 'نص في منطقة', [
        { key: 'text',   label: 'النص (لاتيني/أرقام)', type: 'text', def: 'DIQQAT QALAM' },
        { key: 'height', label: 'ارتفاع الحرف (mm)', def: 6, min: 1 },
        { key: 'gap',    label: 'تباعد إضافي (mm)', def: 1, min: 0 },
        { key: 'lead',   label: 'تباعد الأسطر (mm)', def: 2, min: 0 },
      ]);
      if (!res || !String(res.text).trim()) return;

      const h = Math.max(1, res.height), lead = h + res.lead;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }

      const chars = [...String(res.text)];
      const made = [];
      let k = 0;

      // يتحقّق أن الحرف كلّه داخل الشكل لا مركزه فقط — وإلا خرج نصفه للخارج
      const fits = (x, y, w) =>
        inside(poly, x, y) && inside(poly, x + w, y) &&
        inside(poly, x, y + h) && inside(poly, x + w, y + h);

      if (!vertical) {
        for (let y = maxY - lead; y > minY && k < chars.length; y -= lead) {
          for (let x = minX; x < maxX && k < chars.length;) {
            const ch = chars[k];
            const g = this._textToStrokes(ch, h);
            const w = g.width || h * 0.6;
            if (ch === ' ') { x += w + res.gap; k++; continue; }
            if (!fits(x, y, w)) { x += w * 0.5; continue; }
            const X = x, Y = y;
            const s = charShape(this, ch, h, p => ({ x: X + p.x, y: Y + p.y }), { name: 'حرف في منطقة' });
            if (s) made.push(s);
            x += w + res.gap; k++;
          }
        }
      } else {
        for (let x = maxX - lead; x > minX && k < chars.length; x -= lead) {
          for (let y = maxY - lead; y > minY && k < chars.length;) {
            const ch = chars[k];
            const g = this._textToStrokes(ch, h);
            const w = g.width || h * 0.6;
            if (ch === ' ') { y -= lead; k++; continue; }
            if (!fits(x, y, w)) { y -= lead * 0.5; continue; }
            const X = x, Y = y;
            const s = charShape(this, ch, h, p => ({ x: X + p.x, y: Y + p.y }), { name: 'حرف عمودي في منطقة' });
            if (s) made.push(s);
            y -= lead; k++;
          }
        }
      }

      if (!made.length) { toast('لم يتّسع الشكل لأي حرف — كبّر الشكل أو صغّر الخطّ', 'warn'); return; }
      this._saveHistory();
      const from = this.shapes.length;
      this.shapes.push(...made);
      this.msel = new Set(made.map((_, i) => from + i));
      this.selectedIdx = this.shapes.length - 1;
      this._sceneVersion = (this._sceneVersion | 0) + 1;
      this.render(); this._updateStatus?.(); this._updateShapeToolbar?.();
      if (k < chars.length) toast(`المساحة استوعبت ${made.length} حرفاً من ${chars.length}`, 'warn');
      else toast(`✓ ${made.length} حرفاً داخل الشكل`, 'success');
    };

    /* ═══ نوع اللمس ═══ */
    function xformStrokes(s, fn) { for (const st of s.strokes) for (const p of st) { const q = fn(p); p.x = q.x; p.y = q.y; } }

    const touchTool = {
      cursor: 'pointer',
      onDown(pt, e) {
        const i = this._hitTest(pt);
        const s = i >= 0 ? this.shapes[i] : null;
        if (!s || s.type !== 'text' || !s.strokes) {
          this._touch = null;
          toast('انقر على حرف منقوش لتحريكه (Alt = تكبير · Shift = تدوير)', 'warn');
          return true;
        }
        this._saveHistory();
        this.selectedIdx = i; this.msel = new Set([i]);
        const b = strokeBounds(s.strokes);
        this._touch = {
          i, mode: e.shiftKey ? 'rot' : (e.altKey ? 'size' : 'move'),
          start: pt, c: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
          snap: s.strokes.map(st => st.map(p => ({ x: p.x, y: p.y }))),
        };
        this.render();
        return true;
      },
      onMove(pt) {
        const t = this._touch;
        if (!t) return true;
        const s = this.shapes[t.i];
        if (!s || !s.strokes) return true;
        const dx = pt.x - t.start.x, dy = pt.y - t.start.y;
        // نبدأ دوماً من اللقطة الأصلية فلا تتراكم الأخطاء عبر الإطارات
        for (let a = 0; a < s.strokes.length; a++)
          for (let b = 0; b < s.strokes[a].length; b++) {
            const o = t.snap[a][b];
            s.strokes[a][b].x = o.x; s.strokes[a][b].y = o.y;
          }
        if (t.mode === 'move') xformStrokes(s, p => ({ x: p.x + dx, y: p.y + dy }));
        else if (t.mode === 'size') {
          const k = Math.max(0.1, 1 + dy / Math.max(1, s.height));
          xformStrokes(s, p => ({ x: t.c.x + (p.x - t.c.x) * k, y: t.c.y + (p.y - t.c.y) * k }));
          s.height = Math.max(0.5, s.height * k); s.__k = k;
        } else {
          const a = dx * 0.06, ca = Math.cos(a), sa = Math.sin(a);
          xformStrokes(s, p => {
            const vx = p.x - t.c.x, vy = p.y - t.c.y;
            return { x: t.c.x + vx * ca - vy * sa, y: t.c.y + vx * sa + vy * ca };
          });
        }
        this._sceneVersion = (this._sceneVersion | 0) + 1;
        this.render();
        return true;
      },
      onUp() {
        if (this._touch) {
          const s = this.shapes[this._touch.i];
          if (s && s.__k) { s.height = Math.max(0.5, s.height); delete s.__k; }
          this._touch = null;
          this._updateStatus?.(); this.events?.emit?.('history:changed', {});
        }
        return true;
      },
      onDraw(ctx) {
        const t = this._touch;
        if (!t) return;
        const s = this.shapes[t.i]; if (!s || !s.strokes) return;
        const b = strokeBounds(s.strokes); if (!b) return;
        const p1 = this._wToS(b.minX, b.maxY), p2 = this._wToS(b.maxX, b.minY);
        const LBL = { move: 'نقل', size: 'تكبير (Alt)', rot: 'تدوير (Shift)' };
        ctx.save();
        ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.strokeRect(p1.x - 4, p1.y - 4, (p2.x - p1.x) + 8, (p2.y - p1.y) + 8);
        ctx.setLineDash([]); ctx.fillStyle = '#3fb950'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(LBL[t.mode], (p1.x + p2.x) / 2, p1.y - 10);
        ctx.restore();
      },
    };

    /* أدوات النقر الواحد */
    const clickTool = run => ({
      cursor: 'text',
      onDown(pt) { run.call(this, pt, this._hitTest(pt)); return true; },
      onMove() { return true; },
      onUp()   { return true; },
    });

    // النقر داخل شكل مغلق (لا على حدّه) يجب أن يجده أيضاً
    P._areaUnder = function (pt) {
      for (let i = this.shapes.length - 1; i >= 0; i--) {
        const s = this.shapes[i];
        if (!s || s.type === 'text') continue;
        const p = pathPoints(s);
        if (p && p.length > 2 && inside(p, pt.x, pt.y)) return i;
      }
      return -1;
    };

    const TOOLS = {
      'type-path':          clickTool(function (pt, i) { i >= 0 ? this.placeTypeOnPath(i, false) : toast('انقر على مسار', 'warn'); }),
      'vertical-type-path': clickTool(function (pt, i) { i >= 0 ? this.placeTypeOnPath(i, true)  : toast('انقر على مسار', 'warn'); }),
      'vertical-type':      clickTool(function (pt)    { this.placeVerticalTypeAt(pt); }),
      'area-type':          clickTool(function (pt, i) { const j = i >= 0 ? i : this._areaUnder(pt); j >= 0 ? this.placeAreaType(j, false) : toast('انقر داخل شكل مغلق', 'warn'); }),
      'vertical-area':      clickTool(function (pt, i) { const j = i >= 0 ? i : this._areaUnder(pt); j >= 0 ? this.placeAreaType(j, true)  : toast('انقر داخل شكل مغلق', 'warn'); }),
      'touch-type':         touchTool,
    };

    const origInstall = P._installCore;
    P._installCore = function () {
      origInstall.call(this);
      if (!this.tools) return;
      for (const [k, def] of Object.entries(TOOLS)) this.tools.register(k, def);
    };
  }

  if (typeof CanvasEditor !== 'undefined') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
