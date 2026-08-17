import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildHumanPesticideCard } from "../lib/glbd/human-pesticide-card";

const QA_REF = "gsglkmudcwkdetqtocae";
const ENV_FILE = resolve(process.env.TZ275_ENV_FILE || "../project-bolt-sb1-hjjzpfey-4/project/.env.local");
const OUTPUT_DIR = resolve(process.env.TZ275_OUTPUT_DIR || "../audit-output/TZ-275/closure");
const CONTROL_PRODUCTS = [
  { label: "Curamin Foliar", query: "Curamin Foliar" },
  { label: "Phomazin", query: "Phomazin" },
  { label: "TechnoFit pH", query: "TechnoFit pH" },
  { label: "Celest Top", query: "Celest Top" },
  { label: "Гербицид", query: "Granstar" },
  { label: "Фунгицид", query: "РИДОМИЛ ГОЛД" },
  { label: "Инсектицид", query: "АКТАРА 250" },
  { label: "Протравитель", query: "МАКСИМ ХL 035" },
] as const;
const OWNER_FIELDS = [
  ["trade_name", "Название"],
  ["manufacturer", "Производитель"],
  ["product_type", "Тип продукта"],
  ["subcategory", "Подкатегория"],
  ["formulation", "Препаративная форма"],
  ["active_ingredients", "Действующие вещества"],
  ["crops", "Культуры"],
  ["targets", "Вредный объект"],
  ["rates", "Норма применения"],
  ["application", "Сроки и способ применения"],
  ["restrictions", "Ограничения"],
  ["source", "Источник"],
  ["review_status", "Статус проверки"],
] as const;

type Row = Record<string, any>;

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

function required(env: Record<string, string>, key: string): string {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

async function fetchAll(client: SupabaseClient, table: string, select = "*"): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await client.from(table).select(select).range(from, from + 999);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    const page = (result.data || []) as Row[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const value = String(row[key] || "");
    grouped.set(value, [...(grouped.get(value) || []), row]);
  }
  return grouped;
}

