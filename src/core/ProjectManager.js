'use strict';
const fs   = require('fs');
const path = require('path');

const PROJECTS_DIR = path.join(__dirname, '..', '..', 'projects');

class ProjectManager {
  constructor() {
    if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  }

  // حفظ مشروع — يُعيد { id, name, path }
  save(name, data) {
    const safe = name.replace(/[^a-zA-Z0-9_؀-ۿ\s-]/g, '_').trim() || 'project';
    const id   = Date.now() + '_' + safe.replace(/\s+/g, '_');
    const file = path.join(PROJECTS_DIR, id + '.cncp');
    const payload = {
      id,
      name: safe,
      savedAt: new Date().toISOString(),
      version: '1.0',
      shapes:       data.shapes       || [],
      config:       data.config       || {},
      gcode:        data.gcode        || '',
      selectedTool: data.selectedTool || null,
      notes:        data.notes        || '',
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return { id, name: safe, file };
  }

  // تحميل مشروع
  load(id) {
    const file = path.join(PROJECTS_DIR, id + '.cncp');
    if (!fs.existsSync(file)) throw new Error('المشروع غير موجود: ' + id);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  // قائمة المشاريع مرتبة تنازلياً حسب التاريخ
  list() {
    if (!fs.existsSync(PROJECTS_DIR)) return [];
    return fs.readdirSync(PROJECTS_DIR)
      .filter(f => f.endsWith('.cncp'))
      .map(f => {
        try {
          const p = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'));
          return { id: p.id, name: p.name, savedAt: p.savedAt, shapeCount: (p.shapes || []).length };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1))
      .slice(0, 20);
  }

  // حذف مشروع
  delete(id) {
    const file = path.join(PROJECTS_DIR, id + '.cncp');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

module.exports = ProjectManager;
