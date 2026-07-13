/**
 * tools-illustrator.js — إكمال طقم أدوات Illustrator الناقصة
 *
 *  تفاعلية (setTool):
 *    magic-wand    ← العصا السحرية: تحديد كل الأشكال المتشابهة بنقرة (Alt = النوع فقط)
 *    shape-builder ← منشئ الأشكال: اسحب خطاً عبر أشكال متداخلة لدمجها (Alt = طرح)
 *    reshape       ← إعادة التشكيل: سحب ناعم لجزء من المسار بتدرّج Falloff
 *
 *  عمليات (قوائم):
 *    groupSelected / ungroupSelected ← تجميع Ctrl+G / فك Ctrl+Shift+G
 *      (النقر بأداة التحديد على عضو مجموعة يحدد المجموعة كلها؛ Alt+نقر = العضو وحده)
 *    shearSelected  ← قص/إمالة Shear بزاويتين أفقية ورأسية
 *    typeOnPath     ← نص نقش يتبع مساراً محدداً (حرفاً حرفاً مع دوران المماس)
 *    verticalType   ← نص عمودي مكدّس
 *    selectSame     ← نسخة قائمة من العصا السحرية
 *
 * يُحمَّل بعد tools-vector-pro.js وقبل menu-bar.js.
 * يعتمد على: _toPath · _hitTest · _selIndices · _saveHistory · booleanOp ·
 *            _shapeToContours · _rotateShape · _textToStrokes (من tools-pro).
 */
