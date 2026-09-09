// Local browser regression for the responsive Settings tab strip.
// It renders only local React/CSS; no Product, Preview, auth, or database traffic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = process.cwd();
const dependencyRoot = process.env.QA_DEPENDENCY_ROOT || root;
const req = createRequire(path.join(dependencyRoot, "package.json"));
req("tsx/cjs");
const esbuild = req("esbuild");
const postcss = req("postcss");
const tailwind = req("tailwindcss");
const { chromium, webkit } = require(process.env.PTC_PLAYWRIGHT_MODULE || "playwright");

const baseline = process.argv.includes("--baseline");
const listClass = baseline
  ? ""
  : "grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:h-11 sm:w-auto sm:gap-0";
const triggerClass = baseline ? "" : "min-h-[44px]";
const settingsSource = fs.readFileSync(path.join(root, "app/(dashboard)/settings/page.tsx"), "utf8");

if (!baseline) {
  assert.match(settingsSource, /aria-label=\{t\(\s*"Разделы настроек"/u, "Settings tablist must have a localized accessible name");
  assert.ok(settingsSource.includes(`className="${listClass}"`), "Settings tablist responsive classes drifted");
  assert.equal(
    settingsSource.split(`className="${triggerClass}"`).length - 1,
    4,
    "Every Settings tab trigger must retain the 44px touch target",
  );
}

const source = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

  const labels = {
    ru: ["Профиль", "Общие", "Уведомления", "Безопасность"],
    kz: ["Профиль", "Жалпы", "Хабарламалар", "Қауіпсіздік"],
    en: ["Profile", "General", "Notifications", "Security"],
  };
  const language = new URLSearchParams(location.search).get("language") || "ru";
  const names = labels[language];

  function App() {
    return (
      <main className="min-h-screen overflow-x-hidden p-3">
        <Tabs defaultValue="profile" className="space-y-4">
          <TabsList aria-label="Settings sections" data-testid="settings-tabs" className=${JSON.stringify(listClass)}>
            <TabsTrigger className=${JSON.stringify(triggerClass)} value="profile">{names[0]}</TabsTrigger>
            <TabsTrigger className=${JSON.stringify(triggerClass)} value="general">{names[1]}</TabsTrigger>
            <TabsTrigger className=${JSON.stringify(triggerClass)} value="notifications">{names[2]}</TabsTrigger>
            <TabsTrigger className=${JSON.stringify(triggerClass)} value="security">{names[3]}</TabsTrigger>
          </TabsList>
          {names.map((name, index) => <TabsContent key={name} value={["profile", "general", "notifications", "security"][index]}>{name}</TabsContent>)}
        </Tabs>
      </main>
    );
  }

  createRoot(document.getElementById("root")).render(<App />);
`;

async function buildPage() {
  const bundle = await esbuild.build({
    stdin: { contents: source, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    nodePaths: [path.join(dependencyRoot, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "workspace-alias",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => ({ path: req.resolve(path.join(root, args.path.slice(2))) }));
      },
    }],
  });
  const baseConfig = req(path.join(dependencyRoot, "tailwind.config.ts")).default;
  const config = {
    ...baseConfig,
    content: [
      { raw: source, extension: "tsx" },
      path.join(root, "components/ui/tabs.tsx"),
      path.join(root, "app/(dashboard)/settings/page.tsx"),
    ],
  };
  const css = (await postcss([tailwind(config)]).process(
    fs.readFileSync(path.join(root, "app/globals.css"), "utf8"),
    { from: undefined },
  )).css;
  if (!baseline) assert.ok(css.includes(".min-h-\\[44px\\]"), "Tailwind did not compile the 44px target utility");
  return `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
}

function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main").getBoundingClientRect();
    const list = document.querySelector('[data-testid="settings-tabs"]');
    const listRect = list.getBoundingClientRect();
    const tabs = [...list.querySelectorAll('[role="tab"]')].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        name: node.textContent.trim(),
        x: Math.round(rect.x * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        y: Math.round(rect.y * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
      };
    });
    return {
      viewport: innerWidth,
      main: { x: main.x, right: main.right, width: main.width },
      list: { x: listRect.x, right: listRect.right, width: listRect.width, scrollWidth: list.scrollWidth },
      tabs,
      clipped: tabs.filter((tab) => tab.x < main.x - 1 || tab.right > main.right + 1).map((tab) => tab.name),
      rows: new Set(tabs.map((tab) => Math.round(tab.y))).size,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      ariaLabel: list.getAttribute("aria-label"),
    };
  });
}

async function main() {
  const html = await buildPage();
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const evidence = [];
  try {
    for (const [engineName, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await browserType.launch(engineName === "chromium" ? { headless: true, channel: "chrome" } : { headless: true });
      try {
        for (const width of baseline ? [390] : [320, 390, 768]) {
          for (const language of baseline ? ["ru"] : ["ru", "kz", "en"]) {
            const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 640, isMobile: width < 640 });
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.goto(`${baseUrl}/?language=${language}`);
            await page.getByRole("tab", { name: language === "en" ? "Profile" : "Профиль" }).waitFor();
            const result = await measure(page);
            if (baseline) {
              assert.ok(result.clipped.length > 0, `${engineName}/${width}: legacy strip should reproduce clipping`);
              assert.ok(result.tabs.some((tab) => tab.height < 44), `${engineName}/${width}: legacy touch targets should reproduce sub-44px height`);
            } else {
              assert.deepEqual(result.clipped, [], `${engineName}/${width}/${language}: every tab must fit horizontally`);
              assert.equal(result.documentOverflow, 0, `${engineName}/${width}/${language}: document overflow`);
              assert.ok(
                result.tabs.every((tab) => tab.height >= 44),
                `${engineName}/${width}/${language}: touch target below 44px (${result.tabs.map((tab) => tab.height).join(", ")})`,
              );
              assert.equal(result.rows, width < 640 ? 2 : 1, `${engineName}/${width}/${language}: unexpected responsive row count`);
              assert.equal(result.ariaLabel, "Settings sections", `${engineName}/${width}/${language}: missing tablist accessible name`);
              const firstTab = page.getByRole("tab", { name: result.tabs[0].name });
              await firstTab.focus();
              await firstTab.press("ArrowRight");
              await page.waitForTimeout(50);
              assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), result.tabs[1].name, `${engineName}/${width}/${language}: ArrowRight navigation`);
              await page.keyboard.press("End");
              await page.waitForTimeout(50);
              assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), result.tabs[3].name, `${engineName}/${width}/${language}: End navigation`);
              await page.keyboard.press("Home");
              await page.waitForTimeout(50);
              assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), result.tabs[0].name, `${engineName}/${width}/${language}: Home navigation`);
            }
            assert.deepEqual(errors, [], `${engineName}/${width}/${language}: browser errors`);
            evidence.push({ engine: engineName, language, ...result });
            await page.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(JSON.stringify({ suite: "TravkinFlow 2 Settings tabs browser", baseline, evidence }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
