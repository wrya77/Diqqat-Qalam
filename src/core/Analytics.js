'use strict';
/**
 * Analytics.js — تتبع إحصاءات الاستخدام وتوليد تقارير الأداء
 * يوفر بيانات قيّمة لتحسين الأرباح واتخاذ القرارات.
 */

const fs   = require('fs');
const path = require('path');

class Analytics {
  constructor(dataDir) {
    this.dataFile = path.join(dataDir || path.join(process.cwd(), 'data'), 'analytics.json');
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) { console.error('[analytics] mkdir failed:', e.message); }
    this.data = this._load();
  }

  _load() {
    try {
      return fs.existsSync(this.dataFile)
        ? JSON.parse(fs.readFileSync(this.dataFile, 'utf8'))
        : { events: [], dailyStats: {}, totals: { jobs: 0, shapes: 0, timeSavedMin: 0, revenue: 0 } };
    } catch { return { events: [], dailyStats: {}, totals: { jobs: 0, shapes: 0, timeSavedMin: 0, revenue: 0 } }; }
  }

  _save() {
    // فشل الكتابة (نظام ملفات للقراءة فقط مثلاً) يجب ألا يُفشل track() —
    // track() يُستدعى داخل مسار تأكيد الدفع وترقية الاشتراك
    try {
      if (this.data.events.length > 5000) this.data.events = this.data.events.slice(-5000);
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
    } catch (e) {
      if (e && e.code !== 'EROFS') console.error('[analytics] save failed:', e.message);
    }
  }

  track(eventType, payload = {}) {
    const event = {
      type:      eventType,
      timestamp: new Date().toISOString(),
      day:       new Date().toISOString().slice(0, 10),
      ...payload,
    };
    this.data.events.push(event);

    const day = event.day;
    if (!this.data.dailyStats[day]) {
      this.data.dailyStats[day] = { jobs: 0, shapes: 0, imports: 0, exports: 0, aiCalls: 0, errors: 0, revenue: 0 };
    }

    switch (eventType) {
      case 'job_generated':
        this.data.dailyStats[day].jobs++;
        this.data.dailyStats[day].shapes += (payload.shapesCount || 0);
        this.data.totals.jobs++;
        this.data.totals.shapes += (payload.shapesCount || 0);
        this.data.totals.timeSavedMin += (payload.timeSavedMin || 0);
        break;
      case 'file_imported':  this.data.dailyStats[day].imports++;  break;
      case 'file_exported':  this.data.dailyStats[day].exports++;  break;
      case 'ai_called':      this.data.dailyStats[day].aiCalls++;   break;
      case 'error':          this.data.dailyStats[day].errors++;    break;
      case 'payment':
      case 'payment_completed': {
        // يقبل الاسمين والحقلين — عدم التطابق سابقاً كان يعني أن الإيرادات لا تُسجَّل أبداً
        const amount = Number(payload.amount ?? payload.amountIQD) || 0;
        this.data.dailyStats[day].revenue += amount;
        this.data.totals.revenue += amount;
        break;
      }
    }

    this._save();
    return event;
  }

  getReport(days = 30) {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const dayStats = Object.entries(this.data.dailyStats)
      .filter(([d]) => d >= cutoff)
      .sort(([a], [b]) => a.localeCompare(b));

    const periodTotals = dayStats.reduce((acc, [, s]) => {
      acc.jobs    += s.jobs;
      acc.shapes  += s.shapes;
      acc.imports += s.imports;
      acc.exports += s.exports;
      acc.aiCalls += s.aiCalls;
      acc.errors  += s.errors;
      acc.revenue += s.revenue;
      return acc;
    }, { jobs: 0, shapes: 0, imports: 0, exports: 0, aiCalls: 0, errors: 0, revenue: 0 });

    const avgJobsPerDay = dayStats.length > 0 ? (periodTotals.jobs / dayStats.length).toFixed(1) : 0;

    return {
      period:       `${days} يوماً`,
      generatedAt:  new Date().toISOString(),
      periodTotals,
      avgJobsPerDay,
      allTimeTotals: this.data.totals,
      dailyBreakdown: Object.fromEntries(dayStats),
      topDays: dayStats.sort(([, a], [, b]) => b.jobs - a.jobs).slice(0, 5).map(([d, s]) => ({ date: d, ...s })),
    };
  }

  clearOld(daysToKeep = 90) {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 3600 * 1000).toISOString();
    this.data.events = this.data.events.filter(e => e.timestamp >= cutoff);
    const cutoffDay = cutoff.slice(0, 10);
    for (const day of Object.keys(this.data.dailyStats)) {
      if (day < cutoffDay) delete this.data.dailyStats[day];
    }
    this._save();
  }
}

module.exports = Analytics;
