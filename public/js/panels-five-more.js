/**
 * panels-five-more.js — خمس لوحات إضافية + أداة التصغير
 *
 *   القياسات      — أبعاد التحديد ومحيطه ومساحته وزمن قطعه المقدَّر، وتحرير مباشر.
 *   سجلّ التراجع  — كل خطوة في المشروع مسرودة، والقفز إلى أيّها بنقرة.
 *   الخامة والأداة — الخامة وسمكها وقطر الرأس، مع سرعات موصى بها محسوبة.
 *   التصدير السريع — G-Code · SVG · DXF · صورة، بزرّ واحد لكلّ.
 *   المفاتيح       — كل اختصارات التطبيق مسرودة وقابلة للبحث.
 *
 * وأداة تصغير مستقلّة في شريط الأدوات (كانت مدفونة خلف Alt+نقر).
 *
 * كل زرّ ينادي واجهة موجودة — اللوحة عرضٌ لا محرّك.
 */
(function panelsFiveMore() {
  'use strict';

  const ed = () => window.app && window.app.editor;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };
  const sel = () => { const e = ed(); return e && e._selIndices ? e._selIndices() : []; };

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function btn(label, title, fn, cls) {
    const b = el('button', 'dqp-b' + (cls ? ' ' + cls : ''), label);
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  }
  function sec(title, ...kids) {
    const s = el('div', 'dqp-sec');
    s.appendChild(el('div', 'dqp-h', `<span>${title}</span>`));
    kids.forEach(k => k && s.appendChild(k));
    return s;
  }
  const hint = t => el('div', 'dqp-hint', t);
  function kv(k, v) { const r = el('div', 'dqpi-kv'); r.innerHTML = `<span>${k}</span><b>${v}</b>`; return r; }

  function injectCSS() {
    if (document.getElementById('dqp5m-css')) return;
    const s = el('style'); s.id = 'dqp5m-css';
    s.textContent = `
      .p5-num{width:100%;height:26px;border-radius:5px;background:var(--bg1,#0d1117);
        border:1px solid var(--border,#30363d);color:var(--text,#e6edf3);font-family:inherit;
        font-size:11.5px;padding:0 6px;text-align:center}
      .p5-num:focus{outline:2px solid var(--accent,#4f6ef7);outline-offset:-1px;border-color:transparent}
      .p5-lab{font-size:10px;color:var(--text3,#8b949e);text-align:center;padding-bottom:2px}
      .p5-hist{display:flex;flex-direction:column;gap:2px;max-height:230px;overflow:auto}
      .p5-step{display:flex;align-items:center;gap:6px;padding:4px 7px;border-radius:5px;
        font-size:11px;color:var(--text3,#8b949e);cursor:pointer;border:1px solid transparent}
      .p5-step:hover{background:var(--bg3,#1c2128);color:var(--text,#e6edf3)}
      .p5-step.now{border-color:var(--accent,#4f6ef7);color:var(--accent-h,#58a6ff);
        background:color-mix(in srgb,var(--accent,#4f6ef7) 12%,transparent)}
      .p5-step.future{opacity:.42}
      .p5-step i{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}
      .p5-keys{display:flex;flex-direction:column;gap:1px;max-height:300px;overflow:auto}
      .p5-key{display:flex;justify-content:space-between;align-items:center;gap:8px;
        padding:4px 7px;border-radius:5px;font-size:11px;color:var(--text2,#b1bac4)}
      .p5-key:nth-child(odd){background:color-mix(in srgb,var(--bg3,#1c2128) 60%,transparent)}
      .p5-key kbd{font-family:ui-monospace,monospace;font-size:10px;background:var(--bg1,#0d1117);
        border:1px solid var(--border2,#3d444d);border-bottom-width:2px;border-radius:4px;
        padding:1px 5px;color:var(--text,#e6edf3);white-space:nowrap;flex:0 0 auto}
      .p5-search{width:100%;height:27px;border-radius:6px;background:var(--bg1,#0d1117);
        border:1px solid var(--border,#30363d);color:var(--text,#e6edf3);
        font-family:inherit;font-size:11.5px;padding:0 8px;margin-bottom:6px}
      .p5-bar{height:6px;border-radius:3px;background:var(--bg1,#0d1117);overflow:hidden;margin-top:4px}
      .p5-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent,#4f6ef7),var(--accent-h,#6b86ff));
        transition:width .25s cubic-bezier(.22,1,.36,1)}
    `;
    document.head.appendChild(s);
  }

  /* ═══════════════ ١) القياسات ═══════════════ */
  function buildMeasure() {
    const p = el('div', 'dqp');
    const info = el('div');
    const grid = el('div', 'dqpi-grid dqpi-g2');
    const fields = {};

    ['x', 'y', 'w', 'h'].forEach(k => {
      const wrap = el('div');
      wrap.appendChild(el('div', 'p5-lab', { x: 'س (mm)', y: 'ص (mm)', w: 'العرض', h: 'الارتفاع' }[k]));
      const i = el('input', 'p5-num'); i.type = 'number'; i.step = '0.1';
      i.title = { x: 'موضع س', y: 'موضع ص', w: 'العرض', h: 'الارتفاع' }[k];
      i.setAttribute('aria-label', i.title);
      fields[k] = i;
      wrap.appendChild(i);
      grid.appendChild(wrap);
      i.addEventListener('change', () => apply(k, +i.value));
    });

    /** يطبّق قيمة على التحديد: الموضع بالإزاحة، والقياس بالتحجيم النسبيّ */
    function apply(k, v) {
      const e = ed(); const idx = sel();
      if (!e || !idx.length || !isFinite(v)) return;
      const b = box(); if (!b) return;
      e._saveHistory();
      if (k === 'x' || k === 'y') {
        const d = k === 'x' ? v - b.minX : v - b.minY;
        idx.forEach(i => e._offsetShape(e.shapes[i], k === 'x' ? d : 0, k === 'x' ? 0 : d));
      } else {
        const cur = k === 'w' ? (b.maxX - b.minX) : (b.maxY - b.minY);
        if (cur <= 0 || v <= 0) return;
        const f = v / cur;
        const M = window.DQMapShape;
        if (!M) return toast('تحجيم غير متاح', 'warn');
        idx.forEach(i => M(e.shapes[i], (x, y) => ({
          x: k === 'w' ? b.minX + (x - b.minX) * f : x,
          y: k === 'h' ? b.minY + (y - b.minY) * f : y,
        })));
      }
      e.render(); e._updateStatus?.(); sync();
      toast(`✓ ${{ x: 'موضع س', y: 'موضع ص', w: 'العرض', h: 'الارتفاع' }[k]} = ${v}mm`, 'success');
    }

    function box() {
      const e = ed(); const idx = sel();
      if (!e || !idx.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      idx.forEach(i => { const b = e._bounds(e.shapes[i]); if (!b) return;
        minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
        minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY); });
      return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    }

    /** محيط الشكل ومساحته من مسارات مغلقة — نفس مصدر العمليات المنطقية */
    function metrics() {
      const e = ed(); const idx = sel();
      let per = 0, area = 0, pts = 0;
      idx.forEach(i => {
        const c = e._shapeToContours ? e._shapeToContours(e.shapes[i]) : null;
        if (!c) return;
        c.forEach(r => {
          pts += r.length;
          let a = 0;
          for (let k = 0; k < r.length; k++) {
            const q = r[k], n = r[(k + 1) % r.length];
            per += Math.hypot(n.x - q.x, n.y - q.y);
            a += q.x * n.y - n.x * q.y;
          }
          area += Math.abs(a / 2);
        });
      });
      return { per, area, pts };
    }

    function sync() {
      const e = ed(); const idx = sel();
      info.innerHTML = '';
      if (!e || !idx.length) {
        info.appendChild(el('div', 'dqpi-empty', 'لا تحديد'));
        Object.values(fields).forEach(i => { i.value = ''; i.disabled = true; });
        return;
      }
      Object.values(fields).forEach(i => i.disabled = false);
      const b = box(); if (!b) return;
      const W = b.maxX - b.minX, H = b.maxY - b.minY;
      if (document.activeElement !== fields.x) fields.x.value = b.minX.toFixed(2);
      if (document.activeElement !== fields.y) fields.y.value = b.minY.toFixed(2);
      if (document.activeElement !== fields.w) fields.w.value = W.toFixed(2);
      if (document.activeElement !== fields.h) fields.h.value = H.toFixed(2);
      const m = metrics();
      // الزمن المقدَّر: طول المسار ÷ سرعة التغذية، × عدد طبقات العمق
      const feed = +document.getElementById('feed-rate-xy')?.value || 1000;
      const tot = +document.getElementById('total-depth')?.value || 5;
      const pass = +document.getElementById('pass-depth')?.value || 1;
      const layers = Math.max(1, Math.ceil(tot / pass));
      const mins = feed > 0 ? (m.per * layers) / feed : 0;
      info.append(
        kv('عدد الأشكال', idx.length),
        kv('الأبعاد', `${W.toFixed(2)} × ${H.toFixed(2)} mm`),
        kv('القطر القُطري', Math.hypot(W, H).toFixed(2) + ' mm'),
        kv('المحيط', m.per.toFixed(1) + ' mm'),
        kv('المساحة', m.area.toFixed(1) + ' mm²'),
        kv('نقاط المسار', m.pts),
        kv('طبقات العمق', layers),
        kv('زمن القطع ≈', mins < 1 ? `${Math.round(mins * 60)} ثانية` : `${mins.toFixed(1)} دقيقة`),
      );
    }

    const acts = el('div', 'dqpi-grid dqpi-g2');
    acts.append(
      btn('توسيط أفقي', 'يضع التحديد في وسط اللوح أفقياً', () => center('x')),
      btn('توسيط رأسي', 'يضع التحديد في وسط اللوح رأسياً', () => center('y')),
    );
    function center(ax) {
      const e = ed(); const idx = sel(); const b = box();
      if (!e || !idx.length || !b) return toast('حدّد شكلاً أولاً', 'warn');
      const a = e._artboards ? e._artboards[e._abActive || 0] : { x: 0, y: 0, w: e.workW || 300, h: e.workH || 200 };
      e._saveHistory();
      const d = ax === 'x' ? (a.x + a.w / 2) - (b.minX + b.maxX) / 2 : (a.y + a.h / 2) - (b.minY + b.maxY) / 2;
      idx.forEach(i => e._offsetShape(e.shapes[i], ax === 'x' ? d : 0, ax === 'x' ? 0 : d));
      e.render(); sync();
      toast('✓ توسيط', 'success');
    }

    p.append(sec('الموضع والقياس', grid, hint('اكتب قيمة واضغط Enter لتطبيقها على التحديد.')),
             sec('القياسات', info), sec('إجراءات', acts));
    return { el: p, sync };
  }

  /* ═══════════════ ٢) سجلّ التراجع ═══════════════ */
  function buildHistory() {
    const p = el('div', 'dqp');
    const list = el('div', 'p5-hist');
    const meta = el('div');

    /* مصدر الحقيقة هو مدير الأوامر (`ed.commands`) حين يكون مفعَّلاً؛
       أما `ed.history`/`ed.redoStack` فهما مسار اللقطات القديم. نقرأ
       الأطول منهما فلا تختفي الخطوات إذا تغيّر المسار المستعمل. */
    function stacks() {
      const e = ed();
      if (!e) return { undo: [], redo: [] };
      const c = e.commands;
      const a = { undo: (c && c.undoStack) || [], redo: (c && c.redoStack) || [] };
      const b = { undo: e.history || [], redo: e.redoStack || [] };
      return (a.undo.length + a.redo.length) >= (b.undo.length + b.redo.length) ? a : b;
    }

    function sync() {
      const e = ed();
      list.innerHTML = ''; meta.innerHTML = '';
      if (!e) return;
      const { undo, redo } = stacks();
      const total = undo.length + redo.length;
      const counters = () => {
        meta.append(
          kv('يمكن التراجع', undo.length),
          kv('يمكن الإعادة', redo.length),
          kv('عدد الأشكال', e.shapes.length),
        );
        const bar = el('div', 'p5-bar');
        const fill = el('i');
        fill.style.width = (total ? (undo.length / total * 100) : 0) + '%';
        bar.appendChild(fill); meta.appendChild(bar);
      };
      // العدّادات تظهر دائماً — حتى قبل أول تعديل — وإلّا بدا القسم معطّلاً
      if (!total) { list.appendChild(el('div', 'dqpi-empty', 'لا خطوات بعد')); counters(); return; }

      /* الخطوة i في `history` لقطةٌ **قبل** التعديل رقم i، فعددها = عدد
         التراجعات الممكنة. الحالة الراهنة تلي آخرها، وما في redoStack أمامها. */
      const row = (label, cls, onClick) => {
        const r = el('div', 'p5-step' + (cls ? ' ' + cls : ''));
        r.append(el('i'), el('span', '', label));
        if (onClick) { r.addEventListener('click', onClick); r.title = 'اقفز إلى هذه الحالة'; }
        else r.style.cursor = 'default';
        list.appendChild(r);
      };
      row(`البداية`, '', () => jump(-undo.length));
      undo.forEach((_, i) => {
        const back = undo.length - 1 - i;          // كم تراجعاً يلزم للوصول
        row(`خطوة ${i + 1}`, '', () => jump(-back));
      });
      row(`◀ الحالة الآن (${undo.length} خطوة)`, 'now');
      redo.forEach((_, i) => row(`إعادة ${i + 1}`, 'future', () => jump(i + 1)));
      counters();
    }

    /** n<0 تراجع |n| مرّة · n>0 إعادة n مرّة — عبر واجهات المحرّر ذاتها */
    function jump(n) {
      const e = ed(); if (!e) return;
      const step = n < 0 ? () => e.undo?.() : () => e.redo?.();
      for (let i = 0; i < Math.abs(n); i++) step();
      e.render(); sync();
      toast(n < 0 ? `↶ تراجع ${Math.abs(n)}` : `↷ إعادة ${n}`, 'info');
    }

    const acts = el('div', 'dqpi-grid dqpi-g2');
    acts.append(
      btn('تراجع', 'Ctrl+Z', () => jump(-1)),
      btn('إعادة', 'Ctrl+Y', () => jump(1)),
    );

    p.append(sec('الخطوات', list), sec('الحالة', meta), sec('تحكّم', acts),
             hint('النقر على أي خطوة يقفز إليها مباشرةً.'));
    return { el: p, sync };
  }

  /* ═══════════════ ٣) الخامة والأداة ═══════════════ */
  function buildMaterial() {
    const p = el('div', 'dqp');

    /* سرعات قصّ إرشادية (m/min للسطح، وتغذية لكل سنّ بالمليمتر) —
       قيم محافظة تصلح لرؤوس الكربيد على ماكينات الهواة. */
    const MATERIALS = {
      mdf:      { name: 'MDF',          vc: 300, fz: 0.06, depth: 1.5 },
      plywood:  { name: 'أبلكاش',       vc: 260, fz: 0.05, depth: 1.2 },
      hardwood: { name: 'خشب صلب',      vc: 200, fz: 0.04, depth: 1.0 },
      softwood: { name: 'خشب لَيّن',     vc: 320, fz: 0.07, depth: 2.0 },
      acrylic:  { name: 'أكريليك',      vc: 180, fz: 0.05, depth: 1.0 },
      pvc:      { name: 'PVC',          vc: 220, fz: 0.06, depth: 1.5 },
      aluminum: { name: 'ألمنيوم',      vc: 120, fz: 0.025, depth: 0.4 },
      brass:    { name: 'نحاس أصفر',    vc: 90,  fz: 0.02, depth: 0.3 },
      foam:     { name: 'فوم',          vc: 400, fz: 0.10, depth: 4.0 },
    };

    const pick = el('select');
    pick.style.cssText = 'width:100%;height:28px;border-radius:6px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);font-family:inherit;font-size:11.5px';
    pick.title = 'الخامة'; pick.setAttribute('aria-label', 'الخامة');
    Object.entries(MATERIALS).forEach(([k, v]) => {
      const o = el('option'); o.value = k; o.textContent = v.name; pick.appendChild(o);
    });

    const fluteWrap = el('div');
    fluteWrap.appendChild(el('div', 'p5-lab', 'عدد الأسنان'));
    const flutes = el('input', 'p5-num'); flutes.type = 'number'; flutes.value = '2';
    flutes.min = '1'; flutes.max = '8'; flutes.title = 'عدد أسنان الرأس';
    flutes.setAttribute('aria-label', 'عدد أسنان الرأس');
    fluteWrap.appendChild(flutes);

    const out = el('div');

    function calc() {
      const m = MATERIALS[pick.value];
      const d = +document.getElementById('tool-diameter')?.value || 3;
      const z = Math.max(1, +flutes.value || 2);
      // n = vc·1000 / (π·d)  ·  vf = n·z·fz
      const rpm = Math.round((m.vc * 1000) / (Math.PI * d));
      const rpmClamped = Math.min(24000, Math.max(3000, rpm));
      const feed = Math.round(rpmClamped * z * m.fz);
      const doc = +(m.depth * (d / 3)).toFixed(2);
      out.innerHTML = '';
      out.append(
        kv('قطر الرأس', d + ' mm'),
        kv('سرعة القطع', m.vc + ' m/min'),
        kv('دوران مقترح', rpmClamped.toLocaleString('en') + ' RPM'),
        kv('تغذية مقترحة', feed.toLocaleString('en') + ' mm/min'),
        kv('عمق التمريرة', doc + ' mm'),
        kv('تغذية/سنّ', m.fz + ' mm'),
      );
      if (rpm > 24000 || rpm < 3000) {
        out.appendChild(hint(`الدوران النظري ${rpm.toLocaleString('en')} خارج مدى المغزل المعتاد — حُدَّ إلى ${rpmClamped.toLocaleString('en')}.`));
      }
      out.__vals = { rpm: rpmClamped, feed, doc };
    }
    pick.addEventListener('change', calc);
    flutes.addEventListener('input', calc);
    calc();

    const apply = btn('طبّق على الإعدادات', 'يكتب الدوران والتغذية وعمق التمريرة في إعدادات المشروع', () => {
      const v = out.__vals; if (!v) return;
      const set = (id, val) => {
        const e = document.getElementById(id);
        if (!e) return false;
        e.value = String(val);
        e.dispatchEvent(new Event('change', { bubbles: true }));
        e.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      };
      let n = 0;
      if (set('spindle-speed', v.rpm)) n++;
      if (set('feed-rate-xy', v.feed)) n++;
      if (set('feed-rate-z', Math.round(v.feed / 3))) n++;
      if (set('pass-depth', v.doc)) n++;
      toast(n ? `✓ طُبِّق ${n} إعداد` : 'تعذّر الوصول للإعدادات', n ? 'success' : 'warn');
    });

    p.append(sec('الخامة', pick, fluteWrap),
             sec('السرعات الموصى بها', out),
             sec('التطبيق', apply,
                 hint('قيم إرشادية لرؤوس الكربيد. ابدأ أبطأ ثمّ ارفع تدريجياً.')));
    return { el: p, sync: calc };
  }

  /* ═══════════════ ٤) التصدير السريع ═══════════════ */
  function buildExport() {
    const p = el('div', 'dqp');
    const info = el('div');

    const g = el('div', 'dqpi-grid dqpi-g2');
    const click = id => () => {
      const b = document.getElementById(id);
      if (!b) return toast('غير متاح', 'warn');
      b.click();
    };
    g.append(
      btn('توليد G-Code', 'يحوّل التصميم إلى كود CNC', click('btn-generate')),
      btn('تصدير…', 'حوار التصدير الكامل', click('btn-export')),
      btn('نسخ الكود', 'إلى الحافظة', click('btn-copy-gcode')),
      btn('تنزيل .nc', '', click('btn-dl-gcode')),
    );

    const g2 = el('div', 'dqpi-grid dqpi-g2');
    g2.append(
      btn('SVG', 'تصدير الأشكال كملفّ SVG', () => saveAs(toSVG(), 'design.svg', 'image/svg+xml')),
      btn('DXF', 'تصدير كملفّ DXF (خطوط)', () => saveAs(toDXF(), 'design.dxf', 'application/dxf')),
      btn('صورة PNG', 'لقطة للوحة الرسم', savePNG),
      btn('JSON', 'حفظ الأشكال كما هي', () => {
        const e = ed(); if (!e) return;
        saveAs(JSON.stringify({ shapes: e.shapes }, null, 1), 'design.json', 'application/json');
      }),
    );

    function saveAs(text, name, mime) {
      if (!text) return toast('لا شيء للتصدير', 'warn');
      const blob = new Blob([text], { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`✓ ${name}`, 'success');
    }

    /** يبني SVG من المسارات المغلقة — نفس مصدر العمليات المنطقية */
    function toSVG() {
      const e = ed(); if (!e || !e.shapes.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      e.shapes.forEach(s => { const b = e._bounds(s); if (!b) return;
        minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
        minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY); });
      if (!isFinite(minX)) return null;
      const W = maxX - minX, H = maxY - minY;
      const paths = [];
      e.shapes.forEach(s => {
        if (s.type === 'text' && Array.isArray(s.strokes)) {
          s.strokes.forEach(st => paths.push(
            `<polyline points="${st.map(p => `${(p.x - minX).toFixed(3)},${(p.y - minY).toFixed(3)}`).join(' ')}" fill="none" stroke="#000" stroke-width=".3"/>`));
          return;
        }
        const c = e._shapeToContours ? e._shapeToContours(s) : null;
        if (c) c.forEach(r => paths.push(
          `<polygon points="${r.map(p => `${(p.x - minX).toFixed(3)},${(p.y - minY).toFixed(3)}`).join(' ')}" fill="none" stroke="#000" stroke-width=".3"/>`));
        else if (s.type === 'line') paths.push(
          `<line x1="${(s.x1 - minX).toFixed(3)}" y1="${(s.y1 - minY).toFixed(3)}" x2="${(s.x2 - minX).toFixed(3)}" y2="${(s.y2 - minY).toFixed(3)}" stroke="#000" stroke-width=".3"/>`);
      });
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}mm" height="${H.toFixed(2)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">
${paths.join('\n')}
</svg>`;
    }

    /** DXF مبسّط بكيانات LWPOLYLINE — يفتحه AutoCAD وLibreCAD وFusion */
    function toDXF() {
      const e = ed(); if (!e || !e.shapes.length) return null;
      const L = ['0', 'SECTION', '2', 'ENTITIES'];
      const poly = (pts, closed) => {
        L.push('0', 'LWPOLYLINE', '8', '0', '90', String(pts.length), '70', closed ? '1' : '0');
        pts.forEach(p => L.push('10', p.x.toFixed(4), '20', (-p.y).toFixed(4)));
      };
      e.shapes.forEach(s => {
        if (s.type === 'text' && Array.isArray(s.strokes)) { s.strokes.forEach(st => poly(st, false)); return; }
        if (s.type === 'line') { poly([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], false); return; }
        const c = e._shapeToContours ? e._shapeToContours(s) : null;
        if (c) c.forEach(r => poly(r, true));
        else if (s.points) poly(s.points, !!s.closed);
      });
      L.push('0', 'ENDSEC', '0', 'EOF');
      return L.join('\r\n');
    }

    function savePNG() {
      const e = ed(); if (!e) return;
      try {
        e.canvas.toBlob(b => {
          if (!b) return toast('تعذّرت اللقطة', 'error');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = 'design.png';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          toast('✓ design.png', 'success');
        }, 'image/png');
      } catch (err) { toast('تعذّرت اللقطة: ' + err.message, 'error'); }
    }

    function sync() {
      const e = ed(); info.innerHTML = '';
      if (!e) return;
      const closed = e.shapes.filter(s => e._shapeToContours && e._shapeToContours(s)).length;
      info.append(
        kv('أشكال المشروع', e.shapes.length),
        kv('مسارات مغلقة', closed),
        kv('مفتوحة/خطوط', e.shapes.length - closed),
        kv('محدَّد', sel().length),
      );
    }

    p.append(sec('المشروع', info), sec('G-Code', g), sec('صيغ أخرى', g2),
             hint('SVG وDXF يصدّران كل الأشكال — لا التحديد وحده.'));
    return { el: p, sync };
  }

  /* ═══════════════ ٥) المفاتيح ═══════════════ */
  function buildKeys() {
    const p = el('div', 'dqp');
    const search = el('input', 'p5-search');
    search.type = 'search'; search.placeholder = 'ابحث عن اختصار…';
    search.title = 'بحث في الاختصارات'; search.setAttribute('aria-label', 'بحث في الاختصارات');
    const list = el('div', 'p5-keys');

    const KEYS = [
      ['V', 'أداة التحديد'], ['A', 'التحديد المباشر (العقد)'], ['P', 'القلم'],
      ['M', 'مستطيل'], ['L', 'دائرة'], ['\\', 'خطّ'], ['T', 'نصّ'],
      ['H', 'يد التحريك'], ['Z', 'تكبير'], ['Alt + نقر بالتكبير', 'تصغير'],
      ['مسافة (مضغوطة)', 'يد مؤقّتة'], ['Esc', 'العودة لأداة التحديد'],
      ['Ctrl + Z', 'تراجع'], ['Ctrl + Y', 'إعادة'],
      ['Ctrl + A', 'تحديد الكلّ'], ['Ctrl + C / V', 'نسخ / لصق'],
      ['Ctrl + D', 'تكرار'], ['Delete', 'حذف'],
      ['Ctrl + G', 'تجميع'], ['Ctrl + Shift + G', 'فكّ التجميع'],
      ['Ctrl + 7', 'قناع قصّ'], ['Alt + Ctrl + 7', 'فكّ القناع'],
      ['Ctrl + 8', 'مسار مركّب'], ['Alt + Ctrl + 8', 'فكّ المركّب'],
      ['Ctrl + J', 'ربط / إغلاق المسار'], ['Ctrl + H', 'بحث واستبدال'],
      ['Shift + W', 'أداة العرض المتغيّر'], ['Alt + Ctrl + W', 'تشويه الغلاف'],
      ['Shift + P', 'شبكة المنظور'], ['Shift + O', 'لوح فنّ'],
      ['Shift + S', 'رشّاش الرموز'], ['Shift + M', 'منشئ الأشكال'],
      ['Shift + R', 'إعادة التشكيل'], ['Shift + T', 'نصّ باللمس'],
      ['[ / ]', 'تصغير/تكبير فرشاة التسييل'],
      ['أسهم', 'إزاحة ١mm'], ['Shift + أسهم', 'إزاحة ١٠mm'], ['Alt + أسهم', 'إزاحة ٠٫١mm'],
      ['Ctrl + U', 'الأدلّة الذكية'], ['Ctrl + K', 'لوحة الأوامر'],
      ['F10', 'فتح شريط القوائم'],
    ];

    function paint() {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = '';
      const hits = KEYS.filter(([k, d]) => !q || k.toLowerCase().includes(q) || d.includes(q));
      if (!hits.length) { list.appendChild(el('div', 'dqpi-empty', 'لا نتائج')); return; }
      hits.forEach(([k, d]) => {
        const r = el('div', 'p5-key');
        r.append(el('span', '', d), el('kbd', '', k));
        list.appendChild(r);
      });
    }
    search.addEventListener('input', paint);
    paint();

    p.append(sec(`الاختصارات (${KEYS.length})`, search, list));
    return { el: p, sync() {} };
  }

  /* ═══════════════ أداة التصغير ═══════════════ */
  let zoomOutDone = false;
  function installZoomOut() {
    if (zoomOutDone || typeof CanvasEditor === 'undefined') return;
    zoomOutDone = true;                     // التغليف مرّتين يضاعف كل تسجيل
    const P = CanvasEditor.prototype;
    /* أداة مستقلّة بدل Alt+نقر المدفون: النقر يصغّر عند المؤشّر،
       وAlt يعكسها إلى تكبير — تماماً كسلوك أداة التكبير معكوساً. */
    const origInstall = P._installCore;
    P._installCore = function () {
      if (origInstall) origInstall.call(this);
      if (!this.tools || !this.tools.register) return;
      this.tools.register('zoom-out', {
        cursor: 'zoom-out',
        onDown(pt, e) { this._zoomAt(pt, (e && e.altKey) ? 1.3 : 1 / 1.3); return true; },
      });
    };
  }

  /* ═══════════════ التسجيل ═══════════════ */
  const DEFS = [
    { id: 'measure',  title: 'القياسات',       icon: 'ruler',      build: buildMeasure },
    { id: 'undohist', title: 'سجلّ التراجع',    icon: 'history',    build: buildHistory },
    { id: 'material', title: 'الخامة والأداة', icon: 'wrench',     build: buildMaterial },
    { id: 'quickexp', title: 'التصدير السريع', icon: 'download',   build: buildExport },
    { id: 'keys',     title: 'المفاتيح',        icon: 'list-ordered', build: buildKeys },
  ];

  const syncers = [];
  function boot() {
    const WD = window.WorkspaceDock;
    if (!WD || !WD.register) return false;
    injectCSS();
    installZoomOut();
    for (const d of DEFS) {
      try {
        const made = d.build();
        syncers.push(made.sync);
        WD.register(d.id, { title: d.title, icon: d.icon, el: made.el });
      } catch (err) { console.error('[panel ' + d.id + ']', err); }
    }
    const hook = () => {
      const e = ed();
      if (!e || !e.events) return false;
      const run = () => syncers.forEach(f => { try { f(); } catch (_) {} });
      e.events.on('selection:changed', run);
      e.events.on('history:changed', run);
      return true;
    };
    if (!hook()) { let n = 0; const t = setInterval(() => { if (hook() || ++n > 40) clearInterval(t); }, 200); }
    // مزامنة أولى: التسجيل وحده لا يُطلق حدثاً، فتبدو اللوحة فارغة حتى أول تعديل
    setTimeout(() => syncers.forEach(f => { try { f(); } catch (_) {} }), 300);
    return true;
  }

  installZoomOut();
  if (!boot()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
  }
})();
