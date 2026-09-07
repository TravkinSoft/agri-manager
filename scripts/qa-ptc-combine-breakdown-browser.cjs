// Browser-only regression for the combine breakdown UI. The transport is
// replaced in the bundle, so this test cannot contact Product or mutate data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
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
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {TrafficBoard} from './components/traffic/traffic-board';
    import {TrafficShiftControls} from './components/traffic/traffic-shift-controls';

    window.calls=[];
    window.committed=0;
    window.lastBreakdownReceipt=null;
    const params=new URLSearchParams(location.search);
    const view=params.get('view')||'harvester';
    const role=view==='fleet'||view==='agronomist'?'manager':view;
    const multi=params.get('multi')==='1';
    const own={operatorUserId:'90000000-0000-4000-8000-000000000001',operatorName:'Комбайнёр Тестовый',isBroken:false,changedAt:null,version:0};
    const active=multi?[
      {operatorUserId:'90000000-0000-4000-8000-000000000011',operatorName:'Касымов Александр Сергеевич',changedAt:new Date(Date.now()-5*60000).toISOString(),version:1},
      {operatorUserId:'90000000-0000-4000-8000-000000000012',operatorName:'Очень Длинное Имя Комбайнёра Для Мобильного Экрана',changedAt:new Date(Date.now()-19*60000).toISOString(),version:3},
    ]:[];

    function App(){
      const [snapshot,setSnapshot]=useState({
        role,companyId:'local-only',personName:'Локальный оператор',enabled:true,
        fieldName:null,fieldId:null,serverTime:new Date().toISOString(),vehicles:[],events:[],
        ownCombineStatus:role==='harvester'?own:null,combineBreakdowns:active,
      });
      async function committed(){
        window.committed+=1;
        const receipt=window.lastBreakdownReceipt;
        if(!receipt)return;
        setSnapshot(current=>({
          ...current,
          ownCombineStatus:{
            operatorUserId:receipt.operatorUserId,
            operatorName:receipt.operatorName,
            isBroken:receipt.isBroken,
            changedAt:receipt.changedAt,
            version:receipt.version,
          },
          combineBreakdowns:receipt.isBroken?[{
            operatorUserId:receipt.operatorUserId,
            operatorName:receipt.operatorName,
            changedAt:receipt.changedAt,
            version:receipt.version,
          }]:[],
          serverTime:new Date().toISOString(),
        }));
      }
      return <main className="min-h-screen min-w-0 bg-slate-950 p-3 text-white">
        {role==='harvester'?<div className="mb-2 flex justify-end"><TrafficShiftControls snapshot={snapshot} stale={false} refresh={async()=>{}} onCommitted={committed}/></div>:null}
        <TrafficBoard snapshot={snapshot} stale={false} error="" refresh={async()=>{}} compactAgronomistMobile={view==='agronomist'}/>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;

  const transport = `
    export async function trafficRequest(url,method,body){
      if(url!=='/api/traffic/operator/combine-breakdown')throw new Error('Unexpected test request: '+url);
      const entry={url,method,body};
      window.calls.push(entry);
      const receipt={
        ok:true,replayed:false,eventId:crypto.randomUUID(),
        operatorUserId:'90000000-0000-4000-8000-000000000001',
        operatorName:'Комбайнёр Тестовый',isBroken:body.isBroken,
        version:body.version+1,changedAt:new Date().toISOString(),shiftId:null,
      };
      window.lastBreakdownReceipt=receipt;
      return receipt;
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
    path.join(root, "components/traffic/traffic-board.tsx"),
    path.join(root, "components/traffic/traffic-shift-controls.tsx"),
    path.join(root, "components/ui/dialog.tsx"),
    path.join(root, "components/ui/dropdown-menu.tsx"),
  ];
  const css = (await postcss([tailwind(config)]).process(
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

  try {
    for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await engine.launch({
        headless: true,
        ...(engineName === "chromium" ? { channel: "chrome" } : {}),
      });
      try {
        const actionContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
          hasTouch: true,
          isMobile: true,
        });
        await actionContext.route("**/*", (route) =>
          new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        const page = await actionContext.newPage();
        const browserErrors = [];
        page.on("pageerror", (error) => browserErrors.push(error.message));
        await page.goto(`${base}/?view=harvester`);
        const menuButton = page.getByRole("button", { name: "Меню комбайнёра" });

        check(await page.getByTestId("traffic-combine-breakdown-banner").count(), 0, `${engineName}/healthy/no-banner`);
        await menuButton.tap();
        check(await page.getByText("Статус комбайна", { exact: true }).count(), 1, `${engineName}/menu/status-label`);
        check(await page.getByText("Работает", { exact: true }).count(), 1, `${engineName}/menu/healthy-status`);
        check(await page.getByText("Смена комбайнёра", { exact: true }).count(), 1, `${engineName}/menu/shift-preserved`);

        page.once("dialog", (dialog) => void dialog.dismiss());
        await page.getByRole("menuitem", { name: "Сообщить о поломке" }).tap();
        await page.waitForTimeout(100);
        check(await page.evaluate(() => window.calls.length), 0, `${engineName}/cancel/zero-post`);
        check(await page.evaluate(() => window.committed), 0, `${engineName}/cancel/no-refresh`);
        check(await page.getByTestId("traffic-combine-breakdown-banner").count(), 0, `${engineName}/cancel/no-banner`);

        await menuButton.tap();
        page.once("dialog", (dialog) => void dialog.accept());
        await page.getByRole("menuitem", { name: "Сообщить о поломке" }).tap();
        await page.waitForFunction(() => window.calls.length === 1 && window.committed === 1);
        const firstCall = await page.evaluate(() => window.calls[0]);
        check(firstCall.url, "/api/traffic/operator/combine-breakdown", `${engineName}/breakdown/url`);
        check(firstCall.method, "POST", `${engineName}/breakdown/method`);
        check(Object.keys(firstCall.body).sort(), ["isBroken", "key", "version"], `${engineName}/breakdown/body-shape`);
        check(firstCall.body.isBroken, true, `${engineName}/breakdown/value`);
        check(firstCall.body.version, 0, `${engineName}/breakdown/version`);
        check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(firstCall.body.key), true, `${engineName}/breakdown/uuid`);
        check(await page.getByTestId("traffic-combine-breakdown-banner").count(), 1, `${engineName}/breakdown/banner`);
        check((await page.getByTestId("traffic-combine-breakdown-banner").innerText()).includes("Комбайнёр Тестовый"), true, `${engineName}/breakdown/name`);

        await menuButton.tap();
        check(await page.getByText("Поломка", { exact: true }).count(), 1, `${engineName}/menu/broken-status`);
        page.once("dialog", (dialog) => void dialog.dismiss());
        await page.getByRole("menuitem", { name: "Комбайн снова работает" }).tap();
        await page.waitForTimeout(100);
        check(await page.evaluate(() => window.calls.length), 1, `${engineName}/recover-cancel/zero-post`);

        await menuButton.tap();
        page.once("dialog", (dialog) => void dialog.accept());
        await page.getByRole("menuitem", { name: "Комбайн снова работает" }).tap();
        await page.waitForFunction(() => window.calls.length === 2 && window.committed === 2);
        const secondCall = await page.evaluate(() => window.calls[1]);
        check(secondCall.body.isBroken, false, `${engineName}/recover/value`);
        check(secondCall.body.version, 1, `${engineName}/recover/version`);
        check(await page.getByTestId("traffic-combine-breakdown-banner").count(), 0, `${engineName}/recover/banner-cleared`);
        check(browserErrors, [], `${engineName}/actions/no-browser-errors`);
        await actionContext.close();

        for (const width of [320, 390, 430]) {
          const matrixContext = await browser.newContext({
            viewport: { width, height: 844 },
            hasTouch: true,
            isMobile: true,
          });
          await matrixContext.route("**/*", (route) =>
            new URL(route.request().url()).origin === base ? route.continue() : route.abort());
          for (const view of ["harvester", "weighman", "receiver", "fleet", "agronomist"]) {
            const matrixPage = await matrixContext.newPage();
            const errors = [];
            matrixPage.on("pageerror", (error) => errors.push(error.message));
            await matrixPage.goto(`${base}/?view=${view}&multi=1`);
            const label = `${engineName}/${view}/${width}`;
            const banner = matrixPage.getByTestId("traffic-combine-breakdown-banner");
            check(await banner.count(), 1, `${label}/one-banner`);
            const text = await banner.innerText();
            check(text.includes("Поломка комбайнов · 2"), true, `${label}/plural-count`);
            check(text.includes("Касымов Александр Сергеевич"), true, `${label}/first-operator`);
            check(text.includes("Очень Длинное Имя Комбайнёра Для Мобильного Экрана"), true, `${label}/second-operator`);
            check(await matrixPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${label}/no-horizontal-overflow`);
            const emptyHeading = matrixPage.getByRole("heading", { level: 2 });
            check(await emptyHeading.count(), 1, `${label}/empty-state-present`);
            const positions = await Promise.all([banner.boundingBox(), emptyHeading.boundingBox()]);
            check(Boolean(positions[0] && positions[1] && positions[0].y < positions[1].y), true, `${label}/banner-before-empty-state`);
            check(await matrixPage.getByRole("button", { name: "Меню комбайнёра" }).count(), view === "harvester" ? 1 : 0, `${label}/harvester-controls-only`);
            check(errors, [], `${label}/no-browser-errors`);
            await matrixPage.close();
          }
          await matrixContext.close();
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
