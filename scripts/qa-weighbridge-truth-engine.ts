import assert from "node:assert/strict";
import { verifyWeighbridgeTruth } from "../lib/weighbridge-truth/engine";
import { normalizeTruthSnapshot } from "../lib/weighbridge-truth/normalize";
import { assertReadOnlySql, buildTruthSnapshotSql } from "../lib/weighbridge-truth/read-only-source";
import { buildBlackBoxTrace } from "../lib/weighbridge-truth/trace";
import { cloneSnapshot, finalizedHarvestSnapshot, FIXTURE_IDS, openGrossSnapshot, secondTicket } from "./qa/weighbridge-truth-fixtures";

const checks: Array<{ name: string; run: () => void }> = [];
const check = (name: string, run: () => void) => checks.push({ name, run });

check("canonical finalized harvest passes", () => assert.equal(verifyWeighbridgeTruth(finalizedHarvestSnapshot()).summary.status, "PASS"));
check("open gross has no ledger impact", () => assert.equal(verifyWeighbridgeTruth(openGrossSnapshot()).summary.p0, 0));
check("net formula mismatch is P0", () => {
  const snapshot = finalizedHarvestSnapshot(); snapshot.tickets[0].netKg = 19_000;
  assert.ok(verifyWeighbridgeTruth(snapshot).findings.some((item) => item.code === "TICKET_NET_FORMULA_MISMATCH" && item.priority === "P0"));
});
check("duplicate ledger is P0", () => {
  const snapshot = finalizedHarvestSnapshot(); snapshot.ledgerEntries.push({ ...snapshot.ledgerEntries[0], id: "ledger-2" });
  assert.ok(verifyWeighbridgeTruth(snapshot).findings.some((item) => item.code === "DUPLICATE_ACTIVE_LEDGER_ENTRY"));
});
check("void without storno is P0", () => {
  const snapshot = finalizedHarvestSnapshot(); snapshot.tickets[0].isVoided = true;
  assert.ok(verifyWeighbridgeTruth(snapshot).findings.some((item) => item.code === "VOIDED_TICKET_NONZERO_IMPACT"));
});
check("signed ledger delta wins over unsigned legacy mass", () => {
  const snapshot = normalizeTruthSnapshot({
    metadata: { environment: "qa", company_id: FIXTURE_IDS.COMPANY },
    stock_ledger_entries: [{
      id: "storno-1",
      company_id: FIXTURE_IDS.COMPANY,
      ticket_id: FIXTURE_IDS.TICKET,
      mass_kg: 17_000,
      delta_qty_signed: -17_000,
      is_storno: true,
      storno_of_entry_id: "ledger-1",
    }],
  });
  assert.equal(snapshot.ledgerEntries[0].deltaKg, -17_000);
});
check("linked storno neutralizes an already voided ticket", () => {
  const snapshot = finalizedHarvestSnapshot();
  snapshot.tickets[0].isVoided = true;
  snapshot.tickets[0].status = "voided";
  snapshot.ledgerEntries.push({
    ...snapshot.ledgerEntries[0],
    id: "storno-1",
    direction: "out",
    deltaKg: -snapshot.ledgerEntries[0].deltaKg,
    reasonType: `storno_${snapshot.ledgerEntries[0].reasonType}`,
    isStorno: true,
    stornoOfEntryId: snapshot.ledgerEntries[0].id,
  });
  assert.equal(verifyWeighbridgeTruth(snapshot).summary.p0, 0);
});
check("negative batch is P0", () => {
  const snapshot = finalizedHarvestSnapshot(); snapshot.batches[0].currentKg = -1;
  assert.ok(verifyWeighbridgeTruth(snapshot).findings.some((item) => item.code === "NEGATIVE_BATCH_BALANCE"));
});
check("duplicate vehicle is attention", () => {
  const snapshot = openGrossSnapshot(); snapshot.tickets.push(secondTicket(snapshot.tickets[0]));
  assert.ok(verifyWeighbridgeTruth(snapshot).findings.some((item) => item.code === "VEHICLE_IN_MULTIPLE_OPEN_TICKETS" && item.priority === "P1"));
});
check("lot identity conflict is P0", () => {
  const snapshot = finalizedHarvestSnapshot(); snapshot.batches[0].reproductionId = "other-reproduction";
  assert.ok(verifyWeighbridgeTruth(snapshot).findings.some((item) => item.code === "LOT_IDENTITY_CONFLICT"));
});
check("processing mass mismatch is P0", () => {
  const snapshot = finalizedHarvestSnapshot();
  snapshot.transformations.push({ id: "tr-1", companyId: FIXTURE_IDS.COMPANY, sourceTicketId: FIXTURE_IDS.TICKET, harvestLotId: FIXTURE_IDS.LOT,
    transformationType: "drying", status: "completed", inputTotalKg: 20_000, outputTotalKg: 18_000, massDifferenceKg: 1_000, qualityState: "confirmed" });
  snapshot.transformationInputs.push({ id: "in-1", companyId: FIXTURE_IDS.COMPANY, transformationId: "tr-1", batchId: FIXTURE_IDS.BATCH, sourceTicketId: FIXTURE_IDS.TICKET, inputKg: 20_000, moisturePercent: 18 });
  snapshot.transformationOutputs.push({ id: "out-1", companyId: FIXTURE_IDS.COMPANY, transformationId: "tr-1", batchId: "batch-out", sourceTicketId: null, lineType: "product", outputRole: "product", outputKg: 18_000, moisturePercent: 14 });
  assert.ok(verifyWeighbridgeTruth(snapshot).findings.some((item) => item.code === "PROCESSING_MASS_BALANCE_MISMATCH"));
});
check("read-only SQL accepts QA sweep", () => assertReadOnlySql(buildTruthSnapshotSql({ environment: "qa", all: true })));
check("read-only SQL accepts Production ticket trace", () => assertReadOnlySql(buildTruthSnapshotSql({ environment: "production", ticket: "WB-100000-20260814223220-P9EA" })));
check("read-only SQL rejects mutation", () => assert.throws(() => assertReadOnlySql("update tickets set status='closed'"), /read-only|SELECT/));
check("company input rejects SQL injection", () => assert.throws(() => buildTruthSnapshotSql({ environment: "qa", company: "x' or true--", all: true }), /company/));
check("Black Box links ticket to batch, lot and ledger", () => {
  const trace = buildBlackBoxTrace(finalizedHarvestSnapshot(), { type: "ticket", id: FIXTURE_IDS.TICKET });
  assert.ok(trace.chain.some((item) => item.kind === "batch"));
  assert.ok(trace.chain.some((item) => item.kind === "aggregate_lot"));
  assert.ok(trace.chain.some((item) => item.kind === "ledger"));
});
check("engine never mutates snapshot", () => {
  const snapshot = finalizedHarvestSnapshot(); const before = JSON.stringify(snapshot); verifyWeighbridgeTruth(snapshot); assert.equal(JSON.stringify(snapshot), before);
});

let passed = 0;
for (const item of checks) {
  try { item.run(); passed += 1; console.log(`PASS ${item.name}`); }
  catch (error) { console.error(`FAIL ${item.name}`); throw error; }
}
console.log(`Weighbridge Truth Engine: ${passed}/${checks.length} PASS`);
