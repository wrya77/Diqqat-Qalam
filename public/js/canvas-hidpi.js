/**
 * canvas-hidpi.js — كانفس بدقّة الشاشة الحقيقية
 *
 * المشكلة: `_resize` كان يضبط `canvas.width = clientWidth` — أي بكسل تخزين
 * واحد لكل بكسل CSS. على شاشة عالية الكثافة (تكبير ويندوز ١٢٥٪ أو ١٥٠٪،
 * أو شاشة Retina) يكون `devicePixelRatio` = ١٫٢٥ أو ١٫٥ أو ٢، فيرسم
 * المتصفّح الكانفس بدقّة أقلّ من العرض ثم **يكبّره**. النتيجة عطلان يبدوان
 * منفصلين وسببهما واحد:
 *   • المنحنيات متعرّجة — لأن التنعيم يعمل على شبكة أخشن من الشاشة.
 *   • الألوان باهتة — لأن التكبير يمزج البكسلات فيخفّف الحدود والخطوط
 *     الرفيعة، فتفقد الألوان تشبّعها الظاهر.
 *
 * الحلّ: مخزن الرسم بدقّة الجهاز، وحجم العرض بالبكسل المنطقي، وتحويل
 * دائم بمقدار dpr على السياق.
 *
 * لماذا نُظلّل `width`/`height` على عنصر الكانفس؟
 *   ستّ وثلاثون موضعاً في التطبيق تقرأ `canvas.width` وتتوقّعها **منطقية**
 *   (مركز العرض، الشبكة، المحاور، خريطة الملاحة، الألواح…). تغييرها إلى
 *   بكسلات الجهاز يكسرها كلّها. فنُبقي القراءة منطقية ونُخفي التكبير في
 *   الطبقة السفلى — موضع واحد يتغيّر بدل ستّة وثلاثين.
 *
 * يُحمَّل قبل `app.js` وبعد `canvas-editor.js`. لا يمسّ منطق G-Code.
 */
(function canvasHiDPI() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;

  /* نحدّها بـ٣: أعلى من ذلك يضاعف مساحة الرسم بلا فرق مرئيّ ويُثقل الإطار */
  const dpr = () => Math.min(3, Math.max(1, window.devicePixelRatio || 1));

  /**
   * يُلبس عنصر الكانفس واجهةً منطقية: القراءة تعيد بكسلات CSS، والكتابة
   * تضبط مخزن الجهاز وتعيد تطبيق تحويل التكبير (ضبط width يصفّر التحويل
   * حسب المواصفة، فلا بدّ من إعادته بعد كل كتابة).
   */
  function dressCanvas(cv, ctx) {
    if (cv.__hidpi) return;
    cv.__hidpi = { w: cv.width, h: cv.height };
    const st = cv.__hidpi;

    const make = (key, cssKey) => {
      Object.defineProperty(cv, key, {
        configurable: true,
        get() { return st[key === 'width' ? 'w' : 'h']; },
        set(v) {
          const n = Math.max(1, Math.round(v));
          const k = dpr();
          st[key === 'width' ? 'w' : 'h'] = n;
          // الكتابة على المُلكيّة الأصلية عبر النموذج الأوّلي
          const proto = Object.getPrototypeOf(cv);
          const desc = Object.getOwnPropertyDescriptor(proto, key)
                    || Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
          desc.set.call(cv, Math.round(n * k));
          cv.style[cssKey] = n + 'px';
          if (ctx) ctx.setTransform(k, 0, 0, k, 0, 0);
        },
      });
    };
    make('width', 'width');
    make('height', 'height');

    // طبّق الحالة الراهنة فوراً
    cv.width = st.w;
    cv.height = st.h;
  }

  /* نلتقط الحجم من _resize قبل أن يقارن، فنضمن إعادة البناء عند تغيّر dpr */
  const origResize = P._resize;
  P._resize = function () {
    const cv = this.canvas;
    if (cv && !cv.__hidpi) dressCanvas(cv, this.ctx);
    // تغيّر كثافة الشاشة (سحب النافذة إلى شاشة أخرى) يستوجب إعادة البناء
    if (cv && cv.__hidpi && cv.__hidpi.dpr !== dpr()) {
      cv.__hidpi.dpr = dpr();
      const w = cv.width, h = cv.height;
      cv.width = w; cv.height = h;             // يعيد ضبط المخزن والتحويل
    }
    return origResize.call(this);
  };

  /* حواف نظيفة: النصوص والخطوط الرفيعة تستفيد من تنعيم عالي الجودة */
  const origRender = P.render;
  P.render = function () {
    const ctx = this.ctx;
    if (ctx && !ctx.__hqSet) {
      ctx.__hqSet = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
    }
    return origRender.call(this);
  };

  /* تغيّر التكبير في المتصفّح يغيّر devicePixelRatio بلا حدث resize دائماً */
  let mq = null;
  function watchDPR() {
    if (mq) mq.removeEventListener('change', onChange);
    mq = window.matchMedia(`(resolution: ${dpr()}dppx)`);
    mq.addEventListener('change', onChange);
  }
  function onChange() {
    const ed = window.app && window.app.editor;
    if (ed && ed._resize) ed._resize();
    watchDPR();
  }
  try { watchDPR(); } catch (_) {}

  window.DQHiDPI = { ratio: dpr };
})();
