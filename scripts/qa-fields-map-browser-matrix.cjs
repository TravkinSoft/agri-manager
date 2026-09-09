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
const qaRole = process.env.QA_FIELDS_MAP_ROLE || "global_admin";

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
  engineering_objects: [{
    id: "88888888-8888-4888-8888-888888888888",
    company_id: companyId,
    season_id: seasonId,
    field_id: "44444444-4444-4444-8444-444444444401",
    crop_structure_id: null,
    object_type: "hydrant",
    name: "Гидрант QA",
    description: "Read-only browser contract",
    geometry: { type: "Point", coordinates: [69.13, 54.875] },
    geometry_type: "Point",
    properties: {},
    is_active: true,
    created_by: userId,
    created_by_name: "Browser QA Admin",
    created_at: "2026-09-09T00:00:00.000Z",
    updated_at: "2026-09-09T00:00:00.000Z",
    deleted_at: null,
  }],
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
  role: qaRole,
  company_id: companyId,
  is_owner: true,
  status: "active",
  created_at: authUser.created_at,
  updated_at: authUser.updated_at,
};

const viewports = (process.env.QA_FIELDS_MAP_VIEWPORTS || "320x568,360x800,390x844,667x375,768x1024,844x390,1024x768,1304x930,1440x900")
  .split(",")
  .map((value) => value.split("x").map(Number))
  .filter(([width, height]) => Number.isFinite(width) && Number.isFinite(height));
const requestedEngines = new Set((process.env.QA_FIELDS_MAP_ENGINES || "chromium,webkit").split(",").map((value) => value.trim()));
const expectOverlayBaseline = process.env.QA_FIELDS_MAP_OVERLAY_BASELINE === "1";
const compactEvidence = process.env.QA_FIELDS_MAP_EVIDENCE_COMPACT === "1";
const expectReadOnlyEngineering = process.env.QA_FIELDS_MAP_EXPECT_ENGINEERING_READONLY === "1";

