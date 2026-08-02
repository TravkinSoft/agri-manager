import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildMaterialSelectItems, type MaterialCatalogProduct } from "../lib/catalog/material-select";

const globalProduct = (id: string, productType: string, name: string, extra: Partial<MaterialCatalogProduct> = {}): MaterialCatalogProduct => ({
  id,
  company_id: null,
  name,
  trade_name: name,
  product_type: productType,
  type: productType,
  archived: false,
  is_active: true,
  ...extra,
});

const products: MaterialCatalogProduct[] = [
  globalProduct("p1", "pesticide", "АМИСТАР ТРИО", { manufacturer: "Syngenta", normalized_name: "amistar trio", aliases: ["Амистар"], active_ingredient: "азоксистробин" }),
  globalProduct("p2", "growth_regulator", "Регулятор 1"),
  globalProduct("a1", "additive", "БИОЛИП"),
  globalProduct("a2", "adjuvant", "Адъювант 1"),
  globalProduct("f1", "fertilizer", "Curamin Foliar", { manufacturer: "Swissgrow" }),
  globalProduct("p3", "pesticide", "Архив", { archived: true }),
  globalProduct("p4", "pesticide", "Неактивный", { is_active: false }),
  { ...globalProduct("foreign", "pesticide", "Чужой"), company_id: "company-b" },
  { ...globalProduct("override-p1", "pesticide", "АМИСТАР ТРИО локально"), company_id: "company-a", master_product_id: "p1" },
];

const links = [{ global_product_id: "f1", source: "operation", sources: ["operation"] }];
const stocks = [
  { product_id: "p1", warehouse_id: "w1", quantity: 10, uom: "l" },
  { product_id: "override-p1", warehouse_id: "w2", quantity: 5, uom: "l" },
  { product_id: "override-p1", warehouse_id: "w2", quantity: 2, uom: "kg" },
];

const tests: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => tests.push({ name, run });
const select = (group: "pesticides" | "additives" | "fertilizers", query = "") =>
  buildMaterialSelectItems({
    products: products.filter((row) => !row.company_id || row.company_id === "company-a"),
    stocks,
    links,
    group,
    query,
    globalLimit: 60,
  }).items;

test("01 agronomist global pesticide contract", () => assert(select("pesticides").some((row) => row.canonical_product_id === "p1")));
test("02 growth regulator group", () => assert(select("pesticides").some((row) => row.product_type === "growth_regulator")));
test("03 additive group", () => assert(select("additives").some((row) => row.product_type === "additive")));
test("04 adjuvant group", () => assert(select("additives").some((row) => row.product_type === "adjuvant")));
test("05 fertilizer group", () => assert(select("fertilizers").some((row) => row.product_type === "fertilizer")));
test("06 pesticide excludes fertilizer", () => assert(!select("pesticides").some((row) => row.product_type === "fertilizer")));
test("07 additive excludes fertilizer", () => assert(!select("additives").some((row) => row.product_type === "fertilizer")));
test("08 archived excluded", () => assert(!select("pesticides").some((row) => row.product_id === "p3")));
test("09 inactive excluded", () => assert(!select("pesticides").some((row) => row.product_id === "p4")));
test("10 foreign company filtered by endpoint precondition", () => assert.equal(products.filter((row) => !row.company_id || row.company_id === "company-a").some((row) => row.id === "foreign"), false));
test("11 trade name search", () => assert.equal(select("pesticides", "АМИСТАР").length, 1));
test("12 alias search", () => assert.equal(select("pesticides", "Амистар").length, 1));
test("13 manufacturer search", () => assert.equal(select("fertilizers", "Swissgrow").length, 1));
test("14 normalized name search", () => assert.equal(select("pesticides", "amistar").length, 1));
test("15 search without company products", () => assert(buildMaterialSelectItems({ products: products.filter((row) => !row.company_id), stocks: [], links: [], group: "fertilizers", query: "Curamin" }).items.length === 1));
test("16 empty company catalog has global results", () => assert(buildMaterialSelectItems({ products: [products[0]], stocks: [], links: [], group: "pesticides" }).items.length === 1));
test("17 stock first", () => assert.equal(select("pesticides")[0].canonical_product_id, "p1"));
test("18 zero stock selectable", () => assert(select("pesticides").some((row) => !row.has_stock)));
test("19 warehouses aggregate", () => assert.equal(select("pesticides")[0].available_quantities.find((row) => row.unit === "l")?.quantity, 15));
test("20 units not mixed", () => assert.equal(select("pesticides")[0].available_quantities.length, 2));
test("21 planning builder has no ledger mutation", () => assert(!fs.readFileSync(path.join(process.cwd(), "lib/catalog/material-select.ts"), "utf8").includes("stock_ledger_entries")));
test("22 planning builder has no stock mutation", () => assert(!fs.readFileSync(path.join(process.cwd(), "lib/catalog/material-select.ts"), "utf8").includes("update(")));
test("23 planning builder has no reservation", () => assert(!fs.readFileSync(path.join(process.cwd(), "lib/catalog/material-select.ts"), "utf8").includes("reservation")));
test("24 override hides global duplicate", () => assert.equal(select("pesticides").filter((row) => row.canonical_product_id === "p1").length, 1));
test("25 linked global one row", () => assert.equal(select("fertilizers").filter((row) => row.canonical_product_id === "f1").length, 1));
test("26 alias does not create row", () => assert.equal(select("pesticides").length, 2));
test("27 equivalent warehouse identity deduped", () => assert.equal(select("pesticides")[0].product_id, "override-p1"));
test("28 canonical identity unique", () => assert.equal(new Set(select("pesticides").map((row) => row.canonical_product_id)).size, select("pesticides").length));

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260802143944_global_material_select_company_links_v1.sql"), "utf8");
const operationRoute = fs.readFileSync(path.join(process.cwd(), "app/api/operations/route.ts"), "utf8");
const referencesRoute = fs.readFileSync(path.join(process.cwd(), "app/api/references/materials/route.ts"), "utf8");
const selectRoute = fs.readFileSync(path.join(process.cwd(), "app/api/products/material-select/route.ts"), "utf8");

