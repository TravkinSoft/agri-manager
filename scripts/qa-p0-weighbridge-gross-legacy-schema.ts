import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveWarehouseStockContract } from "../lib/server/warehouse-stock-contract";

type MockResult = { data: Record<string, unknown> | null; error: Record<string, unknown> | null };

function productClient(results: MockResult[]) {
  const selects: string[] = [];
  return {
    selects,
    from(table: string) {
      assert.equal(table, "products");
      return {
        select(columns: string) {
          selects.push(columns);
          return {
            eq(key: string, value: string) {
              assert.equal(key, "id");
              assert.equal(value, "product-1");
              return {
                async maybeSingle() {
                  const result = results.shift();
                  assert.ok(result, "unexpected products query");
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };
}

async function main() {
const legacyClient = productClient([
  {
    data: null,
    error: { code: "42703", message: "column products.density_kg_per_l does not exist" },
  },
  {
    data: {
      id: "product-1",
      company_id: null,
      base_uom: "kg",
      unit: "kg",
      product_type: "crop",
      archived: false,
    },
    error: null,
  },
]);

const legacyContract = await resolveWarehouseStockContract(legacyClient, {
  companyId: "company-1",
  productId: "product-1",
  quantity: 8500,
  inputUom: "kg",
  event: "harvest_incoming",
});

assert.equal(legacyClient.selects.length, 2);
assert.match(legacyClient.selects[0], /density_kg_per_l/);
assert.doesNotMatch(legacyClient.selects[1], /density_kg_per_l/);
assert.equal(legacyContract.persistenceSchema, "legacy");
assert.equal(legacyContract.baseUom, "kg");
assert.equal(legacyContract.baseQuantity, 8500);
assert.equal(legacyContract.massKg, 8500);
assert.equal(legacyContract.batchClass, "commodity");
assert.equal(legacyContract.densityKgPerL, null);
assert.equal(legacyContract.densityUnit, null);

const unrelatedErrorClient = productClient([
  {
    data: null,
    error: { code: "42703", message: "column products.unrelated_column does not exist" },
  },
]);

await assert.rejects(
  () => resolveWarehouseStockContract(unrelatedErrorClient, {
    companyId: "company-1",
    productId: "product-1",
    quantity: 100,
    inputUom: "kg",
    event: "harvest_incoming",
  }),
  /unrelated_column/
);
assert.equal(unrelatedErrorClient.selects.length, 1, "unrelated database errors must not be retried");

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "app/api/weighbridge/tickets/route.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "app/(dashboard)/weighbridge/page.tsx"), "utf8");

assert.match(route, /stockContractPersistenceSchema === "v2"/);
assert.match(route, /mass_kg: line\.mass_kg/);
assert.match(route, /: \{\}\),/);

assert.doesNotMatch(page, /Требуется внимание|intakeStatusLabel/);
assert.match(page, /aria-label="Режим весовой"/);
assert.match(page, /role="tablist"/);
assert.match(page, /overflow-x-auto/);
assert.match(page, /WEIGHBRIDGE_MODES\.map/);
for (const label of [
  "Урожай с поля",
  "От контрагента",
  "Выдача в поле",
  "Перемещение",
  "Отгрузка",
  "Списание",
  "Примеси",
]) {
  assert.match(page, new RegExp(label));
}
assert.doesNotMatch(page, /DropdownMenuItem onClick=\{\(\) => selectOperation/);
assert.match(page, /harvestWarehouses\.length === 0/);
assert.match(page, /drivers\.length === 0/);

console.log("P0 WEIGHBRIDGE GROSS LEGACY SCHEMA PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
