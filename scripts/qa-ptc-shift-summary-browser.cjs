// Browser-only regression for the agronomist PTC shift summary. Both the
// read service and live subscription are replaced in the bundle, so this test
// cannot contact Product or mutate operational data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = process.cwd();
const req = createRequire(path.join(root, "package.json"));
req("tsx/cjs");
const esbuild = req("esbuild");
const postcss = req("postcss");
const tailwind = req("tailwindcss");
const { chromium, webkit } = req(process.env.PTC_PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const source = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {TrafficShiftSummary} from './components/dashboard/traffic-shift-summary';

    const companyId='10000000-0000-4000-8000-000000000001';
    const operatorName='Очень Длинное Имя Фамилия Отчество Комбайнёра Для Проверки Мобильной Версии';
    const fieldName='Поле картофеля Северо-Западный участок с очень длинным названием № 123';
    const vehicles=Array.from({length:21},(_,index)=>({
      vehicleId:'vehicle-'+index,
      brand:index===0?'КАМАЗ С ОЧЕНЬ ДЛИННЫМ НАЗВАНИЕМ МАРКИ':'КАМАЗ',
      plate:'ТЕСТ-'+String(index+1).padStart(2,'0'),
      trips:index<3?3:2,
    }));
    const summary={
      shiftId:'20000000-0000-4000-8000-000000000001',operatorName,fieldName,
      openedAt:'2026-09-07T05:00:00.000Z',closedAt:'2026-09-07T15:30:00.000Z',durationMinutes:630,
      hectaresShift:1000000,hectaresFieldTotal:1000000,totalTrips:45,participatingVehicles:21,
      averageLoadIntervalMinutes:8,loadIntervalSamples:44,
      averageFieldToWeighbridgeMinutes:31,fieldToWeighbridgeTrips:40,
      averageUnloadingMinutes:7,unloadingTrips:39,
      averageReturnToLoadMinutes:29,returnToLoadTrips:24,
      averageVehicleCycleMinutes:67,vehicleCycleSamples:24,
      latestFleetRoundMinutes:58,latestDistinctVehicleLoadSpanMinutes:58,
      probableDowntimeCount:2,probableDowntimeMinutes:17,vehicles,
    };
    window.__ptcSummaryCalls=0;
    window.__ptcSummaryReady=summary;
    window.__ptcSummaryCurrent=new URLSearchParams(location.search).get('state')==='ready'?summary:null;
    window.__closeShiftMock=()=>{
      window.__ptcSummaryCurrent=window.__ptcSummaryReady;
      if(window.__ptcSummarySubscriber)window.__ptcSummarySubscriber(companyId);
    };
    function App(){return <main className="mx-auto min-h-screen w-full max-w-[1500px] overflow-x-hidden bg-[#0b0f17] p-3 text-white">
      <h1 className="mb-4 text-2xl font-semibold">Сводка уборки</h1>
      <TrafficShiftSummary companyId={companyId}/>
      <section data-testid="following-dashboard-content" className="mt-4 min-h-20 rounded-xl border border-slate-800 p-3">Партии в уборке</section>
    </main>}
    createRoot(document.getElementById('root')).render(<App/>);
  `;

  const serviceMock = `
    export async function getLatestClosedTrafficShiftSummary(){
      window.__ptcSummaryCalls+=1;
      return window.__ptcSummaryCurrent;
    }
  `;
  const changesMock = `
    export function subscribeTrafficChanges(companyId,listener){
      window.__ptcSummarySubscribedCompany=companyId;
      window.__ptcSummarySubscriber=listener;
      return ()=>{if(window.__ptcSummarySubscriber===listener)window.__ptcSummarySubscriber=null};
    }
  `;

  const bundle = await esbuild.build({
    stdin: { contents: source, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "local-summary-boundaries",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/services\/traffic-shift-summary$/ }, () => ({ path: "service", namespace: "mock" }));
        build.onResolve({ filter: /^@\/lib\/traffic\/changes$/ }, () => ({ path: "changes", namespace: "mock" }));
        build.onResolve({ filter: /^@\// }, (args) => ({ path: req.resolve(path.join(root, args.path.slice(2))) }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          loader: "js",
          contents: args.path === "service" ? serviceMock : changesMock,
        }));
      },
    }],
  });

  const tailwindConfig = req(path.join(root, "tailwind.config.ts")).default;
  tailwindConfig.content = [
    path.join(root, "components/dashboard/traffic-shift-summary.tsx"),
    path.join(root, "components/ui/card.tsx"),
    path.join(root, "components/ui/collapsible.tsx"),
  ];
  const css = (await postcss([tailwind(tailwindConfig)]).process(
    fs.readFileSync(path.join(root, "app/globals.css"), "utf8"),
    { from: undefined },
  )).css;
  const html = '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>' + css + '</style></head><body><div id="root"></div><script>' + bundle.outputFiles[0].text + '</script></body></html>';
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  let checks = 0;
  const failures = [];
  function check(actual, expected, label) {
    checks += 1;
    try {
      assert.deepEqual(actual, expected, label);
    } catch (_error) {
      failures.push({ label, actual, expected });
    }
  }
  async function visibleCount(locator) {
    return locator.evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    }).length);
  }
  async function pageFits(page) {
    return page.evaluate(() => {
      const summary = document.querySelector('[data-testid="agronomist-closed-shift-summary"]');
      const rect = summary?.getBoundingClientRect();
      return Boolean(summary && rect && rect.left >= -0.5 && rect.right <= innerWidth + 0.5 &&
        document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);
    });
  }

  try {
    for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await engine.launch({
        headless: true,
        ...(engineName === "chromium" ? { channel: "chrome" } : {}),
      });
      try {
        for (const viewport of [
          { name: "mobile-320", width: 320, height: 844, mobile: true },
          { name: "mobile-390", width: 390, height: 844, mobile: true },
          { name: "mobile-430", width: 430, height: 932, mobile: true },
          { name: "desktop", width: 1440, height: 1000, mobile: false },
        ]) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            hasTouch: viewport.mobile,
            isMobile: viewport.mobile,
          });
          await context.route("**/*", (route) =>
            new URL(route.request().url()).origin === base ? route.continue() : route.abort());
          const page = await context.newPage();
          const pageErrors = [];
          page.on("pageerror", (error) => pageErrors.push(error.message));
          const label = `${engineName}/${viewport.name}`;

          await page.goto(`${base}/?state=ready`);
          const summary = page.getByTestId("agronomist-closed-shift-summary");
          await summary.getByText("Гектаров за смену", { exact: true }).waitFor();
          check(await page.evaluate(() => window.__ptcSummarySubscribedCompany), "10000000-0000-4000-8000-000000000001", `${label}/mock-subscription-company`);
          check(await pageFits(page), true, `${label}/ready/no-horizontal-overflow`);
          const positions = await Promise.all([
            summary.boundingBox(),
            page.getByTestId("following-dashboard-content").boundingBox(),
          ]);
          check(Boolean(positions[0] && positions[1] && positions[0].y < positions[1].y), true, `${label}/summary-first`);
          const normalizedText = (await summary.innerText()).replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
          check(normalizedText.includes("Очень Длинное Имя Фамилия Отчество Комбайнёра Для Проверки Мобильной Версии"), true, `${label}/long-operator-visible`);
          check(normalizedText.includes("Поле картофеля Северо-Западный участок с очень длинным названием № 123"), true, `${label}/long-field-visible`);
          check((normalizedText.match(/1 000 000 га/g) || []).length, 2, `${label}/maximum-hectares-visible`);
          check(normalizedText.includes("21 машина"), true, `${label}/twenty-one-vehicles`);
          check(normalizedText.includes("45 рейсов"), true, `${label}/trip-total`);
          check(normalizedText.includes("Отправлено с поля"), true, `${label}/trip-wording`);

          const timingTrigger = page.getByRole("button", { name: "Время движения и разгрузки", exact: true });
          const firstTimingLabel = page.getByText("От поля до весовой в среднем", { exact: true });
          const showVehicles = page.getByRole("button", { name: "Показать все (21)", exact: true });
          const fifthVehicle = page.getByText("ТЕСТ-05", { exact: false });
          if (viewport.mobile) {
            check(await timingTrigger.isVisible(), true, `${label}/mobile/timing-trigger-visible`);
            check(await timingTrigger.getAttribute("aria-expanded"), "false", `${label}/mobile/timing-collapsed`);
            check(await visibleCount(firstTimingLabel), 0, `${label}/mobile/timing-content-hidden`);
            await timingTrigger.tap();
            check(await timingTrigger.getAttribute("aria-expanded"), "true", `${label}/mobile/timing-expanded`);
            check(await visibleCount(firstTimingLabel), 1, `${label}/mobile/timing-content-visible`);
            check(await showVehicles.isVisible(), true, `${label}/mobile/show-all-visible`);
            check(await visibleCount(fifthVehicle), 0, `${label}/mobile/fifth-vehicle-hidden`);
            await showVehicles.tap();
            check(await visibleCount(fifthVehicle), 1, `${label}/mobile/fifth-vehicle-revealed`);
            check(await page.getByRole("button", { name: "Скрыть часть машин", exact: true }).isVisible(), true, `${label}/mobile/collapse-vehicles-visible`);
          } else {
            check(await timingTrigger.isVisible(), false, `${label}/desktop/no-mobile-timing-trigger`);
            check(await visibleCount(firstTimingLabel), 1, `${label}/desktop/timing-visible`);
            check(await showVehicles.isVisible(), false, `${label}/desktop/no-show-all`);
            check(await visibleCount(fifthVehicle), 1, `${label}/desktop/all-vehicles-visible`);
          }
          check(await pageFits(page), true, `${label}/expanded/no-horizontal-overflow`);
          check(pageErrors, [], `${label}/ready/no-page-errors`);

          const emptyPage = await context.newPage();
          const emptyErrors = [];
          emptyPage.on("pageerror", (error) => emptyErrors.push(error.message));
          await emptyPage.goto(`${base}/?state=empty`);
          const emptySummary = emptyPage.getByTestId("agronomist-closed-shift-summary");
          await emptySummary.getByText("Закрытых смен пока нет", { exact: true }).waitFor();
          check(await pageFits(emptyPage), true, `${label}/empty/no-horizontal-overflow`);
          const emptyPositions = await Promise.all([
            emptySummary.boundingBox(),
            emptyPage.getByTestId("following-dashboard-content").boundingBox(),
          ]);
          check(Boolean(emptyPositions[0] && emptyPositions[1] && emptyPositions[0].y < emptyPositions[1].y), true, `${label}/empty/summary-first`);
          check(await emptySummary.getByText("После закрытия смены комбайнёром", { exact: false }).count(), 1, `${label}/empty/explanation`);
          const beforeCalls = await emptyPage.evaluate(() => window.__ptcSummaryCalls);
          await emptyPage.evaluate(() => window.__closeShiftMock());
          await emptySummary.getByText("Гектаров за смену", { exact: true }).waitFor();
          check(await emptyPage.evaluate((before) => window.__ptcSummaryCalls > before, beforeCalls), true, `${label}/empty/live-subscription-refresh`);
          check(await pageFits(emptyPage), true, `${label}/empty-to-ready/no-horizontal-overflow`);
          check(emptyErrors, [], `${label}/empty/no-page-errors`);

          if (process.env.PTC_SHIFT_SUMMARY_SCREENSHOT_DIR && viewport.name === "mobile-390") {
            fs.mkdirSync(process.env.PTC_SHIFT_SUMMARY_SCREENSHOT_DIR, { recursive: true });
            await page.screenshot({
              path: path.join(process.env.PTC_SHIFT_SUMMARY_SCREENSHOT_DIR, `ptc-shift-summary-${engineName}.png`),
              fullPage: true,
            });
          }
          await context.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(JSON.stringify({ checks, failed: failures.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
