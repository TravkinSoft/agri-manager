import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureDirs,
  normalizeName,
  OUTPUT_DIR,
  PARSED_DIR,
  ParsedPageBundle,
  similarity,
  writeCsv,
} from "./bossagro-lib";

const PRODUCT_HEADERS = [
  "trade_name",
  "original_name",
  "normalized_name",
  "product_type",
  "category",
  "pesticide_type",
  "source_categories",
  "additional_pesticide_types",
  "status_text",
  "allowed_in_kazakhstan_from_source",
  "published_date",
  "short_description",
  "active_ingredients",
  "concentration_text",
  "formulation",
  "chemical_class",
  "penetration_method",
  "action_type",
  "hazard_class_human",
  "hazard_class_bees",
  "crops_summary",
  "target_objects_summary",
  "manufacturer",
  "storage_unit",
  "issue_unit",
  "default_rate_unit",
  "default_dosing_type",
  "source_url",
  "source_name",
  "source_type",
  "confidence",
  "import_status",
  "raw_attributes_json",
];

const USAGE_HEADERS = [
  "product_normalized_name",
  "product_trade_name",
  "application_rate",
  "application_rate_unit",
  "crop",
  "treated_object",
  "target_object",
  "application_method",
  "application_timing",
  "restrictions",
  "waiting_period_text",
  "waiting_period_days",
  "max_applications",
  "source_url",
  "source_name",
  "confidence",
  "raw_usage_row_json",
];

function uniqueBy<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function firstRowsCsv(rows: Record<string, unknown>[], headers: string[], count = 30) {
  return [
    headers.join(" | "),
    ...rows.slice(0, count).map((row) => headers.map((header) => String(row[header] ?? "")).join(" | ")),
  ].join("\n");
}

