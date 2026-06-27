import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type DbRow = { [key: string]: JsonValue | undefined };
type CsvRow = Record<string, string>;

type ProductPlanAction = "EXISTING" | "WOULD_CREATE" | "NEED_REVIEW" | "BLOCKED";
type ReviewType = "DB_SIMILAR" | "DB_EXACT_TYPE_MISMATCH" | "SOURCE_POSSIBLE_DUPLICATE_NON_BLOCKING";

type ProductPlan = {
  input: CsvRow;
  action: ProductPlanAction;
  normalized_name: string;
  matched_product_id: string;
  matched_product_name: string;
  matched_product_type: string;
  matched_reason: string;
  review_type: ReviewType | "";
  review_candidates_json: string;
  mapped_product_payload_json: string;
  blocked_reason: string;
};

const INPUT_DIR = path.join(process.cwd(), "data", "import", "global_fertilizers_additives_2026");
const INPUT_IMPORT_READY = path.join(INPUT_DIR, "import_ready_products.csv");
const INPUT_POSSIBLE_DUPLICATES = path.join(INPUT_DIR, "possible_duplicates.csv");
const INPUT_EXACT_DUPLICATES = path.join(INPUT_DIR, "exact_duplicates.csv");
const DRY_RUN_DIR = path.join(INPUT_DIR, "global_import_dry_run");

const PRODUCT_HEADERS = [
  "trade_name",
  "normalized_name",
  "product_type",
  "category",
  "fertilizer_type",
  "additive_type",
  "composition_text",
  "formulation",
  "application_method",
  "application_rate",
  "storage_unit",
  "default_rate_unit",
  "manufacturer",
  "source_name",
  "source_url",
  "confidence",
  "action",
  "matched_product_id",
  "matched_product_name",
  "matched_product_type",
  "matched_reason",
  "review_type",
  "review_candidates_json",
  "mapped_product_payload_json",
  "blocked_reason",
];

const BLOCKED_HEADERS = [
  "source_file",
  "trade_name",
  "normalized_name",
  "product_type",
  "category",
  "source_name",
  "decision",
  "blocked_reason",
];

const REVIEW_HEADERS = [
  "review_type",
  "trade_name",
  "normalized_name",
  "product_type",
  "category",
  "source_name",
  "matched_product_id",
  "matched_product_name",
  "matched_product_type",
  "matched_reason",
  "review_candidates_json",
  "blocking",
];

