/*
 * SPEC 2c -- the modelling kernel is tens of megabytes, so it is cached once and
 * served from the cache thereafter. Nothing else is cached: the app shell is
 * small and should always be fresh.
 */
const CACHE = "occt-kernel-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !url.pathname.endsWith(".wasm")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) await cache.put(event.request, res.clone());
      return res;
    })
  );
});
