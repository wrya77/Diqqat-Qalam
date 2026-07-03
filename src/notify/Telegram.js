'use strict';
/**
 * Telegram.js — إشعارات تيليجرام (#17)
 *
 * يرسل إشعارات الأحداث إلى هاتف صاحب الورشة عبر بوت تيليجرام:
 *   - اكتمال الشغل / خطأ في الشغل
 *   - إنذارات الآلة (alarm / critical)
 *
 * المتغيّرات المطلوبة:
 *   TELEGRAM_BOT_TOKEN : من BotFather
 *   TELEGRAM_CHAT_ID   : معرّف محادثتك مع البوت (اكتشفه عبر discoverChatIds)
 *
 * بدون المتغيّرات يبقى صامتاً (no-op) فلا يكسر شيئاً.
 */

class Telegram {
  /**
   * تهريب نص ديناميكي قبل حقنه في رسالة HTML — أسماء الأشغال/الأخطاء قد تحوي
   * < أو & فيرفض Telegram الرسالة كلها (can't parse entities) بصمت.
   */
  static escape(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  constructor() {
    this.token  = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID   || '';
    this._base  = this.token ? `https://api.telegram.org/bot${this.token}` : '';
  }

  get hasToken()   { return !!this.token; }
  get configured() { return !!(this.token && this.chatId); }

  /** يرسل رسالة نصّية (HTML) — يتجاهل بصمت إن لم يُضبط الإعداد */
  async send(text) {
    if (!this.configured) return { ok: false, skipped: true };
    try {
      const res = await fetch(`${this._base}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) console.error('[telegram] sendMessage:', JSON.stringify(d).slice(0, 150));
      return { ok: !!d.ok };
    } catch (e) {
      console.error('[telegram] send failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  /** اكتشاف chat_id: راسِل البوت رسالة واحدة ثم استدعِ هذا */
  async discoverChatIds() {
    if (!this.token) return [];
    try {
      const res = await fetch(`${this._base}/getUpdates`, { signal: AbortSignal.timeout(8000) });
      const d   = await res.json().catch(() => ({}));
      const chats = {};
      for (const u of d.result || []) {
        const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
        if (c) chats[c.id] = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id);
      }
      return Object.entries(chats).map(([id, name]) => ({ id, name }));
    } catch (e) {
      console.error('[telegram] getUpdates failed:', e.message);
      return [];
    }
  }
}

module.exports = Telegram;
