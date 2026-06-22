const CACHE = "lumen-v1";

self.addEventListener("install", e => {
    self.skipWaiting();
});

self.addEventListener("activate", e => {
    clients.claim();
});

self.addEventListener("fetch", e => {
    e.respondWith(
        caches.match(e.request).then(r => {
            return r || fetch(e.request);
        })
    );
});
