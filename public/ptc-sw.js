/* Scope: /traffic-operator only. No caches, offline writes, background sync,
 * credentials or authenticated response storage. The ERP worker is untouched. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function offlineResponse() {
  return new Response(
    `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0c1118">
<link rel="manifest" href="/traffic-operator.webmanifest">
<title>Оборот машин — нет соединения</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:#0c1118;color:#f1f5f9;font:16px/1.5 system-ui,sans-serif;padding:max(24px,env(safe-area-inset-top)) 20px max(24px,env(safe-area-inset-bottom))}main{width:100%;max-width:380px}small{color:#fcd34d;letter-spacing:.12em}h1{font-size:28px;line-height:1.2;margin:24px 0 12px}p{color:#94a3b8}a{min-height:48px;display:flex;align-items:center;justify-content:center;margin-top:24px;border-radius:12px;background:#fcd34d;color:#0c1118;text-decoration:none;font-weight:600}
</style></head><body><main><small>TRAVKINFLOW · ОБОРОТ МАШИН</small>
<h1>Нет соединения</h1><p>Свежие статусы сейчас недоступны. Для работы кабинета нужен интернет.</p>
<p>Действия без связи не сохраняются в очередь и не отправляются автоматически.</p>
<a href="/traffic-operator">Проверить соединение</a></main>
<script>window.addEventListener('online',function(){window.location.reload()});</script>
</body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // API/auth/session requests and all writes go straight to the network.
  // Runtime/RSC/assets are never stored in a service-worker cache either.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  const isCabinet =
    url.pathname === "/traffic-operator" ||
    url.pathname.startsWith("/traffic-operator/");
  if (request.mode === "navigate" && isCabinet) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() => offlineResponse()),
    );
  }
});
