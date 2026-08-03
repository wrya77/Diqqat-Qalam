/**
 * sw.js — Service Worker لتطبيق دقة قلم
 *
 * الاستراتيجية:
 *  - /api و /socket.io      → شبكة فقط (لا تخزين أبداً)
 *  - الملفات الثابتة المحلية → stale-while-revalidate (سرعة + تحديث بالخلفية)
 *  - CDN (Three.js, خطوط)   → cache-first (تعمل دون اتصال بعد أول تحميل)
 */
const CACHE = 'diqqat-qalam-v92';

const CORE_ASSETS = [
  '/app',
  '/css/style.css',
  '/css/welcome.css',
  '/css/redesign.css',
  '/css/ui-refine.css',
  '/css/pro-polish.css',
  '/css/motion-pro.css',
  '/css/bars-pro.css',
  '/shared/geometry.js',
  '/shared/PathModel.js',
  '/shared/SpatialIndex.js',
  '/shared/MachineConfig.js',
  '/shared/HeaderGenerator.js',
  '/shared/PocketGenerator.js',
  '/shared/ToolpathGenerator.js',
  '/shared/PathSort.js',
  '/shared/PolyBoolean.js',
  '/shared/GCodeGenerator.js',
  '/shared/GCodeValidator.js',
  '/vendor/supabase.js',
  '/js/supabase-auth.js',
  '/js/icons.js',
  '/js/svg-parser.js',
  '/js/image-tracer.js',
  '/js/image-tracer.worker.js',
  '/js/editor-core.js',
  '/js/canvas-editor.js',
  '/js/path-editor.js',
  '/js/tools-extra.js',
  '/js/tools-pro.js',
  '/js/tools-arrange.js',
  '/js/tools-cnc.js',
  '/js/tools-transform.js',
  '/js/tools-effects.js',
  '/js/tools-vector-pro.js',
  '/js/tools-boolean.js',
  '/js/tools-illustrator.js',
  '/js/tools-live-transform.js',
  '/js/tools-guides.js',
  '/js/tools-cnc-invent.js',
  '/js/tools-invent5.js',
  '/js/layers-panel.js',
  '/js/object-dock.js',
  '/js/workspace-dock.js',
  '/js/panels-five.js',
  '/js/toolbar-float.js',
  '/js/canvas-hidpi.js',
  '/js/tools-liquify.js',
  '/js/tools-type-pro.js',
  '/js/tools-warp-pro.js',
  '/js/tools-pathfinder.js',
  '/js/tools-width-envelope.js',
  '/js/tools-illustrator-fx.js',
  '/js/tools-artboards.js',
  '/js/panels-illustrator.js',
  '/js/panels-five-more.js',
  '/js/interaction-pro.js',
  '/js/interaction-motion.js',
  '/js/color-system.js',
  '/js/color-tools.js',
  '/js/color-library.js',
  '/js/properties-inspector.js',
  '/js/version-history.js',
  '/js/templates-library.js',
  '/js/onboarding.js',
  '/js/command-palette.js',
  '/js/ui-scale.js',
  '/js/theme-system.js',
  '/js/menu-bar.js',
  '/js/ui-polish.js',
  '/js/redesign.js',
  '/js/extras.js',
  '/js/tools-rail-flyout.js',
  '/js/tools-dock.js',
  '/js/payments.js',
  '/js/gcode-preview.js',
  '/js/live-gcode.js',
  '/js/simulator-2d.js',
  '/js/simulator-three.js',
  '/js/cad3d-kernel.js',
  '/js/cad3d-build.js',
  '/js/cad3d-ops.js',
  '/js/cad3d-view.js',
  '/js/cad3d.js',
  '/js/file-importer.js',
  '/js/ui-controls.js',
  '/js/machine-control.js',
  '/js/app.js',
  '/images/icon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // تخزين كل ملف على حدة — فشل ملف واحد لا يلغي التثبيت
  // cache:'reload' يتجاوز كاش HTTP فيضمن أن النسخة الجديدة تجلب ملفات طازجة
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(
        CORE_ASSETS.map(a => c.add(new Request(a, { cache: 'reload' })))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * تخزين محميّ: عند تفعيل إصدار جديد يُحذف الكاش القديم، بينما تخزينات
 * stale-while-revalidate من العامل السابق ما زالت طائرة — فتصطدم بكاشٍ لم يعد
 * موجوداً وترمي NotFoundError كوعدٍ غير مُلتقَط. الاستجابة تكون قد سُلِّمت
 * للصفحة أصلاً، فالتجاهل هو التصرّف الصحيح لا الإبلاغ.
 */
function cachePut(req, res) {
  return caches.open(CACHE)
    .then(c => c.put(req, res))
    .catch(() => {});
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // تجاهل أي مخطط غير http(s) — إضافات المتصفح (chrome-extension:) لا تُخزَّن
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // API و WebSocket — شبكة فقط
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

  // Supabase auth — شبكة فقط
  if (url.hostname.endsWith('.supabase.co')) return;

  // طلبات خارجية لا نملكها (خطوط Google، إضافات، تحليلات) — دعها للمتصفح
  // مباشرة بلا اعتراض؛ اعتراضها بـ fetch داخل SW يصطدم بـ connect-src في CSP
  if (url.origin !== location.origin && url.hostname !== 'cdn.jsdelivr.net') return;

  // صفحات HTML (التنقل + /auth + /app + /) — الشبكة أولاً دائماً
  // يمنع تقديم نسخة قديمة من صفحة الدخول؛ الكاش احتياطي عند انقطاع الإنترنت فقط
  const isHTML = e.request.mode === 'navigate' ||
                 url.pathname === '/' || url.pathname === '/app' || url.pathname === '/auth' ||
                 (e.request.headers.get('accept') || '').includes('text/html');
  if (isHTML && url.origin === location.origin) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) cachePut(e.request, res.clone());
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/app')))
    );
    return;
  }

  // CDN — cache-first
  if (url.origin !== location.origin) {
    e.respondWith(
      caches.match(e.request).then(hit => hit ||
        fetch(e.request).then(res => {
          if (res.ok) cachePut(e.request, res.clone());
          return res;
        })
      )
    );
    return;
  }

  // ملفات محلية — stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(hit => {
      const refresh = fetch(e.request).then(res => {
        if (res.ok) cachePut(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