(function illustratorTools() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  /* ═══════════════ مساعدات ═══════════════ */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // نقاط أي شكل {points, closed} عبر _toPath
  function pathOf(ed, s) {
    if (!s) return null;
    if (Array.isArray(s.points) && s.points.length >= 2) {
      return { points: s.points.map(p => ({ x: p.x, y: p.y })), closed: !!s.closed || s.type === 'polygon' };
    }
    const np = ed._toPath ? ed._toPath(s) : null;
    return (np && np.points) ? { points: np.points, closed: !!np.closed } : null;
  }

  // نقطة + مماس عند مسافة قوسية L على مسار
  function pointAt(pts, L) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (acc + d >= L || i === pts.length - 1) {
        const t = d > 1e-9 ? Math.min(1, Math.max(0, (L - acc) / d)) : 0;
        const a = pts[i - 1], b = pts[i];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ang: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      acc += d;
    }
    return null;
  }

  function pathLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    return L;
  }

  function inPoly(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (((poly[i].y > pt.y) !== (poly[j].y > pt.y)) &&
          (pt.x < (poly[j].x - poly[i].x) * (pt.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) c = !c;
    }
    return c;
  }

  /* ═══════════════ حوار عام (رقم/نص/قائمة/صح) ═══════════════ */
  function ilPrompt(title, fields) {
    return new Promise((resolve) => {
      let dlg = document.getElementById('dq-il-dialog');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'dq-il-dialog';
        dlg.style.cssText = 'border:1px solid #30363d;border-radius:12px;background:#0d1117;color:#e6edf3;padding:0;min-width:300px;z-index:9999';
        document.body.appendChild(dlg);
      }
      const inputCss = 'padding:6px 8px;border:1px solid #30363d;border-radius:6px;background:#161b22;color:#e6edf3';
      const rows = fields.map(f => {
        if (f.type === 'select') {
          const opts = f.options.map(o => `<option value="${o.v}"${o.v === f.def ? ' selected' : ''}>${o.t}</option>`).join('');
          return `<label style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0;font-size:13px"><span>${f.label}</span><select id="il-f-${f.key}" style="${inputCss};width:150px">${opts}</select></label>`;
        }
        if (f.type === 'check') {
          return `<label style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0;font-size:13px"><span>${f.label}</span><input type="checkbox" id="il-f-${f.key}"${f.def ? ' checked' : ''} style="width:18px;height:18px"></label>`;
        }
        if (f.type === 'text') {
          return `<label style="display:flex;flex-direction:column;gap:6px;margin:10px 0;font-size:13px"><span>${f.label}</span><input type="text" id="il-f-${f.key}" value="${f.def || ''}" style="${inputCss};width:100%" dir="auto"></label>`;
        }
        return `<label style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0;font-size:13px"><span>${f.label}</span><input type="number" id="il-f-${f.key}" value="${f.def}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 'any'}" style="${inputCss};width:100px;text-align:center"></label>`;
      }).join('');
      dlg.innerHTML = `
        <div style="padding:18px 20px">
          <h3 style="margin:0 0 12px;font-size:15px;color:#58a6ff">${title}</h3>
          ${rows}
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button type="button" id="il-cancel" style="padding:7px 16px;border:1px solid #30363d;border-radius:6px;background:#21262d;color:#e6edf3;cursor:pointer">إلغاء</button>
            <button type="button" id="il-ok" style="padding:7px 16px;border:0;border-radius:6px;background:#238636;color:#fff;cursor:pointer;font-weight:600">تطبيق</button>
          </div>
        </div>`;
      let settled = false;
      const finish = (val) => {
        if (settled) return; settled = true;
        try { if (dlg.open) dlg.close(); } catch (_) {}
        resolve(val);
      };
      dlg.querySelector('#il-ok').addEventListener('click', () => {
        const out = {};
        for (const f of fields) {
          const el = document.getElementById(`il-f-${f.key}`);
          if (f.type === 'check') out[f.key] = el.checked;
          else if (f.type === 'text' || f.type === 'select') out[f.key] = el.value;
          else out[f.key] = parseFloat(el.value);
        }
        finish(out);
      });
      dlg.querySelector('#il-cancel').addEventListener('click', () => finish(null));
      dlg.addEventListener('cancel', () => finish(null), { once: true });
      dlg.showModal();
      setTimeout(() => document.getElementById(`il-f-${fields[0].key}`)?.focus(), 30);
    });
  }

  /* ═══════════════ التجميع Group ═══════════════ */
  P.groupSelected = function () {
    const idx = this._selIndices();
    if (idx.length < 2) return toast('حدد شكلين أو أكثر للتجميع (Shift+نقر)', 'warn');
    this._saveHistory();
    const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    for (const i of idx) this.shapes[i].groupId = gid;
    this.render();
    toast(`✓ جُمّع ${idx.length} شكلاً — النقر على أي عضو يحدد المجموعة، Alt+نقر للعضو وحده`, 'success');
  };

  P.ungroupSelected = function () {
    const idx = this._selIndices();
    let n = 0;
    this._saveHistory();
    for (const i of idx) if (this.shapes[i].groupId) { delete this.shapes[i].groupId; n++; }
    this.render();
    toast(n ? `✓ فُكّ تجميع ${n} شكلاً` : 'لا مجموعات في التحديد', n ? 'success' : 'info');
  };

  /* ═══════════════ القص/الإمالة Shear ═══════════════ */
  // تحويل نقاط الشكل مباشرة؛ الأشكال البارامترية تُحوَّل لمسار أولاً
  P.shearSelected = async function () {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدد شكلاً أولاً', 'warn');
    const res = await ilPrompt('قص / إمالة Shear', [
      { key: 'ax', label: 'زاوية أفقية (°)', def: 15, min: -75, max: 75 },
      { key: 'ay', label: 'زاوية رأسية (°)', def: 0, min: -75, max: 75 },
    ]);
    if (!res) return;
    const tx = Math.tan((res.ax || 0) * Math.PI / 180);
    const ty = Math.tan((res.ay || 0) * Math.PI / 180);
    if (!tx && !ty) return;

    this._saveHistory();
    // مركز التحديد ككل
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of idx) {
      const b = this._bounds(this.shapes[i]);
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const sh = (p) => {
      const dx = p.x - cx, dy = p.y - cy;
      return { x: cx + dx + tx * dy, y: cy + dy + ty * dx };
    };

    let done = 0, skipped = 0;
    for (const i of idx) {
      const s = this.shapes[i];
      if (Array.isArray(s.points)) {
        s.points = s.points.map(p => ({ ...p, ...sh(p) }));
        done++;
      } else if (s.type === 'compound' && Array.isArray(s.contours)) {
        s.contours = s.contours.map(r => r.map(p => sh(p)));
        done++;
      } else if (s.type === 'text' && Array.isArray(s.strokes)) {
        s.strokes = s.strokes.map(st => st.map(p => {
          const w = sh({ x: s.x + p.x, y: s.y + p.y });
          return { x: w.x - s.x, y: w.y - s.y };
        }));
        done++;
      } else {
        const np = pathOf(this, s);
        if (np) {
          this.shapes[i] = { type: 'polyline', points: np.points.map(sh), closed: np.closed,
            feedRate: s.feedRate, tabs: s.tabs, machineOp: s.machineOp, groupId: s.groupId };
          done++;
        } else skipped++;
      }
    }
    this.render(); this._updateStatus?.();
    toast(`✓ إمالة ${done} شكلاً` + (skipped ? ` — تعذّر ${skipped}` : ''), 'success');
  };

  /* ═══════════════ العصا السحرية ═══════════════ */
  P.selectSame = function (refIdx, typeOnly) {
    const ref = this.shapes[refIdx];
    if (!ref) return;
    const rb = this._bounds(ref);
    const rd = Math.hypot(rb.maxX - rb.minX, rb.maxY - rb.minY) || 1;
    const found = [];
    this.shapes.forEach((s, i) => {
      if (s.locked) return;
      if (s.type !== ref.type) return;
      if ((s.machineOp || '') !== (ref.machineOp || '')) return;
      if (!typeOnly) {
        const b = this._bounds(s);
        const d = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) || 1;
        if (Math.abs(d - rd) / rd > 0.25) return;
      }
      found.push(i);
    });
    this.msel = new Set(found);
    this.selectedIdx = refIdx;
    this._updateShapeToolbar?.();
    this.render();
    toast(`⭐ حُدد ${found.length} شكلاً متشابهاً${typeOnly ? ' (النوع فقط)' : ''}`, 'success');
  };

  P.selectSameFromMenu = function () {
    if (this.selectedIdx < 0) return toast('حدد شكلاً مرجعياً أولاً', 'warn');
    this.selectSame(this.selectedIdx, false);
  };

  /* ═══════════════ نص على مسار ═══════════════ */
  P.typeOnPath = async function () {
    const idx = this._selIndices();
    if (idx.length !== 1) return toast('حدد مساراً واحداً ليتبعه النص', 'warn');
    const base = this.shapes[idx[0]];
    const path = pathOf(this, base);
    if (!path || path.points.length < 2) return toast('هذا الشكل لا يملك مساراً قابلاً للتتبع', 'warn');
    if (!this._textToStrokes) return toast('محرك النقش غير محمّل', 'error');

    const res = await ilPrompt('نص على مسار', [
      { key: 'text',    label: 'النص (لاتيني/أرقام)', type: 'text', def: 'DIQQAT QALAM' },
      { key: 'height',  label: 'ارتفاع الحرف (mm)', def: 8, min: 1 },
      { key: 'offset',  label: 'إزاحة البداية (mm)', def: 2, min: 0 },
      { key: 'gap',     label: 'تباعد إضافي (mm)', def: 1, min: 0 },
      { key: 'side',    label: 'الجهة', type: 'select', def: 'above', options: [
        { v: 'above', t: 'فوق المسار' }, { v: 'on', t: 'على المسار' }, { v: 'below', t: 'تحت المسار' }] },
      { key: 'remove',  label: 'حذف المسار بعد الإدراج', type: 'check', def: false },
    ]);
    if (!res || !res.text.trim()) return;

    const pts = path.closed ? [...path.points, path.points[0]] : path.points;
    const total = pathLen(pts);
    const h = Math.max(1, res.height);
    const lift = res.side === 'above' ? h * 0.15 : res.side === 'below' ? -(h * 1.15) : -h / 2;

    const baked = [];
    let cursor = Math.max(0, res.offset);
    let placed = 0;
    for (const ch of res.text) {
      if (ch === ' ') { cursor += h * 0.55; continue; }
      const glyph = this._textToStrokes(ch, h);
      if (!glyph.strokes.length) { cursor += h * 0.4; continue; }
      const w = glyph.width || h * 0.6;
      if (cursor + w > total) { toast(`المسار أقصر من النص — وُضع ${placed} حرفاً`, 'warn'); break; }
      const at = pointAt(pts, cursor + w / 2);
      if (!at) break;
      const cos = Math.cos(at.ang), sin = Math.sin(at.ang);
      // نقطة ارتكاز الحرف: منتصفه أفقياً على المسار + رفع عمودي حسب الجهة
      for (const st of glyph.strokes) {
        baked.push(st.map(p => {
          const lx = p.x - w / 2, ly = p.y + lift;
          return { x: at.x + lx * cos - ly * sin, y: at.y + lx * sin + ly * cos };
        }));
      }
      cursor += w + res.gap;
      placed++;
    }
    if (!baked.length) return toast('لا أحرف قابلة للنقش — المدعوم: حروف لاتينية وأرقام', 'warn');

    this._saveHistory();
    this.shapes.push({ type: 'text', text: res.text, height: h, x: 0, y: 0, width: 0, strokes: baked });
    if (res.remove) {
      const i = this.shapes.indexOf(base);
      if (i >= 0) this.shapes.splice(i, 1);
    }
    this.selectedIdx = this.shapes.length - 1;
    this.msel?.clear?.();
    this.render(); this._updateStatus?.(); this._updateShapeToolbar?.();
    toast(`✓ نُقش ${placed} حرفاً على المسار`, 'success');
  };

  /* ═══════════════ نص عمودي ═══════════════ */
  P.verticalType = async function () {
    if (!this._textToStrokes) return toast('محرك النقش غير محمّل', 'error');
    const res = await ilPrompt('نص عمودي', [
      { key: 'text',   label: 'النص (لاتيني/أرقام)', type: 'text', def: 'CNC' },
      { key: 'height', label: 'ارتفاع الحرف (mm)', def: 10, min: 1 },
      { key: 'gap',    label: 'فجوة بين الأحرف (mm)', def: 3, min: 0 },
    ]);
    if (!res || !res.text.trim()) return;
    const h = Math.max(1, res.height);
    // مركز العرض الحالي
    const r = this.canvas.getBoundingClientRect();
    const c = this._sToW(r.width / 2, r.height / 2);

    const baked = [];
    let y = c.y;
    let placed = 0;
    for (const ch of res.text) {
      if (ch === ' ') { y -= h * 0.7; continue; }
      const glyph = this._textToStrokes(ch, h);
      if (!glyph.strokes.length) { y -= h * 0.7; continue; }
      const w = glyph.width || h * 0.6;
      for (const st of glyph.strokes) {
        baked.push(st.map(p => ({ x: c.x + p.x - w / 2, y: y + p.y })));
      }
      y -= h + res.gap;
      placed++;
    }
    if (!baked.length) return toast('لا أحرف قابلة للنقش', 'warn');
    this._saveHistory();
    this.shapes.push({ type: 'text', text: res.text, height: h, x: 0, y: 0, width: 0, strokes: baked });
    this.selectedIdx = this.shapes.length - 1;
    this.render(); this._updateStatus?.(); this._updateShapeToolbar?.();
    toast(`✓ نص عمودي: ${placed} حرفاً`, 'success');
  };

  /* ═══════════════════════════════════════════════════════════════
     الأدوات التفاعلية
     ═══════════════════════════════════════════════════════════════ */
  const OWN = new Set(['magic-wand', 'shape-builder', 'reshape']);

  const origSetTool = P.setTool;
  P.setTool = function (t) {
    this._sbStroke = null; this._sbAlt = false; this._reshape = null;
    origSetTool.call(this, t);
  };

  const origOnDown = P._onDown;
  P._onDown = function (e) {
    const t = this.tool;

    // تحديد المجموعة: قبل المعالجة الأصلية نوسّع التحديد لكل أعضاء المجموعة
    if (t === 'select' && e.button === 0 && !e.altKey && !e.shiftKey) {
      const pt = this._evPt(e);
      const hit = this._hitTest(pt);
      if (hit >= 0 && this.shapes[hit].groupId) {
        const gid = this.shapes[hit].groupId;
        const members = [];
        this.shapes.forEach((s, i) => { if (s.groupId === gid) members.push(i); });
        if (members.length > 1) {
          this.msel = new Set(members);
          this.selectedIdx = hit;
        }
      }
    }

    if (!OWN.has(t)) return origOnDown.call(this, e);
    const pt = this._evPt(e);

    /* ── العصا السحرية ── */
    if (t === 'magic-wand') {
      const hit = this._hitTest(pt);
      if (hit < 0) { toast('انقر على شكل مرجعي', 'info'); return; }
      this.selectSame(hit, e.altKey);
      return;
    }

    /* ── منشئ الأشكال: ابدأ خط السحب ── */
    if (t === 'shape-builder') {
      this._sbStroke = [pt];
      this._sbAlt = e.altKey;
      this.isDrawing = true;
      return;
    }

    /* ── إعادة التشكيل: أمسك أقرب نقطة ── */
    if (t === 'reshape') {
      const hit = this._hitTest(pt);
      if (hit < 0) { toast('انقر على مسار', 'info'); return; }
      const s = this.shapes[hit];
      if (!Array.isArray(s.points) || s.points.length < 3) {
        toast('حوّل الشكل إلى مسار أولاً: كائن ← تحويل إلى مسار', 'warn');
        return;
      }
      let bi = 0, bd = Infinity;
      s.points.forEach((p, i) => { const d = dist(p, pt); if (d < bd) { bd = d; bi = i; } });
      const b = this._bounds(s);
      const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
      this._saveHistory();
      this._reshape = {
        si: hit, pi: bi, start: { ...pt },
        orig: s.points.map(p => ({ x: p.x, y: p.y })),
        R: Math.min(60, Math.max(4, diag * 0.2)),
      };
      this.selectedIdx = hit;
      this.render();
      return;
    }
  };

  const origOnMove = P._onMove;
  P._onMove = function (e) {
    const t = this.tool;
    if (!OWN.has(t)) return origOnMove.call(this, e);
    const r = this.canvas.getBoundingClientRect();
    const pt = this._snap(this._sToW(e.clientX - r.left, e.clientY - r.top));
    const ex = document.getElementById('cur-x'), ey = document.getElementById('cur-y');
    if (ex) ex.textContent = pt.x.toFixed(3);
    if (ey) ey.textContent = pt.y.toFixed(3);
    this.previewPt = pt;

    if (t === 'shape-builder' && this._sbStroke && e.buttons === 1) {
      const last = this._sbStroke[this._sbStroke.length - 1];
      if (dist(last, pt) > 0.5) this._sbStroke.push(pt);
      this.render();
      return;
    }
    if (t === 'reshape' && this._reshape && e.buttons === 1) {
      const rs = this._reshape;
      const s = this.shapes[rs.si];
      const dx = pt.x - rs.start.x, dy = pt.y - rs.start.y;
      const grab = rs.orig[rs.pi];
      const sigma = rs.R / 2;
      s.points = rs.orig.map((p) => {
        const d = dist(p, grab);
        const w = Math.exp(-(d * d) / (2 * sigma * sigma));
        return { ...p, x: p.x + dx * w, y: p.y + dy * w };
      });
      this.render();
      return;
    }
    this.render();
  };

  const origOnUp = P._onUp;
  P._onUp = function (e) {
    const t = this.tool;
    if (!OWN.has(t)) return origOnUp.call(this, e);

    if (t === 'reshape') { this._reshape = null; this.isDrawing = false; return; }

    if (t === 'shape-builder' && this._sbStroke) {
      const stroke = this._sbStroke;
      this._sbStroke = null;
      this.isDrawing = false;
      if (stroke.length < 2) { this.render(); return; }

      // الأشكال المغلقة التي يعبرها خط السحب
      const found = [];
      this.shapes.forEach((s, i) => {
        if (s.locked || s.disabled) return;
        const contours = this._shapeToContours ? this._shapeToContours(s) : null;
        if (!contours || !contours.length) return;
        const inside = stroke.some(p => contours.some(ring => inPoly(p, ring)));
        if (inside) found.push(i);
      });
      if (found.length < 2) {
        this.render();
        toast('اسحب خطاً يمر عبر شكلين مغلقين أو أكثر', 'info');
        return;
      }
      this.msel = new Set(found);
      this.selectedIdx = found[0];
      const op = this._sbAlt ? 'difference' : 'union';
      this.booleanOp(op);
      toast(this._sbAlt ? '⊖ طُرحت الأشكال' : '⊕ دُمجت الأشكال', 'success');
      return;
    }
  };

  /* ═══════════════ معاينات الرسم ═══════════════ */
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    const ctx = this.ctx;
    if (!ctx) return;

    // خط منشئ الأشكال
    if (this.tool === 'shape-builder' && this._sbStroke && this._sbStroke.length > 1) {
      ctx.save();
      ctx.strokeStyle = this._sbAlt ? '#f85149' : '#3fb950';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      this._sbStroke.forEach((p, i) => {
        const sp = this._wToS(p.x, p.y);
        i ? ctx.lineTo(sp.x, sp.y) : ctx.moveTo(sp.x, sp.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // دائرة نطاق إعادة التشكيل
    if (this.tool === 'reshape' && this.previewPt) {
      const rs = this._reshape;
      const R = rs ? rs.R : 20;
      const c = rs ? this.shapes[rs.si]?.points?.[rs.pi] : this.previewPt;
      if (c) {
        const sp = this._wToS(c.x, c.y);
        ctx.save();
        ctx.strokeStyle = 'rgba(88,166,255,.7)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, R * this.scale, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  /* ═══════════════ اختصارات ═══════════════ */
  document.addEventListener('keydown', (e) => {
    const ed = window.app?.editor;
    if (!ed) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyG') {
      e.preventDefault(); ed.groupSelected();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyG') {
      e.preventDefault(); ed.ungroupSelected();
    } else if (e.shiftKey && !e.ctrlKey && e.code === 'KeyM') {
      ed.setTool('shape-builder');
    } else if (e.shiftKey && !e.ctrlKey && e.code === 'KeyW') {
      ed.setTool('magic-wand');
    } else if (e.shiftKey && !e.ctrlKey && e.code === 'KeyR') {
      ed.setTool('reshape');
    }
  });
})();
