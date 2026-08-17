import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessPath } from "../lib/auth/role-access";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const checks: string[] = [];
const check = (name: string, fn: () => void) => {
  fn();
  checks.push(name);
};

const dashboardLayout = read("components/layout/dashboard-layout.tsx");
const mobileNav = read("components/layout/mobile-bottom-nav.tsx");
const sidebar = read("components/layout/sidebar.tsx");
const platformLayout = read("components/layout/platform-layout.tsx");
const platformPage = read("app/(platform)/platform/page.tsx");
const platformAssistantPage = read("app/(platform)/platform/assistant/settings/page.tsx");
const cropPage = read("app/(dashboard)/crop-structure/page.tsx");
const cropBootstrap = read("app/api/crop-structure/bootstrap/route.ts");
const cropMutation = read("app/api/crop-structure/fields/[id]/route.ts");
const weatherPage = read("app/(dashboard)/weather-lab/page.tsx");
const weatherAuth = read("app/api/weather-lab/_auth.ts");
const weatherProfiles = read("app/api/weather-lab/profiles/route.ts");
const ticketsPage = read("app/(dashboard)/tickets/page.tsx");
const ticketsApi = read("app/api/weighbridge/tickets/route.ts");
const ticketDialog = read("components/weighbridge/ticket-preview-dialog.tsx");
const weighbridgeService = read("lib/services/weighbridge.ts");
const pesticideCard = read("app/api/global-admin/pesticide-card/[id]/route.ts");
const userPesticideCard = read("app/api/catalog/pesticide-card/[id]/route.ts");
const catalogManager = read("components/platform/global-catalog-manager.tsx");
const humanCard = read("lib/glbd/human-pesticide-card.ts");
const authContext = read("lib/contexts/auth-context.tsx");
const platformStatus = read("lib/platform/platform-status-client.ts");
const platformStatusRoute = read("app/api/global-admin/platform-status/route.ts");

check("assistant UI is absent from shared user shell", () => {
  assert.doesNotMatch(dashboardLayout, /AssistantShellProvider|AssistantLauncher|AssistantPanel|AssistantDebugMonitor/);
  assert.doesNotMatch(mobileNav, /AssistantShell|AssistantLauncher|AssistantPanel|labelKey: "copilot"/);
  assert.doesNotMatch(platformLayout, /assistant\/settings|Copilot|Brain/);
  assert.match(platformAssistantPage, /redirect\("\/platform"\)/);
  assert.doesNotMatch(platformPage, /ассистент|ассиста|Copilot/i);
});

check("director read routes and menus are complete", () => {
  for (const path of ["/dashboard", "/crop-structure", "/weather-lab", "/warehouses", "/tickets"]) {
    assert.equal(canAccessPath("director", path), true, path);
  }
  assert.match(sidebar, /const DIRECTOR_NAV[\s\S]*?weather[\s\S]*?warehouses[\s\S]*?tickets_nav/);
  assert.match(mobileNav, /case "director":[\s\S]*?weather[\s\S]*?warehouses[\s\S]*?tickets_nav/);
});

check("director structure remains read-only on client and server", () => {
  assert.match(cropBootstrap, /"agronomist", "director"/);
  assert.doesNotMatch(cropPage.match(/canEditStructure =[^;]+/)?.[0] || "", /director/);
  assert.doesNotMatch(cropMutation.match(/EDIT_ALLOWED_ROLES =[^;]+/)?.[0] || "", /director/);
});

check("crop structure searches full seed identity", () => {
  assert.match(cropPage, /cropName\(row\.crop_id\)/);
  assert.match(cropPage, /varietyName\(row\.variety_id\)/);
  assert.match(cropPage, /reproductionName\(row\.reproduction_id\)/);
  assert.match(cropPage, /Поле, культура, сорт, репродукция/);
});

