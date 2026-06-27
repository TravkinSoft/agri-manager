import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanText,
  choosePesticideTypes,
  dosingType,
  ensureDirs,
  extractArticleHtml,
  extractJsonLdDates,
  extractMeta,
  extractTables,
  inferRateUnit,
  inferStorageUnit,
  listHtmlFiles,
  normalizeName,
  OUTPUT_DIR,
  PARSED_DIR,
  parseWaitingPeriod,
  ParsedPageBundle,
  RAW_DIR,
  readCsv,
  slugFromUrl,
  splitConcentration,
  splitParts,
  stripTags,
  UsageRule,
  writeCsv,
} from "./bossagro-lib";

const ATTR_MAP: Record<string, keyof ParsedPageBundle["product"]> = {
  "Действующее вещество": "active_ingredients",
  "Препаративная форма": "formulation",
  "Содержание действующего вещества": "concentration_text",
  "Химический класс": "chemical_class",
  "Способ проникновения": "penetration_method",
  "Характер действия": "action_type",
  "Класс опасности для человека": "hazard_class_human",
  "Класс опасности для пчел": "hazard_class_bees",
  "Культура": "crops_summary",
  "Вредный объект": "target_objects_summary",
  "Производитель": "manufacturer",
};

function cell(row: string[], index: number) {
  return cleanText(row[index] ?? "") || "unknown";
}

function parseAttributes(table: string[][]) {
  const attrs: Record<string, string> = {};
  for (const row of table) {
    if (row.length < 2) continue;
    const key = cleanText(row[0]);
    const value = cleanText(row.slice(1).join(" | ")) || "unknown";
    if (key) attrs[key] = value;
  }
  return attrs;
}

function usageHeaderIndex(headers: string[], patterns: RegExp[]) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function parseUsageRules(table: string[][], productName: string, normalizedName: string, sourceUrl: string, formulation: string) {
  const warnings: Record<string, string>[] = [];
  if (table.length < 2) return { rules: [] as UsageRule[], warnings };
  const headers = table[0].map(cleanText);
  const rateIdx = usageHeaderIndex(headers, [/норма расхода/i]);
  const cropIdx = usageHeaderIndex(headers, [/культура/i, /обрабатываемый объект/i]);
  const targetIdx = usageHeaderIndex(headers, [/сорное/i, /вредный/i, /объект/i, /болезн/i, /вредител/i]);
  const methodIdx = usageHeaderIndex(headers, [/способ/i, /время/i, /срок/i]);
  const waitingIdx = usageHeaderIndex(headers, [/срок.*ожидан/i, /последней обработки/i]);

  const rules: UsageRule[] = [];
  for (const row of table.slice(1)) {
    if (row.every((value) => !cleanText(value))) continue;
    const applicationRate = rateIdx >= 0 ? cell(row, rateIdx) : "unknown";
    const applicationRateUnit = inferRateUnit(applicationRate, rateIdx >= 0 ? headers[rateIdx] : "", formulation);
    const waiting = parseWaitingPeriod(waitingIdx >= 0 ? cell(row, waitingIdx) : "unknown");
    const rule: UsageRule = {
      product_normalized_name: normalizedName,
      product_trade_name: productName,
      application_rate: applicationRate,
      application_rate_unit: applicationRateUnit,
      crop: cropIdx >= 0 ? cell(row, cropIdx) : "unknown",
      treated_object: cropIdx >= 0 ? cell(row, cropIdx) : "unknown",
      target_object: targetIdx >= 0 ? cell(row, targetIdx) : "unknown",
      application_method: methodIdx >= 0 ? cell(row, methodIdx) : "unknown",
      application_timing: methodIdx >= 0 ? cell(row, methodIdx) : "unknown",
      restrictions: "unknown",
      waiting_period_text: waiting.text,
      waiting_period_days: waiting.days,
      max_applications: waiting.maxApplications,
      source_url: sourceUrl,
      source_name: "BossAgro",
      confidence: rateIdx >= 0 && cropIdx >= 0 ? "medium" : "low",
      raw_usage_row_json: JSON.stringify(Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, row[index] ?? ""]))),
    };
    if (rateIdx < 0 || cropIdx < 0) {
      warnings.push({
        product_trade_name: productName,
        source_url: sourceUrl,
        warning: "usage_table_header_not_fully_mapped",
        raw_usage_row_json: rule.raw_usage_row_json,
      });
    }
    rules.push(rule);
  }
  return { rules, warnings };
}

