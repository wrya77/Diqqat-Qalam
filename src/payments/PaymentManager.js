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
const { FIBProvider, CardProvider, ZainCashProvider } = require('./providers');

// أسعار الخطط بالدينار العراقي — شهري وسنوي (20% خصم للسنوي)
const PLAN_PRICES = {
  // شهري
  basic:           { iqd: 19000,    usd: 13,  plan: 'basic',    period: 30,  name: 'أساسي — شهري'   },
  pro:             { iqd: 39000,    usd: 27,  plan: 'pro',      period: 30,  name: 'احترافي — شهري'  },
  business:        { iqd: 150000,   usd: 103, plan: 'business', period: 30,  name: 'أعمال — شهري'    },
  basic_monthly:   { iqd: 19000,    usd: 13,  plan: 'basic',    period: 30,  name: 'أساسي — شهري'   },
  pro_monthly:     { iqd: 39000,    usd: 27,  plan: 'pro',      period: 30,  name: 'احترافي — شهري'  },
  business_monthly:{ iqd: 150000,   usd: 103, plan: 'business', period: 30,  name: 'أعمال — شهري'    },
  // سنوي (12 × السعر الشهري × 0.8)
  basic_yearly:    { iqd: 182400,   usd: 125, plan: 'basic',    period: 365, name: 'أساسي — سنوي'    },
  pro_yearly:      { iqd: 374400,   usd: 256, plan: 'pro',      period: 365, name: 'احترافي — سنوي'   },
  business_yearly: { iqd: 1440000,  usd: 986, plan: 'business', period: 365, name: 'أعمال — سنوي'    },
};

class PaymentManager {
  constructor(subscriptionManager, analytics) {
    this.subMgr    = subscriptionManager;
    this.analytics = analytics;
    this.dataFile  = path.join(process.cwd(), 'data', 'payments.json');
    this.providers = {
      fib:      new FIBProvider(),
      card:     new CardProvider(),
      zaincash: new ZainCashProvider(),
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
    } else if (method === 'zaincash') {
      created = await provider.createPayment({
        amountIQD:   price.iqd,
        description,
        orderId:     id,
        callbackUrl: `${baseUrl}/api/payments/callback/zaincash?pid=${id}`,
      });
    } else {
      created = await provider.createPayment({
        amount:      price.iqd,
        description,
        cartId:      id,
        callbackUrl: `${baseUrl}/api/payments/callback/card`,
        returnUrl:   `${baseUrl}/checkout?payment=${id}`,
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
        const price    = PLAN_PRICES[payment.plan];
        const days     = price?.period || 30;
        const planName = price?.plan   || payment.plan.split('_')[0];
        const renewsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        this.subMgr.setSubscription(payment.userId, planName, renewsAt);
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