check("weather read access and profile writes are role separated", () => {
  assert.match(weatherPage, /profilesEditable=\{profile\.role !== "director"\}/);
  assert.match(weatherAuth, /requireWeatherProfileWriteAccess/);
  assert.match(weatherProfiles, /requireWeatherProfileWriteAccess\(actor\)/);
});

check("ticket history is lazy and bounded", () => {
  assert.match(ticketsPage, /view: mode/);
  assert.match(ticketsPage, /mode === "history" \? 60 : 100/);
  assert.match(ticketsApi, /view === "open"/);
  assert.match(ticketsApi, /view === "history"/);
  assert.match(ticketsApi, /Math\.min\([\s\S]*?100\)/);
});

check("ticket navigation aborts stay silent", () => {
  assert.match(ticketsPage, /signal\?\.aborted/);
  assert.match(ticketsPage, /reason\.name === "AbortError"/);
  assert.match(ticketsPage, /if \(!signal\?\.aborted\) setLoading\(false\)/);
});

check("ticket list and detail requests are cached and deduplicated", () => {
  assert.match(weighbridgeService, /ticketListCache/);
  assert.match(weighbridgeService, /ticketListRequests/);
  assert.match(weighbridgeService, /ticketDetailsCache/);
  assert.match(weighbridgeService, /invalidateWeighbridgeTicketCache/);
  assert.match(ticketDialog, /initialTicket/);
  assert.doesNotMatch(ticketDialog, /setPayload\(null\);/);
});

check("GLBD top navigation exposes the three owner categories", () => {
  const agrochemistry = platformLayout.match(/titleKey: "agrochemistry"[\s\S]*?\n  \},/)?.[0] || "";
  assert.match(agrochemistry, /pesticides/);
  assert.match(agrochemistry, /fertilizers/);
  assert.match(agrochemistry, /additives/);
});

check("GLBD product card reads only referenced identities", () => {
  assert.match(pesticideCard, /\.in\("id", componentIds\)/);
  assert.match(pesticideCard, /\.in\("id", cropIds\)/);
  assert.match(pesticideCard, /\.eq\("id", product\.manufacturer_id\)/);
  assert.doesNotMatch(pesticideCard, /from\("crops"\)\.select\("id,name_ru,name_en"\),/);
});

check("GLBD product cards expose owner fields across agrochemistry groups", () => {
  for (const source of [pesticideCard, userPesticideCard]) {
    assert.match(source, /product_type/);
    assert.match(source, /glbd_product_sources/);
    assert.match(source, /buildHumanPesticideCard/);
    assert.doesNotMatch(source, /\.eq\("type", "pesticide"\)/);
  }
  assert.match(catalogManager, /isProductCardList = isProductEntity\(config\.entity\)/);
  assert.match(catalogManager, /params\.set\("product", productId\)/);
  for (const label of ["Тип продукта", "Подкатегория", "Источник", "Статус проверки"]) {
    assert.match(humanCard, new RegExp(label));
  }
});

check("platform controls stay usable on narrow screens", () => {
  assert.match(platformPage, /sm:flex-row sm:items-start/);
  assert.match(platformPage, /w-full sm:w-auto/);
  assert.match(platformPage, /break-words font-medium/);
});

check("cold auth bootstrap avoids duplicate sequential work", () => {
  assert.match(authContext, /profileMap\.size === 0/);
  assert.match(authContext, /Promise\.all\(\[\s*resolveGlobalAdminContextCompanyId/);
  assert.match(authContext, /resolveActorContextFromServer\(accessToken\)/);
  assert.match(authContext, /session\.access_token/);
});

check("platform status shares a short-lived request cache", () => {
  assert.match(platformStatus, /STATUS_CACHE_TTL_MS = 30_000/);
  assert.match(platformStatus, /statusRequest/);
  assert.match(platformStatus, /cachedStatus/);
  assert.match(platformStatusRoute, /getMaterialProductTypeFromProduct\(row\)/);
});

console.log(`TZ275 PASS ${checks.length}/${checks.length}`);
for (const name of checks) console.log(`PASS ${name}`);
