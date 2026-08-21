import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeTruthSnapshot } from "../../lib/weighbridge-truth/normalize";
import { fetchTruthSnapshot, type TruthSelection } from "../../lib/weighbridge-truth/read-only-source";
import { buildBlackBoxTrace, renderBlackBoxTraceMarkdown } from "../../lib/weighbridge-truth/trace";

interface Options extends TruthSelection { snapshot?: string; outDir?: string }

function parseArgs(argv: string[]): Options {
  const options: Options = { environment: "qa" };
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
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  const targets = [options.ticket, options.lot, options.batch].filter(Boolean);
  if (targets.length !== 1) throw new Error("Provide exactly one of --ticket, --lot or --batch");
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = options.snapshot
    ? normalizeTruthSnapshot(JSON.parse(await readFile(path.resolve(options.snapshot), "utf8")))
    : await fetchTruthSnapshot(options);
  const target = options.ticket
    ? { type: "ticket" as const, id: options.ticket }
    : options.lot
      ? { type: "lot" as const, id: options.lot }
      : { type: "batch" as const, id: options.batch! };
  const trace = buildBlackBoxTrace(snapshot, target);
  const outDir = path.resolve(options.outDir ?? "data/audit/weighbridge-truth");
  await mkdir(outDir, { recursive: true });
  const safeId = target.id.replace(/[^A-Za-z0-9-]/g, "_");
  const base = `trace-${snapshot.environment}-${target.type}-${safeId}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const markdownPath = path.join(outDir, `${base}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, `${renderBlackBoxTraceMarkdown(trace)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify({ target, findings: trace.findings.length, json: jsonPath, markdown: markdownPath }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});

