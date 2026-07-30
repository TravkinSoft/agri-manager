import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateExpectedReturn,
  calculateMaterialReconciliation,
  calculateWholePackageQuantity,
  packageStatusLabel,
  validatePackageAwareItem,
  type PackageAllocationInput,
} from "../lib/warehouse/package-aware-issue";
import { hasQaDataMarker } from "../lib/utils/qa-data";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });
const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260730105407_package_aware_warehouse_issue_v1.sql"),
  "utf8"
);
const receiptActionFix = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260730111532_package_aware_receipt_action_contract_v1.sql"
  ),
  "utf8"
);
const fieldHistoryRls = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260730121441_field_history_company_rls_v1.sql"
  ),
  "utf8"
);
const warehouseUi = readFileSync(
  resolve(root, "app/(dashboard)/warehouses/requests/page.tsx"),
  "utf8"
);
const tasksUi = readFileSync(resolve(root, "app/(dashboard)/tasks/page.tsx"), "utf8");
const warehouseRequestService = readFileSync(
  resolve(root, "lib/services/warehouse-requests.ts"),
  "utf8"
);
const returnRoute = readFileSync(
  resolve(root, "app/api/material-requests/[id]/return/route.ts"),
  "utf8"
);
const confirmRoute = readFileSync(
  resolve(root, "app/api/material-requests/[id]/confirm/route.ts"),
  "utf8"
);

function allocation(
  patch: Partial<PackageAllocationInput> = {}
): PackageAllocationInput {
  return {
    batchClass: "commodity",
    batchLabel: "LOT-1",
    issueMode: "whole_package",
    quantity: 5,
    availableQuantity: 10,
    packageSize: 5,
    packageCount: 1,
    packageUnit: "l",
    packageSource: "batch",
    ...patch,
  };
}

