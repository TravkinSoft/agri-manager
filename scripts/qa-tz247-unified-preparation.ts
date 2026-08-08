import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildMaterialSelectItems, type MaterialCatalogProduct } from "../lib/catalog/material-select";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const product = (id: string, productType: string, name: string, extra: Partial<MaterialCatalogProduct> = {}): MaterialCatalogProduct => ({
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
  product("pesticide", "pesticide", "Фунгицид"),
  product("growth", "growth_regulator", "Регулятор роста"),
  product("fertilizer", "fertilizer", "Листовое удобрение"),
  product("additive", "additive", "Корректор воды"),
  product("adjuvant", "adjuvant", "Адъювант"),
  product("water", "water", "Вода"),
  product("seed", "seed", "Семена"),
  { ...product("override", "pesticide", "Фунгицид компании"), company_id: "company-a", master_product_id: "pesticide" },
];

const selected = buildMaterialSelectItems({
  products,
  stocks: [
    { product_id: "override", quantity: 12, uom: "l" },
    { product_id: "fertilizer", quantity: 5, uom: "kg" },
  ],
  links: [],
  group: "preparations",
  globalLimit: 60,
}).items;

check("01 unified group contains pesticide", () => assert(selected.some((row) => row.product_type === "pesticide")));
check("02 unified group contains growth regulator", () => assert(selected.some((row) => row.product_type === "growth_regulator")));
check("03 unified group contains fertilizer", () => assert(selected.some((row) => row.product_type === "fertilizer")));
check("04 unified group contains additive", () => assert(selected.some((row) => row.product_type === "additive")));
check("05 unified group contains adjuvant", () => assert(selected.some((row) => row.product_type === "adjuvant")));
check("06 water is not a selectable preparation", () => assert(!selected.some((row) => row.product_type === "water")));
check("07 seed is not a selectable preparation", () => assert(!selected.some((row) => row.product_type === "seed")));
check("08 stock remains first", () => assert.equal(selected[0].has_stock, true));
check("09 zero stock remains selectable", () => assert(selected.some((row) => !row.has_stock)));
check("10 company override dedupes global identity", () => assert.equal(selected.filter((row) => row.canonical_product_id === "pesticide").length, 1));
check("11 canonical identities remain unique", () => assert.equal(new Set(selected.map((row) => row.canonical_product_id)).size, selected.length));

const operationForm = read("components/operations/operation-form-dialog.tsx");
const selectRoute = read("app/api/products/material-select/route.ts");
const materialSelect = read("lib/catalog/material-select.ts");

check("12 API exposes unified preparation group", () => assert(selectRoute.includes('"preparations"')));
check("13 one preparation command is visible", () => assert(operationForm.includes("Добавить препарат")));
check("14 category is inferred instead of selected", () => assert(operationForm.includes("preparationCategoryLabel(selectedProduct)")));
check("15 unified search uses preparation endpoint", () => assert(operationForm.includes('remoteProductGroup: OperationMaterialCatalogGroup')));
check("16 target is rendered in one canonical list", () => assert(operationForm.includes('data-testid="operation-target-list"')));
check("17 target picker is explicit", () => assert(operationForm.includes('data-testid="operation-target-picker"')));
check("18 duplicate planning instructions removed", () => assert(!operationForm.includes("Логика плана")));
check("19 left panel has independent scroll", () => assert(operationForm.includes("overflow-y-auto overscroll-contain border-b")));
check("20 footer is pinned in dialog flow", () => assert(operationForm.includes('className="flex shrink-0 flex-col gap-3 border-t')));
check("21 water stays a calculation, not a product", () => assert(operationForm.includes("calculatedWaterTotalL") && !materialSelect.includes('"water"')));
check("22 multi-target area has one calculation source", () => assert(operationForm.includes("const operationAreaForCalculation = supportsMultiTarget && totalTargetArea > 0")));
check("23 crop mix support remains", () => assert(operationForm.includes("selectedIsCropMix")));
check("24 fallow and whole-field support remain", () => assert(operationForm.includes('land_use_type === "fallow"') && operationForm.includes('scope: "whole_field"')));
check("25 seed identity remains structure-owned", () => assert(operationForm.includes("selectedCropStructure.reproduction_id")));
check("26 seed product select is still blocked", () => assert(operationForm.includes('component.slug === "seed" && isPotatoPlanting')));
check("27 seed requirement remains canonical kg", () => assert(operationForm.includes("calculateSeedRequirementKg")));
check("28 material builder performs no writes", () => assert(!materialSelect.includes("stock_ledger_entries") && !materialSelect.includes(".update(")));

let passed = 0;
for (const current of checks) {
  try {
    current.run();
    passed += 1;
    console.log(`PASS ${current.name}`);
  } catch (error) {
    console.error(`FAIL ${current.name}`);
    throw error;
  }
}

assert.equal(checks.length, 28);
console.log(`TZ-247 automated contract: ${passed}/28 PASS`);
