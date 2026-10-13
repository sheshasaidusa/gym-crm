// Service worker for the member app (scope /m). It only does two things:
//  1. keeps the app installable and shows a friendly page when the phone is offline;
//  2. caches the build's static files so the app opens fast.
// It never touches /api: a member's data must always come fresh from the server, and is never
// stored by the worker.

const CACHE = "m-shell-v1";
const OFFLINE_URL = "/m/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages of the member app: network first, the offline page if the network is gone.
  if (request.mode === "navigate") {
    if (url.pathname !== "/m" && !url.pathname.startsWith("/m/")) return;
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Build output is content-hashed, so cache-first is safe.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
  }
});
