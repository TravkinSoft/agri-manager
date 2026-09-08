import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Check = { name: string; run: () => void };

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");
const dashboard = read("components/dashboard/harvest-dashboard.tsx");
const service = read("lib/services/harvest-dashboard.ts");
const route = read("app/api/dashboard/harvest-summary/route.ts");
const loadDashboardBlock = dashboard.slice(
  dashboard.indexOf("const loadDashboard"),
  dashboard.indexOf("const setFilter")
);
const routeHandler = route.slice(route.indexOf("export async function GET"));

const checks: Check[] = [
  {
    name: "general page uses the short summary title",
    run: () => {
      assert.match(dashboard, />Сводка<\/h1>/);
      assert.doesNotMatch(dashboard, /Сводка уборки/);
    },
  },
  {
    name: "top-level controls are visually unframed",
    run: () => assert.match(dashboard, /<Card className="rounded-lg" style=\{\{ background: "transparent", border: 0, boxShadow: "none" \}\}>/),
  },
  {
    name: "party list is a vertical divider hierarchy",
    run: () => assert.match(dashboard, /rounded-none border-0 border-b border-slate-800 bg-transparent shadow-none/),
  },
  {
    name: "initial and empty states reserve stable height",
    run: () => {
      assert.match(dashboard, /min-h-\[24rem\]/);
      assert.ok((dashboard.match(/min-h-\[20rem\]/g) || []).length >= 2);
      assert.match(dashboard, /aria-busy=\{initialLoading \|\| refreshing\}/);
    },
  },
  {
    name: "same-company refresh retains the last valid summary",
    run: () => {
      assert.match(loadDashboardBlock, /const hasRetainedSummary = summaryRef\.current !== null/);
      assert.match(loadDashboardBlock, /setInitialLoading\(!hasRetainedSummary\)/);
      assert.doesNotMatch(loadDashboardBlock.slice(loadDashboardBlock.indexOf("try {")), /setSummary\(null\)/);
    },
  },
  {
    name: "company scope change clears retained protected data",
    run: () => assert.match(loadDashboardBlock, /scopeChanged[\s\S]*?summaryRef\.current = null;[\s\S]*?setSummary\(null\)/),
  },
  {
    name: "new request aborts and fences the previous response",
    run: () => {
      assert.match(loadDashboardBlock, /requestAbortRef\.current\?\.abort\(\)/);
      assert.match(loadDashboardBlock, /const generation = \+\+requestGenerationRef\.current/);
      assert.ok((loadDashboardBlock.match(/generation !== requestGenerationRef\.current/g) || []).length >= 2);
      assert.match(loadDashboardBlock, /controller\.signal\.aborted/);
    },
  },
  {
    name: "dashboard service forwards AbortSignal to fetch",
    run: () => {
      assert.match(service, /signal\?: AbortSignal/);
      assert.match(service, /signal: options\.signal/);
    },
  },
  {
    name: "initial screen uses one combined bootstrap instead of a filters request",
    run: () => {
      assert.match(dashboard, /getHarvestBootstrap<BootstrapPayload>\(query, \{ signal: controller\.signal \}\)/);
      assert.doesNotMatch(dashboard, /getHarvestFilters/);
      assert.equal((routeHandler.match(/loadTickets\(supabase, companyId\)/g) || []).length, 1);
    },
  },
  {
    name: "bootstrap returns summary and complete filter options",
    run: () => assert.match(routeHandler, /section === "bootstrap"[\s\S]*?summary: \{ \.\.\.summary, source: SUMMARY_SOURCE \}[\s\S]*?options: buildHarvestFilterOptions\(tickets, filterWarehouseRows\)/),
  },
  {
    name: "canonical harvest aggregation functions remain authoritative",
    run: () => {
      assert.match(routeHandler, /buildWarehouseHarvestRows\(loadedWarehouseRows, filters\)/);
      assert.match(routeHandler, /buildHarvestOverview\(tickets, \{ period, filters, warehouseRows \}\)/);
      assert.match(route, /SUMMARY_SOURCE = "effective finalized harvest_incoming tickets"/);
    },
  },
  {
    name: "dashboard roles remain unchanged",
    run: () => assert.match(route, /DASHBOARD_ROLES = \["global_admin", "company_admin", "agronomist", "director"\] as const/),
  },
  {
    name: "durable shift history is not simulated in this change",
    run: () => {
      assert.doesNotMatch(dashboard, /История смен|Архив смен/);
      assert.doesNotMatch(route, /shift-history|shift_history/);
    },
  },
];

for (const check of checks) {
  check.run();
  console.log(`PASS ${check.name}`);
}

console.log(`TRAVKINFLOW 2 DASHBOARD SUMMARY: ${checks.length}/${checks.length} PASS`);
