import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OUTPUT_DIR, writeCsv } from "./bossagro-lib";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type DbRow = { [key: string]: JsonValue | undefined };
type CsvRow = Record<string, string>;
type OutputRow = Record<string, unknown>;

const DRY_RUN_DIR = path.join(OUTPUT_DIR, "global_import_dry_run");
const APPLY_DIR = path.join(OUTPUT_DIR, "global_import_apply");
const PRODUCTS_INPUT = path.join(DRY_RUN_DIR, "products_would_create.csv");
const ACTIVE_INGREDIENTS_INPUT = path.join(DRY_RUN_DIR, "active_ingredients_would_create.csv");
const PRODUCT_AI_INPUT = path.join(DRY_RUN_DIR, "product_active_ingredients_would_create.csv");

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
  const [headers, ...body] = rows.filter((item) => item.some((value) => value.length > 0));
  if (!headers) return [];
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function readCsv(filePath: string) {
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

function slugify(value: string) {
  return normalizedKey(value).replace(/[^a-zа-я0-9%]+/giu, "-").replace(/^-+|-+$/g, "") || "unknown";
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

function activeIngredientNames(row: DbRow) {
  return [asString(row.normalized_name), asString(row.slug), asString(row.name_ru), asString(row.name), asString(row.name_en)].filter(Boolean);
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

async function countTable(supabase: SupabaseClient, table: string) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  return error ? { count: null, error: error.message } : { count: count ?? 0, error: "" };
}

function writeProgress(stage: string, details: Record<string, unknown>) {
  writeFileSync(
    path.join(APPLY_DIR, "apply_progress.json"),
    `${JSON.stringify({ stage, generated_at: new Date().toISOString(), ...details }, null, 2)}\n`,
    "utf8"
  );
}

function observedColumns(rows: DbRow[]) {
  const columns = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
  return columns;
}

function filterPayload(payload: Record<string, JsonValue>, columns: Set<string>) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => columns.has(key))) as Record<string, JsonValue>;
}

function allowedFromNotes(notes: string) {
  const match = notes.match(/Allowed in Kazakhstan from source:\s*([^;]+)/i);
  return match?.[1]?.trim() || "unknown";
}

