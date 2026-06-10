'use strict';
/**
 * WebhookManager.js — إرسال إشعارات HTTP تلقائية عند اكتمال المهام
 * يتيح ربط النظام بـ Slack, Discord, Zapier, أو أي نظام خارجي.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

class WebhookManager {
  constructor(dataDir) {
    this.dataFile = path.join(dataDir || path.join(process.cwd(), 'data'), 'webhooks.json');
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.hooks = this._load();
  }

  _load() {
    try {
      return fs.existsSync(this.dataFile) ? JSON.parse(fs.readFileSync(this.dataFile, 'utf8')) : [];
    } catch { return []; }
  }

  _save() {
    fs.writeFileSync(this.dataFile, JSON.stringify(this.hooks, null, 2));
  }

  register(hook) {
    if (!hook.url)   throw new Error('url مطلوب');
    if (!hook.event) throw new Error('event مطلوب');
    this._validateUrl(hook.url);

    const entry = {
      id:        `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      url:        hook.url,
      event:      hook.event,
      secret:     hook.secret     || null,
      enabled:    hook.enabled    !== false,
      name:       hook.name       || hook.url,
      createdAt:  new Date().toISOString(),
      lastFired:  null,
      lastStatus: null,
    };
    this.hooks.push(entry);
    this._save();
    return entry;
  }

  update(id, updates) {
    const idx = this.hooks.findIndex(h => h.id === id);
    if (idx === -1) throw new Error('Webhook غير موجود');
    if (updates.url) this._validateUrl(updates.url);
    Object.assign(this.hooks[idx], updates);
    this._save();
    return this.hooks[idx];
  }

  delete(id) {
    const idx = this.hooks.findIndex(h => h.id === id);
    if (idx === -1) throw new Error('Webhook غير موجود');
    this.hooks.splice(idx, 1);
    this._save();
  }

  list() {
    return this.hooks.map(h => ({ ...h, secret: h.secret ? '***' : null }));
  }

  async fire(eventType, payload = {}) {
    const matching = this.hooks.filter(h => h.enabled && (h.event === eventType || h.event === '*'));
    const results  = [];

    for (const hook of matching) {
      const body = JSON.stringify({
        event:     eventType,
        timestamp: new Date().toISOString(),
        data:      payload,
      });

      try {
        const status = await this._post(hook.url, body, hook.secret);
        hook.lastFired  = new Date().toISOString();
        hook.lastStatus = status;
        results.push({ id: hook.id, status, success: status >= 200 && status < 300 });
      } catch (err) {
        hook.lastStatus = 0;
        hook.lastFired  = new Date().toISOString();
        results.push({ id: hook.id, status: 0, error: err.message, success: false });
      }
    }

    if (results.length > 0) this._save();
    return results;
  }

  async test(id) {
    const hook = this.hooks.find(h => h.id === id);
    if (!hook) throw new Error('Webhook غير موجود');
    return this.fire(hook.event, { test: true, message: 'اختبار Webhook من دقة قلم' });
  }

  _validateUrl(url) {
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('بروتوكول غير مدعوم');
    } catch {
      throw new Error(`URL غير صالح: ${url}`);
    }
  }

  _post(url, body, secret) {
    return new Promise((resolve, reject) => {
      const parsed  = new URL(url);
      const lib     = parsed.protocol === 'https:' ? https : http;
      const headers = {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'DiqqatQalam-Webhook/1.0',
      };
      if (secret) headers['X-Webhook-Secret'] = secret;

      const req = lib.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST', headers }, res => {
        resolve(res.statusCode);
        res.resume();
      });
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = WebhookManager;