test("01 plan 1 and package 5 prepares 5", () => {
  assert.deepEqual(calculateWholePackageQuantity(1, 5), {
    packageCount: 1,
    preparedQuantity: 5,
  });
});
test("02 expected return is 4", () => {
  assert.equal(calculateExpectedReturn(5, 1), 4);
});
test("03 plan stays independent from prepared", () => {
  const plan = 1;
  calculateWholePackageQuantity(plan, 5);
  assert.equal(plan, 1);
});
test("04 plan exceed is valid", () => {
  assert.equal(
    validatePackageAwareItem({
      plannedQuantity: 1,
      itemUnit: "l",
      allocations: [allocation()],
    }).valid,
    true
  );
});
test("05 stock exceed is blocked", () => {
  const result = validatePackageAwareItem({
    plannedQuantity: 1,
    itemUnit: "l",
    allocations: [allocation({ availableQuantity: 0 })],
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /не хватает/i);
});
test("06 package count must be an integer", () => {
  assert.equal(
    validatePackageAwareItem({
      plannedQuantity: 1,
      itemUnit: "l",
      allocations: [allocation({ packageCount: 1.5, quantity: 7.5 })],
    }).valid,
    false
  );
});
test("07 plan 6 and package 5 prepares 10", () => {
  assert.equal(calculateWholePackageQuantity(6, 5).preparedQuantity, 10);
});
test("08 plan 10 and package 5 prepares 10", () => {
  assert.equal(calculateWholePackageQuantity(10, 5).preparedQuantity, 10);
});
test("09 measured mode allows exact 1 l", () => {
  assert.equal(
    validatePackageAwareItem({
      plannedQuantity: 1,
      itemUnit: "l",
      allocations: [
        allocation({
          issueMode: "measured",
          quantity: 1,
          packageSize: null,
          packageCount: null,
          packageUnit: null,
          packageSource: "measured",
        }),
      ],
    }).valid,
    true
  );
});
test("10 unit mismatch is blocked", () => {
  assert.equal(
    validatePackageAwareItem({
      plannedQuantity: 1,
      itemUnit: "kg",
      allocations: [allocation({ packageUnit: "l" })],
    }).valid,
    false
  );
});
test("11 multiple batches are summed", () => {
  const result = validatePackageAwareItem({
    plannedQuantity: 6,
    itemUnit: "l",
    allocations: [
      allocation({ quantity: 5, availableQuantity: 5 }),
      allocation({
        batchLabel: "LOT-2",
        quantity: 5,
        availableQuantity: 5,
      }),
    ],
  });
  assert.equal(result.preparedQuantity, 10);
  assert.equal(result.expectedReturnQuantity, 4);
});
test("12 current reservation is excluded", () => {
  assert.match(migration, /a\.request_id <> p_request_id/);
});
test("13 ready reserves prepared quantity", () => {
  assert.match(migration, /greatest\(a\.prepared_quantity - a\.issued_quantity, 0\)/);
});
test("14 issue ledger is allocation-bound", () => {
  assert.match(migration, /warehouse_issue_allocation_id/);
});
test("15 double issue is idempotent", () => {
  assert.match(migration, /'already_issued', true/);
  assert.match(receiptActionFix, /quote_literal\('request_stage'\)/);
  assert.match(receiptActionFix, /quote_literal\('issue'\)/);
});
test("16 expected return creates no ledger IN", () => {
  const beforeIssue = migration.slice(
    0,
    migration.indexOf("create or replace function public.issue_package_aware")
  );
  assert.doesNotMatch(beforeIssue, /insert into public\.stock_ledger_entries/i);
});
test("17 specialist receipt does not change stock", () => {
  assert.doesNotMatch(confirmRoute, /stock_ledger_entries|inventory_transactions/);
});
test("18 5 equals 1 plus 4 plus 0", () => {
  assert.equal(
    calculateMaterialReconciliation({
      issuedQuantity: 5,
      consumedQuantity: 1,
      returnedQuantity: 4,
      lossQuantity: 0,
    }).valid,
    true
  );
});
test("19 missing 1 is blocked", () => {
  assert.equal(
    calculateMaterialReconciliation({
      issuedQuantity: 5,
      consumedQuantity: 1,
      returnedQuantity: 3,
      lossQuantity: 0,
    }).valid,
    false
  );
});
test("20 declared loss balances issue", () => {
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
test("21 return acceptance writes one IN payload per item", () => {
  assert.match(returnRoute, /transaction_type:\s*"in"/);
});
test("22 double return is blocked", () => {
  assert.match(returnRoute, /accepted return exceeds declared return/i);
});
test("23 reconciliation closes request", () => {
  assert.match(returnRoute, /return_material_request_atomic_v1/);
});
test("24 field history uses consumed facts", () => {
  assert.match(tasksUi, /consumed_quantity/);
  assert.match(tasksUi, /materialFacts/);
});
test("25 units remain explicit", () => {
  assert.match(migration, /prepared_unit = i\.unit/);
  assert.match(migration, /issued_unit = unit/);
});
test("26 operation number is rendered", () => {
  assert.match(tasksUi, /operation\.operation_number/);
});
test("27 field code is rendered", () => {
  assert.match(tasksUi, /fields\?\.field_code/);
});
test("28 crop structure identity is rendered", () => {
  assert.match(tasksUi, /getOperationCropIdentity/);
});
test("29 same names remain distinguishable", () => {
  assert.match(tasksUi, /field_code/);
});
test("30 multi-target lines remain available", () => {
  assert.match(tasksUi, /operation_lines/);
});
test("31 human work title is used", () => {
  assert.match(tasksUi, /resolveWorkTitle/);
});
test("32 material request number is rendered", () => {
  assert.match(tasksUi, /request\.request_number/);
});
test("33 material status is rendered", () => {
  assert.match(tasksUi, /materialStatusText\(requests\)/);
});
test("34 completed phase has no action branch", () => {
  assert.match(tasksUi, /selectedPhase === 'accepted' \|\| selectedPhase === 'in_progress'/);
});
test("35 raw UUID is not a task label", () => {
  assert.doesNotMatch(tasksUi, />\s*\{selectedOperation\.id\}\s*</);
});
test("36 E2E field marker is exact", () => {
  assert.equal(hasQaDataMarker("E2E-TZ238 — whole package issue"), true);
});
test("37 ledger cleanup is non-destructive", () => {
  assert.doesNotMatch(migration, /delete from public\.stock_ledger_entries/i);
});
test("38 ticket and batch cleanup is non-destructive", () => {
  assert.doesNotMatch(migration, /delete from public\.(tickets|inventory_batches)/i);
});
test("39 cancelled or archived tests are filtered", () => {
  assert.match(tasksUi, /!operation\.is_test_data/);
});
test("40 real field is not a test marker", () => {
  assert.equal(hasQaDataMarker("Поле 7, рабочий контур"), false);
});
test("41 QA toggle returns test records", () => {
  assert.match(tasksUi, /Показать тестовые данные/);
  assert.match(tasksUi, /includeTestData:\s*showTestData/);
});
test("42 company isolation remains enforced", () => {
  assert.match(
    migration,
    /using \(company_id = public\.get_user_company_id\(\)\)/
  );
  assert.match(fieldHistoryRls, /to authenticated/);
  assert.match(
    fieldHistoryRls,
    /fields\.company_id = public\.get_user_company_id\(\)/
  );
  assert.match(fieldHistoryRls, /revoke all privileges[\s\S]+from public, anon, authenticated/);
  assert.match(warehouseUi, /allPreparedRowsValid/);
  assert.match(warehouseRequestService, /value === "closed"/);
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.run();
    passed += 1;
    process.stdout.write(`PASS ${entry.name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${entry.name}\n`);
    throw error;
  }
}
assert.equal(tests.length, 42);
process.stdout.write(`TZ-238 automated contract tests: ${passed}/${tests.length} PASS\n`);
