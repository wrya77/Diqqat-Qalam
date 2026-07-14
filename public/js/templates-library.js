/**
 * templates-library.js — مكتبة قوالب CNC جاهزة (ميزة #6)
 *
 *  تصاميم بارامترية شائعة في الأعمال الحقيقية تُدرَج بنقرة مع ضبط أبعادها:
 *    ترس مستقيم · لوحة تثبيت بثقوب · حامل زاوية L · لوح صندوق تعشيق ·
 *    إطار لوحة اسم · مضلّع منتظم · شبكة ثقوب · مشط معايرة الخلوص.
 *
 *  كل قالب دالة تُرجع مصفوفة أشكال بنموذج المحرر (rect/circle/polyline)،
 *  ثم تُدرَج عبر editor.addShapesFromSVG (يحفظ التاريخ ويلائم العرض).
 *  لا يمسّ توليد G-Code — مجرّد أشكال عادية.
 *
 *  يُفتح من قائمة أدوات ▸ «📦 مكتبة القوالب» أو لوحة الأوامر (Ctrl+K).
 */
(function templatesLibrary() {
  'use strict';
  const ed = () => window.app && window.app.editor;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  const TAU = Math.PI * 2;
  const poly = (pts, closed = true) => ({ type: 'polyline', points: pts, closed });
  const circ = (cx, cy, r) => ({ type: 'circle', cx, cy, r });
  const rect = (x, y, w, h) => ({ type: 'rect', x, y, w, h });

  /* مستطيل بزوايا دائرية كـ polyline */
  function roundRectPts(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const seg = 6, pts = [];
    const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } };
    corner(x + w - r, y + r, -Math.PI / 2);   // أسفل-يمين
    corner(x + w - r, y + h - r, 0);           // أعلى-يمين
    corner(x + r, y + h - r, Math.PI / 2);     // أعلى-يسار
    corner(x + r, y + r, Math.PI);             // أسفل-يسار
    return pts;
  }

  /* ═══════════ تعريف القوالب ═══════════ */
  const TEMPLATES = {
    gear: {
      icon: '⚙️', name: 'ترس مستقيم', desc: 'ترس بأسنان + محور',
      fields: [
        { key: 'teeth', label: 'عدد الأسنان', def: 16, min: 6, max: 120 },
        { key: 'module', label: 'المعامل (module mm)', def: 4, min: 0.5 },
        { key: 'bore', label: 'قطر المحور (mm)', def: 8, min: 0 },
      ],
      build(v) {
        const N = Math.round(v.teeth), m = v.module;
        const Rp = m * N / 2, Ro = Rp + m, Rf = Rp - 1.25 * m;
        const cx = Ro, cy = Ro, step = TAU / N, pts = [];
        for (let i = 0; i < N; i++) {
          const b = i * step;
          const at = (frac, r) => pts.push({ x: cx + r * Math.cos(b + frac * step), y: cy + r * Math.sin(b + frac * step) });
          at(0.00, Rf); at(0.15, Ro); at(0.35, Ro); at(0.50, Rf); at(0.75, Rf);
        }
        const out = [poly(pts, true)];
        if (v.bore > 0) out.push(circ(cx, cy, v.bore / 2));
        return out;
      },
    },

    plate: {
      icon: '🔩', name: 'لوحة تثبيت', desc: 'لوح بثقوب زاوية + مركز',
      fields: [
        { key: 'w', label: 'العرض (mm)', def: 100, min: 10 },
        { key: 'h', label: 'الارتفاع (mm)', def: 60, min: 10 },
        { key: 'hole', label: 'قطر الثقب (mm)', def: 6, min: 0.5 },
        { key: 'margin', label: 'إزاحة الثقب من الحافة (mm)', def: 10, min: 1 },
        { key: 'center', label: 'ثقب مركزي', type: 'check', def: false },
      ],
      build(v) {
        const out = [rect(0, 0, v.w, v.h)];
        const r = v.hole / 2, mg = v.margin;
        [[mg, mg], [v.w - mg, mg], [mg, v.h - mg], [v.w - mg, v.h - mg]].forEach(([x, y]) => out.push(circ(x, y, r)));
        if (v.center) out.push(circ(v.w / 2, v.h / 2, r));
        return out;
      },
    },

    bracket: {
      icon: '📐', name: 'حامل زاوية L', desc: 'حامل L بثقوب تثبيت',
      fields: [
        { key: 'len', label: 'طول الذراع (mm)', def: 80, min: 20 },
        { key: 'width', label: 'عرض الذراع (mm)', def: 25, min: 8 },
        { key: 'hole', label: 'قطر الثقب (mm)', def: 5, min: 0 },
      ],
      build(v) {
        const L = v.len, t = v.width;
        const out = [poly([{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: t }, { x: t, y: t }, { x: t, y: L }, { x: 0, y: L }], true)];
        if (v.hole > 0) { const r = v.hole / 2; out.push(circ(t / 2, L - t / 2, r), circ(L - t / 2, t / 2, r)); }
        return out;
      },
    },

    fingerbox: {
      icon: '📦', name: 'لوح صندوق تعشيق', desc: 'لوح بأصابع تعشيق أعلى/أسفل',
      fields: [
        { key: 'w', label: 'العرض (mm)', def: 120, min: 30 },
        { key: 'h', label: 'الارتفاع (mm)', def: 80, min: 20 },
        { key: 'fingers', label: 'عدد الأصابع', def: 5, min: 2, max: 20 },
        { key: 'th', label: 'سُمك المادة (mm)', def: 6, min: 1 },
      ],
      build(v) {
        const W = v.w, H = v.h, th = v.th, segs = 2 * Math.round(v.fingers) + 1, sw = W / segs;
        const pts = [];
        // الحافة السفلية يسار→يمين: أصابع بارزة للأسفl على المقاطع الزوجية
        for (let i = 0; i < segs; i++) {
          const x0 = i * sw, x1 = (i + 1) * sw, down = (i % 2 === 0) ? -th : 0;
          pts.push({ x: x0, y: down }, { x: x1, y: down });
        }
        // الحافة اليمنى صعوداً
        pts.push({ x: W, y: H });
        // الحافة العلوية يمين→يسار
        for (let i = segs - 1; i >= 0; i--) {
          const x1 = (i + 1) * sw, x0 = i * sw, up = (i % 2 === 0) ? H + th : H;
          pts.push({ x: x1, y: up }, { x: x0, y: up });
        }
        pts.push({ x: 0, y: 0 });
        return [poly(pts, true)];
      },
    },

    frame: {
      icon: '🖼️', name: 'إطار لوحة اسم', desc: 'إطاران دائريا الزوايا للنقش',
      fields: [
        { key: 'w', label: 'العرض (mm)', def: 120, min: 20 },
        { key: 'h', label: 'الارتفاع (mm)', def: 50, min: 15 },
        { key: 'radius', label: 'نصف قطر الزاوية (mm)', def: 8, min: 0 },
        { key: 'inset', label: 'إزاحة الإطار الداخلي (mm)', def: 6, min: 0 },
      ],
      build(v) {
        const out = [poly(roundRectPts(0, 0, v.w, v.h, v.radius), true)];
        if (v.inset > 0) out.push(poly(roundRectPts(v.inset, v.inset, v.w - 2 * v.inset, v.h - 2 * v.inset, Math.max(0, v.radius - v.inset)), true));
        return out;
      },
    },

    ngon: {
      icon: '⬡', name: 'مضلّع منتظم', desc: 'مضلّع بعدد أضلاع اختياري',
      fields: [
        { key: 'sides', label: 'عدد الأضلاع', def: 6, min: 3, max: 60 },
        { key: 'radius', label: 'نصف القطر (mm)', def: 30, min: 2 },
      ],
      build(v) {
        const n = Math.round(v.sides), R = v.radius, cx = R, cy = R, pts = [];
        for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * TAU / n; pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }); }
        return [poly(pts, true)];
      },
    },

    holegrid: {
      icon: '⋮⋮', name: 'شبكة ثقوب', desc: 'مصفوفة ثقوب منتظمة',
      fields: [
        { key: 'cols', label: 'أعمدة', def: 5, min: 1, max: 50 },
        { key: 'rows', label: 'صفوف', def: 4, min: 1, max: 50 },
        { key: 'pitch', label: 'المسافة بين المراكز (mm)', def: 20, min: 2 },
        { key: 'hole', label: 'قطر الثقب (mm)', def: 6, min: 0.5 },
      ],
      build(v) {
        const out = [], r = v.hole / 2, p = v.pitch;
        for (let c = 0; c < Math.round(v.cols); c++)
          for (let row = 0; row < Math.round(v.rows); row++)
            out.push(circ(r + c * p, r + row * p, r));
        return out;
      },
    },

    kerfcomb: {
      icon: '🪮', name: 'مشط معايرة الخلوص', desc: 'شقوق متدرّجة لضبط kerf',
      fields: [
        { key: 'slots', label: 'عدد الشقوق', def: 6, min: 2, max: 20 },
        { key: 'start', label: 'أصغر عرض شقّ (mm)', def: 2, min: 0.5 },
        { key: 'stepw', label: 'زيادة العرض لكل شقّ (mm)', def: 0.5, min: 0.1 },
        { key: 'depth', label: 'عمق الشقّ (mm)', def: 20, min: 5 },
      ],
      build(v) {
        const n = Math.round(v.slots), gap = 6, out = [];
        let x = gap, maxX = gap;
        for (let i = 0; i < n; i++) { const w = v.start + i * v.stepw; out.push(rect(x, gap, w, v.depth)); x += w + gap; maxX = x; }
        out.push(rect(0, 0, maxX, v.depth + 2 * gap));   // الجسم الحاوي
        return out;
      },
    },
  };

  /* ═══════════ الواجهة ═══════════ */
  let ov, view = 'grid', curKey = null;

  function injectCSS() {
    if (document.getElementById('tpl-css')) return;
    const st = document.createElement('style');
    st.id = 'tpl-css';
    st.textContent = `
      .tpl-ov{position:fixed;inset:0;z-index:3100;display:none;align-items:center;justify-content:center;
        background:rgba(2,4,8,.55);backdrop-filter:blur(3px)}
      .tpl-ov.open{display:flex;animation:tplIn .12s ease-out}
      @keyframes tplIn{from{opacity:0}to{opacity:1}}
      .tpl-box{width:min(680px,94vw);max-height:82vh;display:flex;flex-direction:column;
        background:var(--bg1,#0d1117);border:1px solid var(--border2,#3d444d);border-radius:14px;
        box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden}
      .tpl-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;
        border-bottom:1px solid var(--border,#30363d);font-size:15px;font-weight:600;color:var(--text,#e6edf3)}
      .tpl-head .tpl-x{background:none;border:none;color:var(--text3,#8b949e);font-size:20px;cursor:pointer;line-height:1}
      .tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding:16px;overflow-y:auto}
      .tpl-card{display:flex;flex-direction:column;gap:5px;padding:14px;border:1px solid var(--border,#30363d);
        border-radius:10px;background:var(--bg2,#161b22);cursor:pointer;text-align:center;transition:.12s}
      .tpl-card:hover{border-color:var(--accent,#4f6ef7);transform:translateY(-2px)}
      .tpl-card .tpl-ic{font-size:30px;line-height:1}
      .tpl-card .tpl-nm{font-size:13.5px;font-weight:600;color:var(--text,#e6edf3)}
      .tpl-card .tpl-ds{font-size:11px;color:var(--text3,#8b949e)}
      .tpl-form{padding:18px;overflow-y:auto}
      .tpl-form h3{margin:0 0 14px;font-size:15px;color:var(--accent-h,#6b86ff)}
      .tpl-field{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px}
      .tpl-field label{font-size:13px;color:var(--text2,#b1bac4)}
      .tpl-field input[type=number]{width:110px}
      .tpl-field input[type=checkbox]{accent-color:var(--accent,#4f6ef7);width:17px;height:17px}
      .tpl-foot{display:flex;gap:10px;padding:14px 18px;border-top:1px solid var(--border,#30363d)}
      .tpl-foot button{flex:1;padding:9px;border-radius:8px;font-size:13.5px;cursor:pointer;font-family:inherit;font-weight:600}
      .tpl-back{background:var(--bg3,#1c2128);border:1px solid var(--border2,#3d444d);color:var(--text2,#b1bac4)}
      .tpl-ins{background:var(--accent,#4f6ef7);border:none;color:#fff}
      .tpl-ins:hover{filter:brightness(1.08)}
    `;
    document.head.appendChild(st);
  }

  function build() {
    injectCSS();
    ov = document.createElement('div');
    ov.className = 'tpl-ov'; ov.dir = 'rtl';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
  }

  function renderGrid() {
    view = 'grid';
    ov.innerHTML = `
      <div class="tpl-box">
        <div class="tpl-head"><span>📦 مكتبة القوالب الجاهزة</span><button class="tpl-x">✕</button></div>
        <div class="tpl-grid">
          ${Object.entries(TEMPLATES).map(([k, t]) => `
            <div class="tpl-card" data-k="${k}">
              <span class="tpl-ic">${t.icon}</span>
              <span class="tpl-nm">${t.name}</span>
              <span class="tpl-ds">${t.desc}</span>
            </div>`).join('')}
        </div>
      </div>`;
    ov.querySelector('.tpl-x').addEventListener('click', close);
    ov.querySelectorAll('.tpl-card').forEach(c => c.addEventListener('click', () => renderForm(c.dataset.k)));
  }

  function renderForm(key) {
    view = 'form'; curKey = key;
    const t = TEMPLATES[key];
    ov.innerHTML = `
      <div class="tpl-box">
        <div class="tpl-head"><span>${t.icon} ${t.name}</span><button class="tpl-x">✕</button></div>
        <div class="tpl-form">
          <h3>${t.desc}</h3>
          ${t.fields.map(f => f.type === 'check'
            ? `<div class="tpl-field"><label for="tf-${f.key}">${f.label}</label>
                 <input type="checkbox" id="tf-${f.key}" ${f.def ? 'checked' : ''}></div>`
            : `<div class="tpl-field"><label for="tf-${f.key}">${f.label}</label>
                 <input type="number" id="tf-${f.key}" value="${f.def}" step="0.5"
                   ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}></div>`
          ).join('')}
        </div>
        <div class="tpl-foot">
          <button class="tpl-back">◀ رجوع</button>
          <button class="tpl-ins">➕ إدراج في اللوحة</button>
        </div>
      </div>`;
    ov.querySelector('.tpl-x').addEventListener('click', close);
    ov.querySelector('.tpl-back').addEventListener('click', renderGrid);
    ov.querySelector('.tpl-ins').addEventListener('click', () => insert(key));
  }

  function readValues(t) {
    const v = {};
    t.fields.forEach(f => {
      const el = document.getElementById('tf-' + f.key);
      if (!el) return;
      if (f.type === 'check') v[f.key] = el.checked;
      else {
        let n = parseFloat(el.value);
        if (isNaN(n)) n = f.def;
        if (f.min != null) n = Math.max(f.min, n);
        if (f.max != null) n = Math.min(f.max, n);
        v[f.key] = n;
      }
    });
    return v;
  }

  function insert(key) {
    const e = ed();
    if (!e) return;
    const t = TEMPLATES[key];
    let shapes;
    try { shapes = t.build(readValues(t)); } catch (err) { toast('تعذّر بناء القالب: ' + err.message, 'error'); return; }
    if (!shapes || !shapes.length) { toast('قالب فارغ', 'warn'); return; }
    e.addShapesFromSVG(shapes);
    e.render();
    close();
    toast(`📦 أُدرج «${t.name}» (${shapes.length} شكل)`, 'success');
  }

  function open() { if (!ov) build(); renderGrid(); ov.classList.add('open'); }
  function close() { ov && ov.classList.remove('open'); }

  window.TemplatesLibrary = { open, close, templates: TEMPLATES };
})();
