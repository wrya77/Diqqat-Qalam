/**
 * tools-warp-pro.js — الالتفاف الدُّمية والقصّ التفاعلي
 *
 *   puppet-warp  التفاف الدُّمية — ثبّت دبابيس ثم اسحب واحداً فينثني الشكل حوله
 *   shear-tool   قصّ تفاعلي     — اسحب فتُمال الأشكال المحدَّدة حول مركزها
 *
 * `shearSelected` القائمة في `tools-illustrator.js` **أمرٌ حواري**: تكتب زاويةً
 * فتُطبَّق. وهذه **أداة**: تسحب فترى الإمالة وهي تحدث وتتوقّف حيث يعجبك — وهذا
 * الفارق نفسه بين قائمة Transform وأداة Shear في إليستريتور.
 *
 * رياضيات الدُّمية: كل نقطة تُزاح بمتوسّط موزون لإزاحات الدبابيس، والوزن
 * عكس مربّع المسافة من موضع الدبّوس **الأصلي**. الدبابيس غير المسحوبة تبقى
 * إزاحتها صفراً، فتعمل مثبِّتات تُمسك ما حولها — وهذا سرّ الأداة: بلا مثبّت
 * يتحرّك الشكل كلّه، ومع مثبّتين ينثني بينهما.
 */
