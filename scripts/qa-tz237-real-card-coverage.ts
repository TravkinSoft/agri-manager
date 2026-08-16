import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildHumanPesticideCard,
  type HumanPesticideCardData,
} from "../lib/glbd/human-pesticide-card";

const BRANCH_REF = "gsglkmudcwkdetqtocae";
const OUTPUT_DIR = resolve(process.env.TZ237_OUTPUT_DIR || "../audit-output/TZ-237");
const ENV_FILE = resolve(
  process.env.TZ237_ENV_FILE
    || "../project-bolt-sb1-hjjzpfey-4/project/.env.local",
);
const REQUIRED_SAMPLE_NAMES = [
  "АКСИАЛ 045",
  "АКСИАЛ 050",
  "Axial",
  "ПАРАДОКС",
  "Lontrel",
  "Granstar",
  "Celest Top",
  "Curamin Foliar",
  "Phomazin",
  "РИДОМИЛ ГОЛД МЦ 68",
  "Битоксибациллин",
  "Amino Max",
  "ЭКСПЕРТ",
];
const FORBIDDEN_PRIMARY_TEXT = /культура не указана|canonical branch-only qa reference|assistant_qa_dataset|usage_rules|import batch|recommendation_allowed|missing_critical_fields/i;

type Row = Record<string, any>;

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function required(env: Record<string, string>, key: string): string {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

async function fetchAll(client: SupabaseClient, table: string, select = "*"): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const result = await client.from(table).select(select).range(from, from + pageSize - 1);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    const page = (result.data || []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function groupBy<T extends Row>(rows: T[], key: string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const value = String(row[key] || "");
    result.set(value, [...(result.get(value) || []), row]);
  }
  return result;
}

function byId(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function productName(product: Row): string {
  return String(product.trade_name || product.name || product.name_ru || product.name_en || product.id);
}

function normalize(value: unknown): string {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function findProduct(products: Row[], name: string): Row | null {
  const exact = products.find((product) => normalize(productName(product)) === normalize(name));
  if (exact) return exact;
  return products.find((product) => normalize(productName(product)).includes(normalize(name))) || null;
}

function technicalDescription(value: unknown): boolean {
  return /canonical branch-only qa reference|assistant_qa_dataset|usage_rules|import batch|dataset|qa_flags|структурированные нормы|массиве usage/i.test(String(value || ""));
}

function workingFluidRaw(rule: Row): boolean {
  const source = [
    rule.usage_summary,
    rule.notes,
    rule.restrictions,
    rule.source_text_raw,
    rule.original_source_text,
  ].filter(Boolean).join(" ");
  return /расход\s+рабоч(?:ей|его)\s+(?:жидкости|раствора)\s*[:\-–—]?\s*\d+(?:[.,]\d+)?\s*(?:[-–—]\s*\d+(?:[.,]\d+)?)?\s*л\s*\/\s*га/i.test(source);
}

function meaningfulRawTarget(rule: Row): boolean {
  const raw = [rule.target_text_original, rule.target_text]
    .some((value) => String(value || "").trim().length > 0);
  if (raw) return true;
  if (Array.isArray(rule.target_names_raw)) return rule.target_names_raw.length > 0;
  if (rule.target_names_raw && typeof rule.target_names_raw === "object") {
    return Object.keys(rule.target_names_raw).length > 0;
  }
  return String(rule.target_names_raw || "").replace(/[\[\]{}"\s]/g, "").length > 0;
}

async function main() {
  const env = parseEnv(await readFile(ENV_FILE, "utf8"));
  const url = required(env, "A106_SUPABASE_URL");
  if (!url.includes(BRANCH_REF) || required(env, "A106_BRANCH_REF") !== BRANCH_REF) {
    throw new Error(`STOP: wrong Supabase branch, expected ${BRANCH_REF}`);
  }
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
    fetchAll(client, "products", "id,trade_name,name,name_ru,name_en,description,manufacturer,manufacturer_id,formulation,formulation_id,pesticide_category,category,subcategory,mode_of_action_type,mode_of_action_type_id,is_active,archived,type,company_id"),
    fetchAll(client, "global_product_aliases", "product_id,alias"),
    fetchAll(client, "glbd_product_components", "id,product_id,component_id,role_in_product,concentration_value,concentration_unit,concentration_text,is_primary_active,sort_order,review_status"),
    fetchAll(client, "glbd_product_usage_rules"),
    fetchAll(client, "glbd_product_assistant_safety", "product_id,read_allowed,recommendation_allowed,missing_critical_fields"),
    fetchAll(client, "glbd_components", "id,name_ru,name_en,component_type"),
    fetchAll(client, "crops", "id,name_ru,name_en"),
    fetchAll(client, "diseases", "id,name_ru,name_en"),
    fetchAll(client, "pests", "id,name_ru,name_en"),
    fetchAll(client, "weeds", "id,name_ru,name_en"),
    fetchAll(client, "agrochem_manufacturers", "id,name"),
    fetchAll(client, "agrochem_formulations", "id,code,name_ru"),
    fetchAll(client, "agrochem_mode_of_actions", "id,slug,name_ru"),
  ]);

  const products = productsAll.filter((product) => product.type === "pesticide" && product.company_id === null);
  if (products.length < 852) {
    throw new Error(`Expected at least the verified 852 pesticides, received ${products.length}`);
  }

  const aliasesByProduct = groupBy(aliases, "product_id");
  const visibleLinks = links.filter((row) => ["approved", "needs_owner_review"].includes(String(row.review_status)));
  const linksByProduct = groupBy(visibleLinks, "product_id");
  const rulesByProduct = groupBy(rules, "product_id");
  const safetyByProduct = new Map(safetyRows.map((row) => [String(row.product_id), row]));
  const componentById = byId(components);
  const cropById = byId(crops);
  const diseaseById = byId(diseases);
  const pestById = byId(pests);
  const weedById = byId(weeds);
  const manufacturerById = byId(manufacturers);
  const formulationById = byId(formulations);
  const modeById = byId(modes);

  const cards = new Map<string, HumanPesticideCardData>();
  const failures: Array<{ productId: string; tradeName: string; error: string }> = [];
  const startedAt = performance.now();
  for (const product of products) {
    try {
      const productRules = rulesByProduct.get(String(product.id)) || [];
      const productLinks = linksByProduct.get(String(product.id)) || [];
      const formulation = formulationById.get(String(product.formulation_id || ""));
      const card = buildHumanPesticideCard({
        product: { ...product, id: String(product.id) },
        aliases: (aliasesByProduct.get(String(product.id)) || []).map((row) => row.alias),
        composition: productLinks.map((row) => ({
          ...row,
          component: componentById.get(String(row.component_id)) || null,
        })),
        usageRules: productRules.map((rule) => ({
          ...rule,
          crop: cropById.get(String(rule.crop_id || "")) || null,
          target:
            diseaseById.get(String(rule.disease_id || ""))
            || pestById.get(String(rule.pest_id || ""))
            || weedById.get(String(rule.weed_id || ""))
            || null,
        })),
        manufacturerName: manufacturerById.get(String(product.manufacturer_id || ""))?.name || null,
        formulationName: formulation
          ? `${formulation.name_ru}${formulation.code && !normalize(formulation.name_ru).includes(normalize(formulation.code)) ? ` (${formulation.code})` : ""}`
          : null,
        modeOfActionName: modeById.get(String(product.mode_of_action_type_id || ""))?.name_ru || null,
        safety: safetyByProduct.get(String(product.id)) || null,
      });
      if (!card.rows.some((row) => row.label === "Название")) throw new Error("name row missing");
      if (FORBIDDEN_PRIMARY_TEXT.test(JSON.stringify({ rows: card.rows, description: card.description }))) {
        throw new Error("forbidden technical or false text in primary card");
      }
      cards.set(String(product.id), card);
    } catch (error) {
      failures.push({
        productId: String(product.id),
        tradeName: productName(product),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const buildDurationMs = Math.round(performance.now() - startedAt);

  const sampleProducts: Row[] = [];
  for (const name of REQUIRED_SAMPLE_NAMES) {
    const product = findProduct(products, name);
    if (product && !sampleProducts.some((row) => row.id === product.id)) sampleProducts.push(product);
  }
  const addSample = (product: Row | undefined) => {
    if (product && !sampleProducts.some((row) => row.id === product.id)) sampleProducts.push(product);
  };
  addSample(products.find((product) => (rulesByProduct.get(String(product.id)) || []).length === 0));
  addSample(products.find((product) => (rulesByProduct.get(String(product.id)) || []).length >= 8));
  addSample(products.find((product) => {
    const productRules = rulesByProduct.get(String(product.id)) || [];
    return new Set(productRules.map((rule) => `${rule.rate_min}:${rule.rate_max}:${rule.rate_unit}`)).size >= 3;
  }));
  addSample(products.find((product) => (rulesByProduct.get(String(product.id)) || []).some((rule) => !rule.crop_id && rule.crop_name_raw)));
  addSample(products.find((product) => (rulesByProduct.get(String(product.id)) || []).some((rule) => !rule.disease_id && !rule.pest_id && !rule.weed_id && (rule.target_text_original || rule.target_names_raw || rule.target_text))));
  addSample(products.find((product) => (linksByProduct.get(String(product.id)) || []).some((row) => row.role_in_product === "safener")));
  addSample(products.find((product) => (linksByProduct.get(String(product.id)) || []).some((row) => componentById.get(String(row.component_id))?.component_type === "biological_agent")));
  for (const product of products) {
    if (sampleProducts.length >= 30) break;
    addSample(product);
  }

  const numericRates = rules.filter((rule) => rule.rate_min !== null && rule.rate_min !== undefined).length;
  const rawRateFallback = rules.filter((rule) => (
    (rule.rate_min === null || rule.rate_min === undefined)
    && (rule.original_rate_text || rule.original_rate_value_text)
  )).length;
  const missingRate = rules.length - numericRates - rawRateFallback;
  const normalizedUnits = rules.filter((rule) => /^(?:l|kg|g|ml)(?:\/|_)(?:ha|t)$|^(?:л|кг|г|мл)\/(?:га|т)$/i.test(String(rule.rate_unit || ""))).length;
  const unresolvedUnits = rules.filter((rule) => rule.rate_min !== null && rule.rate_min !== undefined && !rule.rate_unit).length;
  const structuredWorkingFluid = rules.filter((rule) => rule.working_fluid_min !== null && rule.working_fluid_min !== undefined).length;
  const extractedWorkingFluid = rules.filter((rule) => (
    (rule.working_fluid_min === null || rule.working_fluid_min === undefined)
    && workingFluidRaw(rule)
  )).length;
  const technicalDescriptions = products.filter((product) => technicalDescription(product.description)).length;

  const coverage = {
    branchRef: BRANCH_REF,
    products: products.length,
    cardsBuilt: cards.size,
    failed: failures.length,
    failures,
    withRules: products.filter((product) => (rulesByProduct.get(String(product.id)) || []).length > 0).length,
    withoutRules: products.filter((product) => (rulesByProduct.get(String(product.id)) || []).length === 0).length,
    totalRules: rules.length,
    canonicalCropRules: rules.filter((rule) => Boolean(rule.crop_id)).length,
    rawCropRules: rules.filter((rule) => Boolean(rule.crop_name_raw || rule.crop_name_original || rule.crop_group_raw)).length,
    rawCropDisplayOnly: rules.filter((rule) => !rule.crop_id && Boolean(rule.crop_name_raw || rule.crop_name_original || rule.crop_group_raw)).length,
    canonicalTargetRules: rules.filter((rule) => Boolean(rule.disease_id || rule.pest_id || rule.weed_id)).length,
    rawTargetRules: rules.filter(meaningfulRawTarget).length,
    numericRates,
    rawRateFallback,
    missingRate,
    normalizedUnits,
    unresolvedUnits,
    structuredWorkingFluid,
    safelyExtractedWorkingFluid: extractedWorkingFluid,
    missingWorkingFluid: rules.length - structuredWorkingFluid - extractedWorkingFluid,
    canonicalComponents: visibleLinks.filter((row) => row.component_id).length,
    aliases: aliases.length,
    technicalPlaceholdersHidden: technicalDescriptions,
    descriptionsDerived: technicalDescriptions,
    sampleCards: sampleProducts.length,
    buildDurationMs,
    averageBuildMs: Number((buildDurationMs / products.length).toFixed(3)),
    productionConnections: 0,
    writes: 0,
  };
  const samplePayload = sampleProducts.map((product) => ({
    productId: product.id,
    tradeName: productName(product),
    card: cards.get(String(product.id)),
  }));

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(resolve(OUTPUT_DIR, "card-coverage.json"), JSON.stringify(coverage, null, 2) + "\n", "utf8");
  await writeFile(resolve(OUTPUT_DIR, "sample-card-read-model.json"), JSON.stringify(samplePayload, null, 2) + "\n", "utf8");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(Array.from(cards.entries()).sort(([left], [right]) => left.localeCompare(right))))
    .digest("hex");
  await writeFile(resolve(OUTPUT_DIR, "card-read-model.sha256"), `${fingerprint}  852-card-read-model\n`, "utf8");

  console.log(JSON.stringify(coverage, null, 2));
  console.log(`READ_MODEL_FINGERPRINT=${fingerprint}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
