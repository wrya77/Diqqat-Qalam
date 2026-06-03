/**
 * FeedrateOptimizer.js — يخصّص سرعات تغذية متكيّفة لكل شكل بناءً على الانحناء والطول
 */

const geometry = require('../utils/geometry');
const CuttingForceModel = require('../models/CuttingForceModel');
const materials = require('../utils/materials');

class FeedrateOptimizer {
  constructor(options = {}) {
    this.minMultiplier = options.minMultiplier || 0.6;
    this.maxMultiplier = options.maxMultiplier || 1.5;
    this.baseSafeLen   = options.baseSafeLen   || 50; // mm — طول مقطع كبير
    this._cutModel     = new CuttingForceModel();
  }

  assignFeedRates(shapes, config = {}, options = {}) {
    const base = config.feedRateXY || 1000;
    const rpm = config.spindleSpeed || 18000;
    const flutes = config.toolFlutes || 2;
    const mat = materials[config.material] || materials.generic;

    shapes.forEach(s => {
      // تجاهل العناصر غير الشكليّة
      if (!s || typeof s !== 'object' || !s.type) return;

      const heuristic = this._computeFeedForShape(s, base, config);

      // حدٌ حسب حمل القطع
      const forceLimit = this._cutModel.estimateMaxFeedRate(s, config);

      // حدٌ حسب chip-load الموصى به
      const chipLoadFeed = Math.max(1, Math.round((mat.recChipLoad || 0.02) * rpm * flutes));

      let feed;
      if (options.preserveExisting && s.feedRate) {
        // نحافظ على القيمة المعطاة من AI ولكن نلحق قيود الأمان والحدود
        feed = Number(s.feedRate) || heuristic;
        // تطبيق حد أعلى/أدنى محافظ
        feed = Math.round(Math.max(base * this.minMultiplier, Math.min(base * this.maxMultiplier, feed)));
      } else {
        // اختر الحد الأدنى بين التوصيات والحدود، ثم طبق الضمانات
        feed = Math.min(heuristic, forceLimit || heuristic);
        feed = Math.max(feed, chipLoadFeed);
        feed = Math.round(Math.max(base * this.minMultiplier, Math.min(base * this.maxMultiplier, feed)));
      }

      s.feedRate = feed;

      // احسب التوصيات والقيود والـforces لسهولة العرض
      try {
        s.maxRecommendedFeedRate = this._cutModel.estimateMaxFeedRate(s, config);
        s.forceEstimate = this._cutModel.estimateCuttingForce(s, config, s.feedRate);
      } catch (e) {
        s.maxRecommendedFeedRate = null;
        s.forceEstimate = null;
      }
    });
    return shapes;
  }

  _computeFeedForShape(s, base, config) {
    switch (s.type) {
      case 'line': {
        const len = geometry.shapeLength(s);
        const mult = len > this.baseSafeLen ? 1.3 : 1.1;
        return base * mult;
      }
      case 'rect': {
        const len = geometry.shapeLength(s);
        const avgSeg = len / 4;
        const mult = 1 + Math.min(0.3, avgSeg / this.baseSafeLen);
        return base * mult;
      }
      case 'circle': {
        const r = s.r || 1;
        const mult = 1 + Math.min(0.5, (r - (config.toolDiameter || 1)) / 50);
        return base * Math.max(0.9, mult);
      }
      case 'arc': {
        const r = s.r || 1;
        const mult = 1 + Math.min(0.4, (r - (config.toolDiameter || 1)) / 60);
        return base * Math.max(0.85, mult);
      }
      case 'polyline': {
        if (!s.points || s.points.length < 2) return base;
        const pts = s.points;
        let totalLen = 0, maxAngle = 0;
        for (let i = 1; i < pts.length; i++) {
          totalLen += geometry.distance(pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y);
        }
        for (let i = 1; i < pts.length - 1; i++) {
          const a1 = geometry.angle(pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y);
          const a2 = geometry.angle(pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y);
          const da = Math.abs(a2 - a1);
          const ang = da > Math.PI ? 2 * Math.PI - da : da;
          if (ang > maxAngle) maxAngle = ang;
        }
        const avgSeg = totalLen / Math.max(1, pts.length - 1);
        const longBoost = Math.min(0.5, avgSeg / this.baseSafeLen);
        const curvaturePenalty = Math.min(1, maxAngle / Math.PI);
        const mult = 1 + longBoost - 0.6 * curvaturePenalty;
        return base * Math.max(0.7, Math.min(1.5, mult));
      }
      default:
        return base;
    }
  }
}

module.exports = FeedrateOptimizer;