function bossAgroNotes(row: CsvRow, payload: Record<string, JsonValue>) {
  const existing = asString(payload.notes);
  const allowed = allowedFromNotes(existing);
  return [
    "source=BossAgro",
    "source_type=reference_catalog",
    "confidence=medium",
    `allowed_in_kazakhstan_from_source=${allowed}`,
    "registry_current_status=unknown",
    `bossagro_status=${existing.match(/BossAgro status:\s*([^;]+)/i)?.[1]?.trim() || "unknown"}`,
    `pesticide_type=${row.pesticide_type || "unknown"}`,
    `active_ingredients=${row.active_ingredients || "unknown"}`,
    `concentration_text=${row.concentration_text || "unknown"}`,
    `source_url=${row.source_url}`,
    existing,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizePesticideCategory(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (raw === "insecticide_acaricide") return "insecticide";
  const allowed = new Set([
    "herbicide",
    "fungicide",
    "insecticide",
    "seed_treatment",
    "desiccant",
    "growth_regulator",
    "adjuvant",
    "biological",
    "surfactant",
    "water_conditioner",
    "pH_regulator",
    "drift_reduction_agent",
    "anti_foam",
  ]);
  return allowed.has(raw) ? raw : null;
}

function productPayloadFromDryRun(row: CsvRow, productColumns: Set<string>, userId: string) {
  const parsed = JSON.parse(row.mapped_product_payload_json || "{}") as Record<string, JsonValue>;
  parsed.company_id = null;
  if (productColumns.has("user_id")) parsed.user_id = userId;
  if (productColumns.has("type")) parsed.type = "pesticide";
  if (productColumns.has("product_type")) parsed.product_type = "pesticide";
  if (productColumns.has("category")) parsed.category = "crop_protection";
  if (productColumns.has("subcategory")) parsed.subcategory = row.pesticide_type || asString(parsed.subcategory) || "unknown";
  if (productColumns.has("pesticide_category")) parsed.pesticide_category = normalizePesticideCategory(row.pesticide_type);
  parsed.notes = bossAgroNotes(row, parsed);
  if (productColumns.has("registration_status_kz")) parsed.registration_status_kz = "unknown";
  if (productColumns.has("import_confidence")) parsed.import_confidence = "medium";
  if (productColumns.has("requires_review")) parsed.requires_review = false;
  if (productColumns.has("is_active")) parsed.is_active = true;
  if (productColumns.has("archived")) parsed.archived = false;
  return filterPayload(parsed, productColumns);
}

function activeIngredientPayload(row: CsvRow, columns: Set<string>, userId: string) {
  const payload: Record<string, JsonValue> = {
    user_id: userId,
    name_ru: row.name_ru,
    name_en: "",
    slug: slugify(row.normalized_name || row.name_ru),
    normalized_name: row.normalized_name,
    ingredient_type: "pesticide_ai",
    chemical_class: row.chemical_class || "unknown",
    description: [
      "source=BossAgro",
      "source_type=reference_catalog",
      "confidence=medium",
      `chemical_class=${row.chemical_class || "unknown"}`,
      `source_url=${row.source_url}`,
    ].join("\n"),
    is_active: true,
    archived: false,
  };
  return filterPayload(payload, columns);
}

function productAiPayload(row: CsvRow, productId: string, activeIngredientId: string, columns: Set<string>, sortOrder: number) {
  const payload: Record<string, JsonValue> = {
    product_id: productId,
    active_ingredient_id: activeIngredientId,
    concentration_text: row.concentration_text || row.concentration_part || "",
    concentration_part: row.concentration_part || "",
    source_url: row.source_url || "",
    confidence: "medium",
    sort_order: sortOrder,
  };
  return filterPayload(payload, columns);
}

function productByNormalized(products: DbRow[], normalized: string) {
  const key = normalizedKey(normalized);
  return products.find((row) => row.company_id === null && productNames(row).some((name) => normalizedKey(name) === key));
}

function activeIngredientByNormalized(rows: DbRow[], normalized: string) {
  const key = normalizedKey(normalized);
  return rows.find((row) => activeIngredientNames(row).some((name) => normalizedKey(name) === key));
}

async function insertRows(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, JsonValue>[],
  batchSize: number,
  onCreated: (row: DbRow, inputIndex: number) => void,
  inputOffset = 0,
  label = table
) {
  const errors: OutputRow[] = [];
  const batchCount = Math.ceil(rows.length / batchSize);
  if (!rows.length) {
    console.log(`[apply] ${label}: nothing to insert`);
    return errors;
  }
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const batchNo = Math.floor(index / batchSize) + 1;
    console.log(`[apply] ${label}: inserting batch ${batchNo}/${batchCount} (${batch.length})`);
    const { data, error } = await supabase.from(table).insert(batch).select("*");
    if (!error) {
      ((data ?? []) as DbRow[]).forEach((created, createdIndex) => onCreated(created, inputOffset + index + createdIndex));
      console.log(`[apply] ${label}: batch ${batchNo}/${batchCount} ok`);
      continue;
    }
    console.warn(`[apply] ${label}: batch ${batchNo}/${batchCount} failed, falling back row-by-row: ${error.message}`);
    for (let rowIndex = 0; rowIndex < batch.length; rowIndex += 1) {
      const row = batch[rowIndex];
      if (rowIndex > 0 && rowIndex % 25 === 0) {
        console.log(`[apply] ${label}: fallback batch ${batchNo}/${batchCount}, row ${rowIndex}/${batch.length}`);
      }
      const single = await supabase.from(table).insert(row).select("*").single();
      if (single.error) {
        errors.push({
          table,
          input_index: inputOffset + index + rowIndex,
          error: single.error.message,
          payload_json: JSON.stringify(row),
        });
      } else if (single.data) {
        onCreated(single.data as DbRow, inputOffset + index + rowIndex);
      }
    }
  }
  return errors;
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

  const productInputs = readCsv(PRODUCTS_INPUT).filter((row) => row.action === "WOULD_CREATE");
  const activeIngredientInputs = readCsv(ACTIVE_INGREDIENTS_INPUT).filter((row) => row.action === "WOULD_CREATE");
  const productAiInputs = readCsv(PRODUCT_AI_INPUT).filter((row) => row.would_create_link === "yes");
  const usageCountBefore = await countTable(supabase, "product_usage_rules");
  console.log(
    `[apply] inputs: products=${productInputs.length}, active_ingredients=${activeIngredientInputs.length}, links=${productAiInputs.length}`
  );
  writeProgress("started", {
    products_input: productInputs.length,
    active_ingredients_input: activeIngredientInputs.length,
    product_active_ingredients_input: productAiInputs.length,
  });

  let products = await fetchAll(supabase, "products");
  const productColumns = observedColumns(products);
  const globalCatalogUserId = asString(products.find((row) => row.company_id === null && asString(row.user_id))?.user_id);
  if (productColumns.has("user_id") && !globalCatalogUserId) {
    throw new Error("Cannot apply import: products.user_id is required, but no existing global catalog user_id was found.");
  }
  const productPayloads: Record<string, JsonValue>[] = [];
  const productInputByPendingIndex: CsvRow[] = [];
  const productsCreated: OutputRow[] = [];
  const skippedExisting: OutputRow[] = [];
  const errors: OutputRow[] = [];

  for (const input of productInputs) {
    const existing = productByNormalized(products, input.normalized_name);
    if (existing) {
      skippedExisting.push({
        entity: "product",
        name: input.trade_name,
        normalized_name: input.normalized_name,
        existing_id: rowId(existing),
        reason: "global product already exists before insert",
      });
      continue;
    }
    productInputByPendingIndex.push(input);
    productPayloads.push(productPayloadFromDryRun(input, productColumns, globalCatalogUserId));
  }

  errors.push(
    ...(await insertRows(
      supabase,
      "products",
      productPayloads,
      100,
      (created, inputIndex) => {
        const input = productInputByPendingIndex[inputIndex];
        productsCreated.push({
          product_id: rowId(created),
          trade_name: input?.trade_name ?? "",
          normalized_name: input?.normalized_name ?? asString(created.normalized_name),
          company_id: asString(created.company_id),
          source_url: input?.source_url ?? asString(created.source_url),
        });
      },
      0,
      "products"
    ))
  );
  await writeCsv(path.join(APPLY_DIR, "products_created.csv"), productsCreated, [
    "product_id",
    "trade_name",
    "normalized_name",
    "company_id",
    "source_url",
  ]);
  await writeCsv(path.join(APPLY_DIR, "skipped_existing.csv"), skippedExisting, [
    "entity",
    "name",
    "normalized_name",
    "existing_id",
    "reason",
  ]);
  await writeCsv(path.join(APPLY_DIR, "apply_errors.csv"), errors, [
    "table",
    "input_index",
    "product_trade_name",
    "active_ingredient_name_ru",
    "name",
    "normalized_name",
    "error",
    "payload_json",
  ]);
  writeProgress("products_done", {
    products_created_this_run: productsCreated.length,
    skipped_existing: skippedExisting.length,
    errors: errors.length,
  });

  products = await fetchAll(supabase, "products");
  const createdProductIdByNorm = new Map<string, string>();
  for (const input of productInputs) {
    const row = productByNormalized(products, input.normalized_name);
    if (row) createdProductIdByNorm.set(input.normalized_name, rowId(row));
  }

  let activeIngredients = await fetchAll(supabase, "active_ingredients");
  const activeIngredientColumns = observedColumns(activeIngredients);
  const aiPayloads: Record<string, JsonValue>[] = [];
  const aiInputByPendingIndex: CsvRow[] = [];
  const activeIngredientsCreated: OutputRow[] = [];

  for (const input of activeIngredientInputs) {
    const existing = activeIngredientByNormalized(activeIngredients, input.normalized_name);
    if (existing) {
      skippedExisting.push({
        entity: "active_ingredient",
        name: input.name_ru,
        normalized_name: input.normalized_name,
        existing_id: rowId(existing),
        reason: "active ingredient already exists before insert",
      });
      continue;
    }
    aiInputByPendingIndex.push(input);
    aiPayloads.push(activeIngredientPayload(input, activeIngredientColumns, globalCatalogUserId));
  }

  errors.push(
    ...(await insertRows(
      supabase,
      "active_ingredients",
      aiPayloads,
      100,
      (created, inputIndex) => {
        const input = aiInputByPendingIndex[inputIndex];
        activeIngredientsCreated.push({
          active_ingredient_id: rowId(created),
          name_ru: input?.name_ru ?? asString(created.name_ru),
          normalized_name: input?.normalized_name ?? asString(created.slug),
          chemical_class: input?.chemical_class ?? "",
        });
      },
      0,
      "active_ingredients"
    ))
  );
  await writeCsv(path.join(APPLY_DIR, "active_ingredients_created.csv"), activeIngredientsCreated, [
    "active_ingredient_id",
    "name_ru",
    "normalized_name",
    "chemical_class",
  ]);
  await writeCsv(path.join(APPLY_DIR, "skipped_existing.csv"), skippedExisting, [
    "entity",
    "name",
    "normalized_name",
    "existing_id",
    "reason",
  ]);
  await writeCsv(path.join(APPLY_DIR, "apply_errors.csv"), errors, [
    "table",
    "input_index",
    "product_trade_name",
    "active_ingredient_name_ru",
    "name",
    "normalized_name",
    "error",
    "payload_json",
  ]);
  writeProgress("active_ingredients_done", {
    active_ingredients_created_this_run: activeIngredientsCreated.length,
    skipped_existing: skippedExisting.length,
    errors: errors.length,
  });

  activeIngredients = await fetchAll(supabase, "active_ingredients");
  const activeIngredientIdByNorm = new Map<string, string>();
  for (const input of activeIngredientInputs) {
    const row = activeIngredientByNormalized(activeIngredients, input.normalized_name);
    if (row) activeIngredientIdByNorm.set(input.normalized_name, rowId(row));
  }

  let productAiRows = await fetchAll(supabase, "product_active_ingredients");
  const productAiColumns = observedColumns(productAiRows);
  const productAiPayloads: Record<string, JsonValue>[] = [];
  const productAiInputByPendingIndex: CsvRow[] = [];
  const productAiCreated: OutputRow[] = [];
  const sortOrderByProduct = new Map<string, number>();
  const pendingProductAiPairs = new Set<string>();

  for (const input of productAiInputs) {
    const productRow = productByNormalized(products, input.product_normalized_name);
    const activeIngredientRow = activeIngredientByNormalized(activeIngredients, input.active_ingredient_normalized_name);
    const productId = createdProductIdByNorm.get(input.product_normalized_name) || input.existing_product_id || (productRow ? rowId(productRow) : "");
    const activeIngredientId =
      activeIngredientIdByNorm.get(input.active_ingredient_normalized_name) ||
      input.existing_active_ingredient_id ||
      (activeIngredientRow ? rowId(activeIngredientRow) : "");
    if (!productId || !activeIngredientId) {
      errors.push({
        table: "product_active_ingredients",
        product_trade_name: input.product_trade_name,
        active_ingredient_name_ru: input.active_ingredient_name_ru,
        error: "missing product_id or active_ingredient_id",
      });
      continue;
    }
    const pairKey = `${productId}::${activeIngredientId}`;
    const existing = productAiRows.find(
      (row) => asString(row.product_id) === productId && asString(row.active_ingredient_id) === activeIngredientId
    );
    if (existing || pendingProductAiPairs.has(pairKey)) {
      skippedExisting.push({
        entity: "product_active_ingredient",
        name: `${input.product_trade_name} → ${input.active_ingredient_name_ru}`,
        normalized_name: `${input.product_normalized_name}::${input.active_ingredient_normalized_name}`,
        existing_id: existing ? rowId(existing) : "",
        reason: existing ? "product active ingredient link already exists" : "duplicate link in input batch",
      });
      continue;
    }
    pendingProductAiPairs.add(pairKey);
    const nextSortOrder = (sortOrderByProduct.get(productId) ?? 0) + 1;
    sortOrderByProduct.set(productId, nextSortOrder);
    productAiInputByPendingIndex.push(input);
    productAiPayloads.push(productAiPayload(input, productId, activeIngredientId, productAiColumns, nextSortOrder));
  }

  errors.push(
    ...(await insertRows(
      supabase,
      "product_active_ingredients",
      productAiPayloads,
      100,
      (created, inputIndex) => {
        const input = productAiInputByPendingIndex[inputIndex];
        productAiCreated.push({
          link_id: rowId(created),
          product_trade_name: input?.product_trade_name ?? "",
          product_normalized_name: input?.product_normalized_name ?? "",
          active_ingredient_name_ru: input?.active_ingredient_name_ru ?? "",
          active_ingredient_normalized_name: input?.active_ingredient_normalized_name ?? "",
          concentration_text: input?.concentration_text ?? asString(created.concentration_text),
        });
      },
      0,
      "product_active_ingredients"
    ))
  );
  await writeCsv(path.join(APPLY_DIR, "product_active_ingredients_created.csv"), productAiCreated, [
    "link_id",
    "product_trade_name",
    "product_normalized_name",
    "active_ingredient_name_ru",
    "active_ingredient_normalized_name",
    "concentration_text",
  ]);
  await writeCsv(path.join(APPLY_DIR, "skipped_existing.csv"), skippedExisting, [
    "entity",
    "name",
    "normalized_name",
    "existing_id",
    "reason",
  ]);
  await writeCsv(path.join(APPLY_DIR, "apply_errors.csv"), errors, [
    "table",
    "input_index",
    "product_trade_name",
    "active_ingredient_name_ru",
    "name",
    "normalized_name",
    "error",
    "payload_json",
  ]);
  writeProgress("product_active_ingredients_done", {
    product_active_ingredients_created_this_run: productAiCreated.length,
    skipped_existing: skippedExisting.length,
    errors: errors.length,
  });

  productAiRows = await fetchAll(supabase, "product_active_ingredients");
  products = await fetchAll(supabase, "products");
  const usageCountAfter = await countTable(supabase, "product_usage_rules");
  const productsInsertedThisRun = productsCreated.length;
  const activeIngredientsInsertedThisRun = activeIngredientsCreated.length;
  const productAiInsertedThisRun = productAiCreated.length;

  productsCreated.length = 0;
  for (const input of productInputs) {
    const row = productByNormalized(products, input.normalized_name);
    if (!row) {
      errors.push({
        table: "products",
        name: input.trade_name,
        normalized_name: input.normalized_name,
        error: "product missing after apply",
      });
      continue;
    }
    productsCreated.push({
      product_id: rowId(row),
      trade_name: input.trade_name,
      normalized_name: input.normalized_name,
      company_id: asString(row.company_id),
      source_url: input.source_url,
    });
  }

  activeIngredientsCreated.length = 0;
  for (const input of activeIngredientInputs) {
    const row = activeIngredientByNormalized(activeIngredients, input.normalized_name);
    if (!row) {
      errors.push({
        table: "active_ingredients",
        name: input.name_ru,
        normalized_name: input.normalized_name,
        error: "active ingredient missing after apply",
      });
      continue;
    }
    activeIngredientsCreated.push({
      active_ingredient_id: rowId(row),
      name_ru: input.name_ru,
      normalized_name: input.normalized_name,
      chemical_class: input.chemical_class,
    });
  }

  productAiCreated.length = 0;
  const finalLinkIds = new Set<string>();
  for (const input of productAiInputs) {
    const productRow = productByNormalized(products, input.product_normalized_name);
    const activeIngredientRow = activeIngredientByNormalized(activeIngredients, input.active_ingredient_normalized_name);
    const productId = createdProductIdByNorm.get(input.product_normalized_name) || input.existing_product_id || (productRow ? rowId(productRow) : "");
    const activeIngredientId =
      activeIngredientIdByNorm.get(input.active_ingredient_normalized_name) ||
      input.existing_active_ingredient_id ||
      (activeIngredientRow ? rowId(activeIngredientRow) : "");
    if (!productId || !activeIngredientId) continue;
    const row = productAiRows.find(
      (item) => asString(item.product_id) === productId && asString(item.active_ingredient_id) === activeIngredientId
    );
    if (!row) {
      errors.push({
        table: "product_active_ingredients",
        product_trade_name: input.product_trade_name,
        active_ingredient_name_ru: input.active_ingredient_name_ru,
        error: "product active ingredient link missing after apply",
      });
      continue;
    }
    const linkId = rowId(row);
    if (finalLinkIds.has(linkId)) continue;
    finalLinkIds.add(linkId);
    productAiCreated.push({
      link_id: linkId,
      product_trade_name: input.product_trade_name,
      product_normalized_name: input.product_normalized_name,
      active_ingredient_name_ru: input.active_ingredient_name_ru,
      active_ingredient_normalized_name: input.active_ingredient_normalized_name,
      concentration_text: input.concentration_text || asString(row.concentration_text),
    });
  }

  const nonGlobalCreated = productsCreated.filter((row) => String(row.company_id) !== "");
  const smerchGlobal = products.filter((row) => row.company_id === null && productNames(row).some((name) => normalizedKey(name) === "смерч вр"));

  const sampleWithAi = productAiCreated.slice(0, 10).map((row) => ({
    product_trade_name: row.product_trade_name,
    active_ingredient_name_ru: row.active_ingredient_name_ru,
    concentration_text: row.concentration_text,
  }));

  await writeCsv(path.join(APPLY_DIR, "products_created.csv"), productsCreated, [
    "product_id",
    "trade_name",
    "normalized_name",
    "company_id",
    "source_url",
  ]);
  await writeCsv(path.join(APPLY_DIR, "active_ingredients_created.csv"), activeIngredientsCreated, [
    "active_ingredient_id",
    "name_ru",
    "normalized_name",
    "chemical_class",
  ]);
  await writeCsv(path.join(APPLY_DIR, "product_active_ingredients_created.csv"), productAiCreated, [
    "link_id",
    "product_trade_name",
    "product_normalized_name",
    "active_ingredient_name_ru",
    "active_ingredient_normalized_name",
    "concentration_text",
  ]);
  await writeCsv(path.join(APPLY_DIR, "skipped_existing.csv"), skippedExisting, [
    "entity",
    "name",
    "normalized_name",
    "existing_id",
    "reason",
  ]);
  await writeCsv(path.join(APPLY_DIR, "apply_errors.csv"), errors, [
    "table",
    "input_index",
    "product_trade_name",
    "active_ingredient_name_ru",
    "name",
    "normalized_name",
    "error",
    "payload_json",
  ]);
  await writeCsv(path.join(APPLY_DIR, "sample_10_products_with_ai.csv"), sampleWithAi, [
    "product_trade_name",
    "active_ingredient_name_ru",
    "concentration_text",
  ]);

  const summary = [
    "# BossAgro global import apply summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Scope",
    "",
    "- Applied only dry-run safe scope.",
    "- Usage rules were not imported.",
    "- Company, warehouses, balances, ledger, batches, operations were not touched.",
    "- Supabase client has no multi-table transaction here; applied staged/idempotent checks: products, active ingredients, links.",
    "",
    "## Counts",
    "",
    `- products input: ${productInputs.length}`,
    `- products created/present from apply scope: ${productsCreated.length}`,
    `- products inserted this run: ${productsInsertedThisRun}`,
    `- active_ingredients input: ${activeIngredientInputs.length}`,
    `- active_ingredients created/present from apply scope: ${activeIngredientsCreated.length}`,
    `- active_ingredients inserted this run: ${activeIngredientsInsertedThisRun}`,
    `- product_active_ingredients input: ${productAiInputs.length}`,
    `- product_active_ingredients links created/present from apply scope: ${productAiCreated.length}`,
    `- product_active_ingredients links inserted this run: ${productAiInsertedThisRun}`,
    `- skipped existing total: ${skippedExisting.length}`,
    `- errors: ${errors.length}`,
    "",
    "## Post-check",
    "",
    `- created products with company_id = null: ${productsCreated.length - nonGlobalCreated.length}/${productsCreated.length}`,
    `- created products with non-null company_id: ${nonGlobalCreated.length}`,
    `- Smerch global products count: ${smerchGlobal.length}`,
    `- usage_rules count before: ${usageCountBefore.count ?? "unknown"} (${usageCountBefore.error || "ok"})`,
    `- usage_rules count after: ${usageCountAfter.count ?? "unknown"} (${usageCountAfter.error || "ok"})`,
    `- usage_rules imported: no`,
    "",
    "## Required notes format",
    "",
    "Each created product notes includes:",
    "- source=BossAgro",
    "- source_type=reference_catalog",
    "- confidence=medium",
    "- allowed_in_kazakhstan_from_source=<value>",
    "- registry_current_status=unknown",
    "",
    "## Output files",
    "",
    "- products_created.csv",
    "- active_ingredients_created.csv",
    "- product_active_ingredients_created.csv",
    "- skipped_existing.csv",
    "- apply_errors.csv",
    "- sample_10_products_with_ai.csv",
  ].join("\n");
  writeFileSync(path.join(APPLY_DIR, "apply_summary.md"), `${summary}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        products_created_or_present_from_apply_scope: productsCreated.length,
        products_inserted_this_run: productsInsertedThisRun,
        active_ingredients_created_or_present_from_apply_scope: activeIngredientsCreated.length,
        active_ingredients_inserted_this_run: activeIngredientsInsertedThisRun,
        product_active_ingredient_links_created_or_present_from_apply_scope: productAiCreated.length,
        product_active_ingredient_links_inserted_this_run: productAiInsertedThisRun,
        skipped_existing: skippedExisting.length,
        errors: errors.length,
        created_products_company_id_null: productsCreated.length - nonGlobalCreated.length,
        created_products_non_null_company_id: nonGlobalCreated.length,
        smerch_global_products_count: smerchGlobal.length,
        usage_rules_before: usageCountBefore.count,
        usage_rules_after: usageCountAfter.count,
        outputDir: APPLY_DIR,
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
