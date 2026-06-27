import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ActiveIngredientRow,
  OUTPUT_DIR,
  PARSED_DIR,
  ParsedPageBundle,
  ParsedProduct,
  ProductActiveIngredientRow,
  UsageRule,
  readCsv,
  writeCsv,
} from "./bossagro-lib";

const AFTER_DEDUPE_DIR = path.join(OUTPUT_DIR, "after_dedupe");

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

const DEDUPE_HEADERS = [
  "decision",
  "action",
  "confidence",
  "trade_name_a",
  "trade_name_b",
  "normalized_name_a",
  "normalized_name_b",
  "strict_key_a",
  "strict_key_b",
  "similarity",
  "reason",
  "kept_trade_name",
  "removed_trade_name",
  "source_url_a",
  "source_url_b",
  "note",
] as const;

type DuplicateRow = {
  trade_name_a: string;
  trade_name_b: string;
  normalized_name_a: string;
  normalized_name_b: string;
  similarity: string;
  reason: string;
  source_url_a: string;
  source_url_b: string;
};

type DedupeDecision = Record<(typeof DEDUPE_HEADERS)[number], string>;
type SuspiciousDuplicate = DedupeDecision & { suspicion_score: number };

class DisjointSet {
  private parent = new Map<string, string>();

  add(value: string) {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    this.add(value);
    const parent = this.parent.get(value);
    if (!parent || parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function strictProductKey(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9%]+/g, "");
}

function isUnknown(value: unknown) {
  return !value || value === "unknown";
}

function dataScore(product: ParsedProduct, bundle: ParsedPageBundle) {
  return [
    product.allowed_in_kazakhstan_from_source === "yes" ? 5 : 0,
    !isUnknown(product.active_ingredients) ? 4 : 0,
    !isUnknown(product.concentration_text) ? 3 : 0,
    !isUnknown(product.formulation) ? 2 : 0,
    bundle.usageRules.length > 0 ? 2 : 0,
    product.source_categories.length,
  ].reduce((sum, item) => sum + item, 0);
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
}

function pickKnown(current: string, candidate: string) {
  return isUnknown(current) && !isUnknown(candidate) ? candidate : current;
}

function mergeProduct(keeper: ParsedProduct, candidates: ParsedProduct[]): ParsedProduct {
  const merged: ParsedProduct = {
    ...keeper,
    source_categories: uniqueValues(candidates.flatMap((product) => product.source_categories)),
    additional_pesticide_types: uniqueValues(candidates.flatMap((product) => product.additional_pesticide_types)),
  };
  for (const product of candidates) {
    merged.status_text = pickKnown(merged.status_text, product.status_text);
    merged.allowed_in_kazakhstan_from_source =
      merged.allowed_in_kazakhstan_from_source === "unknown" && product.allowed_in_kazakhstan_from_source !== "unknown"
        ? product.allowed_in_kazakhstan_from_source
        : merged.allowed_in_kazakhstan_from_source;
    merged.published_date = pickKnown(merged.published_date, product.published_date);
    merged.short_description = pickKnown(merged.short_description, product.short_description);
    merged.active_ingredients = pickKnown(merged.active_ingredients, product.active_ingredients);
    merged.concentration_text = pickKnown(merged.concentration_text, product.concentration_text);
    merged.formulation = pickKnown(merged.formulation, product.formulation);
    merged.chemical_class = pickKnown(merged.chemical_class, product.chemical_class);
    merged.penetration_method = pickKnown(merged.penetration_method, product.penetration_method);
    merged.action_type = pickKnown(merged.action_type, product.action_type);
    merged.hazard_class_human = pickKnown(merged.hazard_class_human, product.hazard_class_human);
    merged.hazard_class_bees = pickKnown(merged.hazard_class_bees, product.hazard_class_bees);
    merged.crops_summary = pickKnown(merged.crops_summary, product.crops_summary);
    merged.target_objects_summary = pickKnown(merged.target_objects_summary, product.target_objects_summary);
    merged.manufacturer = pickKnown(merged.manufacturer, product.manufacturer);
    merged.storage_unit = pickKnown(merged.storage_unit, product.storage_unit);
    merged.issue_unit = pickKnown(merged.issue_unit, product.issue_unit);
    merged.default_rate_unit = pickKnown(merged.default_rate_unit, product.default_rate_unit);
    merged.default_dosing_type = pickKnown(merged.default_dosing_type, product.default_dosing_type);
  }
  return merged;
}

function uniqueBy<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function formatList(values: string[]) {
  return uniqueValues(values).join("; ");
}

function productForCsv(product: ParsedProduct): Record<string, unknown> {
  return {
    ...product,
    source_categories: formatList(product.source_categories),
    additional_pesticide_types: formatList(product.additional_pesticide_types),
  };
}

function firstRowsTable(rows: Record<string, unknown>[], headers: string[], count = 100) {
  return [
    headers.join(" | "),
    headers.map(() => "---").join(" | "),
    ...rows.slice(0, count).map((row) => headers.map((header) => String(row[header] ?? "")).join(" | ")),
  ].join("\n");
}

function suspicionScore(row: { similarity: string; reason: string }) {
  const base = Number(row.similarity || 0);
  const formulaBonus = row.reason.includes("same active ingredients") ? 0.2 : 0;
  return Number((base + formulaBonus).toFixed(3));
}

function makeManualDecision(row: DuplicateRow): DedupeDecision {
  return {
    decision: "NEED_MANUAL_REVIEW",
    action: "keep_separate",
    confidence: "low",
    trade_name_a: row.trade_name_a,
    trade_name_b: row.trade_name_b,
    normalized_name_a: row.normalized_name_a,
    normalized_name_b: row.normalized_name_b,
    strict_key_a: strictProductKey(row.trade_name_a),
    strict_key_b: strictProductKey(row.trade_name_b),
    similarity: row.similarity,
    reason: row.reason,
    kept_trade_name: "",
    removed_trade_name: "",
    source_url_a: row.source_url_a,
    source_url_b: row.source_url_b,
    note: "Same active ingredients or similar name is not enough for automatic merge.",
  };
}

async function main() {
  await mkdir(AFTER_DEDUPE_DIR, { recursive: true });
  const parsedPath = path.join(PARSED_DIR, "parsed_products.json");
  const bundles = JSON.parse(await readFile(parsedPath, "utf8")) as ParsedPageBundle[];
  const possibleDuplicates = (await readCsv(path.join(OUTPUT_DIR, "possible_duplicates.csv"))) as DuplicateRow[];

  const dsu = new DisjointSet();
  for (const bundle of bundles) dsu.add(bundle.product.normalized_name);

  const exactSafeDecisions: DedupeDecision[] = [];
  const firstByNorm = new Map<string, ParsedPageBundle>();
  for (const bundle of bundles) {
    const existing = firstByNorm.get(bundle.product.normalized_name);
    if (existing) {
      dsu.union(existing.product.normalized_name, bundle.product.normalized_name);
      exactSafeDecisions.push({
        decision: "SAFE_DUPLICATE",
        action: "merge_remove_duplicate",
        confidence: "high",
        trade_name_a: existing.product.trade_name,
        trade_name_b: bundle.product.trade_name,
        normalized_name_a: existing.product.normalized_name,
        normalized_name_b: bundle.product.normalized_name,
        strict_key_a: strictProductKey(existing.product.trade_name),
        strict_key_b: strictProductKey(bundle.product.trade_name),
        similarity: "1",
        reason: "exact normalized_name duplicate",
        kept_trade_name: existing.product.trade_name,
        removed_trade_name: bundle.product.trade_name,
        source_url_a: existing.product.source_url,
        source_url_b: bundle.product.source_url,
        note: "Exact normalized duplicate from raw BossAgro cards.",
      });
    } else {
      firstByNorm.set(bundle.product.normalized_name, bundle);
    }
  }

  const safeFromPossible: DedupeDecision[] = [];
  const manualReview: DedupeDecision[] = [];
  for (const row of possibleDuplicates) {
    const strictA = strictProductKey(row.trade_name_a);
    const strictB = strictProductKey(row.trade_name_b);
    if (strictA && strictA === strictB) {
      dsu.union(row.normalized_name_a, row.normalized_name_b);
      safeFromPossible.push({
        decision: "SAFE_DUPLICATE",
        action: "merge_remove_duplicate",
        confidence: "high",
        trade_name_a: row.trade_name_a,
        trade_name_b: row.trade_name_b,
        normalized_name_a: row.normalized_name_a,
        normalized_name_b: row.normalized_name_b,
        strict_key_a: strictA,
        strict_key_b: strictB,
        similarity: row.similarity,
        reason: `${row.reason}; strict name key match`,
        kept_trade_name: row.trade_name_a,
        removed_trade_name: row.trade_name_b,
        source_url_a: row.source_url_a,
        source_url_b: row.source_url_b,
        note: "Only punctuation, spaces, case, or formulation dots differ.",
      });
    } else {
      manualReview.push(makeManualDecision(row));
    }
  }

  const groups = new Map<string, ParsedPageBundle[]>();
  for (const bundle of bundles) {
    const root = dsu.find(bundle.product.normalized_name);
    const list = groups.get(root) ?? [];
    list.push(bundle);
    groups.set(root, list);
  }

  const allSafeDecisions = [...exactSafeDecisions, ...safeFromPossible];
  const manualReviewRoots = new Set(
    manualReview.flatMap((row) => [dsu.find(row.normalized_name_a), dsu.find(row.normalized_name_b)])
  );

  const products: ParsedProduct[] = [];
  const activeIngredients: ActiveIngredientRow[] = [];
  const productActiveIngredients: ProductActiveIngredientRow[] = [];
  const usageRules: UsageRule[] = [];
  const usageWarnings: Record<string, string>[] = [];
  const blocked: Record<string, string>[] = [];

  for (const group of Array.from(groups.values())) {
    const keeperBundle = [...group].sort((a, b) => {
      const scoreDiff = dataScore(b.product, b) - dataScore(a.product, a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.product.source_url.localeCompare(b.product.source_url);
    })[0];
    const product = mergeProduct(
      keeperBundle.product,
      group.map((bundle) => bundle.product)
    );
    const statuses = new Set(product.import_status.split(";").filter(Boolean));
    if (manualReviewRoots.has(dsu.find(product.normalized_name))) statuses.add("NEED_DUPLICATE_REVIEW");
    product.import_status = Array.from(statuses).join(";");
    products.push(product);

    activeIngredients.push(...group.flatMap((bundle) => bundle.activeIngredients));
    productActiveIngredients.push(
      ...group
        .flatMap((bundle) => bundle.productActiveIngredients)
        .map((row) => ({
          ...row,
          product_normalized_name: product.normalized_name,
          product_trade_name: product.trade_name,
        }))
    );
    usageRules.push(
      ...group
        .flatMap((bundle) => bundle.usageRules)
        .map((row) => ({
          ...row,
          product_normalized_name: product.normalized_name,
          product_trade_name: product.trade_name,
        }))
    );
    usageWarnings.push(...group.flatMap((bundle) => bundle.usageWarnings));
    blocked.push(...group.flatMap((bundle) => bundle.blocked));
  }

  products.sort((a, b) => a.pesticide_type.localeCompare(b.pesticide_type) || a.trade_name.localeCompare(b.trade_name, "ru"));

  const uniqueActiveIngredients = uniqueBy(activeIngredients, (row) => row.normalized_name);
  const uniqueProductActiveIngredients = uniqueBy(
    productActiveIngredients,
    (row) => `${row.product_normalized_name}::${row.active_ingredient_normalized_name}`
  );
  const uniqueUsageRules = uniqueBy(
    usageRules,
    (row) =>
      `${row.product_normalized_name}::${row.application_rate}::${row.crop}::${row.target_object}::${row.waiting_period_text}::${row.raw_usage_row_json}`
  );

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

  const decisions = [...allSafeDecisions, ...manualReview];
  const topSuspicious: SuspiciousDuplicate[] = manualReview
    .map((row) => ({ suspicion_score: suspicionScore(row), ...row }))
    .sort((a, b) => b.suspicion_score - a.suspicion_score || Number(b.similarity) - Number(a.similarity))
    .slice(0, 100);

  const productRows = products.map(productForCsv);
  const importReadyRows = importReady.map(productForCsv);
  const blockedRows = blockedProducts.length
    ? blockedProducts.map((product) => ({ reason: "blocked_by_import_status", ...productForCsv(product) }))
    : blocked;

  await writeCsv(path.join(AFTER_DEDUPE_DIR, "products_catalog.csv"), productRows, PRODUCT_HEADERS);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "pesticides_catalog.csv"), productRows, PRODUCT_HEADERS);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "import_ready_products.csv"), importReadyRows, PRODUCT_HEADERS);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "blocked_products.csv"), blockedRows, ["reason", ...PRODUCT_HEADERS]);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "active_ingredients.csv"), uniqueActiveIngredients, [
    "name_ru",
    "name_en",
    "normalized_name",
    "type",
    "chemical_class",
    "source_url",
    "source_name",
    "confidence",
  ]);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "product_active_ingredients.csv"), uniqueProductActiveIngredients, [
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
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "product_usage_rules.csv"), uniqueUsageRules, USAGE_HEADERS);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "safe_duplicates.csv"), allSafeDecisions, [...DEDUPE_HEADERS]);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "need_manual_review.csv"), manualReview, [...DEDUPE_HEADERS]);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "top_100_suspicious_duplicates.csv"), topSuspicious, [
    "suspicion_score",
    ...DEDUPE_HEADERS,
  ]);
  await writeCsv(path.join(AFTER_DEDUPE_DIR, "dedupe_decisions.csv"), decisions, [...DEDUPE_HEADERS]);
  await writeCsv(path.join(OUTPUT_DIR, "dedupe_decisions.csv"), decisions, [...DEDUPE_HEADERS]);

  const productsBeforeAnyDedupe = bundles.length;
  const productsBeforePossibleDedupe = firstByNorm.size;
  const safeFromPossibleCount = safeFromPossible.length;
  const exactSafeCount = exactSafeDecisions.length;
  const safeTotal = allSafeDecisions.length;
  const stats = [
    "# BossAgro catalog stats after safe dedupe",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- products before any dedupe: ${productsBeforeAnyDedupe}`,
    `- products before possible-duplicate dedupe: ${productsBeforePossibleDedupe}`,
    `- products after safe dedupe: ${products.length}`,
    `- SAFE_DUPLICATES total: ${safeTotal}`,
    `- SAFE_DUPLICATES exact normalized: ${exactSafeCount}`,
    `- SAFE_DUPLICATES from possible_duplicates.csv: ${safeFromPossibleCount}`,
    `- NEED_MANUAL_REVIEW: ${manualReview.length}`,
    `- import_ready_products: ${importReady.length}`,
    `- unique active_ingredients: ${uniqueActiveIngredients.length}`,
    `- product_active_ingredients: ${uniqueProductActiveIngredients.length}`,
    `- product_usage_rules: ${uniqueUsageRules.length}`,
    `- blocked_products: ${blockedProducts.length}`,
    "",
    "## Decision rule",
    "",
    "SAFE_DUPLICATE is only used when names are identical after removing case, spaces, dots, commas, and punctuation.",
    "Same active ingredient + concentration + formulation is not enough for automatic merge and remains NEED_MANUAL_REVIEW.",
    "",
    "## TOP-100 suspicious duplicates",
    "",
    firstRowsTable(topSuspicious, [
      "suspicion_score",
      "trade_name_a",
      "trade_name_b",
      "similarity",
      "reason",
      "decision",
      "source_url_a",
      "source_url_b",
    ]),
    "",
    "## Output files",
    "",
    "- after_dedupe/products_catalog.csv",
    "- after_dedupe/pesticides_catalog.csv",
    "- after_dedupe/import_ready_products.csv",
    "- after_dedupe/active_ingredients.csv",
    "- after_dedupe/product_active_ingredients.csv",
    "- after_dedupe/product_usage_rules.csv",
    "- after_dedupe/safe_duplicates.csv",
    "- after_dedupe/need_manual_review.csv",
    "- after_dedupe/top_100_suspicious_duplicates.csv",
    "- after_dedupe/dedupe_decisions.csv",
    "- dedupe_decisions.csv",
  ].join("\n");

  await writeFile(path.join(OUTPUT_DIR, "catalog_stats_after_dedupe.md"), `${stats}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        products_before_any_dedupe: productsBeforeAnyDedupe,
        products_before_possible_dedupe: productsBeforePossibleDedupe,
        products_after_safe_dedupe: products.length,
        safe_duplicates_total: safeTotal,
        safe_duplicates_from_possible: safeFromPossibleCount,
        need_manual_review: manualReview.length,
        import_ready_products: importReady.length,
        active_ingredients: uniqueActiveIngredients.length,
        product_active_ingredients: uniqueProductActiveIngredients.length,
        product_usage_rules: uniqueUsageRules.length,
        outputDir: AFTER_DEDUPE_DIR,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
