/* =========================================================
   NIAS Alumni Registry
   Service Worker
   =========================================================
   التخزين المؤقت للعمل دون اتصال.

   عند تعديل أي ملف أساسي:
   غيّر VERSION إلى إصدار جديد.
   ========================================================= */

'use strict';


/* =========================================================
   الإصدار
   ========================================================= */

const VERSION = 'v1.1.3';

const CACHE =
  'nias-' + VERSION;

const RUNTIME =
  'runtime-nias-' + VERSION;


/* =========================================================
   الملفات الأساسية
   ========================================================= */

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


/* =========================================================
   تثبيت Service Worker
   ========================================================= */

self.addEventListener(
  'install',
  event => {

    event.waitUntil(

      caches
        .open(CACHE)

        .then(async cache => {

          /*
           * نحاول تخزين الملفات الأساسية.
           *
           * يتم تخزين كل ملف بشكل منفصل حتى لا يؤدي
           * غياب ملف واحد إلى فشل عملية التثبيت كاملة.
           */

          await Promise.all(

            CORE.map(async file => {

              try {

                const response =
                  await fetch(
                    new Request(
                      file,
                      {
                        cache: 'no-cache'
                      }
                    )
                  );

                if (
                  response.ok
                ) {

                  await cache.put(
                    file,
                    response
                  );

                }

              } catch (error) {

                console.warn(
                  'NIAS SW: تعذر تخزين:',
                  file
                );

              }

            })

          );

        })

        .then(() => {

          /*
           * تفعيل الإصدار الجديد مباشرة.
           */

          return self.skipWaiting();

        })

    );

  }
);


/* =========================================================
   تفعيل Service Worker
   ========================================================= */

self.addEventListener(
  'activate',
  event => {

    event.waitUntil(

      caches
        .keys()

        .then(keys => {

          return Promise.all(

            keys.map(key => {

              /*
               * حذف إصدارات NIAS القديمة.
               */

              if (
                key.startsWith('nias-') &&
                key !== CACHE
              ) {

                return caches.delete(key);

              }

              return false;

            })

          );

        })

        .then(() => {

          /*
           * السيطرة على الصفحات المفتوحة مباشرة.
           */

          return self.clients.claim();

        })

    );

  }
);


/* =========================================================
   الرسائل من التطبيق
   ========================================================= */

self.addEventListener(
  'message',
  event => {

    if (
      event.data === 'skipWaiting'
    ) {

      self.skipWaiting();

    }

  }
);


/* =========================================================
   تحديد الطلبات الخارجية التي نريد تخزينها
   ========================================================= */

const isRuntimeHost = hostname => {

  return [

    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'

  ].includes(hostname);

};


/* =========================================================
   طلبات التنقل بين الصفحات
   ========================================================= */

self.addEventListener(
  'fetch',
  event => {

    const request =
      event.request;


    /*
     * نتعامل فقط مع GET.
     */

    if (
      request.method !== 'GET'
    ) {

      return;

    }


    const url =
      new URL(
        request.url
      );


    /* =====================================================
       صفحات HTML
       ===================================================== */

    if (
      request.mode === 'navigate'
    ) {

      event.respondWith(

        (async () => {

          /*
           * أولاً:
           * نحاول الحصول على النسخة المخزنة.
           */

          const cached =
            await caches.match(
              request,
              {
                ignoreSearch: true
              }
            );


          if (cached) {

            /*
             * تحديث الصفحة في الخلفية.
             *
             * المستخدم يحصل على النسخة المحلية فوراً،
             * وفي الوقت نفسه نحاول جلب نسخة أحدث.
             */

            event.waitUntil(

              fetch(
                request,
                {
                  cache: 'no-cache'
                }
              )

                .then(response => {

                  if (
                    response &&
                    response.ok
                  ) {

                    return caches
                      .open(CACHE)
                      .then(cache =>
                        cache.put(
                          request,
                          response.clone()
                        )
                      );

                  }

                })

                .catch(() => {})

            );


            return cached;

          }


          /*
           * إذا لم توجد الصفحة المطلوبة:
           * نحاول index.html.
           */

          const index =
            await caches.match(
              './index.html'
            );


          if (index) {

            return index;

          }


          /*
           * آخر حل:
           * الاتصال المباشر.
           */

          return fetch(request);

        })()

      );

      return;

    }


    /* =====================================================
       الطلبات الخارجية
       ===================================================== */

    if (
      isRuntimeHost(
        url.hostname
      )
    ) {

      event.respondWith(

        (async () => {

          const runtime =
            await caches.open(
              RUNTIME
            );


          const cached =
            await runtime.match(
              request
            );


          try {

            /*
             * الشبكة أولاً للمكتبات والخطوط،
             * حتى تحصل على أحدث نسخة.
             */

            const response =
              await fetch(
                request
              );


            if (
              response &&
              response.ok
            ) {

              await runtime.put(
                request,
                response.clone()
              );

            }


            return response;

          } catch (error) {

            /*
             * عند عدم وجود اتصال:
             * استخدم النسخة المخزنة.
             */

            if (cached) {

              return cached;

            }


            /*
             * لا توجد نسخة محلية.
             */

            return new Response(
              '',
              {
                status: 503,
                statusText:
                  'Offline resource unavailable'
              }
            );

          }

        })()

      );

      return;

    }


    /* =====================================================
       ملفات التطبيق المحلية
       ===================================================== */

    if (
      url.origin ===
      self.location.origin
    ) {

      event.respondWith(

        (async () => {

          const cached =
            await caches.match(
              request,
              {
                ignoreSearch: true
              }
            );


          /*
           * إذا كانت النسخة موجودة:
           * نعرضها فوراً ونحاول تحديثها في الخلفية.
           */

          if (cached) {

            event.waitUntil(

              fetch(
                request,
                {
                  cache: 'no-cache'
                }
              )

                .then(response => {

                  if (
                    response &&
                    response.ok
                  ) {

                    return caches
                      .open(CACHE)
                      .then(cache => {

                        return cache.put(
                          request,
                          response.clone()
                        );

                      });

                  }

                })

                .catch(() => {})

            );


            return cached;

          }


          /*
           * لا توجد نسخة مخزنة:
           * جلب من الشبكة وتخزينها.
           */

          try {

            const response =
              await fetch(
                request
              );


            if (
              response &&
              response.ok
            ) {

              const cache =
                await caches.open(
                  CACHE
                );


              await cache.put(
                request,
                response.clone()
              );

            }


            return response;

          } catch (error) {

            /*
             * لا توجد نسخة محلية ولا اتصال.
             */

            return new Response(
              '',
              {
                status: 503,
                statusText:
                  'Offline resource unavailable'
              }
            );

          }

        })()

      );

      return;

    }

  }
);
