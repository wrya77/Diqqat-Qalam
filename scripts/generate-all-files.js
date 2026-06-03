#!/usr/bin/env node
/**
 * generate-all-files.js
 * يتحقق من وجود جميع الملفات ويُنشئ ما ينقص منها
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const DIRS = [
  'public/js','public/css','public/assets',
  'src/core','src/parsers','src/generators','src/optimizers','src/ai','src/utils',
  'tests','scripts','uploads','exports'
];

const REQUIRED_FILES = [
  'package.json','server.js','.env.example',
  'public/index.html','public/css/style.css',
  'public/js/app.js','public/js/canvas-editor.js',
  'public/js/gcode-generator.js','public/js/svg-parser.js',
  'public/js/gcode-preview.js','public/js/simulator-3d.js',
  'public/js/file-importer.js','public/js/ui-controls.js',
  'src/core/MachineConfig.js','src/core/PathProcessor.js',
  'src/parsers/SVGParser.js','src/parsers/DXFParser.js','src/parsers/ImageParser.js',
  'src/generators/GCodeGenerator.js','src/generators/HeaderGenerator.js','src/generators/ToolpathGenerator.js',
  'src/optimizers/PathOptimizer.js','src/optimizers/ArcDetector.js','src/optimizers/NearestNeighbor.js',
  'src/ai/AIOptimizer.js',
  'src/utils/geometry.js','src/utils/units.js','src/utils/validator.js',
  'tests/generator.test.js','tests/parser.test.js','tests/optimizer.test.js',
];

let ok=0, missing=0;

console.log('\n✏  دقة قلم — Diqqat Qalam — File Check\n' + '─'.repeat(50));

// Create directories
DIRS.forEach(d => {
  const full = path.join(ROOT, d);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(full, {recursive:true});
    console.log(`📁 Created dir: ${d}`);
  }
});

// Create .env if missing
const envPath = path.join(ROOT,'.env');
const envEx   = path.join(ROOT,'.env.example');
if (!fs.existsSync(envPath) && fs.existsSync(envEx)) {
  fs.copyFileSync(envEx, envPath);
  console.log('📄 Created .env from .env.example');
}

// Check files
REQUIRED_FILES.forEach(f => {
  const full = path.join(ROOT, f);
  if (fs.existsSync(full)) {
    const size = fs.statSync(full).size;
    console.log(`  ✅ ${f.padEnd(50)} ${(size/1024).toFixed(1)} KB`);
    ok++;
  } else {
    console.log(`  ❌ MISSING: ${f}`);
    missing++;
  }
});

console.log('\n' + '─'.repeat(50));
console.log(`✅ موجود: ${ok}   ❌ ناقص: ${missing}`);

if (missing === 0) {
  console.log('\n🎉 جميع الملفات جاهزة!');
  console.log('\n📦 لتشغيل المشروع:');
  console.log('   npm install');
  console.log('   npm start    → http://localhost:3000');
  console.log('   npm test     → تشغيل الاختبارات');
  console.log('   npm run dev  → وضع التطوير');
} else {
  console.log(`\n⚠️  ${missing} ملف ناقص. راجع التوثيق.`);
  process.exit(1);
}
