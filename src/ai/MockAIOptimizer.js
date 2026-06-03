/**
 * MockAIOptimizer.js — محاكي محلي لاقتراحات AI (ترتيب + feedRate + reversed)
 * يُستخدم للاختبار والتطوير بدون الاعتماد على خدمة خارجية
 */

const PathOptimizer = require('../optimizers/PathOptimizer');
const geometry = require('../utils/geometry');

class MockAIOptimizer {
  constructor(options = {}) {
    this.options = options || {};
  }

  async optimizePaths(shapes, config = {}, startPos = { x: 0, y: 0 }) {
    // clone and annotate original indices to preserve mapping
    const clones = shapes.map((s, i) => Object.assign(JSON.parse(JSON.stringify(s)), { _origIndex: i }));

    // baseline rapid travel
    const baseline = this._totalRapid(clones, startPos);

    // use local PathOptimizer (includes feedrate assignment)
    const po = new PathOptimizer(config);
    const optimized = po.optimize(clones);

    const optimizedTotal = this._totalRapid(optimized, startPos);

    const pct = baseline > 0 ? Math.round((1 - optimizedTotal / baseline) * 100) : 0;
    const estimatedSaving = `${Math.max(0, pct)}%`;

    const suggestions = [];
    if (pct > 0) suggestions.push(`Local reorder reduces rapid travel by ${estimatedSaving}`);
    else suggestions.push('Local reorder produced no significant rapid-travel reduction');

    // feedRate suggestions summary
    const faster = optimized.filter(s => s.feedRate && s.feedRate > (config.feedRateXY || 0) * 1.05)
      .slice(0, 5)
      .map(s => `shape ${s._origIndex} (${s.type})`);
    if (faster.length) suggestions.push(`Increase feed on long straights: ${faster.join(', ')}`);

    if (config.arcDetect) {
      suggestions.push('Arc detection enabled — consider raising tolerance to convert curves to G02/G03');
    } else {
      suggestions.push('Enable arc detection for smoother arcs and fewer segments');
    }

    // Build feedRates map keyed by original index
    const feedRates = {};
    optimized.forEach(s => {
      if (s.feedRate) feedRates[String(s._origIndex)] = s.feedRate;
    });

    // Build optimizedOrder mapping back to original indices
    const optimizedOrder = optimized.map(s => s._origIndex);

    // Remove internal annotation from shapes before returning (keep feedRate and reversed)
    const cleaned = optimized.map(s => {
      const c = JSON.parse(JSON.stringify(s));
      delete c._origIndex;
      return c;
    });

    return {
      optimizedShapes: cleaned,
      suggestions,
      estimatedSaving,
      // also include structured metadata the UI may use
      metadata: {
        optimizedOrder,
        feedRates,
        reason: 'local-mock: nearest-neighbor + feedrate heuristics + arc detection',
      },
    };
  }

  _totalRapid(shapes, startPos = { x: 0, y: 0 }) {
    let total = 0;
    let pos = { x: startPos.x, y: startPos.y };
    for (const s of shapes) {
      const start = geometry.shapeStartPoint(s);
      total += geometry.distance(pos.x, pos.y, start.x, start.y);
      const end = geometry.shapeEndPoint(s);
      pos = { x: end.x, y: end.y };
    }
    return Math.round(total);
  }
}

module.exports = MockAIOptimizer;
