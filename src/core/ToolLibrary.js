'use strict';
const fs   = require('fs');
const path = require('path');

const TOOLS_FILE = path.join(__dirname, '..', '..', 'tools.json');

// أدوات افتراضية مدمجة
const DEFAULT_TOOLS = [
  {
    id: 'default_1', name: 'Flat 6mm 2-Flute',
    diameter: 6, type: 'flat', flutes: 2, length: 30, material: 'HSS',
    speeds: {
      wood:     { rpm: 18000, feedXY: 2000, feedZ: 500, chipload: 0.10 },
      aluminum: { rpm: 12000, feedXY:  400, feedZ: 100, chipload: 0.02 },
      plastic:  { rpm: 18000, feedXY: 1200, feedZ: 300, chipload: 0.05 },
      generic:  { rpm: 18000, feedXY: 1000, feedZ: 300, chipload: 0.04 },
    },
    notes: 'أداة عامة للخشب والبلاستيك',
  },
  {
    id: 'default_2', name: 'V-Bit 3.175mm 90°',
    diameter: 3.175, type: 'vbit', flutes: 2, length: 20, material: 'Carbide',
    speeds: {
      wood:    { rpm: 24000, feedXY: 1500, feedZ: 300, chipload: 0.05 },
      pcb:     { rpm: 30000, feedXY:  300, feedZ:  80, chipload: 0.01 },
      generic: { rpm: 24000, feedXY:  800, feedZ: 200, chipload: 0.02 },
    },
    notes: 'للحفر والنقش',
  },
  {
    id: 'default_3', name: 'Flat 3mm 2-Flute Carbide',
    diameter: 3, type: 'flat', flutes: 2, length: 22, material: 'Carbide',
    speeds: {
      aluminum: { rpm: 16000, feedXY:  320, feedZ:  80, chipload: 0.015 },
      wood:     { rpm: 20000, feedXY: 1500, feedZ: 400, chipload: 0.07  },
      generic:  { rpm: 18000, feedXY:  800, feedZ: 200, chipload: 0.04  },
    },
    notes: 'قطع دقيق للألومنيوم والخشب',
  },
  {
    id: 'default_4', name: 'Drill 3mm',
    diameter: 3, type: 'drill', flutes: 2, length: 50, material: 'HSS',
    speeds: {
      wood:     { rpm: 3000, feedXY: 0, feedZ: 200, chipload: 0.05 },
      aluminum: { rpm: 2000, feedXY: 0, feedZ:  80, chipload: 0.02 },
      generic:  { rpm: 2500, feedXY: 0, feedZ: 120, chipload: 0.03 },
    },
    notes: 'مثقاب معياري',
  },
  {
    id: 'default_5', name: 'Ball Nose 4mm',
    diameter: 4, type: 'ball', flutes: 2, length: 30, material: 'Carbide',
    speeds: {
      wood:    { rpm: 20000, feedXY: 1800, feedZ: 400, chipload: 0.08 },
      generic: { rpm: 18000, feedXY: 1000, feedZ: 250, chipload: 0.04 },
    },
    notes: 'لتشطيب الأسطح الثلاثية الأبعاد',
  },
];

class ToolLibrary {
  constructor() {
    this._tools = null;
  }

  _load() {
    if (this._tools) return;
    if (fs.existsSync(TOOLS_FILE)) {
      try {
        this._tools = JSON.parse(fs.readFileSync(TOOLS_FILE, 'utf8'));
        return;
      } catch (_) {}
    }
    this._tools = JSON.parse(JSON.stringify(DEFAULT_TOOLS));
    this._save();
  }

  _save() {
    fs.writeFileSync(TOOLS_FILE, JSON.stringify(this._tools, null, 2), 'utf8');
  }

  getAll() {
    this._load();
    return this._tools;
  }

  getById(id) {
    this._load();
    return this._tools.find(t => t.id === id) || null;
  }

  // إضافة أداة جديدة
  add(tool) {
    this._load();
    const id = 'tool_' + Date.now();
    const entry = { id, ...tool };
    this._tools.push(entry);
    this._save();
    return entry;
  }

  // تحديث أداة
  update(id, updates) {
    this._load();
    const idx = this._tools.findIndex(t => t.id === id);
    if (idx === -1) throw new Error('الأداة غير موجودة: ' + id);
    this._tools[idx] = { ...this._tools[idx], ...updates, id };
    this._save();
    return this._tools[idx];
  }

  // حذف أداة
  delete(id) {
    this._load();
    const before = this._tools.length;
    this._tools = this._tools.filter(t => t.id !== id);
    if (this._tools.length === before) throw new Error('الأداة غير موجودة: ' + id);
    this._save();
  }

  // استرجاع إعدادات السرعة لأداة + مادة
  getSpeeds(toolId, material = 'generic') {
    const tool = this.getById(toolId);
    if (!tool) return null;
    return tool.speeds?.[material] || tool.speeds?.generic || null;
  }
}

module.exports = ToolLibrary;