async function installMocks(page) {
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/rest/v1/**", (route) => json(route, []));
  await page.route("**/rest/v1/profiles**", (route) => json(route, [profile]));
  await page.route("**/auth/v1/user**", (route) => json(route, authUser));
  await page.route("**/api/auth/actor**", (route) => json(route, { actor: { id: userId, role: qaRole, companyId, contextCompanyId: companyId, isImpersonating: false } }));
  await page.route("**/api/global-admin/companies**", (route) => json(route, { companies: [{ id: companyId, name: "Browser QA" }], selectedCompanyId: companyId }));
  await page.route("**/api/global-admin/company-users**", (route) => json(route, { users: [] }));
  await page.route("**/api/assistant/context**", (route) => json(route, { role: qaRole, companyId, requiresCompanySelection: false, source: "browser-qa" }));
  await page.route("**/api/assistant/proactive**", (route) => json(route, { signals: 0 }));
  await page.route("**/api/operations-health**", (route) => json(route, {
    status: "healthy",
    warningCount: 0,
    checks: [],
    readiness: [],
    readinessSummary: { ready: 0, missing: 0, needsReview: 0, blockers: [] },
  }));
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
    const maybeRect = (selector) => {
      const element = document.querySelector(selector);
      return element && visible(element) ? rect(element) : null;
    };
    const overlaps = (left, right) => Boolean(left && right) && !(left.right <= right.x || right.right <= left.x || left.bottom <= right.y || right.bottom <= left.y);
    const containedBy = (child, parent) => Boolean(child && parent) && child.x >= parent.x - 1 && child.y >= parent.y - 1 && child.right <= parent.right + 1 && child.bottom <= parent.bottom + 1;
    const topDock = maybeRect('[data-testid="fields-map-top-dock"]');
    const bottomDock = maybeRect('[data-testid="fields-map-measure-dock"]');
    const docks = [topDock, bottomDock].filter(Boolean);
    const inspector = maybeRect('[data-testid="fields-map-inspector"]');
    const mapViewportNode = document.querySelector('[data-testid="fields-map-viewport"]') || document.querySelector(".tf2-shell > section");
    const mapViewport = mapViewportNode ? rect(mapViewportNode) : null;
    const mobileNavNode = [...document.querySelectorAll("nav")].find((element) => getComputedStyle(element).position === "fixed" && visible(element));
    const mobileNav = mobileNavNode ? rect(mobileNavNode) : null;
    const nativeZoom = [...document.querySelectorAll(".maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out")].filter(visible).map(rect);
    const nativeScale = [...document.querySelectorAll(".maplibregl-ctrl-scale")].filter(visible).map(rect);
    const attributionNode = document.querySelector(".maplibregl-ctrl-attrib");
    const attributionButtonNode = document.querySelector(".maplibregl-ctrl-attrib-button");
    const attribution = attributionNode && visible(attributionNode) ? rect(attributionNode) : null;
    const attributionButton = attributionButtonNode && visible(attributionButtonNode) ? rect(attributionButtonNode) : null;
    const attributionStyle = attributionNode ? getComputedStyle(attributionNode) : null;
    const attributionInner = attributionNode?.querySelector(".maplibregl-ctrl-attrib-inner");
    const attributionLinks = attributionInner ? [...attributionInner.querySelectorAll("a")].map((link) => link.href) : [];
    const zoomButtons = [...document.querySelectorAll('[aria-label="Приблизить карту"],[aria-label="Отдалить карту"]')].filter(visible).map(rect);
    const controls = [...document.querySelectorAll(".tf2-shell > section button,.tf2-shell > section input,.tf2-shell > section [role=combobox]")]
      .filter(visible)
      .map((element) => ({ name: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 60), ...rect(element) }));
    return {
      viewport: [innerWidth, innerHeight],
      mapViewport,
      mobileNav,
      topDock,
      bottomDock,
      inspector,
      documentOverflowPx: document.documentElement.scrollWidth - innerWidth,
      mapViewportContained: mapViewport ? mapViewport.y >= -1 && mapViewport.bottom <= innerHeight + 1 : false,
      topDockContained: containedBy(topDock, mapViewport),
      bottomDockContained: bottomDock ? containedBy(bottomDock, mapViewport) : null,
      inspectorContained: inspector ? containedBy(inspector, mapViewport) : null,
      dockOverlap: overlaps(topDock, bottomDock),
      inspectorTopOverlap: inspector ? overlaps(inspector, topDock) : null,
      inspectorBottomOverlap: inspector ? overlaps(inspector, bottomDock) : null,
      mapViewportNavOverlap: overlaps(mapViewport, mobileNav),
      bottomDockNavOverlap: overlaps(bottomDock, mobileNav),
      bottomDockBeyondViewport: bottomDock ? bottomDock.bottom > innerHeight + 1 : false,
      nativeZoomDockOverlap: nativeZoom.some((control) => docks.some((dock) => overlaps(control, dock))),
      nativeScaleDockOverlap: nativeScale.some((control) => docks.some((dock) => overlaps(control, dock))),
      attribution,
      attributionButton,
      attributionBackground: attributionStyle?.backgroundColor || null,
      attributionColor: attributionStyle?.color || null,
      attributionClassName: attributionNode?.className || null,
      attributionOpen: attributionNode instanceof HTMLDetailsElement ? attributionNode.open : null,
      attributionInnerDisplay: attributionInner ? getComputedStyle(attributionInner).display : null,
      attributionText: attributionInner?.textContent?.trim() || null,
      attributionLinks,
      attributionButtonLabel: attributionButtonNode?.getAttribute("aria-label") || attributionButtonNode?.getAttribute("title") || null,
      attributionDockOverlap: docks.some((dock) => overlaps(attribution, dock)),
      attributionInspectorOverlap: overlaps(attribution, inspector),
      nativeZoomCount: nativeZoom.length,
      nativeScaleCount: nativeScale.length,
      zoomButtons,
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
  try {
    const context = await browser.newContext();
    await context.addInitScript({ path: path.resolve("scripts/qa-fields-map-browser-init.js") });
    const page = await context.newPage();
    const fieldsMapWrites = [];
    const interceptedMockMutations = [];
    const pageErrors = [];
    const consoleErrors = [];
    const failedResponses = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
    });
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
      const label = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(220);
      const closeInspector = page.getByRole("button", { name: "Закрыть инспектор поля" });
      if (await closeInspector.isVisible()) {
        await closeInspector.click();
        await closeInspector.waitFor({ state: "hidden" });
      }
      const baseResult = await measure(page);
      const shortLandscape = width < 1280 && height <= 600 && width > height;
      if (!expectOverlayBaseline) {
        assert.equal(baseResult.documentOverflowPx, 0, `${name} ${label} base: document overflow`);
        assert.equal(baseResult.mapViewportContained, true, `${name} ${label} base: map viewport exceeds browser viewport ${JSON.stringify({ mapViewport: baseResult.mapViewport, mobileNav: baseResult.mobileNav })}`);
        assert.equal(baseResult.topDockContained, true, `${name} ${label} base: top dock exceeds map viewport`);
        assert.equal(baseResult.bottomDockContained, true, `${name} ${label} base: measurement dock exceeds map viewport`);
        assert.equal(baseResult.dockOverlap, false, `${name} ${label} base: docks overlap ${JSON.stringify({ topDock: baseResult.topDock, bottomDock: baseResult.bottomDock, mapViewport: baseResult.mapViewport })}`);
        assert.equal(baseResult.mapViewportNavOverlap, false, `${name} ${label} base: map viewport overlaps mobile navigation`);
        assert.equal(baseResult.bottomDockNavOverlap, false, `${name} ${label} base: measurement dock overlaps mobile navigation`);
        assert.equal(baseResult.bottomDockBeyondViewport, false, `${name} ${label} base: measurement dock is below browser viewport`);
        assert.equal(baseResult.nativeZoomCount, 0, `${name} ${label} base: native floating zoom must be removed`);
        assert.equal(baseResult.nativeScaleCount, width < 1280 ? 0 : 1, `${name} ${label} base: responsive scale visibility`);
        assert.equal(baseResult.nativeScaleDockOverlap, false, `${name} ${label} base: native scale overlaps a dock`);
        if (baseResult.attribution) {
          assert.equal(baseResult.attributionDockOverlap, false, `${name} ${label} base: attribution access overlaps a dock`);
          assert.equal(baseResult.attributionOpen, false, `${name} ${label} base: compact attribution starts expanded`);
        }
        assert.equal(baseResult.zoomButtons.length, 2, `${name} ${label} base: unified dock zoom buttons missing`);
        assert.ok(baseResult.zoomButtons.every((item) => item.width >= 44 && item.height >= 44), `${name} ${label} base: zoom target below 44px`);
        assert.deepEqual(baseResult.smallTargets, [], `${name} ${label} base: compact touch target below 44px`);
        await page.getByRole("button", { name: "Приблизить карту" }).click();
        await page.getByRole("button", { name: "Отдалить карту" }).click();
      }
      const search = page.locator('input[placeholder="Найти поле..."]');
      await search.fill("19");
      await search.press("Enter");
      await page.getByRole("heading", { name: "Поле 19 терн" }).waitFor({ state: "visible" });
      await page.waitForTimeout(220);
      const result = await measure(page);
      if (expectOverlayBaseline && width < 768) {
        assert.equal(
          result.mapViewportNavOverlap || result.bottomDockNavOverlap || result.bottomDockBeyondViewport || result.nativeZoomDockOverlap || result.inspectorTopOverlap,
          true,
          `${name} ${label}: legacy overlay defect was not reproduced`
        );
        assert.equal(result.nativeZoomCount, 2, `${name} ${label}: legacy native zoom control count`);
      } else if (!expectOverlayBaseline) {
        assert.equal(result.documentOverflowPx, 0, `${name} ${label} selected: document overflow`);
        assert.equal(result.mapViewportContained, true, `${name} ${label} selected: map viewport exceeds browser viewport`);
        assert.equal(result.topDockContained, true, `${name} ${label} selected: top dock exceeds map viewport`);
        assert.equal(result.inspectorContained, true, `${name} ${label} selected: inspector exceeds map viewport`);
        assert.equal(result.bottomDockContained, shortLandscape ? null : true, `${name} ${label} selected: measurement dock responsive visibility/containment`);
        assert.equal(result.dockOverlap, false, `${name} ${label} selected: docks overlap`);
        assert.equal(result.inspectorTopOverlap, false, `${name} ${label} selected: inspector overlaps top dock ${JSON.stringify({ topDock: result.topDock, inspector: result.inspector })}`);
        assert.equal(result.inspectorBottomOverlap, false, `${name} ${label} selected: inspector overlaps bottom dock`);
        assert.equal(result.mapViewportNavOverlap, false, `${name} ${label}: map viewport overlaps mobile navigation`);
        assert.equal(result.bottomDockNavOverlap, false, `${name} ${label}: measurement dock overlaps mobile navigation`);
        assert.equal(result.bottomDockBeyondViewport, false, `${name} ${label}: measurement dock is below the viewport`);
        assert.equal(result.nativeZoomDockOverlap, false, `${name} ${label}: native zoom overlaps a dock`);
        assert.equal(result.nativeScaleDockOverlap, false, `${name} ${label}: native scale overlaps a dock`);
        assert.ok(result.attribution, `${name} ${label}: attribution access is missing`);
        assert.ok(result.attributionText, `${name} ${label}: provider attribution is missing`);
        assert.ok(result.attributionButtonLabel, `${name} ${label}: attribution access has no accessible name`);
        assert.equal(result.attributionDockOverlap, false, `${name} ${label}: attribution access overlaps a dock`);
        assert.equal(result.attributionInspectorOverlap, false, `${name} ${label}: attribution access overlaps the inspector`);
        assert.equal(result.attributionOpen, false, `${name} ${label}: compact attribution starts expanded`);
        assert.equal(result.attributionClassName.includes("maplibregl-compact-show"), false, `${name} ${label}: compact attribution starts visually expanded`);
        assert.notEqual(result.attributionBackground, "rgb(255, 255, 255)", `${name} ${label}: attribution retained the accidental white surface`);
        assert.equal(result.nativeZoomCount, 0, `${name} ${label}: native floating zoom must be removed`);
        assert.equal(result.nativeScaleCount, width < 1280 ? 0 : 1, `${name} ${label}: responsive scale visibility`);
        assert.equal(result.zoomButtons.length, shortLandscape ? 0 : 2, `${name} ${label}: responsive unified dock zoom visibility`);
        assert.ok(result.zoomButtons.every((item) => item.width >= 44 && item.height >= 44), `${name} ${label}: zoom target below 44px`);
      }
      assert.equal(result.query, "", `${name} ${label}: selected search remains expanded`);
      assert.deepEqual(result.smallTargets, [], `${name} ${label}: compact touch target below 44px`);
      if (!expectOverlayBaseline && ((width === 320 && height === 568) || (width === 390 && height === 844))) {
        const attributionButton = page.locator(".maplibregl-ctrl-attrib-button");
        const useKeyboardDisclosure = name === "webkit" && width === 390;
        if (useKeyboardDisclosure) {
          await attributionButton.focus();
          await attributionButton.press("Enter");
        } else {
          await attributionButton.click();
        }
        await page.locator(".maplibregl-ctrl-attrib.maplibregl-compact-show").waitFor({ state: "visible" });
        const expandedAttribution = await measure(page);
        assert.ok(expandedAttribution.attributionText, `${name} ${label}: expanded provider credits are empty`);
        assert.equal(expandedAttribution.attributionDockOverlap, false, `${name} ${label}: expanded attribution overlaps a dock`);
        assert.equal(expandedAttribution.attributionInspectorOverlap, false, `${name} ${label}: expanded attribution overlaps the inspector`);
        assert.notEqual(expandedAttribution.attributionBackground, "rgb(255, 255, 255)", `${name} ${label}: expanded attribution retained the white surface`);
        await page.getByRole("button", { name: "Карта", exact: true }).click();
        await page.waitForTimeout(250);
        const attributionAfterLateSourceEvent = await measure(page);
        assert.equal(attributionAfterLateSourceEvent.attributionOpen, true, `${name} ${label}: late source event closed user-opened attribution`);
        assert.equal(attributionAfterLateSourceEvent.attributionClassName.includes("maplibregl-compact-show"), true, `${name} ${label}: late source event visually collapsed user-opened attribution`);
        assert.ok(attributionAfterLateSourceEvent.attributionLinks.some((href) => href.startsWith("https://www.openstreetmap.org/copyright")), `${name} ${label}: provider link is not available after source change`);
        if (useKeyboardDisclosure) {
          await attributionButton.press("Space");
        } else {
          await attributionButton.click();
        }
        await page.waitForFunction(() => !document.querySelector(".maplibregl-ctrl-attrib")?.classList.contains("maplibregl-compact-show"));
      }
      let activeMeasure = null;
      if (!expectOverlayBaseline && !shortLandscape) {
        const distanceButton = page.getByRole("button", { name: "Расстояние" });
        await distanceButton.click();
        await page.waitForTimeout(80);
        activeMeasure = await measure(page);
        assert.equal(activeMeasure.bottomDockContained, true, `${name} ${label} active measure: toolbar exceeds map viewport`);
        assert.equal(activeMeasure.dockOverlap, false, `${name} ${label} active measure: docks overlap`);
        assert.equal(activeMeasure.inspectorBottomOverlap, false, `${name} ${label} active measure: inspector overlaps expanded toolbar`);
        assert.equal(activeMeasure.bottomDockNavOverlap, false, `${name} ${label} active measure: toolbar overlaps mobile navigation`);
        await distanceButton.click();
      }
      await page.screenshot({ path: path.join(outputDir, `${name}-${label}.png`) });
      results.push({ viewport: [width, height], base: baseResult, selected: result, activeMeasure });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const closeFieldInspector = page.getByRole("button", { name: "Закрыть инспектор поля" });
    if (await closeFieldInspector.isVisible()) await closeFieldInspector.click();
    await page.getByRole("button", { name: "Инженерия", exact: true }).click();
    const engineeringReadonly = page.getByTestId("fields-map-engineering-readonly");
    if (expectReadOnlyEngineering) {
      await engineeringReadonly.waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Показать инженерный объект Гидрант QA" }).click();
      assert.equal(await page.getByRole("button", { name: "Рисовать", exact: true }).count(), 0, `${name}: read-only engineering draw action leaked`);
      assert.equal(await page.getByRole("button", { name: "Сохранить", exact: true }).count(), 0, `${name}: read-only engineering save action leaked`);
      assert.equal(await page.getByRole("button", { name: "Редактировать", exact: true }).count(), 0, `${name}: read-only engineering edit action leaked`);
      assert.equal(await page.getByRole("button", { name: "Удалить", exact: true }).count(), 0, `${name}: read-only engineering delete action leaked`);
      assert.equal(await page.getByRole("button", { name: /^(Точка|Линия|Зона)$/u }).count(), 0, `${name}: read-only engineering toolbar mutation leaked`);
    } else {
      assert.equal(await engineeringReadonly.count(), 0, `${name}: writer received read-only engineering banner`);
      await page.getByRole("button", { name: "Рисовать", exact: true }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Сохранить", exact: true }).waitFor({ state: "visible" });
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
    assert.deepEqual(pageErrors, [], `${name}: unexpected page errors`);
    const expectedHarnessConsoleErrors = consoleErrors.filter((message) => /^WebSocket connection to 'ws:\/\/localhost:54321\/realtime\/v1\/websocket\?apikey=local-browser-anon-key&vsn=1\.0\.0' failed: (?:Error in connection establishment: net::ERR_CONNECTION_REFUSED|WebSocket network error: error code 7)$/u.test(message));
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !expectedHarnessConsoleErrors.includes(message));
    assert.deepEqual(unexpectedConsoleErrors, [], `${name}: unexpected console errors; failed responses ${JSON.stringify([...new Set(failedResponses)])}`);
    return { name, results, reducedMotion, fieldsMapWrites, interceptedMockMutations, pageErrors, failedResponses, expectedHarnessConsoleErrors, unexpectedConsoleErrors };
  } finally {
    await browser.close();
  }
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const evidence = [];
  if (requestedEngines.has("chromium")) evidence.push(await runEngine("chromium", chromium));
  if (requestedEngines.has("webkit")) evidence.push(await runEngine("webkit", webkit));
  const output = compactEvidence
    ? {
        suite: "Fields Map browser matrix",
        qaRole,
        expectReadOnlyEngineering,
        expectOverlayBaseline,
        evidence: evidence.map(({ name, results, reducedMotion, fieldsMapWrites }) => ({
          name,
          reducedMotion,
          fieldsMapWrites,
          results: results.map(({ viewport, base, selected }) => ({
            viewport,
            base: {
              mapViewport: base.mapViewport,
              mobileNav: base.mobileNav,
              topDock: base.topDock,
              bottomDock: base.bottomDock,
              mapViewportNavOverlap: base.mapViewportNavOverlap,
              dockOverlap: base.dockOverlap,
              nativeZoomCount: base.nativeZoomCount,
              nativeScaleCount: base.nativeScaleCount,
              nativeScaleDockOverlap: base.nativeScaleDockOverlap,
              attribution: base.attribution,
              attributionButton: base.attributionButton,
              attributionBackground: base.attributionBackground,
              attributionColor: base.attributionColor,
              attributionClassName: base.attributionClassName,
              attributionOpen: base.attributionOpen,
              attributionInnerDisplay: base.attributionInnerDisplay,
              attributionText: base.attributionText,
              attributionLinks: base.attributionLinks,
              attributionButtonLabel: base.attributionButtonLabel,
              attributionDockOverlap: base.attributionDockOverlap,
              zoomButtons: base.zoomButtons,
            },
            selected: {
              topDock: selected.topDock,
              bottomDock: selected.bottomDock,
              inspector: selected.inspector,
              inspectorTopOverlap: selected.inspectorTopOverlap,
              inspectorBottomOverlap: selected.inspectorBottomOverlap,
              bottomDockNavOverlap: selected.bottomDockNavOverlap,
              attribution: selected.attribution,
              attributionBackground: selected.attributionBackground,
              attributionColor: selected.attributionColor,
              attributionClassName: selected.attributionClassName,
              attributionOpen: selected.attributionOpen,
              attributionInnerDisplay: selected.attributionInnerDisplay,
              attributionText: selected.attributionText,
              attributionLinks: selected.attributionLinks,
              attributionButtonLabel: selected.attributionButtonLabel,
              attributionDockOverlap: selected.attributionDockOverlap,
              attributionInspectorOverlap: selected.attributionInspectorOverlap,
            },
          })),
        })),
      }
    : { suite: "Fields Map browser matrix", expectOverlayBaseline, evidence };
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
