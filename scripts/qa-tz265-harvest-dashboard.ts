import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildHarvestFilterOptions,
  buildHarvestOverview,
  buildWarehouseHarvestRows,
  isEffectiveFinalizedHarvestTicket,
  isOpenHarvestTicket,
  resolveHarvestPeriod,
} from "../lib/dashboard/harvest-summary";
import { canAccessPath } from "../lib/auth/role-access";
import type { HarvestBatchSummary, WeighbridgeTicket } from "../lib/types/weighbridge";

const root = resolve(__dirname, "..");
const checks: string[] = [];
const check = (name: string, fn: () => void) => { fn(); checks.push(name); };
const period = resolveHarvestPeriod({ preset: "current_day", now: new Date("2026-08-12T07:00:00Z"), operationalDayStartHour: 7 });

function ticket(overrides: Partial<WeighbridgeTicket>): WeighbridgeTicket {
  return {
    id: crypto.randomUUID(), company_id: "c", ticket_no: "T-1", ticket_type: "weighbridge",
    op_type: "harvest_incoming", status: "finalized", direction: "incoming", source_kind: "field",
    destination_kind: "warehouse", weigh_method: "double_weighing", is_finalized: true, is_voided: false,
    net_weight_kg: 1000, gross_weight_kg: 2000, created_at: "2026-08-12T03:00:00Z",
    updated_at: "2026-08-12T04:00:00Z", finalized_at: "2026-08-12T04:00:00Z",
    field_id: "f1", field_name_snapshot: "Поле 28", warehouse_to_id: "w1", warehouse_to_name_snapshot: "Склад 1", season_id: "s1",
    crop_name_snapshot: "Пшеница", variety_name_snapshot: "Астана", reproduction_name_snapshot: "Элита",
    lines: [{ id: crypto.randomUUID(), product_id: "p1", crop_id: "c1", product_name: "Пшеница", quantity: 1000, uom: "kg", moisture_percent: 14, variety_id: "v1", variety_name: "Астана", reproduction_id: "r1", reproduction_name: "Элита", warehouse_to_id: "w1" }],
    ...overrides,
  };
}

const valid = ticket({ ticket_no: "VALID", net_weight_kg: 1200 });
const weighted = ticket({ ticket_no: "WEIGHTED", net_weight_kg: 2400, lines: [{ id: "lw", product_id: "p1", crop_id: "c1", product_name: "Пшеница", quantity: 2400, uom: "kg", moisture_percent: 16, variety_id: "v1", variety_name: "Астана", reproduction_id: "r1", reproduction_name: "Элита", warehouse_to_id: "w1" }] });
const open = ticket({ ticket_no: "OPEN", status: "active", is_finalized: false, net_weight_kg: null, created_at: "2026-08-12T05:00:00Z", weighing_1_at: "2026-08-12T05:00:00Z" });
const voided = ticket({ ticket_no: "VOID", is_voided: true, status: "voided", net_weight_kg: 9000 });
const replaced = ticket({ ticket_no: "OLD", replacement_ticket_id: "replacement", net_weight_kg: 8000 });
const replacement = ticket({ ticket_no: "NEW", correction_of_ticket_id: "old", net_weight_kg: 1300 });
const potato = ticket({ ticket_no: "POTATO", crop_name_snapshot: "Картофель", net_weight_kg: 500, lines: [{ id: "l2", product_id: "p2", crop_id: "c2", product_name: "Картофель", quantity: 500, uom: "kg", moisture_percent: 88, variety_id: "v2", variety_name: "Гала", reproduction_id: "r2", reproduction_name: "Элита", warehouse_to_id: "w1" }] });
const supplier = ticket({ ticket_no: "SUPPLIER", op_type: "supplier_receipt", net_weight_kg: 100000 });

