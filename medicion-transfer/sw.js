/*
 * sw.js — Service worker: guarda la aplicación en el teléfono para usarla sin conexión.
 * IMPORTANTE: cada vez que publiques cambios, aumenta el número de VERSION
 * para que los teléfonos descarguen la nueva versión.
 */
var VERSION = 'v2.4.0';
var CACHE = 'medicion-transfer-' + VERSION;
var ARCHIVOS = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/calculos.js',
  './js/maquinas.js',
  './js/xlsx-mini.js',
  './js/db.js',
  './js/app.js',
  './js/jsQR.js',
  './manifest.webmanifest',
  './img/logo-blanco.png',
  './img/logo-color.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.filter(function (k) { return k.indexOf('medicion-transfer-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Estrategia: responde desde la caché (rápido y sin conexión) y actualiza en segundo plano.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (enCache) {
        var red = fetch(req).then(function (resp) {
          if (resp && resp.ok) cache.put(req, resp.clone());
          return resp;
        }).catch(function () {
          if (req.mode === 'navigate') return cache.match('./index.html');
          return enCache;
        });
        return enCache || red;
      });
    })
  );
});
