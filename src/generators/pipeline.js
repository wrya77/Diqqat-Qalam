'use strict';
/**
 * pipeline.js — المراحل الثقيلة (CPU) لتوليد G-Code، كدوال نقية.
 *
 * يستخدمها كلٌّ من:
 *   - عامل الخيط (src/workers/generate-worker.js) لتشغيلها خارج الخيط الرئيسي.
 *   - المسار الاحتياطي في WorkerPool عند تعذّر تشغيل العمّال.
 * مصدر منطق واحد، فلا تتكرّر الخوارزمية ولا تتباعد النتائج.
 */

const PathOptimizer          = require('../optimizers/PathOptimizer');
const FeedrateOptimizer      = require('../optimizers/FeedrateOptimizer');
const GCodeGenerator         = require('./GCodeGenerator');
const LocalExpert            = require('../ai/LocalExpert');
const { applyPostProcessor } = require('./PostProcessors');
const geometry               = require('../utils/geometry');

// المرحلة #1 — تحسين ترتيب/مسارات القطع
function optimizePaths(shapes, config) {
  return new PathOptimizer(config).optimize(shapes);
}

// المرحلة #2 — معدّلات التغذية + النصائح + توليد G-Code + التحليل
function finalize(shapes, config, machineProfile) {
  let processed = new FeedrateOptimizer().assignFeedRates(shapes, config, { preserveExisting: true });

  // النظام الخبير المحلي — نصائح فيزيائية حتمية (اختياري، لا يكسر التوليد)
  let expertTips = [];
  try { expertTips = LocalExpert.analyze(processed, config) || []; }
  catch (e) { console.warn('LocalExpert:', e.message); }

  let { gcode, stats } = new GCodeGenerator(config).generate(processed);

  if (machineProfile && machineProfile !== 'generic') {
    gcode = applyPostProcessor(gcode, config, machineProfile);
  }

  const analysis = processed.map((s, i) => {
    if (!s || !s.type) return null;
    return {
      index:                  i,
      type:                   s.type,
      length:                 geometry.shapeLength(s),
      feedRate:               s.feedRate               || null,
      maxRecommendedFeedRate: s.maxRecommendedFeedRate || null,
      forceEstimate:          s.forceEstimate          || null,
      engagement:             s.forceEstimate && s.forceEstimate.engagement,
    };
  }).filter(Boolean);

  return { gcode, stats, shapes: processed, analysis, expertTips };
}

module.exports = { optimizePaths, finalize };
