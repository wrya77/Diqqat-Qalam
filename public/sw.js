/**
 * sw.js — Service Worker لتطبيق دقة قلم
 *
 * الاستراتيجية:
 *  - /api و /socket.io      → شبكة فقط (لا تخزين أبداً)
 *  - الملفات الثابتة المحلية → stale-while-revalidate (سرعة + تحديث بالخلفية)
 *  - CDN (Three.js, خطوط)   → cache-first (تعمل دون اتصال بعد أول تحميل)
 */
const CACHE = 'diqqat-qalam-v42';

const CORE_ASSETS = [
  '/app',
  '/css/style.css',
  '/css/welcome.css',
  '/css/redesign.css',
  '/shared/geometry.js',
  '/shared/MachineConfig.js',
  '/shared/HeaderGenerator.js',
  '/shared/PocketGenerator.js',
  '/shared/ToolpathGenerator.js',
  '/shared/PathSort.js',
  '/shared/GCodeGenerator.js',
  '/shared/GCodeValidator.js',
  '/vendor/supabase.js',
  '/js/supabase-auth.js',
  '/js/svg-parser.js',
  '/js/image-tracer.js',
  '/js/image-tracer.worker.js',
  '/js/canvas-editor.js',
  '/js/tools-extra.js',
  '/js/tools-pro.js',
  '/js/tools-arrange.js',
  '/js/tools-cnc.js',
  '/js/tools-transform.js',
  '/js/tools-effects.js',
  '/js/menu-bar.js',
  '/js/ui-polish.js',
  '/js/redesign.js',
  '/js/extras.js',
  '/js/tools-rail-flyout.js',
  '/js/tools-dock.js',
  '/js/payments.js',
  '/js/gcode-preview.js',
  '/js/simulator-2d.js',
  '/js/simulator-three.js',
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
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
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
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
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
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
