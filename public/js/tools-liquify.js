/**
 * tools-liquify.js — فرش التسييل السبع من إليستريتور
 *
 *   warp        تشويه  — يدفع الحدّ باتجاه السحب
 *   twirl       دوّامة — يلفّ الحدّ حول مركز الفرشاة
 *   pucker      تقبيض  — يشدّ النقاط نحو المركز
 *   bloat       انتفاخ — يدفع النقاط بعيداً عن المركز
 *   scallop     تخريم  — نتوءات مستديرة داخلة
 *   crystallize تبلور  — نتوءات شائكة خارجة
 *   wrinkle     تجعيد  — تموّج عمودي على الحدّ
 *
 * هذه فرشٌ تفاعلية تُمرَّر على العمل — لا مؤثّرات حوارية. الفرق جوهري:
 * `tools-effects.js` فيه `twirl`/`bloat` بوصفهما تحويلاً كاملاً للشكل بزاوية
 * تُدخَل في حقل؛ أما هنا فأنت ترسم التشوّه بيدك حيث تريده وبالقدر الذي تريده.
 *
 * كيف تعمل على أشكال بارامترية: الدائرة لا تملك نقاطاً تُزاح. فعند أوّل لمسة
 * يُحوَّل الشكل إلى `polygon` (أو `polyline` للمفتوح) بنقاط مكثّفة — وكلاهما
 * نوعان أصليان يقرؤهما مولّد G-Code (`_genPolygon` → `_genPolyline`). لا نوع
 * جديد ولا تغيير في المولّد.
 */
