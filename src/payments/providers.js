'use strict';
/**
 * providers.js — مزوّدا الدفع للعراق
 *
 *  FIBProvider  : الدفع عبر تطبيق FIB (First Iraqi Bank) — دينار عراقي
 *                 https://fib.iq — يتطلب FIB_CLIENT_ID + FIB_CLIENT_SECRET
 *
 *  CardProvider : بطاقات Visa / Mastercard عبر PayTabs العراق
 *                 https://site.paytabs.com/iq — يتطلب PAYTABS_PROFILE_ID + PAYTABS_SERVER_KEY
 *
 * كلا المزوّدين يُتحقق من حالة الدفع بالاستعلام المباشر من المزوّد
 * (لا نثق أبداً بمحتوى الـ callback وحده).
 */

/* ── FIB ──────────────────────────────────────────────────────────────────── */

class FIBProvider {
  constructor() {
    // الافتراضي بيئة الاختبار — للإنتاج: FIB_BASE_URL=https://fib.prod.fib.iq
    this.baseUrl      = (process.env.FIB_BASE_URL || 'https://fib.stage.fib.iq').replace(/\/+$/, '');
    this.clientId     = process.env.FIB_CLIENT_ID;
    this.clientSecret = process.env.FIB_CLIENT_SECRET;
    this._token    = null;
    this._tokenExp = 0;
  }

  get id()         { return 'fib'; }
  get name()       { return 'الدفع عبر تطبيق FIB'; }
  get configured() { return !!(this.clientId && this.clientSecret); }

  async _auth() {
    if (this._token && Date.now() < this._tokenExp - 30000) return this._token;
    const res = await fetch(`${this.baseUrl}/auth/realms/fib-online-shop/protocol/openid-connect/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('فشل الاتصال بـ FIB (auth): ' + res.status);
    const data = await res.json();
    this._token    = data.access_token;
    this._tokenExp = Date.now() + (data.expires_in || 300) * 1000;
    return this._token;
  }

  async createPayment({ amountIQD, description, callbackUrl }) {
    const token = await this._auth();
    const res = await fetch(`${this.baseUrl}/protected/v1/payments`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        monetaryValue:     { amount: String(amountIQD), currency: 'IQD' },
        statusCallbackUrl: callbackUrl,
        description,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`فشل إنشاء دفعة FIB: ${res.status} ${t.slice(0, 150)}`);
    }
    const d = await res.json();
    return {
      ref:        d.paymentId,
      payUrl:     d.personalAppLink || d.businessAppLink || null,
      qr:         d.qrCode || null,          // data URI لرمز QR
      code:       d.readableCode || null,    // كود يُدخل يدوياً في التطبيق
      validUntil: d.validUntil || null,
    };
  }

  async getStatus(ref) {
    const token = await this._auth();
    const res = await fetch(`${this.baseUrl}/protected/v1/payments/${encodeURIComponent(ref)}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('فشل استعلام حالة FIB: ' + res.status);
    const d = await res.json();
    if (d.status === 'PAID')     return 'paid';
    if (d.status === 'DECLINED') return 'failed';
    return 'pending';
  }
}

/* ── Visa / Mastercard (PayTabs Iraq) ─────────────────────────────────────── */

class CardProvider {
  constructor() {
    this.baseUrl   = (process.env.PAYTABS_BASE_URL || 'https://secure-iraq.paytabs.com').replace(/\/+$/, '');
    this.profileId = process.env.PAYTABS_PROFILE_ID;
    this.serverKey = process.env.PAYTABS_SERVER_KEY;
    this.currency  = process.env.PAYTABS_CURRENCY || 'IQD';
  }

  get id()         { return 'card'; }
  get name()       { return 'بطاقة Visa / Mastercard'; }
  get configured() { return !!(this.profileId && this.serverKey); }

  async createPayment({ amount, description, cartId, callbackUrl, returnUrl, customer }) {
    const res = await fetch(`${this.baseUrl}/payment/request`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', authorization: this.serverKey },
      body: JSON.stringify({
        profile_id:    Number(this.profileId),
        tran_type:     'sale',
        tran_class:    'ecom',
        cart_id:       cartId,
        cart_currency: this.currency,
        cart_amount:   amount,
        cart_description: description,
        callback:      callbackUrl,   // إشعار خادم↔خادم
        return:        returnUrl,     // عودة المتصفح بعد الدفع
        hide_shipping: true,
        customer_details: customer || undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.redirect_url) {
      throw new Error('فشل بوابة البطاقات: ' + (d.message || d.result || res.status));
    }
    return { ref: d.tran_ref, payUrl: d.redirect_url };
  }

  async getStatus(ref) {
    const res = await fetch(`${this.baseUrl}/payment/query`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', authorization: this.serverKey },
      body:    JSON.stringify({ profile_id: Number(this.profileId), tran_ref: ref }),
      signal:  AbortSignal.timeout(15000),
    });
    const d = await res.json().catch(() => ({}));
    const code = d?.payment_result?.response_status;
    if (code === 'A') return 'paid';                    // Authorized
    if (code === 'D' || code === 'E') return 'failed';  // Declined / Error
    return 'pending';
  }
}

/* ── Zain Cash (WaaS API) ──────────────────────────────────────────────────── */

class ZainCashProvider {
  constructor() {
    this.baseUrl    = (process.env.ZAINCASH_BASE_URL || 'https://test.zaincash.iq').replace(/\/+$/, '');
    this.merchantId = process.env.ZAINCASH_MERCHANT_ID;
    this.secret     = process.env.ZAINCASH_SECRET;
    this.msisdn     = process.env.ZAINCASH_MSISDN; // رقم المحفظة التجارية (9647XXXXXXXXX)
  }

  get id()         { return 'zaincash'; }
  get name()       { return 'Zain Cash'; }
  get configured() { return !!(this.merchantId && this.secret && this.msisdn); }

  // HS256 JWT بدون تبعيات خارجية — Node crypto فقط
  _jwt(payload) {
    const crypto = require('crypto');
    const hdr = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
    const pay = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secret).update(`${hdr}.${pay}`).digest('base64url');
    return `${hdr}.${pay}.${sig}`;
  }

  async createPayment({ amountIQD, description, orderId, callbackUrl }) {
    const token = this._jwt({
      amount:      amountIQD,
      serviceType: description,
      msisdn:      this.msisdn,
      orderId,
      redirectUrl: callbackUrl,
      lang:        'ar',
    });
    const res = await fetch(`${this.baseUrl}/transaction/init`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, merchantId: this.merchantId, lang: 'ar' }),
      signal:  AbortSignal.timeout(15000),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.id) throw new Error('فشل Zain Cash: ' + (d.msg || res.status));
    return {
      ref:    d.id,
      payUrl: `${this.baseUrl}/transaction/pay?id=${d.id}`,
      qr:     null,
      code:   null,
    };
  }

  async getStatus(ref) {
    const token = this._jwt({ id: ref, msisdn: this.msisdn, orderId: ref });
    const res = await fetch(`${this.baseUrl}/transaction/get`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, merchantId: this.merchantId }),
      signal:  AbortSignal.timeout(15000),
    });
    const d = await res.json().catch(() => ({}));
    if (d.status === 'success'  || d.msg === 'approved') return 'paid';
    if (d.status === 'failed'   || d.status === 'rejected') return 'failed';
    return 'pending';
  }
}

module.exports = { FIBProvider, CardProvider, ZainCashProvider };