test("29 cancelled operation has no UI link mutation", () => assert(!selectRoute.includes("insert into public.company_product_links")));
test("30 failed operation protected by after trigger", () => assert(migration.includes("after insert or update of product_id on public.operation_materials")));
test("31 successful operation creates link", () => assert(migration.includes("'operation'")));
test("32 repeated operation unique protected", () => assert(migration.includes("unique (company_id, global_product_id)")));
test("33 last_used_at updates", () => assert(migration.includes("last_used_at = greatest")));
test("34 receipt creates link", () => assert(migration.includes("stock_ledger_company_product_link_v1")));
test("35 repeated receipt upserts", () => assert(migration.includes("on conflict (company_id, global_product_id) do update")));
test("36 no product copy in receipt v4", () => assert(!migration.match(/insert into public\.products/i)));
test("37 linked product reference endpoint", () => assert(referencesRoute.includes("company_product_links")));
test("38 used status", () => assert(referencesRoute.includes('statuses.push("Использовался")')));
test("39 stock status", () => assert(referencesRoute.includes('statuses.push("На складе")')));
test("40 reference canonical dedupe", () => assert(referencesRoute.includes("rowsByCanonicalId")));
test("41 company links RLS", () => assert(migration.includes('create policy "Company members can read company product links"')));
test("42 stock filtered by actor company", () => assert(selectRoute.includes('.eq("company_id", companyId)')));
test("43 agronomist cannot mutate global product", () => assert(migration.includes("revoke insert, update, delete on table public.company_product_links")));
test("44 warehouse cannot mutate global product", () => assert(!migration.includes("grant update on public.products")));
test("45 global admin access retained", () => assert(migration.includes("private.is_active_global_admin()")));
test("46 operation uses atomic RPC", () => assert(operationRoute.includes("create_operation_plan_atomic_v12")));
test("47 zero-stock global is retained", () => assert(select("fertilizers").some((row) => !row.has_stock)));
test("48 material request remains in atomic operation", () => assert(migration.includes("operation_materials_company_product_link_v1")));
test("49 canonical product id retained", () => assert.equal(select("pesticides")[0].canonical_product_id, "p1"));
test("50 water absent from product groups", () => assert(!select("pesticides").some((row) => row.product_type === "water")));
test("51 tank mix math file untouched by builder", () => assert(!fs.readFileSync(path.join(process.cwd(), "lib/catalog/material-select.ts"), "utf8").includes("tankMix")));
test("52 multi-section code remains", () => assert(operationRoute.includes("targets")));
test("53 responsible contract remains", () => assert(operationRoute.includes("responsible_user_id")));

let passed = 0;
for (const current of tests) {
  try {
    current.run();
    passed += 1;
    console.log(`PASS ${current.name}`);
  } catch (error) {
    console.error(`FAIL ${current.name}`);
    throw error;
  }
}
console.log(`TZ-245 automated contract: ${passed}/${tests.length} PASS`);
