/**
 * payments.js — واجهة ترقية الاشتراك والدفع (FIB + Visa/Mastercard)
 */
const PaymentsUI = (() => {
  'use strict';

  let selectedPlan = 'pro';
  let pollTimer    = null;

  const $ = (id) => document.getElementById(id);

  function toast(msg, type) {
    if (window.app && typeof app.toast === 'function') app.toast(msg, type);
  }

  /* ── فتح/إغلاق ── */
  async function open() {
    if (typeof AuthManager !== 'undefined' && !AuthManager.isLoggedIn()) {
      toast('سجّل الدخول أولاً لترقية اشتراكك', 'warn');
      setTimeout(() => { window.location.href = '/auth'; }, 1200);
      return;
    }
    resetUI();
    $('dlg-upgrade')?.showModal();

    // عطّل الطرق غير المفعّلة في الخادم
    try {
      const res = await fetch('/api/payments/methods');
      const cfg = await res.json();
      (cfg.methods || []).forEach(m => {
        const btn = document.querySelector(`.pay-btn[data-method="${m.id}"]`);
        if (btn && !m.configured) {
          btn.disabled = true;
          btn.title = 'غير مفعّل بعد — يتطلب إعداد مفاتيح المزوّد في الخادم';
        }
      });
    } catch (_) {}
  }

  function close() {
    stopPolling();
    $('dlg-upgrade')?.close();
  }

  function resetUI() {
    $('pay-status').style.display  = 'none';
    $('pay-qr-wrap').style.display = 'none';
    document.querySelectorAll('.pay-btn').forEach(b => { b.disabled = false; });
  }

  /* ── بدء الدفع ── */
  async function checkout(method) {
    document.querySelectorAll('.pay-btn').forEach(b => { b.disabled = true; });
    $('pay-status').style.display = 'flex';
    $('pay-status-msg').textContent = 'جاري إنشاء عملية الدفع…';

    try {
      const res = await fetch('/api/payments/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan: selectedPlan, method }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل إنشاء الدفعة');

      // FIB: اعرض QR والكود — بطاقة: افتح صفحة الدفع
      if (data.qr) {
        $('pay-qr').src = data.qr;
        $('pay-code').textContent = data.code || '';
        $('pay-qr-wrap').style.display = 'block';
      }
      if (data.payUrl) window.open(data.payUrl, '_blank', 'noopener');

      $('pay-status-msg').textContent = 'بانتظار إتمام الدفع…';
      startPolling(data.paymentId);

    } catch (e) {
      $('pay-status').style.display = 'none';
      document.querySelectorAll('.pay-btn').forEach(b => { b.disabled = false; });
      toast('❌ ' + e.message, 'error');
    }
  }

  /* ── متابعة الحالة ── */
  function startPolling(paymentId) {
    stopPolling();
    const t0 = Date.now();
    pollTimer = setInterval(async () => {
      if (Date.now() - t0 > 10 * 60 * 1000) { // مهلة 10 دقائق
        stopPolling();
        $('pay-status-msg').textContent = 'انتهت مهلة الدفع — أعد المحاولة';
        return;
      }
      try {
        const res = await fetch(`/api/payments/${paymentId}/status`);
        const d   = await res.json();
        if (d.status === 'paid') {
          stopPolling();
          close();
          const names = { basic: 'أساسي', pro: 'احترافي', business: 'أعمال' };
          toast('🎉 تم الدفع بنجاح! تمت ترقية اشتراكك إلى خطة ' +
                (names[d.plan] || d.plan), 'success');
        } else if (d.status === 'failed') {
          stopPolling();
          $('pay-status-msg').textContent = 'فشل الدفع أو رُفض — أعد المحاولة';
          document.querySelectorAll('.pay-btn').forEach(b => { b.disabled = false; });
        }
      } catch (_) { /* أعد المحاولة في الدورة القادمة */ }
    }, 4000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ── ربط الأحداث ── */
  function init() {
    $('btn-upgrade')?.addEventListener('click', open);
    $('cls-upgrade')?.addEventListener('click', close);

    document.querySelectorAll('.plan-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedPlan = card.dataset.plan;
      });
    });

    document.querySelectorAll('.pay-btn').forEach(btn => {
      btn.addEventListener('click', () => checkout(btn.dataset.method));
    });

    // عائد من بوابة البطاقات؟ تابع حالة الدفعة
    const params = new URLSearchParams(location.search);
    const pid = params.get('payment');
    if (pid) {
      history.replaceState(null, '', location.pathname);
      open().then(() => {
        $('pay-status').style.display = 'flex';
        startPolling(pid);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { open, close };
})();
