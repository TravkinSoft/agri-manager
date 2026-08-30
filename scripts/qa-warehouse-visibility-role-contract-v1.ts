import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const warehouseHelpers = source("app/api/warehouses/_helpers.ts");
const warehouseRoute = source("app/api/warehouses/route.ts");
const balancesRoute = source("app/api/warehouses/balances/route.ts");
const transactionsRoute = source("app/api/warehouses/transactions/route.ts");
const receiptRoute = source("app/api/warehouses/receipts/route.ts");
const transferRoute = source("app/api/warehouses/[id]/transfers/route.ts");
const inventoryActionRoute = source("app/api/warehouses/inventories/[id]/route.ts");
const weighbridgeAuth = source("app/api/weighbridge/_auth.ts");
const weighbridgeAdminAction = source("app/api/weighbridge/tickets/[id]/admin-action/route.ts");
const warehousesPage = source("app/(dashboard)/warehouses/page.tsx");

assert.match(warehouseHelpers, /export function warehouseVisibleToRole[\s\S]*return true;/);
assert.match(warehouseRoute, /\.from\("warehouses"\)[\s\S]*\.eq\("company_id", companyId\)/);
assert.doesNotMatch(balancesRoute, /actor\.role !== "warehouse"/);
assert.doesNotMatch(balancesRoute, /if \(!product \|\| !isAgrochemicalProductType/);
assert.doesNotMatch(transactionsRoute, /const visibleRows/);

assert.match(
  transferRoute,
  /const MANUAL_TRANSFER_ROLES = \["global_admin", "warehouse", "warehouse_operator"\]/
);
assert.doesNotMatch(transferRoute, /MANUAL_TRANSFER_ROLES = \[[^\]]*"company_admin"/);
assert.doesNotMatch(transferRoute, /MANUAL_TRANSFER_ROLES = \[[^\]]*"weighman"/);
assert.match(transferRoute, /Складовщик может перемещать только агрохимию/);
assert.match(receiptRoute, /Обычный складской приход принимает только пестициды, удобрения и добавки/);
assert.match(inventoryActionRoute, /Текущая роль не может выполнить это действие инвентаризации/);

const writeRoles = weighbridgeAuth.match(/export const WEIGHBRIDGE_WRITE_ROLES = \[([\s\S]*?)\] as const;/)?.[1] || "";
assert.match(writeRoles, /"weighman"/);
assert.match(writeRoles, /"global_admin"/);
assert.match(writeRoles, /"company_admin"/);
assert.doesNotMatch(writeRoles, /"warehouse"|"warehouse_operator"/);
assert.match(weighbridgeAdminAction, /allowedRoles: \["global_admin"\]/);

assert.doesNotMatch(warehousesPage, /HarvestWarehousesReadonly/);
assert.match(warehousesPage, /listHarvestBatchSummaries/);
assert.match(warehousesPage, /getWarehouses\(profile\.company_id, canManageWarehouses/);
assert.match(warehousesPage, /Остатки/);
assert.match(warehousesPage, /Только просмотр/);
assert.match(warehousesPage, /isAgrochemicalWarehouseType\(selectedSummary\.warehouse\.warehouse_type\)/);

process.stdout.write(JSON.stringify({
  status: "PASS",
  warehouse_visibility: "all company warehouses",
  warehousekeeper_stock_scope: "agrochemical only",
  weighbridge_warehouse_scope: "read only",
  company_admin_stock_movements: "blocked",
  checks: 22,
}, null, 2));
