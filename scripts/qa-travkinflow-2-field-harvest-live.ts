import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildFieldHarvestProjection,
  type FieldHarvestLedgerRow,
  type FieldHarvestTicketRow,
} from "../lib/fields/field-harvest";

let passed = 0;

function check(name: string, assertion: () => void) {
  assertion();
  passed += 1;
  console.log(`PASS ${name}`);
}

const scope = { companyId: "company-1", seasonId: "season-2026", fieldId: "field-19" };
const ticket = (overrides: Partial<FieldHarvestTicketRow> = {}): FieldHarvestTicketRow => ({
  id: "ticket-1",
  company_id: scope.companyId,
  season_id: scope.seasonId,
  field_id: scope.fieldId,
  crop_structure_allocation_id: "allocation-1",
  op_type: "harvest_incoming",
  status: "finalized",
  is_finalized: true,
  is_voided: false,
  replacement_ticket_id: null,
  accepted_weight_kg: 12_000,
  net_weight_kg: 12_200,
  finalized_at: "2026-09-09T06:00:00.000Z",
  ...overrides,
});
const ledger = (overrides: Partial<FieldHarvestLedgerRow> = {}): FieldHarvestLedgerRow => ({
  ticket_id: "ticket-1",
  company_id: scope.companyId,
  direction: "in",
  delta_qty_signed: 12_000,
  reason_type: "harvest_incoming_in",
  is_storno: false,
  ...overrides,
});

const projection = buildFieldHarvestProjection({
  ...scope,
  fieldAreaHa: 20,
  tickets: [
    ticket(),
    ticket({
      id: "ticket-2",
      crop_structure_allocation_id: "allocation-2",
      accepted_weight_kg: null,
      net_weight_kg: 3_000,
      finalized_at: "2026-09-09T07:00:00.000Z",
    }),
    ticket({
      id: "ticket-3",
      crop_structure_allocation_id: null,
      accepted_weight_kg: 1_000,
      finalized_at: "2026-09-09T08:00:00.000Z",
    }),
    ticket({ id: "draft", status: "active", is_finalized: false }),
    ticket({ id: "voided", is_voided: true }),
    ticket({ id: "flag-only", status: "ready_to_close" }),
    ticket({ id: "status-only", is_finalized: false }),
    ticket({ id: "replaced", replacement_ticket_id: "replacement" }),
    ticket({ id: "other-company", company_id: "company-2" }),
    ticket({ id: "other-season", season_id: "season-2025" }),
    ticket({ id: "other-field", field_id: "field-20" }),
    ticket({ id: "other-op", op_type: "supplier_receipt" }),
  ],
  ledgerEntries: [
    ledger(),
    ledger({ ticket_id: "ticket-2", delta_qty_signed: 3_000, reason_type: "harvest_incoming" }),
    ledger({ ticket_id: "ticket-3", delta_qty_signed: 1_000 }),
    ledger({ delta_qty_signed: 99, is_storno: true }),
    ledger({ delta_qty_signed: 99, reason_type: "warehouse_transfer_in" }),
    ledger({ delta_qty_signed: -12_000 }),
  ],
  structureRows: [
    { id: "allocation-1", ...{
      company_id: scope.companyId,
      season_id: scope.seasonId,
      field_id: scope.fieldId,
      land_use_type: "crop",
      area: 10,
    } },
    {
      id: "allocation-2",
      company_id: scope.companyId,
      season_id: scope.seasonId,
      field_id: scope.fieldId,
      land_use_type: "crop_mix",
      area: 5,
    },
    {
      id: "fallow",
      company_id: scope.companyId,
      season_id: scope.seasonId,
      field_id: scope.fieldId,
      land_use_type: "fallow",
      area: 5,
    },
    { id: "foreign", company_id: "company-2", area: 100 },
  ],
  fetchedAt: "2026-09-09T08:00:01.000Z",
});

check("strict effective ticket set excludes drafts, voids, replacements and foreign scopes", () => {
  assert.equal(projection.finalizedTicketCount, 3);
  assert.equal(projection.acceptedMassKg, 16_000);
});

check("accepted mass prefers accepted_weight_kg and falls back to net weight", () => {
  assert.equal(projection.acceptedMassKg, 12_000 + 3_000 + 1_000);
});

check("yield uses the selected season crop structure area and excludes fallow", () => {
  assert.equal(projection.yieldAreaHa, 15);
  assert.equal(projection.yieldBasis, "season_structure_area");
  assert.equal(projection.yieldTPerHa, 1.067);
});

