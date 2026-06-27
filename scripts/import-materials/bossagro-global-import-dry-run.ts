import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OUTPUT_DIR, csvEscape, writeCsv } from "./bossagro-lib";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type DbRow = { [key: string]: JsonValue | undefined };
type CsvRow = Record<string, string>;

type ProductPlanAction = "EXISTING" | "WOULD_CREATE" | "NEED_REVIEW" | "BLOCKED";
type ActiveIngredientAction = "EXISTING" | "WOULD_CREATE";

type ProductPlan = {
  input: CsvRow;
  action: ProductPlanAction;
  normalized_name: string;
  matched_product_id: string;
  matched_product_name: string;
  matched_reason: string;
  review_candidates_json: string;
  mapped_product_payload_json: string;
  blocked_reason: string;
};

const INPUT_IMPORT_READY = path.join(OUTPUT_DIR, "after_dedupe", "import_ready_products.csv");
const INPUT_PRODUCTS_CATALOG = path.join(OUTPUT_DIR, "after_dedupe", "products_catalog.csv");
const INPUT_ACTIVE_INGREDIENTS = path.join(OUTPUT_DIR, "active_ingredients.csv");
const INPUT_PRODUCT_ACTIVE_INGREDIENTS = path.join(OUTPUT_DIR, "product_active_ingredients.csv");
const INPUT_USAGE_RULES = path.join(OUTPUT_DIR, "product_usage_rules.csv");
const DRY_RUN_DIR = path.join(OUTPUT_DIR, "global_import_dry_run");

const PRODUCT_OUTPUT_HEADERS = [
  "trade_name",
  "normalized_name",
  "pesticide_type",
  "formulation",
  "active_ingredients",
  "concentration_text",
  "storage_unit",
  "source_url",
  "action",
  "matched_product_id",
  "matched_product_name",
  "matched_reason",
  "review_candidates_json",
  "mapped_product_payload_json",
  "blocked_reason",
];

const ACTIVE_INGREDIENT_HEADERS = [
  "name_ru",
  "normalized_name",
  "chemical_class",
  "source_url",
  "action",
  "matched_active_ingredient_id",
  "matched_active_ingredient_name",
];

