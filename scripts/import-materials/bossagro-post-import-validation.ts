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

const APPLY_DIR = path.join(OUTPUT_DIR, "global_import_apply");
const VALIDATION_DIR = path.join(OUTPUT_DIR, "global_import_validation");
const PRODUCTS_CREATED = path.join(APPLY_DIR, "products_created.csv");
const ACTIVE_INGREDIENTS_CREATED = path.join(APPLY_DIR, "active_ingredients_created.csv");
const PRODUCT_AI_CREATED = path.join(APPLY_DIR, "product_active_ingredients_created.csv");

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

function asString(value: JsonValue | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function rowId(row: DbRow) {
  return asString(row.id);
}

function simpleKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function countTable(supabase: SupabaseClient, table: string) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  return error ? { count: null, error: error.message } : { count: count ?? 0, error: "" };
}

function idsFrom(rows: CsvRow[], key: string) {
  return rows.map((row) => row[key]).filter(Boolean);
}

function rowsById(rows: DbRow[]) {
  return new Map(rows.map((row) => [rowId(row), row]));
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function notesMissing(row: DbRow) {
  const notes = asString(row.notes);
  const required = ["source=BossAgro", "source_type=reference_catalog", "confidence=medium", "registry_current_status=unknown"];
  return required.filter((marker) => !notes.includes(marker));
}

async function main() {
  loadEnv(process.cwd());
  mkdirSync(VALIDATION_DIR, { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const expectedProducts = readCsv(PRODUCTS_CREATED);
  const expectedActiveIngredients = readCsv(ACTIVE_INGREDIENTS_CREATED);
  const expectedLinks = readCsv(PRODUCT_AI_CREATED);

  const [products, activeIngredients, productAiLinks] = await Promise.all([
    fetchAll(supabase, "products"),
    fetchAll(supabase, "active_ingredients"),
    fetchAll(supabase, "product_active_ingredients"),
  ]);
  const usageRules = await countTable(supabase, "product_usage_rules");

  const productById = rowsById(products);
  const aiById = rowsById(activeIngredients);
  const linkById = rowsById(productAiLinks);

  const missingProducts = expectedProducts
    .filter((row) => !productById.has(row.product_id))
    .map((row) => ({ entity: "product", id: row.product_id, name: row.trade_name, normalized_name: row.normalized_name }));

  const productsInScope = expectedProducts
    .map((expected) => ({ expected, row: productById.get(expected.product_id) }))
    .filter((item): item is { expected: CsvRow; row: DbRow } => Boolean(item.row));

  const nonGlobalProducts = productsInScope
    .filter((item) => item.row.company_id !== null)
    .map((item) => ({
      product_id: item.expected.product_id,
      trade_name: item.expected.trade_name,
      normalized_name: item.expected.normalized_name,
      company_id: asString(item.row.company_id),
    }));

  const duplicateGroups = Array.from(groupBy(expectedProducts, (row) => simpleKey(row.normalized_name)).entries()).filter(
    ([key, rows]) => key && rows.length > 1
  );
  const duplicateRows: OutputRow[] = duplicateGroups.flatMap(([normalizedName, rows]) =>
    rows.map((row) => ({
      duplicate_key: normalizedName,
      duplicate_count: rows.length,
      product_id: row.product_id,
      trade_name: row.trade_name,
      normalized_name: row.normalized_name,
    }))
  );

  const missingNotes = productsInScope.flatMap((item) => {
    const missing = notesMissing(item.row);
    return missing.length
      ? [
          {
            product_id: item.expected.product_id,
            trade_name: item.expected.trade_name,
            normalized_name: item.expected.normalized_name,
            missing_markers: missing.join("; "),
          },
        ]
      : [];
  });

  const missingActiveIngredients = expectedActiveIngredients
    .filter((row) => !aiById.has(row.active_ingredient_id))
    .map((row) => ({
      active_ingredient_id: row.active_ingredient_id,
      name_ru: row.name_ru,
      normalized_name: row.normalized_name,
    }));

  const missingAiLinks = expectedLinks
    .filter((row) => !linkById.has(row.link_id))
    .map((row) => ({
      link_id: row.link_id,
      product_trade_name: row.product_trade_name,
      product_normalized_name: row.product_normalized_name,
      active_ingredient_name_ru: row.active_ingredient_name_ru,
      active_ingredient_normalized_name: row.active_ingredient_normalized_name,
      concentration_text: row.concentration_text,
    }));

  const linksInScope = expectedLinks
    .map((expected) => ({ expected, row: linkById.get(expected.link_id) }))
    .filter((item): item is { expected: CsvRow; row: DbRow } => Boolean(item.row));

  const duplicatedLinkGroups = Array.from(
    groupBy(linksInScope, (item) =>
      [asString(item.row.product_id), asString(item.row.active_ingredient_id), asString(item.row.concentration_text)].join("::")
    ).entries()
  ).filter(([key, rows]) => key && rows.length > 1);

  const duplicatedAiLinks: OutputRow[] = duplicatedLinkGroups.flatMap(([duplicateKey, rows]) =>
    rows.map((item) => ({
      duplicate_key: duplicateKey,
      duplicate_count: rows.length,
      link_id: item.expected.link_id,
      product_id: asString(item.row.product_id),
      active_ingredient_id: asString(item.row.active_ingredient_id),
      concentration_text: asString(item.row.concentration_text),
      product_trade_name: item.expected.product_trade_name,
      active_ingredient_name_ru: item.expected.active_ingredient_name_ru,
    }))
  );

  const globalSmerchRows = products.filter((row) => {
    if (row.company_id !== null) return false;
    return productNames(row).some((name) => {
      const key = simpleKey(name);
      return (key.includes("смерч") || key.includes("smerch")) && (key.includes("вр") || key.includes("vr"));
    });
  });

  await writeCsv(path.join(VALIDATION_DIR, "duplicate_check.csv"), duplicateRows, [
    "duplicate_key",
    "duplicate_count",
    "product_id",
    "trade_name",
    "normalized_name",
  ]);
  await writeCsv(path.join(VALIDATION_DIR, "missing_notes.csv"), missingNotes, [
    "product_id",
    "trade_name",
    "normalized_name",
    "missing_markers",
  ]);
  await writeCsv(path.join(VALIDATION_DIR, "missing_ai_links.csv"), missingAiLinks, [
    "link_id",
    "product_trade_name",
    "product_normalized_name",
    "active_ingredient_name_ru",
    "active_ingredient_normalized_name",
    "concentration_text",
  ]);
  await writeCsv(path.join(VALIDATION_DIR, "duplicated_ai_links.csv"), duplicatedAiLinks, [
    "duplicate_key",
    "duplicate_count",
    "link_id",
    "product_id",
    "active_ingredient_id",
    "concentration_text",
    "product_trade_name",
    "active_ingredient_name_ru",
  ]);

  const statusRows = [
    ["Products expected", String(expectedProducts.length), expectedProducts.length === 778 ? "PASS" : "CHECK"],
    ["Products found", String(productsInScope.length), productsInScope.length === expectedProducts.length ? "PASS" : "FAIL"],
    ["Products company_id null", `${productsInScope.length - nonGlobalProducts.length}/${productsInScope.length}`, nonGlobalProducts.length === 0 ? "PASS" : "FAIL"],
    ["Product normalized duplicates", String(duplicateRows.length), duplicateRows.length === 0 ? "PASS" : "FAIL"],
    ["Products missing notes markers", String(missingNotes.length), missingNotes.length === 0 ? "PASS" : "FAIL"],
    ["Active ingredients expected", String(expectedActiveIngredients.length), expectedActiveIngredients.length === 391 ? "PASS" : "CHECK"],
    ["Active ingredients found", String(expectedActiveIngredients.length - missingActiveIngredients.length), missingActiveIngredients.length === 0 ? "PASS" : "FAIL"],
    ["AI links expected", String(expectedLinks.length), expectedLinks.length === 1308 ? "PASS" : "CHECK"],
    ["AI links found", String(expectedLinks.length - missingAiLinks.length), missingAiLinks.length === 0 ? "PASS" : "FAIL"],
    ["Duplicated AI links", String(duplicatedAiLinks.length), duplicatedAiLinks.length === 0 ? "PASS" : "FAIL"],
    ["Smerch VR global rows", String(globalSmerchRows.length), globalSmerchRows.length === 1 ? "PASS" : "FAIL"],
    ["Product usage rules count", String(usageRules.count ?? "unknown"), usageRules.count === 0 ? "PASS" : "CHECK"],
  ];

  const summary = [
    "# BossAgro post-import validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Scope: read-only validation for BossAgro global import outputs.",
    "",
    "## Result",
    "",
    "| Check | Value | Status |",
    "| --- | ---: | --- |",
    ...statusRows.map(([check, value, status]) => `| ${check} | ${value} | ${status} |`),
    "",
    "## Files",
    "",
    "- duplicate_check.csv",
    "- missing_notes.csv",
    "- missing_ai_links.csv",
    "- duplicated_ai_links.csv",
    "",
    "## Notes",
    "",
    "- No database writes were executed by this validation.",
    "- Usage rules were checked by count only and were not imported.",
    "- Smerch VR global rows are counted by global product names containing Smerch or its Cyrillic equivalent plus VR.",
  ].join("\n");

  writeFileSync(path.join(VALIDATION_DIR, "bossagro_post_import_validation.md"), `${summary}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        products_expected: expectedProducts.length,
        products_found: productsInScope.length,
        non_global_products: nonGlobalProducts.length,
        duplicate_product_rows: duplicateRows.length,
        missing_notes: missingNotes.length,
        active_ingredients_expected: expectedActiveIngredients.length,
        active_ingredients_missing: missingActiveIngredients.length,
        ai_links_expected: expectedLinks.length,
        ai_links_missing: missingAiLinks.length,
        duplicated_ai_link_rows: duplicatedAiLinks.length,
        smerch_global_rows: globalSmerchRows.length,
        product_usage_rules_count: usageRules.count,
        output_dir: VALIDATION_DIR,
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
