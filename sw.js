/* ============================================================
   نُخبة — Service Worker  (v7)
   استراتيجية:
   - HTML / التنقل : Network-First مع navigationPreload + مهلة 12s
   - الأصول الثابتة : Stale-While-Revalidate
   - SW نفسه + manifest : لا يُخزَّن أبداً (يُجلب من الشبكة)
   - يدعم رسالة SKIP_WAITING القادمة من sw-register / index.html
   ============================================================ */
'use strict';

const SW_VERSION = 'v7-2025';
const STATIC_CACHE  = 'elite-static-' + SW_VERSION;
const RUNTIME_CACHE = 'elite-runtime-' + SW_VERSION;
const FETCH_TIMEOUT = 12000; // 12 ثانية

// أصول نُحاول تخزينها مسبقاً (لا نفشل التثبيت إن غاب أحدها)
const PRECACHE = [
  '/',
  '/index.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE.map((url) =>
          fetch(url, { cache: 'no-store' })
            .then((res) => (res && res.ok ? cache.put(url, res.clone()) : null))
            .catch(() => null)
        )
      )
    )
  );
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // فعّل navigationPreload لتسريع التنقل
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch (e) {}
      }
      // احذف الكاشات القديمة
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- رسائل من الصفحة ---------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ---------- أدوات مساعدة ---------- */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('SW_FETCH_TIMEOUT')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function isHTMLRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html')
  );
}

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // فقط GET ونفس الأصل تُدار محلياً؛ غير ذلك يمر طبيعياً
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // لا تتدخل في نطاقات خارجية (Supabase / Workers / Fonts / APIs)
  if (!sameOrigin) return;

  // SW و manifest: لا تُخزَّن أبداً — اجلبها من الشبكة دائماً
  if (url.pathname === '/sw.js' ||
      url.pathname === '/sw-register.js' ||
      url.pathname.startsWith('/manifest.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
    return;
  }

  // HTML / التنقل: Network-First
  if (isHTMLRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          // استخدم استجابة الـ preload إن وُجدت
          const preload = await event.preloadResponse;
          if (preload) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, preload.clone()).catch(() => {});
            return preload;
          }
          const netRes = await withTimeout(
            fetch(request, { cache: 'no-store' }),
            FETCH_TIMEOUT
          );
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, netRes.clone()).catch(() => {});
          return netRes;
        } catch (err) {
          // فشلت الشبكة → ارجع للكاش (الصفحة نفسها أو index)
          const cached =
            (await caches.match(request)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/'));
          if (cached) return cached;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>غير متصل</title>' +
            '<body style="background:#060D0A;color:#4ADE80;font-family:system-ui;' +
            'display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">' +
            '<div><h2>لا يوجد اتصال بالإنترنت</h2><p>سيُعاد المحاولة تلقائياً عند عودة الاتصال.</p></div>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  // الأصول الثابتة: Stale-While-Revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      return cached || (await network) || new Response('', { status: 504 });
    })()
  );
});
