'use strict';
/**
 * JobQueue.js — نظام قائمة انتظار المهام الأوتوماتيكية
 * يُنفّذ مهام G-Code متعددة بالتسلسل دون تدخل بشري.
 */

const { EventEmitter } = require('events');

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.queue   = [];
    this.running = false;
    this.current = null;
    this.history = [];
  }

  enqueue(job) {
    if (!job || !job.gcode) throw new Error('المهمة تتطلب حقل gcode');
    const entry = {
      id:        `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name:      job.name      || 'مهمة بدون اسم',
      gcode:     job.gcode,
      config:    job.config    || {},
      priority:  job.priority  || 0,
      createdAt: new Date().toISOString(),
      status:    'pending',
      progress:  0,
      result:    null,
    };
    this.queue.push(entry);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.emit('job-queued', { id: entry.id, name: entry.name, position: this.queue.length });
    return entry;
  }

  dequeue(id) {
    const idx = this.queue.findIndex(j => j.id === id);
    if (idx === -1) throw new Error('المهمة غير موجودة في القائمة');
    const [removed] = this.queue.splice(idx, 1);
    this.emit('job-removed', { id: removed.id });
    return removed;
  }

  getStatus() {
    return {
      running:     this.running,
      currentJob:  this.current ? { id: this.current.id, name: this.current.name, progress: this.current.progress } : null,
      queued:      this.queue.length,
      completed:   this.history.filter(h => h.status === 'done').length,
      failed:      this.history.filter(h => h.status === 'error').length,
      queue:       this.queue.map(j => ({ id: j.id, name: j.name, priority: j.priority, status: j.status })),
      history:     this.history.slice(-20).reverse(),
    };
  }

  // تشغيل المهام بالتسلسل عبر CNC connector
  async start(cncConnector) {
    if (this.running) return;
    this.running = true;
    this.emit('queue-started');

    while (this.queue.length > 0 && this.running) {
      const job = this.queue.shift();
      this.current = job;
      job.status   = 'running';
      job.startedAt = new Date().toISOString();
      this.emit('job-started', { id: job.id, name: job.name });

      try {
        if (!cncConnector || !cncConnector.isConnected()) {
          throw new Error('الآلة غير متصلة');
        }

        const lines = job.gcode.split('\n').filter(l => l.trim());
        let done = 0;
        for (const line of lines) {
          await cncConnector.sendLine(line);
          done++;
          job.progress = Math.round((done / lines.length) * 100);
          this.emit('job-progress', { id: job.id, progress: job.progress });
        }

        job.status      = 'done';
        job.finishedAt  = new Date().toISOString();
        job.result      = { linesExecuted: lines.length };
        this.emit('job-done', { id: job.id, name: job.name });
      } catch (err) {
        job.status    = 'error';
        job.error     = err.message;
        job.finishedAt = new Date().toISOString();
        this.emit('job-error', { id: job.id, name: job.name, error: err.message });
      }

      this.history.push(job);
      if (this.history.length > 100) this.history.shift();
      this.current = null;
    }

    this.running = false;
    this.emit('queue-finished');
  }

  stop() {
    this.running = false;
    if (this.current) {
      this.current.status = 'cancelled';
      this.history.push(this.current);
      this.current = null;
    }
    this.emit('queue-stopped');
  }

  clear() {
    this.queue = [];
    this.emit('queue-cleared');
  }
}

module.exports = JobQueue;
