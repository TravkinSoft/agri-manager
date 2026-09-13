import { loadEnvConfig } from "@next/env";
import { writeFileSync } from "node:fs";
import { assertRuntime } from "../../lib/tf-assist/policy";
import {
  createReadOnlySourceReader,
  loadSnapshot,
} from "../../lib/tf-assist/read-only";
import { buildAnswer } from "../../lib/tf-assist/analysis";
loadEnvConfig(process.cwd());
async function main() {
  assertRuntime(process.env);
  const report = [];
  for (const companyId of [
    "8a0f2c0e-6638-4a31-99a8-cab4237d287d",
    "4e65767a-9527-4e7f-afea-ec2426ec0193",
  ]) {
    const s = await loadSnapshot(
      companyId,
      createReadOnlySourceReader(
        companyId,
        process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      ),
    );
    const source = s.sources.crop_structure?.rows[0];
    const answer = source
      ? buildAnswer(
          s,
          {
            companyId,
            sourceId: String(source.id),
            seasonId: String(source.season_id),
            message: "Урожайность",
            harvestedHa: "7",
            remainingHa: "18",
          },
          "yield",
        )
      : undefined;
    report.push({
      companyId,
      from: s.startedAt,
      to: s.endedAt,
      sources: Object.values(s.sources).map((r) => ({
        table: r!.table,
        state: r!.state,
        reason: r!.reason,
        count: r!.rows.length,
        schema: r!.schema,
        digest: r!.digest,
      })),
      analysis: answer
        ? {
            conclusion: answer.conclusion,
            metricCount: answer.metrics.length,
            warningCount: answer.warnings.length,
          }
        : null,
    });
  }
  writeFileSync(
    "docs/project-live/tf-assist-qa-readonly-evidence.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      report.map((r) => ({
        companyId: r.companyId,
        complete: r.sources.filter((s) => s.state === "complete").length,
        unavailable: r.sources.filter((s) => s.state !== "complete"),
        analysed: Boolean(r.analysis),
      })),
      null,
      2,
    ),
  );
}
main().catch(() => {
  console.error("TF_ASSIST_QA_AUDIT_FAILED");
  process.exitCode = 1;
});
