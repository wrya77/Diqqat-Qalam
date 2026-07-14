/**
 * live-gcode.js — معاينة G-Code حيّة + تقدير زمن فوري (ميزة #4)
 *
 * كل تعديل على الرسم أو على إعدادات القطع يعيد توليد G-Code تلقائياً بعد
 * لحظة هدوء (debounce 700ms) ويحدّث المعاينة والإحصائيات وزمن التشغيل في
 * تذييل اللوحة — بلا ضغط زر «توليد».
 *
 * لا يكرّر أي منطق: يستدعي نفس GCodeGenerator/PathSort اللذين يستعملهما
 * زر التوليد، ويكتب في نفس app.preview / app.controls.updateStats.
 *
 * حماية أداء: فوق LIMIT شكلاً يكتفي بتقدير زمن سريع (طول × طبقات ÷ تغذية)
 * دون توليد كامل، كي لا يتجمّد المتصفح أثناء السحب في التصاميم الضخمة.
 *
 * يُحمَّل بعد canvas-editor.js و gcode-preview.js وقبل app.js.
 */
(function liveGcode() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;

  const DEBOUNCE = 700;   // ms هدوء قبل التوليد
  const LIMIT    = 800;   // فوق هذا العدد من الأشكال: تقدير سريع فقط

  let timer = null;
  let busy = false;

  const on = () => localStorage.getItem('dq_live_gcode') !== '0';

  /* ── تقدير سريع (بلا توليد): طول المسارات × الطبقات ÷ التغذية ── */
  function quickEstimate(app, shapes, cfg) {
    let len = 0;
    const ed = app.editor;
    shapes.forEach(s => { len += ed._shapeLen ? ed._shapeLen(s) : 0; });
    const passes = Math.max(1, Math.ceil(cfg.totalDepth / cfg.passDepth));
    const min = (len * passes) / (cfg.feedRateXY || 1000);
    const m = Math.floor(min), sec = Math.round((min - m) * 60);
    const et = document.getElementById('est-time');
    if (et) et.textContent = 'وقت: ~' + (m > 0 ? `${m}:${String(sec).padStart(2, '0')} د` : `${sec} ث`);
  }

  /* ── التوليد الحيّ الكامل ── */
  function refresh() {
    const app = window.app;
    if (!app || !app.editor || !app.controls || !app.preview || busy || !on()) return;

    const shapes = app.editor.getShapes();
    if (!shapes.length) {
      app.gcode = '';
      app.preview.clear();
      const et = document.getElementById('est-time');
      if (et) et.textContent = 'وقت: --';
      return;
    }

    const Gen = (typeof GCodeGenerator !== 'undefined' && GCodeGenerator) ||
                (window.DQ && window.DQ.GCodeGenerator);
    if (!Gen) return;

    busy = true;
    try {
      const cfg = app.controls.getConfig();

      if (shapes.length > LIMIT) { quickEstimate(app, shapes, cfg); return; }

      // نفس مسار زر «توليد»: ترتيب ثم توليد — لكن بصمت (بلا toast/تعطيل أزرار)
      let ordered = shapes;
      if (cfg.sortPaths !== false && typeof DQ !== 'undefined' && DQ.PathSort && shapes.length <= 300) {
        ordered = DQ.PathSort.optimize(shapes).shapes;
      }
      const { gcode, stats } = new Gen(cfg).generate(ordered);
      app.gcode = gcode;                 // التصدير/المحاكاة تجد الكود جاهزاً دائماً
      app.preview.display(gcode);
      app.controls.updateStats(stats);   // يحدّث بطاقات الإحصائيات + est-time بالتذييل
      const lc = document.getElementById('gc-line-count');
      if (lc && !lc.dataset.live) { lc.dataset.live = '1'; }
    } catch (e) {
      // صمت — الأخطاء التفصيلية تظهر عند الضغط اليدوي على «توليد»
      console.warn('live-gcode:', e.message);
    } finally {
      busy = false;
    }
  }

  function schedule() {
    if (!on()) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE);
  }

  /* ── 1) أي تغيير في الرسم: _updateStatus هو نقطة العبور المركزية ── */
  const P = CanvasEditor.prototype;
  const origStatus = P._updateStatus;
  P._updateStatus = function () {
    origStatus.call(this);
    schedule();
  };

  /* ── 2) أي تغيير في إعدادات القطع (عمق/تغذية/أداة…) ── */
  function bindSettings() {
    const panel = document.querySelector('.settings-panel');
    if (!panel) return;
    panel.addEventListener('change', schedule);
    panel.addEventListener('input', e => {
      if (e.target.matches('input[type="number"], input[type="range"]')) schedule();
    });
  }

  /* ── 3) مفتاح التشغيل/الإيقاف في شريط لوحة G-Code ── */
  function bindToggle() {
    const t = document.getElementById('live-gcode');
    if (!t) return;
    t.checked = on();
    t.addEventListener('change', () => {
      localStorage.setItem('dq_live_gcode', t.checked ? '1' : '0');
      if (t.checked) schedule();
    });
  }

  function boot() { bindSettings(); bindToggle(); schedule(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.LiveGcode = { refresh, schedule };
})();
