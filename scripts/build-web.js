'use strict';
/**
 * build-web.js — يجمع سكربتات الواجهة الـ31 في حزمة واحدة.
 *
 * لماذا التجميع بسيط وآمن هنا: كل ملفات الواجهة "سكربتات كلاسيكية" بلا
 * وحدات (modules) وبلا 'use strict' في مستواها الأعلى، وتتشارك النطاق العام.
 * لذا الدمج بالترتيب نفسه = تحميلها كسكربتات منفصلة تماماً، لكن بطلب HTTP واحد
 * بدل ~31 (أسرع لأول زيارة ولتثبيت/تحديث الـ Service Worker).
 *
 * يُستدعى تلقائياً عند إقلاع الخادم (server.js) فتبقى الحزمة متزامنة مع المصدر
 * دائماً — بلا خطوة بناء يدوية وبلا انحراف. يمكن أيضاً تشغيله مستقلاً:
 *   node scripts/build-web.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// الترتيب مطابق تماماً لترتيب وسوم <script> في public/index.html.
// (المصدر الوحيد للحقيقة — أي تغيير في الترتيب يجب أن يوازيه تغيير هنا.)
const MANIFEST = [
  'public/js/supabase-auth.js',
  'shared/geometry.js',
  'shared/MachineConfig.js',
  'shared/HeaderGenerator.js',
  'shared/PocketGenerator.js',
  'shared/ToolpathGenerator.js',
  'shared/PathSort.js',
  'shared/PolyBoolean.js',
  'shared/GCodeGenerator.js',
  'public/js/svg-parser.js',
  'public/js/image-tracer.js',
  'public/js/canvas-editor.js',
  'public/js/tools-extra.js',
  'public/js/tools-pro.js',
  'public/js/tools-arrange.js',
  'public/js/tools-cnc.js',
  'public/js/tools-boolean.js',
  'public/js/tools-transform.js',
  'public/js/tools-effects.js',
  'public/js/menu-bar.js',
  'public/js/gcode-preview.js',
  'public/js/simulator-3d.js',
  'public/js/simulator-three.js',
  'public/js/file-importer.js',
  'public/js/ui-controls.js',
  'public/js/machine-control.js',
  'public/js/tools-rail-flyout.js',
  'public/js/tools-dock.js',
  'public/js/ui-polish.js',
  'public/js/payments.js',
  'public/js/app.js',
];

const OUT = path.join(ROOT, 'public', 'dist', 'app.bundle.js');

function buildWebBundle() {
  const banner = '/* دقة قلم — حزمة مُولّدة تلقائياً عند الإقلاع. لا تُعدّل يدوياً؛ عدّل الملفات المصدر. */\n';
  const parts = [banner];
  let srcBytes = 0;

  for (const rel of MANIFEST) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    srcBytes += Buffer.byteLength(src);
    // فاصل ';' بين الملفات يمنع أي التباس ASI عند إزالة حدود <script>.
    parts.push(`\n/* ==== ${rel} ==== */\n`, src, '\n;\n');
  }

  const out = parts.join('');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out, 'utf8');
  return { files: MANIFEST.length, srcBytes, outBytes: Buffer.byteLength(out) };
}

module.exports = { buildWebBundle, MANIFEST, OUT };

if (require.main === module) {
  const r = buildWebBundle();
  console.log(`✓ web bundle: ${r.files} ملف → public/dist/app.bundle.js (${(r.outBytes/1024).toFixed(0)} KB)`);
}
