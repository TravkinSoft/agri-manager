import assert from "node:assert/strict";
import {
  buildHarvestLotOptionLabel,
  summarizeAggregateHarvestLotFields,
} from "../lib/weighbridge/harvest-lot-option-label";

const single = summarizeAggregateHarvestLotFields([
  { fieldId: "field-4", fieldName: "4(2-4)" },
  { fieldId: "field-4", fieldName: "4(2-4)" },
]);
assert.deepEqual(single, { fieldId: "field-4", fieldName: "4(2-4)", fieldCount: 1 });

const multiple = summarizeAggregateHarvestLotFields([
  { fieldId: "field-2", fieldName: "Поле 2" },
  { fieldId: "field-1", fieldName: "Поле 1" },
  { fieldId: "", fieldName: "" },
]);
assert.deepEqual(multiple, { fieldId: null, fieldName: "Поле 1, Поле 2", fieldCount: 2 });

assert.deepEqual(
  summarizeAggregateHarvestLotFields([{ fieldId: null, fieldName: null }]),
  { fieldId: null, fieldName: "", fieldCount: 0 },
);

const label = buildHarvestLotOptionLabel({
  fieldName: "4(2-4)",
  cropName: "Картофель",
  varietyName: "Гала",
  reproductionName: "2 репродукция",
  cleanMassKg: 44_240,
});
assert.match(label, /^4\(2-4\) · Картофель \/ Гала \/ 2 репродукция · остаток 44(?:\s|\u00a0)240 кг$/u);
assert.doesNotMatch(label, /HL-/);

const fallback = buildHarvestLotOptionLabel({
  fieldName: "",
  cropName: "Картофель",
  varietyName: "Коломбо",
  reproductionName: "F1",
  cleanMassKg: 260_260,
});
assert.match(fallback, /^Поле не указано · Картофель \/ Коломбо \/ F1 · остаток 260(?:\s|\u00a0)260 кг$/u);

console.log("P0 weighbridge lot field label PASS: 5/5");
