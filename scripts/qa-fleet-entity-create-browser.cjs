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
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {FleetEntityCreator} from './components/traffic/fleet-entity-creator';
    function App(){
      const [open,setOpen]=useState(true);
      return <main className="p-3 text-slate-100">
        <button onClick={()=>setOpen(true)}>Открыть форму</button>
        <FleetEntityCreator open={open} companyId="10000000-0000-4000-8000-000000000001"
          onOpenChange={setOpen} onCreated={(result)=>{window.created=(window.created||[]).concat(result)}} />
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const mocks = {
    creation: `
      export class FleetEntityCreationError extends Error {
        constructor(message,status=0,code,candidates=[]){super(message);this.status=status;this.code=code;this.candidates=candidates;}
      }
      export async function saveFleetEntity(command){
        window.calls=(window.calls||[]).concat(command);
        await new Promise(resolve=>setTimeout(resolve,30));
        if(command.kind==='vehicle'&&!command.confirmPotentialDuplicate) throw new FleetEntityCreationError('Похожая',409,'potential_duplicate',[{
          id:'00000000-0000-4000-8000-000000000009',kind:'vehicle',level:'potential',title:'КАМАЗ 45142-011',subtitle:'308 AR 15',reason:'Похожий номер',score:.9
        }]);
        if(command.kind==='driver'&&command.fullName==='Андрей Цалко') throw new FleetEntityCreationError('Дубль',409,'exact_duplicate',[{
          id:'00000000-0000-4000-8000-000000000010',kind:'driver',level:'exact',title:'Цалко Андрей',subtitle:null,reason:'То же ФИО',score:1
        }]);
        return {companyId:command.companyId,kind:command.kind,created:{id:'00000000-0000-4000-8000-000000000011',name:command.kind==='vehicle'?command.name:command.fullName,plate:command.kind==='vehicle'?command.plate:null}};
      }
    `,
    changes: `export function publishTrafficChanged(companyId){window.published=companyId}`,
    toast: `export function useToast(){return {toast(value){window.toast=value}}}`,
  };
  const bundle = await esbuild.build({
    stdin: { contents: source, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "fleet-create-boundaries", setup(build) {
      for (const [pattern, name] of [
        [/^@\/lib\/fleet\/entity-creation-client$/, "creation"],
        [/^@\/lib\/traffic\/changes$/, "changes"],
        [/^@\/hooks\/use-toast$/, "toast"],
      ]) build.onResolve({ filter: pattern }, () => ({ path: name, namespace: "mock" }));
      build.onResolve({ filter: /^@\// }, args => ({ path: req.resolve(path.join(root, args.path.slice(2))) }));
      build.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "js", contents: mocks[args.path] }));
    } }],
  });
  const config = req(path.join(root, "tailwind.config.ts")).default;
  config.content = [
    "components/traffic/fleet-entity-creator.tsx",
    "components/ui/*.tsx",
  ].map(value => path.join(root, value));
  const css = (await postcss([tailwind(config)]).process(fs.readFileSync("app/globals.css", "utf8"), { from: undefined })).css;
  const server = http.createServer((_request, response) => response.end(
    '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    css + '</style></head><body><div id="root"></div><script>' + bundle.outputFiles[0].text + '</script></body></html>',
  ));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let checks = 0;
  const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  try {
    for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await engine.launch({ headless: true, ...(name === "chromium" ? { channel: "chrome" } : {}) });
      try {
        for (const width of [320, 390, 412]) {
          const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", error => errors.push(error.message));
          await page.goto(`http://127.0.0.1:${server.address().port}`);
          const dialog = page.getByTestId("fleet-entity-creator");
          await dialog.waitFor();
          check(await page.getByRole("button", { name: "Машину", exact: true }).getAttribute("aria-pressed"), "true", "vehicle selected");
          await page.getByLabel("Название машины").fill("Камаз 308");
          await page.getByLabel("Номер машины").fill("308");
          await page.getByRole("button", { name: "Добавить", exact: true }).tap();
          await page.getByText("Возможно, это дубль", { exact: true }).waitFor();
          check(await page.getByText("КАМАЗ 45142-011", { exact: true }).count(), 1, "candidate visible");
          check(await page.getByRole("button", { name: "Создать всё равно", exact: true }).count(), 1, "override explicit");
          await page.getByRole("button", { name: "Создать всё равно", exact: true }).tap();
          await dialog.waitFor({ state: "detached" });
          check(await page.evaluate(() => window.calls.at(-1).confirmPotentialDuplicate), true, "confirmation carried");
          check(await page.evaluate(() => window.created.length), 1, "created callback");
          check(await page.evaluate(() => window.published), "10000000-0000-4000-8000-000000000001", "cross-tab refresh");

          await page.getByRole("button", { name: "Открыть форму", exact: true }).tap();
          await page.getByRole("button", { name: "Водителя", exact: true }).tap();
          await page.getByLabel("ФИО водителя").fill("Андрей Цалко");
          await page.getByRole("button", { name: "Добавить", exact: true }).tap();
          await page.getByText("Такая запись уже есть", { exact: true }).waitFor();
          check(await page.getByText("Цалко Андрей", { exact: true }).count(), 1, "exact driver shown");
          check(await page.getByRole("button", { name: "Дубль не создан", exact: true }).isDisabled(), true, "exact duplicate blocked");
          check(await page.getByRole("button", { name: "Создать всё равно", exact: true }).count(), 0, "no exact override");
          await page.getByLabel("ФИО водителя").fill("Новый Водитель");
          check(await page.getByText("Такая запись уже есть", { exact: true }).count(), 0, "editing clears warning");
          await page.getByRole("button", { name: "Добавить", exact: true }).tap();
          await dialog.waitFor({ state: "detached" });
          check(await page.evaluate(() => window.created.length), 2, "driver created callback");
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow");
          check(errors, [], `${name} browser errors`);
          await context.close();
        }
      } finally {
        await browser.close();
      }
    }
    console.log(`Fleet create mobile DOM PASS: ${checks} checks / Chromium + WebKit / 320,390,412.`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
