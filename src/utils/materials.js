/**
 * materials.js — خصائص المواد الافتراضية لاستخدامها في نماذج القوة
 * القيم تقريبية للاستخدام في التقديرات والقرارات البرمجية
 */

module.exports = {
  generic: { name: 'Generic', Kc: 1200, recChipLoad: 0.02 },
  wood:    { name: 'Wood',    Kc: 300,  recChipLoad: 0.10 },
  aluminum:{ name: 'Aluminum',Kc: 800,  recChipLoad: 0.02 },
  steel:   { name: 'Steel',   Kc: 2200, recChipLoad: 0.01 },
  brass:   { name: 'Brass',   Kc: 1500, recChipLoad: 0.02 },
  plastic: { name: 'Plastic', Kc: 200,  recChipLoad: 0.05 },
};
