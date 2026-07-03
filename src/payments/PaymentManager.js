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

// ── تخزين دائم في Supabase (service_role — يتجاوز RLS) ──
// حرج على serverless: سجلّ الدفعة يجب أن يكون مرئياً لكل النسخ، وإلا فإن callback
// المزوّد الذي يصل نسخة أخرى لا يجد الدفعة (find=null) فلا تتم الترقية — والمستخدم
// يكون قد دفع فعلاً. بدون مفاتيح Supabase نعود للتخزين الملفي (تطوير محلي فقط).
const SUPA_URL    = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CLOUD       = !!(SUPA_URL && SERVICE_KEY);

async function cloudFetch(method, pathQ, body, prefer) {
  const headers = {
    apikey:         SERVICE_KEY,
    Authorization:  `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPA_URL}/rest/v1/${pathQ}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`payments ${method} ${res.status}: ${t.slice(0, 150)}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

const toRow = (r) => ({
  id: r.id, user_id: r.userId, plan: r.plan, method: r.method,
  amount_iqd: r.amountIQD, provider_ref: r.providerRef, status: r.status,
  created_at: r.createdAt, paid_at: r.paidAt,
});
const fromRow = (row) => row && ({
  id: row.id, userId: row.user_id, plan: row.plan, method: row.method,
  amountIQD: row.amount_iqd, providerRef: row.provider_ref, status: row.status,
  createdAt: row.created_at, paidAt: row.paid_at,
});

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
  constructor(subscriptionManager, analytics, notifiers = {}) {
    this.subMgr    = subscriptionManager;
    this.analytics = analytics;
    // إشعارات عند تأكيد الدفع (اختيارية): { telegram, sheets } — كلاهما لا يرمي
    this.notify    = notifiers;
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
    // المخزن الدائم هو Supabase في الإنتاج؛ الملف ذاكرة محلية فقط ويجب ألا يُسقط الطلب
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataFile, JSON.stringify(this._payments, null, 2), 'utf8');
    } catch (e) {
      if (e && e.code !== 'EROFS') console.error('[payments] local save failed:', e.message);
    }
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

    // المخزن الدائم عبر النسخ: نُدرج الصف في Supabase ليجده أي callback لاحقاً
    if (CLOUD) {
      try { await cloudFetch('POST', 'payments', toRow(record), 'return=minimal'); }
      catch (e) { console.error('[payments] cloud insert failed:', e.message); }
    }

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

  // البحث عبر Supabase أولاً (المصدر الدائم المرئي لكل النسخ)، ثم احتياطياً في الذاكرة
  async find(id) {
    if (!id) return null;
    if (CLOUD) {
      try {
        const rows = await cloudFetch('GET', `payments?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
        if (rows && rows[0]) return fromRow(rows[0]);
      } catch (e) { console.error('[payments] cloud find failed:', e.message); }
    }
    return this._payments.find(p => p.id === id) || null;
  }

  async findByRef(ref) {
    if (!ref) return null;
    if (CLOUD) {
      try {
        const rows = await cloudFetch('GET', `payments?provider_ref=eq.${encodeURIComponent(ref)}&select=*&limit=1`);
        if (rows && rows[0]) return fromRow(rows[0]);
      } catch (e) { console.error('[payments] cloud findByRef failed:', e.message); }
    }
    return this._payments.find(p => p.providerRef === ref) || null;
  }

  /**
   * التحقق من حالة الدفعة لدى المزوّد وترقية الاشتراك عند السداد.
   * آمن للاستدعاء المتكرر (من polling الواجهة أو callback المزوّد).
   */
  async reconcile(payment) {
    if (!payment) throw new Error('دفعة غير موجودة');
    if (payment.status === 'paid') return payment;   // مؤكدة سابقاً

    const provider = this.providers[payment.method];
    const result   = await provider.getStatus(payment.providerRef);
    // دعم الشكلين: نص (قديم) أو كائن { status, paidAmount }
    let status       = typeof result === 'string' ? result : result.status;
    const paidAmount = (result && typeof result === 'object') ? result.paidAmount : undefined;

    // تحقق من المبلغ: إن أبلغ المزوّد بمبلغ أقل من المتوقع، لا نرقّي (نُبقيها معلّقة
    // للمراجعة). fail-open متعمّد حين لا يوفّر المزوّد المبلغ (undefined) كي لا
    // نعطّل ترقية مشروعة — تُشدَّد لاحقاً بعد تأكيد أسماء حقول المزوّد الفعلية.
    if (status === 'paid' && Number.isFinite(paidAmount) && (paidAmount + 1e-6) < payment.amountIQD) {
      console.error(`[payments] مبلغ غير مطابق للدفعة ${payment.id}: مدفوع ${paidAmount} < متوقع ${payment.amountIQD} — لن تتم الترقية`);
      status = 'pending';
    }

    if (status !== payment.status) {
      payment.status = status;
      if (status === 'paid') {
        payment.paidAt = new Date().toISOString();
        const price    = PLAN_PRICES[payment.plan];
        const days     = price?.period || 30;
        const planName = price?.plan   || payment.plan.split('_')[0];
        const renewsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        this.subMgr.setSubscription(payment.userId, planName, renewsAt);
        // اسم الحدث 'payment' هو ما يحتسبه Analytics إيراداً (كان 'payment_completed'
        // فلا تُسجَّل الأرباح إطلاقاً). التتبّع لا يجوز أن يُفشل ترقية مدفوعة.
        try {
          this.analytics?.track('payment', {
            amount: payment.amountIQD, currency: 'IQD',
            userId: payment.userId, plan: payment.plan,
            method: payment.method, paymentId: payment.id,
          });
        } catch (e) { console.error('[payments] analytics track failed:', e.message); }
        this._notifyPaid(payment);
      }
      // حدّث الذاكرة المحلية إن وُجد الصف فيها
      const local = this._payments.find(p => p.id === payment.id);
      if (local) { local.status = payment.status; local.paidAt = payment.paidAt; }
      this._save();
      // حدّث المخزن الدائم ليرى كل النسخ الحالة الجديدة (idempotent)
      if (CLOUD) {
        try {
          await cloudFetch('PATCH', `payments?id=eq.${encodeURIComponent(payment.id)}`,
            { status: payment.status, paid_at: payment.paidAt }, 'return=minimal');
        } catch (e) { console.error('[payments] cloud update failed:', e.message); }
      }
    }
    return payment;
  }

  /**
   * إشعارات تأكيد الدفع — تُطلق مرة واحدة عند الانتقال إلى paid (داخل reconcile).
   * fire-and-forget: لا ننتظرها ولا يجوز أن تُفشل الاستجابة أو الترقية.
   */
  _notifyPaid(payment) {
    const price = PLAN_PRICES[payment.plan];
    if (this.notify.sheets?.configured) {
      this.notify.sheets.logPayment(payment)
        .catch(e => console.error('[payments] gsheet notify failed:', e.message));
    }
    if (this.notify.telegram?.configured) {
      const amount = Number(payment.amountIQD || 0).toLocaleString('en-US');
      this.notify.telegram.send(
        `💰 <b>دفعة جديدة مؤكَّدة</b>\n` +
        `الخطة: ${price?.name || payment.plan}\n` +
        `المبلغ: ${amount} د.ع\n` +
        `الطريقة: ${payment.method}\n` +
        `<code>${payment.id}</code>`
      ).catch(e => console.error('[payments] telegram notify failed:', e.message));
    }
  }
}

module.exports = PaymentManager;