(function toolsLiquify() {
  'use strict';

  const R_DEFAULT = 18;    // نصف قطر الفرشاة بالمليمتر
  const K_DEFAULT = 0.45;  // شدّة التأثير لكل حركة

  const toast = (m, t) => window.app?.toast?.(m, t);

  /* ═══════════ هندسة مساعدة ═══════════ */

  // تكثيف: لا مقطع أطول من max — بلا تكثيف لا يظهر التخريم ولا التجعيد
  function densify(pts, closed, max) {
    if (!pts || pts.length < 2) return pts || [];
    const out = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push({ x: a.x, y: a.y });
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.floor(d / max);
      for (let j = 1; j <= k; j++) {
        const t = j / (k + 1);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    if (!closed) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    return out;
  }

  // أي شكل → قائمة نقاط على حدّه
  function outlineOf(s) {
    const PM = window.DQ && window.DQ.PathModel;
    const arc = (cx, cy, rx, ry, n) => {
      const o = [];
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; o.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }); }
      return o;
    };
    switch (s.type) {
      case 'polygon':  return { pts: (s.points || []).map(p => ({ x: p.x, y: p.y })), closed: true };
      case 'polyline': return { pts: (s.points || []).map(p => ({ x: p.x, y: p.y })), closed: !!s.closed };
      case 'rect':     return { pts: [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }], closed: true };
      case 'circle':   return { pts: arc(s.cx, s.cy, s.r, s.r, 72), closed: true };
      case 'ellipse':  return { pts: arc(s.cx, s.cy, s.rx || 1, s.ry || 1, 72), closed: true };
      case 'line':     return { pts: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], closed: false };
      default: {
        // البقية عبر PathModel (قوس، فتحة، مسار بيزيري…) — تسطيح دقيق
        if (PM && PM.flatten) {
          try {
            const p = PM.isPath(s) ? s : PM.fromShape(s);
            if (p) { const f = PM.flatten(p, 0.05); if (f && f.points && f.points.length > 1) return { pts: f.points.map(q => ({ x: q.x, y: q.y })), closed: !!p.closed }; }
          } catch (_) {}
        }
        return null;
      }
    }
  }

  /* حوّل الشكل إلى نقاط قابلة للتسييل، محافظاً على هويته (الطبقة/الاسم/اللون) */
  function toEditable(ed, i, brushR) {
    const s = ed.shapes[i];
    if (!s) return null;
    const dense = Math.max(brushR / 8, 0.25);

    if (s.type === 'polygon' || (s.type === 'polyline' && s.points)) {
      // مكثَّف أصلاً؟ اتركه. وإلا كثّفه في مكانه مرّة واحدة
      if (!s.__liq) {
        s.points = densify(s.points || [], s.type === 'polygon' || !!s.closed, dense);
        s.__liq = 1;
      }
      return s;
    }

    const o = outlineOf(s);
    if (!o || o.pts.length < 2) return null;
    const pts = densify(o.pts, o.closed, dense);
    const keep = {};
    for (const k of ['layer', 'name', 'stroke', 'sw', 'maxDepth', 'locked', 'disabled', 'reversed'])
      if (s[k] !== undefined) keep[k] = s[k];
    const np = o.closed
      ? { type: 'polygon', points: pts, cx: avg(pts, 'x'), cy: avg(pts, 'y'), __liq: 1, ...keep }
      : { type: 'polyline', points: pts, closed: false, __liq: 1, ...keep };
    ed.shapes[i] = np;
    return np;
  }

  const avg = (pts, k) => pts.reduce((a, p) => a + p[k], 0) / (pts.length || 1);

  /* مُعلَن للوحدات الأخرى (الالتفاف الدُّمية/القص التفاعلي تحتاج التحويل نفسه
     من شكل بارامتري إلى نقاط قابلة للإزاحة) — مصدر واحد لا نسختان */
  window.DQPoly = { outlineOf, densify, toEditable, avg };

  // ناعمة عند الحافة، كاملة في المركز
  const falloff = (d, r) => { if (d >= r) return 0; const t = 1 - d / r; return t * t; };

  /* ═══════════ نوى التشويه ═══════════
     كلٌّ تُعيد إزاحة النقطة p ضمن فرشاة مركزها c ونصف قطرها r. */
  const KERNELS = {
    warp(p, c, r, k, ctx) {
      const f = falloff(Math.hypot(p.x - c.x, p.y - c.y), r);
      if (!f) return null;
      return { x: ctx.dx * f * k * 3, y: ctx.dy * f * k * 3 };
    },
    twirl(p, c, r, k, ctx) {
      const vx = p.x - c.x, vy = p.y - c.y;
      const f = falloff(Math.hypot(vx, vy), r);
      if (!f) return null;
      const a = k * f * 0.5 * (ctx.alt ? -1 : 1);
      const ca = Math.cos(a), sa = Math.sin(a);
      return { x: (vx * ca - vy * sa) - vx, y: (vx * sa + vy * ca) - vy };
    },
    pucker(p, c, r, k, ctx) {
      const vx = c.x - p.x, vy = c.y - p.y;
      const f = falloff(Math.hypot(vx, vy), r);
      if (!f) return null;
      const g = k * f * 0.35 * (ctx.alt ? -1 : 1);
      return { x: vx * g, y: vy * g };
    },
    bloat(p, c, r, k, ctx) {
      const vx = p.x - c.x, vy = p.y - c.y;
      const f = falloff(Math.hypot(vx, vy), r);
      if (!f) return null;
      const g = k * f * 0.35 * (ctx.alt ? -1 : 1);
      return { x: vx * g, y: vy * g };
    },
    // النتوءات: التناوب على الفهرس هو ما يصنع الأسنان — دفعةٌ موحّدة تُكبّر الشكل فقط
    scallop(p, c, r, k, ctx) {
      const vx = c.x - p.x, vy = c.y - p.y;
      const d = Math.hypot(vx, vy), f = falloff(d, r);
      if (!f || d < 1e-9) return null;
      const wave = ctx.i % 2 === 0 ? 1 : 0.15;
      const g = k * f * wave * 0.5 * (ctx.alt ? -1 : 1);
      return { x: vx * g, y: vy * g };
    },
    crystallize(p, c, r, k, ctx) {
      const vx = p.x - c.x, vy = p.y - c.y;
      const d = Math.hypot(vx, vy), f = falloff(d, r);
      if (!f || d < 1e-9) return null;
      const spike = ctx.i % 2 === 0 ? 1 : -0.25;
      const g = k * f * spike * 0.5 * (ctx.alt ? -1 : 1);
      return { x: vx * g, y: vy * g };
    },
    wrinkle(p, c, r, k, ctx) {
      const f = falloff(Math.hypot(p.x - c.x, p.y - c.y), r);
      if (!f || !ctx.nx) return null;
      const amp = k * f * r * 0.09 * Math.sin(ctx.i * 1.35 + ctx.phase) * (ctx.alt ? -1 : 1);
      return { x: ctx.nx * amp, y: ctx.ny * amp };
    },
  };

  function boot() {
    const C = (typeof CanvasEditor !== 'undefined') ? CanvasEditor : window.CanvasEditor;
    if (!C || !C.prototype) return;
    const P = C.prototype;
    if (P.__liquify) return;
    P.__liquify = true;

    P._liqR = R_DEFAULT;
    P._liqK = K_DEFAULT;

    /* تطبيق ضربة واحدة من الفرشاة عند نقطة */
    P.liquifyAt = function (kind, c, opts) {
      const fn = KERNELS[kind];
      if (!fn) return 0;
      const r = this._liqR, k = this._liqK;
      const ctx = { dx: opts?.dx || 0, dy: opts?.dy || 0, alt: !!opts?.alt, phase: opts?.phase || 0, i: 0, nx: 0, ny: 0 };

      // مرشّحون: كل شكل يتقاطع مربّعه المحيط مع الفرشاة
      const rect = { minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r };
      let cand;
      try { cand = this.selectInRect(rect); } catch (_) { cand = this.shapes.map((_, i) => i); }
      // إن كان ثمّة تحديد، اقصر التسييل عليه — كإليستريتور تماماً
      const sel = new Set();
      if (this.msel && this.msel.size) for (const i of this.msel) sel.add(i);
      else if (this.selectedIdx >= 0) sel.add(this.selectedIdx);
      if (sel.size) cand = cand.filter(i => sel.has(i));

      let touched = 0;
      for (const i of cand) {
        const s0 = this.shapes[i];
        if (!s0 || s0.locked) continue;
        const s = toEditable(this, i, r);
        if (!s || !s.points || s.points.length < 2) continue;
        const pts = s.points;
        const closed = s.type === 'polygon' || !!s.closed;
        let moved = false;
        for (let j = 0; j < pts.length; j++) {
          ctx.i = j;
          if (kind === 'wrinkle') {
            const a = pts[(j - 1 + pts.length) % pts.length], b = pts[(j + 1) % pts.length];
            if (!closed && (j === 0 || j === pts.length - 1)) { ctx.nx = ctx.ny = 0; }
            else {
              const tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty) || 1;
              ctx.nx = -ty / L; ctx.ny = tx / L;      // العمودي على المماس
            }
          }
          const d = fn(pts[j], c, r, k, ctx);
          if (!d) continue;
          pts[j].x += d.x; pts[j].y += d.y; moved = true;
        }
        if (moved) {
          if (s.type === 'polygon') { s.cx = avg(pts, 'x'); s.cy = avg(pts, 'y'); }
          touched++;
        }
      }
      if (touched) this._sceneVersion = (this._sceneVersion | 0) + 1;
      return touched;
    };

    /* بناء أداة فرشاة واحدة */
    function brush(kind, label) {
      return {
        cursor: 'crosshair',
        onDown(pt, e) {
          this._saveHistory();
          this._liqStroke = { last: pt, phase: 0, any: 0 };
          const n = this.liquifyAt(kind, pt, { dx: 0, dy: 0, alt: e.altKey });
          this._liqStroke.any += n;
          this._liqAt = pt;
          this.render();
          return true;
        },
        onMove(pt, e) {
          if (!this._liqStroke) { this._liqAt = pt; this.render(); return true; }
          const st = this._liqStroke;
          const dx = pt.x - st.last.x, dy = pt.y - st.last.y;
          st.phase += 0.6;
          st.any += this.liquifyAt(kind, pt, { dx, dy, alt: e.altKey, phase: st.phase });
          st.last = pt;
          this._liqAt = pt;
          this.render();
          return true;
        },
        onUp() {
          const st = this._liqStroke;
          this._liqStroke = null;
          if (st && !st.any) toast(`${label}: مرّر الفرشاة فوق شكل`, 'warn');
          else if (st) { this._updateStatus?.(); this.events?.emit?.('history:changed', {}); }
          return true;
        },
        onDraw(ctx) {
          const c = this._liqAt;
          if (!c) return;
          const p = this._wToS(c.x, c.y);
          const rp = this._liqR * this.scale;
          ctx.save();
          ctx.strokeStyle = 'rgba(88,166,255,.9)'; ctx.lineWidth = 1.25; ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(p.x, p.y, rp, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(88,166,255,.3)';
          ctx.beginPath(); ctx.arc(p.x, p.y, rp * 0.35, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        },
      };
    }

    const BRUSHES = {
      'warp':        'تشويه',
      'twirl':       'دوّامة',
      'pucker':      'تقبيض',
      'bloat':       'انتفاخ',
      'scallop':     'تخريم',
      'crystallize': 'تبلور',
      'wrinkle':     'تجعيد',
    };

    const origInstall = P._installCore;
    P._installCore = function () {
      origInstall.call(this);
      if (!this.tools) return;
      for (const [k, label] of Object.entries(BRUSHES)) this.tools.register(k, brush(k, label));
    };

    /* حوار ضبط الفرشاة — نصف القطر والشدّة معاً */
    P.promptLiquify = async function () {
      const ask = window.DQPrompt;
      if (!ask) { toast('حوار الإدخال غير متاح', 'error'); return; }
      const r = await ask('ضبط فرشاة التسييل', [
        { key: 'r', label: 'نصف قطر الفرشاة (مم)', def: this._liqR, min: 1, step: 1 },
        { key: 'k', label: 'الشدّة (0.05 – 1)',    def: this._liqK, min: 0.05, max: 1, step: 0.05 },
      ]);
      if (!r) return;
      if (!(r.r > 0) || !(r.k > 0)) { toast('قيمة غير صالحة', 'error'); return; }
      this._liqR = r.r; this._liqK = Math.min(1, r.k);
      toast(`الفرشاة: نصف قطر ${this._liqR}مم · شدّة ${this._liqK}`, 'success');
      this.render();
    };

    // [ و ] لتصغير/تكبير الفرشاة كما في برامج التصميم
    document.addEventListener('keydown', e => {
      const E = window.app && window.app.editor;
      if (!E || !BRUSHES[E.tool]) return;
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      if (e.key === '[') { E._liqR = Math.max(1, E._liqR - Math.max(1, E._liqR * 0.15)); E.render(); }
      if (e.key === ']') { E._liqR = Math.min(500, E._liqR + Math.max(1, E._liqR * 0.15)); E.render(); }
    });
  }

  // فوراً: تغليف `_installCore` يجب أن يسبق إنشاء المحرر في app.js
  if (typeof CanvasEditor !== 'undefined') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
