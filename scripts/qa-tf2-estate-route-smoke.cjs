/*
 * Authenticated, read-only Estate Register route smoke.
 *
 * This harness never clicks application controls and rejects browser-side
 * business mutations. QA authentication is ephemeral: privileged keys and the
 * resulting session remain in this process and no storageState is written.
 * It is suitable for qa.travkinflow.com, an immutable Vercel QA preview, or a
 * local dev server configured against the dedicated QA Supabase branch.
 *
 * Configuration:
 *   TF2_ESTATE_BASE_URL       default http://127.0.0.1:3000
 *   TF2_ESTATE_EXPECT_SHA     optional exact/abbreviated candidate SHA
 *   TF2_ESTATE_ROUTES         semicolon-separated route override
 *   TF2_ESTATE_VIEWPORTS      default 360x844,844x390,768x1024,1440x1000
 *   TF2_ESTATE_ENGINES        default chromium; e.g. chromium,webkit
 *   TF2_ESTATE_EVIDENCE       output directory override
 *   TF2_ESTATE_MOCK_WB_UNLOCK=1 local-only, read-only visual gate past the PIN shell
 *   TF2_ESTATE_DRY_RUN=1      validate and print the plan; no network/browser
 *   PTC_PLAYWRIGHT_MODULE     Playwright module path when not locally installed
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");

const root = process.cwd();
const req = createRequire(path.join(root, "package.json"));
const { createClient } = req("@supabase/supabase-js");
const playwright = require(process.env.PTC_PLAYWRIGHT_MODULE || "playwright");

const QA_REF = "gsglkmudcwkdetqtocae";
const QA_PARENT_REF = "bhsemlvmkikpntabctml";
const QA_COMPANY_ID = "8a0f2c0e-6638-4a31-99a8-cab4237d287d";
const QA_COMPANY_ADMIN_ID = "a7e858c7-1d89-4a41-a92f-166eab12273f";
const VERCEL_PROJECT_ID = "prj_G6av1IprN9oKDotEEYIj0MtdXedi";
const VERCEL_TEAM_ID = "team_bgc6VKF6gPKh1R3POSWYdHut";

const target = new URL(process.env.TF2_ESTATE_BASE_URL || "http://127.0.0.1:3000");
const expectedSha = String(process.env.TF2_ESTATE_EXPECT_SHA || "").trim();
const expectedTheme = "estate-register";
const mockWeighbridgeUnlock = process.env.TF2_ESTATE_MOCK_WB_UNLOCK === "1";
const defaultRoutes = [
  "/dashboard",
  "/fields",
  "/crop-structure",
  "/operations",
  "/warehouses",
  "/weighbridge",
  "/traffic",
  "/fleet",
  "/analytics",
  "/references?domain=machine-yard&tab=park&category=all",
  "/users",
  "/settings",
];

function parseRoutes(value) {
  const routes = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
  return routes.length ? routes : defaultRoutes;
}

function parseViewports(value) {
  const items = String(value || "360x844,844x390,768x1024,1440x1000")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = /^(\d{3,4})x(\d{3,4})$/.exec(item);
      assert(match, `Invalid viewport: ${item}`);
      const width = Number(match[1]);
      const height = Number(match[2]);
      assert(width >= 320 && width <= 2560 && height >= 320 && height <= 2000, `Unsafe viewport: ${item}`);
      return { width, height };
    });
  assert(items.length > 0, "At least one viewport is required");
  return items;
}

function parseEngines(value) {
  const names = String(value || "chromium").split(",").map((item) => item.trim()).filter(Boolean);
  assert(names.length > 0, "At least one browser engine is required");
  for (const name of names) assert(["chromium", "webkit"].includes(name), `Unsupported engine: ${name}`);
  return [...new Set(names)];
}

const routes = parseRoutes(process.env.TF2_ESTATE_ROUTES);
const viewports = parseViewports(process.env.TF2_ESTATE_VIEWPORTS);
const engines = parseEngines(process.env.TF2_ESTATE_ENGINES);
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const immutablePreview = /^agri-manager-[a-z0-9]+-travkin-ais-projects\.vercel\.app$/;
assert(
  localHosts.has(target.hostname) || target.hostname === "qa.travkinflow.com" || immutablePreview.test(target.hostname),
  `Refusing non-QA target: ${target.hostname}`,
);
assert(!/^www\.?travkinflow\.com$/.test(target.hostname) && target.hostname !== "travkinflow.com", "Production is forbidden");
if (mockWeighbridgeUnlock) {
  assert(localHosts.has(target.hostname), "The visual-only weighbridge unlock is local-only");
}
for (const routePath of routes) {
  const parsed = new URL(routePath, target);
  assert.equal(parsed.origin, target.origin, `Cross-origin route is forbidden: ${routePath}`);
  assert(parsed.pathname.startsWith("/"), `Invalid route: ${routePath}`);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.resolve(process.env.TF2_ESTATE_EVIDENCE || path.join(".artifacts", "estate-route-smoke", timestamp));

function commandJson(command) {
  const raw = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(raw.trim().replace(/^\uFEFF/, ""));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function cleanText(value, limit = 900) {
  return String(value || "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, "[jwt-redacted]")
    .slice(0, limit);
}

function routeSlug(routePath) {
  return routePath.replace(/^\//, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "root";
}

function timedFetch(input, init = {}) {
  const signals = init.signal ? [init.signal] : [];
  return fetch(input, { ...init, signal: AbortSignal.any([...signals, AbortSignal.timeout(45_000)]) });
}

async function createEphemeralQaSession() {
  const keys = commandJson(
    `npx --yes supabase@latest branches get ${QA_REF} --project-ref ${QA_PARENT_REF} --output json`,
  );
  assert.equal(new URL(keys.SUPABASE_URL).hostname, `${QA_REF}.supabase.co`, "Exact QA Supabase branch required");
  assert(keys.SUPABASE_SERVICE_ROLE_KEY && keys.SUPABASE_ANON_KEY, "QA branch keys unavailable");

  const service = createClient(keys.SUPABASE_URL, keys.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timedFetch },
  });
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,role,company_id,status")
    .eq("id", QA_COMPANY_ADMIN_ID)
    .single();
  assert(!profileError, "Existing QA profile read failed");
  assert.deepEqual(
    { id: profile.id, role: profile.role, company_id: profile.company_id, status: profile.status },
    { id: QA_COMPANY_ADMIN_ID, role: "company_admin", company_id: QA_COMPANY_ID, status: "active" },
    "Existing QA company admin identity changed",
  );

  const { data: userData, error: userError } = await service.auth.admin.getUserById(QA_COMPANY_ADMIN_ID);
  assert(!userError && userData.user?.id === QA_COMPANY_ADMIN_ID && userData.user.email, "Existing QA auth user required");
  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });
  assert(!linkError && linkData.user?.id === QA_COMPANY_ADMIN_ID, "QA magic-link generation failed");

  const auth = createClient(keys.SUPABASE_URL, keys.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timedFetch },
  });
  const { data, error } = await auth.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  assert(!error && data.session?.user?.id === QA_COMPANY_ADMIN_ID, "Ephemeral QA auth verification failed");
  return data.session;
}

function getAutomationBypass() {
  if (localHosts.has(target.hostname)) return "";
  const project = commandJson(
    `npx --yes vercel@59.14.0 api '/v9/projects/${VERCEL_PROJECT_ID}?teamId=${VERCEL_TEAM_ID}' --raw`,
  );
  const bypass = Object.entries(project.protectionBypass || {}).find(([, value]) => value.scope === "automation-bypass")?.[0];
  assert(bypass, "Existing Vercel automation bypass required");
  return bypass;
}

async function readHealth(bypass) {
  const response = await timedFetch(new URL("/api/healthz", target), {
    method: "GET",
    headers: bypass ? { "x-vercel-protection-bypass": bypass } : {},
  });
  const body = await response.json().catch(() => ({}));
  const commit = String(body.commit || body.version?.commit || body.git?.sha || body.sha || "");
  assert.equal(response.status, 200, `Health check failed: HTTP ${response.status}`);
  assert(body.ok, "Health check returned ok=false");
  if (expectedSha) {
    assert(commit && (expectedSha.startsWith(commit) || commit.startsWith(expectedSha)), `Unexpected deployment SHA: ${commit || "missing"}`);
  }
  return { status: response.status, ok: Boolean(body.ok), commit: commit || null };
}

function engineLaunchOptions(name) {
  if (name !== "chromium") return { headless: true };
  const channel = String(process.env.TF2_ESTATE_CHROMIUM_CHANNEL || "chrome").trim();
  return channel === "bundled" ? { headless: true } : { headless: true, channel };
}

async function main() {
  const plan = {
    target: target.origin,
    expectedSha: expectedSha || null,
    expectedTheme,
    role: "company_admin",
    routes,
    viewports,
    engines,
    readOnly: true,
    productionForbidden: true,
  };
  if (process.env.TF2_ESTATE_DRY_RUN === "1") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  fs.mkdirSync(output, { recursive: true });
  const report = {
    at: new Date().toISOString(),
    ...plan,
    output,
    auth: { mode: "ephemeral-existing-qa-user", sessionPersisted: false },
    health: null,
    rows: [],
    blockedMutations: [],
    wrongSupabaseHosts: [],
    externalReadOrigins: [],
    summary: null,
  };
  const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  save();

  let session;
  let bypass;
  try {
    session = await createEphemeralQaSession();
    bypass = getAutomationBypass();
    report.health = await readHealth(bypass);
    save();
  } catch (error) {
    report.fatal = cleanText(error.stack || error, 1800);
    save();
    throw error;
  }

  const externalOrigins = new Set();
  let completed = 0;
  try {
    for (const engineName of engines) {
      const browserType = playwright[engineName];
      assert(browserType, `Playwright engine unavailable: ${engineName}`);
      const browser = await browserType.launch(engineLaunchOptions(engineName));
      try {
        for (const viewport of viewports) {
          const blockedMutations = [];
          const wrongSupabaseHosts = [];
          const context = await browser.newContext({
            viewport,
            isMobile: viewport.width < 500,
            hasTouch: viewport.width < 500,
            locale: "ru-RU",
            timezoneId: "Asia/Almaty",
            reducedMotion: "reduce",
            serviceWorkers: "block",
          });
          await context.route("**/*", async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const method = request.method().toUpperCase();
            if (url.hostname.endsWith(".supabase.co") && url.hostname !== `${QA_REF}.supabase.co`) {
              wrongSupabaseHosts.push(url.hostname);
              return route.abort("blockedbyclient");
            }
            const authRefresh = url.hostname === `${QA_REF}.supabase.co` && url.pathname === "/auth/v1/token" && method === "POST";
            const readRpc = url.hostname === `${QA_REF}.supabase.co`
              && method === "POST"
              && /^\/rest\/v1\/rpc\/(get_user_company_id|get_current_actor_context|get_effective_company_id)$/.test(url.pathname);
            if (
              mockWeighbridgeUnlock
              && method === "GET"
              && url.origin === target.origin
              && url.pathname === "/api/weighbridge/operator-session"
            ) {
              const response = await route.fetch();
              const payload = await response.json();
              const operator = payload.operator || payload.operators?.[0] || {
                id: "qa-visual-operator",
                name: "QA визуальная сессия",
              };
              const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
              return route.fulfill({
                response,
                contentType: "application/json",
                body: JSON.stringify({
                  ...payload,
                  unlocked: true,
                  operator,
                  operators: payload.operators?.length ? payload.operators : [operator],
                  session_expires_at: expiresAt,
                  shift_expires_at: expiresAt,
                  initial_workspace: null,
                }),
              });
            }
            if (!["GET", "HEAD", "OPTIONS"].includes(method) && !authRefresh && !readRpc) {
              blockedMutations.push({ method, url: safeUrl(request.url()) });
              return route.abort("blockedbyclient");
            }
            if (url.origin === target.origin && bypass) {
              return route.continue({ headers: { ...request.headers(), "x-vercel-protection-bypass": bypass } });
            }
            if (url.origin !== target.origin && url.hostname !== `${QA_REF}.supabase.co`) externalOrigins.add(url.origin);
            return route.continue();
          });
          await context.addInitScript(
            ({ authSession, origin, storageKey }) => {
              if (location.origin === origin && !localStorage.getItem(storageKey)) {
                localStorage.setItem(storageKey, JSON.stringify(authSession));
              }
            },
            { authSession: session, origin: target.origin, storageKey: `sb-${QA_REF}-auth-token` },
          );

          const page = await context.newPage();
          page.setDefaultTimeout(20_000);
          const pageErrors = [];
          const consoleErrors = [];
          const requestFailures = [];
          const requestRouteTokens = new WeakMap();
          let activeRouteToken = null;
          const httpErrors = [];
          const httpErrorCaptures = [];
          page.on("pageerror", (error) => pageErrors.push({ message: cleanText(error.message), stack: cleanText(error.stack, 1600) }));
          page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push({ text: cleanText(message.text()), location: safeUrl(message.location().url || target.origin) });
          });
          page.on("request", (request) => requestRouteTokens.set(request, activeRouteToken));
          page.on("requestfailed", (request) => requestFailures.push({
            routeToken: requestRouteTokens.get(request) || null,
            method: request.method(),
            url: safeUrl(request.url()),
            reason: cleanText(request.failure()?.errorText),
          }));
          page.on("response", (response) => {
            if (response.status() < 400) return;
            const record = { status: response.status(), url: safeUrl(response.url()), body: "" };
            httpErrors.push(record);
            httpErrorCaptures.push(
              response.text()
                .then((body) => { record.body = cleanText(body, 1200); })
                .catch(() => {}),
            );
          });

          try {
            for (const routePath of routes) {
              const routeToken = `${engineName}:${viewport.width}x${viewport.height}:${routePath}:${Date.now()}`;
              activeRouteToken = routeToken;
              const indexes = {
                pageErrors: pageErrors.length,
                consoleErrors: consoleErrors.length,
                requestFailures: requestFailures.length,
                httpErrors: httpErrors.length,
                httpErrorCaptures: httpErrorCaptures.length,
                blockedMutations: blockedMutations.length,
                wrongSupabaseHosts: wrongSupabaseHosts.length,
              };
              const started = Date.now();
              const screenshot = `${engineName}-${viewport.width}x${viewport.height}-${routeSlug(routePath)}.png`;
              const row = {
                engine: engineName,
                viewport,
                route: routePath,
                status: null,
                finalPath: null,
                ready: false,
                pass: false,
                ms: null,
                screenshot,
                pageErrors: [],
                consoleErrors: [],
                requestFailures: [],
                httpErrors: [],
                blockedMutations: [],
                wrongSupabaseHosts: [],
                diagnostics: null,
              };
              try {
                const response = await page.goto(new URL(routePath, target).href, { waitUntil: "domcontentloaded", timeout: 45_000 });
                row.status = response?.status() || null;
                await page.waitForFunction(() => document.body?.innerText.trim().length > 80, {}, { timeout: 20_000 });
                await page.waitForFunction(
                  () => !/(?:Загрузка(?:\.{3}|…| справочников| данных)|Загружаем)/.test(document.body.innerText),
                  {},
                  { timeout: 20_000 },
                ).catch(() => {});
                await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
                await page.evaluate(() => document.fonts?.ready).catch(() => {});
                await page.waitForTimeout(350);
                row.ready = true;
                row.finalPath = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
                row.diagnostics = await page.evaluate(() => {
                  const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0;
                  const headings = [...document.querySelectorAll("h1,h2,[role='heading']")]
                    .filter(visible)
                    .slice(0, 8)
                    .map((element) => String(element.textContent || "").trim().slice(0, 140));
                  const interactive = [...document.querySelectorAll("button,input,select,textarea,a[href],[role='combobox']")].filter(visible);
                  const bodyText = document.body.innerText.trim();
                  const shellVisible = Boolean([...document.querySelectorAll(".travkin-shell")].find(visible));
                  return {
                    title: document.title,
                    theme: document.documentElement.dataset.theme || null,
                    bodyClass: document.body.className,
                    textLength: bodyText.length,
                    headings,
                    interactiveCount: interactive.length,
                    scrollWidth: document.documentElement.scrollWidth,
                    innerWidth,
                    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
                    errorOverlay: Boolean(document.querySelector("[data-nextjs-dialog],.vite-error-overlay,#webpack-dev-server-client-overlay")),
                    shellVisible,
                    loadingVisible: /(?:Загрузка(?:\.{3}|…| справочников| данных)|Загружаем)/.test(bodyText),
                    accessDenied: /(?:Недостаточно прав|Доступ запрещ[её]н|Access denied|Forbidden)/i.test(bodyText),
                    loginVisible: /\/auth\/login$/.test(location.pathname)
                      || (!shellVisible && Boolean(document.querySelector('form input[type="password"]'))),
                  };
                });
                await page.screenshot({ path: path.join(output, screenshot), fullPage: false });
              } catch (error) {
                row.navigationError = cleanText(error.stack || error, 1800);
                row.finalPath = (() => { try { return new URL(page.url()).pathname; } catch { return null; } })();
                row.screenshot = screenshot.replace(/\.png$/, "-failure.png");
                await page.screenshot({ path: path.join(output, row.screenshot), fullPage: false }).catch(() => {});
              }

              await Promise.allSettled(httpErrorCaptures.slice(indexes.httpErrorCaptures));
              row.pageErrors = pageErrors.slice(indexes.pageErrors);
              row.consoleErrors = consoleErrors.slice(indexes.consoleErrors);
              row.requestFailures = requestFailures
                .slice(indexes.requestFailures)
                .filter((item) => item.routeToken === routeToken)
                .map(({ routeToken: _routeToken, ...item }) => item);
              row.httpErrors = httpErrors.slice(indexes.httpErrors);
              row.blockedMutations = blockedMutations.slice(indexes.blockedMutations);
              row.wrongSupabaseHosts = wrongSupabaseHosts.slice(indexes.wrongSupabaseHosts);
              row.ms = Date.now() - started;

              const expected = new URL(routePath, target);
              const final = row.finalPath ? new URL(row.finalPath, target) : null;
              const criticalFailures = row.requestFailures.filter((item) => {
                const url = new URL(item.url);
                const harmlessPrefetchAbort = item.method === "GET"
                  && /ERR_ABORTED/i.test(item.reason)
                  && url.origin === target.origin
                  && !url.pathname.startsWith("/api/");
                // Next can abort speculative document prefetches without a failed
                // response. API aborts remain visible as real failures.
                if (harmlessPrefetchAbort) return false;
                return url.origin === target.origin || url.hostname === `${QA_REF}.supabase.co`;
              });
              const criticalHttp = row.httpErrors.filter((item) => {
                const url = new URL(item.url);
                return url.origin === target.origin || url.hostname === `${QA_REF}.supabase.co`;
              });
              const checks = [
                !row.navigationError,
                row.status === 200,
                row.ready,
                final?.pathname === expected.pathname,
                row.diagnostics?.theme === expectedTheme,
                row.diagnostics?.bodyClass.includes("tf-manor"),
                row.diagnostics?.shellVisible,
                (row.diagnostics?.textLength || 0) > 80,
                !row.diagnostics?.horizontalOverflow,
                !row.diagnostics?.errorOverlay,
                !row.diagnostics?.loadingVisible,
                !row.diagnostics?.accessDenied,
                !row.diagnostics?.loginVisible,
                row.pageErrors.length === 0,
                row.consoleErrors.length === 0,
                criticalFailures.length === 0,
                criticalHttp.length === 0,
                row.blockedMutations.length === 0,
                row.wrongSupabaseHosts.length === 0,
              ];
              row.pass = checks.every(Boolean);
              report.rows.push(row);
              report.blockedMutations.push(...row.blockedMutations);
              report.wrongSupabaseHosts.push(...row.wrongSupabaseHosts);
              completed += 1;
              save();
              process.stdout.write(`${row.pass ? "PASS" : "FAIL"} ${engineName}/${viewport.width} ${routePath}\n`);
            }
          } finally {
            await page.close();
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    report.externalReadOrigins = [...externalOrigins].sort();
    const failed = report.rows.filter((row) => !row.pass);
    report.summary = {
      expected: engines.length * viewports.length * routes.length,
      completed,
      passed: report.rows.length - failed.length,
      failed: failed.length,
      businessWrites: 0,
      sessionPersisted: false,
    };
    save();
  }

  const failed = report.rows.filter((row) => !row.pass);
  assert.equal(report.rows.length, engines.length * viewports.length * routes.length, "Incomplete route matrix");
  assert.deepEqual(report.blockedMutations, [], "Application attempted a browser-side mutation during read-only smoke");
  assert.deepEqual(report.wrongSupabaseHosts, [], "Browser attempted to connect to a non-QA Supabase project");
  assert.equal(failed.length, 0, `Estate route smoke failed: ${failed.map((row) => `${row.engine}/${row.viewport.width}:${row.route}`).join(", ")}`);
  process.stdout.write(`PASS estate route smoke: ${report.rows.length} route/viewports, report=${path.join(output, "report.json")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${cleanText(error.stack || error, 3000)}\n`);
  process.exitCode = 1;
});
