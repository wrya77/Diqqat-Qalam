# ✏ دقة قلم — Diqqat Qalam

تطبيق ويب متكامل يحوّل التصاميم الهندسية إلى G-Code لمطابع CNC تلقائياً.

## 🚀 التشغيل السريع

```bash
npm install
npm start
# افتح: http://localhost:3000
```

## ✨ الميزات

| الميزة | التفاصيل |
|--------|----------|
| 🎨 محرر رسم تفاعلي | خطوط، مستطيلات، دوائر، أقواس، رسم حر |
| 📁 استيراد | SVG, DXF, G-Code |
| ⚙️ إعدادات كاملة | قطر الأداة، سرعات، أعماق، تعويض G41/G42 |
| 🔄 G-Code كامل | G00/G01/G02/G03، طبقات متعددة، رأس وتذييل |
| 👁️ محاكاة بصرية | عرض مسار الأداة قبل التشغيل |
| 🤖 تحسين AI | تحسين ترتيب المسارات عبر Claude API |
| 💾 تصدير | .nc, .gcode, .tap, .cnc |

## 🏃 الأوامر

```bash
npm start       # تشغيل الخادم
npm run dev     # وضع التطوير (إعادة تشغيل تلقائية)
npm test        # تشغيل الاختبارات
node scripts/generate-all-files.js  # فحص جميع الملفات
```

## 🤖 الذكاء الاصطناعي (اختياري)

```bash
# في ملف .env
ANTHROPIC_API_KEY=sk-ant-api03-xxxx
```

## 📁 هيكل المشروع

```
diqqat-qalam/
├── server.js          ← خادم Express + Socket.io
├── public/            ← الواجهة الأمامية
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js            ← المنسّق الرئيسي
│       ├── canvas-editor.js  ← محرر الرسم
│       ├── gcode-generator.js ← مولّد G-Code (متصفح)
│       ├── svg-parser.js     ← محلل SVG
│       ├── gcode-preview.js  ← عرض G-Code
│       ├── simulator-3d.js   ← المحاكاة
│       ├── file-importer.js  ← استيراد الملفات
│       └── ui-controls.js    ← عناصر التحكم
└── src/               ← منطق الخادم
    ├── generators/    ← توليد G-Code
    ├── parsers/       ← تحليل الملفات
    ├── optimizers/    ← تحسين المسارات
    ├── ai/            ← الذكاء الاصطناعي
    ├── core/          ← المعالج والإعدادات
    └── utils/         ← أدوات مساعدة
```

## 🔑 اختصارات لوحة المفاتيح

| مفتاح | الوظيفة |
|-------|---------|
| V | تحديد |
| L | رسم خط |
| R | رسم مستطيل |
| C | رسم دائرة |
| A | رسم قوس |
| P | خط متعدد النقاط |
| F | رسم حر |
| Ctrl+Z | تراجع |
| Ctrl+Y | إعادة |
| Enter | توليد G-Code |
| Esc | إلغاء الرسم الحالي |
| Delete | حذف الشكل المحدد |