check("operational day starts at 07:00 local", () => {
  assert.equal(period.start, "2026-08-12T02:00:00.000Z");
  assert.equal(period.end, "2026-08-12T07:00:00.000Z");
  assert.match(period.label, /12\.08\.2026 07:00 — сейчас/);
});
check("previous operational day is exact 24 hour boundary", () => {
  const previous = resolveHarvestPeriod({ preset: "previous_day", now: new Date("2026-08-12T07:00:00Z"), operationalDayStartHour: 7 });
  assert.equal(new Date(previous.end).getTime() - new Date(previous.start).getTime(), 86_400_000);
});
check("effective finalized contract", () => {
  assert.equal(isEffectiveFinalizedHarvestTicket(valid), true);
  assert.equal(isEffectiveFinalizedHarvestTicket(voided), false);
  assert.equal(isEffectiveFinalizedHarvestTicket(replaced), false);
  assert.equal(isEffectiveFinalizedHarvestTicket(replacement), true);
});
check("open contract", () => { assert.equal(isOpenHarvestTicket(open), true); assert.equal(isOpenHarvestTicket(valid), false); });

const stockRows = [
  { key: "lot-1-w1", harvestLotId: "lot-1", seasonId: "s1", warehouseId: "w1", cropId: "c1", varietyId: "v1", reproductionId: "r1", warehouseName: "Склад 1", identityLabel: "Пшеница · Астана · Элита", currentKg: 4200, trips: 3, requiresReview: false },
  { key: "lot-1-w2", harvestLotId: "lot-1", seasonId: "s1", warehouseId: "w2", cropId: "c1", varietyId: "v1", reproductionId: "r1", warehouseName: "Склад 2", identityLabel: "Пшеница · Астана · Элита", currentKg: 800, trips: 1, requiresReview: false },
];
valid.harvest_lot_id = "lot-1";
weighted.harvest_lot_id = "lot-1";
open.harvest_lot_id = null;
replacement.harvest_lot_id = "lot-1";
const secondField = ticket({ ticket_no: "FIELD-2", harvest_lot_id: "lot-1", field_id: "f2", field_name_snapshot: "Поле 52-1", net_weight_kg: 900 });
const summary = buildHarvestOverview([valid, weighted, secondField, open, voided, replaced, replacement, potato, supplier], { period, now: new Date("2026-08-12T07:00:00Z"), warehouseRows: stockRows });
check("only effective finalized harvest contributes", () => assert.equal(summary.cropTotals.reduce((sum, row) => sum + row.receivedKg, 0), 1200 + 2400 + 900 + 1300 + 500));
check("cultures stay separate", () => { assert.equal(summary.cropTotals.length, 2); assert.equal(summary.cropTotals.find((row) => row.cropName === "Картофель")?.receivedKg, 500); });
check("open ticket stays outside received mass", () => assert.equal(summary.openTickets.length, 1));
check("field total equals completed harvest total", () => assert.equal(summary.fields.reduce((sum, row) => sum + row.receivedKg, 0), 1200 + 2400 + 900 + 1300 + 500));
check("field includes last trip and destination", () => { assert.ok(summary.fields.every((row) => row.lastTripAt && row.destinationName)); });
check("potato moisture block is absent", () => assert.equal(summary.moisture.some((row) => row.cropName === "Картофель"), false));
check("moisture is mass weighted", () => {
  const wheat = summary.moisture[0];
  assert.equal(wheat.measuredTrips, 3);
  assert.equal(wheat.totalTrips, 3);
  assert.equal(Math.round(wheat.averagePercent * 1000) / 1000, Math.round(((14 * 1200 + 16 * 2400 + 14 * 1300) / 4900) * 1000) / 1000);
  assert.equal(wheat.minimumPercent, 14);
  assert.equal(wheat.maximumPercent, 16);
});
check("crop filter applies consistently", () => {
  const filtered = buildHarvestOverview([valid, potato], { period, filters: { cropId: "c2" } });
  assert.deepEqual(filtered.cropTotals.map((row) => row.cropName), ["Картофель"]);
});
check("filter options use canonical ids", () => {
  const options = buildHarvestFilterOptions([valid, potato]);
  assert.equal(options.crops.length, 2);
  assert.equal(options.fields[0].id, "f1");
});

