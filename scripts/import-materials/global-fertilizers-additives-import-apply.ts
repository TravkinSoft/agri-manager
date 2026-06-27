import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type DbRow = { [key: string]: JsonValue | undefined };
type CsvRow = Record<string, string>;
type OutputRow = Record<string, unknown>;

const INPUT_DIR = path.join(process.cwd(), "data", "import", "global_fertilizers_additives_2026");
const DRY_RUN_DIR = path.join(INPUT_DIR, "merged_global_import_dry_run");
const APPLY_DIR = path.join(INPUT_DIR, "global_import_apply");
const PRODUCTS_INPUT = path.join(DRY_RUN_DIR, "products_would_create.csv");
const NEED_REVIEW_INPUT = path.join(DRY_RUN_DIR, "products_need_review.csv");

const CREATED_HEADERS = [
  "product_id",
  "trade_name",
  "normalized_name",
  "product_type",
  "category",
  "type",
  "unit",
  "base_uom",
  "company_id",
  "source_name",
  "inserted_this_run",
  "present_after_apply",
  "notes_has_scope",
];

const SKIPPED_HEADERS = [
  "entity",
  "trade_name",
  "normalized_name",
  "existing_id",
  "reason",
];

const ERROR_HEADERS = [
  "table",
  "input_index",
  "trade_name",
  "normalized_name",
  "error",
  "payload_json",
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

  const [headers, ...body] = rows.filter((item) => item.some((value) => value.length > 0));
  if (!headers) return [];
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function readCsv(filePath: string) {
  return parseCsv(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath: string, rows: OutputRow[], headers: string[]) {
  const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  writeFileSync(filePath, `\uFEFF${body}\n`, "utf8");
}

function writeMd(filePath: string, text: string) {
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
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asString(value: JsonValue | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function rowId(row: DbRow) {
  return asString(row.id);
}

function productNames(row: DbRow) {
  return [
    asString(row.normalized_name),
    asString(row.trade_name),
    asString(row.name),
    asString(row.name_ru),
    asString(row.name_en),
  ].filter(Boolean);
}

async function fetchAll(supabase: SupabaseClient, table: string): Promise<DbRow[]> {
  const pageSize = 1000;
  const rows: DbRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    const page = (data ?? []) as DbRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function observedColumns(rows: DbRow[]) {
  const columns = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
  return columns;
}

function filterPayload(payload: Record<string, JsonValue>, columns: Set<string>) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => columns.has(key))) as Record<string, JsonValue>;
}

function globalProductByNormalized(products: DbRow[], normalized: string) {
  const key = normalizeName(normalized);
  return products.find((row) => {
    if (Object.prototype.hasOwnProperty.call(row, "company_id") && row.company_id !== null) return false;
    return productNames(row).some((name) => normalizeName(name) === key);
  });
}

function productKind(row: DbRow) {
  return [
    asString(row.product_type),
    asString(row.type),
    asString(row.category),
    asString(row.subcategory),
  ]
    .join(" ")
    .toLowerCase();
}

function globalPesticideCount(products: DbRow[]) {
  return products.filter((row) => {
    if (Object.prototype.hasOwnProperty.call(row, "company_id") && row.company_id !== null) return false;
    const productType = asString(row.product_type).toLowerCase();
    if (productType === "adjuvant" || productType === "growth_regulator") return false;
    return /(pesticide|crop_protection|herbicide|fungicide|insecticide|desiccant|seed_treatment)/i.test(productKind(row));
  }).length;
}

function normalizeFertilizerType(input: CsvRow) {
  const raw = String(input.fertilizer_type || "").trim().toLowerCase();
  const composition = `${input.composition_text || ""} ${input.N || ""} ${input.P || ""} ${input.K || ""}`.toLowerCase();
  if (raw === "micro") return "micronutrient";
  if (raw === "foliar") return "foliar";
  if (raw === "organic") return "organic";
  if (raw === "water_soluble" || raw === "macro" || raw === "organomineral") return "npk";
  if (raw === "biostimulant") return "organic";
  if (/\bnitrogen\b|азот|карбамид|селитр|urea|ammonium/i.test(composition)) return "nitrogen";
  if (/\bphosphorus\b|фосфор|map|dap|аммофос/i.test(composition)) return "phosphorus";
  if (/\bpotassium\b|калий|k2o/i.test(composition)) return "potassium";
  return "npk";
}

function notesWithRequiredScope(input: CsvRow, payload: Record<string, JsonValue>) {
  const existingNotes = asString(payload.notes);
  const requiredLines = [
    `source=${input.source_name || "unknown"}`,
    "source_type=reference_catalog",
    `confidence=${input.confidence || "medium"}`,
    "catalog_scope=fertilizers_additives_2026",
  ];
  const optionalLines = [
    `product_type=${input.product_type || "unknown"}`,
    `category=${input.category || "unknown"}`,
    `fertilizer_type=${input.fertilizer_type || ""}`,
    `additive_type=${input.additive_type || ""}`,
    `composition_text=${input.composition_text || "unknown"}`,
    `N=${input.N || ""}`,
    `P=${input.P || ""}`,
    `K=${input.K || ""}`,
    `S=${input.S || ""}`,
    `Ca=${input.Ca || ""}`,
    `Mg=${input.Mg || ""}`,
    `B=${input.B || ""}`,
    `Zn=${input.Zn || ""}`,
    `Mn=${input.Mn || ""}`,
    `Cu=${input.Cu || ""}`,
    `Fe=${input.Fe || ""}`,
    `Mo=${input.Mo || ""}`,
    `amino_acids=${input.amino_acids || ""}`,
    `humic_acids=${input.humic_acids || ""}`,
    `fulvic_acids=${input.fulvic_acids || ""}`,
    `formulation=${input.formulation || "unknown"}`,
    `application_method=${input.application_method || "unknown"}`,
    `application_rate=${input.application_rate || "unknown"}`,
    `default_rate_unit=${input.default_rate_unit || "unknown"}`,
    `storage_unit=${input.storage_unit || "unknown"}`,
    `source_url=${input.source_url || "unknown"}`,
  ].filter((line) => !line.endsWith("="));

  const existingSet = new Set(existingNotes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const mergedLines = [...requiredLines, ...optionalLines, ...Array.from(existingSet)].filter(Boolean);
  return Array.from(new Set(mergedLines)).join("\n");
}

function parsePayload(input: CsvRow, productColumns: Set<string>, globalCatalogUserId: string) {
  const parsed = JSON.parse(input.mapped_product_payload_json || "{}") as Record<string, JsonValue>;
  const sourceProductType = input.product_type || input.category || asString(parsed.product_type) || "unknown";
  const isAdditive = sourceProductType === "additive" || input.category === "additive";
  const productType = isAdditive ? "adjuvant" : "fertilizer";
  const category = isAdditive ? "adjuvant" : "fertilizer";
  const unit = input.storage_unit || asString(parsed.unit) || asString(parsed.base_uom) || "unknown";

  parsed.company_id = null;
  if (globalCatalogUserId) parsed.user_id = globalCatalogUserId;
  parsed.name = input.trade_name || asString(parsed.name);
  parsed.trade_name = input.trade_name || asString(parsed.trade_name);
  parsed.name_ru = input.trade_name || asString(parsed.name_ru);
  parsed.normalized_name = input.normalized_name || normalizeName(input.trade_name);
  parsed.product_type = productType;
  parsed.type = isAdditive ? "pesticide" : "fertilizer";
  parsed.category = category;
  parsed.subcategory = input.additive_type || input.fertilizer_type || asString(parsed.subcategory) || "unknown";
  parsed.fertilizer_type = isAdditive ? null : normalizeFertilizerType(input);
  parsed.unit = unit;
  parsed.base_uom = unit;
  parsed.default_unit = unit;
  parsed.application_unit = input.default_rate_unit || asString(parsed.application_unit) || "unknown";
  parsed.manufacturer = input.manufacturer || input.source_name || asString(parsed.manufacturer) || "unknown";
  parsed.source_name = input.source_name || asString(parsed.source_name) || "unknown";
  parsed.source_type = "reference_catalog";
  parsed.confidence = input.confidence || asString(parsed.confidence) || "medium";
  parsed.notes = notesWithRequiredScope(input, parsed);
  if (!asString(parsed.description) || asString(parsed.description).startsWith("source=")) {
    parsed.description = input.composition_text && input.composition_text !== "unknown" ? input.composition_text : asString(parsed.notes);
  }
  parsed.is_active = true;
  parsed.archived = false;
  return filterPayload(parsed, productColumns);
}

function outputFromProduct(product: DbRow, input: CsvRow, insertedThisRun: boolean): OutputRow {
  const notes = asString(product.notes);
  return {
    product_id: rowId(product),
    trade_name: input.trade_name || asString(product.trade_name) || asString(product.name),
    normalized_name: input.normalized_name || asString(product.normalized_name),
    product_type: asString(product.product_type),
    category: asString(product.category),
    type: asString(product.type),
    unit: asString(product.unit),
    base_uom: asString(product.base_uom),
    company_id: product.company_id === null ? "" : asString(product.company_id),
    source_name: input.source_name || asString(product.source_name),
    inserted_this_run: insertedThisRun ? "yes" : "no",
    present_after_apply: "yes",
    notes_has_scope:
      notes.includes("source_type=reference_catalog") &&
      notes.includes("catalog_scope=fertilizers_additives_2026") &&
      notes.includes("source=") &&
      notes.includes("confidence=")
        ? "yes"
        : "no",
  };
}

function dedupeInputs(rows: CsvRow[]) {
  const seen = new Set<string>();
  const deduped: CsvRow[] = [];
  const duplicateInputs: OutputRow[] = [];
  for (const row of rows) {
    const key = normalizeName(row.normalized_name || row.trade_name);
    if (seen.has(key)) {
      duplicateInputs.push({
        entity: "product_input",
        trade_name: row.trade_name,
        normalized_name: row.normalized_name,
        existing_id: "",
        reason: "duplicate normalized_name inside products_would_create.csv; skipped before apply",
      });
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return { deduped, duplicateInputs };
}

async function main() {
  loadEnv(process.cwd());
  mkdirSync(APPLY_DIR, { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const rawInputs = readCsv(PRODUCTS_INPUT).filter((row) => row.action === "WOULD_CREATE");
  const needReviewRows = readCsv(NEED_REVIEW_INPUT);
  const { deduped: productInputs, duplicateInputs } = dedupeInputs(rawInputs);
  const skippedExisting: OutputRow[] = [...duplicateInputs];
  const errors: OutputRow[] = [];
  const insertedRows: OutputRow[] = [];
  const presentRows: OutputRow[] = [];

  let products = await fetchAll(supabase, "products");
  const productColumns = observedColumns(products);
  productColumns.add("user_id");
  const globalCatalogUserId = asString(products.find((row) => row.company_id === null && asString(row.user_id))?.user_id);
  if (!globalCatalogUserId) {
    throw new Error("Cannot apply import: products.user_id is required, but no existing global catalog user_id was found.");
  }
  const pesticideCountBefore = globalPesticideCount(products);

  console.log(`[apply] products input=${rawInputs.length}, deduped=${productInputs.length}`);

  for (let index = 0; index < productInputs.length; index += 1) {
    const input = productInputs[index];
    const existing = globalProductByNormalized(products, input.normalized_name || input.trade_name);
    if (existing) {
      skippedExisting.push({
        entity: "product",
        trade_name: input.trade_name,
        normalized_name: input.normalized_name,
        existing_id: rowId(existing),
        reason: "global product already exists before insert",
      });
      continue;
    }

    let payload: Record<string, JsonValue>;
    try {
      payload = parsePayload(input, productColumns, globalCatalogUserId);
    } catch (error) {
      errors.push({
        table: "products",
        input_index: index,
        trade_name: input.trade_name,
        normalized_name: input.normalized_name,
        error: error instanceof Error ? error.message : String(error),
        payload_json: input.mapped_product_payload_json,
      });
      continue;
    }

    const { data, error } = await supabase.from("products").insert(payload).select("*").single();
    if (error) {
      errors.push({
        table: "products",
        input_index: index,
        trade_name: input.trade_name,
        normalized_name: input.normalized_name,
        error: error.message,
        payload_json: JSON.stringify(payload),
      });
      continue;
    }

    const created = data as DbRow;
    insertedRows.push(outputFromProduct(created, input, true));
    products.push(created);
    if ((index + 1) % 25 === 0 || index + 1 === productInputs.length) {
      console.log(`[apply] processed ${index + 1}/${productInputs.length}, inserted=${insertedRows.length}, errors=${errors.length}`);
    }
  }

  products = await fetchAll(supabase, "products");
  const pesticideCountAfter = globalPesticideCount(products);
  const insertedByNorm = new Set(insertedRows.map((row) => normalizeName(String(row.normalized_name ?? row.trade_name ?? ""))));

  for (const input of productInputs) {
    const product = globalProductByNormalized(products, input.normalized_name || input.trade_name);
    if (!product) continue;
    presentRows.push(outputFromProduct(product, input, insertedByNorm.has(normalizeName(input.normalized_name || input.trade_name))));
  }

  const needReviewKeys = new Set(needReviewRows.map((row) => normalizeName(row.normalized_name || row.trade_name)));
  const importedNeedReview = presentRows.filter((row) => needReviewKeys.has(normalizeName(String(row.normalized_name ?? row.trade_name ?? ""))));
  const nonNullCompanyRows = presentRows.filter((row) => String(row.company_id ?? "") !== "");
  const missingScopeRows = presentRows.filter((row) => row.notes_has_scope !== "yes");
  const pesticideTouched = pesticideCountBefore !== pesticideCountAfter;

  writeCsv(path.join(APPLY_DIR, "products_created.csv"), presentRows, CREATED_HEADERS);
  writeCsv(path.join(APPLY_DIR, "skipped_existing.csv"), skippedExisting, SKIPPED_HEADERS);
  writeCsv(path.join(APPLY_DIR, "apply_errors.csv"), errors, ERROR_HEADERS);
  writeCsv(path.join(APPLY_DIR, "sample_30_created.csv"), insertedRows.slice(0, 30), CREATED_HEADERS);

  const summary = [
    "# Global fertilizers/additives import apply summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Scope",
    "",
    "- Input: `data/import/global_fertilizers_additives_2026/merged_global_import_dry_run/products_would_create.csv`",
    "- Insert target: global `products` only, `company_id = null`.",
    "- Explicitly skipped: products_need_review.csv, blocked rows, exact duplicates, possible duplicates.",
    "- Not touched: pesticides, active_ingredients, product_active_ingredients, usage_rules, company, warehouses, balances, ledger, batches, operations.",
    "",
    "## Results",
    "",
    `- products input: ${rawInputs.length}`,
    `- products input after internal dedupe: ${productInputs.length}`,
    `- products created/present from apply scope: ${presentRows.length}`,
    `- products inserted this run: ${insertedRows.length}`,
    `- skipped existing: ${skippedExisting.filter((row) => row.entity === "product").length}`,
    `- skipped duplicate inputs: ${duplicateInputs.length}`,
    `- errors: ${errors.length}`,
    "",
    "## Post-check",
    "",
    `- all created/present products company_id null: ${nonNullCompanyRows.length === 0 ? "yes" : "no"}`,
    `- products missing required notes scope: ${missingScopeRows.length}`,
    `- need_review imported: ${importedNeedReview.length === 0 ? "no" : "yes"}`,
    `- global pesticide count before: ${pesticideCountBefore}`,
    `- global pesticide count after: ${pesticideCountAfter}`,
    `- pesticides touched by count: ${pesticideTouched ? "yes" : "no"}`,
    "",
    "## Required notes markers",
    "",
    "- source=<source_name>",
    "- source_type=reference_catalog",
    "- confidence=<confidence>",
    "- catalog_scope=fertilizers_additives_2026",
    "",
    "## Output files",
    "",
    "- products_created.csv",
    "- skipped_existing.csv",
    "- apply_errors.csv",
    "- sample_30_created.csv",
  ].join("\n");
  writeMd(path.join(APPLY_DIR, "apply_summary.md"), summary);

  console.log(
    JSON.stringify(
      {
        products_input: rawInputs.length,
        products_created_present: presentRows.length,
        inserted_this_run: insertedRows.length,
        skipped_existing: skippedExisting.filter((row) => row.entity === "product").length,
        errors: errors.length,
        all_company_id_null: nonNullCompanyRows.length === 0,
        need_review_imported: importedNeedReview.length,
        pesticide_count_before: pesticideCountBefore,
        pesticide_count_after: pesticideCountAfter,
        output_dir: APPLY_DIR,
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