(function toolsWarpPro() {
  'use strict';

  const toast = (m, t) => window.app?.toast?.(m, t);
  const EPS = 1e-6;

  function boot() {
    const C = (typeof CanvasEditor !== 'undefined') ? CanvasEditor : window.CanvasEditor;
    if (!C || !C.prototype) return;
    const P = C.prototype;
    if (P.__warpPro) return;
    P.__warpPro = true;

    /* حوّل الشكل إلى نقاط قابلة للإزاحة وطبّق تحويلاً نقطياً */
    function eachPoint(ed, i, fn) {
      const s0 = ed.shapes[i];
      if (!s0 || s0.locked) return false;

      if (s0.type === 'text' && Array.isArray(s0.strokes)) {
        for (const st of s0.strokes) for (const p of st) { const q = fn(p); p.x = q.x; p.y = q.y; }
        return true;
      }
      if (s0.type === 'compound' && Array.isArray(s0.contours)) {
        s0.contours = s0.contours.map(r => r.map(p => fn(p)));
        return true;
      }
      // بارامتري (دائرة/مستطيل/قوس…): يُحوَّل لنقاط أولاً — الإمالة لا معنى لها
      // على نصف قطر، والدُّمية تحتاج نقاطاً تنثني
      const Poly = window.DQPoly;
      const s = (s0.points && s0.points.length > 1) ? s0
              : (Poly ? Poly.toEditable(ed, i, 6) : null);
      if (!s || !s.points) return false;
      s.points = s.points.map(p => ({ ...p, ...fn(p) }));
      if (s.type === 'polygon' && Poly) { s.cx = Poly.avg(s.points, 'x'); s.cy = Poly.avg(s.points, 'y'); }
      return true;
    }

    const selIdx = ed => {
      const out = [];
      if (ed.msel && ed.msel.size) out.push(...ed.msel);
      else if (ed.selectedIdx >= 0) out.push(ed.selectedIdx);
      return out;
    };

    const selBounds = (ed, idx) => {
      let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const i of idx) {
        const s = ed.shapes[i]; if (!s) continue;
        let q; try { q = ed._bounds(s); } catch (_) { continue; }
        b.minX = Math.min(b.minX, q.minX); b.minY = Math.min(b.minY, q.minY);
        b.maxX = Math.max(b.maxX, q.maxX); b.maxY = Math.max(b.maxY, q.maxY);
      }
      return isFinite(b.minX) ? b : null;
    };

    /* ═══════════ ١) القصّ التفاعلي ═══════════ */
    const shearTool = {
      cursor: 'ew-resize',
      onDown(pt, e) {
        const idx = selIdx(this);
        if (!idx.length) { toast('حدّد شكلاً أولاً ثم اسحب للإمالة', 'warn'); return true; }
        const b = selBounds(this, idx);
        if (!b) return true;
        this._saveHistory();
        this._shear = {
          idx, start: pt, vertical: e.altKey,
          c: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
          h: Math.max(b.maxY - b.minY, EPS), w: Math.max(b.maxX - b.minX, EPS),
          applied: 0,
        };
        return true;
      },
      onMove(pt, e) {
        const S = this._shear;
        if (!S) return true;
        // الزاوية من نسبة السحب إلى ارتفاع (أو عرض) التحديد — سحبٌ بمقدار
        // الارتفاع يعطي ٤٥°، وهو مقياس يدوي مفهوم
        const raw = S.vertical ? (pt.y - S.start.y) / S.w : (pt.x - S.start.x) / S.h;
        let t = Math.max(-3, Math.min(3, raw));
        if (e.shiftKey) { const step = Math.tan(15 * Math.PI / 180); t = Math.round(t / step) * step; }
        const d = t - S.applied;
        if (Math.abs(d) < 1e-9) return true;
        const c = S.c;
        const fn = S.vertical
          ? p => ({ x: p.x, y: p.y + d * (p.x - c.x) })
          : p => ({ x: p.x + d * (p.y - c.y), y: p.y });
        for (const i of S.idx) eachPoint(this, i, fn);
        S.applied = t;
        S.angle = Math.atan(t) * 180 / Math.PI;
        this._sceneVersion = (this._sceneVersion | 0) + 1;
        this.render();
        return true;
      },
      onUp() {
        const S = this._shear;
        this._shear = null;
        if (S && S.applied) {
          this._updateStatus?.(); this.events?.emit?.('history:changed', {});
          toast(`✓ إمالة ${S.angle.toFixed(1)}° ${S.vertical ? 'رأسية' : 'أفقية'}`, 'success');
        }
        return true;
      },
      onDraw(ctx) {
        const S = this._shear;
        const idx = S ? S.idx : selIdx(this);
        const b = selBounds(this, idx);
        if (!b) return;
        const p1 = this._wToS(b.minX, b.maxY), p2 = this._wToS(b.maxX, b.minY);
        ctx.save();
        ctx.strokeStyle = 'rgba(63,185,80,.9)'; ctx.lineWidth = 1.25; ctx.setLineDash([5, 4]);
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        if (S) {
          const c = this._wToS(S.c.x, S.c.y);
          ctx.setLineDash([]); ctx.fillStyle = '#3fb950';
          ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill();
          ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(`${(S.angle || 0).toFixed(1)}°`, c.x, c.y - 12);
        } else {
          ctx.setLineDash([]); ctx.fillStyle = 'rgba(63,185,80,.85)';
          ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('اسحب أفقياً للإمالة · Alt رأسياً · Shift بخطوات ١٥°', (p1.x + p2.x) / 2, p1.y - 8);
        }
        ctx.restore();
      },
    };

    /* ═══════════ ٢) الالتفاف الدُّمية ═══════════ */
    const PIN_R = 7;   // نصف قطر مقبض الدبّوس بالبكسل

    P._puppetAttach = function (i) {
      const s = this.shapes[i];
      if (!s) return false;
      // لقطة أصلية: كل إزاحة تُحسب من الوضع الابتدائي فلا تتراكم التشوّهات
      const Poly = window.DQPoly;
      if (!(s.points && s.points.length > 2) && Poly) Poly.toEditable(this, i, 6);
      const t = this.shapes[i];
      const snap = t.type === 'text' && t.strokes
        ? { kind: 'strokes', data: t.strokes.map(st => st.map(p => ({ x: p.x, y: p.y }))) }
        : (t.points ? { kind: 'points', data: t.points.map(p => ({ x: p.x, y: p.y })) } : null);
      if (!snap) { toast('هذا الشكل لا يقبل الالتفاف', 'warn'); return false; }
      this._puppet = { i, snap, pins: [] };
      toast('انقر لوضع الدبابيس — ثبّت اثنين على الأقل ثم اسحب ثالثاً · Alt+نقر يحذف · Esc ينهي', 'info');
      return true;
    };

    P._puppetApply = function () {
      const G = this._puppet;
      if (!G) return;
      const s = this.shapes[G.i];
      if (!s) return;
      const pins = G.pins;
      const move = (p0) => {
        if (!pins.length) return { x: p0.x, y: p0.y };
        let wx = 0, wy = 0, ws = 0;
        for (const pin of pins) {
          const d2 = (p0.x - pin.ox) ** 2 + (p0.y - pin.oy) ** 2;
          const w = 1 / (d2 + 1e-3);
          wx += w * (pin.x - pin.ox); wy += w * (pin.y - pin.oy); ws += w;
        }
        return { x: p0.x + wx / ws, y: p0.y + wy / ws };
      };
      if (G.snap.kind === 'points') {
        s.points = G.snap.data.map(p0 => ({ ...move(p0) }));
        const Poly = window.DQPoly;
        if (s.type === 'polygon' && Poly) { s.cx = Poly.avg(s.points, 'x'); s.cy = Poly.avg(s.points, 'y'); }
      } else {
        for (let a = 0; a < s.strokes.length; a++)
          for (let b = 0; b < s.strokes[a].length; b++) {
            const q = move(G.snap.data[a][b]);
            s.strokes[a][b].x = q.x; s.strokes[a][b].y = q.y;
          }
      }
      this._sceneVersion = (this._sceneVersion | 0) + 1;
    };

    P._puppetFinish = function (quiet) {
      const G = this._puppet;
      this._puppet = null; this._pinDrag = null;
      if (G && !quiet) { this._updateStatus?.(); this.events?.emit?.('history:changed', {}); }
      this.render();
    };

    const puppetTool = {
      cursor: 'crosshair',
      onDown(pt, e) {
        const G = this._puppet;
        if (!G) {
          const i = this._hitTest(pt);
          if (i < 0) { toast('انقر على شكل لبدء الالتفاف', 'warn'); return true; }
          this._saveHistory();
          this._puppetAttach(i);
          this.render();
          return true;
        }
        // دبّوس تحت المؤشر؟
        const tol = PIN_R / this.scale;
        const hit = G.pins.findIndex(p => Math.hypot(p.x - pt.x, p.y - pt.y) < tol);
        if (hit >= 0) {
          if (e.altKey) { G.pins.splice(hit, 1); this._puppetApply(); this.render(); return true; }
          this._pinDrag = hit;
          return true;
        }
        G.pins.push({ ox: pt.x, oy: pt.y, x: pt.x, y: pt.y });
        this.render();
        return true;
      },
      onMove(pt) {
        const G = this._puppet;
        if (!G || this._pinDrag == null) return true;
        const pin = G.pins[this._pinDrag];
        if (!pin) return true;
        pin.x = pt.x; pin.y = pt.y;
        this._puppetApply();
        this.render();
        return true;
      },
      onUp() {
        if (this._pinDrag != null) { this._pinDrag = null; this._updateStatus?.(); }
        return true;
      },
      onDraw(ctx) {
        const G = this._puppet;
        if (!G) return;
        ctx.save();
        for (let k = 0; k < G.pins.length; k++) {
          const p = G.pins[k];
          const o = this._wToS(p.ox, p.oy), c = this._wToS(p.x, p.y);
          const moved = Math.abs(p.x - p.ox) > 1e-9 || Math.abs(p.y - p.oy) > 1e-9;
          if (moved) {
            ctx.strokeStyle = 'rgba(255,211,61,.6)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(c.x, c.y); ctx.stroke();
            ctx.setLineDash([]);
          }
          // مثبِّت (لم يُسحب) أصفر، ومسحوبٌ أخضر — الفرق يشرح الأداة بلا شرح
          ctx.fillStyle = moved ? '#3fb950' : '#ffd33d';
          ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(c.x, c.y, PIN_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#0d1117'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(String(k + 1), c.x, c.y + 3);
        }
        if (G.pins.length < 2) {
          ctx.fillStyle = 'rgba(255,211,61,.9)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('ضع دبّوسين مثبّتين على الأقل ثم اسحب دبّوساً ثالثاً',
                       this.canvas.width / 2, 24);
        }
        ctx.restore();
      },
    };

    const origInstall = P._installCore;
    P._installCore = function () {
      origInstall.call(this);
      if (!this.tools) return;
      this.tools.register('shear-tool', shearTool);
      this.tools.register('puppet-warp', puppetTool);
    };

    // تبديل الأداة أو Esc يُنهي جلسة الدبابيس
    const origSetTool = P.setTool;
    P.setTool = function (t) {
      if (this._puppet && t !== 'puppet-warp') this._puppetFinish(true);
      return origSetTool.call(this, t);
    };
    const origCancel = P._cancelDraw;
    P._cancelDraw = function () {
      if (this._puppet) this._puppetFinish(false);
      return origCancel.call(this);
    };
  }

  if (typeof CanvasEditor !== 'undefined') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
