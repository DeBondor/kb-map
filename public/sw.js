/**
 * Minimal service worker for PWA installability + offline app shell.
 *
 * Deliberately conservative:
 *  - /api/* is NEVER touched — live vehicle data must not be served stale;
 *  - cross-origin requests (map tiles, OSRM) pass through untouched;
 *  - hashed build assets (/_next/static) and static icons are cache-first
 *    (content-addressed, safe forever);
 *  - navigations are network-first with the cached shell as offline fallback.
 *
 * Bump CACHE on breaking changes to the caching strategy (old caches are
 * dropped on activate).
 */
const CACHE = "kb-shell-v1";
const SHELL = "/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // immutable build assets + icons: cache-first
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      })(),
    );
    return;
  }

  // page navigations: network-first, cached shell offline
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const resp = await fetch(req);
          if (resp.ok) cache.put(SHELL, resp.clone());
          return resp;
        } catch {
          const hit = await cache.match(SHELL);
          return hit ?? Response.error();
        }
      })(),
    );
  }
});
