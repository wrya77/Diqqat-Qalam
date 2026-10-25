#!/usr/bin/env node
/**
 * server.js — خادم MCP لدقة قلم (محلّيّ، بلا مصادقة).
 *
 *   يصل كلاود (Claude Desktop) بمحرّك الحروف: تكتب الفكرة بالعربية، فينادي كلاود
 *   أداةً هنا، فتُنتَج ملفّات القصّ على القرص مباشرةً.
 *
 *   يتكلّم stdio — لا منفذ ولا شبكة. كلّ العمل داخل engine.js النقيّ؛ هذا الملفّ
 *   غلافُ بروتوكولٍ فقط.
 */
'use strict';

const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const engine = require('./engine');

const server = new Server(
  { name: 'diqqat-qalam', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ── تعريف الأدوات ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_fonts',
    description: 'يعرض الخطوط العربية المتاحة لصناعة الحروف (نسخ، حديث، كوفي، رقعة) مع وصفٍ لكلٍّ منها.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'make_letters',
    description:
      'يصنع حروفاً طباعية من نصٍّ عربيّ ويكتب ملفّات القصّ على القرص (G-Code للآلة + SVG للمعاينة). ' +
      'استعمله حين يصف المستخدم لوحةً أو حروفاً ضوئية/إعلانية: مرّر النصّ والخطّ وارتفاع الحرف وسماكة الخامة. ' +
      'يُرجِع مسارات الملفّات والأبعاد الفعلية وزمن القطع التقديريّ.',
    inputSchema: {
      type: 'object',
      properties: {
        text:        { type: 'string', description: 'النصّ (عربيّ أو لاتينيّ، أسطرٌ متعدّدة مسموحة بفاصل سطر). إجباريّ.' },
        font:        { type: 'string',
                       description: 'مُعرّف الخطّ (٦٧ خطاً: ٣٧ عربي + ٣٠ لاتيني). نادِ list_fonts لرؤية المتاح. افتراضي amiri.' },
        heightMM:    { type: 'number', description: 'ارتفاع الحرف بالمليمتر (مثلاً 300 لثلاثين سم). افتراضي 100.' },
        material:    { type: 'number', description: 'سماكة الخامة بالمليمتر = عمق القطع الكلّيّ. افتراضي 3.' },
        lineSpacing: { type: 'number', description: 'تباعد الأسطر كنسبةٍ من الارتفاع. افتراضي 1.5.' },
        toolDiameter:{ type: 'number', description: 'قطر أداة القطع بالمليمتر. افتراضي 3.' },
        passDepth:   { type: 'number', description: 'عمق كل تمريرة بالمليمتر. افتراضي 1.5.' },
        feedXY:      { type: 'number', description: 'سرعة التغذية الأفقية mm/min. افتراضي 1000.' },
        feedZ:       { type: 'number', description: 'سرعة الغرز العموديّ mm/min. افتراضي 300.' },
        rpm:         { type: 'number', description: 'دوران المغزل RPM (0 لليزر/البلازما). افتراضي 0.' },
        formats:     { type: 'array', items: { type: 'string', enum: ['gcode', 'svg'] },
                       description: 'صِيَغ الإخراج. افتراضي كلاهما.' },
        outDir:      { type: 'string', description: 'مجلّد حفظ الملفّات. افتراضي مجلّد exports داخل المشروع.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// ── تنفيذ الأدوات ───────────────────────────────────────────────────────────

const ok   = (text) => ({ content: [{ type: 'text', text }] });
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === 'list_fonts') {
      const fonts = engine.listFonts();
      const fmt = f => `• ${f.id} — ${f.name} (${f.style}): ${f.note}`;
      const ar = fonts.filter(f => (f.script || 'arabic') === 'arabic');
      const la = fonts.filter(f => f.script === 'latin');
      const out = [
        `الخطوط المتاحة (${fonts.length}):`,
        '', `── خطوط عربية (${ar.length}) ──`, ...ar.map(fmt),
        '', `── English fonts (${la.length}) ──`, ...la.map(fmt),
      ];
      return ok(out.join('\n'));
    }

    if (name === 'make_letters') {
      const r = await engine.generate(args);
      const w = r.dimensionsMM.w.toFixed(0), h = r.dimensionsMM.h.toFixed(0);
      const parts = [
        `تمّ صنع الحروف بخطّ ${r.font.name}.`,
        `الأبعاد الفعلية: ${w} × ${h} مم (${r.lines} سطر، ${r.contours} كنتور).`,
      ];
      if (r.gcodeStats) {
        parts.push(`G-Code: ${r.gcodeStats.lines} سطر · زمن القطع التقديريّ ${r.gcodeStats.estimatedTime}.`);
      }
      parts.push('الملفّات:');
      for (const [k, p] of Object.entries(r.files)) parts.push(`  ${k.toUpperCase()}: ${p}`);
      return ok(parts.join('\n'));
    }

    return fail(`أداة غير معروفة: ${name}`);
  } catch (e) {
    return fail('خطأ: ' + (e && e.message ? e.message : String(e)));
  }
});

// ── الإقلاع ─────────────────────────────────────────────────────────────────

(async () => {
  // تهيئة المحرّك مبكراً كي يظهر أي خطأ تحميلٍ عند الإقلاع لا عند أوّل نداء
  await engine.init();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // لا نطبع على stdout — إنّه قناة البروتوكول. التشخيص يذهب إلى stderr.
  console.error('[diqqat-qalam-mcp] جاهز — أداتان: list_fonts، make_letters');
})().catch((e) => {
  console.error('[diqqat-qalam-mcp] فشل الإقلاع:', e && e.stack ? e.stack : e);
  process.exit(1);
});
