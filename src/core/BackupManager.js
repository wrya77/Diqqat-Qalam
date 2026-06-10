'use strict';
/**
 * BackupManager.js — نسخ احتياطي تلقائي مجدول للمشاريع
 * يحمي بيانات المستخدم ويمكن رفع النسخ للسحابة مستقبلاً.
 */

const fs   = require('fs');
const path = require('path');

class BackupManager {
  constructor(options = {}) {
    this.projectsDir = options.projectsDir || path.join(process.cwd(), 'projects');
    this.backupDir   = options.backupDir   || path.join(process.cwd(), 'backups');
    this.maxBackups  = options.maxBackups  || 10;
    this.intervalMs  = options.intervalMs  || 6 * 60 * 60 * 1000; // كل 6 ساعات
    this._timer      = null;

    if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });
  }

  backup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.backupDir, `backup_${timestamp}.json`);

    if (!fs.existsSync(this.projectsDir)) {
      return { success: false, reason: 'مجلد المشاريع غير موجود', file: null };
    }

    const files = fs.readdirSync(this.projectsDir).filter(f => f.endsWith('.cncp'));
    if (files.length === 0) {
      return { success: true, projectsBacked: 0, file: null };
    }

    const projects = {};
    let backed = 0;
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(this.projectsDir, f), 'utf8');
        projects[f] = JSON.parse(content);
        backed++;
      } catch { /* skip corrupt files */ }
    }

    const backup = { timestamp, projectCount: backed, projects };
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

    this._pruneOldBackups();

    return { success: true, projectsBacked: backed, file: backupFile, timestamp };
  }

  restore(backupId) {
    const file = path.join(this.backupDir, backupId.endsWith('.json') ? backupId : `${backupId}.json`);
    if (!fs.existsSync(file)) throw new Error('ملف النسخة الاحتياطية غير موجود');

    const backup   = JSON.parse(fs.readFileSync(file, 'utf8'));
    let restored = 0;
    for (const [filename, data] of Object.entries(backup.projects || {})) {
      fs.writeFileSync(path.join(this.projectsDir, filename), JSON.stringify(data, null, 2));
      restored++;
    }
    return { restored, timestamp: backup.timestamp };
  }

  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(this.backupDir, f));
        return { id: f, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  startScheduled() {
    if (this._timer) return;
    this.backup();
    this._timer = setInterval(() => this.backup(), this.intervalMs);
  }

  stopScheduled() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _pruneOldBackups() {
    const backups = this.listBackups();
    if (backups.length > this.maxBackups) {
      const toDelete = backups.slice(this.maxBackups);
      for (const b of toDelete) {
        try { fs.unlinkSync(path.join(this.backupDir, b.id)); } catch { /* ignore */ }
      }
    }
  }
}

module.exports = BackupManager;
