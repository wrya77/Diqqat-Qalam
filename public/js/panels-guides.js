/**
 * panels-guides.js — لوحة الأدلة والمساطر
 *
 *   كانت الأدلة تُدار بالفأرة وحدها: تُسحب من المسطرة وتُعاد إليها لتُحذف. ذلك
 *   كافٍ للتخطيط التقريبيّ وعاجزٌ عن العمل الدقيق — لا موضع بالمليمتر، ولا قفل،
 *   ولا جرد لما وضعتَه، ولا طريقة لبناء عشرة أدلة متساوية التباعد.
 *
 *   اللوحة عرضٌ لا محرّك: كل تعديل يمرّ بـwindow.DQGuides في tools-guides.js،
 *   وهي المالك الوحيد للحالة والحفظ والرسم. اللوحة تشترك في حدث التغيير فتُحدَّث
 *   حين تُسحب الأدلة بالفأرة أيضاً.
 */
(function panelsGuides() {
  'use strict';

  const ed = () => window.app && window.app.editor;
  const G = () => window.DQGuides;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };
  const ico = n => { try { return window.DQIcon ? window.DQIcon(n) : ''; } catch (_) { return ''; } };

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  /** مظروف التحديد (أو كل الأشكال إن لم يُحدَّد شيء) */
  function box(all) {
    const e = ed(); if (!e || !e.shapes) return null;
    let idx = (!all && e._selIndices) ? e._selIndices() : [];
    if (!idx.length) idx = e.shapes.map((_, i) => i);
    if (!idx.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    idx.forEach(i => {
      let b; try { b = e._bounds(e.shapes[i]); } catch (_) { return; }
      if (!b) return;
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    });
    return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  function injectCSS() {
    if (document.getElementById('dqg-css')) return;
    const s = el('style'); s.id = 'dqg-css';
    s.textContent = `
      .dqg{display:flex;flex-direction:column;gap:7px}
      /* شريط الحالات: أربعة مفاتيح أيقونية بحالة on واضحة */
      .dqg-tg{display:grid;grid-template-columns:repeat(4,1fr);gap:3px}
      .dqg-t{display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 2px;
        border:1px solid var(--border,#30363d);border-radius:7px;background:var(--bg1,#0d1117);
        color:var(--text3,#8b949e);cursor:pointer;font-family:inherit;font-size:9.5px;
        font-weight:600;transition:background .14s ease,color .14s ease,border-color .14s ease}
      .dqg-t:hover{background:var(--bg3,#1c2128);color:var(--text,#e6edf3)}
      .dqg-t.on{background:color-mix(in srgb,var(--accent,#4f6ef7) 20%,transparent);
        border-color:var(--accent,#4f6ef7);color:var(--accent-h,#6b86ff)}
      .dqg-t svg{width:15px;height:15px}

      .dqg-add{display:grid;grid-template-columns:auto 1fr 1fr auto;gap:4px;align-items:center}
      .dqg-add.ang{grid-template-columns:auto 1fr 1fr 1fr auto}
      .dqg-sel,.dqg-n{height:26px;border-radius:6px;background:var(--bg1,#0d1117);
        border:1px solid var(--border,#30363d);color:var(--text,#e6edf3);
        font-family:inherit;font-size:11.5px;padding:0 6px;min-width:0}
      .dqg-n{text-align:center}
      .dqg-sel:focus,.dqg-n:focus{outline:2px solid var(--accent,#4f6ef7);outline-offset:-1px}
      .dqg-go{width:28px;height:26px;display:flex;align-items:center;justify-content:center;
        border:1px solid var(--accent,#4f6ef7);border-radius:6px;cursor:pointer;padding:0;
        background:color-mix(in srgb,var(--accent,#4f6ef7) 18%,transparent);
        color:var(--accent-h,#6b86ff)}
      .dqg-go:hover{background:var(--accent,#4f6ef7);color:#fff}
      .dqg-go svg{width:14px;height:14px}

      .dqg-quick{display:grid;grid-template-columns:1fr 1fr;gap:3px}
      .dqg-q{display:flex;align-items:center;gap:5px;padding:5px 7px;border-radius:6px;
        border:1px solid var(--border,#30363d);background:var(--bg1,#0d1117);cursor:pointer;
        color:var(--text2,#b1bac4);font-family:inherit;font-size:10.5px;font-weight:600;
        text-align:start;transition:background .12s ease,color .12s ease}
      .dqg-q:hover{background:var(--bg3,#1c2128);color:var(--text,#e6edf3)}
      .dqg-q svg{width:13px;height:13px;flex:0 0 auto;opacity:.8}

      .dqg-list{display:flex;flex-direction:column;gap:1px;max-height:250px;overflow-y:auto;
        margin:0 -2px;padding:0 2px}
      .dqg-r{display:flex;align-items:center;gap:4px;padding:3px 5px;border-radius:5px;
        border:1px solid transparent;font-size:11px;color:var(--text2,#b1bac4)}
      .dqg-r:hover{background:var(--bg3,#1c2128)}
      .dqg-r.off{opacity:.45}
      .dqg-r > svg{width:12px;height:12px;flex:0 0 auto;opacity:.7}
      .dqg-r .p{width:100%;height:22px;border-radius:4px;background:transparent;border:1px solid transparent;
        color:inherit;font-family:ui-monospace,monospace;font-size:11px;text-align:center;min-width:0}
      .dqg-r .p:hover{border-color:var(--border,#30363d);background:var(--bg1,#0d1117)}
      .dqg-r .p:focus{outline:none;border-color:var(--accent,#4f6ef7);background:var(--bg1,#0d1117)}
      .dqg-r .u{flex:0 0 auto;font-size:9px;opacity:.5}
      .dqg-r .a{width:20px;height:20px;flex:0 0 auto;display:flex;align-items:center;
        justify-content:center;border:none;border-radius:4px;background:none;cursor:pointer;
        color:inherit;opacity:.45;padding:0}
      .dqg-r:hover .a{opacity:.75}
      .dqg-r .a:hover{opacity:1;background:var(--bg2,#161b22)}
      .dqg-r .a.on{opacity:1;color:var(--accent-h,#6b86ff)}
      .dqg-r .a.del:hover{color:#f85149}
      .dqg-r .a svg{width:12px;height:12px}
      .dqg-sw{width:13px;height:13px;flex:0 0 auto;border:none;border-radius:50%;padding:0;
        cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}
      .dqg-empty{padding:10px 6px;font-size:10.5px;color:var(--text3,#8b949e);line-height:1.7;
        text-align:center}
      .dqg-foot{display:flex;align-items:center;gap:6px;font-size:10px;
        color:var(--text3,#8b949e)}
      .dqg-foot b{color:var(--text2,#b1bac4)}
      .dqg-foot .sp{flex:1 1 auto}
    `;
    document.head.appendChild(s);
  }

  /* ═══════════════ البناء ═══════════════ */

  const COLORS = ['#4f6ef7', '#3fb950', '#f0883e', '#f85149', '#a371f7', '#56d4dd'];

  function build() {
    const root = el('div', 'dqp');
    const wrap = el('div', 'dqg');
    root.appendChild(wrap);

    /* ── مفاتيح الحالة ── */
    const tg = el('div', 'dqg-tg');
    const TOGGLES = [
      { k: 'rulers', icon: 'ruler',  lbl: 'المساطر', set: v => G().setRulers(v), tip: 'إظهار شريطَي المسطرة' },
      { k: 'show',   icon: 'eye',    lbl: 'الأدلة',  set: v => G().setShow(v),   tip: 'إظهار خطوط الأدلة' },
      { k: 'snap',   icon: 'magnet', lbl: 'الالتقاط', set: v => G().setSnap(v),  tip: 'التقاط الرسم على الأدلة' },
      { k: 'lock',   icon: 'lock',   lbl: 'القفل',   set: v => G().setLock(v),   tip: 'قفل الكلّ: تُرى وتلتقط ولا تُسحب' },
    ];
    const tgBtns = {};
    TOGGLES.forEach(t => {
      const b = el('button', 'dqg-t', ico(t.icon) + `<span>${t.lbl}</span>`);
      b.type = 'button'; b.title = t.tip; b.setAttribute('aria-label', t.tip);
      b.addEventListener('click', () => {
        const f = G().flags(); if (!f) return;
        t.set(!f[t.k]);
      });
      tgBtns[t.k] = b;
      tg.appendChild(b);
    });
    wrap.appendChild(sec('العرض والالتقاط', tg));

    /* ── إضافة دليل بموضع دقيق ── */
    const add = el('div', 'dqg-add');
    const kind = el('select', 'dqg-sel');
    kind.innerHTML = '<option value="v">رأسيّ</option><option value="h">أفقيّ</option><option value="a">مائل</option>';
    kind.title = 'نوع الدليل';
    const f1 = el('input', 'dqg-n'); f1.type = 'number'; f1.step = '0.5'; f1.value = '0'; f1.title = 'الموضع (mm)';
    const f2 = el('input', 'dqg-n'); f2.type = 'number'; f2.step = '0.5'; f2.value = '0'; f2.title = 'ص (mm)';
    const f3 = el('input', 'dqg-n'); f3.type = 'number'; f3.step = '5'; f3.value = '45'; f3.title = 'الزاوية (°)';
    const go = el('button', 'dqg-go', ico('plus-node'));
    go.type = 'button'; go.title = 'أضف الدليل'; go.setAttribute('aria-label', 'أضف الدليل');

    const syncKind = () => {
      const a = kind.value === 'a';
      add.classList.toggle('ang', a);
      f2.style.display = a ? '' : 'none';
      f3.style.display = a ? '' : 'none';
      f1.title = a ? 'س (mm)' : 'الموضع (mm)';
      f1.placeholder = a ? 'س' : 'mm';
    };
    kind.addEventListener('change', syncKind);
    add.append(kind, f1, f2, f3, go);
    syncKind();

    const doAdd = () => {
      const v1 = +f1.value || 0;
      if (kind.value === 'a') G().add({ axis: 'a', x: v1, y: +f2.value || 0, ang: +f3.value || 0 });
      else G().add({ axis: kind.value, pos: v1 });
    };
    go.addEventListener('click', doAdd);
    [f1, f2, f3].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); }));

    wrap.appendChild(sec('إضافة بموضع دقيق', add));

    /* ── مولّدات سريعة ── */
    const quick = el('div', 'dqg-quick');
    const QUICK = [
      { t: 'حواف التحديد', icon: 'bbox', tip: 'أربعة أدلة على حواف المحدَّد', fn: () => fromBox(false, false) },
      { t: 'مركز التحديد', icon: 'crosshair', tip: 'دليلان على منتصفَي المحدَّد', fn: () => fromBox(false, true) },
      { t: 'حواف الكلّ', icon: 'boxes', tip: 'أربعة أدلة على حواف كل الأشكال', fn: () => fromBox(true, false) },
      { t: 'المحوران', icon: 'crosshair', tip: 'دليل عند س=0 وآخر عند ص=0', fn: () => {
          G().addMany([{ axis: 'v', pos: 0 }, { axis: 'h', pos: 0 }]);
          toast('أُضيف دليلا المحورين', 'success');
        } },
      { t: 'توزيع متساوٍ…', icon: 'dist-h', tip: 'عدد من الأدلة موزّعة بين موضعين', fn: spread },
      { t: 'هوامش…', icon: 'offset', tip: 'إطار أدلة بمسافة ثابتة داخل حواف المحدَّد', fn: margins },
    ];
    QUICK.forEach(q => {
      const b = el('button', 'dqg-q', ico(q.icon) + `<span>${q.t}</span>`);
      b.type = 'button'; b.title = q.tip;
      b.addEventListener('click', q.fn);
      quick.appendChild(b);
    });
    wrap.appendChild(sec('مولّدات', quick));

    function fromBox(all, centerOnly) {
      const b = box(all);
      if (!b) { toast('لا أشكال لأخذ حوافّها', 'warn'); return; }
      const list = centerOnly
        ? [{ axis: 'v', pos: (b.minX + b.maxX) / 2 }, { axis: 'h', pos: (b.minY + b.maxY) / 2 }]
        : [{ axis: 'v', pos: b.minX }, { axis: 'v', pos: b.maxX },
           { axis: 'h', pos: b.minY }, { axis: 'h', pos: b.maxY }];
      G().addMany(list);
      toast(`أُضيفت ${list.length} أدلة`, 'success');
    }

    async function spread() {
      if (!window.DQPrompt) return;
      const b = box(false);
      const r = await window.DQPrompt('توزيع أدلة متساوية', [
        { key: 'axis', label: 'المحور', type: 'select', def: 'v',
          options: [{ v: 'v', t: 'رأسيّ (س)' }, { v: 'h', t: 'أفقيّ (ص)' }] },
        { key: 'from', label: 'من (mm)', def: b ? +b.minX.toFixed(2) : 0 },
        { key: 'to', label: 'إلى (mm)', def: b ? +b.maxX.toFixed(2) : 100 },
        { key: 'count', label: 'عدد الأدلة', def: 5, min: 2, max: 200 },
        { key: 'ends', label: 'أدرج الطرفين', type: 'check', def: true },
      ]);
      if (!r) return;
      const n = Math.max(2, Math.round(r.count));
      const list = [];
      // بالطرفين: n دليلاً تشمل البداية والنهاية. بدونهما: n فواصل داخلية
      for (let i = 0; i < n; i++) {
        const t = r.ends ? i / (n - 1) : (i + 1) / (n + 1);
        list.push({ axis: r.axis, pos: r.from + (r.to - r.from) * t });
      }
      G().addMany(list);
      toast(`وُزّع ${list.length} دليلاً`, 'success');
    }

    async function margins() {
      if (!window.DQPrompt) return;
      const b = box(false);
      if (!b) { toast('حدّد شكلاً أوّلاً', 'warn'); return; }
      const r = await window.DQPrompt('إطار هوامش', [
        { key: 'm', label: 'الهامش (mm)', def: 5 },
        { key: 'outside', label: 'خارج الحواف بدل داخلها', type: 'check', def: false },
      ]);
      if (!r) return;
      const m = r.outside ? -Math.abs(r.m) : Math.abs(r.m);
      G().addMany([
        { axis: 'v', pos: b.minX + m }, { axis: 'v', pos: b.maxX - m },
        { axis: 'h', pos: b.minY + m }, { axis: 'h', pos: b.maxY - m },
      ]);
      toast('أُضيف إطار الهوامش', 'success');
    }

    /* ── القائمة ── */
    const list = el('div', 'dqg-list');
    const foot = el('div', 'dqg-foot');
    const count = el('b', null, '0');
    const clr = el('button', 'dqg-q', ico('trash') + '<span>امسح الكلّ</span>');
    clr.type = 'button'; clr.style.padding = '3px 7px';
    clr.addEventListener('click', () => {
      const n = G().clear();
      toast(n ? `حُذفت ${n} أدلة` : 'لا أدلة', n ? 'success' : 'info');
    });
    foot.append(count, document.createTextNode(' دليلاً'), el('span', 'sp'), clr);
    wrap.appendChild(sec('الأدلة', list, foot));

    const AXIS = { v: { icon: 'mirror-h', t: 'رأسيّ' }, h: { icon: 'mirror-v', t: 'أفقيّ' }, a: { icon: 'shear', t: 'مائل' } };

    function render() {
      const g = G();
      if (!g) return;
      const f = g.flags();
      if (f) TOGGLES.forEach(t => tgBtns[t.k].classList.toggle('on', !!f[t.k]));

      const items = g.list();
      count.textContent = String(items.length);
      list.innerHTML = '';
      if (!items.length) {
        list.appendChild(el('div', 'dqg-empty',
          'لا أدلة بعد.<br>اسحب من المسطرة، أو أضف موضعاً دقيقاً من الأعلى.'));
        return;
      }
      // مرتّبة كي تُقرأ: رأسيّ ثم أفقيّ ثم مائل، وكلٌّ بموضعه
      const order = { v: 0, h: 1, a: 2 };
      items.sort((a, b2) => (order[a.axis] - order[b2.axis]) ||
                            ((a.axis === 'a' ? a.x : a.pos) - (b2.axis === 'a' ? b2.x : b2.pos)));
      items.forEach(gd => {
        const row = el('div', 'dqg-r' + (gd.off ? ' off' : ''));
        const A = AXIS[gd.axis] || AXIS.v;
        row.innerHTML = ico(A.icon);
        row.title = A.t;

        const sw = el('button', 'dqg-sw');
        sw.type = 'button';
        sw.style.background = gd.color || COLORS[0];
        sw.title = 'لون الدليل';
        sw.addEventListener('click', () => {
          const i = COLORS.indexOf(gd.color || COLORS[0]);
          g.update(gd.id, { color: COLORS[(i + 1) % COLORS.length] });
        });
        row.appendChild(sw);

        const p = el('input', 'p');
        p.type = 'number'; p.step = '0.5';
        p.value = (gd.axis === 'a' ? gd.x : gd.pos).toFixed(2).replace(/\.?0+$/, '');
        p.title = gd.axis === 'a' ? 'س' : 'الموضع (mm)';
        p.addEventListener('change', () => {
          const v = +p.value;
          if (!isFinite(v)) return;
          g.update(gd.id, gd.axis === 'a' ? { x: v } : { pos: v });
        });
        row.appendChild(p);

        if (gd.axis === 'a') {
          const ang = el('input', 'p');
          ang.type = 'number'; ang.step = '5';
          ang.value = String(gd.ang || 0);
          ang.title = 'الزاوية (°)';
          ang.addEventListener('change', () => g.update(gd.id, { ang: +ang.value || 0 }));
          row.appendChild(ang);
        }
        row.appendChild(el('span', 'u', gd.axis === 'a' ? '°' : 'mm'));

        const act = (icon, title, on, fn) => {
          const b = el('button', 'a' + (on ? ' on' : ''), ico(icon));
          b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
          b.addEventListener('click', fn);
          return b;
        };
        row.appendChild(act(gd.off ? 'disable' : 'eye', gd.off ? 'إظهار' : 'إخفاء', false,
          () => g.update(gd.id, { off: !gd.off })));
        row.appendChild(act(gd.lock ? 'lock' : 'unlock', gd.lock ? 'مقفل' : 'مفتوح', !!gd.lock,
          () => g.update(gd.id, { lock: !gd.lock })));
        const del = act('trash', 'حذف', false, () => g.remove(gd.id));
        del.classList.add('del');
        row.appendChild(del);

        // المرور يُبرز الدليل على اللوحة — بلا هذا لا تعرف أيّ صفٍّ أيّ خطّ
        row.addEventListener('mouseenter', () => g.highlight(gd.id));
        row.addEventListener('mouseleave', () => g.highlight(null));
        list.appendChild(row);
      });
    }

    function sec(title, ...kids) {
      const s = el('div', 'dqp-sec');
      s.appendChild(el('div', 'dqp-h', `<span>${title}</span>`));
      kids.forEach(k => k && s.appendChild(k));
      return s;
    }

    return { el: root, sync: render };
  }

  /* ═══════════════ التسجيل ═══════════════ */

  function boot() {
    const WD = window.WorkspaceDock;
    if (!WD || !WD.register || !window.DQGuides) return false;
    injectCSS();
    let made;
    try { made = build(); } catch (err) { console.error('[panel guides]', err); return true; }
    WD.register('guides', { title: 'الأدلة والمساطر', icon: 'ruler', el: made.el });
    // تُحدَّث من حدث المحرّك: سحب دليل بالفأرة يجب أن يظهر في القائمة فوراً
    window.DQGuides.on(made.sync);
    setTimeout(made.sync, 250);
    return true;
  }

  if (!boot()) {
    let n = 0;
    const t = setInterval(() => { if (boot() || ++n > 60) clearInterval(t); }, 200);
  }
})();
