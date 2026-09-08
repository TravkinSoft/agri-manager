import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  compareWarehouseDisplayOrder,
  moveWarehouseId,
  moveWarehouseIdByOffset,
  reconcileWarehouseOrder,
  withWarehouseDisplayOrder,
} from "../lib/warehouse/warehouse-order";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");
const page = read("app/(dashboard)/warehouses/page.tsx");
const route = read("app/api/warehouses/reorder/route.ts");
const listRoute = read("app/api/warehouses/route.ts");
const summariesRoute = read("app/api/warehouses/summaries/route.ts");
const service = read("lib/services/warehouses.ts");
const helpers = read("app/api/warehouses/_helpers.ts");
const types = read("lib/types/warehouse.ts");
const migration = read("supabase/migrations/20260908215514_warehouse_display_order_v1.sql");
const envExample = read(".env.example");

let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`PASS ${checks}: ${name}`);
}

check("display order sorts before the legacy fallback", () => {
  const rows = [
    { id: "b", name: "Б", display_order: 2 },
    { id: "a", name: "А", display_order: 1 },
  ];
  assert.deepEqual([...rows].sort(compareWarehouseDisplayOrder).map((row) => row.id), ["a", "b"]);
});
check("null order remains deterministic by name", () => {
  const rows = [
    { id: "b", name: "Б", display_order: null },
    { id: "a", name: "А", display_order: null },
  ];
  assert.deepEqual([...rows].sort(compareWarehouseDisplayOrder).map((row) => row.id), ["a", "b"]);
});
check("drag move is immutable", () => {
  const before = ["a", "b", "c"];
  assert.deepEqual(moveWarehouseId(before, "a", "c"), ["b", "c", "a"]);
  assert.deepEqual(before, ["a", "b", "c"]);
});
check("keyboard offset respects list boundaries", () => {
  assert.deepEqual(moveWarehouseIdByOffset(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveWarehouseIdByOffset(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
});
check("live list reconciliation drops archived ids and appends new active ids", () => {
  assert.deepEqual(reconcileWarehouseOrder(["b", "removed", "a"], ["a", "b", "new"]), ["b", "a", "new"]);
});
check("optimistic display order touches only requested active ids", () => {
  assert.deepEqual(withWarehouseDisplayOrder([
    { id: "a", display_order: null },
    { id: "archived", display_order: 7 },
  ], ["a"]), [
    { id: "a", display_order: 1 },
    { id: "archived", display_order: 7 },
  ]);
});

check("warehouse type and normalizer carry the nullable display order", () => {
  assert.match(types, /display_order\?: number \| null/);
  assert.match(helpers, /display_order: row\.display_order == null \? null : Number\(row\.display_order\)/);
});
check("legacy list and summary reads sort locally without selecting a required new column", () => {
  assert.match(listRoute, /\.select\("\*"\)[\s\S]*?\.sort\(compareWarehouseDisplayOrder\)/);
  assert.match(summariesRoute, /\.select\("\*"\)[\s\S]*?\.sort\(compareWarehouseDisplayOrder\)/);
  assert.doesNotMatch(listRoute, /\.order\("display_order"/);
  assert.doesNotMatch(summariesRoute, /\.order\("display_order"/);
});
check("UI is independently feature flagged and has an explicit mode", () => {
  assert.match(page, /NEXT_PUBLIC_UI_WAREHOUSE_V2/);
  assert.match(page, /"Изменить порядок"/);
  assert.match(page, /setIsReorderMode\(true\)/);
});
check("pointer and touch ordering requires a hold on a dedicated handle", () => {
  assert.match(page, /WAREHOUSE_REORDER_HOLD_MS = 180/);
  assert.match(page, /setPointerCapture\(event\.pointerId\)/);
  assert.match(page, /onPointerDown=\{\(event\) => beginPointerReorder/);
  assert.match(page, /h-11 w-11 touch-none cursor-grab/);
});
check("drag hit-testing reorders cards and has smooth reduced-motion-safe settle", () => {
  assert.match(page, /elementFromPoint\(event\.clientX, event\.clientY\)/);
  assert.match(page, /targetWarehouseId !== session\.lastTargetWarehouseId/);
  assert.match(page, /card\.animate\(/);
  assert.match(page, /prefers-reduced-motion: reduce/);
});
check("keyboard alternative exposes named up and down controls", () => {
  assert.match(page, /aria-label=\{`Переместить \$\{warehouse\.name\} вверх`\}/);
  assert.match(page, /aria-label=\{`Переместить \$\{warehouse\.name\} вниз`\}/);
  assert.match(page, /event\.key !== "ArrowUp" && event\.key !== "ArrowDown"/);
});
check("reorder mode is announced and excludes archived warehouses", () => {
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /Архивные склады не меняются/);
  assert.match(page, /const reorderable = isReorderMode && !isArchived\(warehouse\)/);
});
check("normal card opening remains available outside reorder mode", () => {
  assert.match(page, /if \(!reorderable\) openWarehouse\(warehouse\.id\)/);
  assert.match(page, /role=\{reorderable \? "listitem" : "button"\}/);
  assert.match(page, /tabIndex=\{reorderable \? undefined : 0\}/);
});
check("save is single-flight, optimistic, and rolls back order without losing refreshed data", () => {
  assert.match(page, /if \(!profile\?\.company_id \|\| reorderSavingRef\.current\) return/);
  assert.match(page, /setWarehouses\(nextWarehouses\)[\s\S]*?await reorderWarehouses/);
  assert.match(page, /catch \(cause\)[\s\S]*?setWarehouses\(\(current\) => withWarehouseDisplayOrder\(current, rollbackIds\)\)/);
  assert.match(page, /setWarehouseSummaryRows\(\(current\) =>/);
  assert.match(page, /const currentCache = warehousePageCache\.get\(cacheKey\)/);
  assert.match(page, /currentCache\.warehouses[\s\S]*?\? withWarehouseDisplayOrder/);
  assert.match(page, /Исходный порядок восстановлен/);
});
check("scope changes invalidate stale save responses", () => {
  assert.match(page, /reorderSaveGeneration\.current \+= 1/);
  assert.match(page, /reorderSaveGeneration\.current !== saveGeneration/);
});
check("client service sends one authenticated PATCH with the complete order", () => {
  assert.match(service, /export async function reorderWarehouses/);
  assert.match(service, /fetch\("\/api\/warehouses\/reorder"/);
  assert.match(service, /method: "PATCH"/);
  assert.match(service, /JSON\.stringify\(\{ companyId, warehouseIds \}\)/);
});

check("write API is independently disabled by default", () => {
  assert.match(route, /process\.env\.WAREHOUSE_ORDER_WRITE_V1 !== "1"/);
  assert.match(envExample, /WAREHOUSE_ORDER_WRITE_V1=0/);
  assert.match(envExample, /NEXT_PUBLIC_UI_WAREHOUSE_V2=0/);
});
check("write API resolves trusted actor and company scope", () => {
  assert.match(route, /getServerActorFromSession\(request\)/);
  assert.match(route, /resolveCompanyForActor\(actor, requestedCompanyId\)/);
});
check("write API authorizes only warehouse entity admins", () => {
  assert.match(route, /allowedRoles: \[\.\.\.WAREHOUSE_ENTITY_WRITE_ROLES\]/);
});
check("write API rejects malformed and duplicate ids before RPC", () => {
  assert.match(route, /UUID_PATTERN\.test\(warehouseId\)/);
  assert.match(route, /new Set\(warehouseIds\)\.size !== warehouseIds\.length/);
});
check("write API invokes one service-role atomic RPC", () => {
  assert.match(route, /getServiceClient\(\)/);
  assert.match(route, /\.rpc\("reorder_warehouses_atomic_v1"/);
  assert.doesNotMatch(route, /\.from\("warehouses"\)\.update/);
});
check("write API maps stale sets to a conflict response", () => {
  assert.match(route, /code === "40001"/);
  assert.match(route, /status.*409|, 409\)/);
});

check("migration is additive and nullable", () => {
  assert.match(migration, /add column if not exists display_order integer/);
  assert.doesNotMatch(migration, /display_order integer not null/);
  assert.match(migration, /display_order is null or display_order > 0/);
});
check("migration adds a company-scoped active-order index", () => {
  assert.match(migration, /on public\.warehouses\(company_id, display_order, name, id\)/);
  assert.match(migration, /where coalesce\(archived, false\) = false[\s\S]*?coalesce\(is_archived, false\) = false/);
});
check("RPC uses invoker security and an empty search path", () => {
  assert.match(migration, /reorder_warehouses_atomic_v1[\s\S]*?security invoker[\s\S]*?set search_path = ''/);
});
check("RPC is callable only by service role", () => {
  assert.match(migration, /revoke all on function public\.reorder_warehouses_atomic_v1\(uuid, uuid\[\]\)[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.reorder_warehouses_atomic_v1\(uuid, uuid\[\]\)[\s\S]*?to service_role/);
});
check("RPC validates a complete unique bounded active set", () => {
  assert.match(migration, /cardinality\(p_warehouse_ids\)/);
  assert.match(migration, /count\(distinct candidate\.warehouse_id\)/);
  assert.match(migration, /v_active_count <> v_requested_count/);
  assert.match(migration, /WAREHOUSE_ORDER_SCOPE_MISMATCH/);
});
check("RPC locks in stable order and updates in one statement", () => {
  assert.match(migration, /order by warehouse\.id[\s\S]*?for update/);
  assert.match(migration, /update public\.warehouses as warehouse[\s\S]*?unnest\(p_warehouse_ids\) with ordinality/);
});
check("RPC never changes archived warehouse order", () => {
  assert.match(migration, /update public\.warehouses as warehouse[\s\S]*?coalesce\(warehouse\.archived, false\) = false[\s\S]*?coalesce\(warehouse\.is_archived, false\) = false/);
});
check("future archive and restore cannot reuse a stale display position", () => {
  assert.match(migration, /clear_warehouse_display_order_on_archive_v1/);
  assert.match(migration, /new\.display_order := null/);
  assert.match(migration, /before update of archived, is_archived/);
});
check("RPC catches an active-set change before commit", () => {
  assert.match(migration, /Catch a concurrent insert[\s\S]*?v_active_count <> v_requested_count/);
  assert.match(migration, /raise exception 'WAREHOUSE_ORDER_CONFLICT' using errcode = '40001'/);
});

console.log(`TravkinFlow 2 warehouse ordering regression PASS: ${checks}/${checks}`);
