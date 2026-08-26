import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aggregateHarvestTickets } from "@/lib/weighbridge/harvest-summary";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let checks = 0;

const check = async (name: string, run: () => void | Promise<void>) => {
  await run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
};

async function main() {
  const weighbridge = read("app/(dashboard)/weighbridge/page.tsx");
  const workspaces = read("components/weighbridge/universal-workspace-tabs.tsx");
  const processing = read("components/weighbridge/processing-workspace.tsx");
  const warehouses = read("app/(dashboard)/warehouses/page.tsx");
  const warehouseSummary = read("app/api/warehouses/summaries/route.ts");
  const primitives = read("components/operations/operational-ui.tsx");
  const bootstrap = read("app/api/weighbridge/bootstrap/route.ts");
  const reconciliationRoute = read("app/api/weighbridge/reconciliation-controls/route.ts");
  const reconciliationUi = read("components/weighbridge/daily-reconciliation.tsx");
  const reconciliationMigration = read("supabase/migrations/20260824124000_tz302_weighbridge_daily_reconciliation_v1.sql");
  const healthApi = read("app/api/operations-health/route.ts");
  const healthUi = read("components/operations/system-health-badge.tsx");
  const healthz = read("app/api/healthz/route.ts");
  const healthScript = read("scripts/health-check.ps1");
  const dashboardLayout = read("components/layout/dashboard-layout.tsx");
  const recoveryRunbook = read("docs/runbooks/tz302-recovery.md");
  const securityAudit = read("docs/audits/tz302-readiness-security.md");

  await check("all seven standard weighbridge modes remain available", () => {
    for (const mode of [
      "harvest_incoming",
      "supplier_receipt",
      "issue_to_field",
      "transfer_between_warehouses",
      "shipment_outbound",
      "disposal_writeoff",
      "impurity_removal",
    ]) assert.match(weighbridge, new RegExp(`type: "${mode}"`));
  });

  await check("processing output remains a contextual eighth flow", () => {
    assert.match(weighbridge, /processing_output/);
    assert.match(weighbridge, /От какой обработки\?/);
    assert.match(weighbridge, /Партия и источник определены маршрутом/);
    assert.match(processing, /Партии на объектах/);
    assert.doesNotMatch(processing, /Добавить выход/);
  });

  await check("operational primitives cover the TZ302 visual contract", () => {
    for (const primitive of [
      "OperationalSection",
      "RouteSelector",
      "ObjectVisual",
      "MetricStrip",
      "StatusBadge",
      "CompactField",
      "PrimaryActionBar",
      "EmptyState",
      "BalanceSummary",
    ]) assert.match(primitives, new RegExp(`function ${primitive}`));
    assert.match(weighbridge, /PrimaryActionBar/);
    assert.match(weighbridge, /CompactField/);
  });

  await check("workspace tabs preserve one-row desktop layout and lightweight state", () => {
    assert.match(workspaces, /xl:grid-cols-6/);
    assert.match(workspaces, /dirty/);
    assert.match(workspaces, /truncate/);
  });

  await check("live weight, moisture and primary actions are compact", () => {
    assert.match(weighbridge, /Live вес/);
    assert.match(weighbridge, /Влажность, %/);
    assert.doesNotMatch(weighbridge, /Влажность, % \(необязательно\)/);
    assert.match(weighbridge, /Открыть талон/);
    assert.match(weighbridge, /Создать талон/);
  });

  await check("open ticket queue remains beside the form on desktop even when empty", () => {
    assert.match(weighbridge, /xl:grid-cols-\[minmax\(0,1fr\)_340px\]/);
    assert.match(weighbridge, /xl:col-start-2 xl:row-start-1/);
    assert.match(weighbridge, /Открытых талонов нет/);
    assert.doesNotMatch(weighbridge, /visibleActiveTickets\.length > 0 \|\| ticketsLoading \? "xl:grid-cols/);
  });

  await check("processing refresh is visible-only single-flight without request storms", () => {
    assert.match(processing, /loadInFlight/);
    assert.match(processing, /document\.visibilityState === "visible"/);
    assert.match(processing, /60_000/);
    assert.doesNotMatch(processing, /setInterval\(refresh, 15_000\)/);
  });

  await check("storage objects render by physical type and do not fake non-warehouse capacity", () => {
    assert.match(warehouses, /ObjectVisual/);
    assert.match(warehouses, /EmptyState/);
    assert.match(warehouses, /normalizeStoragePlaceType\(warehouse\.place_type\) !== "WAREHOUSE"/);
    assert.match(warehouseSummary, /harvest_lot_count/);
    assert.match(warehouseSummary, /harvest_weight_kg/);
  });

  await check("daily reconciliation calculates canonical totals and trip boundaries", () => {
    const aggregate = aggregateHarvestTickets([
      { id: "late", created_at: "2026-08-24T10:00:00.000Z", net_weight_kg: 30_000, lines: [{ moisture_percent: 20 }] },
      { id: "early", finalized_at: "2026-08-24T08:00:00.000Z", net_weight_kg: 10_000, lines: [{ moisture_percent: 10 }] },
      { id: "middle", finalized_at: "2026-08-24T09:00:00.000Z", net_weight_kg: 5_000, lines: [{ moisture_percent: null }] },
    ]);
    assert.equal(aggregate.netKg, 45_000);
    assert.equal(aggregate.averageTripKg, 15_000);
    assert.equal(aggregate.averageMoisture, 17.5);
    assert.equal(aggregate.firstTripAt, "2026-08-24T08:00:00.000Z");
    assert.equal(aggregate.lastTripAt, "2026-08-24T10:00:00.000Z");
    assert.deepEqual(aggregate.ticketIds, ["early", "middle", "late"]);
  });

  await check("shift summary counts the complete active shift outside the lightweight ticket queue", () => {
    assert.match(bootstrap, /const shiftTicketsRes = shiftRes\.data\?\.id/);
    assert.match(bootstrap, /\.eq\("shift_id", shiftRes\.data\.id\)/);
    assert.match(bootstrap, /const shiftTickets = shiftTicketsRes\.data \|\| \[\]/);
    assert.doesNotMatch(bootstrap, /const shiftTickets = shiftRes\.data\?\.id\s*\? tickets\.filter/);
  });

  await check("reconciliation supports day, field, paper delta and ticket drill-down", () => {
    assert.match(bootstrap, /reconciliationRows/);
    assert.match(reconciliationUi, /paperTotalKg/);
    assert.match(reconciliationUi, /differenceKg/);
    assert.match(reconciliationUi, /onOpenTicket/);
    assert.match(reconciliationRoute, /weighbridge_reconciliation_controls/);
  });

  await check("paper controls are metadata-only and cannot mutate accounting truth", () => {
    const accountingTables = /stock_ledger_entries|inventory_batches|weighbridge_tickets|weighbridge_ticket_lines/;
    assert.doesNotMatch(reconciliationRoute, accountingTables);
    assert.doesNotMatch(reconciliationMigration, accountingTables);
    assert.match(reconciliationMigration, /metadata only/i);
  });

  await check("reconciliation migration is additive, scoped and protected by RLS", () => {
    assert.match(reconciliationMigration, /CREATE TABLE IF NOT EXISTS/i);
    assert.match(reconciliationMigration, /ENABLE ROW LEVEL SECURITY/i);
    assert.match(reconciliationMigration, /company_id/);
    assert.doesNotMatch(reconciliationMigration, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE\s+public\./i);
  });

  await check("admin health is read-only and never exposes repair actions", () => {
    assert.match(healthApi, /global_admin/);
    assert.match(healthApi, /company_admin/);
    assert.match(healthApi, /autoRepair: false/);
    assert.doesNotMatch(healthApi, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    assert.doesNotMatch(healthUi, /Исправить автоматически|autoRepair/);
  });

  await check("domain outage and approved SHA checks are executable", () => {
    assert.match(healthScript, /DEPLOYMENT_NOT_FOUND/);
    assert.match(healthScript, /ExpectedSha/);
    assert.match(healthScript, /api\/healthz/);
    assert.match(healthz, /VERCEL_GIT_COMMIT_SHA/);
    assert.match(healthz, /no-store/);
  });

  await check("warm navigation prefetches only adjacent allowed routes", () => {
    const rows = Array.from(dashboardLayout.matchAll(/^\s*"\/[^"]+": \[([^\]]*)\],$/gm));
    assert.ok(rows.length >= 5);
    for (const row of rows) {
      const targets = Array.from(row[1].matchAll(/"\/[^"]+"/g));
      assert.ok(targets.length <= 2, `prefetch row contains ${targets.length} routes`);
    }
    assert.match(dashboardLayout, /requestIdleCallback/);
    assert.match(dashboardLayout, /canAccessPath/);
  });

  await check("recovery and role security evidence are documented without auto-repair", () => {
    for (const scenario of ["Bad deploy", "Bad migration", "Domain alias", "Business-data mistake", "Supabase outage"]) {
      assert.match(recoveryRunbook, new RegExp(scenario, "i"));
    }
    assert.match(securityAudit, /weighbridge operator/i);
    assert.match(securityAudit, /agronomist/i);
    assert.match(securityAudit, /RLS/i);
    assert.doesNotMatch(recoveryRunbook, /auto.?repair/i);
  });

  console.log(`TZ302 QA PASS: ${checks}/${checks}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
