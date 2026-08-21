import type {
  TruthBatch,
  TruthLedgerEntry,
  TruthLot,
  TruthLotBatch,
  TruthPerson,
  TruthSeason,
  TruthShift,
  TruthSnapshot,
  TruthTicket,
  TruthTicketLine,
  TruthTransformation,
  TruthTransformationInput,
  TruthTransformationOutput,
  TruthWeighing,
} from "./types";

type RawRow = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: unknown): boolean {
  return value === true || value === "true";
}

function rows(value: unknown): RawRow[] {
  return Array.isArray(value) ? value.filter((row): row is RawRow => !!row && typeof row === "object") : [];
}

function ticket(row: RawRow): TruthTicket {
  return {
    id: str(row.id) ?? "missing-ticket-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    ticketNo: str(row.ticket_no) ?? str(row.id) ?? "missing-ticket-no",
    ticketType: str(row.ticket_type),
    opType: str(row.op_type),
    status: str(row.status),
    direction: str(row.direction),
    grossKg: num(row.gross_weight_kg),
    tareKg: num(row.tare_weight_kg),
    netKg: num(row.net_weight_kg),
    physicalNetKg: num(row.physical_net_kg),
    explicitDeductionsKg: num(row.explicit_deductions_kg),
    acceptedWeightKg: num(row.accepted_weight_kg),
    isFinalized: bool(row.is_finalized),
    isVoided: bool(row.is_voided),
    vehicleId: str(row.vehicle_id),
    driverId: str(row.driver_id),
    fieldId: str(row.field_id),
    seasonId: str(row.season_id),
    warehouseFromId: str(row.warehouse_from_id),
    warehouseToId: str(row.warehouse_to_id),
    batchId: str(row.batch_id),
    lotId: str(row.lot_id),
    harvestLotId: str(row.harvest_lot_id),
    shiftId: str(row.shift_id),
    correctionOfTicketId: str(row.correction_of_ticket_id),
    replacementTicketId: str(row.replacement_ticket_id),
    idempotencyKey: str(row.idempotency_key) ?? str((row.audit_json as RawRow | undefined)?.idempotency_key),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    finalizedAt: str(row.finalized_at),
  };
}

function line(row: RawRow): TruthTicketLine {
  return {
    id: str(row.id) ?? "missing-line-id",
    ticketId: str(row.ticket_id) ?? "missing-ticket-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    productId: str(row.product_id),
    cropId: str(row.crop_id),
    varietyId: str(row.variety_id),
    reproductionId: str(row.reproduction_id),
    lineType: str(row.line_type),
    quantityKg: num(row.quantity_kg) ?? num(row.mass_kg) ?? num(row.quantity),
    netKg: num(row.net_line_weight_kg),
    moisturePercent: num(row.moisture_percent),
    batchId: str(row.destination_batch_id) ?? str(row.batch_id),
    lotId: str(row.lot_id),
    warehouseFromId: str(row.warehouse_from_id),
    warehouseToId: str(row.warehouse_to_id),
  };
}

function weighing(row: RawRow): TruthWeighing {
  return {
    id: str(row.id) ?? "missing-weighing-id",
    ticketId: str(row.ticket_id) ?? "missing-ticket-id",
    weighingNo: num(row.weighing_no),
    measuredKg: num(row.measured_weight_kg),
    measuredAt: str(row.measured_at),
    deviceSource: str(row.device_source),
  };
}

function ledger(row: RawRow): TruthLedgerEntry {
  return {
    id: str(row.id) ?? "missing-ledger-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    ticketId: str(row.ticket_id),
    processingId: str(row.processing_id),
    warehouseId: str(row.warehouse_id),
    productId: str(row.product_id),
    cropId: str(row.crop_id),
    batchId: str(row.inventory_batch_id) ?? str(row.batch_id),
    inventoryBatchId: str(row.inventory_batch_id),
    direction: str(row.direction),
    // mass_kg is an unsigned legacy quantity. Accounting truth must prefer the
    // signed ledger delta so storno rows cancel their referenced originals.
    deltaKg: num(row.delta_qty_signed) ?? num(row.mass_kg) ?? 0,
    reasonType: str(row.reason_type),
    isStorno: bool(row.is_storno),
    stornoOfEntryId: str(row.storno_of_entry_id),
    createdAt: str(row.created_at),
  };
}

function batch(row: RawRow): TruthBatch {
  return {
    id: str(row.id) ?? "missing-batch-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    sourceTicketId: str(row.source_ticket_id),
    seasonId: str(row.season_id),
    warehouseId: str(row.warehouse_id),
    cropId: str(row.crop_id),
    varietyId: str(row.variety_id),
    reproductionId: str(row.reproduction_id),
    sourceFieldId: str(row.source_field_id),
    batchCode: str(row.batch_code),
    batchClass: str(row.batch_class),
    status: str(row.status),
    initialKg: num(row.initial_weight_kg) ?? num(row.mass_kg) ?? num(row.initial_quantity),
    currentKg: num(row.current_weight_kg) ?? num(row.current_quantity),
    moisturePercent: num(row.moisture_percent),
    physicalState: str(row.physical_state),
  };
}

