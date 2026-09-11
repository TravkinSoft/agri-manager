import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import { dedupeProductsForSelect } from "../lib/catalog/catalog-identity";

type ProductFixture = {
  id: string;
  name?: string | null;
  trade_name?: string | null;
  normalized_name?: string | null;
  company_id?: string | null;
  manufacturer?: string | null;
  product_type?: string | null;
  category?: string | null;
  unit?: string | null;
  notes?: string | null;
};

const baselineOnly = process.argv.includes("--baseline");

const cases: Array<{
  name: string;
  rows: ProductFixture[];
  expectedIds: string[];
}> = [
  {
    name: "verified RU/EN aliases collapse to one identity",
    rows: [
      { id: "curamin-en", name: "Curamin Foliar", product_type: "fertilizer" },
      { id: "curamin-ru", name: "Курамин", product_type: "fertilizer" },
    ],
    expectedIds: ["curamin-en"],
  },
  {
    name: "company product wins inside the same manufacturer bucket",
    rows: [
      {
        id: "global-celest",
        name: "Celest Top",
        manufacturer: "Syngenta",
        product_type: "pesticide",
      },
      {
        id: "company-celest",
        name: "Селест Топ, КС",
        manufacturer: "Syngenta",
        company_id: "company-a",
        product_type: "pesticide",
      },
    ],
    expectedIds: ["company-celest"],
  },
  {
    name: "distinct known manufacturers remain distinct",
    rows: [
      { id: "maker-b", name: "Новый продукт", manufacturer: "BASF", product_type: "pesticide" },
      { id: "maker-s", name: "Новый продукт", manufacturer: "Syngenta", product_type: "pesticide" },
    ],
    expectedIds: ["maker-b", "maker-s"],
  },
  {
    name: "more complete duplicate wins without changing identity",
    rows: [
      { id: "sparse", name: "Материал X", manufacturer: "Yara", product_type: "material" },
      {
        id: "complete",
        name: "Материал X",
        manufacturer: "Yara",
        product_type: "material",
        unit: "kg",
        notes: "source=test",
      },
    ],
    expectedIds: ["complete"],
  },
  {
    name: "blank identity is omitted",
    rows: [
      { id: "blank", name: "", product_type: "" },
      { id: "real", name: "Реальный товар", product_type: "material" },
    ],
    expectedIds: ["real"],
  },
  {
    name: "labels are sorted with Russian locale",
    rows: [
      { id: "beta", name: "Бета", product_type: "material" },
      { id: "alpha", name: "Альфа", product_type: "material" },
    ],
    expectedIds: ["alpha", "beta"],
  },
  {
    name: "equal labels retain input order",
    rows: [
      { id: "same-first", name: "Одинаковый", product_type: "material" },
      { id: "same-second", name: "Одинаковый", product_type: "seed" },
    ],
    expectedIds: ["same-first", "same-second"],
  },
];

for (const testCase of cases) {
  assert.deepEqual(
    dedupeProductsForSelect(testCase.rows).map((row) => row.id),
    testCase.expectedIds,
    testCase.name
  );
}

const largeFixture: ProductFixture[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: `fixture-${index}`,
  name: `Тестовый продукт ${String(index).padStart(4, "0")}`,
  manufacturer: index % 3 === 0 ? "BASF" : index % 3 === 1 ? "Syngenta" : "Yara",
  product_type: index % 2 === 0 ? "material" : "fertilizer",
  unit: "kg",
}));

const startedAt = performance.now();
const largeResult = dedupeProductsForSelect(largeFixture);
const elapsedMs = performance.now() - startedAt;
assert.equal(largeResult.length, largeFixture.length, "unique fixture rows must not be dropped");

if (!baselineOnly) {
  assert.ok(
    elapsedMs < 2_500,
    `1000-row dedupe exceeded the 2500 ms budget: ${elapsedMs.toFixed(1)} ms`
  );

  const routeSource = readFileSync(
    resolve("app/api/warehouses/products/route.ts"),
    "utf8"
  );
  assert.match(routeSource, /const PRODUCT_ALIAS_QUERY_CHUNK_SIZE = 100;/);
  assert.match(
    routeSource,
    /productIds\.slice\(offset, offset \+ PRODUCT_ALIAS_QUERY_CHUNK_SIZE\)/
  );
  assert.match(routeSource, /\.in\("product_id", productIdChunk\)/);
  assert.match(
    routeSource,
    /if \(result\.error\) \{[\s\S]*alias enrichment skipped[\s\S]*continue;/
  );
}

console.log(
  JSON.stringify(
    {
      suite: "TF2 containers product catalog performance",
      mode: baselineOnly ? "baseline" : "regression",
      edgeCases: cases.length,
      fixtureRows: largeFixture.length,
      resultRows: largeResult.length,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      routeChecks: baselineOnly ? 0 : 4,
      status: "PASS",
    },
    null,
    2
  )
);
