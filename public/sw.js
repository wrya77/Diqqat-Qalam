/**
 * sw.js — Service Worker لتطبيق دقة قلم
 *
 * الاستراتيجية:
 *  - /api و /socket.io      → شبكة فقط (لا تخزين أبداً)
 *  - الملفات الثابتة المحلية → stale-while-revalidate (سرعة + تحديث بالخلفية)
 *  - CDN (Three.js, خطوط)   → cache-first (تعمل دون اتصال بعد أول تحميل)
 */
const CACHE = 'diqqat-qalam-v1';

const CORE_ASSETS = [
  '/app',
  '/css/style.css',
  '/js/supabase-auth.js',
  '/js/gcode-generator.js',
  '/js/svg-parser.js',
  '/js/image-tracer.js',
  '/js/canvas-editor.js',
  '/js/tools-extra.js',
  '/js/tools-rail-flyout.js',
  '/js/gcode-preview.js',
  '/js/simulator-3d.js',
  '/js/simulator-three.js',
  '/js/file-importer.js',
  '/js/ui-controls.js',
  '/js/machine-control.js',
  '/js/app.js',
  '/images/logo.png',
  '/images/icon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // تخزين كل ملف على حدة — فشل ملف واحد لا يلغي التثبيت
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(CORE_ASSETS.map(a => c.add(a))))
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

  // API و WebSocket — شبكة فقط
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

  // Supabase auth — شبكة فقط
  if (url.hostname.endsWith('.supabase.co')) return;

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
