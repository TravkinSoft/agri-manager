import assert from "node:assert/strict";
import { aggregateHarvestTickets } from "../lib/weighbridge/harvest-summary";

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

console.log("TZ301 paper backfill regression: PASS");
