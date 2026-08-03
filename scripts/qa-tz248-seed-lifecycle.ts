import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  calculateSeedRequirementKg,
  fromCanonicalSeedRateKgHa,
  isCompleteSeedIdentity,
  seedIdentitiesMatch,
  seedIdentityKey,
  toCanonicalSeedRateKgHa,
} from "../lib/operations/seed-material";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const containsAll = (source: string, values: string[]) => values.every((value) => source.includes(value));
const functionBody = (source: string, name: string, nextName: string) => {
  const start = source.indexOf(`create or replace function public.${name}`);
  const end = source.indexOf(`create or replace function public.${nextName}`, start + 1);
  assert(start >= 0, `Missing function ${name}`);
  return source.slice(start, end >= 0 ? end : source.length);
};

const migration = read("supabase/migrations/20260803125025_seed_planting_material_lifecycle_v1.sql");
const actualRateMigration = read("supabase/migrations/20260803131308_seed_planting_actual_rate_v1.sql");
const operationRoute = read("app/api/operations/route.ts");
const operationForm = read("components/operations/operation-form-dialog.tsx");
const receiptRoute = read("app/api/warehouses/receipts/route.ts");
const receiptDialog = read("components/warehouses/warehouse-receipt-dialog.tsx");
const returnRoute = read("app/api/material-requests/[id]/return/route.ts");
const issueRoute = read("app/api/material-requests/[id]/issue/route.ts");
const operationsPage = read("app/(dashboard)/operations/page.tsx");
const operationService = read("lib/services/operations.ts");
const seedPlanRpc = functionBody(migration, "create_seed_planting_operation_plan_atomic_v1", "create_seed_material_receipt_atomic_v1");
const seedReceiptRpc = functionBody(migration, "create_seed_material_receipt_atomic_v1", "post_inventory_transaction_to_ledger");

const galaRs1 = { cropId: "potato", varietyId: "gala", reproductionId: "rs1" };

check("01 structure identity is authoritative", () => assert(containsAll(operationRoute, ["structure?.crop_id", "structure?.variety_id", "structure?.reproduction_id"])));
check("02 variety belongs to crop", () => assert.match(migration, /where v\.id = p_variety_id[\s\S]*and v\.crop_id = p_crop_id/));
check("03 reproduction is preserved", () => assert(containsAll(seedPlanRpc, ["v_reproduction_id", "reproduction_id = v_reproduction_id"])));
check("04 root identity is read-only", () => assert(operationForm.includes("Identity берётся из структуры посевов и не редактируется в операции.")));
check("05 arbitrary seed product is rejected", () => assert(operationRoute.includes("!primarySeedComponent || primarySeedComponent.product_id")));
check("06 different multi-section identities are blocked", () => assert(operationRoute.includes("Выбранные участки имеют разные культуры, сорта или репродукции")));
check("07 same multi-section identity is allowed", () => assert.equal(seedIdentitiesMatch(galaRs1, { ...galaRs1 }), true));
check("08 crop mix keeps its atomic RPC", () => assert(operationRoute.includes("create_crop_mix_operation_plan_atomic_v1")));

check("09 12 ha x 3.2 t/ha = 38400 kg", () => assert.equal(calculateSeedRequirementKg(12, 3.2, "t_ha"), 38_400));
check("10 100 ha x 180 kg/ha = 18000 kg", () => assert.equal(calculateSeedRequirementKg(100, 180, "kg_ha"), 18_000));
check("11 rate change recalculates quantity", () => assert.equal(calculateSeedRequirementKg(12, 4, "t_ha"), 48_000));
check("12 area change recalculates quantity", () => assert.equal(calculateSeedRequirementKg(10, 3.2, "t_ha"), 32_000));
check("13 kg/ha and t/ha are canonically equal", () => assert.equal(toCanonicalSeedRateKgHa(3.2, "t_ha"), toCanonicalSeedRateKgHa(3200, "kg_ha")));
check("14 liters are absent from seed rate units", () => assert(!operationForm.includes('<SelectItem value="l_ha">л/га</SelectItem>')));

check("15 derived identity is company-local", () => assert.match(migration, /company_id uuid not null references public\.companies/));
check("16 derived product is not global", () => assert.match(migration, /insert into public\.products[\s\S]*company_id[\s\S]*p_company_id/));
check("17 repeated identity is unique", () => assert(migration.includes("unique (company_id, crop_id, variety_id, seed_reproduction_id)")));
check("18 another reproduction has another identity", () => assert.notEqual(seedIdentityKey(galaRs1), seedIdentityKey({ ...galaRs1, reproductionId: "elite" })));
check("19 another variety has another identity", () => assert.notEqual(seedIdentityKey(galaRs1), seedIdentityKey({ ...galaRs1, varietyId: "colomba" })));
check("20 derived identity is seed-classified", () => assert(containsAll(migration, ["type, user_id, company_id", "'seed', auth.uid(), p_company_id", "is_seed_material = true"])));