const batch = { id: "b", warehouseId: "w1", warehouseName: "Склад 1", cropId: "c1", cropName: "Пшеница", varietyId: "v1", varietyName: "Астана", reproductionId: "r1", reproductionName: "Элита", cleanMassKg: 4200, tripCount: 3, reviewState: "confirmed" } as HarvestBatchSummary;
check("warehouse uses canonical current mass", () => assert.equal(buildWarehouseHarvestRows([batch])[0].currentKg, 4200));
check("warehouse filters are independent of period", () => assert.equal(buildWarehouseHarvestRows([batch], { cropId: "other" }).length, 0));
check("one party groups two fields", () => {
  const party = summary.parties.find((row) => row.key === "lot:lot-1");
  assert.equal(party?.fields.length, 2);
  assert.equal(party?.receivedKg, 5800);
});
check("one party groups two warehouses", () => {
  const party = summary.parties.find((row) => row.key === "lot:lot-1");
  assert.equal(party?.warehouses.length, 2);
  assert.equal(party?.currentStockKg, 5000);
});
check("open ticket stays in party but outside mass", () => {
  const party = summary.parties.find((row) => row.key === "lot:lot-1");
  assert.equal(party?.openTicketCount, 1);
  assert.equal(party?.completedTicketCount, 4);
});
check("open ticket resolves to canonical stock party without lot link", () => {
  assert.equal(summary.parties.some((row) => row.key.startsWith("identity:") && row.openTicketCount > 0), false);
});
check("live open to completed transition preserves party", () => {
  const completedOpen = ticket({ ...open, status: "finalized", is_finalized: true, net_weight_kg: 700, finalized_at: "2026-08-12T06:00:00Z", updated_at: "2026-08-12T06:00:00Z" });
  const before = buildHarvestOverview([valid, open], { period, now: new Date("2026-08-12T07:00:00Z"), warehouseRows: stockRows });
  const after = buildHarvestOverview([valid, completedOpen], { period, now: new Date("2026-08-12T07:00:00Z"), warehouseRows: stockRows });
  assert.equal(before.parties[0].key, "lot:lot-1");
  assert.equal(after.parties[0].key, "lot:lot-1");
  assert.equal(before.parties[0].openTicketCount, 1);
  assert.equal(after.parties[0].openTicketCount, 0);
  assert.equal(after.parties[0].receivedKg, 1900);
});
check("field filter changes contribution not party identity", () => {
  const filtered = buildHarvestOverview([valid, secondField], { period, filters: { fieldId: "f2" }, warehouseRows: stockRows });
  assert.equal(filtered.parties.length, 1);
  assert.equal(filtered.parties[0].key, "lot:lot-1");
  assert.equal(filtered.parties[0].receivedKg, 900);
});
check("warehouse filter changes stock slice not party identity", () => {
  const filtered = buildHarvestOverview([valid], { period, filters: { warehouseId: "w2" }, warehouseRows: stockRows });
  assert.equal(filtered.parties.length, 1);
  assert.equal(filtered.parties[0].key, "lot:lot-1");
  assert.equal(filtered.parties[0].currentStockKg, 800);
});
check("different reproduction creates different party", () => {
  const other = ticket({ harvest_lot_id: "lot-2", reproduction_name_snapshot: "Первая репродукция", lines: [{ id: "other", product_id: "p1", crop_id: "c1", product_name: "Пшеница", quantity: 1000, uom: "kg", moisture_percent: 14, variety_id: "v1", variety_name: "Астана", reproduction_id: "r2", reproduction_name: "Первая репродукция", warehouse_to_id: "w1" }] });
  assert.equal(buildHarvestOverview([valid, other], { period }).parties.length, 2);
});
check("unknown identity remains provisional party", () => {
  const unknown = ticket({ harvest_lot_id: null, reproduction_name_snapshot: null, lines: [{ id: "unknown", product_id: "p1", crop_id: "c1", product_name: "Пшеница", quantity: 1000, uom: "kg", moisture_percent: 14, variety_id: "v1", variety_name: "Астана", reproduction_id: null, reproduction_name: "-", warehouse_to_id: "w1" }] });
  const result = buildHarvestOverview([valid, unknown], { period });
  assert.equal(result.parties.length, 2);
  assert.ok(result.parties.some((row) => !row.complete && row.identityLabel.includes("Требуется уточнение")));
});
check("party moisture is absent for potato", () => assert.equal(summary.parties.find((row) => row.cropName === "Картофель")?.moisture, null));
check("potato has no missing moisture issue", () => assert.equal(summary.parties.find((row) => row.cropName === "Картофель")?.issues.some((issue) => issue.kind === "missing_moisture"), false));