check("allocation projection keeps mass and yield tied to allocation id", () => {
  assert.deepEqual(projection.byAllocation, [
    { allocationId: "allocation-1", areaHa: 10, acceptedMassKg: 12_000, finalizedTicketCount: 1, yieldTPerHa: 1.2 },
    { allocationId: "allocation-2", areaHa: 5, acceptedMassKg: 3_000, finalizedTicketCount: 1, yieldTPerHa: 0.6 },
  ]);
  assert.equal(projection.unassignedAcceptedMassKg, 1_000);
});

check("ledger reconciliation only accepts non-storno incoming harvest entries", () => {
  assert.equal(projection.ledgerMassKg, 16_000);
  assert.equal(projection.ledgerTicketCount, 3);
  assert.equal(projection.reconciliationStatus, "reconciled");
});

check("latest timestamp belongs to the latest effective ticket", () => {
  assert.equal(projection.latestFinalizedAt, "2026-09-09T08:00:00.000Z");
});

check("partial ledger is surfaced as mismatch without changing ticket mass", () => {
  const mismatch = buildFieldHarvestProjection({
    ...scope,
    fieldAreaHa: 20,
    tickets: [ticket(), ticket({ id: "ticket-2", accepted_weight_kg: 3_000 })],
    ledgerEntries: [ledger()],
    structureRows: [],
  });
  assert.equal(mismatch.acceptedMassKg, 15_000);
  assert.equal(mismatch.ledgerMassKg, 12_000);
  assert.equal(mismatch.reconciliationStatus, "mismatch");
  assert.equal(mismatch.yieldBasis, "field_area");
});

check("missing and unavailable ledger states stay explicit", () => {
  const base = { ...scope, fieldAreaHa: 20, tickets: [ticket()], structureRows: [] };
  assert.equal(buildFieldHarvestProjection({ ...base, ledgerEntries: [] }).reconciliationStatus, "ticket_only");
  assert.equal(buildFieldHarvestProjection({ ...base, ledgerEntries: [], ledgerAvailable: false }).reconciliationStatus, "unavailable");
});

check("empty effective register does not invent zero yield", () => {
  const empty = buildFieldHarvestProjection({
    ...scope,
    fieldAreaHa: 20,
    tickets: [ticket({ status: "active", is_finalized: false })],
    ledgerEntries: [ledger()],
    structureRows: [],
  });
  assert.equal(empty.acceptedMassKg, 0);
  assert.equal(empty.yieldTPerHa, null);
  assert.equal(empty.reconciliationStatus, "empty");
});

const route = readFileSync(
  resolve(process.cwd(), "app/api/crop-structure/field-harvest-summary/route.ts"),
  "utf8"
);
const component = readFileSync(
  resolve(process.cwd(), "components/crop-structure/field-harvest-live.tsx"),
  "utf8"
);
const page = readFileSync(
  resolve(process.cwd(), "app/(dashboard)/crop-structure/page.tsx"),
  "utf8"
);
const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

check("route scopes effective tickets by company, season and field", () => {
  assert.match(route, /\.eq\("company_id", scope\.companyId\)/);
  assert.match(route, /\.eq\("season_id", scope\.seasonId\)/);
  assert.match(route, /\.eq\("field_id", scope\.fieldId\)/);
  assert.match(route, /\.eq\("op_type", "harvest_incoming"\)/);
  assert.match(route, /\.eq\("status", "finalized"\)/);
  assert.match(route, /\.eq\("is_finalized", true\)/);
  assert.match(route, /\.eq\("is_voided", false\)/);
  assert.match(route, /\.is\("replacement_ticket_id", null\)/);
});

check("route is read-only and never mutates ticket or ledger rows", () => {
  assert.doesNotMatch(route, /\.(insert|update|upsert|delete)\s*\(/);
});

check("client retains exact-scope data and exposes stale/error states", () => {
  assert.match(component, /projectionCache\.get\(key\)/);
  assert.match(component, /phase: retained \? "stale" : "error"/);
  assert.match(component, /AbortController/);
  assert.match(component, /FIELD_HARVEST_REFRESH_MS = 30_000/);
  assert.match(component, /Показаны последние подтверждённые данные/);
});

check("field modal mounts the projection behind an independently reversible flag", () => {
  assert.match(page, /NEXT_PUBLIC_FIELD_HARVEST_LIVE_V2\s*===\s*["']1["']/);
  assert.match(envExample, /^NEXT_PUBLIC_FIELD_HARVEST_LIVE_V2=0$/m);
  assert.match(page, /<FieldHarvestLive[\s\S]*?companyId=\{activeCompanyId\}[\s\S]*?seasonId=\{seasonId\}[\s\S]*?fieldId=\{selectedField\.id\}/);
});

console.log(JSON.stringify({
  suite: "TravkinFlow 2 field harvest live",
  total: passed,
  passed,
  failed: 0,
}, null, 2));