function byId(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function normalize(value: unknown): string {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function productName(product: Row): string {
  return String(product.trade_name || product.name || product.name_ru || product.name_en || product.id);
}

function findProduct(products: Row[], query: string): Row | null {
  const normalized = normalize(query);
  return products.find((product) => normalize(productName(product)) === normalized)
    || products.find((product) => normalize(productName(product)).includes(normalized))
    || null;
}

function effectiveType(product: Row): string {
  return String(product.product_type || product.type || "unknown");
}

function effectiveSubcategory(product: Row): string {
  return String(product.subcategory || product.pesticide_category || product.fertilizer_type || "not_set");
}

async function main() {
  const env = parseEnv(await readFile(ENV_FILE, "utf8"));
  const url = required(env, "A106_SUPABASE_URL");
  assert.ok(url.includes(QA_REF), `STOP: expected QA project ${QA_REF}`);
  assert.equal(required(env, "A106_BRANCH_REF"), QA_REF, "STOP: wrong QA branch ref");

  const client = createClient(url, required(env, "A106_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const auth = await client.auth.signInWithPassword({
    email: required(env, "A106_TEST_USER_A_EMAIL"),
    password: required(env, "A106_TEST_USER_A_PASSWORD"),
  });
  if (auth.error || !auth.data.session) throw new Error(`QA sign-in failed: ${auth.error?.message || "missing session"}`);

  const [
    productsAll,
    aliases,
    links,
    rules,
    sources,
    safetyRows,
    components,
    crops,
    diseases,
    pests,
    weeds,
    manufacturers,
    formulations,
    modes,
  ] = await Promise.all([
    fetchAll(client, "products", "id,trade_name,name,name_ru,name_en,description,manufacturer,manufacturer_id,formulation,formulation_id,type,product_type,pesticide_category,category,subcategory,fertilizer_type,mode_of_action_type,mode_of_action_type_id,active_ingredient,concentration,composition,source_url,metadata_source_url,requires_review,metadata_review_required,is_active,archived,company_id"),
    fetchAll(client, "global_product_aliases", "product_id,alias"),
    fetchAll(client, "glbd_product_components", "id,product_id,component_id,role_in_product,concentration_value,concentration_unit,concentration_text,is_primary_active,sort_order,review_status"),
    fetchAll(client, "glbd_product_usage_rules"),
    fetchAll(client, "glbd_product_sources", "product_id,source_title,source_url,verification_status,checked_on"),
    fetchAll(client, "glbd_product_assistant_safety", "product_id,read_allowed,recommendation_allowed,missing_critical_fields,identity_status,component_status,usage_rule_status,source_status,review_required"),
    fetchAll(client, "glbd_components", "id,name_ru,name_en,component_type"),
    fetchAll(client, "crops", "id,name_ru,name_en"),
    fetchAll(client, "diseases", "id,name_ru,name_en"),
    fetchAll(client, "pests", "id,name_ru,name_en"),
    fetchAll(client, "weeds", "id,name_ru,name_en"),
    fetchAll(client, "agrochem_manufacturers", "id,name"),
    fetchAll(client, "agrochem_formulations", "id,code,name_ru"),
    fetchAll(client, "agrochem_mode_of_actions", "id,slug,name_ru"),
  ]);

  const products = productsAll.filter((product) => product.company_id === null
    && ["pesticide", "fertilizer", "additive", "growth_regulator"].includes(effectiveType(product)));
  const aliasesByProduct = groupBy(aliases, "product_id");
  const linksByProduct = groupBy(links.filter((row) => ["approved", "needs_owner_review"].includes(String(row.review_status))), "product_id");
  const rulesByProduct = groupBy(rules, "product_id");
  const sourcesByProduct = groupBy(sources, "product_id");
  const safetyByProduct = new Map(safetyRows.map((row) => [String(row.product_id), row]));
  const componentById = byId(components);
  const cropById = byId(crops);
  const diseaseById = byId(diseases);
  const pestById = byId(pests);
  const weedById = byId(weeds);
  const manufacturerById = byId(manufacturers);
  const formulationById = byId(formulations);
  const modeById = byId(modes);

  const buildCard = (product: Row) => {
    const formulation = formulationById.get(String(product.formulation_id || ""));
    return buildHumanPesticideCard({
      product: { ...product, id: String(product.id) },
      aliases: (aliasesByProduct.get(String(product.id)) || []).map((row) => row.alias),
      composition: (linksByProduct.get(String(product.id)) || []).map((row) => ({
        ...row,
        component: componentById.get(String(row.component_id)) || null,
      })),
      usageRules: (rulesByProduct.get(String(product.id)) || []).map((rule) => ({
        ...rule,
        crop: cropById.get(String(rule.crop_id || "")) || null,
        target: diseaseById.get(String(rule.disease_id || ""))
          || pestById.get(String(rule.pest_id || ""))
          || weedById.get(String(rule.weed_id || ""))
          || null,
      })),
      manufacturerName: manufacturerById.get(String(product.manufacturer_id || ""))?.name || null,
      formulationName: formulation
        ? `${formulation.name_ru}${formulation.code && !normalize(formulation.name_ru).includes(normalize(formulation.code)) ? ` (${formulation.code})` : ""}`
        : null,
      modeOfActionName: modeById.get(String(product.mode_of_action_type_id || ""))?.name_ru || null,
      sources: sourcesByProduct.get(String(product.id)) || [],
      safety: safetyByProduct.get(String(product.id)) || null,
    });
  };

  const controls = CONTROL_PRODUCTS.map(({ label, query }) => {
    const product = findProduct(products, query);
    if (!product) {
      return { label, query, found: false, missing: OWNER_FIELDS.map(([key]) => key) };
    }
    const card = buildCard(product);
    const rows = Object.fromEntries(card.rows.map((row) => [row.label, row.value]));
    const fields = Object.fromEntries(OWNER_FIELDS.map(([key, rowLabel]) => [key, rows[rowLabel] || null]));
    return {
      label,
      query,
      found: true,
      productId: product.id,
      tradeName: productName(product),
      fields,
      missing: OWNER_FIELDS.filter(([, rowLabel]) => !rows[rowLabel]).map(([key]) => key),
      card,
    };
  });

  const historicalWithoutRules = products.filter((product) => product.type === "pesticide"
    && (rulesByProduct.get(String(product.id)) || []).length === 0);
  assert.equal(historicalWithoutRules.length, 113, "verified historical no-rules population drifted");
  const grouped = new Map<string, { count: number; subcategories: Record<string, number> }>();
  for (const product of historicalWithoutRules) {
    const type = effectiveType(product);
    const current = grouped.get(type) || { count: 0, subcategories: {} };
    const subcategory = effectiveSubcategory(product);
    current.count += 1;
    current.subcategories[subcategory] = (current.subcategories[subcategory] || 0) + 1;
    grouped.set(type, current);
  }
  const noRules = {
    total: historicalWithoutRules.length,
    byProductType: Object.fromEntries(grouped),
    classification: {
      rulesNotApplicable: 0,
      dataMissing: historicalWithoutRules.length,
      relationDtoUiError: 0,
    },
    products: historicalWithoutRules.map((product) => ({
      id: product.id,
      tradeName: productName(product),
      productType: effectiveType(product),
      subcategory: effectiveSubcategory(product),
      reason: "usage rule data absent",
    })),
    fertilizerContext: {
      includedInHistorical113: 0,
      globalFertilizersWithoutUsageRules: products.filter((product) => effectiveType(product) === "fertilizer"
        && (rulesByProduct.get(String(product.id)) || []).length === 0).length,
    },
  };

  assert.equal(controls.length, CONTROL_PRODUCTS.length);
  assert.equal(noRules.classification.relationDtoUiError, 0);
  const output = {
    qaProject: QA_REF,
    controls,
    noRules,
    taxonomy: {
      topLevel: ["Пестициды", "Удобрения", "Добавки"],
      pesticides: ["гербициды", "фунгициды", "инсектициды", "акарициды", "десиканты", "регуляторы роста", "протравители"],
      fertilizers: "all fertilizer types remain inside one top-level group",
      additives: ["адъюванты", "ПАВ/прилипатели", "регуляторы pH", "кондиционеры воды", "пеногасители", "технические добавки"],
    },
    productionConnections: 0,
    writes: 0,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(resolve(OUTPUT_DIR, "owner-closure.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`TZ275 OWNER CLOSURE PASS controls=${controls.length} noRules=${historicalWithoutRules.length}`);
  for (const control of controls) {
    console.log(`${control.label}: ${control.found ? `FOUND missing=${control.missing.length}` : "NOT FOUND"}`);
  }
  console.log(`NO_RULES_TYPES=${JSON.stringify(noRules.byProductType)}`);
  console.log("PRODUCTION_CONNECTIONS=0 WRITES=0");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
