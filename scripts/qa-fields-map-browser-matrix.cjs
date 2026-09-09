// Real Next/React Fields Map browser matrix. All data/auth/tile transports are local mocks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require(process.env.PTC_PLAYWRIGHT_MODULE || "playwright");

const baseUrl = process.env.QA_FIELDS_MAP_BASE_URL || "http://localhost:3137";
const outputDir = path.resolve("scripts/output/fields-map-browser-matrix");
const userId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const seasonId = "33333333-3333-4333-8333-333333333333";

const field = (suffix, name, area, coordinates, crop, workStatus) => ({
  field_id: `44444444-4444-4444-8444-44444444440${suffix}`,
  field_name: name,
  field_display_name: name,
  field_area_ha: area,
  geometry_id: coordinates ? `55555555-5555-4555-8555-55555555550${suffix}` : null,
  geometry_area_ha: coordinates ? area : null,
  geometry: coordinates ? { type: "Polygon", coordinates: [coordinates] } : null,
  crop_plan: crop ? { crop_id: null, crop_name: crop, variety_name: null, reproduction_name: null, planned_area_ha: area } : null,
  crop_structure: crop ? [{ id: `77777777-7777-4777-8777-77777777770${suffix}`, crop_id: null, crop_name: crop, variety_name: null, reproduction_name: null, area_ha: area }] : [],
  recent_operations: [],
  material_summary: [],
  harvest_summary: [],
  work_status: workStatus,
});

const bootstrap = {
  company: { id: companyId, name: "Browser QA" },
  seasons: [{ id: seasonId, year: 2026, name: "2026" }],
  selected_season_id: seasonId,
  fields: [
    field(1, "19 терн", 274, [[69.08, 54.84], [69.19, 54.84], [69.19, 54.91], [69.08, 54.91], [69.08, 54.84]], "Пшеница", "in_progress"),
    field(2, "1 (МашДвор)", 20, [[69.21, 54.87], [69.25, 54.87], [69.25, 54.91], [69.21, 54.91], [69.21, 54.87]], "Картофель", "not_started"),
    field(3, "Без контура", 45, null, null, "problem"),
  ],
  engineering_objects: [],
};

const authUser = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "browser.qa@example.invalid",
  email_confirmed_at: "2026-09-09T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-09-09T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:00.000Z",
};

const profile = {
  id: userId,
  full_name: "Browser QA Admin",
  email: authUser.email,
  role: "global_admin",
  company_id: companyId,
  is_owner: true,
  status: "active",
  created_at: authUser.created_at,
  updated_at: authUser.updated_at,
};

const viewports = [[360, 800], [768, 1024], [1304, 930], [1440, 900]];
const requestedEngines = new Set((process.env.QA_FIELDS_MAP_ENGINES || "chromium,webkit").split(",").map((value) => value.trim()));

async function installMocks(page) {
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/rest/v1/**", (route) => json(route, []));
  await page.route("**/rest/v1/profiles**", (route) => json(route, [profile]));
  await page.route("**/auth/v1/user**", (route) => json(route, authUser));
  await page.route("**/api/auth/actor**", (route) => json(route, { actor: { id: userId, role: "global_admin", companyId, contextCompanyId: companyId, isImpersonating: false } }));
  await page.route("**/api/fields-map/imports**", (route) => json(route, { imports: [], map_revision: { active_import_id: null, active_geometry_count: 2 } }));
  await page.route("**/api/fields-map/bootstrap**", (route) => json(route, bootstrap));
}

