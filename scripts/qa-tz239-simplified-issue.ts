import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  allocateQuantityAcrossLots,
  calculateExpectedReturn,
  calculateMaterialReconciliation,
  materialIssueStatusLabel,
  validateMaterialIssue,
} from "../lib/warehouse/material-issue";
import { hasQaDataMarker } from "../lib/utils/qa-data";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });
const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

const warehouseUi = source("app/(dashboard)/warehouses/requests/page.tsx");
const tasksUi = source("app/(dashboard)/tasks/page.tsx");
const specialistPlan = source(
  "components/operations/specialist-operation-plan.tsx"
);
const requestRoute = source("app/api/material-requests/route.ts");
const issueRoute = source("app/api/material-requests/[id]/issue/route.ts");
const stockDetailsRoute = source(
  "app/api/warehouses/[id]/stock-details/route.ts"
);
const receiptRoute = source("app/api/warehouses/receipts/route.ts");
const receiptDialog = source(
  "components/warehouses/warehouse-receipt-dialog.tsx"
);
const requestService = source("lib/services/warehouse-requests.ts");
const requestTypes = source("lib/types/warehouse-request.ts");
const returnRoute = source("app/api/material-requests/[id]/return/route.ts");
const quantityMigration = source(
  "supabase/migrations/20260730140942_simplify_warehouse_issue_quantities_v1.sql"
);
const identityMigration = source(
  "supabase/migrations/20260730153500_warehouse_issue_product_identity_v1.sql"
);
const actualIdentityMigration = source(
  "supabase/migrations/20260731013506_warehouse_issue_actual_product_identity_v2.sql"
);
const equivalentIdentityMigration = source(
  "supabase/migrations/20260731015717_warehouse_issue_equivalent_product_identity_v3.sql"
);
const packageMigration = source(
  "supabase/migrations/20260730105407_package_aware_warehouse_issue_v1.sql"
);
const fieldHistoryRls = source(
  "supabase/migrations/20260730121441_field_history_company_rls_v1.sql"
);

const forbiddenPackageContract =
  /package_size|package_unit|package_count|package_mode|issue_mode|package_source|whole_package|Целая упаковка|Отмеренное количество|Количество упаковок/i;

