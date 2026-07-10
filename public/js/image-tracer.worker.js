/**
 * image-tracer.worker.js — تتبّع الصورة خارج الخيط الرئيسي
 *
 * يستقبل بيانات بكسل خام (RGBA) فيُجري التحويل الثنائي + تتبّع الحدود (Suzuki–Abe)
 * + التبسيط، ثم يُعيد الأشكال. الهدف: ألّا تتجمّد الواجهة أثناء تتبّع الصور الكبيرة.
 *
 * لا نكرّر الخوارزمية هنا: نستورد نفس ملف المحرك (image-tracer.js) الذي يصدّر
 * الصنف إلى `self` أيضاً، فيبقى الجوهر مصدراً واحداً للحقيقة بلا انحراف بين المسارين.
 */
'use strict';

importScripts('/js/image-tracer.js');

self.onmessage = (e) => {
  const d = e.data || {};
  try {
    const tracer = new self.ImageTracer();
    const shapes = tracer._traceFromData(d.data, d.width, d.height, {
      threshold: d.threshold,
      simplify:  d.simplify,
      invert:    d.invert,
      smooth:    d.smooth,
      scale:     d.scale,
      ratio:     d.ratio,
    });
    self.postMessage({ shapes });
  } catch (err) {
    self.postMessage({ error: (err && err.message) || String(err) });
  }
};