async function measure(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const overlaps = (left, right) => !(left.right <= right.x || right.right <= left.x || left.bottom <= right.y || right.bottom <= left.y);
    const docks = [...document.querySelectorAll(".tf2-dock")].filter(visible).map(rect);
    const inspectorNode = document.querySelector(".tf2-panel");
    const inspector = inspectorNode ? rect(inspectorNode) : null;
    const controls = [...document.querySelectorAll(".tf2-shell > section button,.tf2-shell > section input,.tf2-shell > section [role=combobox]")]
      .filter(visible)
      .map((element) => ({ name: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 60), ...rect(element) }));
    return {
      viewport: [innerWidth, innerHeight],
      documentOverflowPx: document.documentElement.scrollWidth - innerWidth,
      dockOverlap: overlaps(docks[0], docks[1]),
      inspectorTopOverlap: inspector ? overlaps(inspector, docks[0]) : null,
      inspectorBottomOverlap: inspector ? overlaps(inspector, docks[1]) : null,
      query: document.querySelector('input[placeholder="Найти поле..."]')?.value || "",
      smallTargets: innerWidth <= 1023 ? controls.filter((item) => item.width < 44 || item.height < 44) : [],
    };
  });
}

async function runEngine(name, browserType) {
  const browser = await browserType.launch(
    name === "chromium"
      ? { headless: true, channel: process.env.QA_FIELDS_MAP_CHROMIUM_CHANNEL || "chrome" }
      : { headless: true }
  );
  const context = await browser.newContext();
  await context.addInitScript({ path: path.resolve("scripts/qa-fields-map-browser-init.js") });
  const page = await context.newPage();
  const fieldsMapWrites = [];
  const interceptedMockMutations = [];
  page.on("request", (request) => {
    if (!/^(GET|OPTIONS|HEAD)$/u.test(request.method()) && /api\/fields-map/u.test(request.url())) {
      fieldsMapWrites.push(`${request.method()} ${request.url()}`);
    }
    if (!/^(GET|OPTIONS|HEAD)$/u.test(request.method()) && /rest\/v1/u.test(request.url())) {
      interceptedMockMutations.push(`${request.method()} ${request.url()}`);
    }
  });
  await installMocks(page);
  await page.goto(`${baseUrl}/fields-map`, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-label="Интерактивная карта полей"]').waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("button", { name: /список полей: 3/u }).waitFor({ state: "visible", timeout: 20000 });

  const results = [];
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(220);
    const search = page.locator('input[placeholder="Найти поле..."]');
    await search.fill("19");
    await search.press("Enter");
    await page.getByRole("heading", { name: "Поле 19 терн" }).waitFor({ state: "visible" });
    await page.waitForTimeout(220);
    const result = await measure(page);
    assert.equal(result.documentOverflowPx, 0, `${name} ${width}: document overflow`);
    assert.equal(result.dockOverlap, false, `${name} ${width}: docks overlap`);
    assert.equal(result.inspectorTopOverlap, false, `${name} ${width}: inspector overlaps top dock`);
    assert.equal(result.inspectorBottomOverlap, false, `${name} ${width}: inspector overlaps bottom dock`);
    assert.equal(result.query, "", `${name} ${width}: selected search remains expanded`);
    assert.deepEqual(result.smallTargets, [], `${name} ${width}: compact touch target below 44px`);
    await page.screenshot({ path: path.join(outputDir, `${name}-${width}x${height}.png`) });
    results.push(result);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.evaluate(() => {
    const durations = [...document.querySelectorAll(".tf2-shell *")].flatMap((element) =>
      getComputedStyle(element).transitionDuration.split(",").map((value) => value.trim().endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000)
    ).filter(Number.isFinite);
    return { matches: matchMedia("(prefers-reduced-motion: reduce)").matches, maxTransitionMs: Math.max(0, ...durations) };
  });
  assert.equal(reducedMotion.matches, true, `${name}: reduced motion media not active`);
  assert.ok(reducedMotion.maxTransitionMs <= 0.01, `${name}: reduced motion transition too long`);
  assert.deepEqual(fieldsMapWrites, [], `${name}: unexpected Fields Map write request`);
  await browser.close();
  return { name, results, reducedMotion, fieldsMapWrites, interceptedMockMutations };
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const evidence = [];
  if (requestedEngines.has("chromium")) evidence.push(await runEngine("chromium", chromium));
  if (requestedEngines.has("webkit")) evidence.push(await runEngine("webkit", webkit));
  console.log(JSON.stringify({ suite: "Fields Map browser matrix", evidence }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
