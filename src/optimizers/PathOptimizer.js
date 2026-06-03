/**
 * PathOptimizer.js — المحسّن الرئيسي للمسارات
 * يجمع جميع خطوات التحسين في pipeline واحد
 */

const NearestNeighbor = require('./NearestNeighbor');
const ArcDetector     = require('./ArcDetector');
const FeedrateOptimizer = require('./FeedrateOptimizer');
const geometry        = require('../utils/geometry');

class PathOptimizer {
  constructor(options = {}) {
    this.config     = options || {};
    this.sortPaths  = options.sortPaths  !== false;
    this.detectArcs = options.detectArcs !== false;
    this.twoOpt     = options.twoOpt     || false;   // بطيء على مجموعات كبيرة
    this.joinGap    = options.joinGap    || 0.01;    // mm — ربط أشكال متجاورة
    this.feedrate   = options.feedrate !== false;

    this._nn  = new NearestNeighbor();
    this._arc = new ArcDetector();
    this._feed = new FeedrateOptimizer();
  }

  /**
   * تحسين كامل للمسارات
   * @param {Array} shapes
   * @param {Object} startPos
   * @returns {{ shapes, report }}
   */
  optimize(shapes, startPos = { x: 0, y: 0 }) {
    if (!shapes || shapes.length === 0) return [];
    const report = {
      originalCount: shapes.length,
      steps: [],
    };

    let current = [...shapes];

    // 1. كشف الأقواس
    if (this.detectArcs) {
      const before = current.length;
      current = this._arc.processShapes(current);
      report.steps.push({
        step: 'كشف الأقواس',
        before,
        after: current.length,
        detail: `تحويل ${before - current.length + current.filter(s => s.type === 'arc').length} قوس`,
      });
    }

    // 2. دمج الأشكال المتجاورة
    if (this.joinGap > 0) {
      const before = current.length;
      current = this._joinAdjacentShapes(current, this.joinGap);
      report.steps.push({
        step: 'دمج الأشكال المتجاورة',
        before,
        after: current.length,
        detail: `دُمج ${before - current.length} شكل`,
      });
    }

    // 2.5 تعيين سرعات تغذية متكيّفة لكل شكل
    if (this.feedrate) {
      try {
        current = this._feed.assignFeedRates(current, this.config) || current;
        report.steps.push({ step: 'تعيين سرعات تغذية', detail: 'تم تعيين سرعات تغذية متكيّفة لكل شكل' });
      } catch (e) {
        report.steps.push({ step: 'تعيين سرعات تغذية', detail: `فشل: ${e.message}` });
      }
    }

    // 3. ترتيب بالجار الأقرب
    if (this.sortPaths) {
      const nnResult = this._nn.sort(current, startPos);
      // دعم إرجاعين محتملين: مصفوفة (قديمة) أو كائن يحتوي ordered + إحصاءات
      const ordered = Array.isArray(nnResult) ? nnResult : nnResult.ordered || [];
      const totalRapidBefore = Array.isArray(nnResult) ? 0 : (nnResult.totalRapidBefore || 0);
      const totalRapidAfter  = Array.isArray(nnResult) ? 0 : (nnResult.totalRapidAfter  || 0);
      const saving           = Array.isArray(nnResult) ? '0%' : (nnResult.saving || '0%');

      // 4. 2-Opt إضافي (اختياري)
      current = this.twoOpt ? this._nn.twoOpt(ordered, startPos) : ordered;

      report.steps.push({
        step: 'ترتيب المسارات',
        detail: `مسافة سريعة: ${totalRapidBefore}mm → ${totalRapidAfter}mm | توفير ${saving}`,
        saving,
      });
    }

    report.finalCount = current.length;
    // رجّع المصفوفة نفسها لكن أرفق التقرير كمفتاح للتماشي مع استخدامات سابقة
    current.report = report;
    return current;
  }

  // دمج أشكال تنتهي بنفس نقطة بداية الشكل التالي
  _joinAdjacentShapes(shapes, gap) {
    if (shapes.length < 2) return shapes;

    const result  = [shapes[0]];

    for (let i = 1; i < shapes.length; i++) {
      const prev    = result[result.length - 1];
      const curr    = shapes[i];
      const prevEnd = this._endPoint(prev);
      const currStart = geometry.shapeStartPoint(curr);

      const dist = geometry.distance(prevEnd.x, prevEnd.y, currStart.x, currStart.y);

      if (dist <= gap && prev.type === 'polyline' && curr.type === 'polyline') {
        // دمج
        prev.points.push(...curr.points.slice(1));
      } else {
        result.push(curr);
      }
    }

    return result;
  }

  _endPoint(shape) {
    return geometry.shapeEndPoint(shape);
  }
}

if (typeof module !== 'undefined') module.exports = PathOptimizer;
