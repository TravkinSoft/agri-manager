import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const checks: string[] = [];
const check = (name: string, run: () => void) => {
  run();
  checks.push(name);
};

const migration = read("supabase/migrations/20260815093215_tz271_restore_weighbridge_unit_contract_columns.sql");
const auth = read("app/api/weighbridge/_auth.ts");
const finalizeRoute = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const ticketService = read("lib/services/weighbridge.ts");
const warehousesPage = read("app/(dashboard)/warehouses/page.tsx");
const weighbridgePage = read("app/(dashboard)/weighbridge/page.tsx");
const liveRefresh = read("hooks/use-live-refresh.ts");
const sidebar = read("components/layout/sidebar.tsx");

check("migration is additive and idempotent", () => {
  assert.doesNotMatch(migration, /\b(drop|truncate|delete|update)\b/i);
  assert.match(migration, /add column if not exists mass_kg numeric\(18,6\)/i);
});

for (const table of [
  "products",
  "inventory_transactions",
  "stock_ledger_entries",
  "ticket_lines",
  "inventory_batches",
  "field_material_consumptions",
]) {
  check(`migration repairs ${table}`, () => {
    assert.match(migration, new RegExp(`alter table public\\.${table}`));
  });
}

check("finalize hides schema internals", () => {
  assert.match(auth, /Не удалось завершить талон\. Данные не были записаны/);
  assert.match(finalizeRoute, /weighbridgeUnexpectedUserError\(\)/);
});

check("warehouse cache ends the blocking loader", () => {
  assert.match(warehousesPage, /setLoading\(!cached\)/);
  assert.match(warehousesPage, /warehouseSummaryRequestCache/);
});

check("workspace ticket endpoint limits journal", () => {
  assert.match(ticketRoute, /workspace.*=== "true"/);
  assert.match(ticketRoute, /\.in\("status", \["finalized", "voided"\]\)[\s\S]*?\.limit\(20\)/);
  assert.match(ticketService, /options\?\.workspace/);
});

check("weighbridge restores cache before background reconciliation", () => {
  assert.match(weighbridgePage, /if \(cached\) \{[\s\S]*?setLoading\(false\)/);
  assert.match(weighbridgePage, /if \(cached\) \{[\s\S]*?setTimeout\([\s\S]*?refreshTickets\(\)[\s\S]*?refreshBootstrap\(\)[\s\S]*?verifyOperatorSession\(\)[\s\S]*?750/);
});

check("focus refreshes are throttled without delaying realtime", () => {
  assert.match(liveRefresh, /event\?\.source !== "realtime"/);
  assert.match(weighbridgePage, /minRefreshIntervalMs: 5_000/);
  assert.match(warehousesPage, /minRefreshIntervalMs: 5_000/);
});

check("default workspace does not fetch all harvest batches", () => {
  assert.match(weighbridgePage, /form\.operationType !== "impurity_removal"/);
  assert.doesNotMatch(weighbridgePage, /const \[rows, batchRows\] = await Promise\.all/);
});

check("critical weighbridge routes are explicitly prefetched", () => {
  assert.match(
    sidebar,
    /prefetch=\{\["\/weighbridge", "\/warehouses", "\/ledger"\]\.includes\(item\.href\) \? true : undefined\}/,
  );
});

console.log(JSON.stringify({ status: "PASS", checks: checks.length, details: checks }, null, 2));
