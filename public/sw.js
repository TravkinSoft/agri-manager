const CACHE_VERSION = "travkinflow-v5-compact-icons";
const STATIC_CACHE = `${CACHE_VERSION}:static`;
const PAGE_CACHE = `${CACHE_VERSION}:pages`;

const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/brand/v1/travkinflow-logo-154a0d68.png",
  "/brand/v1/travkinflow-symbol-006f2efc.png",
  "/brand/v1/icons/favicon-32-compact-v2.png",
  "/brand/v1/icons/icon-192-compact-v2.png",
  "/brand/v1/icons/icon-512-compact-v2.png",
  "/brand/v1/icons/maskable-192-compact-v2.png",
  "/brand/v1/icons/maskable-512-compact-v2.png",
  "/brand/v1/icons/apple-touch-icon-180-compact-v2.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("travkinflow-") && !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isSameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isApiRequest(request) {
  try {
    return new URL(request.url).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function isNextRuntimeAsset(request) {
  try {
    const pathname = new URL(request.url).pathname;
    return pathname.startsWith("/_next/");
  } catch {
    return false;
  }
}

function offlinePageResponse() {
  return new Response(
    `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>TravkinFlow offline</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
    main{max-width:520px;padding:28px;border:1px solid #262d3d;border-radius:12px;background:#151922}
    h1{margin:0 0 10px;font-size:24px}
    p{margin:0;color:#b8c0cc;line-height:1.55}
  </style>
</head>
<body>
  <main>
    <h1>TravkinFlow offline</h1>
    <p>Интернета нет. Откройте ранее загруженную страницу или дождитесь связи — приложение продолжит работу и синхронизирует очередь.</p>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 }
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !isSameOrigin(request) || isApiRequest(request)) return;

  if (isNextRuntimeAsset(request)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const pageCache = await caches.open(PAGE_CACHE);
          const cachedShell = await pageCache.match("/dashboard");
          return cachedShell || offlinePageResponse();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        return response;
      });
    })
  );
});
