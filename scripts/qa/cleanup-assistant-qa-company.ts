import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUDIT_DIR,
  asArray,
  createBranchAdmin,
  deleteIds,
  loadFixture,
  requireExactRowIfExists,
  writeAuditText,
} from "./assistant-qa-common";

interface DatasetState {
  branchRef: string;
  originalCompanyNames: Record<string, string>;
}

async function main() {
  const fixture = await loadFixture();
  const client = createBranchAdmin(fixture);
  const dataset = fixture.dataset;
  const fields = asArray<{ id: string }>(dataset.fields);
  const isolationField = dataset.isolationField as { id: string };
  const cropLines = asArray<{ id: string }>(dataset.cropLines);
  const operations = asArray<{ id: string; lineId: string }>(dataset.operations);
  const materials = asArray<{ id: string }>(dataset.operationMaterials);
  const warehouses = asArray<{ id: string }>(dataset.warehouses);
  const transactions = asArray<{ id: string }>(dataset.transactions);
  const state = JSON.parse(
    await readFile(`${AUDIT_DIR}dataset_seed_state.json`, "utf8"),
  ) as DatasetState;
  assert.equal(state.branchRef, fixture.branchRef);

  for (const row of transactions) {
    await requireExactRowIfExists(client, "inventory_transactions", row.id, { notes: fixture.marker });
  }
  for (const row of materials) {
    await requireExactRowIfExists(client, "operation_materials", row.id, { notes: fixture.marker });
  }
  for (const row of operations) {
    await requireExactRowIfExists(client, "operations", row.id, { notes: fixture.marker });
    await requireExactRowIfExists(client, "operation_lines", row.lineId, { notes: fixture.marker });
  }
  for (const row of cropLines) {
    await requireExactRowIfExists(client, "crop_structure", row.id, { notes: fixture.marker });
  }
  for (const row of [...fields, isolationField]) {
    await requireExactRowIfExists(client, "fields", row.id, { notes: fixture.marker });
  }
  for (const row of warehouses) {
    await requireExactRowIfExists(client, "warehouses", row.id, { description: fixture.marker });
  }

  const transactionIds = transactions.map((row) => row.id);
  const { data: ledgerRows, error: ledgerError } = await client
    .from("stock_ledger_entries")
    .select("id,reason_ref_id,notes")
    .in("reason_ref_id", transactionIds);
  if (ledgerError) throw ledgerError;
  for (const row of ledgerRows ?? []) {
    assert.equal(row.notes, fixture.marker, `STOP: ledger ${row.id} is not fixture-owned`);
  }

  const deleted = {
    ledgerEntries: await deleteIds(
      client,
      "stock_ledger_entries",
      (ledgerRows ?? []).map((row) => row.id),
    ),
    inventoryTransactions: await deleteIds(client, "inventory_transactions", transactionIds),
    operationMaterials: await deleteIds(
      client,
      "operation_materials",
      materials.map((row) => row.id),
    ),
    operationLines: await deleteIds(
      client,
      "operation_lines",
      operations.map((row) => row.lineId),
    ),
    operations: await deleteIds(client, "operations", operations.map((row) => row.id)),
    cropStructure: await deleteIds(
      client,
      "crop_structure",
      cropLines.map((row) => row.id),
    ),
    fields: await deleteIds(
      client,
      "fields",
      [...fields.map((row) => row.id), isolationField.id],
    ),
    warehouses: await deleteIds(client, "warehouses", warehouses.map((row) => row.id)),
    seasons: await deleteIds(client, "seasons", [String(dataset.seasonId)]),
  };

  for (const companyKey of ["a", "b"]) {
    const id = fixture.users[companyKey].companyId;
    const targetName = fixture.companies[companyKey].name;
    const originalName = state.originalCompanyNames[companyKey];
    const { data, error } = await client.from("companies").select("name").eq("id", id).single();
    if (error) throw error;
    assert(
      data.name === targetName || data.name === originalName,
      `STOP: company ${companyKey} name is not fixture-owned`,
    );
    if (data.name === targetName) {
      const { error: restoreError } = await client
        .from("companies")
        .update({ name: originalName })
        .eq("id", id);
      if (restoreError) throw restoreError;
    }
  }

  const { count: referencesRemaining, error: referencesError } = await client
    .from("products")
    .select("id", { count: "exact", head: true })
    .in("id", fixture.products.map((row) => row.id));
  if (referencesError) throw referencesError;
  assert.equal(referencesRemaining, 3, "Reference baseline must survive dataset cleanup");

  await writeAuditText(
    "cleanup_report.md",
    `# TZ-176 cleanup report\n\nDataset cleanup deleted only fixture-marked ERP rows and restored the two pre-existing QA company names. Global references remained intact.\n\n\`\`\`json\n${JSON.stringify(deleted, null, 2)}\n\`\`\`\n`,
  );
  console.log(JSON.stringify({
    status: "PASS",
    deleted,
    referencesRemaining,
    companiesPreserved: 2,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