test("01 issue above plan is allowed", () => {
  assert.equal(
    validateMaterialIssue({
      plannedQuantity: 1,
      preparedQuantity: 5,
      availableQuantity: 10,
      unit: "l",
    }).valid,
    true
  );
});
test("02 expected return is 4", () => {
  assert.equal(calculateExpectedReturn(5, 1), 4);
});
test("03 plan stays independent", () => {
  const plan = 1;
  calculateExpectedReturn(5, plan);
  assert.equal(plan, 1);
});
test("04 stock exceed is blocked", () => {
  const result = validateMaterialIssue({
    plannedQuantity: 1,
    preparedQuantity: 5,
    availableQuantity: 4,
    unit: "l",
  });
  assert.equal(result.valid, false);
  assert.match(
    result.errors[0],
    /Доступно 4 l\. К выдаче указано 5 l\. Не хватает 1 l\./
  );
});
test("05 positive quantity is required", () => {
  assert.equal(
    validateMaterialIssue({
      plannedQuantity: 1,
      preparedQuantity: 0,
      availableQuantity: 10,
      unit: "l",
    }).valid,
    false
  );
});
test("06 quantity below plan is allowed", () => {
  assert.equal(
    validateMaterialIssue({
      plannedQuantity: 5,
      preparedQuantity: 2,
      availableQuantity: 10,
      unit: "l",
    }).valid,
    true
  );
});
test("07 one lot allocation is exact", () => {
  const result = allocateQuantityAcrossLots({
    quantity: 5,
    lots: [
      {
        batchId: "lot-1",
        batchClass: "commodity",
        batchLabel: "LOT-1",
        availableQuantity: 10,
      },
    ],
  });
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].quantity, 5);
  assert.equal(result.deficitQuantity, 0);
});
test("08 multiple lots are allocated without rounding", () => {
  const result = allocateQuantityAcrossLots({
    quantity: 7,
    lots: [
      {
        batchId: "lot-1",
        batchClass: "commodity",
        batchLabel: "LOT-1",
        availableQuantity: 3,
      },
      {
        batchId: "lot-2",
        batchClass: "commodity",
        batchLabel: "LOT-2",
        availableQuantity: 8,
      },
    ],
  });
  assert.deepEqual(
    result.allocations.map((row) => row.quantity),
    [3, 4]
  );
});
test("09 lot deficit is explicit", () => {
  assert.equal(
    allocateQuantityAcrossLots({
      quantity: 5,
      lots: [
        {
          batchClass: "commodity",
          batchLabel: "Без партии",
          availableQuantity: 4,
        },
      ],
    }).deficitQuantity,
    1
  );
});
test("10 neutral expected return status", () => {
  assert.equal(
    materialIssueStatusLabel({
      preparedQuantity: 5,
      availableQuantity: 10,
      expectedReturnQuantity: 4,
      unit: "л",
    }),
    "Ожидаемый возврат: 4 л"
  );
});
test("11 reconciliation 5 = 1.2 + 3.8 + 0", () => {
  assert.equal(
    calculateMaterialReconciliation({
      issuedQuantity: 5,
      consumedQuantity: 1.2,
      returnedQuantity: 3.8,
      lossQuantity: 0,
    }).valid,
    true
  );
});
test("12 reconciliation mismatch is blocked", () => {
  assert.equal(
    calculateMaterialReconciliation({
      issuedQuantity: 5,
      consumedQuantity: 1.2,
      returnedQuantity: 3,
      lossQuantity: 0,
    }).valid,
    false
  );
});
test("13 declared loss balances issue", () => {
  assert.equal(
    calculateMaterialReconciliation({
      issuedQuantity: 5,
      consumedQuantity: 1,
      returnedQuantity: 3,
      lossQuantity: 1,
    }).valid,
    true
  );
});
test("14 warehouse UI uses six target columns", () => {
  for (const label of [
    "Материал",
    "Плановая потребность",
    "Доступно",
    "К выдаче",
    "Ожидаемый возврат",
    "Статус",
  ]) {
    assert.match(warehouseUi, new RegExp(label));
  }
});
test("15 package controls are absent from warehouse UI", () => {
  assert.doesNotMatch(warehouseUi, forbiddenPackageContract);
});
test("16 warehouse UI accepts a direct quantity", () => {
  assert.match(warehouseUi, /preparedByItem/);
  assert.match(warehouseUi, /allocateQuantityAcrossLots/);
});
test("17 over-stock disables ready", () => {
  assert.match(warehouseUi, /hasStockProblem/);
  assert.match(warehouseUi, /allPreparedRowsValid/);
});
test("18 ready API accepts prepared quantity", () => {
  assert.match(requestService, /preparedQuantity:\s*number/);
  assert.doesNotMatch(requestService, forbiddenPackageContract);
});
test("19 ready route uses quantity-only RPC", () => {
  assert.match(requestRoute, /prepare_material_request_atomic_v3/);
  assert.doesNotMatch(requestRoute, forbiddenPackageContract);
});
test("20 issue route uses quantity-only RPC", () => {
  assert.match(issueRoute, /issue_material_request_atomic_v5/);
  assert.doesNotMatch(issueRoute, forbiddenPackageContract);
});
test("21 request DTO omits package contract", () => {
  assert.doesNotMatch(requestTypes, forbiddenPackageContract);
});
test("22 stock details omit package fallback", () => {
  assert.doesNotMatch(stockDetailsRoute, forbiddenPackageContract);
});
test("23 specialist task omits package label", () => {
  assert.doesNotMatch(tasksUi, forbiddenPackageContract);
  assert.doesNotMatch(specialistPlan, forbiddenPackageContract);
});
test("24 specialist task keeps prepared and issued", () => {
  assert.match(specialistPlan, /Подготовлено:/);
  assert.match(specialistPlan, /Выдано:/);
  assert.match(specialistPlan, /Ожидаемый возврат:/);
});
test("25 specialist defaults are editable reconciliation facts", () => {
  assert.match(tasksUi, /consumed:\s*String\(Math\.max\(issued - expectedReturn/);
  assert.match(tasksUi, /returned:\s*String\(expectedReturn\)/);
  assert.match(tasksUi, /loss:\s*'0'/);
});
test("26 receipt form has no package fields", () => {
  assert.doesNotMatch(receiptDialog, forbiddenPackageContract);
});
test("27 receipt API has no package requirement", () => {
  assert.doesNotMatch(receiptRoute, forbiddenPackageContract);
  assert.match(receiptRoute, /create_warehouse_receipt_atomic_v4/);
});
test("28 migration creates quantity-only RPCs", () => {
  assert.match(quantityMigration, /prepare_material_request_atomic_v1/);
  assert.match(quantityMigration, /issue_material_request_atomic_v2/);
});
test("29 migration revokes package-aware RPCs", () => {
  assert.match(
    quantityMigration,
    /revoke all on function public\.prepare_package_aware/
  );
  assert.match(
    quantityMigration,
    /revoke all on function public\.issue_package_aware/
  );
});
test("30 migration removes lower-plan guard", () => {
  assert.match(quantityMigration, /regexp_replace\(\s*v_prepare_definition/);
  assert.match(quantityMigration, /Lower-plan guard could not be removed/);
  assert.match(quantityMigration, /Prepared quantity cannot be lower than the operation plan/);
});
test("31 migration does not drop legacy columns or tables", () => {
  assert.doesNotMatch(quantityMigration, /drop\s+(?:table|column)/i);
});
test("31a request identity resolves to the global master atomically", () => {
  assert.match(identityMigration, /select p\.master_product_id/);
  assert.match(identityMigration, /set actual_product_id = v_product_id/);
  assert.match(identityMigration, /prepare_material_request_atomic_v2/);
  assert.match(identityMigration, /issue_material_request_atomic_v3/);
});
test("31b identity migration preserves quantity-only contract", () => {
  assert.doesNotMatch(identityMigration, /whole_package|package_count|package_size/);
  assert.doesNotMatch(identityMigration, /drop\s+(?:table|column)/i);
});
test("31c preselected company product resolves to the global master", () => {
  assert.match(actualIdentityMigration, /p\.id = v_item\.actual_product_id/);
  assert.match(actualIdentityMigration, /prepare_material_request_atomic_v3/);
  assert.match(actualIdentityMigration, /issue_material_request_atomic_v4/);
});
test("31d final identity migration preserves quantity-only contract", () => {
  assert.doesNotMatch(
    actualIdentityMigration,
    /whole_package|package_count|package_size/
  );
  assert.doesNotMatch(actualIdentityMigration, /drop\s+(?:table|column)/i);
});
test("31e company product and its master are not a substitution", () => {
  assert.match(issueRoute, /canonicalProductId\(item\.planned_product_id\)/);
  assert.match(issueRoute, /canonicalProductId\(item\.actual_product_id\)/);
  assert.match(equivalentIdentityMigration, /p\.master_product_id/);
  assert.match(equivalentIdentityMigration, /issue_material_request_atomic_v5/);
});
test("31f equivalent identity migration preserves substitution guard", () => {
  assert.match(equivalentIdentityMigration, /substitution_status/);
  assert.doesNotMatch(
    equivalentIdentityMigration,
    /whole_package|package_count|package_size/
  );
  assert.doesNotMatch(equivalentIdentityMigration, /drop\s+(?:table|column)/i);
});
test("32 reservation stays allocation-bound", () => {
  assert.match(
    packageMigration,
    /greatest\(a\.prepared_quantity - a\.issued_quantity, 0\)/
  );
});
test("33 ledger OUT stays allocation-bound", () => {
  assert.match(packageMigration, /warehouse_issue_allocation_id/);
});
test("34 expected return creates no ledger IN", () => {
  const beforeIssue = packageMigration.slice(
    0,
    packageMigration.indexOf(
      "create or replace function public.issue_package_aware"
    )
  );
  assert.doesNotMatch(beforeIssue, /insert into public\.stock_ledger_entries/i);
});
test("35 return acceptance writes ledger IN", () => {
  assert.match(returnRoute, /transaction_type:\s*"in"/);
});
test("35a return restores the actually issued stock identity", () => {
  assert.match(
    returnRoute,
    /row\.dbItem\.actual_product_id\s*\|\|\s*row\.dbItem\.product_id/
  );
  assert.match(returnRoute, /productId:\s*stockProductId/);
  assert.match(returnRoute, /product_id:\s*stockProductId/);
});
test("36 accepted return cannot exceed declared return", () => {
  assert.match(returnRoute, /accepted return exceeds declared return/i);
});
test("37 field history uses consumed facts", () => {
  assert.match(tasksUi, /consumed_quantity/);
  assert.match(tasksUi, /materialFacts/);
});
test("38 operation and field identities remain visible", () => {
  assert.match(tasksUi, /operation\.operation_number/);
  assert.match(tasksUi, /fields\?\.field_code/);
});
test("39 crop identity and multi-target remain visible", () => {
  assert.match(tasksUi, /getOperationCropIdentity/);
  assert.match(specialistPlan, /presentation\.planLines/);
});
test("40 QA markers remain exact", () => {
  assert.equal(hasQaDataMarker("E2E-TZ239 smoke"), true);
  assert.equal(hasQaDataMarker("Полевой участок E2E"), false);
});
test("41 QA test-data toggle remains available", () => {
  assert.match(warehouseUi, /Показать тестовые данные/);
});
test("42 field history RLS remains company scoped", () => {
  assert.match(fieldHistoryRls, /get_user_company_id/);
  assert.match(
    fieldHistoryRls,
    /revoke all privileges on table public\.field_history/
  );
});
test("43 removed package helper is gone", () => {
  assert.equal(
    existsSync(resolve(root, "lib/warehouse/package-aware-issue.ts")),
    false
  );
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.run();
    passed += 1;
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    console.error(`FAIL ${entry.name}`);
    throw error;
  }
}
console.log(`TZ-239 QA: ${passed}/${tests.length} PASS`);
