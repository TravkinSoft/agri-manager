import assert from "node:assert/strict";
import { compactReproductionLabel } from "../lib/agronomy/reproduction-display";

const cases: Array<[string | null | undefined, string]> = [
  ["Первая репродукция", "1"],
  ["1 репродукция", "1"],
  ["РС1", "1"],
  ["Вторая репродукция", "2"],
  ["2-я репродукция", "2"],
  ["Репродукция 3", "3"],
  ["Элита", "Элита"],
  ["Суперэлита", "Суперэлита"],
  ["F1", "F1"],
  [null, "—"],
];

for (const [input, expected] of cases) {
  assert.equal(compactReproductionLabel(input), expected, String(input));
}

console.log(`Reproduction display PASS ${cases.length}/${cases.length}`);
