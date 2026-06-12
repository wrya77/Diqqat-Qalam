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
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI request timed out after 30s')), 30000)
      );
      const message = await Promise.race([
        client.messages.create({
          model:      'claude-sonnet-4-6',
          max_tokens: 2048,
          messages:   [{ role: 'user', content: prompt }],
        }),
        timeoutPromise,
      ]);

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

    const base = config.feedRateXY || 1000;
    return `أنت مهندس CAM خبير في تحسين مسارات CNC. لديك ${shapes.length} شكل/أشكال للقص.

  الإعدادات:
  - قطر الأداة: ${config.toolDiameter} mm (${config.toolFlutes || 2} شفرات)
  - مادة العمل: ${config.material || 'generic'}
  - دوران المغزل: ${config.spindleSpeed || 18000} RPM
  - سرعة XY الأساسية: ${base} mm/min — سرعة Z: ${config.feedRateZ} mm/min
  - عمق الطبقة: ${config.passDepth || 1} mm من أصل ${config.totalDepth || 5} mm
  - ارتفاع أمان: ${config.safeHeight} mm

  قواعد إلزامية لاقتراحات التغذية:
  - أي feed تقترحه يجب أن يكون بين ${Math.round(base * 0.5)} و ${Math.round(base * 1.5)} mm/min
  - الأشكال الصغيرة والمنحنيات الحادة ⇒ تغذية أبطأ؛ الخطوط الطويلة المستقيمة ⇒ أسرع
  - رتب الأشكال لتقليل مجموع مسافات التنقل G00 بين نهاية كل شكل وبداية التالي
  - استعمل reverse عندما يجعل نهايةَ شكلٍ أقربَ لبداية الشكل التالي

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
      // استخراج أول كائن JSON حتى لو سبقه/تبعه نص
      let cleaned = (text || '').replace(/```json|```/g, '').trim();
      const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}');
      if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
      if (!cleaned) throw new Error('رد فارغ من AI');
      const result = JSON.parse(cleaned);

      let order = Array.isArray(result.optimizedOrder) ? result.optimizedOrder : [];
      // معالجة ذاتية: أرقام صالحة فقط، بلا تكرار، ثم أكمل الفهارس الناقصة
      // بترتيبها الأصلي — يضمن تبديلة كاملة دائماً فلا يضيع أي شكل
      const seen = new Set();
      order = order.filter(i =>
        Number.isInteger(i) && i >= 0 && i < originalShapes.length && !seen.has(i) && seen.add(i));
      for (let i = 0; i < originalShapes.length; i++) if (!seen.has(i)) order.push(i);

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

    const timeoutPromise2 = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI request timed out after 30s')), 30000)
    );
    const message = await Promise.race([client.messages.create({
      model:      'claude-sonnet-4-6',
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
    }), timeoutPromise2]);

    try {
      const cleaned = message.content[0].text.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { issues: [], suggestions: [], safetyWarnings: [] };
    }
  }
}

if (typeof module !== 'undefined') module.exports = AIOptimizer;
