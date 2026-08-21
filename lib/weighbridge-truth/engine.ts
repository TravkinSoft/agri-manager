import type {
  TruthFinding,
  TruthLedgerEntry,
  TruthLot,
  TruthPriority,
  TruthReport,
  TruthSnapshot,
  TruthTicket,
} from "./types";

const EPSILON_KG = 0.01;

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function closeEnough(left: number, right: number, tolerance = EPSILON_KG): boolean {
  return Math.abs(left - right) <= tolerance;
}

function priorityRank(priority: TruthPriority): number {
  return priority === "P0" ? 0 : priority === "P1" ? 1 : 2;
}

function describeKg(value: number | null | undefined): string {
  return value === null || value === undefined ? "NULL" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} kg`;
}

function finding(
  ticket: TruthTicket | null,
  code: string,
  priority: TruthPriority,
  objectType: TruthFinding["objectType"],
  objectId: string,
  expected: string,
  actual: string,
  explanation: string,
  investigation: string[],
): TruthFinding {
  return {
    code,
    priority,
    level: priority === "P0" ? "CRITICAL" : priority === "P1" ? "ATTENTION" : "INFO",
    objectType,
    objectId,
    ticketNo: ticket?.ticketNo,
    expected,
    actual,
    explanation,
    investigation,
  };
}

function isOpen(ticket: TruthTicket): boolean {
  return !ticket.isFinalized && !ticket.isVoided && !["closed", "finalized", "voided", "cancelled"].includes(ticket.status ?? "");
}

function isWeighbridgeTicket(ticket: TruthTicket): boolean {
  return ticket.ticketNo.startsWith("WB-");
}

function effectiveLedgerTotal(entries: TruthLedgerEntry[]): number {
  return sum(entries.map((entry) => entry.deltaKg));
}

function expectedLedgerTotal(ticket: TruthTicket): number | null {
  const accountingKg = ticket.opType === "harvest_incoming"
    ? ticket.acceptedWeightKg ?? ticket.netKg
    : ticket.netKg;
  if (accountingKg === null) return null;
  const direction = (ticket.direction ?? "").toLowerCase();
  const opType = (ticket.opType ?? "").toLowerCase();
  if (direction === "inbound" || ["harvest_incoming", "supplier_receipt"].includes(opType)) return accountingKg;
  if (direction === "outbound" || ["issue_to_field", "shipment_outbound", "disposal_writeoff", "impurity_removal"].includes(opType)) return -accountingKg;
  if (direction === "transfer" || opType === "transfer_between_warehouses") return 0;
  return null;
}

function identityTuple(lot: TruthLot): string {
  return [lot.seasonId, lot.cropId, lot.varietyId, lot.reproductionId].map((value) => value ?? "NULL").join("|");
}

export function verifyWeighbridgeTruth(snapshot: TruthSnapshot): TruthReport {
  const findings: TruthFinding[] = [];
  const ticketById = new Map(snapshot.tickets.map((ticket) => [ticket.id, ticket]));
  const linesByTicket = new Map<string, typeof snapshot.ticketLines>();
  const weighingByTicket = new Map<string, typeof snapshot.weighings>();
  const ledgerByTicket = new Map<string, TruthLedgerEntry[]>();
  const batchById = new Map(snapshot.batches.map((batch) => [batch.id, batch]));
  const lotById = new Map(snapshot.lots.map((lot) => [lot.id, lot]));

  for (const line of snapshot.ticketLines) {
    linesByTicket.set(line.ticketId, [...(linesByTicket.get(line.ticketId) ?? []), line]);
  }
  for (const weighing of snapshot.weighings) {
    weighingByTicket.set(weighing.ticketId, [...(weighingByTicket.get(weighing.ticketId) ?? []), weighing]);
  }
  for (const entry of snapshot.ledgerEntries) {
    if (entry.ticketId) ledgerByTicket.set(entry.ticketId, [...(ledgerByTicket.get(entry.ticketId) ?? []), entry]);
  }

  for (const ticket of snapshot.tickets) {
    const lines = linesByTicket.get(ticket.id) ?? [];
    const weighings = weighingByTicket.get(ticket.id) ?? [];
    const ledger = ledgerByTicket.get(ticket.id) ?? [];

    if (ticket.grossKg !== null && ticket.tareKg !== null) {
      const calculatedNet = ticket.grossKg - ticket.tareKg;
      if (ticket.netKg === null || !closeEnough(calculatedNet, ticket.netKg)) {
        findings.push(finding(ticket, "TICKET_NET_FORMULA_MISMATCH", "P0", "ticket", ticket.id,
          `net = gross - tare = ${describeKg(calculatedNet)}`, describeKg(ticket.netKg),
          "The ticket header violates the canonical weighing equation.",
          ["Inspect gross and tare weighing events.", "Check correction/finalize idempotency before changing any data."]));
      }
      if (ticket.opType === "harvest_incoming" && ticket.isFinalized && !ticket.isVoided) {
        const physical = ticket.physicalNetKg ?? ticket.netKg;
        const deduction = ticket.explicitDeductionsKg ?? 0;
        const accepted = ticket.acceptedWeightKg ?? ticket.netKg;
        if (physical === null || !closeEnough(calculatedNet, physical)) {
          findings.push(finding(ticket, "HARVEST_PHYSICAL_NET_MISMATCH", "P0", "ticket", ticket.id,
            `physical net = gross - tare = ${describeKg(calculatedNet)}`, describeKg(physical),
            "The physical weighing result is inconsistent.", ["Inspect the atomic harvest finalize result."]));
        }
        if (physical !== null && accepted !== null && !closeEnough(physical - deduction, accepted)) {
          findings.push(finding(ticket, "HARVEST_ACCEPTED_WEIGHT_MISMATCH", "P0", "ticket", ticket.id,
            `accepted = physical net - deductions = ${describeKg(physical - deduction)}`, describeKg(accepted),
            "Warehouse accounting mass does not match the explicit deduction snapshot.", ["Inspect ticket deduction fields and quality_json."]));
        }
        if ((physical ?? 0) <= 0 || (accepted ?? 0) <= 0 || deduction < 0 || (physical !== null && deduction >= physical)) {
          findings.push(finding(ticket, "HARVEST_MASS_DOMAIN_INVALID", "P0", "ticket", ticket.id,
            "physical > 0, accepted > 0, 0 <= deductions < physical",
            `physical=${describeKg(physical)}, deduction=${describeKg(deduction)}, accepted=${describeKg(accepted)}`,
            "Finalized harvest mass is outside the permitted accounting domain.", ["Inspect finalize validation and transaction rollback."]));
        }
      }
    }

    if (isWeighbridgeTicket(ticket) && ticket.isFinalized && !ticket.isVoided && (ticket.grossKg === null || ticket.tareKg === null || ticket.netKg === null)) {
      findings.push(finding(ticket, "FINALIZED_TICKET_MISSING_WEIGHT", "P0", "ticket", ticket.id,
        "gross, tare and net are all present", `gross=${describeKg(ticket.grossKg)}, tare=${describeKg(ticket.tareKg)}, net=${describeKg(ticket.netKg)}`,
        "A finalized ticket cannot be reconstructed deterministically.", ["Inspect ticket_weighings and finalize response."]));
    }

    if (ticket.isFinalized && !ticket.isVoided && (ticket.opType === "harvest_incoming" || ticket.ticketType === "harvest")) {
      const weighingNumbers = new Set(weighings.map((item) => item.weighingNo).filter((value): value is number => value !== null));
      if (!(weighingNumbers.has(1) && weighingNumbers.has(2)) || weighings.length !== 2) {
        findings.push(finding(ticket, "HARVEST_WEIGHING_EVENT_COUNT", "P1", "ticket", ticket.id,
          "exactly two weighing events numbered 1 and 2", `${weighings.length} events: ${Array.from(weighingNumbers).join(", ") || "none"}`,
          "The paper ticket may be correct while the device/operator event trace is incomplete or duplicated.",
          ["Inspect ticket_weighings timestamps, source and operator attribution."]));
      }
    }

    const materialLines = lines.filter((line) => !["loss", "waste", "impurity"].includes(line.lineType ?? ""));
    const lineNet = sum(materialLines.map((line) => line.quantityKg ?? line.netKg));
    const expectedLineKg = ticket.opType === "harvest_incoming" ? ticket.acceptedWeightKg ?? ticket.netKg : ticket.netKg;
    if (ticket.isFinalized && !ticket.isVoided && expectedLineKg !== null && materialLines.length > 0 && !closeEnough(lineNet, expectedLineKg)) {
      findings.push(finding(ticket, "TICKET_LINE_MASS_MISMATCH", "P0", "ticket", ticket.id,
        `material line mass = accounting mass ${describeKg(expectedLineKg)}`, describeKg(lineNet),
        "Ticket header and canonical material lines disagree.", ["Inspect quantity_kg, mass_kg and line_type on ticket_lines."]));
    }

    if (isOpen(ticket) && ledger.length > 0 && !closeEnough(effectiveLedgerTotal(ledger), 0)) {
      findings.push(finding(ticket, "OPEN_TICKET_HAS_LEDGER_IMPACT", "P0", "ticket", ticket.id,
        "open ticket ledger impact = 0 kg", describeKg(effectiveLedgerTotal(ledger)),
        "An unfinished ticket has already changed accounting mass.", ["Inspect finalize transaction boundary and ledger idempotency."]));
    }

    if (ticket.isVoided && !closeEnough(effectiveLedgerTotal(ledger), 0)) {
      findings.push(finding(ticket, "VOIDED_TICKET_NONZERO_IMPACT", "P0", "ticket", ticket.id,
        "voided ticket effective ledger impact = 0 kg", describeKg(effectiveLedgerTotal(ledger)),
        "The ticket was voided but its accounting effect was not fully reversed.", ["Trace original ledger rows and their storno rows."]));
    }

    if (isWeighbridgeTicket(ticket) && ticket.isFinalized && !ticket.isVoided) {
      const expected = expectedLedgerTotal(ticket);
      const actual = effectiveLedgerTotal(ledger);
      if (expected !== null && !closeEnough(expected, actual)) {
        findings.push(finding(ticket, "FINALIZED_TICKET_LEDGER_MISMATCH", "P0", "ticket", ticket.id,
          `effective ledger impact ${describeKg(expected)}`, describeKg(actual),
          "The finalized business document and stock ledger do not carry the same mass.",
          ["Trace every stock_ledger_entries row by ticket_id.", "Check duplicate finalize retries and storno references."]));
      }
    }

    if (ticket.isFinalized && !ticket.isVoided && (ticket.opType === "harvest_incoming" || ticket.ticketType === "harvest")) {
      const linkedBatches = snapshot.batches.filter((batch) => batch.sourceTicketId === ticket.id);
      const batchIds = new Set([
        ...linkedBatches.map((batch) => batch.id),
        ...lines.map((line) => line.batchId).filter((id): id is string => Boolean(id && batchById.has(id))),
      ]);
      if (batchIds.size !== 1) {
        findings.push(finding(ticket, "FINALIZED_HARVEST_WITHOUT_BATCH", "P0", "ticket", ticket.id,
          "exactly one traceable inventory batch", `${batchIds.size} linked batches`, "Harvest mass must have one technical trip batch.",
          ["Inspect inventory_batches.source_ticket_id and ticket_lines batch references."]));
      }
      if (materialLines.length !== 1) {
        findings.push(finding(ticket, "HARVEST_LINE_COUNT", "P0", "ticket", ticket.id,
          "exactly one canonical harvest line", `${materialLines.length} material lines`,
          "A normal harvest intake must finalize one accounting line.", ["Inspect ticket_lines before finalize."]));
      }
      const activeIncoming = ledger.filter((entry) => !entry.isStorno && entry.deltaKg > 0);
      if (activeIncoming.length !== 1) {
        findings.push(finding(ticket, "HARVEST_ACTIVE_LEDGER_COUNT", "P0", "ticket", ticket.id,
          "exactly one active IN ledger row", `${activeIncoming.length} active IN rows`,
          "Harvest intake must post one accounting receipt.", ["Inspect finalize idempotency and ledger trigger output."]));
      }
      const lotLinks = snapshot.lotBatches.filter((link) => link.sourceTicketId === ticket.id || batchIds.has(link.batchId));
      if (lotLinks.length !== 1) {
        findings.push(finding(ticket, "HARVEST_LOT_LINK_COUNT", "P0", "ticket", ticket.id,
          "exactly one aggregate lot link", `${lotLinks.length} lot links`,
          "The technical trip batch must belong to one aggregate harvest lot.", ["Inspect harvest_lot_batches idempotency."]));
      }
    }

    if (ticket.correctionOfTicketId && !ticketById.has(ticket.correctionOfTicketId)) {
      findings.push(finding(ticket, "CORRECTION_SOURCE_NOT_IN_TRACE", "P1", "ticket", ticket.id,
        "correction source ticket is present in the audit trace", ticket.correctionOfTicketId,
        "The replacement cannot be reviewed end-to-end in this snapshot.", ["Run Black Box trace for the source ticket."]));
    }
    if (ticket.correctionOfTicketId) {
      const original = ticketById.get(ticket.correctionOfTicketId);
      if (original && ticket.isFinalized && !ticket.isVoided && !original.isVoided) {
        findings.push(finding(ticket, "CORRECTION_DOUBLE_ACTIVE", "P0", "ticket", ticket.id,
          "only one active economic document in a correction chain", `source ${original.ticketNo} and replacement ${ticket.ticketNo} are active`,
          "A correction chain can double count mass.", ["Inspect void/storno transaction for the original ticket."]));
      }
    }
  }

  const duplicateLedger = new Map<string, TruthLedgerEntry[]>();
  for (const entry of snapshot.ledgerEntries.filter((row) => !row.isStorno)) {
    const signature = [entry.ticketId, entry.processingId, entry.batchId, entry.warehouseId, entry.direction, entry.reasonType, entry.deltaKg].join("|");
    duplicateLedger.set(signature, [...(duplicateLedger.get(signature) ?? []), entry]);
  }
  for (const entries of Array.from(duplicateLedger.values())) {
    if (entries.length < 2) continue;
    const first = entries[0];
    const ticket = first.ticketId ? ticketById.get(first.ticketId) ?? null : null;
    findings.push(finding(ticket, "DUPLICATE_ACTIVE_LEDGER_ENTRY", "P0", "ledger", first.id,
      "one active ledger row per business effect", `${entries.length} indistinguishable active rows`,
      "A retry may have posted the same accounting effect more than once.", ["Compare row ids and timestamps.", "Verify the idempotency key used by finalize/processing."]));
  }

  const ledgerIds = new Set(snapshot.ledgerEntries.map((entry) => entry.id));
  for (const entry of snapshot.ledgerEntries.filter((row) => row.isStorno && row.stornoOfEntryId && !ledgerIds.has(row.stornoOfEntryId))) {
    findings.push(finding(null, "ORPHAN_STORNO_REFERENCE", "P0", "ledger", entry.id,
      "storno_of_entry_id points to a loaded original row", entry.stornoOfEntryId ?? "NULL",
      "The reversal chain cannot be proven.", ["Run a ticket-level trace including the referenced original ledger row."]));
  }

  for (const batch of snapshot.batches) {
    if (batch.currentKg !== null && batch.currentKg < -EPSILON_KG) {
      findings.push(finding(batch.sourceTicketId ? ticketById.get(batch.sourceTicketId) ?? null : null,
        "NEGATIVE_BATCH_BALANCE", "P0", "batch", batch.id, "current batch mass >= 0 kg", describeKg(batch.currentKg),
        "A physical batch has gone negative.", ["Trace outbound allocations, transfers and storno rows for this exact batch."]));
    }
    if (batch.sourceTicketId && !ticketById.has(batch.sourceTicketId)) {
      findings.push(finding(null, "ORPHAN_BATCH_SOURCE_TICKET", "P1", "batch", batch.id,
        "source ticket included in the audit trace", batch.sourceTicketId,
        "The batch source document is outside this snapshot or missing.", ["Run Black Box trace by batch id."]));
    }
  }

  for (const link of snapshot.lotBatches) {
    if (!lotById.has(link.lotId) || !batchById.has(link.batchId)) {
      findings.push(finding(link.sourceTicketId ? ticketById.get(link.sourceTicketId) ?? null : null,
        "ORPHAN_LOT_BATCH_LINK", "P0", "lot", link.lotId,
        "both aggregate lot and technical batch exist", `lot=${lotById.has(link.lotId)}, batch=${batchById.has(link.batchId)}`,
        "Aggregate harvest traceability contains an orphan link.", ["Inspect harvest_lot_batches foreign-key history and merge state."]));
    }
  }

  const lotsByIdentity = new Map<string, TruthLot[]>();
  for (const lot of snapshot.lots.filter((row) => !row.status || !["merged", "archived", "voided"].includes(row.status))) {
    const key = lot.identityKey ?? identityTuple(lot);
    if (lot.identityKind === "confirmed" || (lot.cropId && lot.varietyId && lot.reproductionId)) {
      lotsByIdentity.set(key, [...(lotsByIdentity.get(key) ?? []), lot]);
    }
  }
  for (const lots of Array.from(lotsByIdentity.values())) {
    if (lots.length > 1) {
      findings.push(finding(null, "DUPLICATE_CONFIRMED_AGGREGATE_LOT", "P1", "lot", lots[0].id,
        "one active aggregate lot per season + crop + variety + reproduction", `${lots.length} active lots: ${lots.map((lot) => lot.lotCode ?? lot.id).join(", ")}`,
        "The user may see the same harvest identity split into several general lots.", ["Check controlled merge history; field must not split confirmed identity."]));
    }
  }

  for (const lot of snapshot.lots) {
    const linked = snapshot.lotBatches.filter((link) => link.lotId === lot.id).map((link) => batchById.get(link.batchId)).filter(Boolean);
    const conflicts = linked.filter((batch) =>
      (lot.seasonId && batch!.seasonId && lot.seasonId !== batch!.seasonId)
      || (lot.cropId && batch!.cropId && lot.cropId !== batch!.cropId)
      || (lot.varietyId && batch!.varietyId && lot.varietyId !== batch!.varietyId)
      || (lot.reproductionId && batch!.reproductionId && lot.reproductionId !== batch!.reproductionId));
    if (conflicts.length > 0) {
      findings.push(finding(null, "LOT_IDENTITY_CONFLICT", "P0", "lot", lot.id,
        `all batches match ${identityTuple(lot)}`, `${conflicts.length} linked batch identities conflict`,
        "An aggregate lot combines incompatible harvest identities.", ["Inspect each harvest_lot_batches link and the controlled reassignment audit."]));
    }
  }

  for (const transformation of snapshot.transformations) {
    const inputs = snapshot.transformationInputs.filter((row) => row.transformationId === transformation.id);
    const outputs = snapshot.transformationOutputs.filter((row) => row.transformationId === transformation.id);
    const inputKg = transformation.inputTotalKg ?? sum(inputs.map((row) => row.inputKg));
    const outputKg = transformation.outputTotalKg ?? sum(outputs.map((row) => row.outputKg));
    const differenceKg = transformation.massDifferenceKg ?? inputKg - outputKg;
    if (["completed", "closed", "finalized"].includes(transformation.status ?? "") && (inputs.length === 0 || outputs.length === 0)) {
      findings.push(finding(null, "PROCESSING_TRACE_INCOMPLETE", "P0", "processing", transformation.id,
        "completed processing has at least one input and output", `inputs=${inputs.length}, outputs=${outputs.length}`,
        "The processing document cannot explain where mass came from and where it went.", ["Inspect transformation input/output rows and source tickets."]));
    }
    if (!closeEnough(inputKg, outputKg + differenceKg)) {
      findings.push(finding(null, "PROCESSING_MASS_BALANCE_MISMATCH", "P0", "processing", transformation.id,
        `input = outputs + documented difference (${describeKg(inputKg)})`, `${describeKg(outputKg)} + ${describeKg(differenceKg)}`,
        "Processing violates mass conservation.", ["Separate product output, impurity, waste and moisture difference.", "Check for missing output tickets."]));
    }
    const inputMeasuredKg = sum(inputs.filter((row) => row.moisturePercent !== null).map((row) => row.inputKg));
    if (inputKg > EPSILON_KG && inputMeasuredKg + EPSILON_KG < inputKg) {
      findings.push(finding(null, "PROCESSING_MOISTURE_COVERAGE_PARTIAL", "P2", "processing", transformation.id,
        `moisture coverage = ${describeKg(inputKg)}`, describeKg(inputMeasuredKg),
        "A weighted moisture average must not treat unmeasured mass as zero.", ["Report measured mass coverage alongside the weighted average."]));
    }
  }

  const openTickets = snapshot.tickets.filter(isOpen);
  for (const dimension of ["vehicleId", "driverId"] as const) {
    const grouped = new Map<string, TruthTicket[]>();
    for (const ticket of openTickets) {
      const value = ticket[dimension];
      if (value) grouped.set(value, [...(grouped.get(value) ?? []), ticket]);
    }
    for (const [value, tickets] of Array.from(grouped.entries())) {
      if (tickets.length > 1) {
        findings.push(finding(tickets[0], dimension === "vehicleId" ? "VEHICLE_IN_MULTIPLE_OPEN_TICKETS" : "DRIVER_IN_MULTIPLE_OPEN_TICKETS",
          "P1", "ticket", tickets[0].id, `one open ticket per ${dimension === "vehicleId" ? "vehicle" : "driver"}`,
          `${tickets.length} open tickets share ${value}`, "Operational queue occupancy is ambiguous.",
          ["Confirm whether these are genuine concurrent trips or a duplicate gross retry."]));
      }
    }
  }

  const idempotency = new Map<string, TruthTicket[]>();
  for (const ticket of snapshot.tickets) {
    if (ticket.idempotencyKey) idempotency.set(ticket.idempotencyKey, [...(idempotency.get(ticket.idempotencyKey) ?? []), ticket]);
  }
  for (const [key, tickets] of Array.from(idempotency.entries())) {
    const ids = new Set(tickets.map((ticket) => ticket.id));
    const isSingleCorrectionChain = tickets.length > 1 && tickets.every((ticket) =>
      ticket.correctionOfTicketId === null || ids.has(ticket.correctionOfTicketId))
      && tickets.every((ticket) => ticket.replacementTicketId === null || ids.has(ticket.replacementTicketId));
    if (tickets.length > 1 && !isSingleCorrectionChain) {
      findings.push(finding(tickets[0], "IDEMPOTENCY_KEY_COLLISION", "P0", "ticket", tickets[0].id,
        "one ticket per idempotency key", `${tickets.length} tickets use ${key}`,
        "A network retry created more than one business document.", ["Trace API request ids and compare creation timestamps."]));
    }
  }

  for (const ticket of snapshot.tickets) {
    const season = ticket.seasonId ? snapshot.seasons.find((row) => row.id === ticket.seasonId) : null;
    if (season?.archived && season.endDate && ticket.createdAt && new Date(ticket.createdAt) > new Date(season.endDate)) {
      findings.push(finding(ticket, "CLOSED_SEASON_NEW_TICKET", "P1", "ticket", ticket.id,
        "no new business document after closed season end", `ticket ${ticket.createdAt}, season ended ${season.endDate}`,
        "A ticket appears to mutate a closed historical season.", ["Verify season timezone and explicit administrative override."]));
    }
  }

  findings.sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.code.localeCompare(right.code) || left.objectId.localeCompare(right.objectId));
  const p0 = findings.filter((item) => item.priority === "P0").length;
  const p1 = findings.filter((item) => item.priority === "P1").length;
  const p2 = findings.filter((item) => item.priority === "P2").length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: snapshot.environment,
    companyId: snapshot.companyId,
    companyName: snapshot.companyName,
    selection: snapshot.selection,
    counts: {
      tickets: snapshot.tickets.length,
      openTickets: openTickets.length,
      finalizedTickets: snapshot.tickets.filter((ticket) => ticket.isFinalized && !ticket.isVoided).length,
      voidedTickets: snapshot.tickets.filter((ticket) => ticket.isVoided).length,
      batches: snapshot.batches.length,
      lots: snapshot.lots.length,
      ledgerEntries: snapshot.ledgerEntries.length,
      transformations: snapshot.transformations.length,
    },
    summary: { p0, p1, p2, status: p0 > 0 ? "FAIL" : p1 > 0 ? "ATTENTION" : "PASS" },
    findings,
  };
}
