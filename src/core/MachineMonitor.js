'use strict';
/**
 * MachineMonitor.js — مراقبة صحة الآلة وإرسال تنبيهات أوتوماتيكية
 * يراقب حالة الـ CNC ويكتشف المشاكل قبل حدوث الأعطال.
 */

const { EventEmitter } = require('events');

class MachineMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.thresholds = {
      maxAlarmCount:    options.maxAlarmCount    || 3,
      maxErrorRate:     options.maxErrorRate      || 0.1,   // 10% من الأوامر
      idleWarningMs:    options.idleWarningMs     || 30 * 60 * 1000, // 30 دقيقة
      reconnectAttempts: options.reconnectAttempts || 3,
    };

    this.stats = {
      totalCommands:  0,
      errors:         0,
      alarms:         [],
      connected:      false,
      lastActivity:   null,
      uptime:         0,
      startedAt:      null,
    };

    this._logs        = [];
    this._idleTimer   = null;
    this._uptimeTimer = null;
  }

  attach(cncConnector) {
    this.cnc = cncConnector;

    cncConnector.on('cnc-status', status => {
      this.stats.lastActivity = new Date().toISOString();
      this._resetIdleTimer();

      if (status.state === 'Alarm') {
        this._handleAlarm(status);
      }
      if (status.state === 'Idle' && !this.stats.connected) {
        this.stats.connected = true;
        this.stats.startedAt = this.stats.startedAt || new Date().toISOString();
        this._startUptimeTimer();
      }
    });

    cncConnector.on('cnc-response', data => {
      this.stats.totalCommands++;
      if (data.line && data.line.toLowerCase().startsWith('error')) {
        this.stats.errors++;
        this._checkErrorRate();
      }
    });

    cncConnector.on('cnc-alarm', data => this._handleAlarm(data));

    this._log('info', 'مراقب الآلة نشط');
    return this;
  }

  getHealthReport() {
    const errorRate = this.stats.totalCommands > 0
      ? this.stats.errors / this.stats.totalCommands
      : 0;

    const health = errorRate === 0 && this.stats.alarms.length === 0 ? 'excellent'
      : errorRate < 0.05 && this.stats.alarms.length < 2 ? 'good'
      : errorRate < 0.1  ? 'warning'
      : 'critical';

    return {
      health,
      connected:     this.stats.connected,
      uptime:        this.stats.uptime,
      totalCommands: this.stats.totalCommands,
      errors:        this.stats.errors,
      errorRate:     +(errorRate * 100).toFixed(2),
      alarmCount:    this.stats.alarms.length,
      recentAlarms:  this.stats.alarms.slice(-5),
      lastActivity:  this.stats.lastActivity,
      logs:          this._logs.slice(-50),
    };
  }

  resetStats() {
    this.stats.errors = 0;
    this.stats.alarms = [];
    this.stats.totalCommands = 0;
    this._log('info', 'تمت إعادة ضبط الإحصاءات');
  }

  _handleAlarm(data) {
    const alarm = { timestamp: new Date().toISOString(), data };
    this.stats.alarms.push(alarm);
    this._log('alarm', `تنبيه الآلة: ${JSON.stringify(data)}`);
    this.emit('machine-alarm', alarm);

    if (this.stats.alarms.length >= this.thresholds.maxAlarmCount) {
      this.emit('critical-alarm', { count: this.stats.alarms.length, alarms: this.stats.alarms });
      this._log('critical', `وصلت التنبيهات إلى الحد الأقصى (${this.stats.alarms.length})`);
    }
  }

  _checkErrorRate() {
    if (this.stats.totalCommands < 10) return;
    const rate = this.stats.errors / this.stats.totalCommands;
    if (rate >= this.thresholds.maxErrorRate) {
      this.emit('high-error-rate', { rate: +(rate * 100).toFixed(1), errors: this.stats.errors, total: this.stats.totalCommands });
      this._log('warning', `معدل الخطأ مرتفع: ${(rate * 100).toFixed(1)}%`);
    }
  }

  _resetIdleTimer() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      this.emit('machine-idle', { duration: this.thresholds.idleWarningMs });
      this._log('warning', 'الآلة خاملة لفترة طويلة');
    }, this.thresholds.idleWarningMs);
  }

  _startUptimeTimer() {
    if (this._uptimeTimer) return;
    this._uptimeTimer = setInterval(() => { this.stats.uptime += 60; }, 60000);
  }

  _log(level, message) {
    const entry = { level, message, timestamp: new Date().toISOString() };
    this._logs.push(entry);
    if (this._logs.length > 200) this._logs.shift();
  }

  destroy() {
    if (this._idleTimer)   clearTimeout(this._idleTimer);
    if (this._uptimeTimer) clearInterval(this._uptimeTimer);
  }
}

module.exports = MachineMonitor;
