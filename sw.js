const CACHE = 'fieldmark-static-v7';
const CORE = ['./', './index.html', './styles.css?v=7', './app.js?v=7', './storage.js', './geometry.js', './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fieldmark-') && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Network-first keeps installed iOS PWAs on the current layout while
  // retaining an offline fallback for previously cached app files.
  if (event.request.mode === 'navigate' || /\.(css|js|webmanifest)$/.test(url.pathname)) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
      }
      return response;
    }).catch(async () => (await caches.match(event.request)) ||
      (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
