import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const sw = read("public/sw.js");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const assistantShell = read("components/assistant/assistant-shell-provider.tsx");
const authContext = read("lib/contexts/auth-context.tsx");
const hardNavigationSources = [
  "components/layout/header.tsx",
  "components/layout/dashboard-layout.tsx",
  "app/(dashboard)/users/page.tsx",
  "app/(dashboard)/care-systems/page.tsx",
].map(read).join("\n");

let checks = 0;
const check = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
};

check("all working routes share the dashboard layout", () => {
  for (const route of ["dashboard", "weighbridge", "warehouses", "ledger", "references", "weather-lab"]) {
    assert.equal(existsSync(join(root, "app", "(dashboard)", route)), true, route);
  }
  assert.match(read("app/(dashboard)/layout.tsx"), /<DashboardLayout>/);
});

check("root providers live above dashboard pages", () => {
  assert.match(read("app/layout.tsx"), /<PublicAwareProviders>/);
  assert.match(read("components/auth/protected-app.tsx"), /<AuthProvider>[\s\S]*<LanguageProvider>[\s\S]*<ProtectedRoute>/);
});

check("root shell is not keyed by route or business context", () => {
  const roots = [read("app/layout.tsx"), read("app/(dashboard)/layout.tsx"), read("components/layout/dashboard-layout.tsx")].join("\n");
  assert.doesNotMatch(roots, /key=\{[^}]*(pathname|company|role|season)/i);
});

check("service worker never caches Next Flight responses", () => {
  assert.match(sw, /function isNextRscRequest/);
  assert.match(sw, /url\.searchParams\.has\("_rsc"\)/);
  assert.match(sw, /isNextRuntimeAsset\(request\) \|\| isNextRscRequest\(request\)/);
  assert.match(sw, /event\.respondWith\(fetch\(request\)\)/);
});

check("service worker caches only explicit static assets", () => {
  assert.match(sw, /STATIC_ASSET_PATHS\.has/);
  assert.match(sw, /if \(isKnownStaticAsset\(request\)\)/);
  assert.match(sw, /event\.respondWith\(fetch\(request\)\);\s*\}\);\s*$/);
});

check("application controls no longer perform hard navigation", () => {
  assert.doesNotMatch(hardNavigationSources, /window\.location\.(?:assign|replace|reload)/);
  assert.doesNotMatch(hardNavigationSources, /window\.location\.href\s*=/);
  assert.doesNotMatch(hardNavigationSources, /document\.location|location\.reload\(/);
});

check("profile context refresh does not reload the document", () => {
  assert.match(authContext, /refreshProfile:\s*\(\) => Promise<void>/);
  assert.match(authContext, /const refreshProfile = async/);
});

check("cached auth UI restores immediately without persisting a token", () => {
  assert.match(authContext, /AUTH_UI_CACHE_KEY = "travkin\.auth\.ui\.v1"/);
  assert.match(authContext, /window\.localStorage\.getItem\(AUTH_UI_CACHE_KEY\)/);
  assert.match(authContext, /profile\.is_impersonating \? window\.sessionStorage : window\.localStorage/);
  assert.match(authContext, /parsed\.profile\.is_impersonating && !fromSession/);
  assert.match(authContext, /useState\(\(\) => !cachedAuthRef\.current\)/);
  assert.match(authContext, /setLoading\(!cachedAuthRef\.current\)/);
  assert.match(authContext, /if \(event === "INITIAL_SESSION"\) return/);
  const cachedPayload = authContext.slice(
    authContext.indexOf("function writeCachedAuthUiState"),
    authContext.indexOf("function clearCachedAuthUiState")
  );
  assert.doesNotMatch(cachedPayload, /access_token|refresh_token|session\s*:/);
});

check("critical weighbridge load excludes bootstrap and secondary catalogs", () => {
  const critical = page.slice(page.indexOf("const load = async"), page.indexOf("const refreshTickets"));
  assert.doesNotMatch(critical, /getWeighbridgeBootstrap|from\("products"\)|loadMasterIdentityRefs|loadSuppliers|loadBuyers/);
  assert.match(critical, /getWeighbridgeResources/);
  assert.match(critical, /loadHarvestAllocations/);
  assert.match(critical, /loadTransportPickerDataCached/);
});

check("secondary catalogs load only outside default harvest intake", () => {
  assert.match(page, /const loadSecondaryCatalogs = async/);
  assert.match(page, /const needsSecondaryCatalogs = form\.operationType !== "harvest_incoming"/);
  assert.match(page, /if \(!needsSecondaryCatalogs \|\| secondaryCatalogsLoaded/);
});

check("statistics summary is lazy", () => {
  assert.match(page, /const \[statisticsOpen, setStatisticsOpen\]/);
  assert.match(page, /if \(!statisticsOpen \|\| !profile\?\.company_id\) return/);
  assert.match(page, /refreshBootstrap\(true, controller\.signal\)/);
});

check("weighbridge restores confirmed workspace data from shared browser cache", () => {
  assert.match(page, /readWeighbridgeWorkspaceCache/);
  assert.match(page, /writeWeighbridgeWorkspaceCache/);
  assert.match(page, /workspaceCacheKey\(companyId, profileId, language\)/);
  assert.match(page, /window\.localStorage\.getItem\(key\)/);
  assert.match(page, /setCoreDataReady\(true\)/);
  assert.match(page, /performance\.mark\("travkin-weighbridge-interactive"\)/);
});

check("canonical startup requests are deduplicated and abortable", () => {
  for (const ref of ["coreLoadRequestRef", "ticketsRequestRef", "operatorRequestRef", "secondaryCatalogRequestRef"]) {
    assert.match(page, new RegExp(ref));
  }
  assert.match(page, /const controller = new AbortController\(\)/);
  assert.match(page, /controller\.abort\(\)/);
});

check("workspace journal is bounded", () => {
  assert.match(ticketRoute, /\.limit\(100\)/);
  assert.match(ticketRoute, /\.limit\(20\)/);
});

check("assistant remains fully suppressed on weighbridge", () => {
  assert.match(assistantShell, /assistantSuppressedForRoute/);
  assert.match(assistantShell, /pathname === "\/weighbridge"/);
});

console.log(`TZ273 ${checks}/${checks} PASS`);
