# سجل التغييرات — Changelog

يلتزم هذا الملف بنمط [Keep a Changelog](https://keepachangelog.com/)،
والمشروع يتبع [الإصدار الدلالي](https://semver.org/lang/ar/).

## [غير مُصدَر] — Unreleased

### أُضيف
- استضافة Three.js ذاتياً من `public/vendor/three.min.js` (مع ارتداد CDN احتياطي).
- تتبّع الصور خارج الخيط الرئيسي عبر Web Worker (`image-tracer.worker.js`).
- ملفات حوكمة المستودع: LICENSE, SECURITY.md, CHANGELOG.md, CLAUDE.md،
  وإعدادات التنسيق (`.editorconfig`, `.prettierrc`, `.eslintrc.json`).

### تغيّر
- تحميل كل سكربتات `index.html` بـ`defer` (تنزيل متوازٍ بلا حجب للعرض).
- العرض ثلاثي الأبعاد يرسم عند الطلب بدل حلقة rAF دائمة (توفير المعالج عند الخمول).
- إيقاف استطلاع حالة الجهاز عند إخفاء التبويب؛ تحميل منافذ Serial كسولاً.
- إضافة مهلات `fetch` و`<noscript>` لصفحتي الدفع والخط لمنع «الدوّارة الأبدية».
- توضيح اسم محاكي المسار ثنائي الأبعاد: `simulator-3d.js` → `simulator-2d.js`.

### أمان
- إغلاق ثغرات SSRF (DNS rebinding)، اجتياز المسارات، وضبط CORS وذاكرة الرموز.

### حُذف
- `public/test.html` (صفحة فحص تطويرية لم تَعُد مستخدمة).
