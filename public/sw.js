/**
 * sw.js — Service Worker لتطبيق دقة قلم
 *
 * الاستراتيجية:
 *  - /api و /socket.io      → شبكة فقط (لا تخزين أبداً)
 *  - الملفات الثابتة المحلية → stale-while-revalidate (سرعة + تحديث بالخلفية)
 *  - CDN (Three.js, خطوط)   → cache-first (تعمل دون اتصال بعد أول تحميل)
 */
const CACHE = 'diqqat-qalam-v29';

// كل سكربتات الواجهة صارت في حزمة واحدة (dist/app.bundle.js) — تثبيت أسرع للـ SW.
const CORE_ASSETS = [
  '/app',
  '/css/style.css',
  '/vendor/supabase.js',
  '/dist/app.bundle.js',
  '/images/logo.png',
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
