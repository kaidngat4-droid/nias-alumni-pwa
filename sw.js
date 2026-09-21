/* عامل الخدمة: تخزين مؤقت للعمل دون اتصال.
   غيّر رقم VERSION عند كل تحديث للملفات. */

const VERSION = 'v1.1.1';
const CACHE = 'nias-' + VERSION;
const RUNTIME = 'runtime-nias';

const CORE = [
  './',
  './index.html',
  './login.html',
  './styles.css',
  './app.js',
  './auth.js',
  './manifest.webmanifest',

  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',

  './img/emblem.png',
  './img/seal.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(
              key =>
                key.startsWith('nias-') &&
                key !== CACHE
            )
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // نتعامل فقط مع طلبات GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /*
   * صفحات التطبيق:
   * نحاول من التخزين المؤقت أولاً،
   * ثم index.html كحل احتياطي.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request, { ignoreSearch: true })
        .then(cached => cached || caches.match('./index.html'))
        .then(cached => cached || fetch(request))
    );
    return;
  }

  /*
   * ملفات التطبيق المحلية
   */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true })
        .then(cached => {
          if (cached) return cached;

          return fetch(request).then(response => {
            if (response.ok) {
              const copy = response.clone();

              caches.open(CACHE).then(cache => {
                cache.put(request, copy);
              });
            }

            return response;
          });
        })
    );

    return;
  }

  /*
   * مكتبات خارجية:
   * Excel + الخطوط
   *
   * يتم حفظها عند أول استخدام،
   * وبعد ذلك يمكن استخدامها دون اتصال.
   */
  if (
    [
      'cdnjs.cloudflare.com',
      'fonts.googleapis.com',
      'fonts.gstatic.com'
    ].includes(url.hostname)
  ) {
    event.respondWith(
      caches.open(RUNTIME).then(async cache => {
        const cached = await cache.match(request);

        try {
          const response = await fetch(request);

          if (response.ok) {
            cache.put(request, response.clone());
          }

          return response;
        } catch (error) {
          return cached;
        }
      })
    );
  }
});
