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
├── server.js          ← خادم Express (نقطة الدخول؛ دالة serverless على Vercel)
├── public/            ← الواجهة الأمامية (صفحات متعددة)
│   ├── index.html · landing.html · auth.html · checkout.html
│   ├── calligraphy.html · feeds.html · quote.html
│   ├── css/ · fonts/ · images/
│   ├── vendor/        ← مكتبات مستضافة ذاتياً (three.min.js, hb.wasm, …)
│   └── js/
│       ├── app.js            ← المنسّق الرئيسي
│       ├── canvas-editor.js  ← محرر الرسم
│       ├── svg-parser.js     ← محلل SVG
│       ├── gcode-preview.js  ← عرض G-Code
│       ├── simulator-2d.js   ← محاكاة المسار ثنائية الأبعاد (GCodeSimulator)
│       ├── simulator-three.js← عرض ثلاثي الأبعاد (Toolpath3D / Three.js)
│       ├── image-tracer.js(.worker.js) ← تتبّع الصور (+Web Worker)
│       ├── file-importer.js  ← استيراد الملفات
│       └── ui-controls.js    ← عناصر التحكم
├── shared/            ← وحدات متماثلة (خادم+متصفح) — المصدر الوحيد للحقيقة
│   └── GCodeGenerator · ToolpathGenerator · MachineConfig · geometry …
├── src/               ← منطق الخادم (ملفاته المطابقة لـshared/ مجرد جسور re-export)
│   ├── generators/ · parsers/ · optimizers/ · exporters/
│   ├── ai/ · core/ · payments/ · middleware/ · notify/ · utils/
└── tests/             ← اختبارات jest
```

> **shared/ مقابل src/:** المنطق المشترك يعيش مرة واحدة في `shared/`؛ ملفات `src/`
> المقابلة مجرد `module.exports = require('../../shared/…')`. عدّل `shared/` فقط.

## 🌐 المسارات الإضافية

| المسار | الأداة |
|--------|--------|
| `/feeds` | حاسبة السرعات والتغذية |
| `/quote` | مولّد عروض الأسعار |

## ☁️ النشر

- **Vercel = الإنتاج القانوني** (`vercel.json`): دمج `main` يَنشر تلقائياً.
  `includeFiles` تشحن `public/**` و`shared/**` داخل الدالة، والكتابة تتمّ في `/tmp`.
- **Railway / Procfile**: هدفان بديلان للاستضافة الذاتية الدائمة (غير مستخدمَين حالياً).
- يتطلّب **Node ≥ 20** (انظر `engines` في `package.json`).

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
