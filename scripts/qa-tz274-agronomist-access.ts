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

const sidebar = read("components/layout/sidebar.tsx");
const mobileNav = read("components/layout/mobile-bottom-nav.tsx");
const cropPage = read("app/(dashboard)/crop-structure/page.tsx");
const cropBootstrap = read("app/api/crop-structure/bootstrap/route.ts");
const cropMutation = read("app/api/crop-structure/fields/[id]/route.ts");
const weatherPage = read("app/(dashboard)/weather-lab/page.tsx");
const weatherUi = read("components/weather/weather-lab.tsx");
const weatherAuth = read("app/api/weather-lab/_auth.ts");
const forecastApi = read("app/api/weather-lab/forecast/route.ts");
const locationApi = read("app/api/weather-lab/location/route.ts");
const profilesApi = read("app/api/weather-lab/profiles/route.ts");
const profileApi = read("app/api/weather-lab/profiles/[id]/route.ts");
const assistantShell = read("lib/assistant/shell.ts");

check("agronomist can open approved pages", () => {
  assert.equal(canAccessPath("agronomist", "/dashboard"), true);
  assert.equal(canAccessPath("agronomist", "/crop-structure"), true);
  assert.equal(canAccessPath("agronomist", "/weather-lab"), true);
  assert.equal(canAccessPath("agronomist", "/warehouses"), true);
  assert.equal(canAccessPath("agronomist", "/tickets"), true);
});

check("agronomist fields and operations remain hidden", () => {
  assert.equal(canAccessPath("agronomist", "/fields"), false);
  assert.equal(canAccessPath("agronomist", "/operations"), false);
});

check("director receives no structure write route", () => {
  assert.equal(canAccessPath("director", "/crop-structure"), false);
  assert.equal(canAccessPath("director", "/weather-lab"), false);
});

check("desktop menu order matches owner contract", () => {
  assert.match(sidebar, /const AGRONOMIST_NAV[\s\S]*?harvest_summary[\s\S]*?crop_structure[\s\S]*?weather[\s\S]*?warehouses[\s\S]*?tickets_nav[\s\S]*?\];/);
  assert.doesNotMatch(sidebar.match(/const AGRONOMIST_NAV[\s\S]*?\];/)?.[0] || "", /labelKey: "fields"|labelKey: "operations"/);
});

check("mobile menu has all five routes and stable labels", () => {
  assert.match(mobileNav, /case "agronomist":[\s\S]*?harvest_summary[\s\S]*?crop_structure[\s\S]*?weather[\s\S]*?warehouses[\s\S]*?tickets_nav/);
  assert.match(mobileNav, /normalizedRole === "agronomist" \? 5 : 4/);
  assert.match(mobileNav, /line-clamp-2/);
});

check("crop bootstrap is server role and company scoped", () => {
  assert.match(cropBootstrap, /READ_ALLOWED_ROLES = new Set\(\["global_admin", "company_admin", "agronomist"\]\)/);
  assert.match(cropBootstrap, /resolveCompanyForActor\(actor, requestedCompanyId\)/);
  assert.match(cropBootstrap, /Current role cannot view crop structure/);
});

check("closed seasons are returned and active season is explicit", () => {
  assert.match(cropBootstrap, /select\("id,year,archived"\)/);
  assert.doesNotMatch(cropBootstrap.match(/\.from\("seasons"\)[\s\S]*?\.order\("year"/)?.[0] || "", /\.eq\("archived", false\)/);
  assert.match(cropBootstrap, /activeSeasonId/);
  assert.match(cropPage, /item\.archived \? " · закрыт"/);
});

check("only active open season exposes editor and save", () => {
  assert.match(cropPage, /canEditSelectedSeason = canEditStructure[\s\S]*?seasonId === activeSeasonId[\s\S]*?!selectedSeasonClosed/);
  assert.match(cropPage, /Сезон \{season\.year\} доступен только для чтения/);
  assert.match(cropPage, /canEditSelectedSeason && fieldDialogTab === "editor"/);
  assert.match(cropMutation, /Closed season is read-only/);
  assert.match(cropMutation, /Only the current season crop structure can be edited/);
});

check("agronomist does not receive field administration", () => {
  assert.match(cropPage, /canManageFields = isGlobalAdmin \|\| profile\?\.role === "company_admin"/);
  assert.doesNotMatch(cropPage.match(/canManageFields =[^;]+/)?.[0] || "", /agronomist/);
});

check("weather route is available only to approved roles", () => {
  assert.match(weatherAuth, /actor\.role !== "global_admin" && actor\.role !== "agronomist"/);
  assert.match(weatherPage, /profile\?\.role !== "global_admin" && profile\?\.role !== "agronomist"/);
});

check("technical provider details are global admin only", () => {
  assert.match(weatherPage, /showTechnicalDebug=\{profile\?\.role === "global_admin"\}/);
  assert.match(weatherUi, /showTechnicalDebug \? <details/);
  assert.match(forecastApi, /showTechnicalDetails = actor\.role === "global_admin"/);
  assert.match(locationApi, /showTechnicalDetails = actor\.role === "global_admin"/);
});

check("weather profiles are user and company scoped", () => {
  for (const source of [profilesApi, profileApi]) {
    assert.match(source, /\.eq\("company_id", companyId\)/);
    assert.match(source, /\.eq\("user_id", actor\.authUserId\)/);
  }
});

check("wind direction is visible in current and hourly forecast", () => {
  assert.match(weatherUi, /windDirection\(current\.windBearingDeg\)/);
  assert.match(weatherUi, /windDirection\(point\.windBearingDeg\)/);
});

check("assistant is available to agronomist without broad admin access", () => {
  assert.match(assistantShell, /AssistantAllowedRole = "global_admin" \| "agronomist"/);
  assert.match(assistantShell, /ASSISTANT_ALLOWED_ROLES = new Set<AssistantAllowedRole>\(\[[\s\S]*?"global_admin",[\s\S]*?"agronomist",[\s\S]*?\]\)/);
});

console.log(`TZ274 PASS ${checks.length}/${checks.length}`);
for (const name of checks) console.log(`PASS ${name}`);
