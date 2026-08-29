import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";
import {
  combineOperatorContextKey,
  recentCombineOperatorIds,
  usesPersistentCombineOperator,
} from "@/lib/weighbridge/combine-operator";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let checks = 0;

function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
}

const companyId = "11111111-1111-4111-8111-111111111111";
const seasonId = "22222222-2222-4222-8222-222222222222";
const fieldId = "33333333-3333-4333-8333-333333333333";
const cropId = "44444444-4444-4444-8444-444444444444";
const structureId = "55555555-5555-4555-8555-555555555555";

function harvestTicket(index: number, overrides: Partial<WeighbridgeTicket> = {}): WeighbridgeTicket {
  return {
    id: `ticket-${String(index).padStart(2, "0")}`,
    company_id: companyId,
    season_id: seasonId,
    ticket_no: `TZ308-${index}`,
    ticket_type: "harvest",
    op_type: "harvest_incoming",
    status: "finalized",
    direction: "incoming",
    source_kind: "field",
    destination_kind: "warehouse",
    field_id: fieldId,
    crop_structure_allocation_id: structureId,
    combine_operator_person_id: `person-${String(index).padStart(2, "0")}`,
    weigh_method: "preset_tare",
    is_finalized: true,
    is_voided: false,
    created_at: new Date(Date.UTC(2026, 7, 29, 10, index)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 7, 29, 10, index)).toISOString(),
    lines: [{
      id: `line-${index}`,
      product_id: cropId,
      crop_id: cropId,
      product_name: "Пшеница",
      quantity: 1000,
      uom: "kg",
    }],
    ...overrides,
  };
}

const page = read("app/(dashboard)/weighbridge/page.tsx");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const resourcesRoute = read("app/api/weighbridge/resources/route.ts");
const detailRoute = read("app/api/weighbridge/tickets/[id]/route.ts");
const paper = read("components/weighbridge/weighbridge-ticket-paper.tsx");
const pdf = read("app/api/weighbridge/tickets/[id]/pdf/route.ts");
const migration = read("supabase/migrations/20260829211224_tz308_combine_operator_ticket_v1.sql");

check("migration is additive, nullable and has no backfill", () => {
  assert.match(migration, /add column if not exists combine_operator_person_id uuid/);
  assert.match(migration, /references public\.company_people\(id\)/);
  assert.doesNotMatch(migration, /combine_operator_person_id uuid not null/i);
  assert.doesNotMatch(migration, /update public\.tickets/i);
});

check("server requires combine operator only for harvest incoming", () => {
  assert.match(ticketRoute, /if \(!isHarvestIncoming\) ticket\.combine_operator_person_id = null/);
  assert.match(ticketRoute, /if \(!ticket\.combine_operator_person_id\)[\s\S]*Выберите комбайнера/);
});

check("server validates active person inside the resolved company", () => {
  const validator = read("lib/server/weighbridge-combine-operator.ts");
  assert.match(validator, /\.eq\("company_id", companyId\)/);
  assert.match(validator, /\.eq\("status", "active"\)/);
  assert.match(validator, /\.is\("deleted_at", null\)/);
});

