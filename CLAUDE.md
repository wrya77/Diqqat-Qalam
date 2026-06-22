# CLAUDE.md

دليل موجز للعمل في هذا المستودع (للوكلاء والمساهمين). يصف البنية والأوامر والأعراف.

## نظرة عامة
**دقة قلم** تطبيق ويب يحوّل التصاميم الهندسية والخطوط العربية إلى G-Code لآلات CNC.
خادم Express واحد يخدم الصفحات الثابتة وواجهة REST، مع Supabase للمصادقة والتخزين الدائم.

## الأوامر
```bash
npm install       # تثبيت التبعيات
npm start         # تشغيل الخادم على :3000
npm run dev       # تطوير مع إعادة تشغيل تلقائية (nodemon)
npm test          # jest + تغطية
npm run test:watch
```
- لا يوجد bundler؛ سكربتات المتصفح تُحمّل مباشرةً بـ`defer` من `public/index.html`.
- بعد تعديل أي أصل مُخزَّن في الـService Worker، **ارفع مفتاح `CACHE` في `public/sw.js`** وإلا لن يصل التحديث للمستخدمين.

## البنية
```
server.js            ← خادم Express (نقطة الدخول؛ على Vercel يُصدَّر كدالة)
src/                 ← منطق الخادم، مقسوم حسب المسؤولية:
  ai/ core/ generators/ optimizers/ parsers/ exporters/
  utils/ middleware/ payments/ notify/ models/ workers/ lib/
shared/              ← وحدات «متماثلة» (تعمل في الخادم والمتصفح) — المصدر الوحيد للحقيقة
public/              ← الواجهة (صفحات HTML متعددة، css/ js/ fonts/ images/ vendor/)
tests/               ← اختبارات jest
scripts/             ← أدوات بناء/توليد
electron/ build/     ← تغليف سطح المكتب (electron-builder)
```

### قاعدة مهمة: `shared/` مقابل `src/`
الوحدات المنطقية المشتركة بين الخادم والمتصفح تعيش **مرة واحدة** في `shared/`
(مثل `GCodeGenerator.js`, `ToolpathGenerator.js`, `MachineConfig.js`, `geometry.js`).
ملفات `src/` المقابلة لها مجرد **جسور re-export**:
```js
module.exports = require('../../shared/GCodeGenerator');
```
عدّل المنطق في `shared/` فقط — لا تكرّره في `src/`.

### المحاكيان (لا تخلط بينهما)
- `public/js/simulator-2d.js` → `class GCodeSimulator`: معاينة مسار الأداة ثنائية الأبعاد.
- `public/js/simulator-three.js` → `Toolpath3D`: عرض ثلاثي الأبعاد عبر Three.js
  (يُحمَّل من `public/vendor/three.min.js` محلياً، مع ارتداد CDN).

## النشر
- **Vercel = الإنتاج القانوني** (`vercel.json`). دمج `main` يَنشر تلقائياً.
  ملاحظات serverless: نظام الملفات للقراءة فقط (الكود يتحوّل إلى `/tmp` على Vercel)،
  و`includeFiles` في `vercel.json` تشحن `public/**` و`shared/**` داخل الدالة.
- **Railway / Procfile** هدفان بديلان للاستضافة الذاتية الدائمة (الخادم يتعامل مع
  `SIGTERM` وإعادة التشغيل). ليسا مستخدمَين في الإنتاج الحالي لكن يبقيان كخيار.

## الأعراف
- أصناف الخادم/المشترك: `PascalCase.js`. سكربتات المتصفح: `kebab-case.js`.
- لا تُضِف أسراراً للمستودع؛ استخدم `.env` (انظر `.env.example`). بيانات التشغيل
  (`uploads/ projects/ exports/ backups/ data/`) محجوبة في `.gitignore`.
- تنسيق الشيفرة عبر `.editorconfig` + `.prettierrc`.
