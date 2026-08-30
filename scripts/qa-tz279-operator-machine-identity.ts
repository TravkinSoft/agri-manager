import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOADING_OPERATOR, UNRECORDED_OPERATOR, ticketOperatorFacts } from "../lib/weighbridge/ticket-operator";
import { resolveTransportIdentity, transportPickerLabel } from "../lib/weighbridge/transport";
import type { WeighbridgeTicket } from "../lib/types/weighbridge";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
let checks = 0;
const check = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
};

const ticket = (values: Partial<WeighbridgeTicket>): WeighbridgeTicket => ({
  id: "ticket",
  company_id: "company",
  ticket_no: "WB-TEST",
  ticket_type: "weighbridge",
  op_type: "harvest_incoming",
  status: "finalized",
  direction: "incoming",
  source_kind: "field",
  destination_kind: "warehouse",
  created_at: "2026-08-18T00:00:00Z",
  updated_at: "2026-08-18T00:00:00Z",
  weigh_method: "double_weighing",
  is_finalized: true,
  is_voided: false,
  ...values,
});

check("MTZ with a real plate has one canonical label", () => {
  assert.equal(transportPickerLabel({
    name: "МТЗ 82 #3",
    brand: "МТЗ",
    model: "82",
    license_plate: "T 075 ALB",
  }), "МТЗ 82 · T 075 ALB");
});

check("MTZ without a confirmed plate hides the synthetic suffix", () => {
  assert.equal(transportPickerLabel({
    name: "МТЗ 82 #2",
    brand: "МТЗ",
    model: "82",
  }), "МТЗ 82");
});

check("HOWO internal source row is not rendered as a plate", () => {
  assert.equal(transportPickerLabel({
    name: "HOWO",
    brand: "HOWO",
    model: "ZZ3327S3847E",
    plate_number: "OSV-ROW-128",
  }), "HOWO ZZ3327S3847E");
});

check("hidden import fields remain searchable", () => {
  const identity = resolveTransportIdentity({
    name: "МТЗ 82 #2",
    brand: "МТЗ",
    model: "82",
    source_raw_name: "Трактор Беларус-82,1 Т 718 ABB",
  });
  assert.equal(identity.label, "МТЗ 82");
  assert.ok(identity.searchTerms.includes("МТЗ 82 #2"));
  assert.ok(identity.searchTerms.includes("Трактор Беларус-82,1 Т 718 ABB"));
});

check("known person id never renders false unrecorded operator", () => {
  const facts = ticketOperatorFacts(ticket({ created_by_person_id: "person-id" }));
  assert.equal(facts[0]?.value, LOADING_OPERATOR);
  assert.notEqual(facts[0]?.value, UNRECORDED_OPERATOR);
});

check("same hydrated person is rendered once", () => {
  assert.deepEqual(ticketOperatorFacts(ticket({
    created_by_person_id: "person-id",
    finalized_by_person_id: "person-id",
    opened_by_person_name: "Потоцкая Людмила Андреевна",
    finalized_by_person_name: "Потоцкая Людмила Андреевна",
  })), [{ label: "Весовщик", value: "Потоцкая Людмила Андреевна" }]);
});

const attribution = read("lib/server/weighbridge-ticket-attribution.ts");
const createRoute = read("app/api/weighbridge/tickets/route.ts");
const finalizeRoute = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const resourcesRoute = read("app/api/weighbridge/resources/route.ts");
const detailRoute = read("app/api/weighbridge/tickets/[id]/route.ts");
const pdfRoute = read("app/api/weighbridge/tickets/[id]/pdf/route.ts");
const batchesRoute = read("app/api/weighbridge/harvest-batches/route.ts");
const dashboardRoute = read("app/api/dashboard/harvest-summary/route.ts");
const picker = read("components/weighbridge/transport-driver-picker.tsx");
const page = read("app/(dashboard)/weighbridge/page.tsx");

check("finalized attribution falls back through created person before shift", () => {
  assert.match(attribution, /finalized_by_person_id[\s\S]*?openedPersonId \|\| shiftPersonId/);
});

check("create response is hydrated immediately", () => {
  assert.match(createRoute, /opened_by_person_name:\s*operatorSession\.operator\.name/);
  assert.match(createRoute, /enrichTicketOperatorAttribution[\s\S]*?idempotent_replay/);
});

check("finalize response is hydrated immediately", () => {
  assert.match(finalizeRoute, /enrichTicketOperatorAttribution\(supabase, companyId, \[updatedResult\.data\]\)/);
});

check("optimistic ticket preserves canonical operator person", () => {
  assert.match(page, /created_by_person_id:\s*operatorState\.operator\?\.id/);
  assert.match(page, /opened_by_person_name:\s*operatorState\.operator\?\.name/);
});

check("picker resources use only the vehicle fleet identity helper", () => {
  assert.match(resourcesRoute, /resolveTransportIdentity\(row\)/);
  assert.match(resourcesRoute, /source:\s*"reference_vehicles"/);
  assert.doesNotMatch(resourcesRoute, /from\("reference_machines"\)/);
  assert.doesNotMatch(resourcesRoute, /source:\s*"reference_machines"/);
});

check("picker searches hidden canonical terms", () => {
  assert.match(picker, /\.\.\.\(vehicle\.searchTerms \|\| \[\]\)/);
});

check("ticket detail, PDF, warehouse and dashboard use canonical transport", () => {
  assert.match(detailRoute, /resolveTransportIdentity/);
  assert.match(pdfRoute, /transportPickerLabel/);
  assert.match(batchesRoute, /resolveTransportIdentity/);
  assert.match(dashboardRoute, /resolveTransportIdentity/);
});

assert.equal(checks, 13);
console.log(`TZ279 regression PASS: ${checks}/13`);
