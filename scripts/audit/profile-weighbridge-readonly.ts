import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

interface Sample { route: string; iteration: number; status: number; redirected: boolean; durationMs: number; bytes: number }

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const baseUrl = arg("--base-url", "https://qa.travkinflow.com").replace(/\/$/, "");
  const iterations = Number(arg("--iterations", "20"));
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw new Error("--iterations must be 1..100");
  const cookie = process.env.QA_SESSION_COOKIE;
  const routes = ["/weighbridge", "/warehouses", "/api/auth/actor", "/api/weighbridge/operator-session"];
  const samples: Sample[] = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    for (const route of routes) {
      const started = performance.now();
      const response = await fetch(`${baseUrl}${route}`, {
        method: "GET",
        redirect: "manual",
        headers: cookie ? { Cookie: cookie } : undefined,
        cache: "no-store",
      });
      const body = await response.arrayBuffer();
      samples.push({ route, iteration, status: response.status, redirected: response.status >= 300 && response.status < 400,
        durationMs: Math.round((performance.now() - started) * 100) / 100, bytes: body.byteLength });
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    iterations,
    authenticatedCookieProvided: !!cookie,
    readOnly: true,
    routes: routes.map((route) => {
      const rows = samples.filter((sample) => sample.route === route);
      const durations = rows.map((sample) => sample.durationMs);
      return {
        route,
        statuses: Array.from(new Set(rows.map((sample) => sample.status))),
        minMs: Math.min(...durations),
        medianMs: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maxMs: Math.max(...durations),
        redirects: rows.filter((sample) => sample.redirected).length,
      };
    }),
    limitation: cookie
      ? null
      : "No QA_SESSION_COOKIE was provided. Results cover the permanent QA edge/auth gate only; operator PIN POST, bootstrap and finalize latency were not exercised because this audit forbids writes.",
    samples,
  };
  const outDir = path.resolve("data/audit/weighbridge-performance");
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `permanent-qa-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: out, routes: report.routes, limitation: report.limitation }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
