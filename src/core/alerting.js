'use strict';
/**
 * alerting.js — تنبيهات تشغيلية لصاحب الورشة.
 *
 * يحلّ مشكلة «السقوط الصامت»: عندما يرمي الخادم خطأً (500) أو يحدث رفض وعد غير
 * معالَج، يُرسل تنبيهاً فورياً إلى Telegram (البوت نفسه المستخدم لإشعارات الأشغال).
 * يدعم Sentry اختيارياً عبر SENTRY_DSN (تحميل كسول — لا تبعية مفروضة).
 *
 * المتغيّرات:
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID : لتفعيل تنبيهات Telegram (موجودة أصلاً)
 *   SENTRY_DSN (اختياري)                  : لتفعيل Sentry — يتطلّب `npm i @sentry/node`
 */

const Telegram = require('../notify/Telegram');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class Alerting {
  constructor(telegram) {
    this.tg          = telegram || new Telegram();
    this.sentry      = null;
    this._lastSent   = new Map();           // توقيع الخطأ -> آخر وقت إرسال (خنق)
    this._throttleMs = 5 * 60 * 1000;       // تنبيه واحد لكل توقيع كل 5 دقائق (يمنع الإغراق)
    this._env        = process.env.NODE_ENV || 'production';
    this._site       = process.env.PUBLIC_BASE_URL || '';
  }

  // تفعيل Sentry فقط إن ضُبط DSN وكانت الحزمة مثبّتة — وإلا لا شيء (no-op)
  initSentry() {
    if (!process.env.SENTRY_DSN) return false;
    try {
      this.sentry = require('@sentry/node');
      this.sentry.init({
        dsn:              process.env.SENTRY_DSN,
        environment:      this._env,
        tracesSampleRate: 0,
      });
      console.log('[alerting] Sentry مُفعّل');
      return true;
    } catch (e) {
      this.sentry = null;
      console.warn('[alerting] SENTRY_DSN مضبوط لكن @sentry/node غير مُثبّت — نفّذ: npm i @sentry/node');
      return false;
    }
  }

  _throttled(sig) {
    const now  = Date.now();
    const last = this._lastSent.get(sig);
    if (last && (now - last) < this._throttleMs) return true;
    this._lastSent.set(sig, now);
    if (this._lastSent.size > 500) {        // امنع نمو الخريطة بلا حدود
      for (const [k, v] of this._lastSent) if (now - v > this._throttleMs) this._lastSent.delete(k);
    }
    return false;
  }

  // إرسال تنبيه (Telegram) — لا يرمي أبداً، ولا يُعطّل مسار الطلب
  async send(title, detail = '', meta = {}) {
    try {
      const sig = `${title}|${String(detail || '').slice(0, 80)}|${meta.path || ''}`;
      if (this._throttled(sig)) return;
      const body = [
        `⚠️ <b>${escapeHtml(title)}</b>`,
        detail ? escapeHtml(String(detail).slice(0, 500)) : '',
        meta.path ? `المسار: <code>${escapeHtml(String(meta.path))}</code>` : '',
        `البيئة: ${escapeHtml(this._env)}`,
        this._site ? escapeHtml(this._site) : '',
        new Date().toISOString(),
      ].filter(Boolean).join('\n');
      await this.tg.send(body);
    } catch (_) { /* التنبيه نفسه يجب ألا يُسبّب خطأً */ }
  }

  // يُستدعى من معالج Express العام عند خطأ 500
  notifyServerError(err, req) {
    const msg = (err && (err.message || String(err))) || 'خطأ غير معروف';
    if (this.sentry) { try { this.sentry.captureException(err); } catch (_) {} }
    this.send('خطأ خادم 500', msg, { path: req && req.path });
  }

  // معالجات على مستوى العملية — تُسجَّل على Vercel أيضاً (حيث لم تكن تُسجَّل سابقاً)
  installProcessHandlers() {
    process.on('unhandledRejection', (reason) => {
      const msg = (reason && (reason.message || String(reason))) || 'رفض وعد غير معالَج';
      console.error('UnhandledRejection:', reason);
      if (this.sentry) { try { this.sentry.captureException(reason); } catch (_) {} }
      this.send('رفض وعد غير معالَج (unhandledRejection)', msg);
      // لا نُنهي العملية — في الخادم الدائم يتكفّل معالج الإغلاق الرشيق بذلك
    });
  }
}

module.exports = Alerting;
