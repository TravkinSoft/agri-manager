const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = String(process.argv[2] || "").replace(/\/$/, "");
const outputFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
const screenshotDir = process.argv[4] ? path.resolve(process.argv[4]) : null;
const cycles = Number(process.env.TZ275_CYCLES || 20);
const email = process.env.TZ275_EMAIL;
const password = process.env.TZ275_PASSWORD;

if (!baseUrl || !outputFile || !email || !password) {
  throw new Error("Usage: qa-tz275-browser.cjs <base-url> <output.json> [screenshots-dir]");
}

const routes = [
  { path: "/dashboard", heading: "Сводка уборки" },
  { path: "/crop-structure", heading: "Структура посевов" },
  { path: "/weather-lab", heading: "Погода" },
  { path: "/warehouses", heading: "Склады" },
  { path: "/tickets", heading: "Талоны" },
];

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: Number((sorted[0] || 0).toFixed(1)),
    median: Number(percentile(sorted, 0.5).toFixed(1)),
    p95: Number(percentile(sorted, 0.95).toFixed(1)),
    max: Number((sorted.at(-1) || 0).toFixed(1)),
  };
}

async function waitForRoute(page, route) {
  const links = page.locator(`a[href="${route.path}"]`);
  let visibleLink = null;
  for (let index = 0; index < await links.count(); index += 1) {
    if (await links.nth(index).isVisible()) {
      visibleLink = links.nth(index);
      break;
    }
  }
  if (!visibleLink) throw new Error(`Visible navigation link is missing for ${route.path}`);
  await Promise.all([
    page.waitForURL((url) => url.pathname === route.path, { timeout: 15_000 }),
    visibleLink.click(),
  ]);
  await page.getByRole("heading", { name: route.heading, exact: true }).waitFor({ state: "visible" });
  const loadingText = {
    "/crop-structure": "Загрузка...",
    "/warehouses": "Загрузка складов...",
    "/tickets": "Загрузка талонов...",
  }[route.path];
  if (loadingText) {
    await page.getByText(loadingText, { exact: true }).waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  }
}

async function main() {
  const chromePath = process.env.TZ275_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--js-flags=--expose-gc"],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedResponses = [];
  const requests = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  page.on("request", (request) => {
    requests.push({ type: request.resourceType(), url: request.url() });
  });

  await page.addInitScript(() => {
    window.__tz275LongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        window.__tz275LongTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Older Chromium builds may not expose the longtask entry type.
    }
  });

  await page.goto(`${baseUrl}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 20_000 }),
    page.getByRole("button", { name: "Войти", exact: true }).click(),
  ]);
  await page.getByRole("heading", { name: "Сводка уборки", exact: true }).waitFor({ state: "visible" });

  // Compile and populate all route caches before the repeat-navigation measurement.
  for (const route of routes.slice(1)) await waitForRoute(page, route);
  await waitForRoute(page, routes[0]);

  requests.length = 0;
  failedResponses.length = 0;
  consoleErrors.length = 0;
  await page.evaluate(() => {
    performance.clearResourceTimings();
    window.__tz275LongTasks = [];
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.evaluate(() => globalThis.gc?.());
  const heapStartMetrics = await cdp.send("Performance.getMetrics");
  const heapStart = heapStartMetrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value || 0;
  const rows = [];

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    for (const route of routes) {
      await page.evaluate(() => performance.clearResourceTimings());
      const startedAt = performance.now();
      await waitForRoute(page, route);
      const durationMs = performance.now() - startedAt;
      const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
      const frequencies = new Map();
      for (const resource of resources.filter((url) => url.includes("/api/"))) {
        frequencies.set(resource, (frequencies.get(resource) || 0) + 1);
      }
      const duplicateApiRequests = [...frequencies.entries()]
        .filter(([, count]) => count > 1)
        .map(([url, count]) => ({ url, count }));
      rows.push({
        cycle,
        path: route.path,
        durationMs,
        resourceCount: resources.length,
        rscCount: resources.filter((url) => url.includes("_rsc=")).length,
        apiCount: resources.filter((url) => url.includes("/api/")).length,
        duplicateRequestKeys: duplicateApiRequests.length,
        duplicateApiRequests,
      });
    }
  }

  await page.evaluate(() => globalThis.gc?.());
  const heapEndMetrics = await cdp.send("Performance.getMetrics");
  const heapEnd = heapEndMetrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value || 0;
  const longTasks = await page.evaluate(() => window.__tz275LongTasks || []);
  const navigationEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  const perRoute = Object.fromEntries(routes.map((route) => [
    route.path,
    summarize(rows.filter((row) => row.path === route.path).map((row) => row.durationMs)),
  ]));

  const screenshots = [];
  const mobileChecks = [];
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    const desktopViews = [
      { width: 1366, height: 768, route: routes[0] },
      { width: 1920, height: 1080, route: routes[1] },
      { width: 1920, height: 1080, route: routes[2] },
      { width: 1366, height: 768, route: routes[4] },
    ];
    for (const view of desktopViews) {
      await page.setViewportSize({ width: view.width, height: view.height });
      if (new URL(page.url()).pathname !== view.route.path) await waitForRoute(page, view.route);
      await page.waitForTimeout(750);
      const filename = `${view.route.path.slice(1)}-${view.width}x${view.height}.png`;
      const target = path.join(screenshotDir, filename);
      await page.screenshot({ path: target, fullPage: false });
      screenshots.push(target);
    }
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of [routes[1], routes[2], routes[4]]) {
        if (new URL(page.url()).pathname !== route.path) await waitForRoute(page, route);
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        mobileChecks.push({ ...viewport, path: route.path, overflow });
        const target = path.join(screenshotDir, `${route.path.slice(1)}-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: target, fullPage: false });
        screenshots.push(target);
      }
    }
  }

  const report = {
    baseUrl,
    cycles,
    transitions: rows.length,
    overall: summarize(rows.map((row) => row.durationMs)),
    perRoute,
    maxLongTaskMs: Number(Math.max(0, ...longTasks).toFixed(1)),
    documentRequests: requests.filter((request) => request.type === "document").length,
    rscRequests: requests.filter((request) => request.url.includes("_rsc=")).length,
    apiRequests: requests.filter((request) => request.url.includes("/api/")).length,
    assistantRequests: requests.filter((request) => request.url.includes("/api/assistant/")).length,
    maxDuplicateRequestKeys: Math.max(0, ...rows.map((row) => row.duplicateRequestKeys)),
    duplicateApiRequests: rows.flatMap((row) => row.duplicateApiRequests).slice(0, 20),
    navigationEntries,
    heapStartBytes: heapStart,
    heapEndBytes: heapEnd,
    heapDeltaBytes: heapEnd - heapStart,
    consoleErrors,
    failedResponses,
    mobileChecks,
    screenshots,
  };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
