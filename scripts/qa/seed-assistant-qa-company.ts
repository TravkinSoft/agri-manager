import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUDIT_DIR,
  asArray,
  createBranchAdmin,
  ensureExactRow,
  indexByKey,
  loadFixture,
  requireExactRow,
  writeAuditJson,
  writeAuditText,
} from "./assistant-qa-common";

interface FieldFixture {
  key: string;
  id: string;
  name: string;
  area: number;
}

interface CropLineFixture {
  key: string;
  id: string;
  fieldKey: string;
  cropKey: string;
  area: number;
  identity?: boolean;
}

interface OperationFixture {
  key: string;
  id: string;
  lineId: string;
  fieldKey: string;
  cropLineKey: string;
  type: string;
  category: string;
  status: "planned" | "in_progress" | "completed";
  area: number;
  completedArea: number;
  progress: number;
}

interface MaterialFixture {
  id: string;
  operationKey: string;
  productKey: string;
  unit: string;
  plannedRate: number;
  actualRate: number | null;
  plannedQuantity: number;
  issued: number;
  consumed: number;
  returned: number;
  loss: number;
}

interface WarehouseFixture {
  key: string;
  id: string;
  name: string;
  company: "a" | "b";
}

interface TransactionFixture {
  id: string;
  warehouseKey: string;
  productKey: string;
  company: "a" | "b";
  movement: "receipt" | "issue";
  quantity: number;
  unit: "kg" | "l";
  operationKey?: string;
  fieldKey?: string;
}

interface DatasetState {
  branchRef: string;
  originalCompanyNames: Record<string, string>;
}

