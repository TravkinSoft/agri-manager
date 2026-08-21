import assert from "node:assert/strict";
import { verifyWeighbridgeTruth } from "../lib/weighbridge-truth/engine";
import type { TruthSnapshot } from "../lib/weighbridge-truth/types";
import { cloneSnapshot, finalizedHarvestSnapshot, FIXTURE_IDS, openGrossSnapshot, secondTicket, stableFingerprint } from "./qa/weighbridge-truth-fixtures";

interface Scenario {
  name: string;
  make: () => TruthSnapshot;
  expectedCodes?: string[];
  forbiddenCodes?: string[];
  expectP0?: boolean;
  idempotent?: boolean;
}

function processingSnapshot(options: { difference: number; output: number; moisture?: boolean; draft?: boolean }): TruthSnapshot {
  const snapshot = finalizedHarvestSnapshot();
  snapshot.transformations.push({ id: "tr-1", companyId: FIXTURE_IDS.COMPANY, sourceTicketId: FIXTURE_IDS.TICKET, harvestLotId: FIXTURE_IDS.LOT,
    transformationType: "cleaning", status: options.draft ? "draft" : "completed", inputTotalKg: 20_000, outputTotalKg: options.output,
    massDifferenceKg: options.difference, qualityState: options.draft ? "draft" : "confirmed" });
  snapshot.transformationInputs.push({ id: "in-1", companyId: FIXTURE_IDS.COMPANY, transformationId: "tr-1", batchId: FIXTURE_IDS.BATCH,
    sourceTicketId: FIXTURE_IDS.TICKET, inputKg: 20_000, moisturePercent: options.moisture ? 18 : null });
  snapshot.transformationOutputs.push({ id: "out-1", companyId: FIXTURE_IDS.COMPANY, transformationId: "tr-1", batchId: "batch-out",
    sourceTicketId: null, lineType: "product", outputRole: "product", outputKg: options.output, moisturePercent: options.moisture ? 14 : null });
  return snapshot;
}

