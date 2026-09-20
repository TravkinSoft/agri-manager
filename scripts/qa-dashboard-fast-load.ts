import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { createInFlightRead } from "../lib/dashboard/in-flight-read";
import { createDashboardSnapshotCache } from "../lib/dashboard/client-snapshot";
import { buildHarvestOverview, buildWarehouseHarvestRows, buildHarvestFilterOptions, resolveHarvestPeriod } from "../lib/dashboard/harvest-summary";

async function benchmarkRoute(source: string) {
  const wait = <T,>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  const db = { from: (table: string) => {
    const query: any = {};
    for (const method of ["select", "eq", "order", "limit", "maybeSingle"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => void) => wait(20, { error: null, data: table === "companies" ? { operational_day_start_hour: 7 } : table === "weighbridge_shifts" ? [] : null }).then(resolve);
    return query;
  } };
  const loaded = { exports: {} as { GET: (request: unknown) => Promise<any> } };
  const code = source.slice(source.indexOf("export async function GET"));
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: loaded, exports: loaded.exports, performance, createHash,
    NextResponse: { json: (body: unknown, options: unknown) => ({ body, options }) },
    DASHBOARD_ROLES: [], PERIOD_PRESETS: new Set(["current_day"]), SUMMARY_SOURCE: "effective finalized harvest_incoming tickets",
    resolveWeighbridgeSession: () => wait(10, { companyId: "test-company", supabase: db, actor: { id: "profile", authUserId: "user", role: "agronomist" } }),
    asSessionErrorResponse: () => null, readFilters: () => ({}), getServiceClient: () => db,
    loadTickets: () => wait(120, []), loadWarehouseRows: () => wait(80, []), loadImpurityTickets: () => wait(30, []),
    loadActivePtcPlotSelection: () => wait(30, { selection: null, suppressTicketInference: false }), loadHarvestPlotTimeline: () => wait(40, []),
    attachVerifiedCurrentPlotYield: (_db: unknown, _id: string, summary: unknown) => summary,
    buildHarvestOverview, buildWarehouseHarvestRows, buildHarvestFilterOptions,
    resolveHarvestPeriod: (options: any) => resolveHarvestPeriod({ ...options, now: new Date("2026-09-20T10:00:00Z") }),
    shareTickets: createInFlightRead(),
  });
  const start = performance.now();
  const result = await loaded.exports.GET({ nextUrl: new URL("https://test.invalid/api/dashboard/harvest-summary?section=summary"), headers: new Headers() });
  assert.ok(!result.body.error, result.body.error);
  return { ms: performance.now() - start, body: JSON.parse(JSON.stringify(result.body, (key, value) => key === "updatedAt" ? "timestamp" : value)) };
}

async function main() {
  const join = createInFlightRead<number>();
  let reads = 0;
  let finish!: (value: number) => void;
  const pending = join("actor:company:login", () => { reads++; return new Promise((resolve) => { finish = resolve; }); });
  assert.equal(join("actor:company:login", async () => 99), pending);
  assert.equal(await join("actor:other-company:login", async () => 22), 22);
  assert.equal(await join("other-actor:company:login", async () => 23), 23);
  assert.equal(reads, 1);
  finish(17);
  assert.equal(await pending, 17);
  assert.equal(await join("actor:company:login", async () => 18), 18, "closed-ticket refresh never reuses settled data");
  await assert.rejects(join("failure", async () => { throw new Error("network"); }));
  assert.equal(await join("failure", async () => 19), 19, "failed reads are evicted");

  const cache = createDashboardSnapshotCache(100, 2);
  cache.write("a", { scope: "tenant-a:role:login", data: 0, savedAt: 100 });
  assert.equal(cache.read<number>("a", "tenant-a:role:login", 110)?.data, 0);
  assert.equal(cache.read("a", "tenant-b:role:login", 110), null);
  assert.equal(cache.read("a", "tenant-a:other-role:login", 110), null);
  assert.equal(cache.read("a", "tenant-a:role:new-login", 110), null);
  assert.equal(cache.read("a", "tenant-a:role:login", 200), null);
  for (const key of ["a", "b", "c"]) cache.write(key, { scope: key, data: key, savedAt: 100 });
  assert.equal(cache.read("a", "a", 101), null, "bounded cache evicts oldest");
  cache.clear();
  assert.equal(cache.read("c", "c", 101), null);

  const api = readFileSync("app/api/dashboard/harvest-summary/route.ts", "utf8");
  assert.ok(api.indexOf("resolveWeighbridgeSession(request") < api.indexOf("shareTickets(readScope"));
  for (const field of ["actor.authUserId", "actor.id", "companyId", "actor.role", "actor.impersonatedProfileId", 'request.headers.get("authorization")', 'request.headers.get("cookie")']) assert.ok(api.includes(field));
  assert.ok(api.includes('"Cache-Control": "private, no-store"'));
  assert.ok(api.includes('"Server-Timing"'));
  assert.ok(api.includes('timed("stock", () => loadWarehouseRows'));
  assert.ok(api.includes('await Promise.all([contextPromise, activePtcPromise])'));
  const ui = readFileSync("components/dashboard/harvest-dashboard.tsx", "utf8");
  assert.ok(!ui.includes("getHarvestBootstrap"), "unused filter options are not fetched at startup");
  assert.ok(ui.includes("user?.last_sign_in_at"));
  assert.ok(ui.includes("profile?.is_impersonating"));
  assert.ok(ui.includes("Сохранённая сводка"));
  const route = readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8");
  assert.ok(route.includes('dynamic(() => import("@/components/dashboard/legacy-dashboard")'));
  const before = await benchmarkRoute(execFileSync("git", ["show", "97360b8:app/api/dashboard/harvest-summary/route.ts"], { encoding: "utf8", windowsHide: true }));
  const after = await benchmarkRoute(api);
  assert.deepEqual(after.body, before.body, "same inputs produce the same canonical summary");
  assert.ok(after.ms < before.ms * 0.8, `parallel critical path must improve: ${before.ms} -> ${after.ms}`);
  console.log(JSON.stringify({ benchmark: "controlled fixed-latency route dependencies, not production latency", beforeMs: before.ms, afterMs: after.ms, responseParity: true }));
  console.log("PASS dashboard in-flight dedup, post-close fresh read, failure eviction, tenant/role/login cache isolation, TTL, bounded memory, auth-before-sharing, parallel data layers and lazy legacy bundle");
}
void main();
