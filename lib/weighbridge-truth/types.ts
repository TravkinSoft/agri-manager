export type TruthEnvironment = "qa" | "production" | "fixture";

export type TruthPriority = "P0" | "P1" | "P2";
export type TruthLevel = "CRITICAL" | "ATTENTION" | "INFO";

export interface TruthFinding {
  code: string;
  priority: TruthPriority;
  level: TruthLevel;
  objectType: "ticket" | "batch" | "lot" | "ledger" | "processing" | "shift" | "system";
  objectId: string;
  ticketNo?: string | null;
  expected: string;
  actual: string;
  explanation: string;
  investigation: string[];
}

export interface TruthTicket {
  id: string;
  companyId: string;
  ticketNo: string;
  ticketType: string | null;
  opType: string | null;
  status: string | null;
  direction: string | null;
  grossKg: number | null;
  tareKg: number | null;
  netKg: number | null;
  physicalNetKg: number | null;
  explicitDeductionsKg: number | null;
  acceptedWeightKg: number | null;
  isFinalized: boolean;
  isVoided: boolean;
  vehicleId: string | null;
  driverId: string | null;
  fieldId: string | null;
  seasonId: string | null;
  warehouseFromId: string | null;
  warehouseToId: string | null;
  batchId: string | null;
  lotId: string | null;
  harvestLotId: string | null;
  linkedProcessingId?: string | null;
  processingOutputRole?: string | null;
  shiftId: string | null;
  correctionOfTicketId: string | null;
  replacementTicketId: string | null;
  idempotencyKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  finalizedAt: string | null;
}

export interface TruthTicketLine {
  id: string;
  ticketId: string;
  companyId: string;
  productId: string | null;
  cropId: string | null;
  varietyId: string | null;
  reproductionId: string | null;
  lineType: string | null;
  quantityKg: number | null;
  netKg: number | null;
  moisturePercent: number | null;
  batchId: string | null;
  lotId: string | null;
  warehouseFromId: string | null;
  warehouseToId: string | null;
}

export interface TruthWeighing {
  id: string;
  ticketId: string;
  weighingNo: number | null;
  measuredKg: number | null;
  measuredAt: string | null;
  deviceSource: string | null;
}

export interface TruthLedgerEntry {
  id: string;
  companyId: string;
  ticketId: string | null;
  processingId: string | null;
  warehouseId: string | null;
  productId: string | null;
  cropId: string | null;
  batchId: string | null;
  inventoryBatchId: string | null;
  direction: string | null;
  deltaKg: number;
  reasonType: string | null;
  isStorno: boolean;
  stornoOfEntryId: string | null;
  createdAt: string | null;
}

export interface TruthBatch {
  id: string;
  companyId: string;
  sourceTicketId: string | null;
  seasonId: string | null;
  warehouseId: string | null;
  cropId: string | null;
  varietyId: string | null;
  reproductionId: string | null;
  sourceFieldId: string | null;
  batchCode: string | null;
  batchClass: string | null;
  status: string | null;
  initialKg: number | null;
  currentKg: number | null;
  moisturePercent: number | null;
  physicalState: string | null;
}

export interface TruthLot {
  id: string;
  companyId: string;
  lotCode: string | null;
  seasonId: string | null;
  cropId: string | null;
  varietyId: string | null;
  reproductionId: string | null;
  identityKind: string | null;
  identityKey: string | null;
  reviewState: string | null;
  status: string | null;
}

export interface TruthLotBatch {
  id: string;
  companyId: string;
  lotId: string;
  batchId: string;
  sourceTicketId: string | null;
}

export interface TruthTransformation {
  id: string;
  companyId: string;
  sourceTicketId: string | null;
  harvestLotId: string | null;
  transformationType: string | null;
  status: string | null;
  inputTotalKg: number | null;
  outputTotalKg: number | null;
  massDifferenceKg: number | null;
  documentedLossKg?: number | null;
  qualityState: string | null;
}

export interface TruthTransformationInput {
  id: string;
  companyId: string;
  transformationId: string;
  batchId: string | null;
  sourceTicketId: string | null;
  inputKg: number | null;
  moisturePercent: number | null;
}

export interface TruthTransformationOutput {
  id: string;
  companyId: string;
  transformationId: string;
  batchId: string | null;
  sourceTicketId: string | null;
  lineType: string | null;
  outputRole: string | null;
  outputKg: number | null;
  moisturePercent: number | null;
}

export interface TruthShift {
  id: string;
  companyId: string;
  status: string | null;
  operatorPersonId: string | null;
  openedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

export interface TruthPerson {
  id: string;
  companyId: string;
  fullName: string | null;
}

export interface TruthSeason {
  id: string;
  companyId: string;
  year: number | null;
  archived: boolean;
  endDate: string | null;
}

export interface TruthSnapshot {
  schemaVersion: 1;
  environment: TruthEnvironment;
  projectId: string | null;
  companyId: string;
  companyName: string | null;
  generatedAt: string;
  selection: {
    ticketId?: string;
    lotId?: string;
    batchId?: string;
    all?: boolean;
  };
  tickets: TruthTicket[];
  ticketLines: TruthTicketLine[];
  weighings: TruthWeighing[];
  ledgerEntries: TruthLedgerEntry[];
  batches: TruthBatch[];
  lots: TruthLot[];
  lotBatches: TruthLotBatch[];
  transformations: TruthTransformation[];
  transformationInputs: TruthTransformationInput[];
  transformationOutputs: TruthTransformationOutput[];
  shifts: TruthShift[];
  people: TruthPerson[];
  seasons: TruthSeason[];
}

export interface TruthReport {
  schemaVersion: 1;
  generatedAt: string;
  environment: TruthEnvironment;
  companyId: string;
  companyName: string | null;
  selection: TruthSnapshot["selection"];
  counts: {
    tickets: number;
    openTickets: number;
    finalizedTickets: number;
    voidedTickets: number;
    batches: number;
    lots: number;
    ledgerEntries: number;
    transformations: number;
  };
  summary: {
    p0: number;
    p1: number;
    p2: number;
    status: "PASS" | "ATTENTION" | "FAIL";
  };
  findings: TruthFinding[];
}