const roleAccess = readFileSync(resolve(root, "lib/auth/role-access.ts"), "utf8");
const sidebar = readFileSync(resolve(root, "components/layout/sidebar.tsx"), "utf8");
const assistantShell = readFileSync(resolve(root, "lib/assistant/shell.ts"), "utf8");
const assistantLauncher = readFileSync(resolve(root, "components/assistant/assistant-launcher.tsx"), "utf8");
const assistantPanel = readFileSync(resolve(root, "components/assistant/assistant-panel.tsx"), "utf8");
const serverSession = readFileSync(resolve(root, "lib/auth/server-session.ts"), "utf8");
const mobileNav = readFileSync(resolve(root, "components/layout/mobile-bottom-nav.tsx"), "utf8");
const dashboardApi = readFileSync(resolve(root, "app/api/dashboard/harvest-summary/route.ts"), "utf8");
const dashboardUi = readFileSync(resolve(root, "components/dashboard/harvest-dashboard.tsx"), "utf8");
check("agronomist/director routes limited", () => {
  assert.match(roleAccess, /AGRONOMIST_ALLOWED_PREFIXES = \[\s*"\/dashboard",\s*"\/crop-structure",\s*"\/weather-lab",\s*"\/tickets",\s*"\/auth"/);
  assert.match(roleAccess, /DIRECTOR_ALLOWED_PREFIXES = \[\s*"\/dashboard",\s*"\/auth"/);
});
check("director cannot open warehouse or ticket routes", () => {
  assert.equal(canAccessPath("director", "/dashboard"), true);
  assert.equal(canAccessPath("director", "/warehouses"), false);
  assert.equal(canAccessPath("director", "/tickets"), false);
  assert.equal(canAccessPath("director", "/settings"), false);
});
check("agronomist menus contain the five approved routes", () => {
  assert.match(sidebar, /const AGRONOMIST_NAV[\s\S]*?harvest_summary[\s\S]*?crop_structure[\s\S]*?warehouses[\s\S]*?tickets_nav[\s\S]*?weather/);
  assert.match(mobileNav, /case "agronomist":[\s\S]*?harvest_summary[\s\S]*?crop_structure[\s\S]*?warehouses[\s\S]*?tickets_nav[\s\S]*?weather/);
});
check("director menus contain dashboard only", () => {
  assert.match(sidebar, /const DIRECTOR_NAV:[\s\S]*?harvest_summary[\s\S]*?\];/);
  assert.match(mobileNav, /case "director":[\s\S]*?return \[\{ labelKey: "harvest_summary"/);
});
check("assistant is global admin only", () => {
  assert.match(assistantShell, /AssistantAllowedRole = "global_admin"/);
  assert.match(assistantLauncher, /if \(!enabled\) return null/);
  assert.match(assistantPanel, /if \(!enabled\) return null/);
});
check("director server mutations blocked", () => assert.match(serverSession, /Director access is read-only/));
check("dashboard API does not cap harvest at one thousand rows", () => assert.match(dashboardApi, /\.range\(from, from \+ pageSize - 1\)/));
check("dashboard groups around parties", () => {
  assert.match(dashboardUi, /Партии в уборке/);
  assert.match(dashboardUi, /На складах сейчас/);
  assert.match(dashboardUi, /Принято за период/);
  assert.doesNotMatch(dashboardUi, /Поступление по культурам/);
});
check("expanded state survives live refresh", () => assert.match(dashboardUi, /expandedParties/));
check("live refresh uses existing weighbridge tables", () => assert.match(dashboardUi, /LIVE_REFRESH_TABLES\.weighbridge/));

console.log(`TZ265 PASS ${checks.length}/${checks.length}`);
for (const name of checks) console.log(`PASS ${name}`);