async function loadOrCreateState(
  client: ReturnType<typeof createBranchAdmin>,
  fixture: Awaited<ReturnType<typeof loadFixture>>,
) {
  try {
    const state = JSON.parse(
      await readFile(`${AUDIT_DIR}dataset_seed_state.json`, "utf8"),
    ) as DatasetState;
    assert.equal(state.branchRef, fixture.branchRef);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const originalCompanyNames: Record<string, string> = {};
  for (const companyKey of ["a", "b"]) {
    const companyId = fixture.users[companyKey].companyId;
    const { data, error } = await client
      .from("companies")
      .select("id,name")
      .eq("id", companyId)
      .single();
    if (error) throw error;
    originalCompanyNames[companyKey] = data.name;
  }
  const state = { branchRef: fixture.branchRef, originalCompanyNames };
  await writeAuditJson("dataset_seed_state.json", state);
  return state;
}

function operationState(operation: OperationFixture) {
  if (operation.status === "completed") {
    return {
      status: "completed",
      work_status: "completed",
      operation_status: "completed",
      specialist_task_status: "completed",
      accepted_at: "2026-05-02T08:00:00.000Z",
      started_at: "2026-05-02T09:00:00.000Z",
      completed_at: "2026-05-02T15:00:00.000Z",
      last_progress_at: "2026-05-02T15:00:00.000Z",
    };
  }
  if (operation.status === "in_progress") {
    return {
      status: "in_progress",
      work_status: "in_progress",
      operation_status: "in_progress",
      specialist_task_status: "in_progress",
      accepted_at: "2026-05-03T08:00:00.000Z",
      started_at: "2026-05-03T09:00:00.000Z",
      completed_at: null,
      last_progress_at: "2026-05-03T12:00:00.000Z",
    };
  }
  return {
    status: "planned",
    work_status: "active",
    operation_status: "planned",
    specialist_task_status: "new",
    accepted_at: null,
    started_at: null,
    completed_at: null,
    last_progress_at: null,
  };
}

async function main() {
  const fixture = await loadFixture();
  const client = createBranchAdmin(fixture);
  const dataset = fixture.dataset;
  const fields = asArray<FieldFixture>(dataset.fields);
  const isolationField = dataset.isolationField as FieldFixture;
  const cropLines = asArray<CropLineFixture>(dataset.cropLines);
  const operations = asArray<OperationFixture>(dataset.operations);
  const materials = asArray<MaterialFixture>(dataset.operationMaterials);
  const warehouses = asArray<WarehouseFixture>(dataset.warehouses);
  const transactions = asArray<TransactionFixture>(dataset.transactions);
  const products = indexByKey(fixture.products as Array<{ key: string; id: string }>);
  const fieldsByKey = indexByKey(fields);
  const cropLinesByKey = indexByKey(cropLines);
  const operationsByKey = indexByKey(operations);
  const warehousesByKey = indexByKey(warehouses);
  const state = await loadOrCreateState(client, fixture);
  const created: Record<string, number> = {
    seasons: 0,
    fields: 0,
    cropStructure: 0,
    operations: 0,
    operationLines: 0,
    operationMaterials: 0,
    warehouses: 0,
    inventoryTransactions: 0,
    ledgerEntries: 0,
  };

  for (const companyKey of ["a", "b"]) {
    const companyId = fixture.users[companyKey].companyId;
    const targetName = fixture.companies[companyKey].name;
    const { data, error } = await client
      .from("companies")
      .select("id,name")
      .eq("id", companyId)
      .single();
    if (error) throw error;
    assert(
      data.name === state.originalCompanyNames[companyKey] || data.name === targetName,
      `STOP: company ${companyKey} has an unexpected name`,
    );
    if (data.name !== targetName) {
      const { error: updateError } = await client
        .from("companies")
        .update({ name: targetName })
        .eq("id", companyId);
      if (updateError) throw updateError;
    }
  }

  for (const product of fixture.products) {
    await requireExactRow(client, "products", String(product.id), {
      notes: fixture.marker,
      company_id: null,
    });
  }
  await requireExactRow(client, "varieties", fixture.variety.id, {
    crop_id: fixture.crops.potato.id,
    notes: fixture.marker,
  });
  await requireExactRow(client, "seed_reproductions", fixture.reproduction.id, {
    code: fixture.reproduction.code,
    description: fixture.marker,
  });

  const seasonId = String(dataset.seasonId);
  const seasonRow = {
    id: seasonId,
    year: 2026,
    name: "2026 QA (TZ-176)",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    archived: false,
    user_id: fixture.users.a.id,
    company_id: fixture.users.a.companyId,
  };
  if (await ensureExactRow(client, "seasons", seasonRow) === "created") created.seasons++;

  for (const field of fields) {
    const row = {
      id: field.id,
      name: field.name,
      area: field.area,
      notes: fixture.marker,
      archived: false,
      user_id: fixture.users.a.id,
      company_id: fixture.users.a.companyId,
    };
    if (await ensureExactRow(client, "fields", row) === "created") created.fields++;
  }
  const isolationFieldRow = {
    id: isolationField.id,
    name: isolationField.name,
    area: isolationField.area,
    notes: fixture.marker,
    archived: false,
    user_id: fixture.users.b.id,
    company_id: fixture.users.b.companyId,
  };
  if (await ensureExactRow(client, "fields", isolationFieldRow) === "created") created.fields++;

  for (const line of cropLines) {
    const row = {
      id: line.id,
      field_id: fieldsByKey[line.fieldKey].id,
      area: line.area,
      status: "planned",
      notes: fixture.marker,
      archived: false,
      user_id: fixture.users.a.id,
      season_id: seasonId,
      crop_id: fixture.crops[line.cropKey].id,
      variety_id: line.identity ? fixture.variety.id : null,
      reproduction_id: line.identity ? fixture.reproduction.id : null,
      company_id: fixture.users.a.companyId,
      irrigation_type: line.fieldKey.startsWith("orchard") ? "drip" : "dryland",
    };
    if (await ensureExactRow(client, "crop_structure", row) === "created") {
      created.cropStructure++;
    }
  }

  for (const operation of operations) {
    const cropLine = cropLinesByKey[operation.cropLineKey];
    const stateFields = operationState(operation);
    const row = {
      id: operation.id,
      field_id: fieldsByKey[operation.fieldKey].id,
      crop_structure_id: cropLine.id,
      operation_type: operation.type,
      date: "2026-05-02",
      notes: fixture.marker,
      archived: false,
      user_id: fixture.users.a.id,
      company_id: fixture.users.a.companyId,
      assigned_to: fixture.users.a.id,
      responsible_user_id: fixture.users.a.id,
      operation_category_slug: operation.category,
      operation_type_slug: operation.type,
      operation_target: "field",
      operation_config: { fixture: fixture.marker },
      idempotency_key: `${fixture.marker}:${operation.key}`,
      request_fingerprint: `${fixture.marker}:${operation.id}`,
      planned_area_ha: operation.area,
      completed_area_ha: operation.completedArea,
      remaining_area_ha: operation.area - operation.completedArea,
      progress_percent: operation.progress,
      ...stateFields,
    };
    if (await ensureExactRow(client, "operations", row) === "created") created.operations++;

    const crop = fixture.crops[cropLine.cropKey];
    const lineRow = {
      id: operation.lineId,
      company_id: fixture.users.a.companyId,
      operation_id: operation.id,
      field_id: fieldsByKey[operation.fieldKey].id,
      crop_id: crop.id,
      variety_id: cropLine.identity ? fixture.variety.id : null,
      reproduction_id: cropLine.identity ? fixture.reproduction.id : null,
      planned_area_ha: operation.area,
      actual_area_ha: operation.status === "planned" ? null : operation.completedArea,
      completed_by: operation.status === "completed" ? fixture.users.a.id : null,
      completed_at: operation.status === "completed" ? "2026-05-02T15:00:00.000Z" : null,
      notes: fixture.marker,
      created_by_user_id: fixture.users.a.id,
      updated_by_user_id: fixture.users.a.id,
    };
    if (await ensureExactRow(client, "operation_lines", lineRow) === "created") {
      created.operationLines++;
    }
  }

  for (const material of materials) {
    const operation = operationsByKey[material.operationKey];
    const product = products[material.productKey];
    const row = {
      id: material.id,
      company_id: fixture.users.a.companyId,
      operation_id: operation.id,
      operation_line_id: operation.lineId,
      product_id: product.id,
      material_type: "fertilizer",
      unit: material.unit,
      planned_rate: material.plannedRate,
      actual_rate: material.actualRate,
      planned_quantity: material.plannedQuantity,
      issued_quantity: material.issued,
      consumed_quantity: material.consumed,
      returned_quantity: material.returned,
      loss_quantity: material.loss,
      notes: fixture.marker,
      created_by_user_id: fixture.users.a.id,
      updated_by_user_id: fixture.users.a.id,
    };
    if (await ensureExactRow(client, "operation_materials", row) === "created") {
      created.operationMaterials++;
    }
  }

  for (const warehouse of warehouses) {
    const user = fixture.users[warehouse.company];
    const row = {
      id: warehouse.id,
      name: warehouse.name,
      name_ru: warehouse.name,
      archived: false,
      user_id: user.id,
      company_id: user.companyId,
      responsible_user_id: user.id,
      description: fixture.marker,
      is_archived: false,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    };
    if (await ensureExactRow(client, "warehouses", row) === "created") created.warehouses++;
  }

  for (const transaction of transactions) {
    const user = fixture.users[transaction.company];
    const warehouse = warehousesByKey[transaction.warehouseKey];
    const product = products[transaction.productKey];
    const operation = transaction.operationKey ? operationsByKey[transaction.operationKey] : null;
    const field = transaction.fieldKey ? fieldsByKey[transaction.fieldKey] : null;
    const isReceipt = transaction.movement === "receipt";
    const row = {
      id: transaction.id,
      warehouse_id: warehouse.id,
      product_id: product.id,
      quantity: transaction.quantity,
      transaction_type: isReceipt ? "in" : "out",
      date: "2026-05-01",
      notes: fixture.marker,
      user_id: user.id,
      company_id: user.companyId,
      movement_type: transaction.movement,
      status: "confirmed",
      source_warehouse_id: isReceipt ? null : warehouse.id,
      destination_warehouse_id: isReceipt ? warehouse.id : null,
      operation_datetime: "2026-05-01T10:00:00.000Z",
      responsible_user_id: user.id,
      confirmed_at: "2026-05-01T10:00:00.000Z",
      operation_id: operation?.id ?? null,
      field_id: field?.id ?? null,
      quantity_input: transaction.quantity,
      input_uom: transaction.unit,
      base_quantity: transaction.quantity,
      base_uom: transaction.unit,
      mass_kg: transaction.unit === "kg" ? transaction.quantity : null,
      batch_class: "material",
      unit_source: `${fixture.marker}:${transaction.id}`,
      unit_contract_version: 2,
    };
    if (await ensureExactRow(client, "inventory_transactions", row) === "created") {
      created.inventoryTransactions++;
    }
    const { data: posted, error: postError } = await client.rpc(
      "post_inventory_transaction_to_ledger",
      { p_transaction_id: transaction.id },
    );
    if (postError) throw new Error(`Ledger post failed: ${postError.message}`);
    created.ledgerEntries += Number(posted ?? 0);
  }

  const { data: balances, error: balanceError } = await client
    .from("v_stock_balance_canonical")
    .select("company_id,warehouse_id,product_id,quantity,uom,batch_class")
    .in("company_id", [fixture.users.a.companyId, fixture.users.b.companyId])
    .order("company_id")
    .order("warehouse_id")
    .order("product_id");
  if (balanceError) throw balanceError;

  const groundTruth = {
    task: "TZ-176",
    branchRef: fixture.branchRef,
    fixtureMarker: fixture.marker,
    companies: {
      a: { id: fixture.users.a.companyId, name: fixture.companies.a.name },
      b: { id: fixture.users.b.companyId, name: fixture.companies.b.name },
    },
    expected: {
      fieldsA: 8,
      fieldsB: 1,
      totalAreaA: 1000,
      cropStructureLinesA: 9,
      operationsA: 5,
      warehousesA: 2,
      warehousesB: 1,
      ledgerEntries: 7,
      stockA: {
        nitrate: { total: 1550, unit: "kg", main: 1250, field: 300 },
        curamin: { total: 520, unit: "l", main: 480, field: 40 },
        phomazin: { total: 200, unit: "l", main: 200 },
      },
      stockB: { nitrate: { total: 777, unit: "kg" } },
    },
    balances,
    createdThisRun: created,
    productionWrites: 0,
  };
  await writeAuditJson("assistant_qa_ground_truth.json", groundTruth);
  await writeAuditText(
    "owner_test_questions.md",
    `# TZ-176 owner test questions\n\n1. Сколько полей и гектаров у Астык-STEM QA?\n2. Какие культуры посеяны на Поле31?\n3. Какая операция завершена и сколько селитры фактически израсходовано?\n4. Какая операция сейчас в работе и какова её плановая потребность Curamin Foliar?\n5. Каковы остатки трёх материалов по каждому складу?\n6. Может ли QA User A увидеть Секретное поле B и запас 777 кг? Ожидание: нет.\n`,
  );
  await writeAuditText(
    "security_expectations.md",
    `# TZ-176 security expectations\n\n- QA User A видит только компанию A и глобальные справочники.\n- QA User B видит только компанию B и глобальные справочники.\n- Cross-company fields, warehouses, operations and ledger rows return zero rows.\n- Обычные QA-пользователи не могут изменять глобальные aliases.\n- Production writes: 0.\n`,
  );

  console.log(JSON.stringify({
    status: "PASS",
    branchRef: fixture.branchRef,
    created,
    expected: groundTruth.expected,
    balanceRows: balances?.length ?? 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
