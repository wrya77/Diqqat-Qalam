'use strict';
const PaymentManager = require('../src/payments/PaymentManager');

/**
 * PaymentManager handles money and grants paid subscriptions. These tests
 * pin the guard rails: unknown/unconfigured methods are rejected, and
 * reconcile() upgrades exactly once (idempotent) even under repeat callbacks.
 */
function makePM() {
  const subMgr    = { setSubscription: jest.fn() };
  const analytics = { track: jest.fn() };
  const pm = new PaymentManager(subMgr, analytics);
  pm._save = () => {};   // never touch disk in tests
  pm._payments = [];
  return { pm, subMgr, analytics };
}

// A stand-in provider that reports as configured and is fully controllable.
function fakeProvider(overrides = {}) {
  return {
    id: 'fib', name: 'FIB', configured: true,
    createPayment: async () => ({ ref: 'REF1', payUrl: 'https://pay.example/REF1', qr: 'QR' }),
    getStatus: async () => 'pending',
    ...overrides,
  };
}

describe('PaymentManager', () => {
  test('methods() exposes providers and priced plans', () => {
    const { pm } = makePM();
    const m = pm.methods();
    expect(Array.isArray(m.methods)).toBe(true);
    expect(m.methods.map(x => x.id)).toEqual(expect.arrayContaining(['fib', 'card', 'zaincash']));
    const pro = m.plans.find(p => p.id === 'pro');
    expect(pro).toMatchObject({ iqd: 39000 });
  });

  test('createCheckout rejects an unknown plan', async () => {
    const { pm } = makePM();
    await expect(pm.createCheckout({ userId: 'u1', plan: 'ghost', method: 'fib', baseUrl: 'http://x' }))
      .rejects.toThrow(/خطة غير معروفة/);
  });

  test('createCheckout rejects an unknown method', async () => {
    const { pm } = makePM();
    await expect(pm.createCheckout({ userId: 'u1', plan: 'pro', method: 'bitcoin', baseUrl: 'http://x' }))
      .rejects.toThrow(/طريقة دفع غير معروفة/);
  });

  test('createCheckout refuses an unconfigured provider with code NOT_CONFIGURED', async () => {
    const { pm } = makePM();   // default providers have no env keys → unconfigured
    await expect(pm.createCheckout({ userId: 'u1', plan: 'pro', method: 'fib', baseUrl: 'http://x' }))
      .rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  test('createCheckout stores a pending record and returns a pay URL', async () => {
    const { pm } = makePM();
    pm.providers.fib = fakeProvider();
    const res = await pm.createCheckout({ userId: 'u1', email: 'a@b.com', plan: 'pro', method: 'fib', baseUrl: 'http://x' });

    expect(res.paymentId).toMatch(/^pay_/);
    expect(res.amountIQD).toBe(39000);
    expect(res.payUrl).toBe('https://pay.example/REF1');

    const stored = await pm.find(res.paymentId);
    expect(stored).toMatchObject({ userId: 'u1', plan: 'pro', status: 'pending', providerRef: 'REF1' });
    expect(await pm.findByRef('REF1')).toBe(stored);
  });

  test('reconcile upgrades the subscription once and is idempotent', async () => {
    const { pm, subMgr } = makePM();
    pm.providers.fib = fakeProvider({ getStatus: async () => 'paid' });
    const res = await pm.createCheckout({ userId: 'u1', plan: 'pro', method: 'fib', baseUrl: 'http://x' });
    const rec = await pm.find(res.paymentId);

    await pm.reconcile(rec);
    expect(rec.status).toBe('paid');
    expect(rec.paidAt).toBeTruthy();
    expect(subMgr.setSubscription).toHaveBeenCalledTimes(1);
    expect(subMgr.setSubscription).toHaveBeenCalledWith('u1', 'pro', expect.any(String));

    // A second callback/poll must NOT grant another period.
    await pm.reconcile(rec);
    expect(subMgr.setSubscription).toHaveBeenCalledTimes(1);
  });

  test('reconcile leaves a still-pending payment untouched', async () => {
    const { pm, subMgr } = makePM();
    pm.providers.fib = fakeProvider({ getStatus: async () => 'pending' });
    const res = await pm.createCheckout({ userId: 'u1', plan: 'pro', method: 'fib', baseUrl: 'http://x' });
    const rec = await pm.find(res.paymentId);

    await pm.reconcile(rec);
    expect(rec.status).toBe('pending');
    expect(subMgr.setSubscription).not.toHaveBeenCalled();
  });

  test('yearly plan maps to a 365-day period on upgrade', async () => {
    const { pm, subMgr } = makePM();
    pm.providers.fib = fakeProvider({ getStatus: async () => 'paid' });
    const res = await pm.createCheckout({ userId: 'u9', plan: 'pro_yearly', method: 'fib', baseUrl: 'http://x' });
    await pm.reconcile(await pm.find(res.paymentId));

    const renewsAt = subMgr.setSubscription.mock.calls[0][2];
    const days = (new Date(renewsAt) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(360);
    expect(subMgr.setSubscription).toHaveBeenCalledWith('u9', 'pro', expect.any(String));
  });
});