function loadEnv(projectRoot: string) {
  for (const fileName of [".env", ".env.local"]) {
    const envPath = path.join(projectRoot, fileName);
    let text = "";
    try {
      text = readFileSync(envPath, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers, ...body] = rows.filter((item) => item.some((cellValue) => cellValue.length > 0));
  if (!headers) return [];
  return body.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}

function readCsvFile(filePath: string) {
  return parseCsv(readFileSync(filePath, "utf8"));
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[“”„"«»'`]/g, "")
    .replace(/\bк\.?\s*с\.?\b/giu, "кс")
    .replace(/\bв\.?\s*р\.?\b/giu, "вр")
    .replace(/\bв\.?\s*д\.?\s*г\.?\b/giu, "вдг")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(value: string | null | undefined) {
  return normalizeName(value)
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function strictKey(value: string | null | undefined) {
  return normalizedKey(value).replace(/[^a-zа-я0-9%]+/giu, "");
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length] ?? 0;
}

function similarity(left: string, right: string) {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
}

function asString(value: JsonValue | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function productId(row: DbRow) {
  return asString(row.id);
}

function displayName(row: DbRow) {
  return (
    asString(row.trade_name) ||
    asString(row.name) ||
    asString(row.name_ru) ||
    asString(row.name_en) ||
    asString(row.normalized_name) ||
    productId(row)
  );
}

function productSearchNames(row: DbRow) {
  return [
    asString(row.normalized_name),
    asString(row.trade_name),
    asString(row.name),
    asString(row.name_ru),
    asString(row.name_en),
  ].filter(Boolean);
}

function activeIngredientSearchNames(row: DbRow) {
  return [asString(row.normalized_name), asString(row.name_ru), asString(row.name), asString(row.name_en)].filter(Boolean);
}

async function fetchAll(supabase: SupabaseClient, table: string): Promise<{ rows: DbRow[]; error: string | null }> {
  const pageSize = 1000;
  const rows: DbRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) return { rows, error: error.message };
    const page = (data ?? []) as DbRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows, error: null };
}

async function tableExists(supabase: SupabaseClient, table: string) {
  const { error, count } = await supabase.from(table).select("*", { count: "exact", head: true });
  return { exists: !error, error: error?.message ?? "", count: count ?? null };
}

function existingProductMatch(input: CsvRow, globalProducts: DbRow[]) {
  const inputKey = normalizedKey(input.normalized_name || input.trade_name);
  const exact = globalProducts.find((product) => productSearchNames(product).some((name) => normalizedKey(name) === inputKey));
  if (exact) {
    return {
      action: "EXISTING" as ProductPlanAction,
      matched: exact,
      reason: "exact normalized match",
      candidates: [],
    };
  }

  const inputStrict = strictKey(input.trade_name || input.normalized_name);
  const candidates = globalProducts
    .map((product) => {
      const names = productSearchNames(product);
      const scores = names.map((name) => {
        const nameKey = normalizedKey(name);
        const nameStrict = strictKey(name);
        const score = Math.max(
          similarity(inputKey, nameKey),
          inputStrict && nameStrict && inputStrict === nameStrict ? 0.98 : 0
        );
        return { name, score, nameKey, nameStrict };
      });
      const best = scores.sort((a, b) => b.score - a.score)[0];
      return {
        product,
        score: best?.score ?? 0,
        name: best?.name ?? displayName(product),
        reason:
          best?.nameStrict && inputStrict === best.nameStrict
            ? "strict key match after punctuation/formulation cleanup"
            : "similar normalized name",
      };
    })
    .filter((candidate) => candidate.score >= 0.9)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (candidates.length > 0) {
    return {
      action: "NEED_REVIEW" as ProductPlanAction,
      matched: null,
      reason: "similar global product exists",
      candidates,
    };
  }

  return {
    action: "WOULD_CREATE" as ProductPlanAction,
    matched: null,
    reason: "no exact or similar global product found",
    candidates: [],
  };
}

function fieldExists(columns: Set<string>, column: string) {
  return columns.has(column);
}

function assignIfExists(payload: Record<string, JsonValue>, columns: Set<string>, column: string, value: JsonValue) {
  if (fieldExists(columns, column)) payload[column] = value;
}

function buildProductPayload(input: CsvRow, productColumns: Set<string>) {
  const payload: Record<string, JsonValue> = {};
  assignIfExists(payload, productColumns, "company_id", null);
  assignIfExists(payload, productColumns, "name", input.trade_name);
  assignIfExists(payload, productColumns, "trade_name", input.trade_name);
  assignIfExists(payload, productColumns, "name_ru", input.trade_name);
  assignIfExists(payload, productColumns, "normalized_name", input.normalized_name);
  assignIfExists(payload, productColumns, "product_type", "pesticide");
  assignIfExists(payload, productColumns, "type", input.pesticide_type || "pesticide");
  assignIfExists(payload, productColumns, "category", "pesticide");
  assignIfExists(payload, productColumns, "subtype", input.pesticide_type || "unknown");
  assignIfExists(payload, productColumns, "unit", input.storage_unit || input.issue_unit || "unknown");
  assignIfExists(payload, productColumns, "base_uom", input.storage_unit || input.issue_unit || "unknown");
  assignIfExists(payload, productColumns, "formulation", input.formulation || "unknown");
  assignIfExists(payload, productColumns, "active_ingredient", input.active_ingredients || "unknown");
  assignIfExists(payload, productColumns, "active_ingredients", input.active_ingredients || "unknown");
  assignIfExists(payload, productColumns, "source_url", input.source_url);
  assignIfExists(payload, productColumns, "source_name", "BossAgro");
  assignIfExists(payload, productColumns, "source_type", "reference_catalog");
  assignIfExists(payload, productColumns, "confidence", "medium");
  const sourceNote = [
    `BossAgro status: ${input.status_text || "unknown"}`,
    `Allowed in Kazakhstan from source: ${input.allowed_in_kazakhstan_from_source || "unknown"} (source note only, not legal 2026 validation)`,
    `Pesticide type: ${input.pesticide_type || "unknown"}`,
    `AI: ${input.active_ingredients || "unknown"}`,
    `Concentration: ${input.concentration_text || "unknown"}`,
  ].join("; ");
  assignIfExists(payload, productColumns, "description", input.short_description || sourceNote);
  assignIfExists(payload, productColumns, "notes", sourceNote);
  return payload;
}

function planToOutput(plan: ProductPlan) {
  return {
    trade_name: plan.input.trade_name,
    normalized_name: plan.normalized_name,
    pesticide_type: plan.input.pesticide_type,
    formulation: plan.input.formulation,
    active_ingredients: plan.input.active_ingredients,
    concentration_text: plan.input.concentration_text,
    storage_unit: plan.input.storage_unit,
    source_url: plan.input.source_url,
    action: plan.action,
    matched_product_id: plan.matched_product_id,
    matched_product_name: plan.matched_product_name,
    matched_reason: plan.matched_reason,
    review_candidates_json: plan.review_candidates_json,
    mapped_product_payload_json: plan.mapped_product_payload_json,
    blocked_reason: plan.blocked_reason,
  };
}

function getDbColumns(rows: DbRow[]) {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return columns;
}

function productColumnMappingReport(productColumns: Set<string>, usageTable: { exists: boolean; error: string; count: number | null }) {
  const rows = [
    ["BossAgro field", "Preferred products column(s)", "Status", "Note"],
    ["trade_name", "trade_name, name, name_ru", fieldExists(productColumns, "trade_name") || fieldExists(productColumns, "name") ? "mapped" : "missing", "Primary visible product name."],
    ["normalized_name", "normalized_name", fieldExists(productColumns, "normalized_name") ? "mapped" : "missing", "Used for exact duplicate detection."],
    ["product_type", "product_type", fieldExists(productColumns, "product_type") ? "mapped" : "missing", "Value would be pesticide."],
    ["category", "category", fieldExists(productColumns, "category") ? "mapped" : "missing", "BossAgro category is pesticide."],
    ["pesticide_type", "type, subtype", fieldExists(productColumns, "type") || fieldExists(productColumns, "subtype") ? "mapped" : "missing", "herbicide/fungicide/etc."],
    ["storage_unit / issue_unit", "unit, base_uom", fieldExists(productColumns, "unit") || fieldExists(productColumns, "base_uom") ? "mapped" : "missing", "Russian unit from catalog inference."],
    ["formulation", "formulation", fieldExists(productColumns, "formulation") ? "mapped" : "missing", "Preparative form."],
    ["active_ingredients", "product_active_ingredients link table preferred; legacy active_ingredient only if exists", "links", "Do not duplicate AI text if normalized links are available."],
    ["source_url", "source_url", fieldExists(productColumns, "source_url") ? "mapped" : "missing", "BossAgro card URL."],
    ["source_name/source_type/confidence", "source_name, source_type, confidence", ["source_name", "source_type", "confidence"].some((col) => fieldExists(productColumns, col)) ? "partial" : "missing", "Reference catalog provenance."],
    ["allowed_in_kazakhstan_from_source", "notes/description only", fieldExists(productColumns, "notes") || fieldExists(productColumns, "description") ? "mapped_as_note" : "missing", "Source note only, not legal актуальность 2026."],
    ["usage_rules", "product_usage_rules/pesticide_usage_rules", usageTable.exists ? "table_exists_but_not_imported_in_dry_run" : "no_table", usageTable.exists ? `Existing rows count: ${usageTable.count ?? "unknown"}` : usageTable.error],
  ];
  return [
    "# BossAgro global import field mapping report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Current products columns observed",
    "",
    Array.from(productColumns).sort().join(", "),
    "",
    "## Mapping",
    "",
    rows.map((row) => row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")).join("\n"),
    "",
    "## Important notes",
    "",
    "- `company_id` must be null for global products.",
    "- `allowed_in_kazakhstan_from_source` is only a source/status note from BossAgro, not a legal 2026 permission check.",
    "- Usage rules are not imported in this dry-run.",
    "- Suspicious duplicate products from NEED_MANUAL_REVIEW are not part of this dry-run input.",
  ].join("\n");
}

function markdownTable(rows: Record<string, unknown>[], headers: string[], limit = 30) {
  return [
    headers.join(" | "),
    headers.map(() => "---").join(" | "),
    ...rows.slice(0, limit).map((row) => headers.map((header) => String(row[header] ?? "").replace(/\|/g, "\\|")).join(" | ")),
  ].join("\n");
}

async function main() {
  loadEnv(process.cwd());
  mkdirSync(DRY_RUN_DIR, { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase read credentials in .env/.env.local.");
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const importReadyRows = readCsvFile(INPUT_IMPORT_READY);
  const productsCatalogRows = readCsvFile(INPUT_PRODUCTS_CATALOG);
  const activeIngredientRows = readCsvFile(INPUT_ACTIVE_INGREDIENTS);
  const productAiRows = readCsvFile(INPUT_PRODUCT_ACTIVE_INGREDIENTS);
  const usageRuleRows = readCsvFile(INPUT_USAGE_RULES);

  const [productsRead, activeIngredientsRead, productAiRead] = await Promise.all([
    fetchAll(supabase, "products"),
    fetchAll(supabase, "active_ingredients"),
    fetchAll(supabase, "product_active_ingredients"),
  ]);
  const usageTable = await tableExists(supabase, "product_usage_rules");
  if (productsRead.error) throw new Error(`Failed to read products: ${productsRead.error}`);
  if (activeIngredientsRead.error) throw new Error(`Failed to read active_ingredients: ${activeIngredientsRead.error}`);
  if (productAiRead.error) throw new Error(`Failed to read product_active_ingredients: ${productAiRead.error}`);

  const productColumns = getDbColumns(productsRead.rows);
  const globalProducts = productsRead.rows.filter((row) => Object.prototype.hasOwnProperty.call(row, "company_id") ? row.company_id === null : true);
  const importReadyNames = new Set(importReadyRows.map((row) => row.normalized_name));

  const plans: ProductPlan[] = importReadyRows.map((row) => {
    const normalized = normalizedKey(row.normalized_name || row.trade_name);
    const blockedReasons: string[] = [];
    if (!row.trade_name) blockedReasons.push("missing trade_name");
    if (!row.normalized_name) blockedReasons.push("missing normalized_name");
    if (!row.source_url) blockedReasons.push("missing source_url");
    if (row.import_status.includes("NEED_DUPLICATE_REVIEW")) blockedReasons.push("NEED_DUPLICATE_REVIEW is excluded");
    if (blockedReasons.length > 0) {
      return {
        input: row,
        action: "BLOCKED",
        normalized_name: normalized,
        matched_product_id: "",
        matched_product_name: "",
        matched_reason: "",
        review_candidates_json: "[]",
        mapped_product_payload_json: "",
        blocked_reason: blockedReasons.join("; "),
      };
    }
    const match = existingProductMatch(row, globalProducts);
    const payload = buildProductPayload(row, productColumns);
    return {
      input: row,
      action: match.action,
      normalized_name: normalized,
      matched_product_id: match.matched ? productId(match.matched) : "",
      matched_product_name: match.matched ? displayName(match.matched) : "",
      matched_reason: match.reason,
      review_candidates_json: JSON.stringify(
        match.candidates.map((candidate) => ({
          id: productId(candidate.product),
          name: displayName(candidate.product),
          score: Number(candidate.score.toFixed(3)),
          reason: candidate.reason,
        }))
      ),
      mapped_product_payload_json: JSON.stringify(payload),
      blocked_reason: "",
    };
  });

  const existingPlans = plans.filter((plan) => plan.action === "EXISTING");
  const wouldCreatePlans = plans.filter((plan) => plan.action === "WOULD_CREATE");
  const needReviewPlans = plans.filter((plan) => plan.action === "NEED_REVIEW");
  const blockedPlans = plans.filter((plan) => plan.action === "BLOCKED");

  const planByNorm = new Map(plans.map((plan) => [plan.input.normalized_name, plan]));
  const activeIngredientInputByNorm = new Map(
    productAiRows
      .filter((row) => importReadyNames.has(row.product_normalized_name))
      .map((row) => {
        const source = activeIngredientRows.find((ai) => ai.normalized_name === row.active_ingredient_normalized_name);
        return [
          row.active_ingredient_normalized_name,
          {
            name_ru: row.active_ingredient_name_ru,
            normalized_name: row.active_ingredient_normalized_name,
            chemical_class: source?.chemical_class ?? "unknown",
            source_url: row.source_url,
          },
        ];
      })
  );

  const activeIngredientPlans = Array.from(activeIngredientInputByNorm.values()).map((row) => {
    const normalized = normalizedKey(row.normalized_name || row.name_ru);
    const match = activeIngredientsRead.rows.find((dbRow) =>
      activeIngredientSearchNames(dbRow).some((name) => normalizedKey(name) === normalized)
    );
    return {
      ...row,
      action: (match ? "EXISTING" : "WOULD_CREATE") as ActiveIngredientAction,
      matched_active_ingredient_id: match ? productId(match) : "",
      matched_active_ingredient_name: match ? displayName(match) : "",
    };
  });

  const existingAi = activeIngredientPlans.filter((row) => row.action === "EXISTING");
  const wouldCreateAi = activeIngredientPlans.filter((row) => row.action === "WOULD_CREATE");
  const aiPlanByNorm = new Map(activeIngredientPlans.map((row) => [row.normalized_name, row]));

  const existingProductAiKeys = new Set(
    productAiRead.rows.map((row) => `${asString(row.product_id)}::${asString(row.active_ingredient_id)}`)
  );
  const productAiWouldCreate = productAiRows
    .filter((row) => importReadyNames.has(row.product_normalized_name))
    .map((row) => {
      const productPlan = planByNorm.get(row.product_normalized_name);
      const aiPlan = aiPlanByNorm.get(row.active_ingredient_normalized_name);
      const linkKey =
        productPlan?.matched_product_id && aiPlan?.matched_active_ingredient_id
          ? `${productPlan.matched_product_id}::${aiPlan.matched_active_ingredient_id}`
          : "";
      const canCreate =
        productPlan?.action !== "NEED_REVIEW" &&
        productPlan?.action !== "BLOCKED" &&
        aiPlan &&
        !existingProductAiKeys.has(linkKey);
      return {
        product_trade_name: row.product_trade_name,
        product_normalized_name: row.product_normalized_name,
        product_plan_action: productPlan?.action ?? "BLOCKED",
        existing_product_id: productPlan?.matched_product_id ?? "",
        active_ingredient_name_ru: row.active_ingredient_name_ru,
        active_ingredient_normalized_name: row.active_ingredient_normalized_name,
        active_ingredient_plan_action: aiPlan?.action ?? "WOULD_CREATE",
        existing_active_ingredient_id: aiPlan?.matched_active_ingredient_id ?? "",
        concentration_text: row.concentration_text,
        concentration_part: row.concentration_part,
        would_create_link: canCreate ? "yes" : "no",
        reason: canCreate
          ? "link would be created after product/active ingredient availability"
          : productPlan?.action === "NEED_REVIEW"
            ? "product requires review"
            : productPlan?.action === "BLOCKED"
              ? "product blocked"
              : existingProductAiKeys.has(linkKey)
                ? "link already exists"
                : "active ingredient/product dependency pending",
        source_url: row.source_url,
      };
    })
    .filter((row) => row.would_create_link === "yes");

  const usageRowsForImportReady = usageRuleRows
    .filter((row) => importReadyNames.has(row.product_normalized_name))
    .map((row) => ({
      ...row,
      not_imported_reason: usageTable.exists ? "dry_run_only_usage_rules_not_applied" : "no_product_usage_rules_table",
    }));

  const specialNames = ["сансэр комби кс", "тиовит джет вдг", "регион супер вр", "реглон супер вр", "ламдекс мск", "ламекс мск", "имидок врк", "имидор врк"];
  const specialChecks = specialNames.map((needle) => {
    const product = productsCatalogRows.find((row) => normalizedKey(row.normalized_name || row.trade_name) === needle);
    const plan = product ? planByNorm.get(product.normalized_name) : undefined;
    return {
      check_name: needle,
      found_in_products_catalog: product ? "yes" : "no",
      trade_name: product?.trade_name ?? "",
      import_status: product?.import_status ?? "",
      included_in_import_ready: product && importReadyNames.has(product.normalized_name) ? "yes" : "no",
      dry_run_action: plan?.action ?? "not_in_import_ready",
      note: product && !importReadyNames.has(product.normalized_name) ? "excluded before dry-run because not import-ready / duplicate review" : "",
    };
  });

  await writeCsv(path.join(DRY_RUN_DIR, "products_existing.csv"), existingPlans.map(planToOutput), PRODUCT_OUTPUT_HEADERS);
  await writeCsv(path.join(DRY_RUN_DIR, "products_would_create.csv"), wouldCreatePlans.map(planToOutput), PRODUCT_OUTPUT_HEADERS);
  await writeCsv(path.join(DRY_RUN_DIR, "products_need_review.csv"), needReviewPlans.map(planToOutput), PRODUCT_OUTPUT_HEADERS);
  await writeCsv(path.join(DRY_RUN_DIR, "blocked_rows.csv"), blockedPlans.map(planToOutput), PRODUCT_OUTPUT_HEADERS);
  await writeCsv(path.join(DRY_RUN_DIR, "active_ingredients_existing.csv"), existingAi, ACTIVE_INGREDIENT_HEADERS);
  await writeCsv(path.join(DRY_RUN_DIR, "active_ingredients_would_create.csv"), wouldCreateAi, ACTIVE_INGREDIENT_HEADERS);
  await writeCsv(path.join(DRY_RUN_DIR, "product_active_ingredients_would_create.csv"), productAiWouldCreate, [
    "product_trade_name",
    "product_normalized_name",
    "product_plan_action",
    "existing_product_id",
    "active_ingredient_name_ru",
    "active_ingredient_normalized_name",
    "active_ingredient_plan_action",
    "existing_active_ingredient_id",
    "concentration_text",
    "concentration_part",
    "would_create_link",
    "reason",
    "source_url",
  ]);
  await writeCsv(path.join(DRY_RUN_DIR, "usage_rules_not_imported_yet.csv"), usageRowsForImportReady, [
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
    "not_imported_reason",
  ]);
  await writeCsv(path.join(DRY_RUN_DIR, "special_checks.csv"), specialChecks, [
    "check_name",
    "found_in_products_catalog",
    "trade_name",
    "import_status",
    "included_in_import_ready",
    "dry_run_action",
    "note",
  ]);

  writeFileSync(
    path.join(DRY_RUN_DIR, "field_mapping_report.md"),
    `${productColumnMappingReport(productColumns, usageTable)}\n`,
    "utf8"
  );

  const unmappedBossAgroFields = [
    !fieldExists(productColumns, "formulation") ? "formulation" : "",
    !fieldExists(productColumns, "source_url") ? "source_url" : "",
    !fieldExists(productColumns, "source_name") ? "source_name" : "",
    !fieldExists(productColumns, "source_type") ? "source_type" : "",
    !fieldExists(productColumns, "confidence") ? "confidence" : "",
    !fieldExists(productColumns, "notes") && !fieldExists(productColumns, "description") ? "allowed_in_kazakhstan_from_source/status note" : "",
    !usageTable.exists ? "usage_rules" : "",
  ].filter(Boolean);

  const summary = [
    "# BossAgro global import dry-run",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Scope",
    "",
    "- Input: after_dedupe/import_ready_products.csv",
    "- Excluded: NEED_MANUAL_REVIEW suspicious duplicates",
    "- DB mode: read-only select checks",
    "- Apply/import: not performed",
    "",
    "## Summary",
    "",
    `- import-ready input products: ${importReadyRows.length}`,
    `- existing global products: ${existingPlans.length}`,
    `- would create global products: ${wouldCreatePlans.length}`,
    `- products need review: ${needReviewPlans.length}`,
    `- blocked rows: ${blockedPlans.length}`,
    `- active ingredients existing: ${existingAi.length}`,
    `- active ingredients would create: ${wouldCreateAi.length}`,
    `- product_active_ingredients links would create: ${productAiWouldCreate.length}`,
    `- usage rules present but not imported: ${usageRowsForImportReady.length}`,
    `- usage rules table exists: ${usageTable.exists ? "yes" : "no"}`,
    `- observed global DB products: ${globalProducts.length}`,
    "",
    "## Products fields with no direct mapping",
    "",
    unmappedBossAgroFields.length ? unmappedBossAgroFields.map((field) => `- ${field}`).join("\n") : "- none",
    "",
    "## Special checks",
    "",
    markdownTable(specialChecks, [
      "check_name",
      "trade_name",
      "included_in_import_ready",
      "dry_run_action",
      "import_status",
      "note",
    ], 20),
    "",
    "## First 30 products_would_create",
    "",
    markdownTable(wouldCreatePlans.map(planToOutput), ["trade_name", "pesticide_type", "active_ingredients", "source_url"], 30),
    "",
    "## First 30 products_need_review",
    "",
    markdownTable(needReviewPlans.map(planToOutput), ["trade_name", "matched_reason", "review_candidates_json", "source_url"], 30),
  ].join("\n");
  writeFileSync(path.join(DRY_RUN_DIR, "dry_run_summary.md"), `${summary}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        input_products: importReadyRows.length,
        existing_global_products: existingPlans.length,
        would_create_global_products: wouldCreatePlans.length,
        products_need_review: needReviewPlans.length,
        blocked_rows: blockedPlans.length,
        active_ingredients_existing: existingAi.length,
        active_ingredients_would_create: wouldCreateAi.length,
        product_active_ingredient_links_would_create: productAiWouldCreate.length,
        usage_rules_not_imported: usageRowsForImportReady.length,
        usage_table_exists: usageTable.exists,
        outputDir: DRY_RUN_DIR,
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
