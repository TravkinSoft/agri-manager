import {
  createBranchAdmin,
  deleteExactRows,
  loadPilotFixture,
  restoreExactTransition,
  verifyBranchGuard,
  writePilotAudit,
} from "./full-pesticide-card-pilot-common";

async function main() {
  const fixture = await loadPilotFixture();
  const client = createBranchAdmin(fixture);
  await verifyBranchGuard(client, fixture);

  const cleanupOrder = [
    ["glbd_product_assistant_safety", fixture.safety],
    ["glbd_product_usage_rules", fixture.usageRules],
    ["glbd_product_registrations", fixture.registrations],
    ["glbd_product_sources", fixture.sources],
    ["glbd_product_components", fixture.productComponents],
    ["glbd_component_sources", fixture.componentSources],
    ["global_product_aliases", fixture.aliases],
    ["products", fixture.products],
    ["glbd_components", fixture.components.filter((row) => !fixture.componentBaselines.some((baseline) => baseline.id === row.id))],
    ["weeds", fixture.targets.weeds],
    ["pests", fixture.targets.pests],
    ["diseases", fixture.targets.diseases],
    ["agrochem_formulations", fixture.formulations],
    ["agrochem_manufacturers", fixture.manufacturers],
  ] as const;

  const deleted: Record<string, number> = {};
  for (const [table, rows] of cleanupOrder) {
    deleted[table] = await deleteExactRows(client, table, rows);
  }

  const targetById = new Map(fixture.components.map((row) => [String(row.id), row]));
  let restored = 0;
  for (const baseline of fixture.componentBaselines) {
    const target = targetById.get(String(baseline.id));
    if (!target) throw new Error(`Missing component target for ${String(baseline.id)}`);
    if (await restoreExactTransition(client, "glbd_components", baseline, target) === "restored") restored += 1;
  }
  deleted.glbd_components_restored = restored;

  await writePilotAudit("cleanup-run.json", {
    task: "TZ-199",
    branchRef: fixture.branchRef,
    deleted,
  });
  console.log(JSON.stringify({ branchRef: fixture.branchRef, deleted }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