async function main() {
  await ensureDirs();
  const parsedPath = path.join(PARSED_DIR, "parsed_products.json");
  const bundles = JSON.parse(await readFile(parsedPath, "utf8")) as ParsedPageBundle[];

  const productByNorm = new Map<string, ParsedPageBundle>();
  const exactDuplicateRows: Record<string, string>[] = [];
  for (const bundle of bundles) {
    const key = bundle.product.normalized_name;
    const existing = productByNorm.get(key);
    if (existing) {
      exactDuplicateRows.push({
        normalized_name: key,
        kept_trade_name: existing.product.trade_name,
        duplicate_trade_name: bundle.product.trade_name,
        kept_source_url: existing.product.source_url,
        duplicate_source_url: bundle.product.source_url,
      });
      const sourceCategories = new Set([...existing.product.source_categories, ...bundle.product.source_categories]);
      existing.product.source_categories = Array.from(sourceCategories);
      existing.usageRules.push(...bundle.usageRules);
      existing.usageWarnings.push(...bundle.usageWarnings);
      existing.activeIngredients.push(...bundle.activeIngredients);
      existing.productActiveIngredients.push(...bundle.productActiveIngredients);
    } else {
      productByNorm.set(key, bundle);
    }
  }

  const products = Array.from(productByNorm.values()).map((bundle) => bundle.product);
  const possibleDuplicates: Record<string, string | number>[] = [];
  for (let i = 0; i < products.length; i += 1) {
    for (let j = i + 1; j < products.length; j += 1) {
      const a = products[i];
      const b = products[j];
      const nameScore = similarity(a.normalized_name, b.normalized_name);
      const sameFormula =
        a.active_ingredients !== "unknown" &&
        a.active_ingredients === b.active_ingredients &&
        a.concentration_text !== "unknown" &&
        a.concentration_text === b.concentration_text &&
        a.formulation !== "unknown" &&
        a.formulation === b.formulation;
      if (nameScore >= 0.93 || sameFormula) {
        possibleDuplicates.push({
          trade_name_a: a.trade_name,
          trade_name_b: b.trade_name,
          normalized_name_a: a.normalized_name,
          normalized_name_b: b.normalized_name,
          similarity: Number(nameScore.toFixed(3)),
          reason: sameFormula ? "same active ingredients + concentration + formulation" : "similar normalized name",
          source_url_a: a.source_url,
          source_url_b: b.source_url,
        });
      }
    }
  }

  const duplicateReview = new Set(possibleDuplicates.flatMap((row) => [String(row.normalized_name_a), String(row.normalized_name_b)]));
  for (const product of products) {
    const statuses = new Set(product.import_status.split(";").filter(Boolean));
    if (duplicateReview.has(product.normalized_name)) statuses.add("NEED_DUPLICATE_REVIEW");
    product.import_status = Array.from(statuses).join(";");
  }

  const allActiveIngredients = uniqueBy(
    Array.from(productByNorm.values()).flatMap((bundle) => bundle.activeIngredients),
    (row) => row.normalized_name
  );
  const allProductActiveIngredients = uniqueBy(
    Array.from(productByNorm.values()).flatMap((bundle) => bundle.productActiveIngredients),
    (row) => `${row.product_normalized_name}::${row.active_ingredient_normalized_name}`
  );
  const allUsageRules = Array.from(productByNorm.values()).flatMap((bundle) => bundle.usageRules);
  const usageWarnings = Array.from(productByNorm.values()).flatMap((bundle) => bundle.usageWarnings);
  const blocked = [
    ...Array.from(productByNorm.values()).flatMap((bundle) => bundle.blocked),
    ...products
      .filter((product) => !product.trade_name || !product.source_url || product.parse_status === "BLOCKED")
      .map((product) => ({ trade_name: product.trade_name, source_url: product.source_url, reason: "blocked_by_required_fields" })),
  ];

  const importReady = products.filter(
    (product) =>
      product.trade_name &&
      product.normalized_name &&
      product.source_url &&
      product.product_type === "pesticide" &&
      product.category === "pesticide" &&
      !product.import_status.includes("BLOCKED") &&
      !product.import_status.includes("NEED_DUPLICATE_REVIEW")
  );
  const blockedProducts = products.filter((product) => product.import_status.includes("BLOCKED"));

  await writeCsv(path.join(OUTPUT_DIR, "products_catalog.csv"), products, PRODUCT_HEADERS);
  await writeCsv(path.join(OUTPUT_DIR, "pesticides_catalog.csv"), products, PRODUCT_HEADERS);
  await writeCsv(path.join(OUTPUT_DIR, "active_ingredients.csv"), allActiveIngredients, [
    "name_ru",
    "name_en",
    "normalized_name",
    "type",
    "chemical_class",
    "source_url",
    "source_name",
    "confidence",
  ]);
  await writeCsv(path.join(OUTPUT_DIR, "product_active_ingredients.csv"), allProductActiveIngredients, [
    "product_normalized_name",
    "product_trade_name",
    "active_ingredient_normalized_name",
    "active_ingredient_name_ru",
    "concentration_text",
    "concentration_part",
    "source_url",
    "confidence",
    "parse_status",
  ]);
  await writeCsv(path.join(OUTPUT_DIR, "product_usage_rules.csv"), allUsageRules, USAGE_HEADERS);
  await writeCsv(path.join(OUTPUT_DIR, "exact_duplicates.csv"), exactDuplicateRows, [
    "normalized_name",
    "kept_trade_name",
    "duplicate_trade_name",
    "kept_source_url",
    "duplicate_source_url",
  ]);
  await writeCsv(path.join(OUTPUT_DIR, "possible_duplicates.csv"), possibleDuplicates, [
    "trade_name_a",
    "trade_name_b",
    "normalized_name_a",
    "normalized_name_b",
    "similarity",
    "reason",
    "source_url_a",
    "source_url_b",
  ]);
  await writeCsv(path.join(OUTPUT_DIR, "dedupe_decisions.csv"), possibleDuplicates, [
    "trade_name_a",
    "trade_name_b",
    "normalized_name_a",
    "normalized_name_b",
    "similarity",
    "reason",
    "source_url_a",
    "source_url_b",
  ]);
  await writeCsv(path.join(OUTPUT_DIR, "import_ready_products.csv"), importReady, PRODUCT_HEADERS);
  await writeCsv(
    path.join(OUTPUT_DIR, "blocked_products.csv"),
    blockedProducts.length
      ? blockedProducts.map((product) => ({ reason: "blocked_by_import_status", ...product }))
      : blocked,
    ["reason", ...PRODUCT_HEADERS]
  );
  await writeCsv(path.join(OUTPUT_DIR, "usage_parse_warnings.csv"), usageWarnings, [
    "product_trade_name",
    "source_url",
    "warning",
    "raw_usage_row_json",
  ]);

  const byType = products.reduce<Record<string, number>>((acc, product) => {
    acc[product.pesticide_type] = (acc[product.pesticide_type] ?? 0) + 1;
    return acc;
  }, {});
  const statusCount = (needle: string) => products.filter((product) => product.import_status.includes(needle)).length;
  const productsWithAi = products.filter((product) => product.active_ingredients !== "unknown").length;
  const productsWithConcentration = products.filter((product) => product.concentration_text !== "unknown").length;
  const productsWithFormulation = products.filter((product) => product.formulation !== "unknown").length;
  const productsWithStorageUnit = products.filter((product) => product.storage_unit !== "unknown").length;
  const productsWithRateUnit = products.filter((product) => product.default_rate_unit !== "unknown").length;

  const stats = [
    "# BossAgro pesticides catalog stats",
    "",
    `Source: https://bossagro.kz/glossary/category/pesticides/`,
    `Generated: ${new Date().toISOString()}`,
    "",
    `- products parsed: ${products.length}`,
    `- import_ready products: ${importReady.length}`,
    `- blocked products: ${blockedProducts.length}`,
    `- exact duplicates: ${exactDuplicateRows.length}`,
    `- possible duplicates: ${possibleDuplicates.length}`,
    `- unique active ingredients: ${allActiveIngredients.length}`,
    `- product_active_ingredients rows: ${allProductActiveIngredients.length}`,
    `- product_usage_rules rows: ${allUsageRules.length}`,
    `- products with active ingredients: ${productsWithAi}`,
    `- products without active ingredients: ${products.length - productsWithAi}`,
    `- products with concentration_text: ${productsWithConcentration}`,
    `- products without concentration_text: ${products.length - productsWithConcentration}`,
    `- products with formulation: ${productsWithFormulation}`,
    `- products without formulation: ${products.length - productsWithFormulation}`,
    `- products with storage_unit: ${productsWithStorageUnit}`,
    `- products without storage_unit: ${products.length - productsWithStorageUnit}`,
    `- products with default_rate_unit: ${productsWithRateUnit}`,
    `- products without default_rate_unit: ${products.length - productsWithRateUnit}`,
    `- NEED_UNIT_CHECK: ${statusCount("NEED_UNIT_CHECK")}`,
    `- NEED_ACTIVE_INGREDIENT_CHECK: ${statusCount("NEED_ACTIVE_INGREDIENT_CHECK")}`,
    `- NEED_DUPLICATE_REVIEW: ${statusCount("NEED_DUPLICATE_REVIEW")}`,
    "",
    "## Products by pesticide_type",
    "",
    ...Object.entries(byType).sort().map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## First 30 import_ready_products",
    "",
    "```",
    firstRowsCsv(importReady as unknown as Record<string, unknown>[], PRODUCT_HEADERS.slice(0, 12), 30),
    "```",
    "",
    "## First 30 product_usage_rules",
    "",
    "```",
    firstRowsCsv(allUsageRules as unknown as Record<string, unknown>[], USAGE_HEADERS.slice(0, 9), 30),
    "```",
    "",
    "## First 30 active_ingredients",
    "",
    "```",
    firstRowsCsv(allActiveIngredients as unknown as Record<string, unknown>[], [
      "name_ru",
      "normalized_name",
      "type",
      "chemical_class",
    ], 30),
    "```",
    "",
    "## Files to review",
    "",
    "- blocked_products.csv",
    "- possible_duplicates.csv",
    "- usage_parse_warnings.csv",
  ].join("\n");
  await writeFile(path.join(OUTPUT_DIR, "catalog_stats.md"), stats, "utf8");
  await writeFile(
    path.join(OUTPUT_DIR, "import_notes.md"),
    [
      "# BossAgro import notes",
      "",
      "This is a read-only data preparation pack. No Supabase writes, SQL apply, company data, warehouses, balances, ledger, batches, or operations were touched.",
      "",
      "Generated files are intended for manual review before any future import.",
      "",
      "Commands:",
      "",
      "```bash",
      "npx tsx scripts/import-materials/bossagro-fetch-links.ts",
      "npx tsx scripts/import-materials/bossagro-fetch-pages.ts",
      "npx tsx scripts/import-materials/bossagro-parse-pages.ts",
      "npx tsx scripts/import-materials/bossagro-build-catalog.ts",
      "```",
    ].join("\n"),
    "utf8"
  );

  console.log(JSON.stringify({
    products: products.length,
    import_ready: importReady.length,
    blocked: blockedProducts.length,
    exact_duplicates: exactDuplicateRows.length,
    possible_duplicates: possibleDuplicates.length,
    active_ingredients: allActiveIngredients.length,
    product_active_ingredients: allProductActiveIngredients.length,
    usage_rules: allUsageRules.length,
    outputDir: OUTPUT_DIR,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