function parseProduct(html: string, sourceUrl: string, categories: string[]): ParsedPageBundle {
  const article = extractArticleHtml(html);
  const title = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ? stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") : "");
  const statusText = stripTags(html.match(/<div[^>]+class=["'][^"']*prep-status[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "") || "unknown";
  const dateText = stripTags(html.match(/<span[^>]+class=["'][^"']*articles-item__date[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const dates = extractJsonLdDates(html);
  const publishedDate = dateText || dates.published || dates.modified || "unknown";
  const metaDescription = extractMeta(html, "description");
  const firstParagraph = stripTags(article.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
  const shortDescription = firstParagraph || metaDescription || "unknown";
  const tables = extractTables(article);
  const attrTable = tables.find((table) => table.some((row) => /Действующее вещество/i.test(row[0] ?? ""))) ?? tables[0] ?? [];
  const attrs = parseAttributes(attrTable);
  const rawAttrs: Record<string, string> = { ...attrs };
  const usageTable = tables.find((table) => table[0]?.some((header) => /Норма расхода/i.test(header))) ?? [];
  const normalizedName = normalizeName(title);
  const types = choosePesticideTypes(categories);

  const product: ParsedPageBundle["product"] = {
    trade_name: title || "unknown",
    original_name: title || "unknown",
    normalized_name: normalizedName || "unknown",
    product_url: sourceUrl,
    source_name: "BossAgro",
    source_type: "reference_catalog",
    product_type: "pesticide",
    category: "pesticide",
    pesticide_type: types.primary,
    source_categories: categories,
    additional_pesticide_types: types.additional,
    status_text: statusText,
    allowed_in_kazakhstan_from_source: /Разрешен в РК/i.test(statusText) ? "yes" : statusText === "unknown" ? "unknown" : "no",
    published_date: publishedDate,
    short_description: shortDescription,
    active_ingredients: attrs["Действующее вещество"] || "unknown",
    concentration_text: attrs["Содержание действующего вещества"] || "unknown",
    formulation: attrs["Препаративная форма"] || "unknown",
    chemical_class: attrs["Химический класс"] || "unknown",
    penetration_method: attrs["Способ проникновения"] || "unknown",
    action_type: attrs["Характер действия"] || "unknown",
    hazard_class_human: attrs["Класс опасности для человека"] || "unknown",
    hazard_class_bees: attrs["Класс опасности для пчел"] || "unknown",
    crops_summary: attrs["Культура"] || "unknown",
    target_objects_summary: attrs["Вредный объект"] || "unknown",
    manufacturer: attrs["Производитель"] || "unknown",
    storage_unit: "unknown",
    issue_unit: "unknown",
    default_rate_unit: "unknown",
    default_dosing_type: "unknown",
    source_url: sourceUrl,
    confidence: title && attrTable.length ? "medium" : "low",
    import_status: "READY",
    raw_attributes_json: "{}",
    parse_status: title ? "OK" : "BLOCKED",
  };

  for (const [sourceKey, targetKey] of Object.entries(ATTR_MAP)) {
    if (!product[targetKey] && attrs[sourceKey]) {
      (product as unknown as Record<string, string>)[targetKey] = attrs[sourceKey];
    }
  }

  const usage = parseUsageRules(usageTable, product.trade_name, product.normalized_name, sourceUrl, product.formulation);
  product.default_rate_unit = usage.rules.find((rule) => rule.application_rate_unit !== "unknown")?.application_rate_unit ?? "unknown";
  product.default_dosing_type = dosingType(product.default_rate_unit);
  product.storage_unit = inferStorageUnit(product.formulation);
  product.issue_unit = product.storage_unit;

  const statuses = new Set<string>();
  if (product.parse_status === "BLOCKED") statuses.add("BLOCKED");
  if (product.active_ingredients === "unknown") statuses.add("NEED_ACTIVE_INGREDIENT_CHECK");
  if (product.storage_unit === "unknown" || product.default_rate_unit === "unknown") statuses.add("NEED_UNIT_CHECK");
  if (statuses.size === 0) statuses.add("READY");
  product.import_status = Array.from(statuses).join(";");
  product.raw_attributes_json = JSON.stringify(rawAttrs);

  const aiParts = splitParts(product.active_ingredients);
  const concentrationParts = splitConcentration(product.concentration_text);
  const activeIngredients = aiParts.map((name) => ({
    name_ru: name,
    name_en: "unknown",
    normalized_name: normalizeName(name),
    type: product.pesticide_type,
    chemical_class: product.chemical_class,
    source_url: sourceUrl,
    source_name: "BossAgro" as const,
    confidence: "medium",
  }));
  const productActiveIngredients = aiParts.map((name, index) => {
    const matched = concentrationParts.length === aiParts.length ? concentrationParts[index] : product.concentration_text;
    return {
      product_normalized_name: product.normalized_name,
      product_trade_name: product.trade_name,
      active_ingredient_normalized_name: normalizeName(name),
      active_ingredient_name_ru: name,
      concentration_text: product.concentration_text,
      concentration_part: matched || "unknown",
      source_url: sourceUrl,
      confidence: concentrationParts.length === aiParts.length ? "medium" : "low",
      parse_status: concentrationParts.length === aiParts.length ? "OK" : "NEED_REVIEW",
    };
  });

  const blocked = product.parse_status === "BLOCKED"
    ? [{ product_url: sourceUrl, slug: slugFromUrl(sourceUrl), reason: "missing_title_or_empty_card" }]
    : [];

  return {
    product,
    activeIngredients,
    productActiveIngredients,
    usageRules: usage.rules,
    usageWarnings: usage.warnings,
    blocked,
  };
}

async function main() {
  await ensureDirs();
  const linkRows = await readCsv(path.join(OUTPUT_DIR, "product_links.csv"));
  const categoriesByUrl = new Map<string, string[]>();
  for (const row of linkRows) {
    const url = row.product_url;
    const categories = categoriesByUrl.get(url) ?? [];
    if (!categories.includes(row.category_name)) categories.push(row.category_name);
    categoriesByUrl.set(url, categories);
  }

  const files = await listHtmlFiles(RAW_DIR);
  const bundles: ParsedPageBundle[] = [];
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const slug = path.basename(file, ".html");
    const link = linkRows.find((row) => row.slug === slug);
    const url = link?.product_url ?? `https://bossagro.kz/glossary/${slug}/`;
    const categories = categoriesByUrl.get(url) ?? [link?.category_name ?? "Пестициды"];
    bundles.push(parseProduct(html, url, categories));
  }

  await writeFile(path.join(PARSED_DIR, "parsed_products.json"), JSON.stringify(bundles, null, 2), "utf8");
  await writeCsv(
    path.join(PARSED_DIR, "parsed_products_preview.csv"),
    bundles.map((bundle) => ({
      trade_name: bundle.product.trade_name,
      pesticide_type: bundle.product.pesticide_type,
      active_ingredients: bundle.product.active_ingredients,
      usage_rules: bundle.usageRules.length,
      import_status: bundle.product.import_status,
      source_url: bundle.product.source_url,
    })),
    ["trade_name", "pesticide_type", "active_ingredients", "usage_rules", "import_status", "source_url"]
  );

  console.log(JSON.stringify({
    raw_pages: files.length,
    parsed_products: bundles.length,
    blocked: bundles.flatMap((bundle) => bundle.blocked).length,
    usage_rules: bundles.flatMap((bundle) => bundle.usageRules).length,
    active_ingredients_raw_rows: bundles.flatMap((bundle) => bundle.activeIngredients).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

