/**
 * tools-cnc-invent.js — 10 أدوات CNC مبتكرة خاصة بدقة قلم
 *
 *  تفاعلية (setTool):
 *    depth-paint  ← رسّام العمق: انقر الأشكال لتعيين عمق قطع مستقل لكل شكل (Alt = مسح)
 *    puzzle-joint ← مفصل الأحجية: نقرتان ترسمان خط تعشيق Jigsaw بعقد متبادلة
 *    clamp-zone   ← منطقة كلامب محظورة: اسحب مستطيلاً يمثل موضع مشبك التثبيت
 *
 *  عمليات (قوائم):
 *    dogboneCorners     ← تفريغ الزوايا الداخلية Dogbone/T-Bone لتعويض قطر الأداة
 *    cutFeasibility     ← فاحص القطع: يكتشف التفاصيل الأضيق من قطر الأداة
 *    autoNumberParts    ← ترقيم القطع تلقائياً بنقش رقم في مركز كل قطعة
 *    distributeOnPath   ← توزيع نسخ شكل على طول مسار (مع دوران المماس اختياراً)
 *    estimateCutTime    ← مقدّر زمن القطع: طول المسارات × الطبقات ÷ التغذية
 *    sheetUsageReport   ← تقرير استغلال اللوح: نسبة الاستفادة والهدر
 *    toggleKerfPreview  ← معاينة عرض القاطع: إظهار سماكة القطع الحقيقية
 *
 *  دعم المحرك: shared/GCodeGenerator.js يقرأ shape.maxDepth (عمق مخصص لكل شكل).
 *
 * يُحمَّل بعد tools-illustrator.js وقبل menu-bar.js.
 */
