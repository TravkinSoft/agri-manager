const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".artifacts", "dashboard-champions-browser");
fs.mkdirSync(output, { recursive: true });

const dashboardSource = fs.readFileSync(path.join(root, "components/dashboard/harvest-dashboard.tsx"), "utf8");
const metricStart = dashboardSource.indexOf('<section className="grid grid-cols-2 border-b border-border sm:grid-cols-4"');
const metricEnd = dashboardSource.indexOf("</section>", metricStart) + "</section>".length;
assert(metricStart >= 0 && metricEnd > metricStart, "dashboard KPI source not found");
const metrics = dashboardSource.slice(metricStart, metricEnd);

const fixture = `
import React,{useState}from"react";
import{createRoot}from"react-dom/client";
import{PotatoDriverSummary}from"./components/dashboard/potato-driver-summary";
const base=[
 {key:"driver-a",driverId:"driver-a",driverName:"Калымов Канат Айтенович",tripCount:5,netWeightKg:48800,averageNetWeightKg:9760,lastTripAt:"2026-09-15T12:00:00Z",vehicles:[{vehicleId:"truck-a",label:"МТЗ · T 878 ATD"}],averageTripMinutes:null,timedTripCount:0},
 {key:"driver-b",driverId:"driver-b",driverName:"Бейсенов Еркежан",tripCount:4,netWeightKg:42100,averageNetWeightKg:10525,lastTripAt:"2026-09-15T12:05:00Z",vehicles:[{vehicleId:"truck-b",label:"ЗИЛ · 13-19"}],averageTripMinutes:null,timedTripCount:0},
 {key:"driver-c",driverId:"driver-c",driverName:"Искаков Нурлан Кабдушевич",tripCount:4,netWeightKg:39800,averageNetWeightKg:9950,lastTripAt:"2026-09-15T12:10:00Z",vehicles:[{vehicleId:"truck-c",label:"SHACMAN · 683"}],averageTripMinutes:null,timedTripCount:0},
 {key:"driver-d",driverId:"driver-d",driverName:"Теребол Айбол",tripCount:3,netWeightKg:30100,averageNetWeightKg:10033,lastTripAt:"2026-09-15T12:15:00Z",vehicles:[{vehicleId:"truck-d",label:"МТЗ · T 075 ALB"}],averageTripMinutes:null,timedTripCount:0}
];
function App(){
 const[climbed,setClimbed]=useState(false);
 const rows=climbed?[{...base[1],tripCount:6,netWeightKg:62100,averageNetWeightKg:10350,averageTripMinutes:24,timedTripCount:6},{...base[0],averageTripMinutes:31,timedTripCount:5},base[2],base[3]]:base;
 const receivedKg=1161180,currentPlotAcceptedKg=1161180,stockKg=8342100;
 const currentPlotIdentity="Поле 9 · Baltic Rose · 4 р. · участок 34 га";
 const liveYieldTonnes=null,liveYieldNote="Гектары смены связаны с полем, а не с точным участком";
 const mass=n=>n>=1000?((n/1000).toLocaleString("ru-RU",{maximumFractionDigits:1})+" т"):(n+" кг");
 const setCalculatorOpen=()=>{};
 return <main className="mx-auto max-w-[1180px] space-y-4 p-3 sm:p-5"><div aria-label="Метрики">${metrics}</div><button id="climb" className="rounded border px-3 py-2" onClick={()=>setClimbed(true)}>Обновить рейтинг</button><PotatoDriverSummary rows={rows} periodLabel="Текущий рабочий день"/></main>;
}
createRoot(document.getElementById("app")).render(<App/>);
`;

async function main() {
  execFileSync(process.execPath, [path.join(root, "node_modules", "tailwindcss", "lib", "cli.js"),
    "-i", path.join(root, "app", "globals.css"),
    "-o", path.join(output, "browser.css"),
    "-c", path.join(root, "tailwind.config.ts"),
  ], { cwd: root, stdio: "pipe", windowsHide: true });

  await require("esbuild").build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    bundle: true,
    jsx: "automatic",
    outfile: path.join(output, "browser.js"),
    define: { "process.env.NODE_ENV": '"production"' },
  });

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="ru" data-theme="estate-graphite"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/browser.css"></head><body><div id="app"></div><script src="/browser.js"></script></body></html>');
      return;
    }
    const file = url.pathname === "/browser.css" ? path.join(output, "browser.css") : url.pathname === "/browser.js" ? path.join(output, "browser.js") : null;
    if (!file) { response.statusCode = 404; response.end(); return; }
    response.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "text/javascript");
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(3198, "127.0.0.1", resolve));

  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__championAnimations = [];
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        window.__championAnimations.push({ frames, options });
        return original.call(this, frames, options);
      };
    });
    await page.goto("http://127.0.0.1:3198", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Таблица чемпионов" }).waitFor();
    assert.equal(await page.locator('[role="columnheader"]').count(), 7);
    assert.equal(await page.locator('[role="columnheader"]').first().evaluate((element) => getComputedStyle(element.parentElement).display), "grid");
    assert.equal(await page.locator('[role="row"][data-driver-id]').count(), 4);
    assert.equal(await page.getByText("Самый быстрый", { exact: true }).count(), 0);
    await page.getByText(/талон будет напрямую связан/).waitFor();
    const kpi = await page.getByLabel("Главные показатели картофеля").boundingBox();
    assert(kpi && kpi.height < 100, `desktop KPI is too tall: ${kpi?.height}`);
    await page.locator("#climb").click();
    await page.getByText("Самый быстрый", { exact: true }).waitFor();
    assert.equal(await page.locator('[role="row"][data-rank="1"]').getAttribute("data-driver-id"), "driver-b");
    const durations = await page.evaluate(() => window.__championAnimations.map((item) => item.options?.duration));
    assert(durations.includes(400), "FLIP 400ms animation did not run");
    assert(durations.includes(900), "climb highlight did not run");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "desktop horizontal overflow");
    await page.waitForTimeout(950);
    await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });

    const reduced = await browser.newPage({ viewport: { width: 900, height: 900 }, reducedMotion: "reduce" });
    await reduced.addInitScript(() => {
      window.__championAnimations = [];
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        window.__championAnimations.push({ frames, options });
        return original.call(this, frames, options);
      };
    });
    await reduced.goto("http://127.0.0.1:3198", { waitUntil: "networkidle" });
    await reduced.locator("#climb").click();
    await reduced.getByText("Самый быстрый", { exact: true }).waitFor();
    assert.equal(await reduced.evaluate(() => window.__championAnimations.length), 0);
    await reduced.close();

    await page.setViewportSize({ width: 360, height: 780 });
    assert.equal(await page.locator('[role="columnheader"]').count(), 7);
    assert.equal(await page.locator('[role="columnheader"]').first().evaluate((element) => getComputedStyle(element.parentElement).display), "none");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "360px horizontal overflow");
    const metricBox = await page.getByLabel("Главные показатели картофеля").boundingBox();
    assert(metricBox && metricBox.width <= 336, `mobile KPI width overflow: ${metricBox?.width}`);
    await page.screenshot({ path: path.join(output, "mobile-360.png"), fullPage: true });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ passed: ["7 desktop columns", "stable driver ids", "no inferred fastest", "400ms FLIP", "climb highlight", "reduced motion", "desktop overflow", "360px overflow", "compact KPI"] }));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