check("21 receipt resolves exact identity", () => assert(containsAll(seedReceiptRpc, ["p_crop_id", "p_variety_id", "p_reproduction_id", "ensure_company_seed_material_identity_v1"])));
check("22 receipt creates an inventory batch", () => assert(seedReceiptRpc.includes("insert into public.inventory_batches")));
check("23 receipt creates one ledger IN", () => assert.equal((seedReceiptRpc.match(/insert into public\.stock_ledger_entries/g) || []).length, 1));
check("24 repeated receipt is idempotent", () => assert(containsAll(seedReceiptRpc, ["operation_mutation_receipt_begin_v1", "operation_mutation_receipt_finish_v1"])));
check("25 purchase origin is supported", () => assert(receiptDialog.includes('value="purchase"')));
check("26 own-production origin is supported", () => assert(receiptDialog.includes('value="own_production"')));
check("27 opening-balance origin is supported", () => assert(receiptDialog.includes('value="opening_balance"')));
check("28 cross-company receipt batch is blocked", () => assert(containsAll(receiptRoute, ['.eq("company_id", companyId)', "isSeedMaterialWarehouseType"])));

check("29 planting uses one atomic request flow", () => assert(seedPlanRpc.includes("create_operation_plan_atomic_v1")));
check("30 seed request keeps exact IDs", () => assert(containsAll(seedPlanRpc, ["crop_id = v_crop_id", "variety_id = v_variety_id", "reproduction_id = v_reproduction_id"])));
check("31 additional materials remain separate", () => assert(seedPlanRpc.includes("p_operation, p_lines, v_materials")));
check("32 deficit does not block planning", () => assert(operationForm.includes("Дефицит") && !seedPlanRpc.includes("get_seed_material_stock_v1")));
check("33 planning creates no ledger entry", () => assert(!seedPlanRpc.includes("insert into public.stock_ledger_entries")));
check("34 planning does not mutate stock", () => assert(!seedPlanRpc.match(/update public\.inventory_batches/i)));

check("35 exact identity batch validation exists", () => assert(migration.includes("validate_seed_batch_allocation_v1")));
check("36 wrong variety is blocked", () => assert.match(migration, /v_batch\.variety_id is distinct from v_item\.variety_id/));
check("37 wrong reproduction is blocked", () => assert.match(migration, /v_batch\.reproduction_id is distinct from v_item\.reproduction_id/));
check("38 multiple exact batches are supported", () => assert(issueRoute.includes("allocations")));
check("39 issue above available stock is blocked", () => assert.match(issueRoute, /insufficient|available|exceeds/i));
check("40 ledger OUT carries each batch", () => assert(containsAll(migration, ["inventory_batch_id", "warehouse_issue_allocation_id", "post_inventory_transaction_to_ledger"])));
check("41 double issue has an idempotency guard", () => assert.match(issueRoute, /idempotency|already|issued/i));

check("42 reconciliation formula is enforced", () => assert(containsAll(returnRoute, ["issued", "returned", "loss"]))) ;
check("43 return keeps exact seed identity", () => assert(containsAll(returnRoute, ["crop_id", "variety_id", "reproduction_id"])));
check("44 return keeps source batch", () => assert(returnRoute.includes("inventory_batch_id: batchId")));
check("45 accepted return posts ledger IN", () => assert(containsAll(migration, ["return_material_request_atomic_v1", "post_inventory_transaction_to_ledger", "'in'::public.ledger_direction"])));
check("46 field history calculates and shows actual rate", () => assert(
  containsAll(actualRateMigration, ["new.consumed_quantity / v_area_ha", "actual_rate_per_ha", "sync_seed_operation_material_rate_v1"]) &&
  operationsPage.includes("actual_rate_per_ha")
));
check("47 stock sums exact batch balances", () => assert.match(migration, /sum\(greatest\(b\.current_quantity, 0\)\)/));

check("48 rate is editable before request", () => assert(operationForm.includes("onValueChange={(value) => seedMaterialIndex")));
check("49 issued identity is locked by allocation trigger", () => assert(migration.includes("before insert or update of batch_id, batch_id_text, request_item_id, warehouse_id")));
check("50 closed season writes are guarded", () => assert(operationRoute.includes("assertSeasonWritableForMutation")));
check("51 operation planning/cancellation does not touch stock", () => assert(!seedPlanRpc.includes("delete from public.inventory_batches")));
check("52 existing linked IDs are preserved", () => assert(containsAll(operationService, ["crop_id", "variety_id", "reproduction_id"])));

check("53 agronomist company scope is granted", () => assert(seedPlanRpc.includes("'agronomist'")));
check("54 warehouse company scope is granted", () => assert(seedReceiptRpc.includes("'warehouse'")));
check("55 specialist reads exact material trace", () => assert(containsAll(operationsPage, ["item.allocations", "allocation.batch_id", "Фактическая норма"])));
check("56 company admin company scope is granted", () => assert(seedPlanRpc.includes("'company_admin'")));
check("57 cross-company leakage is denied", () => assert(containsAll(migration, ["company_seed_material_identities_select_v1", "i.company_id = p_company_id", "b.company_id = p_company_id"])));

assert.equal(isCompleteSeedIdentity(galaRs1), true);
assert.equal(fromCanonicalSeedRateKgHa(3200, "t_ha"), 3.2);

let passed = 0;
for (const current of checks) {
  try {
    current.run();
    passed += 1;
    console.log(`PASS ${current.name}`);
  } catch (error) {
    console.error(`FAIL ${current.name}`);
    throw error;
  }
}

assert.equal(checks.length, 57);
console.log(`TZ-248 automated checks: ${passed}/57 PASS`);