(function cncInventTools() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const toolDia = () => Math.max(0.1, parseFloat(document.getElementById('tool-diameter')?.value) || 3);

  // حوار عام — نفس نمط tools-illustrator
  function cvPrompt(title, fields) {
    return new Promise((resolve) => {
      let dlg = document.getElementById('dq-cv-dialog');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'dq-cv-dialog';
        dlg.style.cssText = 'border:1px solid #30363d;border-radius:12px;background:#0d1117;color:#e6edf3;padding:0;min-width:320px;z-index:9999';
        document.body.appendChild(dlg);
      }
      const inputCss = 'padding:6px 8px;border:1px solid #30363d;border-radius:6px;background:#161b22;color:#e6edf3';
      const rows = fields.map(f => {
        if (f.type === 'select') {
          const opts = f.options.map(o => `<option value="${o.v}"${o.v === f.def ? ' selected' : ''}>${o.t}</option>`).join('');
          return `<label style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0;font-size:13px"><span>${f.label}</span><select id="cv-f-${f.key}" style="${inputCss};width:150px">${opts}</select></label>`;
        }
        if (f.type === 'check') {
          return `<label style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0;font-size:13px"><span>${f.label}</span><input type="checkbox" id="cv-f-${f.key}"${f.def ? ' checked' : ''} style="width:18px;height:18px"></label>`;
        }
        if (f.type === 'info') {
          return `<div style="margin:8px 0;font-size:12px;color:#8b949e;line-height:1.6">${f.label}</div>`;
        }
        return `<label style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0;font-size:13px"><span>${f.label}</span><input type="number" id="cv-f-${f.key}" value="${f.def}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 'any'}" style="${inputCss};width:100px;text-align:center"></label>`;
      }).join('');
      dlg.innerHTML = `
        <div style="padding:18px 20px">
          <h3 style="margin:0 0 12px;font-size:15px;color:#58a6ff">${title}</h3>
          ${rows}
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button type="button" id="cv-cancel" style="padding:7px 16px;border:1px solid #30363d;border-radius:6px;background:#21262d;color:#e6edf3;cursor:pointer">إلغاء</button>
            <button type="button" id="cv-ok" style="padding:7px 16px;border:0;border-radius:6px;background:#238636;color:#fff;cursor:pointer;font-weight:600">تطبيق</button>
          </div>
        </div>`;
      let settled = false;
      const finish = (val) => {
        if (settled) return; settled = true;
        try { if (dlg.open) dlg.close(); } catch (_) {}
        resolve(val);
      };
      dlg.querySelector('#cv-ok').addEventListener('click', () => {
        const out = {};
        for (const f of fields) {
          if (f.type === 'info') continue;
          const el = document.getElementById(`cv-f-${f.key}`);
          if (f.type === 'check') out[f.key] = el.checked;
          else if (f.type === 'select') out[f.key] = el.value;
          else out[f.key] = parseFloat(el.value);
        }
        finish(out);
      });
      dlg.querySelector('#cv-cancel').addEventListener('click', () => finish(null));
      dlg.addEventListener('cancel', () => finish(null), { once: true });
      dlg.showModal();
    });
  }

  // تقرير نصي في حوار
  function cvReport(title, html) {
    let dlg = document.getElementById('dq-cv-report');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dq-cv-report';
      dlg.style.cssText = 'border:1px solid #30363d;border-radius:12px;background:#0d1117;color:#e6edf3;padding:0;min-width:340px;max-width:480px;z-index:9999';
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
      <div style="padding:18px 20px">
        <h3 style="margin:0 0 12px;font-size:15px;color:#58a6ff">${title}</h3>
        <div style="font-size:13px;line-height:1.9">${html}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px">
          <button type="button" id="cv-r-close" style="padding:7px 16px;border:0;border-radius:6px;background:#238636;color:#fff;cursor:pointer;font-weight:600">حسناً</button>
        </div>
      </div>`;
    dlg.querySelector('#cv-r-close').addEventListener('click', () => { try { dlg.close(); } catch (_) {} });
    dlg.showModal();
  }

  // رؤوس الشكل (زوايا حقيقية) — للمستطيل والمضلعات؛ المسارات الكثيفة تُرشَّح بالزاوية
  function cornersOf(ed, s) {
    let pts = null, closed = true;
    if (s.type === 'rect') {
      pts = [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }];
    } else if (Array.isArray(s.points) && (s.closed || s.type === 'polygon')) {
      pts = s.points;
    } else return null;
    if (!pts || pts.length < 3) return null;

    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n], c = pts[i], next = pts[(i + 1) % n];
      const d1 = dist(prev, c), d2 = dist(c, next);
      if (d1 < 1e-6 || d2 < 1e-6) continue;
      const u1 = { x: (prev.x - c.x) / d1, y: (prev.y - c.y) / d1 };
      const u2 = { x: (next.x - c.x) / d2, y: (next.y - c.y) / d2 };
      const dot = u1.x * u2.x + u1.y * u2.y;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI; // زاوية الرأس
      if (ang < 150) out.push({ c, u1, u2, ang });
    }
    return out.length ? out : null;
  }

  // طول محيط/مسار أي شكل
  function shapeLength(ed, s) {
    if (s.type === 'line') return dist({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
    if (s.type === 'circle') return 2 * Math.PI * s.r;
    const contours = ed._shapeToContours ? ed._shapeToContours(s) : null;
    if (contours && contours.length) {
      let L = 0;
      for (const ring of contours) {
        for (let i = 0; i < ring.length; i++) L += dist(ring[i], ring[(i + 1) % ring.length]);
      }
      return L;
    }
    const np = ed._toPath ? ed._toPath(s) : null;
    if (np && np.points) {
      let L = 0;
      for (let i = 1; i < np.points.length; i++) L += dist(np.points[i - 1], np.points[i]);
      if (np.closed) L += dist(np.points[np.points.length - 1], np.points[0]);
      return L;
    }
    if (s.type === 'text' && s.strokes) {
      let L = 0;
      for (const st of s.strokes) for (let i = 1; i < st.length; i++) L += dist(st[i - 1], st[i]);
      return L;
    }
    return 0;
  }

  function shoelace(ring) {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  /* ═══════════════ 1) تفريغ الزوايا Dogbone / T-Bone ═══════════════ */
  P.dogboneCorners = async function () {
    const idx = this._selIndices();
    if (!idx.length) return toast('حدد الفتحات الداخلية (مستطيل/مضلع مغلق) أولاً', 'warn');
    const res = await cvPrompt('تفريغ الزوايا Dogbone', [
      { key: 'info', type: 'info', label: 'يضيف دوائر تفريغ عند الزوايا الداخلية حتى تدخل القطعة المتعاشقة رغم استدارة القاطع. طبّقه على الفتحات لا على المحيط الخارجي.' },
      { key: 'dia', label: 'قطر الأداة (mm)', def: toolDia(), min: 0.1 },
      { key: 'style', label: 'النمط', type: 'select', def: 'dogbone', options: [
        { v: 'dogbone', t: 'Dogbone (قطري)' }, { v: 'tbone-h', t: 'T-Bone أفقي' }, { v: 'tbone-v', t: 'T-Bone رأسي' }] },
    ]);
    if (!res) return;
    const r = res.dia / 2;

    this._saveHistory();
    let added = 0, skipped = 0;
    for (const i of idx) {
      const corners = cornersOf(this, this.shapes[i]);
      if (!corners) { skipped++; continue; }
      for (const co of corners) {
        // مُنصّف الزاوية يشير إلى داخل الرأس؛ التفريغ يمتد خارجه (داخل الخامة)
        let bx = co.u1.x + co.u2.x, by = co.u1.y + co.u2.y;
        const bl = Math.hypot(bx, by) || 1;
        bx /= bl; by /= bl;
        let cx, cy;
        if (res.style === 'tbone-h') {
          const sx = Math.abs(co.u1.x) > Math.abs(co.u2.x) ? co.u1 : co.u2;
          cx = co.c.x + Math.sign(sx.x || 1) * r; cy = co.c.y;
        } else if (res.style === 'tbone-v') {
          const sy = Math.abs(co.u1.y) > Math.abs(co.u2.y) ? co.u1 : co.u2;
          cx = co.c.x; cy = co.c.y + Math.sign(sy.y || 1) * r;
        } else {
          cx = co.c.x - bx * (r / Math.SQRT2);
          cy = co.c.y - by * (r / Math.SQRT2);
        }
        this.shapes.push({ type: 'circle', cx, cy, r, maxDepth: this.shapes[i].maxDepth });
        added++;
      }
    }
    this.render(); this._updateStatus?.();
    toast(added ? `✓ ${added} دائرة تفريغ (⌀${res.dia}mm)` + (skipped ? ` — تخطّي ${skipped} شكلاً بلا زوايا` : '')
                : 'لا زوايا حادة في التحديد — يعمل على مستطيل/مضلع مغلق', added ? 'success' : 'warn');
  };

  /* ═══════════════ 2) فاحص القطع ═══════════════ */
  P.cutFeasibility = async function () {
    const res = await cvPrompt('فاحص قابلية القطع', [
      { key: 'info', type: 'info', label: 'يكتشف التفاصيل الأضيق من قطر الأداة: دوائر وفتحات صغيرة، وممرات ضيقة داخل المسارات — قبل أن تكتشفها الآلة.' },
      { key: 'dia', label: 'قطر الأداة (mm)', def: toolDia(), min: 0.05 },
    ]);
    if (!res) return;
    const dia = res.dia;
    const bad = new Map(); // idx -> سبب

    this.shapes.forEach((s, i) => {
      if (s.disabled || s.clampZone) return;
      if (s.type === 'circle' && 2 * s.r < dia) { bad.set(i, `دائرة ⌀${(2 * s.r).toFixed(1)} < ⌀ الأداة`); return; }
      if (s.type === 'slot' && 2 * s.r < dia) { bad.set(i, `فتحة عرضها ${(2 * s.r).toFixed(1)} < ⌀ الأداة`); return; }
      // ممرات ضيقة داخل المسار الواحد
      const pts = Array.isArray(s.points) ? s.points : null;
      if (pts && pts.length >= 8) {
        const step = Math.max(1, Math.floor(pts.length / 150));
        const sample = pts.filter((_, k) => k % step === 0);
        outer:
        for (let a = 0; a < sample.length; a++) {
          for (let b = a + 4; b < sample.length; b++) {
            if (s.closed && a === 0 && b >= sample.length - 4) continue;
            const d = dist(sample[a], sample[b]);
            if (d > 0 && d < dia * 0.95) { bad.set(i, `ممر ضيق ${d.toFixed(1)}mm < ⌀ الأداة`); break outer; }
          }
        }
      }
    });

    this._cncWarn = new Set(bad.keys());
    this.render();
    if (!bad.size) return cvReport('فاحص القطع ✓', `كل الأشكال قابلة للقطع بأداة ⌀${dia}mm — لا تفاصيل أضيق من القاطر.`);
    const rows = [...bad.entries()].slice(0, 12).map(([i, why]) =>
      `<div>• الشكل ${i + 1} (${this.shapes[i].type}): <span style="color:#f85149">${why}</span></div>`).join('');
    cvReport(`⚠ ${bad.size} مشكلة قطع`, rows + `<div style="margin-top:8px;color:#8b949e">المشاكل مُعلَّمة بالأحمر على الرسم. استخدم أداة أصغر أو كبّر التفاصيل.</div>`);
  };

  /* ═══════════════ 3) رسّام العمق (أداة تفاعلية) ═══════════════ */
  P._askPaintDepth = async function () {
    const total = +document.getElementById('total-depth')?.value || 5;
    const res = await cvPrompt('رسّام العمق', [
      { key: 'info', type: 'info', label: 'انقر الأشكال لتعيين هذا العمق لكل شكل على حدة (نقش سطحي هنا وقطع كامل هناك في ملف واحد). Alt+نقر يعيد الشكل للعمق العام.' },
      { key: 'depth', label: 'العمق (mm)', def: Math.min(2, total), min: 0.05 },
    ]);
    if (res && res.depth > 0) {
      this._paintDepth = res.depth;
      toast(`🖌 عمق الفرشاة: ${res.depth}mm — انقر الأشكال`, 'info');
    } else {
      this.setTool('select');
    }
  };

  /* ═══════════════ 4) مفصل الأحجية Jigsaw (أداة تفاعلية) ═══════════════ */
  P._buildPuzzleJoint = function (A, B) {
    const L = dist(A, B);
    if (L < 10) return null;
    const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;   // اتجاه الخط
    const nx = -uy, ny = ux;                              // العمودي
    const knobs = Math.max(1, Math.round(L / 45));
    const span = L / knobs;
    const r = Math.min(9, Math.max(2.5, span * 0.16));   // نصف قطر العقدة
    const w = r * 0.55;                                   // نصف عرض العنق
    const pts = [{ x: A.x, y: A.y }];
    const push = (t, off) => pts.push({ x: A.x + ux * t + nx * off, y: A.y + uy * t + ny * off });

    for (let k = 0; k < knobs; k++) {
      const side = k % 2 === 0 ? 1 : -1;                  // عقد متبادلة الجهات
      const c = (k + 0.5) * span;                          // مركز العقدة على الخط
      const bulb = 1.15 * r * side;                        // مركز الرأس
      push(c - w, 0);                                      // مدخل العنق
      // رأس الفطر: قوس طويل حول مركز الرأس يمر بقمة العقدة (يصنع التعشيق المُقفِل)
      const hB = -Math.sqrt(Math.max(0, r * r - w * w));   // ارتفاع تقاطع العنق مع الرأس (محلي)
      const a1 = Math.atan2(hB, -w);
      const a2 = Math.atan2(hB, w);
      const sweep = ((a2 - a1 + 2 * Math.PI) % (2 * Math.PI)) - 2 * Math.PI; // الطريق الطويل عبر القمة
      const steps = 22;
      for (let s2 = 0; s2 <= steps; s2++) {
        const phi = a1 + (sweep * s2) / steps;
        push(c + r * Math.cos(phi), bulb + r * Math.sin(phi) * side);
      }
      push(c + w, 0);                                      // مخرج العنق
    }
    pts.push({ x: B.x, y: B.y });
    return { type: 'polyline', points: pts, closed: false };
  };

  /* ═══════════════ 5) ترقيم القطع تلقائياً ═══════════════ */
  P.autoNumberParts = async function () {
    if (!this._textToStrokes) return toast('محرك النقش غير محمّل', 'error');
    const closed = [];
    this.shapes.forEach((s, i) => {
      if (s.disabled || s.clampZone || s.type === 'text') return;
      const contours = this._shapeToContours ? this._shapeToContours(s) : null;
      if (contours && contours.length) closed.push(i);
    });
    if (!closed.length) return toast('لا قطع مغلقة للترقيم', 'warn');
    const res = await cvPrompt('ترقيم القطع تلقائياً', [
      { key: 'info', type: 'info', label: `سيُنقش رقم تسلسلي في مركز كل قطعة مغلقة (${closed.length} قطعة) — لا تضيع القطع بعد فكها من اللوح.` },
      { key: 'h', label: 'ارتفاع الرقم (mm)', def: 6, min: 1 },
      { key: 'depth', label: 'عمق النقش (mm)', def: 0.5, min: 0.05 },
    ]);
    if (!res) return;
    this._saveHistory();
    let n = 0;
    for (const i of closed) {
      n++;
      const b = this._bounds(this.shapes[i]);
      const glyph = this._textToStrokes(String(n), res.h);
      if (!glyph.strokes.length) continue;
      this.shapes.push({
        type: 'text', text: String(n), height: res.h,
        x: (b.minX + b.maxX) / 2 - glyph.width / 2,
        y: (b.minY + b.maxY) / 2 - res.h / 2,
        width: glyph.width, strokes: glyph.strokes,
        maxDepth: res.depth,
      });
    }
    this.render(); this._updateStatus?.();
    toast(`✓ رُقّمت ${n} قطعة بعمق نقش ${res.depth}mm`, 'success');
  };

  /* ═══════════════ 6) توزيع على مسار ═══════════════ */
  P.distributeOnPath = async function () {
    const idx = this._selIndices();
    if (idx.length !== 2) return toast('حدد شكلين: المسار + الشكل المراد تكراره', 'warn');
    // المسار = المفتوح منهما، وإلا الأول
    let pi = idx[0], si = idx[1];
    const isOpen = (s) => (Array.isArray(s.points) && !s.closed && s.type !== 'polygon') || ['line', 'arc'].includes(s.type);
    if (isOpen(this.shapes[idx[1]]) && !isOpen(this.shapes[idx[0]])) { pi = idx[1]; si = idx[0]; }

    const pathShape = this.shapes[pi], stamp = this.shapes[si];
    const np = Array.isArray(pathShape.points) && pathShape.points.length >= 2
      ? { points: pathShape.points, closed: !!pathShape.closed }
      : (this._toPath ? this._toPath(pathShape) : null);
    if (!np || !np.points || np.points.length < 2) return toast('تعذّر قراءة المسار', 'warn');

    const res = await cvPrompt('توزيع على مسار', [
      { key: 'n', label: 'عدد النسخ', def: 6, min: 2, max: 200, step: 1 },
      { key: 'rotate', label: 'دوران مع المماس', type: 'check', def: true },
      { key: 'ends', label: 'نسخ عند الطرفين', type: 'check', def: true },
    ]);
    if (!res) return;

    const pts = np.closed ? [...np.points, np.points[0]] : np.points;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
    if (total < 1e-6) return toast('المسار قصير جداً', 'warn');

    const N = Math.max(2, Math.round(res.n));
    const b = this._bounds(stamp);
    const scx = (b.minX + b.maxX) / 2, scy = (b.minY + b.maxY) / 2;

    this._saveHistory();
    for (let k = 0; k < N; k++) {
      const t = (np.closed || !res.ends) ? (k + 0.5) / N : k / (N - 1);
      let L = t * total, acc = 0, at = null;
      for (let i = 1; i < pts.length; i++) {
        const d = dist(pts[i - 1], pts[i]);
        if (acc + d >= L || i === pts.length - 1) {
          const u = d > 1e-9 ? Math.min(1, (L - acc) / d) : 0;
          at = {
            x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u,
            y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u,
            ang: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x),
          };
          break;
        }
        acc += d;
      }
      if (!at) continue;
      const clone = JSON.parse(JSON.stringify(stamp));
      delete clone.groupId;
      this._offsetShape(clone, at.x - scx, at.y - scy);
      if (res.rotate && this._rotateShape) this._rotateShape(clone, at.ang, at.x, at.y);
      this.shapes.push(clone);
    }
    this.render(); this._updateStatus?.();
    toast(`✓ وُزّعت ${N} نسخة على المسار`, 'success');
  };

  /* ═══════════════ 7) مقدّر زمن القطع ═══════════════ */
  P.estimateCutTime = async function () {
    const feedDef = +document.getElementById('feed-rate')?.value || 800;
    const totalDef = +document.getElementById('total-depth')?.value || 5;
    const passDef = +document.getElementById('pass-depth')?.value || 1;
    const res = await cvPrompt('مقدّر زمن القطع', [
      { key: 'feed', label: 'التغذية XY (mm/min)', def: feedDef, min: 10 },
      { key: 'total', label: 'العمق الكلي (mm)', def: totalDef, min: 0.1 },
      { key: 'pass', label: 'عمق الطبقة (mm)', def: passDef, min: 0.05 },
    ]);
    if (!res) return;

    let cutLen = 0, count = 0;
    this.shapes.forEach((s) => {
      if (s.disabled || s.clampZone) return;
      const L = shapeLength(this, s);
      if (L > 0) { count++; }
      const depth = s.maxDepth > 0 ? Math.min(s.maxDepth, res.total) : res.total;
      const passes = Math.max(1, Math.ceil(depth / res.pass));
      cutLen += L * passes;
    });
    if (!count) return toast('لا أشكال فعّالة', 'warn');

    const plunges = count * Math.ceil(res.total / res.pass);
    const zTime = plunges * (res.pass / 100);            // غرز بمتوسط 100mm/min
    const rapidTime = count * 2 * 0.02;                   // انتقالات تقريبية
    const cutTime = cutLen / res.feed;
    const totalMin = cutTime + zTime + rapidTime;
    const mm = Math.floor(totalMin), ss = Math.round((totalMin - mm) * 60);

    cvReport('⏱ تقدير زمن القطع', `
      <div>الأشكال الفعّالة: <b>${count}</b></div>
      <div>طول القطع (كل الطبقات): <b>${(cutLen / 1000).toFixed(2)} م</b></div>
      <div>زمن القطع: <b>${cutTime.toFixed(1)} دقيقة</b></div>
      <div>زمن الغرز والانتقالات: <b>${(zTime + rapidTime).toFixed(1)} دقيقة</b></div>
      <div style="margin-top:6px;font-size:15px">⏱ الإجمالي: <b style="color:#3fb950">${mm}:${String(ss).padStart(2, '0')} دقيقة</b></div>
      <div style="color:#8b949e;margin-top:6px">تقدير نظري — أضف 10-20% لتسارع/تباطؤ الآلة.</div>`);
  };

  /* ═══════════════ 8) تقرير استغلال اللوح ═══════════════ */
  P.sheetUsageReport = async function () {
    const active = this.shapes.filter(s => !s.disabled && !s.clampZone);
    if (!active.length) return toast('لا أشكال', 'warn');
    const res = await cvPrompt('استغلال اللوح', [
      { key: 'w', label: 'عرض اللوح (mm)', def: +document.getElementById('sheet-w')?.value || 600, min: 10 },
      { key: 'h', label: 'ارتفاع اللوح (mm)', def: +document.getElementById('sheet-h')?.value || 400, min: 10 },
    ]);
    if (!res) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, partArea = 0, parts = 0;
    for (const s of active) {
      const b = this._bounds(s);
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
      const contours = this._shapeToContours ? this._shapeToContours(s) : null;
      if (contours && contours.length) {
        parts++;
        // أكبر مسار = المحيط الخارجي؛ الباقي ثقوب تُطرح
        const areas = contours.map(r => Math.abs(shoelace(r)));
        const outer = Math.max(...areas);
        const holes = areas.reduce((t, a) => t + a, 0) - outer;
        partArea += Math.max(0, outer - holes);
      }
    }
    const sheetArea = res.w * res.h;
    const usedW = maxX - minX, usedH = maxY - minY;
    const bboxArea = usedW * usedH;
    const fit = usedW <= res.w && usedH <= res.h;

    cvReport('▦ استغلال اللوح', `
      <div>اللوح: <b>${res.w} × ${res.h} mm</b> (${(sheetArea / 1e6).toFixed(2)} م²)</div>
      <div>امتداد التصميم: <b>${usedW.toFixed(0)} × ${usedH.toFixed(0)} mm</b> ${fit ? '<span style="color:#3fb950">✓ يتّسع</span>' : '<span style="color:#f85149">✗ لا يتّسع!</span>'}</div>
      <div>القطع المغلقة: <b>${parts}</b></div>
      <div>مساحة القطع الفعلية: <b>${(partArea / 100).toFixed(1)} سم²</b></div>
      <div>استغلال اللوح: <b style="color:${partArea / sheetArea > 0.5 ? '#3fb950' : '#d29922'}">${(100 * partArea / sheetArea).toFixed(1)}%</b></div>
      <div>الهدر: <b>${(100 - 100 * partArea / sheetArea).toFixed(1)}%</b></div>
      <div style="color:#8b949e;margin-top:6px">لرفع الاستغلال جرّب: كائن ← رصف على الخامة.</div>`);
  };

  /* ═══════════════ 9) معاينة عرض القاطع Kerf ═══════════════ */
  P.toggleKerfPreview = function () {
    this._kerfPreview = !this._kerfPreview;
    this._kerfDia = toolDia();
    this.render();
    toast(this._kerfPreview ? `👁 معاينة عرض القاطع ⌀${this._kerfDia}mm — الهالة البرتقالية هي المادة المزالة` : 'أُخفيت معاينة القاطع', 'info');
  };

  /* ═══════════════ 10) مناطق الكلامب + فحص التصادم ═══════════════ */
  P.checkClampCollisions = function (silent) {
    const zones = [];
    this.shapes.forEach((s, i) => { if (s.clampZone) zones.push(i); });
    if (!zones.length) { if (!silent) toast('لا مناطق كلامب — ارسمها بأداة منطقة الكلامب', 'info'); return; }
    const hits = new Set();
    this.shapes.forEach((s, i) => {
      if (s.clampZone || s.disabled) return;
      const b = this._bounds(s);
      for (const zi of zones) {
        const z = this.shapes[zi];
        const zb = { minX: z.x, minY: z.y, maxX: z.x + z.w, maxY: z.y + z.h };
        if (b.minX < zb.maxX && b.maxX > zb.minX && b.minY < zb.maxY && b.maxY > zb.minY) { hits.add(i); break; }
      }
    });
    this._cncWarn = hits;
    this.render();
    if (hits.size) toast(`⚠ ${hits.size} شكلاً يمر فوق مشبك تثبيت — حرّكه أو حرّك المشبك!`, 'error');
    else if (!silent) toast('✓ لا تصادم مع مشابك التثبيت', 'success');
  };

  /* ═══════════════════════════════════════════════════════════════
     الأدوات التفاعلية
     ═══════════════════════════════════════════════════════════════ */
  const OWN = new Set(['depth-paint', 'puzzle-joint', 'clamp-zone']);

  const origSetTool = P.setTool;
  P.setTool = function (t) {
    this._puzzleA = null; this._clampA = null;
    origSetTool.call(this, t);
    if (t === 'depth-paint' && !(this._paintDepth > 0)) this._askPaintDepth();
  };

  const origOnDown = P._onDown;
  P._onDown = function (e) {
    const t = this.tool;
    if (!OWN.has(t)) return origOnDown.call(this, e);
    const pt = this._evPt(e);

    /* ── رسّام العمق ── */
    if (t === 'depth-paint') {
      if (e.button === 2) { this._askPaintDepth(); return; }
      const hit = this._hitTest(pt);
      if (hit < 0) return;
      this._saveHistory();
      const s = this.shapes[hit];
      if (e.altKey) {
        delete s.maxDepth;
        toast('عاد الشكل للعمق العام', 'info');
      } else {
        s.maxDepth = this._paintDepth || 2;
        toast(`✓ عمق الشكل: ${s.maxDepth}mm`, 'success');
      }
      this.render();
      return;
    }

    /* ── مفصل الأحجية ── */
    if (t === 'puzzle-joint') {
      if (e.button === 2) { this._puzzleA = null; this.render(); return; }
      if (!this._puzzleA) {
        this._puzzleA = pt;
        this.isDrawing = true;
        toast('النقرة الثانية تحدد نهاية خط التعشيق', 'info');
      } else {
        const joint = this._buildPuzzleJoint(this._puzzleA, pt);
        this._puzzleA = null;
        this.isDrawing = false;
        if (joint) {
          this._saveHistory();
          this.shapes.push(joint);
          toast('🧩 خط تعشيق أحجية — اقطعه ليقسم اللوح لقطعتين متعاشقتين', 'success');
        } else toast('الخط قصير جداً (< 10mm)', 'warn');
        this.render(); this._updateStatus?.();
      }
      return;
    }

    /* ── منطقة الكلامب: ابدأ السحب ── */
    if (t === 'clamp-zone') {
      this._clampA = pt;
      this.isDrawing = true;
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
    this.render();
  };

  const origOnUp = P._onUp;
  P._onUp = function (e) {
    const t = this.tool;
    if (!OWN.has(t)) return origOnUp.call(this, e);

    if (t === 'clamp-zone' && this._clampA) {
      const b = this._evPt(e);
      const a = this._clampA;
      this._clampA = null;
      this.isDrawing = false;
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (w < 2 || h < 2) { this.render(); return; }
      this._saveHistory();
      this.shapes.push({
        type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h,
        clampZone: true, disabled: true,
      });
      this.render();
      this.checkClampCollisions(true);
      toast('🗜 منطقة كلامب — لن تدخل G-Code، وستحذَّر إن مرّ فوقها مسار', 'success');
      return;
    }
  };

  /* ═══════════════ طبقات العرض ═══════════════ */
  const origRender = P.render;
  P.render = function () {
    origRender.call(this);
    const ctx = this.ctx;
    if (!ctx) return;

    // معاينة عرض القاطع
    if (this._kerfPreview && this._kerfDia > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,170,0,.32)';
      ctx.lineWidth = Math.max(1, this._kerfDia * this.scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of this.shapes) {
        if (s.disabled || s.clampZone) continue;
        const rings = this._shapeToContours ? this._shapeToContours(s) : null;
        const paths = rings && rings.length ? rings.map(r2 => ({ pts: r2, closed: true })) : null;
        const open = !paths && this._toPath ? this._toPath(s) : null;
        const list = paths || (open && open.points ? [{ pts: open.points, closed: !!open.closed }] : []);
        for (const pth of list) {
          ctx.beginPath();
          pth.pts.forEach((p, i) => {
            const sp = this._wToS(p.x, p.y);
            i ? ctx.lineTo(sp.x, sp.y) : ctx.moveTo(sp.x, sp.y);
          });
          if (pth.closed) ctx.closePath();
          ctx.stroke();
        }
        if (s.type === 'text' && s.strokes) {
          for (const st of s.strokes) {
            ctx.beginPath();
            st.forEach((p, i) => {
              const sp = this._wToS(s.x + p.x, s.y + p.y);
              i ? ctx.lineTo(sp.x, sp.y) : ctx.moveTo(sp.x, sp.y);
            });
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // مناطق الكلامب — تظليل أحمر مخطط
    for (const s of this.shapes) {
      if (!s.clampZone) continue;
      const a = this._wToS(s.x, s.y + s.h), b = this._wToS(s.x + s.w, s.y);
      ctx.save();
      ctx.fillStyle = 'rgba(248,81,73,.12)';
      ctx.strokeStyle = 'rgba(248,81,73,.8)';
      ctx.setLineDash([7, 4]);
      ctx.lineWidth = 1.5;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.fillStyle = 'rgba(248,81,73,.85)';
      ctx.font = '11px sans-serif';
      ctx.fillText('🗜 كلامب', a.x + 5, a.y + 15);
      ctx.restore();
    }

    // تحذيرات فاحص القطع/الكلامب
    if (this._cncWarn && this._cncWarn.size) {
      ctx.save();
      ctx.strokeStyle = 'rgba(248,81,73,.9)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 3]);
      for (const i of this._cncWarn) {
        const s = this.shapes[i];
        if (!s) continue;
        const bb = this._bounds(s);
        const a = this._wToS(bb.minX, bb.maxY), b = this._wToS(bb.maxX, bb.minY);
        ctx.strokeRect(a.x - 4, a.y - 4, b.x - a.x + 8, b.y - a.y + 8);
      }
      ctx.restore();
    }

    // شارات العمق المخصص
    let hasDepth = false;
    for (const s of this.shapes) {
      if (!(s.maxDepth > 0)) continue;
      hasDepth = true;
      const bb = this._bounds(s);
      const c = this._wToS((bb.minX + bb.maxX) / 2, bb.maxY);
      ctx.save();
      ctx.fillStyle = '#1f6feb';
      ctx.strokeStyle = '#0d1117';
      const label = s.maxDepth + 'mm';
      ctx.font = 'bold 10px sans-serif';
      const tw = ctx.measureText(label).width + 10;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(c.x - tw / 2, c.y - 22, tw, 15, 4) : ctx.rect(c.x - tw / 2, c.y - 22, tw, 15);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, c.x - tw / 2 + 5, c.y - 11);
      ctx.restore();
    }

    // معاينة مفصل الأحجية
    if (this.tool === 'puzzle-joint' && this._puzzleA && this.previewPt) {
      const joint = this._buildPuzzleJoint(this._puzzleA, this.previewPt);
      if (joint) {
        ctx.save();
        ctx.strokeStyle = 'rgba(63,185,80,.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        joint.points.forEach((p, i) => {
          const sp = this._wToS(p.x, p.y);
          i ? ctx.lineTo(sp.x, sp.y) : ctx.moveTo(sp.x, sp.y);
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    // معاينة منطقة الكلامب أثناء السحب
    if (this.tool === 'clamp-zone' && this._clampA && this.previewPt) {
      const a = this._wToS(this._clampA.x, this._clampA.y);
      const b = this._wToS(this.previewPt.x, this.previewPt.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(248,81,73,.8)';
      ctx.setLineDash([7, 4]);
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }
  };
})();
