'use strict';
/**
 * GoogleSheets.js — سجلّ الأرباح في Google Sheets
 *
 * يرسل صفاً لكل دفعة مؤكَّدة إلى Google Apps Script Web App مربوط بجدول
 * «أرباح دقة قلم». هذا هو السجلّ الدائم الذي يقرؤه صاحب الموقع من هاتفه.
 *
 * المتغيّر المطلوب:
 *   GSHEET_WEBHOOK_URL : رابط نشر الـ Web App (انظر docs/google-sheets-profits.md)
 *
 * بدون المتغيّر يبقى صامتاً (no-op) فلا يكسر شيئاً — كنمط Telegram.js تماماً.
 */

class GoogleSheets {
  constructor() {
    this.url = process.env.GSHEET_WEBHOOK_URL || '';
  }

  get configured() { return !!this.url; }

  /**
   * يسجّل دفعة مؤكّدة صفاً في الجدول. لا يرمي أبداً — فشل التسجيل يُطبع
   * في السجلّ فقط ولا يجوز أن يُفشل ترقية اشتراك مدفوع.
   */
  async logPayment(p) {
    if (!this.configured || !p) return { ok: false, skipped: true };
    try {
      // Apps Script يعيد 302 إلى googleusercontent — fetch يتبعه افتراضياً
      const res = await fetch(this.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:      'payment',
          date:      p.paidAt || new Date().toISOString(),
          paymentId: p.id,
          userId:    p.userId,
          plan:      p.plan,
          method:    p.method,
          amountIQD: p.amountIQD,
          status:    p.status,
        }),
        redirect: 'follow',
        signal:   AbortSignal.timeout(8000),
      });
      if (!res.ok) console.error('[gsheet] append failed:', res.status);
      return { ok: res.ok };
    } catch (e) {
      console.error('[gsheet] log failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  /** صف تجربة للتحقق من الإعداد (يُستدعى من نقطة إدارية) */
  async test() {
    return this.logPayment({
      id: 'test_' + Date.now(), userId: 'test', plan: 'test',
      method: 'test', amountIQD: 0, status: 'test',
      paidAt: new Date().toISOString(),
    });
  }
}

module.exports = GoogleSheets;