const scenarios: Scenario[] = [
  { name: "01 normal gross", make: openGrossSnapshot, expectP0: false },
  { name: "02 tare close", make: finalizedHarvestSnapshot, expectP0: false },
  { name: "03 duplicate finalize retry is idempotent", make: finalizedHarvestSnapshot, forbiddenCodes: ["DUPLICATE_ACTIVE_LEDGER_ENTRY"], idempotent: true },
  { name: "04 correction before finish", make: () => { const s = openGrossSnapshot(); s.tickets.push(secondTicket(s.tickets[0], { correctionOfTicketId: FIXTURE_IDS.TICKET, vehicleId: "vehicle-2", driverId: "driver-2" })); return s; }, expectP0: false },
  { name: "05 correction after finish blocks double active", make: () => { const s = finalizedHarvestSnapshot(); s.tickets.push(secondTicket(s.tickets[0], { correctionOfTicketId: FIXTURE_IDS.TICKET })); return s; }, expectedCodes: ["CORRECTION_DOUBLE_ACTIVE"], expectP0: true },
  { name: "06 storno balances void", make: () => { const s = finalizedHarvestSnapshot(); s.tickets[0].isVoided = true; s.ledgerEntries.push({ ...s.ledgerEntries[0], id: "storno-1", deltaKg: -20_000, isStorno: true, stornoOfEntryId: "ledger-1" }); return s; }, forbiddenCodes: ["VOIDED_TICKET_NONZERO_IMPACT"], expectP0: false },
  { name: "07 void without storno", make: () => { const s = finalizedHarvestSnapshot(); s.tickets[0].isVoided = true; return s; }, expectedCodes: ["VOIDED_TICKET_NONZERO_IMPACT"], expectP0: true },
  { name: "08 multi trip same aggregate lot", make: () => { const s = finalizedHarvestSnapshot(); const second = secondTicket(s.tickets[0], { vehicleId: "vehicle-2", driverId: "driver-2", netKg: 10_000, grossKg: 18_000, tareKg: 8_000 }); s.tickets.push(second); return s; }, forbiddenCodes: ["DUPLICATE_CONFIRMED_AGGREGATE_LOT"] },
  { name: "09 different reproduction separate lot", make: () => { const s = finalizedHarvestSnapshot(); s.lots.push({ ...s.lots[0], id: "lot-2", lotCode: "LOT-2", reproductionId: "repro-2", identityKey: `${FIXTURE_IDS.SEASON}|${FIXTURE_IDS.CROP}|${FIXTURE_IDS.VARIETY}|repro-2` }); return s; }, forbiddenCodes: ["DUPLICATE_CONFIRMED_AGGREGATE_LOT"] },
  { name: "10 field changes do not split lot", make: () => { const s = finalizedHarvestSnapshot(); const batch = { ...s.batches[0], id: "batch-2", sourceFieldId: "field-2", batchCode: "HAR-2" }; s.batches.push(batch); s.lotBatches.push({ id: "lot-batch-2", companyId: FIXTURE_IDS.COMPANY, lotId: FIXTURE_IDS.LOT, batchId: batch.id, sourceTicketId: FIXTURE_IDS.TICKET }); return s; }, forbiddenCodes: ["LOT_IDENTITY_CONFLICT"] },
  { name: "11 processing input", make: () => processingSnapshot({ difference: 1_000, output: 19_000 }), expectP0: false },
  { name: "12 processing output", make: () => processingSnapshot({ difference: 1_000, output: 19_000 }), expectP0: false },
  { name: "13 processing last truck", make: () => processingSnapshot({ difference: 500, output: 19_500 }), expectP0: false },
  { name: "14 draft outputs are non-accounting", make: () => processingSnapshot({ difference: 0, output: 20_000, draft: true }), expectP0: false },
  { name: "15 zero difference", make: () => processingSnapshot({ difference: 0, output: 20_000 }), expectP0: false },
  { name: "16 moisture loss documented", make: () => processingSnapshot({ difference: 2_000, output: 18_000, moisture: true }), expectP0: false },
  { name: "17 actual unexplained loss", make: () => processingSnapshot({ difference: 500, output: 18_000 }), expectedCodes: ["PROCESSING_MASS_BALANCE_MISMATCH"], expectP0: true },
  { name: "18 duplicate vehicle", make: () => { const s = openGrossSnapshot(); s.tickets.push(secondTicket(s.tickets[0], { driverId: "driver-2" })); return s; }, expectedCodes: ["VEHICLE_IN_MULTIPLE_OPEN_TICKETS"], expectP0: false },
  { name: "19 duplicate driver", make: () => { const s = openGrossSnapshot(); s.tickets.push(secondTicket(s.tickets[0], { vehicleId: "vehicle-2" })); return s; }, expectedCodes: ["DRIVER_IN_MULTIPLE_OPEN_TICKETS"], expectP0: false },
  { name: "20 closed season mutation", make: () => { const s = finalizedHarvestSnapshot(); s.seasons[0].archived = true; s.seasons[0].endDate = "2026-08-18T00:00:00.000Z"; return s; }, expectedCodes: ["CLOSED_SEASON_NEW_TICKET"], expectP0: false },
  { name: "21 network retry does not duplicate", make: finalizedHarvestSnapshot, forbiddenCodes: ["IDEMPOTENCY_KEY_COLLISION", "DUPLICATE_ACTIVE_LEDGER_ENTRY"], idempotent: true },
  { name: "22 reload is read only", make: finalizedHarvestSnapshot, expectP0: false, idempotent: true },
  { name: "23 shift handover preserves ticket", make: () => { const s = openGrossSnapshot(); s.shifts.push({ ...s.shifts[0], id: "shift-2", operatorPersonId: "person-2" }); return s; }, expectP0: false },
  { name: "24 negative batch attempt", make: () => { const s = finalizedHarvestSnapshot(); s.batches[0].currentKg = -1; return s; }, expectedCodes: ["NEGATIVE_BATCH_BALANCE"], expectP0: true },
  { name: "25 transfer is mass neutral", make: () => { const s = finalizedHarvestSnapshot(); const ticket = s.tickets[0]; Object.assign(ticket, { opType: "transfer_between_warehouses", direction: "transfer", warehouseFromId: "warehouse-from", warehouseToId: "warehouse-to" }); s.ledgerEntries = [{ ...s.ledgerEntries[0], id: "out", warehouseId: "warehouse-from", deltaKg: -20_000, direction: "outbound" }, { ...s.ledgerEntries[0], id: "in", warehouseId: "warehouse-to", deltaKg: 20_000, direction: "inbound" }]; return s; }, expectP0: false },
];

let passed = 0;
for (const scenario of scenarios) {
  const snapshot = scenario.make();
  const before = stableFingerprint(cloneSnapshot(snapshot));
  const report = verifyWeighbridgeTruth(snapshot);
  const after = stableFingerprint(cloneSnapshot(snapshot));
  assert.equal(after, before, `${scenario.name}: audit mutated fixture`);
  for (const code of scenario.expectedCodes ?? []) assert.ok(report.findings.some((item) => item.code === code), `${scenario.name}: missing ${code}`);
  for (const code of scenario.forbiddenCodes ?? []) assert.ok(!report.findings.some((item) => item.code === code), `${scenario.name}: unexpected ${code}`);
  if (scenario.expectP0 === true) assert.ok(report.summary.p0 > 0, `${scenario.name}: expected P0`);
  if (scenario.expectP0 === false) assert.equal(report.summary.p0, 0, `${scenario.name}: unexpected P0 ${report.findings.map((item) => item.code).join(",")}`);
  if (scenario.idempotent) {
    const repeat = verifyWeighbridgeTruth(snapshot);
    assert.deepEqual(repeat.findings.map((item) => item.code), report.findings.map((item) => item.code), `${scenario.name}: non-deterministic repeat`);
  }
  passed += 1;
  console.log(`PASS ${scenario.name} fingerprint=${before.slice(0, 12)} findings=${report.findings.length}`);
}
assert.ok(scenarios.length >= 20);
console.log(`Golden scenarios: ${passed}/${scenarios.length} PASS`);

