import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatDateOnly,
  isDateOnly,
  requireDateOnly,
  todayDateOnlyLocal,
} from "../lib/dates/date-only";
import { selectCurrentSeason } from "../lib/seasons/current-season";
import { isMachineryCompatible } from "../lib/operations/machinery-compatibility";
import { patchMaterialWithRateReset } from "../lib/operations/material-rate-reset";
import { calculateStockMath, signedLedgerQuantity } from "../lib/warehouse/stock-math";
import { dedupeProductsForSelect } from "../lib/catalog/catalog-identity";

type TestCase = {
  name: string;
  run: () => void;
};

const root = resolve(__dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

const migration = source("supabase/migrations/20260727224833_work_audit_integrity_v1.sql");
const operationRoute = source("app/api/operations/route.ts");
const operationForm = source("components/operations/operation-form-dialog.tsx");
const analyticsPage = source("app/(dashboard)/analytics/page.tsx");
const analyticsService = source("lib/services/analytics.ts");
const notificationRoute = source("app/api/settings/notifications/route.ts");
const weighbridgePage = source("app/(dashboard)/weighbridge/page.tsx");
const ticketRoute = source("app/api/weighbridge/tickets/route.ts");
const fieldPage = source("app/(dashboard)/fields/[id]/page.tsx");
const materialRequestRoute = source("app/api/material-requests/route.ts");
const assistantActionEngine = source("lib/assistant/engine/action-engine.ts");

const tests: TestCase[] = [
  {
    name: "date-only accepts 01.01",
    run: () => assert.equal(isDateOnly("2026-01-01"), true),
  },
  {
    name: "date-only accepts 28.07",
    run: () => assert.equal(isDateOnly("2026-07-28"), true),
  },
  {
    name: "date-only accepts 31.12",
    run: () => assert.equal(isDateOnly("2026-12-31"), true),
  },
  {
    name: "date-only rejects impossible calendar dates",
    run: () => assert.equal(isDateOnly("2026-02-30"), false),
  },
  {
    name: "date-only formatter preserves local calendar day",
    run: () =>
      assert.equal(
        formatDateOnly("2026-07-28", "ru-RU", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
        "28.07.2026"
      ),
  },
  {
    name: "local date serializer does not use UTC slicing",
    run: () =>
      assert.equal(todayDateOnlyLocal(new Date(2026, 6, 28, 0, 5, 0)), "2026-07-28"),
  },
  {
    name: "date-only API contract rejects timestamps",
    run: () =>
      assert.throws(() => requireDateOnly("2026-07-28T00:00:00.000Z"), /YYYY-MM-DD/),
  },
  {
    name: "assistant operation dates use the local calendar helper",
    run: () => {
      assert.match(assistantActionEngine, /todayDateOnlyLocal/);
      assert.doesNotMatch(
        assistantActionEngine,
        /date\.toISOString\(\)\.slice\(0,\s*10\)/
      );
    },
  },
  {
    name: "current season prefers active 2026",
    run: () =>
      assert.equal(
        selectCurrentSeason([
          { id: "2025", year: 2025 },
          { id: "2027", year: 2027 },
          { id: "2026", year: 2026 },
        ])?.id,
        "2026"
      ),
  },
  {
    name: "current season skips archived 2026",
    run: () =>
      assert.equal(
        selectCurrentSeason([
          { id: "old", year: 2026, archived: true },
          { id: "new", year: 2025 },
        ])?.id,
        "new"
      ),
  },
  {
    name: "spraying accepts sprayer machinery",
    run: () =>
      assert.equal(
        isMachineryCompatible({
          operationCategory: "spraying",
          assetKind: "equipment",
          asset: { equipment_category: "boom_sprayer" },
        }),
        true
      ),
  },
  {
    name: "spraying rejects mower machinery",
    run: () =>
      assert.equal(
        isMachineryCompatible({
          operationCategory: "spraying",
          assetKind: "equipment",
          asset: { equipment_category: "mower" },
        }),
        false
      ),
  },
  {
    name: "harvesting accepts combine",
    run: () =>
      assert.equal(
        isMachineryCompatible({
          operationCategory: "harvesting",
          assetKind: "machine",
          asset: { machine_category: "combine" },
        }),
        true
      ),
  },
  {
    name: "material change resets planned rate",
    run: () =>
      assert.equal(
        patchMaterialWithRateReset(
          { product_id: "a", unit: "kg", rate_basis: "per_ha", planned_rate: 2 },
          { product_id: "b" }
        ).planned_rate,
        null
      ),
  },
  {
    name: "unit change resets planned rate",
    run: () =>
      assert.equal(
        patchMaterialWithRateReset(
          { product_id: "a", unit: "kg", rate_basis: "per_ha", planned_rate: 2 },
          { unit: "l" }
        ).planned_rate,
        null
      ),
  },
  {
    name: "unrelated material edit preserves planned rate",
    run: () =>
      assert.equal(
        patchMaterialWithRateReset(
          { product_id: "a", unit: "kg", rate_basis: "per_ha", planned_rate: 2 },
          {}
        ).planned_rate,
        2
      ),
  },
  {
    name: "issue ledger fallback sign is negative",
    run: () => assert.equal(signedLedgerQuantity({ direction: "out", quantity: 5 }), -5),
  },
  {
    name: "return ledger fallback sign is positive",
    run: () => assert.equal(signedLedgerQuantity({ direction: "in", quantity: 5 }), 5),
  },
  {
    name: "canonical signed ledger delta wins",
    run: () =>
      assert.equal(
        signedLedgerQuantity({ direction: "in", quantity: 5, delta_qty_signed: -7 }),
        -7
      ),
  },
  {
    name: "available stock is not clamped to zero",
    run: () => assert.equal(calculateStockMath(1, 3).available, -2),
  },
  {
    name: "stock deficit is explicit",
    run: () => assert.equal(calculateStockMath(1, 3).deficit, 2),
  },
  {
    name: "catalog select dedupes verified Curamin identity",
    run: () => {
      const rows = dedupeProductsForSelect([
        { id: "a", name: "Curamin Foliar", product_type: "fertilizer" },
        { id: "b", name: "Курамин", product_type: "fertilizer" },
      ]);
      assert.equal(rows.length, 1);
    },
  },
  {
    name: "catalog company override wins over global identity",
    run: () => {
      const rows = dedupeProductsForSelect([
        { id: "global", name: "Curamin Foliar", product_type: "fertilizer" },
        {
          id: "company",
          name: "Курамин",
          product_type: "fertilizer",
          company_id: "company-a",
        },
      ]);
      assert.deepEqual(rows.map((row) => row.id), ["company"]);
    },
  },
  {
    name: "analytics service throws database errors",
    run: () => assert.match(analyticsService, /if \(error\) throw new Error\(error\.message\)/),
  },
  {
    name: "analytics UI distinguishes API error from zero",
    run: () => assert.match(analyticsPage, /Не удалось загрузить данные/),
  },
  {
    name: "operation API blocks incomplete targets",
    run: () =>
      assert.match(
        operationRoute,
        /Each target requires an explicit field, crop structure and positive area/
      ),
  },
  {
    name: "operation API blocks duplicate targets",
    run: () => assert.match(operationRoute, /Duplicate operation target is not allowed/),
  },
  {
    name: "operation form adds an empty target when choice is ambiguous",
    run: () =>
      assert.match(
        operationForm,
        /candidates\.length === 1[\s\S]*?field_id: "",[\s\S]*?crop_structure_id: null/
      ),
  },
  {
    name: "operation form resets rate through shared helper",
    run: () => assert.match(operationForm, /patchMaterialWithRateReset/),
  },
  {
    name: "reconciliation synchronizes canonical and legacy closed status",
    run: () =>
      assert.match(
        migration,
        /if new\.warehouse_request_status = 'closed'[\s\S]*?new\.status := 'closed'/
      ),
  },
  {
    name: "reconciliation uses a transaction-scoped advisory lock",
    run: () => assert.match(migration, /pg_advisory_xact_lock/),
  },
  {
    name: "field history fact is sourced from reconciled request items",
    run: () =>
      assert.match(
        migration,
        /warehouse_issue_request_items i[\s\S]*?i\.reconciliation_status = 'reconciled'/
      ),
  },
  {
    name: "field card renders canonical consumed quantity and unit",
    run: () => {
      assert.match(fieldPage, /consumed_quantity/);
      assert.match(fieldPage, /normalizeUnit\(fact\.unit \|\| requestFact\?\.unit\)/);
    },
  },
  {
    name: "prepare stage is guarded by physical stock minus reservations",
    run: () => assert.match(migration, /v_available := v_on_hand - v_reserved/),
  },
  {
    name: "material request API returns stock deficit details",
    run: () => {
      assert.match(materialRequestRoute, /deficit/);
      assert.match(materialRequestRoute, /reserved/);
    },
  },
  {
    name: "notification settings persist through user-scoped upsert",
    run: () => {
      assert.match(notificationRoute, /getUserScopedClientFromRequest/);
      assert.match(notificationRoute, /\.upsert\(/);
      assert.match(migration, /create table if not exists public\.user_notification_preferences/);
    },
  },
  {
    name: "multiple crop structures remain unselected at weighbridge",
    run: () =>
      assert.match(
        weighbridgePage,
        /fieldHarvestOptions\.length === 1[\s\S]*?cropStructureAllocationId: ""/
      ),
  },
  {
    name: "weighbridge create button is disabled before valid input",
    run: () => assert.match(weighbridgePage, /Boolean\(currentValidationError\)/),
  },
  {
    name: "weighbridge blocks missing crop variety or reproduction",
    run: () =>
      assert.match(
        ticketRoute,
        /crop_id, variety_id and reproduction_id are required for harvest incoming lines/
      ),
  },
  {
    name: "weighbridge double submit is guarded",
    run: () => {
      assert.match(weighbridgePage, /if \(!canOperate \|\| submitting\) return/);
      assert.match(weighbridgePage, /disabled=\{[\s\S]*?submitting/);
    },
  },
  {
    name: "hidden duplicate weighbridge form is removed",
    run: () => assert.doesNotMatch(weighbridgePage, /<CardContent className="hidden">/),
  },
];

const results: Array<{ name: string; status: "PASS" | "FAIL"; error?: string }> = [];
for (const test of tests) {
  try {
    test.run();
    results.push({ name: test.name, status: "PASS" });
  } catch (error) {
    results.push({
      name: test.name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const failed = results.filter((result) => result.status === "FAIL");
console.log(
  JSON.stringify(
    {
      suite: "TZ-234 core remediation regression",
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    },
    null,
    2
  )
);

if (failed.length > 0) process.exitCode = 1;
