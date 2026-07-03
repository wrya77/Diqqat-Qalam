'use strict';
/**
 * revenue.test.js — تسجيل الأرباح وسلسلة تأكيد الدفع
 *
 * يغطي الأعطال التي وُجدت في المراجعة:
 *  1. Analytics لم يكن يحتسب الإيراد (اسم الحدث والحقل غير متطابقين مع PaymentManager)
 *  2. الاشتراك لم يكن ينتهي أبداً (getSubscription يتجاهل renewsAt)
 *  3. سجلّ الأرباح في Google Sheets (GSHEET_WEBHOOK_URL) — no-op بلا إعداد
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const Analytics           = require('../src/core/Analytics');
const SubscriptionManager = require('../src/core/SubscriptionManager');
const GoogleSheets        = require('../src/notify/GoogleSheets');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dq-test-'));

describe('Analytics — تسجيل الإيراد', () => {
  test("حدث 'payment' بحقل amount يُحتسب إيراداً", () => {
    const a = new Analytics(tmpDir());
    a.track('payment', { amount: 39000, currency: 'IQD' });
    expect(a.data.totals.revenue).toBe(39000);
    const day = new Date().toISOString().slice(0, 10);
    expect(a.data.dailyStats[day].revenue).toBe(39000);
  });

  test("الاسم القديم 'payment_completed' بحقل amountIQD يُحتسب أيضاً (توافق خلفي)", () => {
    const a = new Analytics(tmpDir());
    a.track('payment_completed', { amountIQD: 19000 });
    expect(a.data.totals.revenue).toBe(19000);
  });

  test('مبلغ غير رقمي لا يُفسد المجموع', () => {
    const a = new Analytics(tmpDir());
    a.track('payment', { amount: 'oops' });
    a.track('payment', { amount: 5000 });
    expect(a.data.totals.revenue).toBe(5000);
  });
});

describe('SubscriptionManager — انتهاء الاشتراك', () => {
  const mk = () => {
    const m = new SubscriptionManager(path.join(tmpDir(), 'subs.json'));
    m.cloud = false; // اختبار محلي ملفي
    return m;
  };

  test('اشتراك ساري المفعول يبقى على خطته', () => {
    const m = mk();
    const future = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    m.setSubscription('u1', 'pro', future);
    expect(m.getSubscription('u1').plan).toBe('pro');
    expect(m.hasFeature('u1', 'ai')).toBe(true);
  });

  test('اشتراك منتهٍ (بعد مهلة السماح) يُعامل كمجاني', () => {
    const m = mk();
    const past = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    m.setSubscription('u2', 'pro', past);
    const sub = m.getSubscription('u2');
    expect(sub.plan).toBe('free');
    expect(sub.expired).toBe(true);
    expect(m.hasFeature('u2', 'ai')).toBe(false);
  });

  test('داخل مهلة السماح (3 أيام) يبقى على خطته', () => {
    const m = mk();
    const yesterday = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
    m.setSubscription('u3', 'basic', yesterday);
    expect(m.getSubscription('u3').plan).toBe('basic');
  });

  test('دفعة تجديد تعيد الخطة بعد الانتهاء', () => {
    const m = mk();
    const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    m.setSubscription('u4', 'pro', past);
    expect(m.getSubscription('u4').plan).toBe('free');
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    m.setSubscription('u4', 'pro', future);
    expect(m.getSubscription('u4').plan).toBe('pro');
  });

  test('renewsAt غير صالح لا يُسقط الاشتراك (fail-open)', () => {
    const m = mk();
    m.setSubscription('u5', 'pro', 'not-a-date');
    expect(m.getSubscription('u5').plan).toBe('pro');
  });
});

describe('GoogleSheets — سجلّ الأرباح', () => {
  const origFetch = global.fetch;
  const origUrl   = process.env.GSHEET_WEBHOOK_URL;
  afterEach(() => {
    global.fetch = origFetch;
    if (origUrl === undefined) delete process.env.GSHEET_WEBHOOK_URL;
    else process.env.GSHEET_WEBHOOK_URL = origUrl;
  });

  test('بلا GSHEET_WEBHOOK_URL يكون no-op ولا يستدعي الشبكة', async () => {
    delete process.env.GSHEET_WEBHOOK_URL;
    global.fetch = jest.fn();
    const g = new GoogleSheets();
    const r = await g.logPayment({ id: 'p1', amountIQD: 1000 });
    expect(r.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('مع الرابط يرسل POST بصف الدفعة الكامل', async () => {
    process.env.GSHEET_WEBHOOK_URL = 'https://script.google.com/macros/s/xyz/exec';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const g = new GoogleSheets();
    const r = await g.logPayment({
      id: 'pay_1', userId: 'u1', plan: 'pro_monthly',
      method: 'fib', amountIQD: 39000, status: 'paid',
      paidAt: '2026-07-03T10:00:00.000Z',
    });
    expect(r.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(process.env.GSHEET_WEBHOOK_URL);
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      paymentId: 'pay_1', plan: 'pro_monthly', method: 'fib',
      amountIQD: 39000, status: 'paid', date: '2026-07-03T10:00:00.000Z',
    });
  });

  test('فشل الشبكة لا يرمي — يعيد ok:false فقط', async () => {
    process.env.GSHEET_WEBHOOK_URL = 'https://script.google.com/macros/s/xyz/exec';
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const g = new GoogleSheets();
    const r = await g.logPayment({ id: 'p2', amountIQD: 1000 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('offline');
  });
});

describe('PaymentManager — تأكيد الدفع يسجّل الإيراد ويُخطر', () => {
  const PaymentManager = require('../src/payments/PaymentManager');

  const mkMgr = ({ telegram, sheets } = {}) => {
    const subMgr = new SubscriptionManager(path.join(tmpDir(), 'subs.json'));
    subMgr.cloud = false;
    const analytics = new Analytics(tmpDir());
    const mgr = new PaymentManager(subMgr, analytics, { telegram, sheets });
    // خارج بيئة العمل نعمل ملفياً — وجّه ملف الدفعات لمجلد مؤقت
    mgr.dataFile = path.join(tmpDir(), 'payments.json');
    return { mgr, subMgr, analytics };
  };

  const paidProvider = { getStatus: async () => ({ status: 'paid', paidAmount: 39000 }) };

  test('عند السداد: ترقية + إيراد مُسجَّل + إشعار Sheets وTelegram', async () => {
    const sheets   = { configured: true, logPayment: jest.fn().mockResolvedValue({ ok: true }) };
    const telegram = { configured: true, send: jest.fn().mockResolvedValue({ ok: true }) };
    const { mgr, subMgr, analytics } = mkMgr({ telegram, sheets });
    mgr.providers.fib = paidProvider;

    const payment = {
      id: 'pay_t1', userId: 'u9', plan: 'pro_monthly', method: 'fib',
      amountIQD: 39000, providerRef: 'ref1', status: 'pending',
      createdAt: new Date().toISOString(), paidAt: null,
    };
    mgr._payments.push(payment);

    const updated = await mgr.reconcile(payment);
    expect(updated.status).toBe('paid');
    expect(subMgr.getSubscription('u9').plan).toBe('pro');
    expect(analytics.data.totals.revenue).toBe(39000);
    expect(sheets.logPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'pay_t1' }));
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(telegram.send.mock.calls[0][0]).toContain('39,000');
  });

  test('reconcile مكرر لا يكرر الإيراد ولا الإشعار (idempotent)', async () => {
    const sheets = { configured: true, logPayment: jest.fn().mockResolvedValue({ ok: true }) };
    const { mgr, analytics } = mkMgr({ sheets });
    mgr.providers.fib = paidProvider;

    const payment = {
      id: 'pay_t2', userId: 'u10', plan: 'basic', method: 'fib',
      amountIQD: 19000, providerRef: 'ref2', status: 'pending',
      createdAt: new Date().toISOString(), paidAt: null,
    };
    mgr._payments.push(payment);

    await mgr.reconcile(payment);
    await mgr.reconcile(payment);
    expect(analytics.data.totals.revenue).toBe(19000);
    expect(sheets.logPayment).toHaveBeenCalledTimes(1);
  });
});
