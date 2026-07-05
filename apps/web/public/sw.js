const STATIC_CACHE = "ai-finances-static-v1";
const STATIC_ASSETS = [
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-icon-192.png",
  "/icons/maskable-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.filter((cacheName) => cacheName !== STATIC_CACHE).map((cacheName) => caches.delete(cacheName)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate" || url.pathname.startsWith("/api/")) {
    event.respondWith(networkOnly(request));
  }
});

function isStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/");
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
  }

  return response;
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    if (request.mode === "navigate") {
      return new Response("AI Finances needs a network connection.", {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8"
        },
        status: 503
      });
    }

    return new Response(JSON.stringify({ error: "Network unavailable." }), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8"
      },
      status: 503
    });
  }
}
