/**
 * version-history.js — سجل نسخ التصميم (ميزة #9)
 *
 *  لقطات للتصميم يمكن الرجوع إليها لاحقاً — أوسع من التراجع Ctrl+Z (الذي
 *  يضيع عند إعادة التحميل). نوعان:
 *    • تلقائية: لقطة كل ≥90 ثانية عند تغيّر التصميم فعلاً (بلا تكرار).
 *    • يدوية: زر «احفظ نسخة» في أي لحظة.
 *
 *  تُحفَظ في localStorage (حتى 15 نسخة، تُقلَّم الأقدم)، والاسترجاع قابل
 *  للتراجع (يُحفَظ الوضع الحالي في تاريخ المحرر قبل الاستبدال).
 *
 *  يُحمَّل بعد canvas-editor.js وقبل app.js.
 */
(function versionHistory() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const ed = () => window.app && window.app.editor;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  const KEY = 'dq_versions';
  const MAX = 15;
  const AUTO_GAP = 90000;   // 90s بين اللقطات التلقائية

  let versions = [];
  try { versions = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { versions = []; }
  let lastAutoTs = 0;
  let lastJSON = versions[0] ? versions[0].json : '';

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(versions)); }
    catch (e) {                       // تجاوز الحصة → قلّم حتى ينجح الحفظ
      while (versions.length > 3) { versions.pop(); try { localStorage.setItem(KEY, JSON.stringify(versions)); return; } catch (e2) {} }
    }
  }

  function snapshot(manual) {
    const e = ed();
    if (!e || !e.shapes) return;
    const json = JSON.stringify(e.shapes);
    if (!manual) {
      if (!e.shapes.length) return;             // لا تلقائي للوحة فارغة
      if (json === lastJSON) return;            // بلا تغيير
    }
    lastJSON = json; lastAutoTs = Date.now();
    versions.unshift({ id: 'v' + Date.now(), ts: Date.now(), count: e.shapes.length, manual: !!manual, json });
    if (versions.length > MAX) versions.length = MAX;
    persist();
    render();
    if (manual) toast(`💾 حُفظت نسخة (${e.shapes.length} شكل)`, 'success');
  }

  function restore(id) {
    const e = ed(); if (!e) return;
    const v = versions.find(x => x.id === id); if (!v) return;
    let shapes; try { shapes = JSON.parse(v.json); } catch (err) { return toast('نسخة تالفة', 'error'); }
    e._saveHistory?.();                          // اجعل الاسترجاع قابلاً للتراجع
    e.shapes = shapes;
    e.selectedIdx = -1; e.msel && e.msel.clear();
    e.render(); e._updateShapeToolbar?.(); e._updateStatus?.();
    toast(`↺ استُرجعت نسخة ${relTime(v.ts)} (${v.count} شكل)`, 'info');
  }

  function remove(id) {
    versions = versions.filter(x => x.id !== id);
    persist(); render();
  }

  function relTime(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'الآن';
    if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
    if (s < 86400) return `قبل ${Math.round(s / 3600)} س`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function render() {
    const box = document.getElementById('versions-list');
    if (!box) return;
    if (!versions.length) { box.innerHTML = '<div class="ver-empty">لا نسخ محفوظة بعد</div>'; return; }
    box.innerHTML = versions.map(v => `
      <div class="ver-item" data-id="${v.id}">
        <span class="ver-ic">${v.manual ? '💾' : '🕓'}</span>
        <span class="ver-meta"><b>${relTime(v.ts)}</b><span>${v.count} شكل${v.manual ? ' · يدوي' : ''}</span></span>
        <button class="ver-btn ver-restore" title="استرجاع هذه النسخة">↺</button>
        <button class="ver-btn ver-del" title="حذف">✕</button>
      </div>`).join('');
    box.querySelectorAll('.ver-item').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('.ver-restore').addEventListener('click', () => restore(id));
      el.querySelector('.ver-del').addEventListener('click', () => remove(id));
    });
  }

  /* لقطة تلقائية مقيَّدة زمنياً عبر نقطة التغيير المركزية */
  const origStatus = P._updateStatus;
  P._updateStatus = function () {
    origStatus.call(this);
    if (Date.now() - lastAutoTs >= AUTO_GAP) snapshot(false);
  };

  function boot() {
    render();
    document.getElementById('ver-save')?.addEventListener('click', () => snapshot(true));
    // حدّث التوقيتات النسبية كل دقيقة
    setInterval(() => { if (versions.length) render(); }, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.VersionHistory = { snapshot: () => snapshot(true), restore, list: () => versions };
})();
