import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUDIT_DIR,
  createBranchAdmin,
  deleteIds,
  loadFixture,
  requireExactRow,
  writeAuditText,
} from "./assistant-qa-common";

interface ReferenceState {
  branchRef: string;
  created: Record<string, string[]>;
}

async function main() {
  const fixture = await loadFixture();
  const client = createBranchAdmin(fixture);
  const state = JSON.parse(
    await readFile(`${AUDIT_DIR}reference_seed_state.json`, "utf8"),
  ) as ReferenceState;
  assert.equal(state.branchRef, fixture.branchRef);

  const productIds = state.created.products ?? [];
  const varietyIds = state.created.varieties ?? [];
  const reproductionIds = state.created.reproductions ?? [];
  for (const id of productIds) {
    await requireExactRow(client, "products", id, { notes: fixture.marker, company_id: null });
  }
  for (const id of varietyIds) {
    await requireExactRow(client, "varieties", id, { notes: fixture.marker, company_id: null });
  }
  for (const id of reproductionIds) {
    await requireExactRow(client, "seed_reproductions", id, {
      description: fixture.marker,
      company_id: null,
    });
  }

  const allReferenceIds = [
    ...productIds,
    ...varietyIds,
    ...reproductionIds,
  ];
  if (allReferenceIds.length > 0) {
    const checks = [
      ["operation_materials", "product_id", productIds],
      ["inventory_transactions", "product_id", productIds],
      ["crop_structure", "variety_id", varietyIds],
      ["crop_structure", "reproduction_id", reproductionIds],
    ] as const;
    for (const [table, column, ids] of checks) {
      if (ids.length === 0) continue;
      const { count, error } = await client
        .from(table)
        .select("id", { count: "exact", head: true })
        .in(column, ids);
      if (error) throw error;
      assert.equal(count, 0, `STOP: ${table} still depends on fixture references`);
    }
  }

  const deleted = {
    aliases: await deleteIds(client, "global_product_aliases", state.created.aliases ?? []),
    products: await deleteIds(client, "products", productIds),
    varieties: await deleteIds(client, "varieties", varietyIds),
    reproductions: await deleteIds(client, "seed_reproductions", reproductionIds),
    manufacturers: 0,
  };

  for (const id of state.created.manufacturers ?? []) {
    const { count, error } = await client
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("manufacturer_id", id);
    if (error) throw error;
    assert.equal(count, 0, `STOP: manufacturer ${id} is still referenced`);
  }
  deleted.manufacturers = await deleteIds(
    client,
    "agrochem_manufacturers",
    state.created.manufacturers ?? [],
  );

  await writeAuditText(
    "cleanup_report.md",
    `# TZ-176 cleanup report\n\nReference cleanup deleted only IDs recorded as created by the fixture.\n\n\`\`\`json\n${JSON.stringify(deleted, null, 2)}\n\`\`\`\n`,
  );
  console.log(JSON.stringify({ status: "PASS", deleted }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