function loadEnv(projectRoot: string) {
  for (const fileName of [".env", ".env.local"]) {
    let text = "";
    try {
      text = readFileSync(path.join(projectRoot, fileName), "utf8");
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
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function readCsv(filePath: string) {
  try {
    return parseCsv(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return [];
  }
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath: string, rows: Record<string, unknown>[], headers: string[]) {
  const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  writeFileSync(filePath, `\uFEFF${body}\n`, "utf8");
}

function writeUtf8Bom(filePath: string, text: string) {
  writeFileSync(filePath, `\uFEFF${text}\n`, "utf8");
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
    .replace(/\bph\b/giu, "рн")
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

function dbId(row: DbRow) {
  return asString(row.id);
}

function displayName(row: DbRow) {
  return (
    asString(row.trade_name) ||
    asString(row.name) ||
    asString(row.name_ru) ||
    asString(row.name_en) ||
    asString(row.normalized_name) ||
    dbId(row)
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

function classifyExistingProduct(row: DbRow) {
  const raw = [
    asString(row.product_type),
    asString(row.category),
    asString(row.subcategory),
    asString(row.type),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(additive|adjuvant|sticker|surfactant|conditioner|ph|рн|anti|foam|salt)/i.test(raw)) return "additive";
  if (/fertilizer|micro|macro|foliar|npk|organic|biostimulant/i.test(raw)) return "fertilizer";
  if (/pesticide|herbicide|fungicide|insecticide|desiccant/i.test(raw)) return "pesticide";
  return asString(row.product_type) || asString(row.type) || asString(row.category) || "unknown";
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

function getColumns(rows: DbRow[]) {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return columns;
}

function assignIfExists(payload: Record<string, JsonValue>, columns: Set<string>, column: string, value: JsonValue) {
  if (columns.has(column)) payload[column] = value;
}

function sourceNotes(input: CsvRow) {
  const nutrientNotes = [
    ["N", input.N],
    ["P", input.P],
    ["K", input.K],
    ["S", input.S],
    ["Ca", input.Ca],
    ["Mg", input.Mg],
    ["B", input.B],
    ["Zn", input.Zn],
    ["Mn", input.Mn],
    ["Cu", input.Cu],
    ["Fe", input.Fe],
    ["Mo", input.Mo],
  ]
    .filter(([, value]) => value && value !== "unknown")
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");

  return [
    `source=${input.source_name || "unknown"}`,
    "source_type=reference_catalog",
    `confidence=${input.confidence || "medium"}`,
    `product_type=${input.product_type || "unknown"}`,
    `category=${input.category || "unknown"}`,
    `fertilizer_type=${input.fertilizer_type || ""}`,
    `additive_type=${input.additive_type || ""}`,
    `composition_text=${input.composition_text || "unknown"}`,
    `nutrients=${nutrientNotes || "unknown"}`,
    `formulation=${input.formulation || "unknown"}`,
    `application_method=${input.application_method || "unknown"}`,
    `application_rate=${input.application_rate || "unknown"}`,
    `default_rate_unit=${input.default_rate_unit || "unknown"}`,
    `source_url=${input.source_url || "unknown"}`,
  ]
    .filter((line) => !line.endsWith("="))
    .join("\n");
}

function mappedPayload(input: CsvRow, productColumns: Set<string>) {
  const payload: Record<string, JsonValue> = {};
  const notes = sourceNotes(input);
  const productType = input.product_type || input.category || "unknown";
  const unit = input.storage_unit || input.issue_unit || "unknown";
  const fertilizerTypeForLegacy = input.fertilizer_type === "micro" ? "micronutrient" : input.fertilizer_type || "unknown";

  assignIfExists(payload, productColumns, "company_id", null);
  assignIfExists(payload, productColumns, "name", input.trade_name);
  assignIfExists(payload, productColumns, "trade_name", input.trade_name);
  assignIfExists(payload, productColumns, "name_ru", input.trade_name);
  assignIfExists(payload, productColumns, "normalized_name", input.normalized_name);
  assignIfExists(payload, productColumns, "product_type", productType);
  assignIfExists(payload, productColumns, "type", productType);
  assignIfExists(payload, productColumns, "category", input.category || productType);
  assignIfExists(payload, productColumns, "subcategory", input.additive_type || input.fertilizer_type || "unknown");
  assignIfExists(payload, productColumns, "fertilizer_type", fertilizerTypeForLegacy);
  assignIfExists(payload, productColumns, "unit", unit);
  assignIfExists(payload, productColumns, "base_uom", unit);
  assignIfExists(payload, productColumns, "default_unit", unit);
  assignIfExists(payload, productColumns, "application_unit", input.default_rate_unit || "unknown");
  assignIfExists(payload, productColumns, "composition", input.composition_text || "unknown");
  assignIfExists(payload, productColumns, "formulation", input.formulation || "unknown");
  assignIfExists(payload, productColumns, "application_method", input.application_method || "unknown");
  assignIfExists(payload, productColumns, "manufacturer", input.manufacturer || input.source_name || "unknown");
  assignIfExists(payload, productColumns, "source_url", input.source_url || "");
  assignIfExists(payload, productColumns, "source_name", input.source_name || "unknown");
  assignIfExists(payload, productColumns, "source_type", "reference_catalog");
  assignIfExists(payload, productColumns, "confidence", input.confidence || "medium");
  assignIfExists(payload, productColumns, "notes", notes);
  assignIfExists(payload, productColumns, "description", input.composition_text && input.composition_text !== "unknown" ? input.composition_text : notes);
  assignIfExists(payload, productColumns, "is_active", true);
  assignIfExists(payload, productColumns, "archived", false);
  assignIfExists(payload, productColumns, "active_ingredient", "not_applicable");
  return payload;
}

function findExisting(input: CsvRow, globalProducts: DbRow[]) {
  const inputKey = normalizedKey(input.normalized_name || input.trade_name);
  const inputStrict = strictKey(input.normalized_name || input.trade_name);
  const inputType = input.product_type || input.category || "unknown";

  const exactMatches = globalProducts.filter((product) =>
    productSearchNames(product).some((name) => normalizedKey(name) === inputKey)
  );
  const compatibleExact = exactMatches.find((product) => {
    const dbType = classifyExistingProduct(product);
    return dbType === inputType || (inputType === "additive" && dbType === "adjuvant");
  });
  if (compatibleExact) {
    return {
      action: "EXISTING" as ProductPlanAction,
      matched: compatibleExact,
      reason: "exact normalized match with compatible type",
      reviewType: "" as ReviewType | "",
      candidates: [],
    };
  }
  if (exactMatches.length > 0) {
    return {
      action: "NEED_REVIEW" as ProductPlanAction,
      matched: exactMatches[0],
      reason: "exact normalized name exists, but product_type/category differs",
      reviewType: "DB_EXACT_TYPE_MISMATCH" as ReviewType,
      candidates: exactMatches.map((product) => ({ product, score: 1, reason: "exact name, type mismatch" })),
    };
  }

  const candidates = globalProducts
    .map((product) => {
      const dbType = classifyExistingProduct(product);
      const scores = productSearchNames(product).map((name) => {
        const nameKey = normalizedKey(name);
        const nameStrict = strictKey(name);
        const score = Math.max(
          similarity(inputKey, nameKey),
          inputStrict && nameStrict && inputStrict === nameStrict ? 0.98 : 0
        );
        return { name, score, reason: inputStrict && nameStrict && inputStrict === nameStrict ? "strict key match" : "similar normalized name" };
      });
      const best = scores.sort((a, b) => b.score - a.score)[0];
      return {
        product,
        dbType,
        score: best?.score ?? 0,
        reason: best?.reason ?? "similar normalized name",
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
      reviewType: "DB_SIMILAR" as ReviewType,
      candidates,
    };
  }

  return {
    action: "WOULD_CREATE" as ProductPlanAction,
    matched: null,
    reason: "no exact or similar global product found",
    reviewType: "" as ReviewType | "",
    candidates: [],
  };
}

function planOutput(plan: ProductPlan) {
  return {
    trade_name: plan.input.trade_name,
    normalized_name: plan.input.normalized_name,
    product_type: plan.input.product_type,
    category: plan.input.category,
    fertilizer_type: plan.input.fertilizer_type,
    additive_type: plan.input.additive_type,
    composition_text: plan.input.composition_text,
    formulation: plan.input.formulation,
    application_method: plan.input.application_method,
    application_rate: plan.input.application_rate,
    storage_unit: plan.input.storage_unit,
    default_rate_unit: plan.input.default_rate_unit,
    manufacturer: plan.input.manufacturer,
    source_name: plan.input.source_name,
    source_url: plan.input.source_url,
    confidence: plan.input.confidence,
    action: plan.action,
    matched_product_id: plan.matched_product_id,
    matched_product_name: plan.matched_product_name,
    matched_product_type: plan.matched_product_type,
    matched_reason: plan.matched_reason,
    review_type: plan.review_type,
    review_candidates_json: plan.review_candidates_json,
    mapped_product_payload_json: plan.mapped_product_payload_json,
    blocked_reason: plan.blocked_reason,
  };
}

function markdownTable(rows: Record<string, unknown>[], headers: string[], limit = 30) {
  return [
    headers.join(" | "),
    headers.map(() => "---").join(" | "),
    ...rows.slice(0, limit).map((row) => headers.map((header) => String(row[header] ?? "").replace(/\|/g, "\\|")).join(" | ")),
  ].join("\n");
}

function mappingReport(productColumns: Set<string>) {
  const has = (column: string) => productColumns.has(column);
  const mappingRows = [
    ["Input field", "Preferred products column(s)", "Status", "Fallback"],
    ["trade_name", "trade_name, name, name_ru", has("trade_name") || has("name") || has("name_ru") ? "mapped" : "missing", "blocked before apply"],
    ["normalized_name", "normalized_name", has("normalized_name") ? "mapped" : "missing", "use generated normalized_name only in notes"],
    ["product_type", "product_type", has("product_type") ? "mapped" : "missing", "notes"],
    ["category", "category", has("category") ? "mapped" : "missing", "notes"],
    ["fertilizer_type/additive_type", "fertilizer_type, subcategory", has("fertilizer_type") || has("subcategory") ? "partial" : "missing", "notes"],
    ["storage_unit", "unit, base_uom, default_unit", has("unit") || has("base_uom") || has("default_unit") ? "mapped" : "missing", "notes"],
    ["default_rate_unit", "application_unit", has("application_unit") ? "mapped" : "missing", "notes"],
    ["NPK/microelements", "dedicated columns absent", "notes", "notes"],
    ["composition_text", "composition, description, notes", has("composition") || has("description") || has("notes") ? "mapped" : "missing", "notes"],
    ["application_method", "application_method", has("application_method") ? "mapped" : "missing", "notes"],
    ["application_rate", "application_rate numeric only if parseable", has("application_rate") ? "manual_review" : "missing", "notes"],
    ["manufacturer", "manufacturer", has("manufacturer") ? "mapped" : "missing", "notes"],
    ["source_name/source_type/confidence", "source_name, source_type, confidence", ["source_name", "source_type", "confidence"].some(has) ? "partial" : "missing", "notes"],
    ["source_url", "source_url", has("source_url") ? "mapped" : "missing", "notes"],
  ];

  const notMapped = mappingRows
    .slice(1)
    .filter((row) => row[2] === "missing" || row[2] === "manual_review")
    .map((row) => `- ${row[0]} -> ${row[3]}`)
    .join("\n");

  return [
    "# Global fertilizers/additives products field mapping report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Current products columns observed",
    "",
    Array.from(productColumns).sort().join(", "),
    "",
    "## Mapping",
    "",
    mappingRows.map((row) => row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")).join("\n"),
    "",
    "## Fields with no direct safe column",
    "",
    notMapped || "- none",
    "",
    "## Apply risks to check later",
    "",
    "- Legacy `type` constraints may not accept `additive`; this dry-run maps the requested product_type/category correctly, but apply must validate DB constraints first.",
    "- `application_rate` is textual in source catalog; it is kept in notes unless a clean numeric/unit split is introduced.",
    "- NPK and microelements have no guaranteed dedicated product columns; they are kept in notes/composition.",
  ].join("\n");
}

async function main() {
  loadEnv(process.cwd());
  mkdirSync(DRY_RUN_DIR, { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase read credentials in .env/.env.local.");

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const importReadyRows = readCsv(INPUT_IMPORT_READY);
  const sourcePossibleDuplicates = readCsv(INPUT_POSSIBLE_DUPLICATES);
  const sourceExactDuplicates = readCsv(INPUT_EXACT_DUPLICATES);
  const productsRead = await fetchAll(supabase, "products");
  if (productsRead.error) throw new Error(`Failed to read products: ${productsRead.error}`);

  const productColumns = getColumns(productsRead.rows);
  const globalProducts = productsRead.rows.filter((row) =>
    Object.prototype.hasOwnProperty.call(row, "company_id") ? row.company_id === null : true
  );

  const internalGroups = new Map<string, CsvRow[]>();
  for (const row of importReadyRows) {
    const key = row.normalized_name || normalizedKey(row.trade_name);
    internalGroups.set(key, [...(internalGroups.get(key) ?? []), row]);
  }
  const internalDuplicateRows = Array.from(internalGroups.entries())
    .filter(([, group]) => group.length > 1)
    .flatMap(([key, group]) => group.map((row, index) => ({ key, row, index })));

  const plans: ProductPlan[] = importReadyRows.map((row) => {
    const normalized = normalizedKey(row.normalized_name || row.trade_name);
    const blockedReasons: string[] = [];
    const duplicateGroup = internalGroups.get(row.normalized_name || normalizedKey(row.trade_name)) ?? [];
    if (!row.trade_name) blockedReasons.push("missing trade_name");
    if (!row.normalized_name) blockedReasons.push("missing normalized_name");
    if (!row.product_type || !["fertilizer", "additive"].includes(row.product_type)) blockedReasons.push("invalid product_type");
    if (!row.category || !["fertilizer", "additive"].includes(row.category)) blockedReasons.push("invalid category");
    if (row.storage_unit === "unknown" || row.default_rate_unit === "unknown") blockedReasons.push("unknown unit");
    if (row.import_status !== "IMPORT_READY") blockedReasons.push(`not import-ready: ${row.import_status}`);
    if (duplicateGroup.length > 1 && duplicateGroup[0] !== row) blockedReasons.push("internal exact duplicate in import_ready");

    if (blockedReasons.length > 0) {
      return {
        input: row,
        action: "BLOCKED",
        normalized_name: normalized,
        matched_product_id: "",
        matched_product_name: "",
        matched_product_type: "",
        matched_reason: "",
        review_type: "",
        review_candidates_json: "[]",
        mapped_product_payload_json: "",
        blocked_reason: blockedReasons.join("; "),
      };
    }

    const match = findExisting(row, globalProducts);
    const matched = match.matched;
    const candidatesJson = JSON.stringify(
      match.candidates.map((candidate) => ({
        id: dbId(candidate.product),
        name: displayName(candidate.product),
        product_type: classifyExistingProduct(candidate.product),
        score: Number(candidate.score.toFixed(3)),
        reason: candidate.reason,
      }))
    );
    return {
      input: row,
      action: match.action,
      normalized_name: normalized,
      matched_product_id: matched ? dbId(matched) : "",
      matched_product_name: matched ? displayName(matched) : "",
      matched_product_type: matched ? classifyExistingProduct(matched) : "",
      matched_reason: match.reason,
      review_type: match.reviewType,
      review_candidates_json: candidatesJson,
      mapped_product_payload_json: JSON.stringify(mappedPayload(row, productColumns)),
      blocked_reason: "",
    };
  });

  const sourceReviewRows = sourcePossibleDuplicates.flatMap((row) => [
    {
      review_type: "SOURCE_POSSIBLE_DUPLICATE_NON_BLOCKING",
      trade_name: row.product_a,
      normalized_name: normalizedKey(row.product_a),
      product_type: "",
      category: "",
      source_name: row.source_a,
      matched_product_id: "",
      matched_product_name: row.product_b,
      matched_product_type: "",
      matched_reason: `${row.reason}; confidence=${row.confidence}; similarity=${row.similarity}`,
      review_candidates_json: JSON.stringify([{ name: row.product_b, source_name: row.source_b, similarity: row.similarity }]),
      blocking: "no",
    },
  ]);

  const existing = plans.filter((plan) => plan.action === "EXISTING").map(planOutput);
  const wouldCreate = plans.filter((plan) => plan.action === "WOULD_CREATE").map(planOutput);
  const needReview = [
    ...plans
      .filter((plan) => plan.action === "NEED_REVIEW")
      .map((plan) => ({
        review_type: plan.review_type,
        trade_name: plan.input.trade_name,
        normalized_name: plan.input.normalized_name,
        product_type: plan.input.product_type,
        category: plan.input.category,
        source_name: plan.input.source_name,
        matched_product_id: plan.matched_product_id,
        matched_product_name: plan.matched_product_name,
        matched_product_type: plan.matched_product_type,
        matched_reason: plan.matched_reason,
        review_candidates_json: plan.review_candidates_json,
        blocking: "yes",
      })),
    ...sourceReviewRows,
  ];
  const blockedRows = [
    ...plans
      .filter((plan) => plan.action === "BLOCKED")
      .map((plan) => ({
        source_file: "import_ready_products.csv",
        trade_name: plan.input.trade_name,
        normalized_name: plan.input.normalized_name,
        product_type: plan.input.product_type,
        category: plan.input.category,
        source_name: plan.input.source_name,
        decision: "BLOCKED",
        blocked_reason: plan.blocked_reason,
      })),
    ...sourceExactDuplicates
      .filter((row) => row.decision === "SKIP_EXACT_DUPLICATE")
      .map((row) => ({
        source_file: "exact_duplicates.csv",
        trade_name: row.trade_name,
        normalized_name: row.duplicate_key,
        product_type: "",
        category: "",
        source_name: row.source_name,
        decision: "SKIP_EXACT_DUPLICATE",
        blocked_reason: "Excluded before import_ready: exact normalized_name duplicate.",
      })),
  ];

  writeCsv(path.join(DRY_RUN_DIR, "products_existing.csv"), existing, PRODUCT_HEADERS);
  writeCsv(path.join(DRY_RUN_DIR, "products_would_create.csv"), wouldCreate, PRODUCT_HEADERS);
  writeCsv(path.join(DRY_RUN_DIR, "products_need_review.csv"), needReview, REVIEW_HEADERS);
  writeCsv(path.join(DRY_RUN_DIR, "blocked_rows.csv"), blockedRows, BLOCKED_HEADERS);
  writeUtf8Bom(path.join(DRY_RUN_DIR, "field_mapping_report.md"), mappingReport(productColumns));

  const unmappedFields = [
    !productColumns.has("normalized_name") ? "normalized_name" : "",
    !productColumns.has("product_type") ? "product_type" : "",
    !productColumns.has("category") ? "category" : "",
    !productColumns.has("application_unit") ? "default_rate_unit/application_unit" : "",
    "NPK/microelements dedicated columns",
    "application_rate text",
  ].filter(Boolean);

  const summary = [
    "# Global fertilizers/additives import dry-run",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Scope",
    "",
    "- Input: `data/import/global_fertilizers_additives_2026/import_ready_products.csv`.",
    "- Read-only Supabase check against global `products` where `company_id is null`.",
    "- No insert/update/delete, no SQL/apply, no company/warehouse/ledger/batches/operations changes.",
    "- Pesticide import scope is not used here.",
    "",
    "## Counts",
    "",
    `- input import_ready rows: ${importReadyRows.length}`,
    `- global DB products read: ${globalProducts.length}`,
    `- existing exact compatible: ${existing.length}`,
    `- would_create: ${wouldCreate.length}`,
    `- need_review blocking: ${plans.filter((plan) => plan.action === "NEED_REVIEW").length}`,
    `- source possible duplicates review, non-blocking: ${sourceReviewRows.length}`,
    `- blocked from import_ready: ${plans.filter((plan) => plan.action === "BLOCKED").length}`,
    `- exact duplicates excluded before import_ready: ${blockedRows.filter((row) => row.source_file === "exact_duplicates.csv").length}`,
    `- internal exact duplicates inside import_ready: ${internalDuplicateRows.length}`,
    "",
    "## Fields with no direct safe mapping",
    "",
    ...unmappedFields.map((field) => `- ${field}`),
    "",
    "## First 30 WOULD_CREATE",
    "",
    markdownTable(wouldCreate, ["trade_name", "product_type", "category", "storage_unit", "default_rate_unit", "source_name"], 30),
    "",
    "## Notes",
    "",
    "- The 2 rows from `possible_duplicates.csv` are listed in `products_need_review.csv` as non-blocking source review pairs.",
    "- `exact_duplicates.csv` rows with `SKIP_EXACT_DUPLICATE` are listed in `blocked_rows.csv` and are not part of WOULD_CREATE.",
    "- Legacy DB constraints around `type`/`product_type` must be checked before a future apply, especially for `additive`.",
  ].join("\n");
  writeUtf8Bom(path.join(DRY_RUN_DIR, "dry_run_summary.md"), summary);

  console.log(
    JSON.stringify(
      {
        input_import_ready: importReadyRows.length,
        existing: existing.length,
        would_create: wouldCreate.length,
        need_review_blocking: plans.filter((plan) => plan.action === "NEED_REVIEW").length,
        source_review_non_blocking: sourceReviewRows.length,
        blocked_from_import_ready: plans.filter((plan) => plan.action === "BLOCKED").length,
        exact_duplicates_excluded: blockedRows.filter((row) => row.source_file === "exact_duplicates.csv").length,
        output_dir: DRY_RUN_DIR,
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
