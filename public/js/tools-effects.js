/**
 * tools-effects.js — 10 تأثيرات على الأشكال المحددة
 *
 *  تموج · خشونة · تنعيم · تبسيط · تخريم (شرطات) · دوامة
 *  انتفاخ · تدريج · تعبئة هاشير · ظل مزدوج
 *
 * كل تأثير يعمل على التحديد الحالي (شكل أو أكثر)؛ الأشكال غير المسارية
 * تُحوَّل لمسار كثيف أولاً. التراجع Ctrl+Z يلغي أي تأثير.
 */
(function effectsTools() {
  'use strict';
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  // تحويل شكل لمسار نقاط (كثيف للأشكال التحليلية)
  function toPath(ed, s) {
    if (s.type === 'polyline') return { points: s.points.map(p => ({ ...p })), closed: !!s.closed };
    if (s.type === 'polygon')  return { points: s.points.map(p => ({ ...p })), closed: true };
    if (s.type === 'line')     return { points: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], closed: false };
    const pts = ed._toClosedPoints(s, 1.2);
    return pts ? { points: pts, closed: true } : null;
  }

  // تكثيف مسار بحيث لا تتجاوز المسافة بين نقطتين step
  function densify(points, closed, step) {
    const out = [];
    const n = points.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = points[i], b = points[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s < k; s++) out.push({ x: a.x + (b.x - a.x) * s / k, y: a.y + (b.y - a.y) * s / k });
    }
    if (!closed) out.push({ ...points[n - 1] });
    return out;
  }

  function centroid(points) {
    let x = 0, y = 0;
    for (const p of points) { x += p.x; y += p.y; }
    return { x: x / points.length, y: y / points.length };
  }

  // عمودي وحدة عند كل نقطة (متوسط اتجاهي الجارين)
  function normals(points, closed) {
    const n = points.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = points[(i - 1 + n) % n], b = points[(i + 1) % n];
      let dx = b.x - a.x, dy = b.y - a.y;
      if (!closed && (i === 0))      { dx = points[1].x - points[0].x; dy = points[1].y - points[0].y; }
      if (!closed && (i === n - 1))  { dx = points[n-1].x - points[n-2].x; dy = points[n-1].y - points[n-2].y; }
      const l = Math.hypot(dx, dy) || 1;
      out.push({ x: -dy / l, y: dx / l });
    }
    return out;
  }

  /* ══ التأثيرات ══ */
  const FX = {
    // 1) تموج — إزاحة جيبية على طول العمودي
    wave(ed, path) {
      const pts = densify(path.points, path.closed, 1.5);
      const ns = normals(pts, path.closed);
      let d = 0;
      const out = pts.map((p, i) => {
        if (i) d += Math.hypot(p.x - pts[i-1].x, p.y - pts[i-1].y);
        const a = Math.sin(d * (2 * Math.PI / 14)) * 2.2;
        return { x: p.x + ns[i].x * a, y: p.y + ns[i].y * a };
      });
      return [{ type: 'polyline', points: out, closed: path.closed }];
    },

    // 2) خشونة — اهتزاز عشوائي صغير
    roughen(ed, path) {
      const pts = densify(path.points, path.closed, 2.5);
      const ns = normals(pts, path.closed);
      const out = pts.map((p, i) => {
        const a = (Math.random() - 0.5) * 2.4;
        return { x: p.x + ns[i].x * a, y: p.y + ns[i].y * a };
      });
      return [{ type: 'polyline', points: out, closed: path.closed }];
    },

    // 3) تنعيم — متوسط متحرك
    smooth(ed, path) {
      const pts = path.points;
      const n = pts.length;
      if (n < 5) return null;
      const out = pts.map((p, i) => {
        if (!path.closed && (i === 0 || i === n - 1)) return { ...p };
        const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
        return { x: (a.x + p.x * 2 + b.x) / 4, y: (a.y + p.y * 2 + b.y) / 4 };
      });
      return [{ type: 'polyline', points: out, closed: path.closed }];
    },

    // 4) تبسيط — تقليل النقاط RDP
    simplify(ed, path) {
      const out = ed._rdp(path.points, 0.6);
      if (out.length < 2) return null;
      return [{ type: 'polyline', points: out, closed: path.closed }];
    },

    // 5) تخريم — تقطيع المسار شرطات (قَصّ متقطع)
    perforate(ed, path) {
      const cut = 5, gap = 2.5;
      const pts = densify(path.points, path.closed, 0.8);
      const segs = [];
      let cur = [], d = 0, inCut = true;
      for (let i = 0; i < pts.length; i++) {
        if (i) d += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
        const phase = d % (cut + gap);
        const nowCut = phase < cut;
        if (nowCut) cur.push(pts[i]);
        if (inCut && !nowCut) { if (cur.length > 1) segs.push(cur); cur = []; }
        inCut = nowCut;
      }
      if (cur.length > 1) segs.push(cur);
      if (!segs.length) return null;
      return segs.map(s => ({ type: 'polyline', points: s, closed: false }));
    },

    // 6) دوامة — تدوير يتدرج مع البعد عن المركز
    twirl(ed, path) {
      const pts = densify(path.points, path.closed, 1.5);
      const c = centroid(pts);
      const maxR = Math.max(...pts.map(p => Math.hypot(p.x - c.x, p.y - c.y))) || 1;
      const k = 0.9;
      const out = pts.map(p => {
        const dx = p.x - c.x, dy = p.y - c.y;
        const r = Math.hypot(dx, dy);
        const a = k * (1 - r / maxR);
        const cos = Math.cos(a), sin = Math.sin(a);
        return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
      });
      return [{ type: 'polyline', points: out, closed: path.closed }];
    },

    // 7) انتفاخ — دفع للخارج يقل مع البعد
    bloat(ed, path) {
      const pts = densify(path.points, path.closed, 1.5);
      const c = centroid(pts);
      const maxR = Math.max(...pts.map(p => Math.hypot(p.x - c.x, p.y - c.y))) || 1;
      const out = pts.map(p => {
        const dx = p.x - c.x, dy = p.y - c.y;
        const r = Math.hypot(dx, dy) || 1;
        const f = 1 + 0.30 * Math.sin(Math.PI * Math.min(1, r / maxR));
        return { x: c.x + dx * f, y: c.y + dy * f };
      });
      return [{ type: 'polyline', points: out, closed: path.closed }];
    },

    // 8) تدريج — تحويل المسار لخطوات متعامدة (نمط بكسلي)
    stair(ed, path) {
      const g = 3;
      const q = v => Math.round(v / g) * g;
      const src = densify(path.points, path.closed, g);
      const out = [];
      let px = q(src[0].x), py = q(src[0].y);
      out.push({ x: px, y: py });
      for (let i = 1; i < src.length; i++) {
        const x = q(src[i].x), y = q(src[i].y);
        if (x === px && y === py) continue;
        if (x !== px && y !== py) out.push({ x, y: py });
        out.push({ x, y });
        px = x; py = y;
      }
      if (out.length < 2) return null;
      return [{ type: 'polyline', points: out, closed: path.closed }];
    },

    // 9) تعبئة هاشير — خطوط حفر داخل الشكل المغلق (يُبقي الأصل)
    hatchfill(ed, path) {
      if (!path.closed) { toast('التعبئة للأشكال المغلقة فقط', 'warn'); return 'keep'; }
      const pts = path.points;
      const spacing = 3;
      let minY = Infinity, maxY = -Infinity;
      for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
      const lines = [];
      const n = pts.length;
      for (let y = minY + spacing; y < maxY; y += spacing) {
        const xs = [];
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
          }
        }
        xs.sort((q, w) => q - w);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          if (xs[k+1] - xs[k] > 0.5) {
            lines.push({ type: 'line', x1: xs[k] + 0.3, y1: y, x2: xs[k+1] - 0.3, y2: y });
          }
        }
      }
      if (!lines.length) return 'keep';
      return { append: lines };   // أضف خطوط التعبئة واحتفظ بالأصل
    },

    // 10) ظل مزدوج — نسخة مُزاحة خلف الشكل (نقش بخطين)
    shadow(ed, path) {
      const off = 1.8;
      const copy = path.points.map(p => ({ x: p.x + off, y: p.y - off }));
      return { append: [{ type: 'polyline', points: copy, closed: path.closed }] };
    },
  };

  const FX_NAMES = {
    wave: 'تموج', roughen: 'خشونة', smooth: 'تنعيم', simplify: 'تبسيط',
    perforate: 'تخريم', twirl: 'دوامة', bloat: 'انتفاخ', stair: 'تدريج',
    hatchfill: 'تعبئة هاشير', shadow: 'ظل مزدوج',
  };

  P.applyEffect = function (name) {
    const fx = FX[name];
    if (!fx) return;
    const idx = this._selIndices();
    if (!idx.length) { toast('حدد شكلاً أولاً ثم طبّق التأثير', 'warn'); return; }

    this._saveHistory();
    let applied = 0;
    const newSel = new Set();

    // عالج بترتيب تنازلي حتى لا تختل الفهارس عند الاستبدال المتعدد
    for (const i of [...idx].sort((a, b) => b - a)) {
      const s = this.shapes[i];
      if (!s || s.locked || s.type === 'text') continue;
      const path = toPath(this, s);
      if (!path || path.points.length < 2) continue;

      const result = fx(this, path);
      if (!result || result === 'keep') { if (result === 'keep') applied++; continue; }

      if (result.append) {
        this.shapes.push(...result.append);
        applied++;
      } else {
        this.shapes.splice(i, 1, ...result);
        applied++;
      }
    }

    if (!applied) {
      toast('التأثير لا ينطبق على هذا التحديد', 'warn');
      this.history.pop();   // لا تغيير فعلي — لا تلوث سجل التراجع
      return;
    }
    this.msel = newSel;
    this.selectedIdx = -1;
    this._updateShapeToolbar();
    this.render(); this._updateStatus();
    toast(`✨ تأثير «${FX_NAMES[name]}» طُبق — Ctrl+Z للتراجع`, 'success');
  };
})();