check("resource list contains all active company people but driver list stays role-scoped", () => {
  assert.doesNotMatch(resourcesRoute, /\.in\("role_type", WEIGHBRIDGE_PERSONNEL_ROLES\)/);
  assert.match(resourcesRoute, /peopleRows\.filter\([\s\S]*WEIGHBRIDGE_PERSONNEL_ROLES\.has/);
  assert.match(resourcesRoute, /const combineOperators = peopleRows\.map/);
});

check("combine operator is visible only in the harvest form and is mandatory", () => {
  assert.match(page, /form\.operationType === "harvest_incoming" \? \([\s\S]*label="Комбайнер" required/);
  assert.match(page, /if \(!form\.combineOperatorPersonId\) return "Выберите комбайнера"/);
  assert.match(page, /combine_operator_person_id: form\.operationType === "harvest_incoming"/);
});

check("potato and carrot keep a persistent operator while grain does not", () => {
  assert.equal(usesPersistentCombineOperator({ cropSlug: "potato" }), true);
  assert.equal(usesPersistentCombineOperator({ cropName: "Морковь" }), true);
  assert.equal(usesPersistentCombineOperator({ categorySlug: "vegetable" }), true);
  assert.equal(usesPersistentCombineOperator({ cropSlug: "wheat", categorySlug: "grain" }), false);
});

check("twenty grain operators resolve to the eight latest unique people", () => {
  const tickets = Array.from({ length: 20 }, (_, index) => harvestTicket(index + 1));
  const available = tickets.map((ticket) => String(ticket.combine_operator_person_id));
  const recent = recentCombineOperatorIds(tickets, {
    companyId,
    seasonId,
    cropStructureId: structureId,
    fieldId,
    cropId,
  }, available);
  assert.deepEqual(recent, available.slice(-8).reverse());
});

check("recommendations never cross crop structure identity", () => {
  const otherStructure = "66666666-6666-4666-8666-666666666666";
  const tickets = [
    harvestTicket(1),
    harvestTicket(2, { crop_structure_allocation_id: otherStructure }),
  ];
  const recent = recentCombineOperatorIds(tickets, {
    companyId,
    seasonId,
    cropStructureId: structureId,
    fieldId,
    cropId,
  }, tickets.map((ticket) => String(ticket.combine_operator_person_id)));
  assert.deepEqual(recent, ["person-01"]);
  assert.notEqual(
    combineOperatorContextKey({ companyId, seasonId, cropStructureId: structureId, fieldId, cropId }),
    combineOperatorContextKey({ companyId, seasonId, cropStructureId: otherStructure, fieldId, cropId })
  );
});

check("field and crop fallback is used only without crop structure identity", () => {
  const fallbackTicket = harvestTicket(3, { crop_structure_allocation_id: null });
  const recent = recentCombineOperatorIds([fallbackTicket], {
    companyId,
    seasonId,
    cropStructureId: null,
    fieldId,
    cropId,
  }, ["person-03"]);
  assert.deepEqual(recent, ["person-03"]);
});

check("other-company, voided and unavailable people are excluded from recommendations", () => {
  const tickets = [
    harvestTicket(1),
    harvestTicket(2, { company_id: "77777777-7777-4777-8777-777777777777" }),
    harvestTicket(3, { status: "voided", is_voided: true }),
    harvestTicket(4),
  ];
  const recent = recentCombineOperatorIds(tickets, {
    companyId,
    seasonId,
    cropStructureId: structureId,
    fieldId,
    cropId,
  }, ["person-01"]);
  assert.deepEqual(recent, ["person-01"]);
});

check("successful GROSS keeps vegetables and clears multi-combine crops", () => {
  assert.match(page, /combineOperatorPersonId: persistentCombineOperator \? prev\.combineOperatorPersonId : ""/);
  assert.match(page, /Недавние на этом поле/);
  assert.match(page, /recentCombineOperatorIds\(tickets[\s\S]*?, 8\)/);
});

check("open, closed, detail and PDF ticket views expose the combine operator", () => {
  assert.match(page, /Комбайнер: \$\{combineOperatorNameForTicket\(ticket\)/);
  assert.match(paper, /Fact label="Комбайнер"/);
  assert.match(detailRoute, /enrichTicketCombineOperators/);
  assert.match(pdf, /Combine operator: \$\{combineOperatorName\}/);
});

check("no driver or vehicle relation is persisted for recommendations", () => {
  const helper = read("lib/weighbridge/combine-operator.ts");
  assert.doesNotMatch(helper, /driver_id|vehicle_id|license_plate/);
  assert.match(helper, /crop_structure_allocation_id/);
  assert.match(helper, /field_id/);
});

console.log(`TZ308 ${checks}/${checks} PASS`);
