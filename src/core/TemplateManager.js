'use strict';
/**
 * TemplateManager.js — قوالب إعداد الآلة القابلة للحفظ والمشاركة
 * يتيح حفظ إعدادات الآلة والأداة والمادة وإعادة استخدامها.
 */

const fs   = require('fs');
const path = require('path');

class TemplateManager {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(process.cwd(), 'data', 'templates');
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    this.indexFile = path.join(this.dataDir, 'index.json');
    this.index = this._loadIndex();
  }

  _loadIndex() {
    try {
      return fs.existsSync(this.indexFile) ? JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) : [];
    } catch { return []; }
  }

  _saveIndex() {
    fs.writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2));
  }

  save(name, config, metadata = {}) {
    if (!name || !config) throw new Error('الاسم والإعدادات مطلوبان');
    const id       = `tmpl_${Date.now()}_${name.replace(/[^a-z0-9]/gi, '_').slice(0, 20)}`;
    const template = {
      id,
      name,
      description: metadata.description || '',
      category:    metadata.category    || 'general',
      material:    config.material      || 'generic',
      tags:        metadata.tags        || [],
      config:      { ...config },
      createdAt:   new Date().toISOString(),
      usageCount:  0,
    };

    fs.writeFileSync(path.join(this.dataDir, `${id}.json`), JSON.stringify(template, null, 2));
    this.index.push({ id, name, category: template.category, material: template.material, tags: template.tags, description: template.description, createdAt: template.createdAt });
    this._saveIndex();
    return template;
  }

  load(id) {
    const file = path.join(this.dataDir, `${id}.json`);
    if (!fs.existsSync(file)) throw new Error('القالب غير موجود');
    const template = JSON.parse(fs.readFileSync(file, 'utf8'));
    template.usageCount++;
    fs.writeFileSync(file, JSON.stringify(template, null, 2));
    return template;
  }

  list(filter = {}) {
    let results = [...this.index];
    if (filter.category) results = results.filter(t => t.category === filter.category);
    if (filter.material)  results = results.filter(t => t.material  === filter.material);
    if (filter.tag)       results = results.filter(t => t.tags && t.tags.includes(filter.tag));
    return results;
  }

  delete(id) {
    const file = path.join(this.dataDir, `${id}.json`);
    if (!fs.existsSync(file)) throw new Error('القالب غير موجود');
    fs.unlinkSync(file);
    this.index = this.index.filter(t => t.id !== id);
    this._saveIndex();
  }

  getBuiltinTemplates() {
    return [
      { id: 'builtin_wood_engraving',  name: 'نقش خشب',      material: 'wood',     config: { feedRateXY: 2000, feedRateZ: 500, spindleSpeed: 18000, toolDiameter: 3.175, totalDepth: 3,  passDepth: 1 } },
      { id: 'builtin_aluminum_milling',name: 'تفريز ألومنيوم', material: 'aluminum', config: { feedRateXY: 400,  feedRateZ: 100, spindleSpeed: 12000, toolDiameter: 6,     totalDepth: 5,  passDepth: 1 } },
      { id: 'builtin_pcb_routing',     name: 'PCB تخطيط',    material: 'pcb',      config: { feedRateXY: 300,  feedRateZ: 80,  spindleSpeed: 30000, toolDiameter: 0.8,   totalDepth: 1.5, passDepth: 0.5 } },
      { id: 'builtin_laser_cutting',   name: 'قطع بالليزر',   material: 'wood',     config: { feedRateXY: 3000, feedRateZ: 1000, spindleSpeed: 0,   toolDiameter: 0,     totalDepth: 5,  passDepth: 5 } },
    ];
  }
}

module.exports = TemplateManager;