function lot(row: RawRow): TruthLot {
  return {
    id: str(row.id) ?? "missing-lot-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    lotCode: str(row.lot_code),
    seasonId: str(row.season_id),
    cropId: str(row.crop_id),
    varietyId: str(row.variety_id),
    reproductionId: str(row.reproduction_id),
    identityKind: str(row.identity_kind),
    identityKey: str(row.identity_key),
    reviewState: str(row.review_state),
    status: str(row.status),
  };
}

function lotBatch(row: RawRow): TruthLotBatch {
  return {
    id: str(row.id) ?? "missing-lot-batch-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    lotId: str(row.harvest_lot_id) ?? "missing-lot-id",
    batchId: str(row.inventory_batch_id) ?? "missing-batch-id",
    sourceTicketId: str(row.source_ticket_id),
  };
}

function transformation(row: RawRow): TruthTransformation {
  return {
    id: str(row.id) ?? "missing-transformation-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    sourceTicketId: str(row.source_ticket_id),
    harvestLotId: str(row.harvest_lot_id),
    transformationType: str(row.transformation_type),
    status: str(row.status),
    inputTotalKg: num(row.input_weight_total_kg),
    outputTotalKg: num(row.output_weight_total_kg),
    massDifferenceKg: num(row.mass_difference_kg) ?? num(row.unexplained_variance_kg),
    qualityState: str(row.quality_state),
  };
}

function transformationInput(row: RawRow): TruthTransformationInput {
  return {
    id: str(row.id) ?? "missing-input-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    transformationId: str(row.transformation_id) ?? "missing-transformation-id",
    batchId: str(row.batch_id),
    sourceTicketId: str(row.source_ticket_id),
    inputKg: num(row.input_weight_kg),
    moisturePercent: num(row.moisture_percent),
  };
}

function transformationOutput(row: RawRow): TruthTransformationOutput {
  return {
    id: str(row.id) ?? "missing-output-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    transformationId: str(row.transformation_id) ?? "missing-transformation-id",
    batchId: str(row.output_batch_id),
    sourceTicketId: str(row.source_ticket_id),
    lineType: str(row.line_type),
    outputRole: str(row.output_role),
    outputKg: num(row.output_weight_kg),
    moisturePercent: num(row.moisture_percent),
  };
}

function shift(row: RawRow): TruthShift {
  return {
    id: str(row.id) ?? "missing-shift-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    status: str(row.status),
    operatorPersonId: str(row.operator_person_id),
    openedAt: str(row.opened_at),
    closedAt: str(row.closed_at),
    closeReason: str(row.close_reason),
  };
}

function person(row: RawRow): TruthPerson {
  return {
    id: str(row.id) ?? "missing-person-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    fullName: str(row.full_name) ?? str(row.short_name),
  };
}

function season(row: RawRow): TruthSeason {
  return {
    id: str(row.id) ?? "missing-season-id",
    companyId: str(row.company_id) ?? "missing-company-id",
    year: num(row.year),
    archived: bool(row.archived),
    endDate: str(row.end_date),
  };
}

export function normalizeTruthSnapshot(raw: RawRow): TruthSnapshot {
  const metadata = (raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}) as RawRow;
  const selection = (metadata.selection && typeof metadata.selection === "object" ? metadata.selection : {}) as TruthSnapshot["selection"];
  return {
    schemaVersion: 1,
    environment: metadata.environment === "production" ? "production" : metadata.environment === "qa" ? "qa" : "fixture",
    projectId: str(metadata.project_id),
    companyId: str(metadata.company_id) ?? "missing-company-id",
    companyName: str(metadata.company_name),
    generatedAt: str(metadata.generated_at) ?? new Date().toISOString(),
    selection,
    tickets: rows(raw.tickets).map(ticket),
    ticketLines: rows(raw.ticket_lines).map(line),
    weighings: rows(raw.ticket_weighings).map(weighing),
    ledgerEntries: rows(raw.stock_ledger_entries).map(ledger),
    batches: rows(raw.inventory_batches).map(batch),
    lots: rows(raw.harvest_lots).map(lot),
    lotBatches: rows(raw.harvest_lot_batches).map(lotBatch),
    transformations: rows(raw.batch_transformations).map(transformation),
    transformationInputs: rows(raw.batch_transformation_inputs).map(transformationInput),
    transformationOutputs: rows(raw.batch_transformation_outputs).map(transformationOutput),
    shifts: rows(raw.weighbridge_shifts).map(shift),
    people: rows(raw.company_people).map(person),
    seasons: rows(raw.seasons).map(season),
  };
}
