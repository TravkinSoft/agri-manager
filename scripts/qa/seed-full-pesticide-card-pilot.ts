import assert from "node:assert/strict";
import {
  createBranchAdmin,
  ensureExactRow,
  ensureExactTransition,
  fixtureTableRows,
  loadPilotFixture,
  verifyBranchGuard,
  writePilotAudit,
} from "./full-pesticide-card-pilot-common";

async function main() {
  const fixture = await loadPilotFixture();
  const client = createBranchAdmin(fixture);
  await verifyBranchGuard(client, fixture);

  const results: Record<string, Record<string, number>> = {};
  const baselineById = new Map(fixture.componentBaselines.map((row) => [String(row.id), row]));
  const componentCounts = { created: 0, existing: 0, updated: 0 };
  for (const component of fixture.components) {
    const baseline = baselineById.get(String(component.id));
    if (baseline) {
      const outcome = await ensureExactTransition(client, "glbd_components", baseline, component);
      componentCounts[outcome] += 1;
    } else {
      const outcome = await ensureExactRow(client, "glbd_components", component);
      componentCounts[outcome] += 1;
    }
  }
  results.glbd_components = componentCounts;

  for (const [table, rows] of fixtureTableRows(fixture)) {
    const counts = { created: 0, existing: 0 };
    for (const row of rows) {
      const outcome = await ensureExactRow(client, table, row);
      counts[outcome] += 1;
    }
    results[table] = counts;
  }

  const { count: productCount, error: productError } = await client
    .from("products")
    .select("id", { count: "exact", head: true })
    .in("id", fixture.products.map((row) => String(row.id)));
  if (productError) throw new Error(`Pilot product count failed: ${productError.message}`);
  assert.equal(productCount, 10, "STOP: all 10 pilot products must exist");

  const created = Object.values(results).reduce((sum, row) => sum + row.created, 0);
  await writePilotAudit("seed-run.json", {
    task: "TZ-199",
    branchRef: fixture.branchRef,
    created,
    results,
  });
  console.log(JSON.stringify({ branchRef: fixture.branchRef, created, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
