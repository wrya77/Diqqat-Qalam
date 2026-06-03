/**
 * AIOptimizer.js — تحسين المسارات بالذكاء الاصطناعي (Claude API)
 */

const geometry = require('../utils/geometry');

class AIOptimizer {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY;
  }

  /**
   * تحسين ترتيب الأشكال
   * @param {Array}  shapes
   * @param {Object} config
   * @returns {{ optimizedShapes, suggestions, estimatedSaving }}
   */
  async optimizePaths(shapes, config) {
    if (!this.apiKey) {
      return { optimizedShapes: shapes, suggestions: ['مفتاح API غير متوفر — تم تخطي تحسين AI'], estimatedSaving: '0%' };
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: this.apiKey });

    const prompt = this._buildPrompt(shapes, config);

    try {
      const message = await client.messages.create({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
      });

      const raw = (message && message.content && message.content[0] && message.content[0].text) || '';
      return this._parseResponse(raw, shapes);
    } catch (err) {
      console.error('AI Optimizer error:', err && err.message ? err.message : err);
      return {
        optimizedShapes: shapes,
        suggestions: [`تعذّر الاتصال بـ AI: ${err && err.message ? err.message : String(err)}`],
        estimatedSaving: '0%',
      };
    }
  }

  _buildPrompt(shapes, config) {
    // بنية الأشكال المفصّلة لتزويد النموذج بمعلومات كافية
    const shapesInfo = shapes.map((s, i) => {
      const start = geometry.shapeStartPoint(s);
      const end   = geometry.shapeEndPoint(s);
      return {
        index: i,
        type: s.type,
        length: Number((geometry.shapeLength(s) || 0).toFixed(3)),
        start: { x: Number(start.x.toFixed(3)), y: Number(start.y.toFixed(3)) },
        end:   { x: Number(end.x.toFixed(3)),   y: Number(end.y.toFixed(3)) },
        points: s.points ? s.points.length : undefined,
        radius: s.r || undefined,
        closed: s.closed || false,
        toolDiameter: config.toolDiameter || undefined,
      };
    });

    return `أنت خبير برمجة وتهيئة مسارات CNC. لديك ${shapes.length} شكل/أشكال للقص.

  الإعدادات:
  - قطر الأداة: ${config.toolDiameter} mm
  - عدد شفرات الأداة: ${config.toolFlutes || 2}
  - مادة العمل: ${config.material || 'generic'}
  - سرعة XY الافتراضية: ${config.feedRateXY} mm/min
  - سرعة Z الافتراضية: ${config.feedRateZ} mm/min
  - ارتفاع أمان: ${config.safeHeight} mm

  الأشكال (JSON):
  ${JSON.stringify(shapesInfo, null, 2)}

المطلوب:
- رتّب الأشكال لتقليل مسافة التنقل السريع (G00) وأعِد قائمة الفهارس بالترتيب الأمثل بالنسبة إلى ترجمة الأشكال الأصلية.
- لكل شكل اقترح سرعة تغذية عملية (F بالـ mm/min) مناسبة للحفاظ على جودة القطع وتقليل وقت التشغيل. إذا كان قلب اتجاه الشكل (reverse) مفيداً فحدده.
- أعطِ تبريراً مختصراً للتغييرات وتقديراً لنسبة تقليل وقت التشغيل.

أجب بـ JSON فقط وبالهيئة التالية EXACTLY (مفاتيح ومقاييس واضحة):
{
  "optimizedOrder": [0,1,2],                  // مصفوفة أرقام الفهارس من المدخلات الأصلية
  "reversed": [true,false,false],             // (اختياري) مصفوفة booleans بنفس الطول تحدد إن كان الشكل معكوساً
  "feedRates": { "0": 1200, "1": 900 },    // (اختياري) خريطة index -> feed rate (mm/min)
  "suggestions": ["اقتراح 1", "اقتراح 2"],
  "estimatedTimeSaving": "15%",
  "reason": "شرح مختصر للترتيب"
}

لا تضِف أي نص قبل أو بعد JSON.`;
  }

  _parseResponse(text, originalShapes) {
    try {
      const cleaned = (text || '').replace(/```json|```/g, '').trim();
      if (!cleaned) throw new Error('رد فارغ من AI');
      const result = JSON.parse(cleaned);

      const order = Array.isArray(result.optimizedOrder) ? result.optimizedOrder : null;
      if (!order || order.length !== originalShapes.length) {
        // إذا أعاد النموذج مجرد ترتيب جزئي، نفترض إبقاء الباقي كما هو
        if (!order || order.length === 0) throw new Error('ترتيب غير صالح');
      }

      // تحقق من صلاحية الأرقام
      const valid = order.every(i => typeof i === 'number' && i >= 0 && i < originalShapes.length);
      if (!valid) throw new Error('أرقام الأشكال غير صالحة');

      // بناء مصفوفة الأشكال المحدثة
      const feedMap = result.feedRates || {};
      const reversedArr = Array.isArray(result.reversed) ? result.reversed : [];

      const optimizedShapes = order.map(idx => {
        const orig = originalShapes[idx];
        const copy = JSON.parse(JSON.stringify(orig));
        if (feedMap.hasOwnProperty(String(idx))) copy.feedRate = Number(feedMap[String(idx)]);
        const rev = reversedArr.length === order.length ? reversedArr[order.indexOf(idx)] : (reversedArr[idx] === true);
        if (rev) copy.reversed = true;
        return copy;
      });

      return {
        optimizedShapes,
        suggestions:     result.suggestions || [],
        estimatedSaving: result.estimatedTimeSaving || result.estimatedSaving || '0%',
        reason:          result.reason || '',
      };
    } catch (err) {
      console.error('AI parse error:', err && err.message ? err.message : err);
      return {
        optimizedShapes: originalShapes,
        suggestions:     ['تعذّر تحليل رد AI — استخدام الترتيب الأصلي'],
        estimatedSaving: '0%',
      };
    }
  }

  /**
   * تحليل الأخطاء الشائعة في G-Code
   */
  async analyzeGCode(gcode, config) {
    if (!this.apiKey) return { issues: [], suggestions: [] };

    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: this.apiKey });

    const lines  = gcode.split('\n');
    const sample = lines.slice(0, 50).join('\n');

    const message = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages:   [{
        role:    'user',
        content: `راجع هذا G-Code لمطبعة CNC وأبلّغ عن أي مشاكل محتملة:

\`\`\`
${sample}
\`\`\`

الإعدادات: أداة ⌀${config.toolDiameter}mm، تغذية XY=${config.feedRateXY}، Z=${config.feedRateZ}

أجب بـ JSON فقط:
{
  "issues": ["مشكلة 1"],
  "suggestions": ["اقتراح 1"],
  "safetyWarnings": ["تحذير 1"]
}`,
      }],
    });

    try {
      const cleaned = message.content[0].text.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { issues: [], suggestions: [], safetyWarnings: [] };
    }
  }
}

if (typeof module !== 'undefined') module.exports = AIOptimizer;
