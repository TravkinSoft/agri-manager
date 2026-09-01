import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stockRoute = read("app/api/weighbridge/stock-identities/route.ts");
const weighbridge = read("app/(dashboard)/weighbridge/page.tsx");
const warehouses = read("app/(dashboard)/warehouses/page.tsx");
const legacyBatchTraceMigration = read("supabase/migrations/20260901121152_tz315_legacy_batch_ledger_warehouse_trace_v1.sql");
const legacyBatchVoidMigration = read("supabase/migrations/20260901121718_tz315_legacy_batch_void_warehouse_trace_v1.sql");

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

check("S19 authorizes company stock before catalog hydration", () => {
  const authIndex = stockRoute.indexOf("resolveWeighbridgeSession(request");
  const stockIndex = stockRoute.indexOf('from("v_effective_stock_balance_identity_v1")');
  const catalogIndex = stockRoute.indexOf('supabase.from("products")', stockIndex);
  assert(authIndex >= 0 && stockIndex > authIndex && catalogIndex > stockIndex);
});

check("S19 hydrates only authorized stock reference IDs through the authenticated client", () => {
  assert.match(stockRoute, /supabase\.from\("products"\)[\s\S]*?\.in\("id", productIds\)/);
  assert.match(stockRoute, /supabase\.from\("crops"\)[\s\S]*?\.in\("id", cropLookupIds\)/);
  assert.match(stockRoute, /supabase\.from\("varieties"\)[\s\S]*?\.in\("id", varietyIds\)/);
  assert.match(stockRoute, /supabase\.from\("seed_reproductions"\)[\s\S]*?\.in\("id", reproductionIds\)/);
  assert.doesNotMatch(stockRoute, /getServiceClient|referenceSupabase/);
  assert.doesNotMatch(stockRoute, /\.from\("(?:products|crops|varieties|seed_reproductions)"\)\.select\([^\n]*full_name/);
  assert.match(stockRoute, /Stock reference hydration failed/);
});

check("S19 accepts only a proven legacy batch warehouse trace without backfill", () => {
  assert.match(legacyBatchTraceMigration, /v_batch\.warehouse_id is null/);
  assert.match(legacyBatchTraceMigration, /from public\.stock_ledger_entries trace/);
  assert.match(legacyBatchTraceMigration, /trace\.company_id = new\.company_id/);
  assert.match(legacyBatchTraceMigration, /trace\.product_id = new\.product_id/);
  assert.match(legacyBatchTraceMigration, /trace\.warehouse_id = new\.warehouse_id/);
  assert.match(legacyBatchTraceMigration, /trace\.batch_id_text = v_batch\.id::text/);
  assert.match(legacyBatchTraceMigration, /Legacy inventory batch has no ledger trace for the requested warehouse/);
  assert.doesNotMatch(legacyBatchTraceMigration, /update\s+public\.inventory_batches|delete\s+from|insert\s+into/i);
});

check("S19 storno recognises only the immutable legacy source receipt trace", () => {
  assert.match(legacyBatchVoidMigration, /void_ticket_with_storno_v2/);
  assert.match(legacyBatchVoidMigration, /legacy_trace\.ticket_id = b\.source_ticket_id/);
  assert.match(legacyBatchVoidMigration, /legacy_trace\.warehouse_id = sle\.warehouse_id/);
  assert.match(legacyBatchVoidMigration, /legacy_trace\.warehouse_id = base\.warehouse_id/);
  assert.match(legacyBatchVoidMigration, /legacy_trace\.delta_qty_signed > 0/);
  assert.match(legacyBatchVoidMigration, /TZ315_LEGACY_BATCH_VOID_WAREHOUSE_TRACE_V1/);
  assert.doesNotMatch(legacyBatchVoidMigration, /update\s+public\.(?:inventory_batches|tickets)|delete\s+from|insert\s+into/i);
});

check("S20 impurity source list is independent from harvest field allocation", () => {
  const block = weighbridge.match(/const impuritySourceWarehouses = useMemo\([\s\S]*?\n  \);/)?.[0] || "";
  assert.match(block, /isHarvestDestinationPlace/);
  assert.match(block, /\[warehouses\]/);
  assert.doesNotMatch(block, /selectedHarvestAllocation|canUseGrainProcessing/);
});

check("S20 uses a controlled searchable source picker and preserves selected warehouse", () => {
  const block = weighbridge.match(/\{isImpurityRemoval \? \([\s\S]*?ariaLabel="Склад-источник примесей"[\s\S]*?\) : \(/)?.[0] || "";
  assert.match(block, /<SearchableCombobox/);
  assert.match(block, /value=\{form\.warehouseFromId\}/);
  assert.match(block, /warehouseFromId,/);
  assert.match(block, /sourceBatchId: ""/);
});

check("S23 global-admin fallback refreshes summaries without refetching the warehouse catalog", () => {
  assert.match(warehouses, /globalAdminConsistencyPoll = profile\?\.role === "global_admin" && event\?\.source === "interval"/);
  assert.match(warehouses, /summariesOnly: globalAdminConsistencyPoll/);
  assert.match(warehouses, /intervalMs: profile\?\.role === "global_admin" \? 8_000 : 60_000/);
  const loadBlock = warehouses.match(/const loadWarehouseList = async \(\{[\s\S]*?\n  \};/)?.[0] || "";
  assert.match(loadBlock, /if \(!summariesOnly\) \{[\s\S]*?getWarehouses/);
  assert.match(loadBlock, /getWarehouseSummaries/);
});

check("corrective scope contains no crop-structure or hard-delete writes", () => {
  const joined = [stockRoute, weighbridge, warehouses].join("\n");
  assert.doesNotMatch(joined, /from\(["'](?:crop_structure_allocations|fields|seasons|crops|varieties|seed_reproductions)["']\)[\s\S]{0,120}\.(?:insert|update|delete)\(/i);
  assert.doesNotMatch(joined, /\bdelete\s+from\b/i);
});

console.log(`TZ315 S19/S20/S23 corrective ${passed}/${passed} PASS`);
