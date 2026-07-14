/**
 * layers-panel.js — نظام الطبقات (تنظيم الأشكال: قطع / نقش / تخطيط)
 *
 *  لكل طبقة: اسم · لون · رؤية 👁 · قفل 🔒
 *   - الطبقة المخفية: لا تُرسَم ولا تدخل G-Code
 *   - الطبقة المقفلة: تُرسَم باهتة ولا تُحدَّد
 *   - الأشكال الجديدة تنضم للطبقة النشطة
 *   - «إسناد المحدد» ينقل الأشكال المختارة لطبقة
 *
 * تكامل غير هدّام: يلفّ _drawShape · _hitTest · getShapes الموجودة (تُبقى سلسلة
 * الطبقات فوق ترشيح tools-cnc للمعطّل/المقفل). يُحمَّل بعد كل tools-*.js وقبل app.js.
 */
(function layersFeature() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  const PALETTE = ['#4f6ef7', '#3fb950', '#d29922', '#f85149', '#a371f7', '#39c5cf', '#db61a2', '#e3b341'];
  const uid = () => 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  function ensure(ed) {
    if (!ed._layers) {
      ed._layers = [{ id: 'default', name: 'الطبقة الأساسية', color: PALETTE[0], visible: true, locked: false }];
      ed._activeLayer = 'default';
    }
  }

  P._layerOf = function (s) {
    ensure(this);
    const id = s && s.layer || 'default';
    return this._layers.find(l => l.id === id) || this._layers[0];
  };

  /* ═══════════════ تكامل الرسم ═══════════════ */
  const origDraw = P._drawShape;
  P._drawShape = function (s) {
    ensure(this);
    if (s.layer == null) s.layer = this._activeLayer || 'default';   // ختم كسول للأشكال الجديدة
    const L = this._layerOf(s);
    if (!L.visible) return;                                          // مخفية: لا تُرسَم
    const { ctx } = this;
    const sel = this.shapes[this.selectedIdx] === s;
    if (L.locked) {
      ctx.save(); ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.45; ctx.setLineDash([4, 3]);
      origDraw.call(this, s); ctx.restore(); return;
    }
    // تلوين بلون الطبقة (إلا المحدد فيبقى بلون التحديد، وإلا شكلاً له لون خاص من نظام الألوان)
    if (!sel && L.color && !s.stroke) { ctx.save(); ctx.strokeStyle = L.color; origDraw.call(this, s); ctx.restore(); return; }
    origDraw.call(this, s);
  };

  /* ═══════════════ تكامل التحديد: تجاهل المخفي والمقفل ═══════════════ */
  P._hitTest = function (pt) {
    ensure(this);
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const L = this._layerOf(this.shapes[i]);
      if (!L.visible || L.locked) continue;
      if (this._isNear(this.shapes[i], pt)) return i;
    }
    return -1;
  };

  /* ═══════════════ تكامل التوليد: استبعاد الطبقات المخفية ═══════════════ */
  const origGet = P.getShapes;
  P.getShapes = function () {
    ensure(this);
    return origGet.call(this).filter(s => this._layerOf(s).visible);
  };

  /* ═══════════════ عمليات الطبقات ═══════════════ */
  P.addLayer = function () {
    ensure(this);
    const L = { id: uid(), name: `طبقة ${this._layers.length + 1}`, color: PALETTE[this._layers.length % PALETTE.length], visible: true, locked: false };
    this._layers.push(L);
    this._activeLayer = L.id;
    this._renderLayersPanel();
    this.render();
  };

  P.deleteLayer = function (id) {
    ensure(this);
    if (this._layers.length <= 1) return toast('لا يمكن حذف الطبقة الوحيدة', 'warn');
    const used = this.shapes.filter(s => (s.layer || 'default') === id).length;
    if (used && !confirm(`الطبقة تحوي ${used} شكلاً — ستُنقل للطبقة الأساسية. متابعة؟`)) return;
    this._saveHistory?.();
    const fallback = this._layers.find(l => l.id !== id).id;
    this.shapes.forEach(s => { if ((s.layer || 'default') === id) s.layer = fallback; });
    this._layers = this._layers.filter(l => l.id !== id);
    if (this._activeLayer === id) this._activeLayer = this._layers[0].id;
    this._renderLayersPanel();
    this.render(); this._updateStatus?.();
  };

  P.toggleLayerVisible = function (id) {
    ensure(this);
    const L = this._layers.find(l => l.id === id); if (!L) return;
    L.visible = !L.visible;
    if (!L.visible && this.selectedIdx >= 0 && (this.shapes[this.selectedIdx]?.layer || 'default') === id) {
      this.selectedIdx = -1; this._updateShapeToolbar?.();
    }
    this._renderLayersPanel(); this.render(); this._updateStatus?.();
  };

  P.toggleLayerLock = function (id) {
    ensure(this);
    const L = this._layers.find(l => l.id === id); if (!L) return;
    L.locked = !L.locked;
    this._renderLayersPanel(); this.render();
  };

  P.setActiveLayer = function (id) {
    ensure(this);
    if (this._layers.some(l => l.id === id)) { this._activeLayer = id; this._renderLayersPanel(); }
  };

  P.renameLayer = function (id, name) {
    ensure(this);
    const L = this._layers.find(l => l.id === id); if (!L) return;
    L.name = (name || '').trim() || L.name;
    this._renderLayersPanel();
  };

  P.setLayerColor = function (id, color) {
    ensure(this);
    const L = this._layers.find(l => l.id === id); if (!L) return;
    L.color = color;
    this._renderLayersPanel(); this.render();
  };

  P.assignSelectedToLayer = function (id) {
    ensure(this);
    const idx = this._selIndices ? this._selIndices() : (this.selectedIdx >= 0 ? [this.selectedIdx] : []);
    if (!idx.length) return toast('حدد أشكالاً أولاً ثم أسندها لطبقة', 'warn');
    this._saveHistory?.();
    for (const i of idx) this.shapes[i].layer = id;
    this._renderLayersPanel(); this.render();
    toast(`✓ أُسند ${idx.length} شكلاً إلى الطبقة`, 'success');
  };

  /* ═══════════════ رسم اللوحة ═══════════════ */
  P._renderLayersPanel = function () {
    ensure(this);
    const box = document.getElementById('layers-list');
    if (!box) return;
    const counts = {};
    this.shapes.forEach(s => { const id = s.layer || 'default'; counts[id] = (counts[id] || 0) + 1; });

    box.innerHTML = this._layers.map(L => `
      <div class="lyr-row ${L.id === this._activeLayer ? 'active' : ''}" data-id="${L.id}">
        <input type="color" class="lyr-color" value="${L.color}" title="لون الطبقة">
        <button class="lyr-eye ${L.visible ? '' : 'off'}" title="${L.visible ? 'إخفاء' : 'إظهار'}">${L.visible ? '👁' : '🚫'}</button>
        <button class="lyr-lock ${L.locked ? 'on' : ''}" title="${L.locked ? 'فتح القفل' : 'قفل'}">${L.locked ? '🔒' : '🔓'}</button>
        <span class="lyr-name" title="نقر: تفعيل · نقر مزدوج: إعادة تسمية">${L.name}</span>
        <span class="lyr-count">${counts[L.id] || 0}</span>
        <button class="lyr-assign" title="إسناد المحدد لهذه الطبقة">⇤</button>
        <button class="lyr-del" title="حذف الطبقة">✕</button>
      </div>`).join('');

    const ed = this;
    box.querySelectorAll('.lyr-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.lyr-color').addEventListener('input', e => ed.setLayerColor(id, e.target.value));
      row.querySelector('.lyr-eye').addEventListener('click', e => { e.stopPropagation(); ed.toggleLayerVisible(id); });
      row.querySelector('.lyr-lock').addEventListener('click', e => { e.stopPropagation(); ed.toggleLayerLock(id); });
      row.querySelector('.lyr-assign').addEventListener('click', e => { e.stopPropagation(); ed.assignSelectedToLayer(id); });
      row.querySelector('.lyr-del').addEventListener('click', e => { e.stopPropagation(); ed.deleteLayer(id); });
      const nameEl = row.querySelector('.lyr-name');
      nameEl.addEventListener('click', () => ed.setActiveLayer(id));
      nameEl.addEventListener('dblclick', () => {
        const v = prompt('اسم الطبقة:', ed._layers.find(l => l.id === id)?.name || '');
        if (v != null) ed.renameLayer(id, v);
      });
    });
  };

  /* ═══════════════ تحديث كسول للّوحة عند تغيّر المشهد ═══════════════ */
  const origRender = P.render;
  let sig = '';
  P.render = function () {
    origRender.call(this);
    ensure(this);
    // توقيع رخيص: عدد الأشكال + الطبقات + النشطة + رؤية/قفل — يحدّث اللوحة فقط عند اللزوم
    const s = this.shapes.length + '|' + this._activeLayer + '|' +
      this._layers.map(l => l.id + l.visible + l.locked + l.color + l.name).join(',');
    if (s !== sig) { sig = s; this._renderLayersPanel(); }
  };

  /* ═══════════════ زرّ الإضافة ═══════════════ */
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'layer-add') { window.app?.editor?.addLayer(); }
  });

  /* ═══════════════ CSS ═══════════════ */
  const st = document.createElement('style');
  st.textContent = `
    #layers-panel{padding:2px 0}
    .lyr-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .lyr-toolbar .lyr-hint{font-size:11px;color:var(--text3)}
    #layer-add{background:var(--bg4);border:1px solid var(--border);border-radius:6px;color:var(--text2);
      cursor:pointer;font-size:12px;padding:4px 10px;display:flex;align-items:center;gap:5px;transition:all .13s}
    #layer-add:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:translateY(-1px)}
    #layers-list{display:flex;flex-direction:column;gap:3px}
    .lyr-row{display:flex;align-items:center;gap:5px;padding:5px 6px;border-radius:7px;
      border:1px solid transparent;background:var(--bg3);transition:background .12s,border-color .12s}
    .lyr-row:hover{background:var(--bg4)}
    .lyr-row.active{border-color:var(--accent);background:var(--accent-soft)}
    .lyr-color{width:20px;height:20px;padding:0;border:1px solid var(--border2);border-radius:5px;
      background:none;cursor:pointer;flex-shrink:0}
    .lyr-color::-webkit-color-swatch{border:none;border-radius:4px}
    .lyr-color::-webkit-color-swatch-wrapper{padding:1px}
    .lyr-eye,.lyr-lock,.lyr-assign,.lyr-del{background:none;border:none;cursor:pointer;font-size:13px;
      padding:2px 3px;line-height:1;flex-shrink:0;border-radius:5px;color:var(--text3);transition:all .12s}
    .lyr-eye:hover,.lyr-lock:hover,.lyr-assign:hover,.lyr-del:hover{background:var(--bg2);color:var(--text)}
    .lyr-eye.off{opacity:.5}
    .lyr-lock.on{color:var(--amber)}
    .lyr-del:hover{color:var(--red)}
    .lyr-assign{color:var(--accent-h);font-weight:700}
    .lyr-name{flex:1;font-size:12.5px;color:var(--text);white-space:nowrap;overflow:hidden;
      text-overflow:ellipsis;cursor:pointer;user-select:none}
    .lyr-count{font-size:10.5px;color:var(--text3);background:var(--bg1);border-radius:9px;
      padding:1px 7px;min-width:20px;text-align:center;font-family:var(--font-mono)}
  `;
  document.head.appendChild(st);

  // رسم أولي بعد جاهزية المحرّر
  function boot() {
    const ed = window.app?.editor;
    if (ed) { ed._renderLayersPanel(); } else { setTimeout(boot, 200); }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 300);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 300));
})();
