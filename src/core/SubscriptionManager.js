'use strict';
/**
 * SubscriptionManager.js — إدارة خطط الاشتراك (Free / Pro / Enterprise)
 * يتحكم في الميزات المتاحة لكل مستخدم ويمكن ربطه بـ Stripe.
 */

// الأسعار بالدينار العراقي/شهر. أربع طبقات: مجاني + 3 مدفوعة (قرار المستخدم).
const PLANS = {
  free: {
    name: 'مجاني',
    price: 0,
    limits: {
      jobsPerMonth:    10,
      shapesPerJob:    50,
      batchSize:       1,
      aiOptimizations: 3,
      storageProjects: 5,
      webhooks:        0,
    },
    features: ['generate', 'import', 'export', 'preview'],
  },
  basic: {
    name: 'أساسي',
    price: 19000,
    limits: {
      jobsPerMonth:    100,
      shapesPerJob:    300,
      batchSize:       3,
      aiOptimizations: 20,
      storageProjects: 30,
      webhooks:        0,
    },
    features: ['generate', 'import', 'export', 'preview', 'cost', 'templates'],
  },
  pro: {
    name: 'احترافي',
    price: 39000,
    limits: {
      jobsPerMonth:    1000,
      shapesPerJob:    2000,
      batchSize:       20,
      aiOptimizations: 200,
      storageProjects: 200,
      webhooks:        5,
    },
    features: ['generate', 'import', 'export', 'preview', 'ai', 'batch', 'queue', 'cost', 'webhooks', 'templates'],
  },
  business: {
    name: 'أعمال',
    price: 150000,
    limits: {
      jobsPerMonth:    Infinity,
      shapesPerJob:    Infinity,
      batchSize:       100,
      aiOptimizations: Infinity,
      storageProjects: Infinity,
      webhooks:        50,
    },
    features: ['generate', 'import', 'export', 'preview', 'ai', 'batch', 'queue', 'cost', 'webhooks', 'templates', 'analytics', 'backup', 'monitor', 'api'],
  },
};

// ── تخزين دائم في Supabase (اختياري) ──
// يحتاج SUPABASE_SERVICE_KEY (service_role) ليتجاوز RLS ويكتب نيابةً عن الخادم.
// بدونه يعود المدير للتخزين الملفي (وضع التطوير).
const SUPA_URL    = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

class SubscriptionManager {
  constructor(dataPath) {
    const path = require('path');
    this.dataFile = dataPath || path.join(process.cwd(), 'data', 'subscriptions.json');
    this.cloud = !!(SUPA_URL && SERVICE_KEY);
    if (this.cloud) {
      // المصدر الدائم هو Supabase؛ نبدأ فارغين ثم hydrate() عند إقلاع الخادم
      this.data = {};
    } else {
      this._ensureDataDir();
      this.data = this._load();
    }
  }

  /* ── طبقة Supabase الدائمة (service_role — تتجاوز RLS) ── */
  async _cloudFetch(method, pathQ, body, prefer) {
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
      throw new Error(`subscriptions ${method} ${res.status}: ${t.slice(0, 150)}`);
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  }

  // يُستدعى مرة عند إقلاع الخادم: يحمّل كل الاشتراكات إلى الذاكرة
  async hydrate() {
    if (!this.cloud) return;
    const rows = await this._cloudFetch('GET', 'subscriptions?select=user_id,plan,renews_at,usage');
    const map = {};
    for (const r of rows || []) {
      map[r.user_id] = { plan: r.plan || 'free', renewsAt: r.renews_at || null, usage: r.usage || {} };
    }
    this.data = map;
  }

  // كتابة صف مستخدم للمخزن الدائم — خلفي، لا يُعطّل الاستجابة
  _persist(userId) {
    if (!this.cloud) { try { this._save(); } catch (_) {} return; }
    if (String(userId).startsWith('anon:')) return;   // لا نخزّن الضيوف (يُحدّدون بالـ IP)
    const u = this.data[userId];
    if (!u) return;
    this._cloudFetch('POST', 'subscriptions', {
      user_id:    userId,
      plan:       u.plan || 'free',
      renews_at:  u.renewsAt || null,
      usage:      u.usage || {},
      updated_at: new Date().toISOString(),
    }, 'resolution=merge-duplicates,return=minimal')
      .catch(e => console.error('[subscriptions] persist failed:', e.message));
  }

  _ensureDataDir() {
    const fs   = require('fs');
    const path = require('path');
    const dir  = require('path').dirname(this.dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _load() {
    const fs = require('fs');
    try {
      return fs.existsSync(this.dataFile) ? JSON.parse(fs.readFileSync(this.dataFile, 'utf8')) : {};
    } catch { return {}; }
  }

  _save() {
    require('fs').writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
  }

  getSubscription(userId) {
    return this.data[userId] || { plan: 'free', usage: {}, renewsAt: null };
  }

  setSubscription(userId, plan, renewsAt = null) {
    if (!PLANS[plan]) throw new Error(`خطة غير صالحة: ${plan}`);
    this.data[userId] = {
      plan,
      renewsAt: renewsAt || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      usage:    {},
      updatedAt: new Date().toISOString(),
    };
    this._persist(userId);
    return this.data[userId];
  }

  hasFeature(userId, feature) {
    const sub  = this.getSubscription(userId);
    const plan = PLANS[sub.plan] || PLANS.free;
    return plan.features.includes(feature);
  }

  checkLimit(userId, resource, amount = 1) {
    const sub   = this.getSubscription(userId);
    const plan  = PLANS[sub.plan] || PLANS.free;
    const limit = plan.limits[resource];
    if (limit === undefined) return true;
    if (limit === Infinity) return true;

    const monthKey = new Date().toISOString().slice(0, 7);
    const usageKey = `${resource}_${monthKey}`;
    const current  = (sub.usage[usageKey] || 0);

    return (current + amount) <= limit;
  }

  incrementUsage(userId, resource, amount = 1) {
    if (!this.data[userId]) this.data[userId] = { plan: 'free', usage: {}, renewsAt: null };
    const monthKey = new Date().toISOString().slice(0, 7);
    const usageKey = `${resource}_${monthKey}`;
    this.data[userId].usage[usageKey] = (this.data[userId].usage[usageKey] || 0) + amount;
    this._persist(userId);
  }

  getUsageSummary(userId) {
    const sub  = this.getSubscription(userId);
    const plan = PLANS[sub.plan] || PLANS.free;
    const monthKey = new Date().toISOString().slice(0, 7);

    const summary = {};
    for (const [resource, limit] of Object.entries(plan.limits)) {
      const usageKey = `${resource}_${monthKey}`;
      const used = sub.usage[usageKey] || 0;
      summary[resource] = { used, limit: limit === Infinity ? 'unlimited' : limit, remaining: limit === Infinity ? 'unlimited' : Math.max(0, limit - used) };
    }
    return { plan: sub.plan, planName: plan.name, price: plan.price, renewsAt: sub.renewsAt, usage: summary };
  }

  listPlans() {
    return Object.entries(PLANS).map(([id, plan]) => ({ id, ...plan }));
  }
}

module.exports = SubscriptionManager;
