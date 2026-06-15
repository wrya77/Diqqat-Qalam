'use strict';
/**
 * WorkerPool.js — مجمّع خيوط عاملة بسيط ومتين لتوليد G-Code.
 *
 * - يوزّع المهام على عدد محدود من العمّال (حسب الأنوية).
 * - مهلة لكل مهمة؛ العامل المعلّق يُنهى ويُعاد إنشاؤه.
 * - مسار احتياطي: إن تعذّر تشغيل العمّال (بيئة بلا threads أو فشل الإنشاء)
 *   تُنفَّذ المهمة داخل الخيط نفسه عبر نفس خط الأنابيب — صحّة قبل سرعة.
 */
const os   = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const pipeline = require('../generators/pipeline'); // للمسار الاحتياطي

const WORKER_FILE  = path.join(__dirname, '..', 'workers', 'generate-worker.js');
const TASK_TIMEOUT = 30000; // 30s سقف زمني لكل مهمة

function runInline(task) {
  if (task.op === 'optimize') return { shapes: pipeline.optimizePaths(task.shapes, task.config) };
  if (task.op === 'finalize') return pipeline.finalize(task.shapes, task.config, task.machineProfile);
  throw new Error('عملية غير معروفة: ' + task.op);
}

class WorkerPool {
  constructor(size) {
    this.size     = size || Math.max(1, Math.min(4, (os.cpus()?.length || 2) - 1));
    this.workers  = [];   // { worker, busy, current, dead }
    this.queue    = [];   // { task, resolve, reject }
    this.seq      = 0;
    this.disabled = false;
    try {
      for (let i = 0; i < this.size; i++) this._spawn();
    } catch (e) {
      console.error('[WorkerPool] تعذّر إنشاء العمّال — تنفيذ داخل الخيط:', e.message);
      this.disabled = true;
    }
  }

  _spawn() {
    const w   = new Worker(WORKER_FILE);
    const rec = { worker: w, busy: false, current: null, dead: false };
    w.on('message', (msg) => {
      const cur = rec.current;
      if (!cur || !msg || msg.id !== cur.id) return;   // رسالة متأخرة لمهمة سابقة
      clearTimeout(cur.timer);
      rec.current = null; rec.busy = false;
      if (msg.ok) cur.resolve(msg.result);
      else        cur.reject(new Error(msg.error || 'خطأ في العامل'));
      this._drain();
    });
    w.on('error', (err)  => this._failWorker(rec, err));
    w.on('exit',  (code) => { if (code !== 0) this._failWorker(rec, new Error('خرج العامل برمز ' + code)); });
    this.workers.push(rec);
  }

  _failWorker(rec, err) {
    if (rec.dead) return;            // امنع المعالجة المزدوجة (error + exit)
    rec.dead = true;
    if (rec.current) { clearTimeout(rec.current.timer); rec.current.reject(err); rec.current = null; }
    rec.busy = false;
    const idx = this.workers.indexOf(rec);
    if (idx >= 0) this.workers.splice(idx, 1);
    try { rec.worker.terminate(); } catch (_) {}
    try { this._spawn(); } catch (_) { /* بيئة بلا threads */ }
    this._drain();
  }

  run(task) {
    if (this.disabled) {
      try { return Promise.resolve(runInline(task)); }
      catch (e) { return Promise.reject(e); }
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this.queue.length) {
      const idle = this.workers.find(w => !w.busy);
      if (!idle) break;
      const job = this.queue.shift();
      const id  = ++this.seq;
      idle.busy = true;
      idle.current = {
        id,
        resolve: job.resolve,
        reject:  job.reject,
        timer:   setTimeout(() => this._failWorker(idle, new Error('انتهت مهلة المهمة')), TASK_TIMEOUT),
      };
      idle.worker.postMessage({ id, ...job.task });
    }
  }

  async destroy() {
    await Promise.all(this.workers.map(r => { r.dead = true; return r.worker.terminate().catch(() => {}); }));
    this.workers = [];
  }
}

module.exports = WorkerPool;
