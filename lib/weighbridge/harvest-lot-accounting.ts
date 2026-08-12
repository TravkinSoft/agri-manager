export type HarvestLedgerEntry = {
  id?: string;
  warehouse_id?: string | null;
  direction?: string | null;
  delta_qty_signed?: number | string | null;
  reason_type?: string | null;
};

export type HarvestLotAccounting = {
  receivedKg: number;
  voidedKg: number;
  impurityKg: number;
  processingInputKg: number;
  processingOutputKg: number;
  transferInKg: number;
  transferOutKg: number;
  writeoffKg: number;
  issueKg: number;
  otherAdjustmentKg: number;
  physicalKg: number;
  reservedKg: number;
  availableKg: number;
  expectedPhysicalKg: number;
  reconciliationDeltaKg: number;
};

const roundKg = (value: number) => Number(value.toFixed(3));

function isWriteoffReason(reason: string): boolean {
  return ["writeoff", "disposal", "spoilage", "shortage", "waste", "other_removal"]
    .some((token) => reason.includes(token));
}

export function calculateHarvestLotAccounting(input: {
  receivedKg: number;
  voidedKg?: number;
  currentKg: number;
  reservedKg?: number;
  ledgerEntries: HarvestLedgerEntry[];
}): HarvestLotAccounting {
  let impurityKg = 0;
  let processingInputKg = 0;
  let processingOutputKg = 0;
  let transferInKg = 0;
  let transferOutKg = 0;
  let writeoffKg = 0;
  let issueKg = 0;
  let otherAdjustmentKg = 0;

  for (const entry of input.ledgerEntries) {
    const delta = Number(entry.delta_qty_signed || 0);
    if (!Number.isFinite(delta) || Math.abs(delta) <= 0.000001) continue;
    const reason = String(entry.reason_type || "").trim().toLowerCase();

    // Active receipts are represented by the finalized, non-voided trips.
    // Their original and storno ledger rows must not be counted a second time.
    if (reason.includes("harvest_incoming")) continue;

    if (reason.includes("impurit")) {
      impurityKg -= delta;
    } else if (reason.includes("processing_input")) {
      processingInputKg -= delta;
    } else if (reason.includes("processing_output")) {
      processingOutputKg += delta;
    } else if (reason.includes("transfer")) {
      if (delta > 0) transferInKg += delta;
      else transferOutKg -= delta;
    } else if (isWriteoffReason(reason)) {
      writeoffKg -= delta;
    } else if (reason.includes("issue_to_field") || reason.includes("warehouse_issue") || reason.includes("shipment_outbound")) {
      issueKg -= delta;
    } else {
      otherAdjustmentKg += delta;
    }
  }

  const receivedKg = Math.max(0, Number(input.receivedKg || 0));
  const voidedKg = Math.max(0, Number(input.voidedKg || 0));
  const physicalKg = Number(input.currentKg || 0);
  const reservedKg = Math.max(0, Number(input.reservedKg || 0));
  const expectedPhysicalKg =
    receivedKg - impurityKg - processingInputKg + processingOutputKg +
    transferInKg - transferOutKg - writeoffKg - issueKg + otherAdjustmentKg;

  return {
    receivedKg: roundKg(receivedKg),
    voidedKg: roundKg(voidedKg),
    impurityKg: roundKg(Math.max(0, impurityKg)),
    processingInputKg: roundKg(Math.max(0, processingInputKg)),
    processingOutputKg: roundKg(Math.max(0, processingOutputKg)),
    transferInKg: roundKg(Math.max(0, transferInKg)),
    transferOutKg: roundKg(Math.max(0, transferOutKg)),
    writeoffKg: roundKg(Math.max(0, writeoffKg)),
    issueKg: roundKg(Math.max(0, issueKg)),
    otherAdjustmentKg: roundKg(otherAdjustmentKg),
    physicalKg: roundKg(physicalKg),
    reservedKg: roundKg(reservedKg),
    availableKg: roundKg(Math.max(physicalKg - reservedKg, 0)),
    expectedPhysicalKg: roundKg(expectedPhysicalKg),
    reconciliationDeltaKg: roundKg(physicalKg - expectedPhysicalKg),
  };
}
