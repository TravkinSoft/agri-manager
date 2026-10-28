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
const { chromium } = req(process.env.PTC_PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const source = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { TrafficShiftControls } from "./components/traffic/traffic-shift-controls";
    import { TrafficBoard } from "./components/traffic/traffic-board";

    window.shiftCalls = [];
    const snapshot = {
      role: "harvester",
      companyId: "local-only",
      personName: "Комбайнёр",
      enabled: true,
      fieldName: null,
      fieldId: null,
      serverTime: new Date().toISOString(),
      vehicles: [],
      events: [],
      combineShift: null,
      ownCombineStatus: { isBroken: false, version: 0 },
      combineBreakdowns: [],
    };

    const closedSnapshot = {
      ...snapshot,
      vehicles: [{ vehicle_id: "car-closed", name: "КамАЗ", plate: "244 AP 15", driver: "Кабия Жастлек Берикулы", state: "empty", version: 1, since: new Date().toISOString(), cycle: 1, assigned: true }],
      combineShift: { id: "closed-shift", operatorName: "Комбайнёр", status: "closed", openedAt: "2026-09-17T01:57:00Z", closedAt: "2026-09-17T18:44:00Z", cropStructureId: "plot-28", hectaresShift: 8.34, hectaresFieldTotal: 8.34 },
    };
    createRoot(document.getElementById("root")).render(<>
      <TrafficShiftControls snapshot={snapshot} stale={false} refresh={async () => {}} onCommitted={async () => {}} />
      <TrafficBoard snapshot={closedSnapshot} stale={false} error="" refresh={async () => {}} />
    </>);
  `;
  const transport = `
    const plots = [
      { cropStructureId: "plot-mashdvor", fieldId: "field-1", fieldName: "1 (Машдвор)", cropName: "Картофель", varietyName: "Гала", reproductionName: "1 р.", plannedAreaHa: 2, actualCompletedHa: 0, remainingAreaHa: 2, status: "active" },
      { cropStructureId: "plot-28", fieldId: "field-28", fieldName: "28", cropName: "Картофель", varietyName: "Сорая", reproductionName: "1 р.", plannedAreaHa: 12, actualCompletedHa: 8.34, remainingAreaHa: 3.66, status: "active" },
    ];
    export async function trafficRequest(url, method, body) {
      if (url === "/api/traffic/operator/plots" && method === "GET") return { suggestedCropStructureId: "plot-28", plots };
      if (url === "/api/traffic/operator/shift" && method === "POST") {
        window.shiftCalls.push(body);
        return { ok: true };
      }
      throw new Error("Unexpected test request: " + method + " " + url);
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
      name: "local-traffic-transport",
      setup(build) {
        build.onResolve({ filter: /^\.\/use-traffic$/ }, () => ({ path: "transport", namespace: "test" }));
        build.onResolve({ filter: /^@\// }, (args) => ({ path: req.resolve(path.join(root, args.path.slice(2))) }));
        build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ loader: "js", contents: transport }));
      },
    }],
  });

  const config = req(path.join(root, "tailwind.config.ts")).default;
  config.content = [
    path.join(root, "components/traffic/traffic-shift-controls.tsx"),
    path.join(root, "components/traffic/traffic-board.tsx"),
    path.join(root, "components/ui/dialog.tsx"),
  ];
  const css = (await postcss([tailwind(config)]).process(
    fs.readFileSync(path.join(root, "app/globals.css"), "utf8"),
    { from: undefined },
  )).css;
  const html = `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(base);
    const closedCard = page.getByTestId("traffic-vehicle-car-closed");
    assert.equal(await closedCard.isDisabled(), true, "Закрытая смена должна блокировать карточку");
    assert.equal((await closedCard.innerText()).includes("Свайп вправо"), false, "Подпись свайпа не должна просвечивать при закрытой смене");
    assert.equal(await page.getByTestId("traffic-swipe-track-car-closed").count(), 0, "Скрытая свайп-подложка не должна существовать при закрытой смене");
    await page.getByRole("button", { name: "Управление сменой комбайнёра" }).click();
    const continueField28 = page.getByRole("button", { name: "Продолжить · поле 28" });
    assert.equal(await continueField28.isEnabled(), true, "Последнее незавершённое поле должно открываться одним действием");
    await page.getByRole("button", { name: "Выбрать другое поле" }).click();
    await page.waitForTimeout(300);

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Форма не должна расширять мобильный экран");
    const dialogBox = await page.getByRole("dialog").boundingBox();
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }));
    assert.equal(Boolean(dialogBox && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= viewport.width), true, `Диалог должен полностью помещаться на экране: ${JSON.stringify({ dialogBox, viewport })}`);
    if (process.env.PTC_QA_SCREENSHOT) await page.screenshot({ path: process.env.PTC_QA_SCREENSHOT, fullPage: true });

    const mashdvor = page.getByRole("button", { name: /Поле 1 \(Машдвор\)/ });
    const field28 = page.getByRole("button", { name: /Поле 28/ });
    const submit = page.getByRole("button", { name: "Сначала выберите" });
    assert.equal(await mashdvor.getAttribute("aria-pressed"), "false", "Первый участок не должен подставляться автоматически");
    assert.equal(await field28.getAttribute("aria-pressed"), "false", "Поле 28 тоже должно ждать явного выбора");
    assert.equal(await submit.isDisabled(), true, "Смена не должна открываться без явного выбора участка");
    assert.deepEqual(await page.evaluate(() => window.shiftCalls), []);

    await field28.click();
    assert.equal(await field28.getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Отмена" }).click();
    await page.getByRole("button", { name: "Управление сменой комбайнёра" }).click();
    await page.getByRole("button", { name: "Продолжить · поле 28" }).click();
    await page.waitForFunction(() => window.shiftCalls.length === 1);
    const call = await page.evaluate(() => window.shiftCalls[0]);
    assert.equal(call.action, "open");
    assert.equal(call.cropStructureId, "plot-28");
    assert.notEqual(call.cropStructureId, "plot-mashdvor");
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("Plot continuation browser PASS: field 28 offered directly, alternative list stays blank, direct payload uses only the server suggestion; no hosted writes.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
