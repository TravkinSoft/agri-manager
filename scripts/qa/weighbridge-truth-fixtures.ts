import { createHash } from "node:crypto";
import type { TruthSnapshot, TruthTicket } from "../../lib/weighbridge-truth/types";

const COMPANY = "8a0f2c0e-6638-4a31-99a8-cab4237d287d";
const TICKET = "10000000-0000-4000-8000-000000000001";
const BATCH = "20000000-0000-4000-8000-000000000001";
const LOT = "30000000-0000-4000-8000-000000000001";
const WAREHOUSE = "40000000-0000-4000-8000-000000000001";
const SEASON = "50000000-0000-4000-8000-000000000001";
const VEHICLE = "60000000-0000-4000-8000-000000000001";
const DRIVER = "70000000-0000-4000-8000-000000000001";
const CROP = "80000000-0000-4000-8000-000000000001";
const VARIETY = "90000000-0000-4000-8000-000000000001";
const REPRODUCTION = "a0000000-0000-4000-8000-000000000001";

export function finalizedHarvestSnapshot(): TruthSnapshot {
  return {
    schemaVersion: 1,
    environment: "fixture",
    projectId: null,
    companyId: COMPANY,
    companyName: "Golden QA",
    generatedAt: "2026-08-19T00:00:00.000Z",
    selection: { all: true },
    tickets: [{
      id: TICKET, companyId: COMPANY, ticketNo: "WB-GOLDEN-001", ticketType: "harvest", opType: "harvest_incoming",
      status: "closed", direction: "inbound", grossKg: 30_000, tareKg: 10_000, netKg: 20_000,
      physicalNetKg: 20_000, explicitDeductionsKg: 0, acceptedWeightKg: 20_000,
      isFinalized: true, isVoided: false, vehicleId: VEHICLE, driverId: DRIVER, fieldId: "field-1", seasonId: SEASON,
      warehouseFromId: null, warehouseToId: WAREHOUSE, batchId: BATCH, lotId: null, harvestLotId: LOT, shiftId: "shift-1",
      correctionOfTicketId: null, replacementTicketId: null, idempotencyKey: "golden-001", createdAt: "2026-08-19T01:00:00.000Z",
      updatedAt: "2026-08-19T01:10:00.000Z", finalizedAt: "2026-08-19T01:10:00.000Z",
    }],
    ticketLines: [{
      id: "line-1", ticketId: TICKET, companyId: COMPANY, productId: null, cropId: CROP, varietyId: VARIETY,
      reproductionId: REPRODUCTION, lineType: "product", quantityKg: 20_000, netKg: 20_000, moisturePercent: 14,
      batchId: BATCH, lotId: null, warehouseFromId: null, warehouseToId: WAREHOUSE,
    }],
    weighings: [
      { id: "weight-1", ticketId: TICKET, weighingNo: 1, measuredKg: 30_000, measuredAt: "2026-08-19T01:00:00.000Z", deviceSource: "connector" },
      { id: "weight-2", ticketId: TICKET, weighingNo: 2, measuredKg: 10_000, measuredAt: "2026-08-19T01:10:00.000Z", deviceSource: "connector" },
    ],
    ledgerEntries: [{
      id: "ledger-1", companyId: COMPANY, ticketId: TICKET, processingId: null, warehouseId: WAREHOUSE, productId: null,
      cropId: CROP, batchId: BATCH, inventoryBatchId: BATCH, direction: "inbound", deltaKg: 20_000,
      reasonType: "harvest_receipt", isStorno: false, stornoOfEntryId: null, createdAt: "2026-08-19T01:10:00.000Z",
    }],
    batches: [{
      id: BATCH, companyId: COMPANY, sourceTicketId: TICKET, seasonId: SEASON, warehouseId: WAREHOUSE, cropId: CROP,
      varietyId: VARIETY, reproductionId: REPRODUCTION, sourceFieldId: "field-1", batchCode: "HAR-GOLDEN-001",
      batchClass: "harvest", status: "active", initialKg: 20_000, currentKg: 20_000, moisturePercent: 14, physicalState: null,
    }],
    lots: [{
      id: LOT, companyId: COMPANY, lotCode: "LOT-GOLDEN-001", seasonId: SEASON, cropId: CROP, varietyId: VARIETY,
      reproductionId: REPRODUCTION, identityKind: "confirmed", identityKey: `${SEASON}|${CROP}|${VARIETY}|${REPRODUCTION}`,
      reviewState: "confirmed", status: "active",
    }],
    lotBatches: [{ id: "lot-batch-1", companyId: COMPANY, lotId: LOT, batchId: BATCH, sourceTicketId: TICKET }],
    transformations: [], transformationInputs: [], transformationOutputs: [],
    shifts: [{ id: "shift-1", companyId: COMPANY, status: "open", operatorPersonId: "person-1", openedAt: "2026-08-19T00:00:00.000Z", closedAt: null, closeReason: null }],
    people: [{ id: "person-1", companyId: COMPANY, fullName: "Golden Operator" }],
    seasons: [{ id: SEASON, companyId: COMPANY, year: 2026, archived: false, endDate: "2026-12-31T23:59:59.000Z" }],
  };
}

export function cloneSnapshot(snapshot: TruthSnapshot): TruthSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as TruthSnapshot;
}

export function openGrossSnapshot(): TruthSnapshot {
  const snapshot = finalizedHarvestSnapshot();
  const ticket = snapshot.tickets[0];
  Object.assign(ticket, { status: "open", tareKg: null, netKg: null, physicalNetKg: null, explicitDeductionsKg: null, acceptedWeightKg: null, isFinalized: false, finalizedAt: null });
  snapshot.ticketLines = [];
  snapshot.weighings = snapshot.weighings.slice(0, 1);
  snapshot.ledgerEntries = [];
  snapshot.batches = [];
  snapshot.lots = [];
  snapshot.lotBatches = [];
  return snapshot;
}

export function secondTicket(base: TruthTicket, overrides: Partial<TruthTicket> = {}): TruthTicket {
  return {
    ...base,
    id: "10000000-0000-4000-8000-000000000002",
    ticketNo: "WB-GOLDEN-002",
    idempotencyKey: "golden-002",
    ...overrides,
  };
}

export function stableFingerprint(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
    }
    return input;
  };
  const canonical = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(canonical).digest("hex");
}

export const FIXTURE_IDS = { COMPANY, TICKET, BATCH, LOT, WAREHOUSE, SEASON, VEHICLE, DRIVER, CROP, VARIETY, REPRODUCTION };
