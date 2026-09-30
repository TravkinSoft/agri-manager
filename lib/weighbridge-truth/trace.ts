import type { TruthFinding, TruthSnapshot } from "./types";
import { verifyWeighbridgeTruth } from "./engine";

export interface BlackBoxTrace {
  generatedAt: string;
  environment: TruthSnapshot["environment"];
  companyId: string;
  target: { type: "ticket" | "lot" | "batch"; id: string };
  chain: Array<{
    step: number;
    kind: string;
    id: string;
    label: string;
    massKg?: number | null;
    status?: string | null;
    references: string[];
  }>;
  findings: TruthFinding[];
  explanation: string[];
}

function linkedTicketIds(snapshot: TruthSnapshot, target: BlackBoxTrace["target"]): Set<string> {
  const ids = new Set<string>();
  if (target.type === "ticket") {
    const ticket = snapshot.tickets.find((row) => row.id === target.id || row.ticketNo === target.id);
    ids.add(ticket?.id ?? target.id);
  }
  if (target.type === "batch") {
    const batch = snapshot.batches.find((row) => row.id === target.id);
    if (batch?.sourceTicketId) ids.add(batch.sourceTicketId);
    for (const link of snapshot.lotBatches.filter((row) => row.batchId === target.id)) if (link.sourceTicketId) ids.add(link.sourceTicketId);
  }
  if (target.type === "lot") {
    for (const link of snapshot.lotBatches.filter((row) => row.lotId === target.id)) if (link.sourceTicketId) ids.add(link.sourceTicketId);
    for (const ticket of snapshot.tickets.filter((row) => row.harvestLotId === target.id || row.lotId === target.id)) ids.add(ticket.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const ticket of snapshot.tickets) {
      if (ids.has(ticket.id) && ticket.correctionOfTicketId && !ids.has(ticket.correctionOfTicketId)) {
        ids.add(ticket.correctionOfTicketId);
        changed = true;
      }
      if (ids.has(ticket.id) && ticket.replacementTicketId && !ids.has(ticket.replacementTicketId)) {
        ids.add(ticket.replacementTicketId);
        changed = true;
      }
      if (ticket.correctionOfTicketId && ids.has(ticket.correctionOfTicketId) && !ids.has(ticket.id)) {
        ids.add(ticket.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function buildBlackBoxTrace(snapshot: TruthSnapshot, target: BlackBoxTrace["target"]): BlackBoxTrace {
  const ticketIds = linkedTicketIds(snapshot, target);
  const batches = snapshot.batches.filter((row) => row.id === target.id || (row.sourceTicketId && ticketIds.has(row.sourceTicketId)));
  const batchIds = new Set(batches.map((row) => row.id));
  const lotIds = new Set(snapshot.lotBatches.filter((row) => batchIds.has(row.batchId)).map((row) => row.lotId));
  if (target.type === "lot") lotIds.add(target.id);
  const transformations = snapshot.transformations.filter((row) =>
    (row.sourceTicketId && ticketIds.has(row.sourceTicketId)) || (row.harvestLotId && lotIds.has(row.harvestLotId))
    || snapshot.transformationInputs.some((input) => input.transformationId === row.id && input.batchId && batchIds.has(input.batchId)),
  );
  const transformationIds = new Set(transformations.map((row) => row.id));
  const chain: BlackBoxTrace["chain"] = [];

  for (const ticket of snapshot.tickets.filter((row) => ticketIds.has(row.id))) {
    chain.push({ step: 0, kind: "ticket", id: ticket.id, label: ticket.ticketNo, massKg: ticket.netKg, status: ticket.status,
      references: [ticket.batchId, ticket.harvestLotId, ticket.correctionOfTicketId, ticket.replacementTicketId].filter((value): value is string => !!value) });
  }
  for (const weighing of snapshot.weighings.filter((row) => ticketIds.has(row.ticketId))) {
    chain.push({ step: 1, kind: "weighing", id: weighing.id, label: `Weighing ${weighing.weighingNo ?? "?"}`, massKg: weighing.measuredKg,
      references: [weighing.ticketId] });
  }
  for (const batch of batches) {
    chain.push({ step: 2, kind: "batch", id: batch.id, label: batch.batchCode ?? batch.id, massKg: batch.currentKg, status: batch.status,
      references: [batch.sourceTicketId, batch.warehouseId].filter((value): value is string => !!value) });
  }
  for (const lot of snapshot.lots.filter((row) => lotIds.has(row.id))) {
    chain.push({ step: 3, kind: "aggregate_lot", id: lot.id, label: lot.lotCode ?? lot.id, status: lot.status,
      references: snapshot.lotBatches.filter((row) => row.lotId === lot.id).map((row) => row.batchId) });
  }
  for (const entry of snapshot.ledgerEntries.filter((row) => (row.ticketId && ticketIds.has(row.ticketId)) || (row.batchId && batchIds.has(row.batchId)))) {
    chain.push({ step: 4, kind: entry.isStorno ? "ledger_storno" : "ledger", id: entry.id, label: entry.reasonType ?? entry.direction ?? "ledger",
      massKg: entry.deltaKg, references: [entry.ticketId, entry.batchId, entry.warehouseId, entry.stornoOfEntryId].filter((value): value is string => !!value) });
  }
  for (const transformation of transformations) {
    chain.push({ step: 5, kind: "processing", id: transformation.id, label: transformation.transformationType ?? "processing",
      massKg: transformation.outputTotalKg, status: transformation.status,
      references: [transformation.sourceTicketId, transformation.harvestLotId].filter((value): value is string => !!value) });
  }
  for (const output of snapshot.transformationOutputs.filter((row) => transformationIds.has(row.transformationId))) {
    chain.push({ step: 6, kind: "processing_output", id: output.id, label: output.outputRole ?? output.lineType ?? "output", massKg: output.outputKg,
      references: [output.transformationId, output.batchId, output.sourceTicketId].filter((value): value is string => !!value) });
  }

  chain.sort((left, right) => left.step - right.step || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const report = verifyWeighbridgeTruth(snapshot);
  const relatedIds = new Set([
    ...Array.from(ticketIds),
    ...Array.from(batchIds),
    ...Array.from(lotIds),
    ...Array.from(transformationIds),
  ]);
  const findings = report.findings.filter((item) => relatedIds.has(item.objectId) || (item.ticketNo && chain.some((row) => row.label === item.ticketNo)));
  const explanation = [
    `Trace starts from ${target.type} ${target.id}.`,
    `${ticketIds.size} ticket(s), ${batchIds.size} technical batch(es), ${lotIds.size} aggregate lot(s), and ${transformationIds.size} processing document(s) are linked.`,
    `The selected chain has ${snapshot.ledgerEntries.filter((row) => (row.ticketId && ticketIds.has(row.ticketId)) || (row.batchId && batchIds.has(row.batchId))).length} ledger row(s).`,
    findings.length === 0 ? "No invariant violation was found in the linked chain." : `${findings.length} invariant violation(s) require investigation; no data was changed.`,
  ];
  return { generatedAt: new Date().toISOString(), environment: snapshot.environment, companyId: snapshot.companyId, target, chain, findings, explanation };
}

export function renderBlackBoxTraceMarkdown(trace: BlackBoxTrace): string {
  return [
    "# Weighbridge Black Box Trace",
    "",
    `- Target: **${trace.target.type} ${trace.target.id}**`,
    `- Environment: **${trace.environment}**`,
    `- Generated: ${trace.generatedAt}`,
    "",
    "## Human explanation",
    "",
    ...trace.explanation.map((item) => `- ${item}`),
    "",
    "## Chain",
    "",
    "| Step | Kind | Label | Mass kg | Status | References |",
    "|---:|---|---|---:|---|---|",
    ...trace.chain.map((item) => `| ${item.step} | ${item.kind} | ${item.label.replace(/\|/g, "\\|")} | ${item.massKg ?? "-"} | ${item.status ?? "-"} | ${item.references.join(", ")} |`),
    "",
    "## Findings",
    "",
    ...(trace.findings.length === 0 ? ["No linked findings."] : trace.findings.map((item) => `- **${item.priority} ${item.code}**: ${item.explanation}`)),
    "",
  ].join("\n");
}
