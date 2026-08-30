import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessPath } from "../lib/auth/role-access";
import { warehouseSchema } from "../lib/types/warehouse";
import {
  STORAGE_PLACE_TYPES,
  parseStoragePlaceType,
} from "../lib/warehouse/warehouse-scope";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const helpers = read("app/api/warehouses/_helpers.ts");
const warehousesRoute = read("app/api/warehouses/route.ts");
const warehouseRoute = read("app/api/warehouses/[id]/route.ts");
const warehouseAccess = read("lib/server/warehouse-access.ts");
const manageUi = read("app/(dashboard)/warehouses/manage/page.tsx");
const resourcesRoute = read("app/api/weighbridge/resources/route.ts");
const activeHarvestRoute = read("app/api/weighbridge/active-harvests/route.ts");
const ticketsRoute = read("app/api/weighbridge/tickets/route.ts");
const transferRoute = read("app/api/warehouses/[id]/transfers/route.ts");
const transactionsRoute = read("app/api/warehouses/transactions/route.ts");
const inventoriesRoute = read("app/api/warehouses/inventories/route.ts");
const operationsHealthRoute = read("app/api/operations-health/route.ts");
const accessMigration = read("supabase/migrations/20260829200243_warehouse_admin_server_only_dml_v1.sql");
const activeReferenceGuard = accessMigration.slice(
  accessMigration.indexOf("create or replace function public.guard_active_warehouse_reference_v1"),
  accessMigration.indexOf("revoke all on function public.guard_active_warehouse_reference_v1"),
);
const lifecycleGuard = accessMigration.slice(
  accessMigration.indexOf("create or replace function public.guard_warehouse_lifecycle_v1"),
  accessMigration.indexOf("revoke all on function public.guard_warehouse_lifecycle_v1"),
);

const postRoute = warehousesRoute.slice(warehousesRoute.indexOf("export async function POST"));
const patchRoute = warehouseRoute.slice(
  warehouseRoute.indexOf("export async function PATCH"),
  warehouseRoute.indexOf("export async function DELETE"),
);
const deleteRoute = warehouseRoute.slice(warehouseRoute.indexOf("export async function DELETE"));
const usageCheck = warehouseAccess.slice(
  warehouseAccess.indexOf("export async function getWarehouseUsageCheck"),
  warehouseAccess.indexOf("export async function getWarehouseArchiveCheck"),
);
const archiveCheck = warehouseAccess.slice(
  warehouseAccess.indexOf("export async function getWarehouseArchiveCheck"),
);
const archiveUi = manageUi.slice(
  manageUi.indexOf("const toggleArchiveWarehouse"),
  manageUi.indexOf("const handleHardDelete"),
);
const responsibleGuard = helpers.slice(
  helpers.indexOf("export async function isActiveResponsibleUserInCompany"),
  helpers.indexOf("export function warehouseVisibleToRole"),
);
const requestedWarehouseTypeBlock = patchRoute.slice(
  patchRoute.indexOf("const requestedWarehouseType"),
  patchRoute.indexOf("if (requestedPlaceType === \"WAREHOUSE\""),
);

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

function assertCompanyScopedMutation(source: string, label: string) {
  assert.match(source, /\.eq\("id", warehouseId\)/, `${label}: warehouse id filter is missing`);
  assert.match(source, /\.eq\("company_id", companyId\)/, `${label}: company filter is missing`);
}

function assertActiveWarehouseQuery(source: string, label: string) {
  const query = Array.from(source.matchAll(/\.from\("warehouses"\)[\s\S]{0,1000}/g), (match) => match[0])
    .find((candidate) => candidate.includes('.eq("archived", false)') && candidate.includes('.eq("is_archived", false)')) || "";
  assert.match(query, /\.eq\("company_id", (?:companyId|context\.companyId)\)/, `${label}: company scope is missing`);
  assert.match(query, /\.eq\("archived", false\)/, `${label}: archived=false is missing`);
  assert.match(query, /\.eq\("is_archived", false\)/, `${label}: is_archived=false is missing`);
}

check("physical place taxonomy is exactly four canonical values", () => {
  assert.deepEqual([...STORAGE_PLACE_TYPES], ["WAREHOUSE", "YARD", "DRYER", "CLEANER"]);
  assert.equal(parseStoragePlaceType(" dryer "), "DRYER");
  assert.equal(parseStoragePlaceType("unknown"), null);
});

