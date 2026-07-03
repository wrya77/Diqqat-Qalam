# سجلّ الأرباح في Google Sheets

كل دفعة تُؤكَّد في «دقة قلم» تُضاف تلقائياً صفاً في جدول Google Sheets تملكه أنت —
التاريخ، رقم الدفعة، المستخدم، الخطة، طريقة الدفع، المبلغ بالدينار.

الإعداد مرة واحدة، خمس دقائق، بلا مفاتيح Google API ولا مكتبات إضافية.

## 1) أنشئ الجدول

افتح <https://sheets.new> وسمِّ الملف مثلاً **«أرباح دقة قلم»**.

## 2) أضف السكربت

من القائمة: **Extensions ← Apps Script**، احذف الموجود والصق:

```js
function doPost(e) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('الأرباح') || ss.insertSheet('الأرباح');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['التاريخ', 'رقم الدفعة', 'المستخدم', 'الخطة', 'طريقة الدفع', 'المبلغ (د.ع)', 'الحالة']);
    sheet.setRightToLeft(true);
    sheet.getRange('1:1').setFontWeight('bold');
  }

  var d = JSON.parse(e.postData.contents);
  sheet.appendRow([d.date, d.paymentId, d.userId, d.plan, d.method, d.amountIQD, d.status]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

احفظ (Ctrl+S).

## 3) انشره كـ Web App

1. **Deploy ← New deployment**
2. النوع: **Web app**
3. *Execute as*: **Me** — *Who has access*: **Anyone**
   (الرابط سرّي وطويل؛ «Anyone» ضروري كي يستطيع الخادم النشر إليه بلا OAuth)
4. **Deploy** ووافق على الأذونات، ثم **انسخ رابط Web app**
   (يبدأ بـ `https://script.google.com/macros/s/…/exec`)

## 4) اربطه بالتطبيق

في Vercel: **Settings ← Environment Variables** أضف:

```
GSHEET_WEBHOOK_URL = <الرابط الذي نسخته>
```

ثم أعد النشر (Redeploy) ليقرأ الخادم المتغيّر الجديد.

## 5) اختبر

```bash
curl -X POST https://موقعك/api/notify/gsheet/test -H "X-API-Key: مفتاحك"
```

سيظهر صف تجربة في ورقة «الأرباح» خلال ثوانٍ. بعدها كل دفعة حقيقية تُسجَّل وحدها.

## ملاحظات

- فشل التسجيل في الجدول **لا** يؤثر على الدفع أو ترقية الاشتراك — يُطبع في سجلّ
  الخادم فقط (`[gsheet] …`).
- عند تعديل السكربت لاحقاً انشر نسخة جديدة (**Deploy ← Manage deployments ← Edit ← New version**)
  — الرابط نفسه يبقى.
- المصدر الدائم الكامل للدفعات يبقى جدول `payments` في Supabase؛ ورقة Google هي
  نسخة القراءة السريعة من الهاتف.
