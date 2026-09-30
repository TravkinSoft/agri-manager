import type { TruthReport } from "./types";

function line(value: unknown): string {
  return value === null || value === undefined || value === "" ? "-" : String(value).replace(/\|/g, "\\|");
}

export function renderTruthReportMarkdown(report: TruthReport): string {
  const rows = report.findings.map((item) =>
    `| ${item.priority} | ${item.code} | ${item.objectType} | ${line(item.ticketNo ?? item.objectId)} | ${line(item.actual)} | ${line(item.expected)} |`,
  );
  return [
    "# Weighbridge Truth Report",
    "",
    `- Environment: **${report.environment}**`,
    `- Company: **${report.companyName ?? report.companyId}**`,
    `- Generated: ${report.generatedAt}`,
    `- Status: **${report.summary.status}**`,
    `- Findings: P0=${report.summary.p0}, P1=${report.summary.p1}, P2=${report.summary.p2}`,
    `- Scope: tickets=${report.counts.tickets}, batches=${report.counts.batches}, lots=${report.counts.lots}, ledger=${report.counts.ledgerEntries}, processing=${report.counts.transformations}`,
    "",
    "## Findings",
    "",
    ...(rows.length > 0
      ? ["| Priority | Code | Object | Ticket / ID | Actual | Expected |", "|---|---|---|---|---|---|", ...rows]
      : ["No invariant violations found in the selected snapshot."]),
    "",
    "## Investigation",
    "",
    ...report.findings.flatMap((item) => [
      `### ${item.priority} ${item.code} - ${item.ticketNo ?? item.objectId}`,
      "",
      item.explanation,
      "",
      ...item.investigation.map((step) => `- ${step}`),
      "",
    ]),
  ].join("\n");
}

