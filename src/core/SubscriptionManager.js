'use strict';
/**
 * SubscriptionManager.js — إدارة خطط الاشتراك (Free / Pro / Enterprise)
 * يتحكم في الميزات المتاحة لكل مستخدم ويمكن ربطه بـ Stripe.
 */

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
  pro: {
    name: 'احترافي',
    price: 29,
    limits: {
      jobsPerMonth:    500,
      shapesPerJob:    1000,
      batchSize:       10,
      aiOptimizations: 100,
      storageProjects: 100,
      webhooks:        5,
    },
    features: ['generate', 'import', 'export', 'preview', 'ai', 'batch', 'queue', 'cost', 'webhooks', 'templates'],
  },
  enterprise: {
    name: 'مؤسسي',
    price: 199,
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

class SubscriptionManager {
  constructor(dataPath) {
    const fs   = require('fs');
    const path = require('path');
    this.dataFile = dataPath || path.join(process.cwd(), 'data', 'subscriptions.json');
    this._ensureDataDir();
    this.data = this._load();
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
    this._save();
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
    this._save();
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
