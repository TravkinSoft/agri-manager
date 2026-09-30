import { NextRequest, NextResponse } from 'next/server';

function callbackBridgeHtml() {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TravkinFlow - завершение регистрации</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; }
      .box { max-width: 420px; padding: 28px; border: 1px solid #dbe3ef; border-radius: 12px; background: #fff; box-shadow: 0 18px 48px rgba(15, 23, 42, .08); text-align: center; }
      .muted { color: #64748b; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main class="box">
      <h1>Подготавливаем регистрацию</h1>
      <p class="muted">Сейчас откроется страница установки пароля.</p>
    </main>
    <script>
      (function () {
        var url = new URL(window.location.href);
        var search = url.search || "";
        var hash = url.hash || "";
        var params = new URLSearchParams(url.search);
        var hashParams = new URLSearchParams(hash.replace(/^#/, ""));
        var type = params.get("type") || hashParams.get("type");
        var hasAuthPayload =
          params.has("code") ||
          params.has("token_hash") ||
          hashParams.has("access_token") ||
          hashParams.has("refresh_token") ||
          hashParams.has("error");

        if (type === "invite" || type === "recovery" || hasAuthPayload) {
          window.location.replace("/auth/set-password" + search + hash);
          return;
        }

        window.location.replace("/dashboard");
      })();
    </script>
  </body>
</html>`;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const type = requestUrl.searchParams.get('type');

  if (type === 'invite' || type === 'recovery') {
    return new NextResponse(callbackBridgeHtml(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return new NextResponse(callbackBridgeHtml(), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