check("warehouse form schema accepts every canonical place type and rejects unknown values", () => {
  for (const placeType of STORAGE_PLACE_TYPES) {
    assert.equal(
      warehouseSchema.safeParse({
        name: `Object ${placeType}`,
        place_type: placeType,
        warehouse_type: placeType === "WAREHOUSE" ? "universal" : undefined,
      }).success,
      true,
      placeType,
    );
  }
  assert.equal(warehouseSchema.safeParse({ name: "Bad", place_type: "SILO" }).success, false);
});

check("create API persists a parsed place type and returns 400 for unsupported values", () => {
  assert.match(postRoute, /parseStoragePlaceType\(body\.place_type \?\? body\.placeType \?\? "WAREHOUSE"\)/);
  assert.match(postRoute, /if \(!placeType\) \{[\s\S]{0,240}?status: 400/);
  assert.match(postRoute, /place_type:\s*placeType/);
});

check("update API returns 400 for unsupported physical types", () => {
  assert.match(patchRoute, /parseStoragePlaceType\(body\.place_type \?\? body\.placeType\)/);
  assert.match(patchRoute, /if \(!requestedPlaceType\) \{[\s\S]{0,240}?status: 400/);
});

check("warehouse entity mutations are restricted to company and global administrators", () => {
  const rolesBlock = helpers.match(/export const WAREHOUSE_ENTITY_WRITE_ROLES = \[([\s\S]*?)\] as const;/)?.[1] || "";
  const roles = Array.from(rolesBlock.matchAll(/"([^"]+)"/g), (match) => match[1]);
  assert.deepEqual(roles, ["company_admin", "global_admin"]);
  for (const source of [postRoute, patchRoute, deleteRoute]) {
    assert.match(source, /allowedRoles:\s*\[\.\.\.WAREHOUSE_ENTITY_WRITE_ROLES\]/);
    assert.match(
      source,
      /assertActorAccess\(\{[\s\S]{0,120}?supabase: writeSupabase/,
      "management ACL must resolve impersonated administrators server-side",
    );
  }
  assert.match(postRoute, /const writeSupabase = getServiceClient\(\)/);
  assert.match(patchRoute, /const writeSupabase = getServiceClient\(\)/);
  assert.match(deleteRoute, /const writeSupabase = getServiceClient\(\)/);
});

check("route access exposes management only to the two administrator roles", () => {
  assert.equal(canAccessPath("global_admin", "/warehouses/manage"), true);
  assert.equal(canAccessPath("company_admin", "/warehouses/manage"), true);
  for (const role of ["warehouse", "warehouse_operator", "weighman", "agronomist", "director"] as const) {
    assert.equal(canAccessPath(role, "/warehouses/manage"), false, role);
  }
});

check("create and row mutations resolve and retain the authenticated company scope", () => {
  assert.match(postRoute, /resolveCompanyForActor\(actor, requestedCompanyId\)/);
  assert.match(postRoute, /company_id:\s*companyId/);
  assert.match(helpers, /\.eq\("id", warehouseId\)[\s\S]{0,160}?\.eq\("company_id", companyId\)/);
  assertCompanyScopedMutation(patchRoute, "PATCH");
  assertCompanyScopedMutation(deleteRoute, "DELETE");
});

check("responsible user must be active and belong to the selected company on create and update", () => {
  assert.match(responsibleGuard, /\.from\("profiles"\)/);
  assert.match(responsibleGuard, /\.eq\("id", profileId\)/);
  assert.match(responsibleGuard, /\.eq\("company_id", companyId\)/);
  assert.match(responsibleGuard, /\.eq\("status", "active"\)/);
  assert.match(responsibleGuard, /if \(error\) throw new Error\(error\.message\)/);
  for (const [label, source] of [["POST", postRoute], ["PATCH", patchRoute]] as const) {
    assert.match(
      source,
      /isActiveResponsibleUserInCompany\(writeSupabase, companyId, responsibleUserId\)/,
      `${label}: active same-company responsible guard is missing`,
    );
    assert.match(
      source,
      /Ответственный пользователь недоступен в выбранной компании[\s\S]{0,100}?status: 400/,
      `${label}: invalid responsible user must return 400`,
    );
  }
});

check("warehouse subtype is whitelisted, preserves legacy ordinary edits and canonicalizes new or changed types", () => {
  for (const [label, source] of [["POST", postRoute], ["PATCH", patchRoute]] as const) {
    assert.match(
      source,
      /requestedPlaceType|placeType/,
      `${label}: physical type is missing`,
    );
    assert.match(
      source,
      /=== "WAREHOUSE" && !WAREHOUSE_TYPES\.has\(requestedWarehouseType\)[\s\S]{0,180}?status: 400/,
      `${label}: warehouse subtype whitelist guard is missing`,
    );
  }
  assert.match(postRoute, /const warehouseType = placeType === "WAREHOUSE" \? requestedWarehouseType : "universal"/);
  assert.match(
    requestedWarehouseTypeBlock,
    /requestedPlaceType === "WAREHOUSE"[\s\S]{0,180}?existingPlaceType === "WAREHOUSE"[\s\S]{0,80}?existingWarehouseType[\s\S]{0,80}?: "universal"/,
  );
  assert.match(
    requestedWarehouseTypeBlock,
    /: requestedPlaceType === existingPlaceType\s*\? existingWarehouseType\s*: "universal"/,
  );
});

check("changing a used physical type or warehouse subtype is rejected with 409", () => {
  assert.match(
    patchRoute,
    /const effectiveTypeChanged =[\s\S]{0,140}?requestedPlaceType !== existingPlaceType[\s\S]{0,220}?requestedPlaceType === "WAREHOUSE"[\s\S]{0,100}?existingPlaceType === "WAREHOUSE"[\s\S]{0,100}?requestedWarehouseType !== existingWarehouseType/,
  );
  assert.match(patchRoute, /if \(effectiveTypeChanged\) \{[\s\S]{0,180}?getWarehouseUsageCheck\(writeSupabase, companyId, warehouseId\)/);
  assert.match(patchRoute, /if \(usage\.isUsed\) \{[\s\S]{0,420}?status: 409/);
});

check("usage guard covers every historical warehouse reference class", () => {
  for (const table of [
    "tickets",
    "ticket_lines",
    "inventory_batches",
    "stock_ledger_entries",
    "inventory_transactions",
    "batch_transformation_inputs",
    "batch_transformation_outputs",
    "batch_transformations",
    "processing_documents",
    "processing_nodes",
    "warehouse_inventory_documents",
    "warehouse_issue_requests",
    "warehouse_issue_request_item_allocations",
    "warehouse_transfer_documents",
    "weighbridge_active_harvests",
    "field_material_consumptions",
  ]) {
    assert.match(usageCheck, new RegExp(`\\.from\\("${table}"\\)`), table);
  }
});

check("dependency and balance failures are fail-closed", () => {
  assert.match(warehouseAccess, /if \(error\) \{[\s\S]{0,160}?throw new Error\(`Warehouse dependency check failed/);
  assert.doesNotMatch(warehouseAccess, /if \(error\) \{\s*return 0;\s*\}/);
  assert.match(warehouseAccess, /if \(rowsResult\.error \|\| quantityResult\.error\) \{[\s\S]{0,220}?throw new Error/);
  assert.match(archiveCheck, /if \(allocationResult\.error\) \{[\s\S]{0,180}?throw new Error/);
});

check("archive guard uses canonical stock and only active operational blockers", () => {
  assert.match(archiveCheck, /const balance = await getStockBalance\(supabase, companyId, warehouseId\)/);
  assert.match(warehouseAccess, /\.from\("v_stock_balance_canonical"\)/);
  for (const table of [
    "tickets",
    "weighbridge_active_harvests",
    "batch_transformations",
    "processing_documents",
    "inventory_transactions",
    "warehouse_inventory_documents",
    "warehouse_issue_requests",
    "warehouse_issue_request_item_allocations",
  ]) {
    assert.match(archiveCheck, new RegExp(`\\.from\\("${table}"\\)`), table);
  }
  assert.doesNotMatch(archiveCheck, /\.from\("inventory_batches"\)/);
  assert.doesNotMatch(archiveCheck, /\.from\("processing_nodes"\)/);
  for (const stat of [
    "stockBalanceQty",
    "openTickets",
    "activeHarvests",
    "activeTransformations",
    "activeProcessingDocuments",
    "draftInventoryTransactions",
    "activeInventoryDocuments",
    "activeIssueRequests",
    "outstandingIssueAllocations",
  ]) {
    assert.match(archiveCheck, new RegExp(`\\b${stat}\\b`), stat);
  }
  assert.match(archiveCheck, /return \{ canArchive: reasons\.length === 0, reasons, stats \}/);
});

check("both PATCH archive and DELETE archive reject blocked objects with 409", () => {
  assert.match(patchRoute, /getWarehouseArchiveCheck\(writeSupabase, companyId, warehouseId\)/);
  assert.match(patchRoute, /if \(!archiveCheck\.canArchive\) \{[\s\S]{0,420}?status: 409/);
  assert.match(deleteRoute, /getWarehouseArchiveCheck\(writeSupabase, companyId, warehouseId\)/);
  assert.match(deleteRoute, /if \(!archiveCheck\.canArchive\) \{[\s\S]{0,420}?status: 409/);
});

check("archive and restore synchronize both legacy archive flags", () => {
  assert.match(patchRoute, /payload\.is_archived = isArchived;[\s\S]{0,80}?payload\.archived = isArchived;/);
  assert.match(deleteRoute, /is_archived:\s*true,[\s\S]{0,80}?archived:\s*true/);
});

check("management UI has a physical-type selector with all four choices", () => {
  assert.match(manageUi, /name="place_type"/);
  assert.match(manageUi, /(?:STORAGE_PLACE_TYPES|STORAGE_PLACE_TYPE_OPTIONS)/);
  for (const label of ["Склад", "Площадка", "Сушилка", "Очистка"]) {
    assert.match(manageUi, new RegExp(label), label);
  }
});

check("warehouse subtype is conditional while capacity remains available to every object type", () => {
  assert.match(manageUi, /selectedPlaceType === "WAREHOUSE"[\s\S]{0,6500}?name="warehouse_type"/);
  assert.match(manageUi, /name="capacity_unit"/);
  assert.match(manageUi, /name="capacity_value"/);
  assert.match(manageUi, /data\.place_type === "WAREHOUSE" \? data\.warehouse_type \|\| "universal" : "universal"/);
});

check("non-admin UI is actionless and archive requires explicit confirmation", () => {
  assert.match(manageUi, /if \(!canManageWarehouses\) \{/);
  assert.match(archiveUi, /const confirmed = window\.confirm\(/);
  assert.match(archiveUi, /if \(!confirmed\) return;/);
  assert.ok(archiveUi.indexOf("window.confirm") < archiveUi.indexOf("archiveWarehouse("));
});

check("successful create, edit and archive paths refresh the table", () => {
  const saveUi = manageUi.slice(manageUi.indexOf("const handleWarehouseSubmit"), manageUi.indexOf("const handleProductSubmit"));
  assert.match(saveUi, /await createWarehouse\(/);
  assert.match(saveUi, /await updateWarehouse\(/);
  assert.match(saveUi, /await loadData\(\)/);
  assert.match(archiveUi, /await archiveWarehouse\(/);
  assert.match(archiveUi, /await loadData\(\)/);
});

check("warehouse list excludes either archived flag unless explicitly requested", () => {
  assert.match(
    warehousesRoute,
    /if \(!includeArchived\) \{[\s\S]{0,180}?\.eq\("archived", false\)\.eq\("is_archived", false\)/,
  );
});

check("weighbridge resource and active-harvest destination queries exclude both archive flags", () => {
  assertActiveWarehouseQuery(resourcesRoute, "resources");
  assertActiveWarehouseQuery(activeHarvestRoute, "active harvest");
});

check("ticket destination validation rejects either archive flag", () => {
  assert.match(ticketsRoute, /destinationWarehouse\.archived[\s\S]{0,100}?destinationWarehouse\.is_archived/);
  assert.match(ticketsRoute, /destination\.archived \|\| destination\.is_archived/);
});

check("all new warehouse operations reject either archive flag", () => {
  assert.match(transferRoute, /existing\.archived === true \|\| existing\.is_archived === true/);
  assertActiveWarehouseQuery(transactionsRoute, "warehouse transaction");
  assertActiveWarehouseQuery(inventoriesRoute, "warehouse inventory");
  assertActiveWarehouseQuery(operationsHealthRoute, "operations health");
});

check("API DTO normalizes place_type instead of leaking invalid stored values", () => {
  assert.match(helpers, /place_type:\s*normalizeStoragePlaceType\(row\.place_type\)/);
});

check("profile writes are revoked except own language and direct warehouse DML is closed", () => {
  assert.match(
    accessMigration,
    /revoke insert, update, delete, truncate[\s\S]{0,80}?on table public\.profiles[\s\S]{0,80}?from anon, authenticated/,
  );
  assert.match(
    accessMigration,
    /grant update \(preferred_language\)[\s\S]{0,80}?on table public\.profiles[\s\S]{0,80}?to authenticated/,
  );
  assert.match(
    accessMigration,
    /drop policy if exists "Users can update own language"[\s\S]{0,80}?on public\.profiles;[\s\S]{0,80}?create policy "Users can update own language"/,
  );
  assert.match(
    accessMigration,
    /create policy "Users can update own language"[\s\S]{0,120}?on public\.profiles[\s\S]{0,80}?for update[\s\S]{0,80}?to authenticated[\s\S]{0,80}?using \(auth\.uid\(\) = id\)[\s\S]{0,80}?with check \(auth\.uid\(\) = id\)/,
  );
  assert.doesNotMatch(accessMigration, /guard_profile_acl_self_update|profiles_acl_self_update_guard/);
  assert.match(accessMigration, /revoke insert, update, delete, truncate[\s\S]{0,100}?public\.warehouses[\s\S]{0,80}?anon, authenticated/);
  assert.doesNotMatch(accessMigration, /security\s+definer/i);
});

check("shared company advisory lock serializes child references with exclusive lifecycle changes", () => {
  const childLock = "perform pg_advisory_xact_lock_shared(";
  const lifecycleLock = "perform pg_advisory_xact_lock(";
  assert.match(
    activeReferenceGuard,
    /perform pg_advisory_xact_lock_shared\([\s\S]{0,80}?hashtextextended\('warehouse-company:' \|\| v_company_id::text, 0\)[\s\S]{0,20}?\);/,
  );
  assert.match(
    lifecycleGuard,
    /perform pg_advisory_xact_lock\([\s\S]{0,80}?hashtextextended\('warehouse-company:' \|\| new\.company_id::text, 0\)[\s\S]{0,20}?\);/,
  );
  assert.doesNotMatch(lifecycleGuard, /pg_advisory_xact_lock_shared/);
  assert.ok(
    lifecycleGuard.indexOf(lifecycleLock) < lifecycleGuard.indexOf("if v_type_changed and ("),
    "lifecycle lock must be acquired before type-use preflight",
  );
  assert.ok(
    activeReferenceGuard.indexOf(childLock) < activeReferenceGuard.indexOf("foreach v_column in array tg_argv loop"),
    "shared company lock must be acquired before processing child references",
  );
  assert.match(
    activeReferenceGuard,
    /if tg_op = 'UPDATE'[\s\S]{0,120}?to_jsonb\(new\) ->> v_column\) is not distinct from \(to_jsonb\(old\) ->> v_column\)[\s\S]{0,80}?continue;/,
  );
  assert.ok(
    activeReferenceGuard.indexOf("if tg_op = 'UPDATE'") <
      activeReferenceGuard.indexOf("v_warehouse_id := nullif(to_jsonb(new) ->> v_column"),
    "unchanged UPDATE references must be skipped before warehouse id collection",
  );
  assert.match(activeReferenceGuard, /where w\.id = v_warehouse_id[\s\S]{0,100}?and w\.company_id = v_company_id/);
  assert.match(activeReferenceGuard, /if not found then[\s\S]{0,180}?using errcode = '23503'/);
  assert.match(activeReferenceGuard, /if v_archived or v_is_archived then[\s\S]{0,180}?using errcode = '23514'/);

  const referenceColumns: Record<string, string[]> = {
    tickets: ["warehouse_from_id", "warehouse_to_id"],
    ticket_lines: ["warehouse_from_id", "warehouse_to_id"],
    inventory_batches: ["warehouse_id"],
    stock_ledger_entries: ["warehouse_id"],
    inventory_transactions: ["warehouse_id", "source_warehouse_id", "destination_warehouse_id"],
    batch_transformation_inputs: ["warehouse_from_id", "node_warehouse_id"],
    batch_transformation_outputs: ["warehouse_to_id"],
    batch_transformations: ["node_warehouse_id"],
    processing_documents: ["source_warehouse_id", "destination_warehouse_id"],
    processing_nodes: ["linked_warehouse_id"],
    warehouse_inventory_documents: ["warehouse_id"],
    warehouse_issue_requests: ["source_warehouse_id"],
    warehouse_issue_request_item_allocations: ["warehouse_id"],
    warehouse_transfer_documents: ["source_warehouse_id", "destination_warehouse_id"],
    weighbridge_active_harvests: ["warehouse_id"],
    field_material_consumptions: ["warehouse_id"],
  };
  const guardedTables = Array.from(
    accessMigration.matchAll(
      /on public\.([a-z_]+) for each row execute function public\.guard_active_warehouse_reference_v1\(/g,
    ),
    (match) => match[1],
  ).sort();
  assert.deepEqual(guardedTables, Object.keys(referenceColumns).sort());
  for (const [table, columns] of Object.entries(referenceColumns)) {
    const columnList = columns.join(", ");
    const argumentList = columns.map((column) => `'${column}'`).join(", ");
    assert.match(
      accessMigration,
      new RegExp(
        `create trigger [a-z0-9_]+ before insert or update of ${columnList}\\s+` +
          `on public\\.${table} for each row execute function public\\.guard_active_warehouse_reference_v1\\(${argumentList}\\);`,
      ),
      table,
    );
  }
});

check("database lifecycle trigger atomically guards used type changes and archive blockers", () => {
  assert.match(accessMigration, /create or replace function public\.guard_warehouse_lifecycle_v1\(\)[\s\S]{0,120}?returns trigger[\s\S]{0,80}?language plpgsql/);
  assert.match(accessMigration, /set search_path = public, pg_temp/);
  assert.match(
    accessMigration,
    /v_type_changed :=[\s\S]{0,160}?new\.place_type is distinct from old\.place_type[\s\S]{0,240}?new\.warehouse_type is distinct from old\.warehouse_type/,
  );
  for (const table of [
    "tickets",
    "ticket_lines",
    "inventory_batches",
    "stock_ledger_entries",
    "inventory_transactions",
    "batch_transformation_inputs",
    "batch_transformation_outputs",
    "batch_transformations",
    "processing_documents",
    "processing_nodes",
    "warehouse_inventory_documents",
    "warehouse_issue_requests",
    "warehouse_issue_request_item_allocations",
    "warehouse_transfer_documents",
    "weighbridge_active_harvests",
    "field_material_consumptions",
  ]) {
    assert.match(accessMigration, new RegExp(`from public\\.${table}\\b`), table);
  }
  assert.match(accessMigration, /if v_type_changed and \([\s\S]{0,6000}?using errcode = '23514';/);
  assert.match(
    lifecycleGuard,
    /v_archive_started :=[\s\S]{0,180}?new\.archived[\s\S]{0,180}?old\.archived[\s\S]{0,120}?;/,
  );
  assert.match(lifecycleGuard, /if v_archive_started then/);
  for (const blocker of [
    "ненулевой остаток",
    "есть открытые талоны",
    "активная приёмка",
    "незавершённая обработка",
    "незавершённая операция или перемещение",
  ]) {
    assert.match(accessMigration, new RegExp(`${blocker}' using errcode = '23514'`), blocker);
  }
  assert.match(
    accessMigration,
    /create trigger warehouses_lifecycle_guard_v1[\s\S]{0,100}?before update of place_type, warehouse_type, archived, is_archived[\s\S]{0,100}?on public\.warehouses[\s\S]{0,80}?for each row[\s\S]{0,100}?execute function public\.guard_warehouse_lifecycle_v1\(\)/,
  );
});

assert.equal(passed, 27);
console.log(`WAREHOUSE OBJECT ADMIN REGRESSION PASS: ${passed}/27`);
