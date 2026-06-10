'use strict';
/**
 * PaymentManager.js — إدارة دفعات الترقية (العراق)
 *
 * - الأسعار بالدينار العراقي والدولار
 * - يسجل كل دفعة في data/payments.json
 * - عند تأكيد الدفع (بالاستعلام من المزوّد) يرقّي اشتراك المستخدم 30 يوماً
 * - التأكيد idempotent — استدعاء reconcile مرتين لا يكرر الترقية
 */

const fs   = require('fs');
const path = require('path');
const { FIBProvider, CardProvider } = require('./providers');

// أسعار الخطط الشهرية
const PLAN_PRICES = {
  pro:        { iqd: 39000,  usd: 29,  name: 'احترافي' },
  enterprise: { iqd: 265000, usd: 199, name: 'مؤسسي'  },
};

class PaymentManager {
  constructor(subscriptionManager, analytics) {
    this.subMgr    = subscriptionManager;
    this.analytics = analytics;
    this.dataFile  = path.join(process.cwd(), 'data', 'payments.json');
    this.providers = {
      fib:  new FIBProvider(),
      card: new CardProvider(),
    };
    this._payments = this._load();
  }

  _load() {
    try {
      return fs.existsSync(this.dataFile)
        ? JSON.parse(fs.readFileSync(this.dataFile, 'utf8'))
        : [];
    } catch { return []; }
  }

  _save() {
    fs.writeFileSync(this.dataFile, JSON.stringify(this._payments, null, 2), 'utf8');
  }

  /** طرق الدفع المتاحة + الخطط والأسعار (للواجهة) */
  methods() {
    return {
      methods: Object.values(this.providers).map(p => ({
        id: p.id, name: p.name, configured: p.configured,
      })),
      plans: Object.entries(PLAN_PRICES).map(([id, p]) => ({
        id, name: p.name, iqd: p.iqd, usd: p.usd,
      })),
    };
  }

  /** إنشاء عملية دفع جديدة */
  async createCheckout({ userId, email, plan, method, baseUrl }) {
    const price    = PLAN_PRICES[plan];
    const provider = this.providers[method];
    if (!price)    throw new Error('خطة غير معروفة: ' + plan);
    if (!provider) throw new Error('طريقة دفع غير معروفة: ' + method);
    if (!provider.configured) {
      const err = new Error('طريقة الدفع غير مفعّلة بعد — أضف مفاتيح المزوّد في .env');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }

    const id = 'pay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const description = `اشتراك دقة قلم — خطة ${price.name} (شهر واحد)`;

    let created;
    if (method === 'fib') {
      created = await provider.createPayment({
        amountIQD:   price.iqd,
        description,
        callbackUrl: `${baseUrl}/api/payments/callback/fib?pid=${id}`,
      });
    } else {
      created = await provider.createPayment({
        amount:      price.iqd,
        description,
        cartId:      id,
        callbackUrl: `${baseUrl}/api/payments/callback/card`,
        returnUrl:   `${baseUrl}/app?payment=${id}`,
        customer:    email ? { name: email.split('@')[0], email } : undefined,
      });
    }

    const record = {
      id,
      userId,
      plan,
      method,
      amountIQD:   price.iqd,
      providerRef: created.ref,
      status:      'pending',
      createdAt:   new Date().toISOString(),
      paidAt:      null,
    };
    this._payments.push(record);
    if (this._payments.length > 2000) this._payments = this._payments.slice(-2000);
    this._save();

    return {
      paymentId: id,
      method,
      plan,
      amountIQD: price.iqd,
      payUrl:    created.payUrl,
      qr:        created.qr   || null,
      code:      created.code || null,
    };
  }

  find(id)           { return this._payments.find(p => p.id === id) || null; }
  findByRef(ref)     { return this._payments.find(p => p.providerRef === ref) || null; }

  /**
   * التحقق من حالة الدفعة لدى المزوّد وترقية الاشتراك عند السداد.
   * آمن للاستدعاء المتكرر (من polling الواجهة أو callback المزوّد).
   */
  async reconcile(payment) {
    if (!payment) throw new Error('دفعة غير موجودة');
    if (payment.status === 'paid') return payment;   // مؤكدة سابقاً

    const provider = this.providers[payment.method];
    const status   = await provider.getStatus(payment.providerRef);

    if (status !== payment.status) {
      payment.status = status;
      if (status === 'paid') {
        payment.paidAt = new Date().toISOString();
        const renewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        this.subMgr.setSubscription(payment.userId, payment.plan, renewsAt);
        this.analytics?.track('payment_completed', {
          userId: payment.userId, plan: payment.plan,
          method: payment.method, amountIQD: payment.amountIQD,
        });
      }
      this._save();
    }
    return payment;
  }
}

module.exports = PaymentManager;
