import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aggregateHarvestTickets } from "../lib/weighbridge/harvest-summary";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

type PaperTrip = {
  companyId: string;
  operationType: "harvest_incoming";
  externalReference: string;
  recordedAt: string;
  grossKg: number;
  tareKg: number;
  moisturePercent: number | null;
};

export function paperTripDuplicateKey(trip: PaperTrip) {
  const date = new Date(trip.recordedAt);
  assert.equal(Number.isNaN(date.getTime()), false, "recordedAt must be a valid instant");
  const localDay = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  return `${trip.companyId}:${trip.operationType}:${localDay}:${trip.externalReference.trim().toLocaleLowerCase("ru-RU")}`;
}

const base: PaperTrip = {
  companyId: "company-a",
  operationType: "harvest_incoming",
  externalReference: "Журнал 184",
  recordedAt: "2026-08-18T07:30:00+05:00",
  grossKg: 29_000,
  tareKg: 9_900,
  moisturePercent: 17.3,
};

assert.equal(base.grossKg - base.tareKg, 19_100);
assert.equal(paperTripDuplicateKey(base), paperTripDuplicateKey({ ...base, grossKg: 30_000 }));
assert.notEqual(paperTripDuplicateKey(base), paperTripDuplicateKey({ ...base, externalReference: "Журнал 185" }));
assert.notEqual(paperTripDuplicateKey(base), paperTripDuplicateKey({ ...base, recordedAt: "2026-08-19T07:30:00+05:00" }));

const aggregate = aggregateHarvestTickets([
  { net_weight_kg: 10_000, lines: [{ moisture_percent: 10 }] },
  { net_weight_kg: 30_000, lines: [{ moisture_percent: 20 }] },
  { net_weight_kg: 5_000, lines: [{ moisture_percent: null }] },
]);
assert.equal(aggregate.netKg, 45_000);
assert.equal(aggregate.trips, 3);
assert.equal(aggregate.measuredMoistureTrips, 2);
assert.equal(aggregate.averageMoisture, 17.5);

const weighbridgePage = read("app/(dashboard)/weighbridge/page.tsx");
const ticketsPage = read("app/(dashboard)/tickets/page.tsx");
const ticketService = read("lib/services/weighbridge.ts");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");

assert.doesNotMatch(weighbridgePage, /Исторический талон из бумажного журнала/);
assert.doesNotMatch(weighbridgePage, /Номер бумажного талона/);
assert.doesNotMatch(weighbridgePage, /type="datetime-local"/);
assert.doesNotMatch(weighbridgePage, /Бумажная тара, кг/);
assert.match(weighbridgePage, /external_document_no: form\.operationType === "shipment_outbound" \|\| form\.operationType === "harvest_incoming"/);
assert.match(weighbridgePage, /paperRecordedDate && paperDayStart[\s\S]*?recorded_at: paperRecordedDate\.toISOString\(\)[\s\S]*?tare_weight_kg: Number\(form\.paperTareKg\)[\s\S]*?: undefined/);
assert.match(weighbridgePage, /paper_backfill\?\.ok === true[\s\S]*?Исторический талон проведён/);
assert.match(weighbridgePage, /paperDocumentNo \? t\.created_at : \(t\.finalized_at \|\| t\.updated_at \|\| t\.created_at\)/);
assert.match(weighbridgePage, /Бумажный №/);
assert.match(weighbridgePage, /Бумажная тара:/);

assert.match(ticketService, /paperBackfill\?: \{[\s\S]*?recorded_at: string;[\s\S]*?tare_weight_kg: number;/);
assert.match(ticketService, /JSON\.stringify\(\{ ticket: input, lines, weighings, paperBackfill \}\)/);
assert.match(ticketRoute, /const rawPaperBackfill = body\?\.paperBackfill/);
assert.match(ticketRoute, /!String\(ticket\.external_document_no \|\| ""\)\.trim\(\)/);
assert.match(ticketRoute, /paperBackfill \? \{ created_at: paperBackfill\.recordedAt, updated_at: paperBackfill\.recordedAt \} : \{\}/);
assert.match(ticketRoute, /close_harvest_ticket_atomic/);
assert.match(ticketRoute, /p_tare_weight_kg: backfill\.tareWeightKg/);

assert.match(ticketsPage, /function paperDocumentNo/);
assert.match(ticketsPage, /function ticketDayAt/);
assert.match(ticketsPage, /paperDocumentNo\(ticket\) \? ticket\.created_at : \(ticket\.finalized_at \|\| ticket\.updated_at\)/);
assert.match(ticketsPage, /paperNo \? ticket\.created_at : \(finalized \? ticket\.finalized_at : ticket\.created_at\)/);
assert.match(ticketsPage, /Бумажный №/);
assert.match(ticketsPage, /Тара:/);
assert.match(ticketsPage, /Дата рейса:/);

console.log("TZ301 paper backfill regression: PASS");
