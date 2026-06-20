/* ============================================================
   نُخبة — sw-register.js  (احتياطي / مستقل)
   ملاحظة: index.html يسجّل الـ SW بنفسه. هذا الملف اختياري
   ويُستخدم فقط إن أردت فصل منطق التسجيل عن الصفحة.
   آمن: يتجنّب التسجيل المزدوج عبر علم window.__SW_REGISTERED__.
   ============================================================ */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  if (window.__SW_REGISTERED__) return;        // تجنّب التسجيل المزدوج
  window.__SW_REGISTERED__ = true;

  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) return;
    refreshing = true;
    var last = 0;
    try { last = parseInt(sessionStorage.getItem('_sw_reloaded_at') || '0', 10); } catch (e) {}
    var now = Date.now();
    if (now - last < 60000) return;
    try { sessionStorage.setItem('_sw_reloaded_at', String(now)); } catch (e) {}
    window.location.reload();
  });

  function activate(worker) {
    if (worker && worker.state === 'installed' && navigator.serviceWorker.controller) {
      worker.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (reg) {
      if (reg.waiting) activate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () { activate(nw); });
      });
      setInterval(function () { reg.update().catch(function () {}); }, 120000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
      reg.update().catch(function () {});
    }).catch(function () {});
  });

  /* ── استرداد الشبكة + قمع أخطاء العابرة ── */
  window.addEventListener('online', function () {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'NETWORK_ONLINE' });
    }
  });
  window.addEventListener('unhandledrejection', function (e) {
    var m = (e && e.reason && (e.reason.message || e.reason)) || '';
    m = String(m);
    if (m.indexOf('REQUEST_TIMEOUT') !== -1 ||
        m.indexOf('Failed to fetch') !== -1 ||
        m.indexOf('NetworkError') !== -1) {
      e.preventDefault(); // أخطاء شبكة عابرة — لا تُظهرها للمستخدم
    }
  });
})();
