// Network-first, cache-fallback service worker: whenever the device is
// online it always fetches the latest version (so edits show up on the very
// next load instead of waiting for a background-refresh cycle), and only
// falls back to the last cached copy when the network request fails, which
// is what makes the page keep working offline once it has been opened at
// least once while online (e.g. right after "Add to Home Screen"). Only
// runs over https (or localhost) -- browsers refuse to register service
// workers on file:// pages.
var CACHE_NAME = 'offline-cache-v3';
var PRECACHE_URLS = ['./', './index.html', './icon.png', './manifest.json'];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(PRECACHE_URLS.map(function (u) {
        return cache.add(u).catch(function () {});
      }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Плохое подключение ("есть значок сети, данных нет") -- не то же самое,
// что честный обрыв: настоящий fetch() может просто зависать в ожидании
// ответа десятки секунд вместо быстрого провала в catch, и до тех пор
// приложение выглядит как будто не грузится вовсе, хотя рабочая копия уже
// лежит в кэше -- ровно то, что случилось у пользователя вживую, пока не
// включила авиарежим (это заставляет ОС сразу сказать браузеру "сети нет",
// без ожидания). Гонка с таймаутом ниже даёт тот же эффект без авиарежима:
// если сеть не ответила за NETWORK_TIMEOUT_MS, сразу отдаём кэш, а настоящий
// fetch() всё равно доучивается в фоне и обновляет кэш к следующему разу,
// если/когда всё-таки дозвонится.
var NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') { return; }

  var networkPromise = fetch(req).then(function (resp) {
    if (resp && resp.status === 200) {
      var copy = resp.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
    }
    return resp;
  });

  event.respondWith(
    new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        // сеть не ответила вовремя -- сразу пробуем кэш, но settled
        // остаётся false, если кэша тоже нет: тогда единственный шанс --
        // всё-таки дождаться networkPromise ниже, ждать больше нечего.
        caches.match(req).then(function (cached) {
          if (cached && !settled) { settled = true; resolve(cached); }
        });
      }, NETWORK_TIMEOUT_MS);

      networkPromise.then(function (resp) {
        clearTimeout(timer);
        if (!settled) { settled = true; resolve(resp); }
      }).catch(function () {
        clearTimeout(timer);
        if (!settled) {
          caches.match(req).then(function (cached) {
            settled = true;
            if (cached) { resolve(cached); } else { reject('offline and not cached'); }
          });
        }
      });
    })
  );
});
