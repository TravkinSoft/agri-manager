import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { rowHasQaDataMarker } from "../lib/utils/qa-data";
import {
  WAREHOUSE_ORDER_MAX_ITEMS,
  compareWarehouseDisplayOrder,
  mergeVisibleWarehouseOrder,
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
const localRequire = createRequire(import.meta.url);

let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`PASS ${checks}: ${name}`);
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  checks += 1;
  console.log(`PASS ${checks}: ${name}`);
}

function loadCommonJs(source: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} as Record<string, any> };
  vm.runInNewContext(output, {
    exports: loaded.exports,
    module: loaded,
    process: { env: { WAREHOUSE_ORDER_WRITE_V1: "1" } },
    require: (name: string) => dependencies[name] ?? localRequire(name),
  });
  return loaded.exports;
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
check("server expands a visible reorder without moving hidden QA warehouses", () => {
  assert.deepEqual(
    mergeVisibleWarehouseOrder(
      ["visible-a", "qa-hidden-a", "visible-b", "qa-hidden-b"],
      ["visible-a", "visible-b"],
      ["visible-b", "visible-a"],
    ),
    ["visible-b", "qa-hidden-a", "visible-a", "qa-hidden-b"],
  );
});
check("server rejects a stale or out-of-scope visible reorder", () => {
  assert.equal(
    mergeVisibleWarehouseOrder(
      ["visible-a", "qa-hidden", "visible-b"],
      ["visible-a", "visible-b"],
      ["visible-a"],
    ),
    null,
  );
  assert.equal(
    mergeVisibleWarehouseOrder(
      ["visible-a", "qa-hidden", "visible-b"],
      ["visible-a", "visible-b"],
      ["visible-a", "other-company"],
    ),
    null,
  );
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
check("client service sends one authenticated PATCH with the complete visible order", () => {
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
check("write API expands the exact visible company set with hidden QA rows before RPC", () => {
  assert.match(route, /\.from\("warehouses"\)[\s\S]*?\.eq\("company_id", companyId\)/);
  assert.match(route, /!warehouse\.archived && !warehouse\.is_archived/);
  assert.match(route, /rowHasQaDataMarker\([\s\S]*?\["name", "description", "warehouse_type"\]/);
  assert.match(route, /mergeVisibleWarehouseOrder\([\s\S]*?activeWarehouses\.map/);
  assert.match(route, /if \(!completeWarehouseIds[\s\S]*?, 409\)/);
});
check("write API rejects malformed and duplicate ids before RPC", () => {
  assert.match(route, /UUID_PATTERN\.test\(warehouseId\)/);
  assert.match(route, /new Set\(warehouseIds\)\.size !== warehouseIds\.length/);
});
check("write API invokes one service-role atomic RPC", () => {
  assert.match(route, /getServiceClient\(\)/);
  assert.match(route, /\.rpc\("reorder_warehouses_atomic_v1"/);
  assert.match(route, /p_warehouse_ids: completeWarehouseIds/);
  assert.doesNotMatch(route, /\.from\("warehouses"\)\.update/);
});
check("write API never exposes hidden warehouse ids in its response", () => {
  assert.match(route, /visibleWarehouseIdSet\.has/);
  assert.match(route, /warehouses: visibleResultWarehouses/);
});
check("write API maps stale sets to a conflict response", () => {
  assert.match(route, /code === "40001"/);
  assert.match(route, /status.*409|, 409\)/);
});

async function runRouteIntegration() {
  await checkAsync("PATCH expands hidden QA rows atomically and sanitizes its response", async () => {
  const companyId = "10000000-0000-4000-8000-000000000001";
  const foreignCompanyId = "10000000-0000-4000-8000-000000000002";
  const visibleA = "20000000-0000-4000-8000-000000000001";
  const hiddenByName = "20000000-0000-4000-8000-000000000002";
  const visibleB = "20000000-0000-4000-8000-000000000003";
  const hiddenByDescription = "20000000-0000-4000-8000-000000000004";
  const hiddenByType = "20000000-0000-4000-8000-000000000005";
  const archivedQa = "20000000-0000-4000-8000-000000000006";
  const foreignWarehouse = "20000000-0000-4000-8000-000000000007";
  const rows = [
    { id: visibleA, company_id: companyId, name: "А", display_order: 1, archived: false, is_archived: false },
    { id: hiddenByName, company_id: companyId, name: "QA_TEST_2026", display_order: 2, archived: false, is_archived: false },
    { id: visibleB, company_id: companyId, name: "Б", display_order: 3, archived: false, is_archived: false },
    { id: hiddenByDescription, company_id: companyId, name: "В", description: "qacodex", display_order: 4, archived: false, is_archived: false },
    { id: hiddenByType, company_id: companyId, name: "Г", warehouse_type: "E2E_TZ_999", display_order: 5, archived: false, is_archived: false },
    { id: archivedQa, company_id: companyId, name: "QA_TEST archived", display_order: 6, archived: true, is_archived: true },
    { id: foreignWarehouse, company_id: foreignCompanyId, name: "Чужой", display_order: 1, archived: false, is_archived: false },
  ];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let accessChecks = 0;
  const serviceClient = {
    from(table: string) {
      assert.equal(table, "warehouses");
      const filters: Array<(row: typeof rows[number]) => boolean> = [];
      const query: any = {
        select: () => query,
        eq: (column: keyof typeof rows[number], value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({
          data: rows.filter((row) => filters.every((filter) => filter(row))),
          error: null,
        }).then(resolve, reject),
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      const ids = args.p_warehouse_ids as string[];
      return {
        data: {
          companyId,
          updatedCount: ids.length,
          warehouses: ids.map((id, index) => ({ id, displayOrder: index + 1 })),
        },
        error: null,
      };
    },
  };
  class SessionAuthError extends Error {
    status = 401;
  }
  const api = loadCommonJs(route, {
    "next/server": {
      NextResponse: {
        json: (body: unknown, init: { status?: number } = {}) => ({ body, status: init.status || 200 }),
      },
    },
    "@/app/api/warehouses/_helpers": {
      WAREHOUSE_ENTITY_WRITE_ROLES: ["company_admin", "global_admin"],
      normalizeWarehouseRow: (row: typeof rows[number]) => ({
        ...row,
        id: String(row.id),
        name: String(row.name || "Склад"),
        warehouse_type: row.warehouse_type ?? null,
        description: row.description ?? null,
        display_order: row.display_order ?? null,
        archived: row.archived === true,
        is_archived: row.is_archived === true,
      }),
      warehouseVisibleToRole: () => true,
    },
    "@/lib/auth/server-acl": {
      assertActorAccess: async () => { accessChecks += 1; },
    },
    "@/lib/auth/server-session": {
      SessionAuthError,
      getServerActorFromSession: async () => ({ id: "actor", role: "company_admin" }),
      resolveCompanyForActor: (_actor: unknown, requestedCompanyId: string | null) => requestedCompanyId || companyId,
    },
    "@/lib/supabase/service": { getServiceClient: () => serviceClient },
    "@/lib/utils/qa-data": { rowHasQaDataMarker },
    "@/lib/warehouse/warehouse-order": {
      WAREHOUSE_ORDER_MAX_ITEMS,
      compareWarehouseDisplayOrder,
      mergeVisibleWarehouseOrder,
    },
  });

  const success = await api.PATCH({
    json: async () => ({ companyId, warehouseIds: [visibleB, visibleA] }),
  });
  assert.equal(success.status, 200);
  assert.equal(accessChecks, 1);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "reorder_warehouses_atomic_v1");
  assert.deepEqual(
    JSON.parse(JSON.stringify(rpcCalls[0].args.p_warehouse_ids)),
    [visibleB, hiddenByName, visibleA, hiddenByDescription, hiddenByType],
  );
  const successBody = JSON.parse(JSON.stringify(success.body));
  assert.deepEqual(
    successBody.result.warehouses.map((warehouse: { id: string }) => warehouse.id),
    [visibleB, visibleA],
  );
  assert.equal(JSON.stringify(successBody).includes(hiddenByName), false);
  assert.equal(JSON.stringify(successBody).includes(hiddenByDescription), false);
  assert.equal(JSON.stringify(successBody).includes(hiddenByType), false);
  assert.equal(JSON.stringify(rpcCalls[0].args).includes(archivedQa), false);
  assert.equal(JSON.stringify(rpcCalls[0].args).includes(foreignWarehouse), false);

  const stale = await api.PATCH({
    json: async () => ({ companyId, warehouseIds: [visibleA] }),
  });
  assert.equal(stale.status, 409);
  assert.equal(rpcCalls.length, 1);
  });
}

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

void runRouteIntegration()
  .then(() => console.log(`TravkinFlow 2 warehouse ordering regression PASS: ${checks}/${checks}`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
