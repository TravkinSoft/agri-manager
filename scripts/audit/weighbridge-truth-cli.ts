import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeTruthSnapshot } from "../../lib/weighbridge-truth/normalize";
import { fetchTruthSnapshot, type TruthSelection } from "../../lib/weighbridge-truth/read-only-source";
import { verifyWeighbridgeTruth } from "../../lib/weighbridge-truth/engine";
import { renderTruthReportMarkdown } from "../../lib/weighbridge-truth/report";

interface CliOptions extends TruthSelection {
  snapshot?: string;
  outDir?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { environment: "qa" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--env" && (value === "qa" || value === "production")) { options.environment = value; index += 1; continue; }
    if (arg === "--company" && value) { options.company = value; index += 1; continue; }
    if (arg === "--ticket" && value) { options.ticket = value; index += 1; continue; }
    if (arg === "--lot" && value) { options.lot = value; index += 1; continue; }
    if (arg === "--batch" && value) { options.batch = value; index += 1; continue; }
    if (arg === "--snapshot" && value) { options.snapshot = value; index += 1; continue; }
    if (arg === "--out-dir" && value) { options.outDir = value; index += 1; continue; }
    if (arg === "--all") { options.all = true; continue; }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = options.snapshot
    ? normalizeTruthSnapshot(JSON.parse(await readFile(path.resolve(options.snapshot), "utf8")))
    : await fetchTruthSnapshot(options);
  const report = verifyWeighbridgeTruth(snapshot);
  const outDir = path.resolve(options.outDir ?? "data/audit/weighbridge-truth");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${snapshot.environment}-${snapshot.companyId}-${stamp}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const markdownPath = path.join(outDir, `${base}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, `${renderTruthReportMarkdown(report)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify({ status: report.summary.status, summary: report.summary, json: jsonPath, markdown: markdownPath }));
  if (report.summary.p0 > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});

