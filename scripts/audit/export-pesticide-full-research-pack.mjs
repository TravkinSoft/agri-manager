import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const TASK = "TZ-202";
const EXPECTED_PRODUCTS = 852;
const PRODUCTION_REF = "bhsemlvmkikpntabctml";
const QA_BRANCH_REF = "gsglkmudcwkdetqtocae";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.resolve(repoRoot, "../..", "audit-output", TASK);

const outputFiles = [
  "pesticide_full_research_pack.json",
  "pesticide_full_research_pack.csv",
  "canonical_reference_dictionaries.json",
  "existing_sources.json",
  "import_contract.json",
  "export_validation.json",
];

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['\"]|['\"]$/g, "")];
      }),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(`STOP: ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value, spacing = 2) {
  return `${JSON.stringify(stableValue(value), null, spacing)}\n`;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolActive(row) {
  return row.is_active !== false && row.archived !== true && !row.archived_at;
}

function sortRows(rows, keys = ["id"]) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const result = String(left?.[key] ?? "").localeCompare(String(right?.[key] ?? ""), "en");
      if (result) return result;
    }
    return stableJson(left, 0).localeCompare(stableJson(right, 0), "en");
  });
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = typeof key === "function" ? key(row) : row[key];
    const group = groups.get(value) ?? [];
    group.push(row);
    groups.set(value, group);
  }
  return groups;
}

function uniqueBy(rows, keyOf) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function collectStrings(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, result));
  return result;
}

function hasBrokenUnicode(value) {
  return /\uFFFD|(?:\u00C2|\u00C3|\u00D0|\u00D1|\u00D2|\u00D3)[\u0080-\u00BF]|(?:Р.|С.){3,}/u.test(value);
}

function normalized(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function namesOf(row) {
  return uniqueBy(
    [row.name_ru, row.name_en, row.name, row.canonical_name, row.code, row.slug]
      .map(text)
      .filter(Boolean)
      .map((alias) => ({ alias })),
    (item) => normalized(item.alias),
  ).map((item) => item.alias);
}

function csvCell(value) {
  const source = value === null || value === undefined ? "" : String(value);
  return `"${source.replaceAll('"', '""')}"`;
}

function toCsv(cards) {
  const columns = [
    "product_id",
    "trade_name",
    "name_ru",
    "name_en",
    "aliases_json",
    "manufacturer_id",
    "manufacturer_name",
    "category",
    "subcategory",
    "formulation_id",
    "formulation_name",
    "composition_json",
    "registrations_json",
    "usage_rules_json",
    "restrictions_json",
    "sources_json",
    "assistant_safety_json",
    "research_status",
    "research_notes",
    "current_completeness_json",
    "raw_legacy_values_json",
  ];
  const lines = [columns.map(csvCell).join(",")];
  for (const card of cards) {
    const row = {
      product_id: card.product_id,
      trade_name: card.trade_name,
      name_ru: card.names.ru,
      name_en: card.names.en,
      aliases_json: JSON.stringify(card.aliases),
      manufacturer_id: card.manufacturer.id,
      manufacturer_name: card.manufacturer.name,
      category: card.category.product_type ?? card.category.pesticide_category,
      subcategory: card.category.subcategory,
      formulation_id: card.formulation.id,
      formulation_name: card.formulation.name,
      composition_json: JSON.stringify(card.composition),
      registrations_json: JSON.stringify(card.registrations),
      usage_rules_json: JSON.stringify(card.usage_rules),
      restrictions_json: JSON.stringify(card.restrictions),
      sources_json: JSON.stringify(card.sources),
      assistant_safety_json: JSON.stringify(card.assistant_safety),
      research_status: card.research_status,
      research_notes: card.research_notes,
      current_completeness_json: JSON.stringify(card.current_completeness),
      raw_legacy_values_json: JSON.stringify(card.raw_legacy_values),
    };
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function fetchAll(client, table, configure = (query) => query, orderColumn = "id") {
  const rows = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select("*").range(from, from + pageSize - 1);
    if (orderColumn) query = query.order(orderColumn, { ascending: true });
    query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function fetchOptional(client, table, configure = (query) => query, orderColumn = "id") {
  try {
    return { exists: true, rows: await fetchAll(client, table, configure, orderColumn) };
  } catch (error) {
    if (/does not exist|schema cache|could not find the table/i.test(error.message)) {
      return { exists: false, rows: [], reason: error.message };
    }
    throw error;
  }
}

async function createClients() {
  const productionEnv = parseEnv(await readFile(path.join(repoRoot, ".env"), "utf8"));
  const qaEnv = parseEnv(await readFile(path.join(repoRoot, ".env.local"), "utf8"));
  const productionUrl = productionEnv.NEXT_PUBLIC_SUPABASE_URL;
  const productionKey = productionEnv.SUPABASE_SERVICE_ROLE_KEY;
  const qaUrl = qaEnv.A106_SUPABASE_URL;
  const qaAnonKey = qaEnv.A106_SUPABASE_ANON_KEY;
  const qaEmail = qaEnv.A106_TEST_USER_A_EMAIL;
  const qaPassword = qaEnv.A106_TEST_USER_A_PASSWORD;

  assert(productionUrl && productionKey, "production read-only audit credentials are missing");
  assert(new URL(productionUrl).hostname === `${PRODUCTION_REF}.supabase.co`, "unexpected production project ref");
  assert(qaUrl && qaAnonKey && qaEmail && qaPassword, "QA branch read credentials are missing");
  assert(new URL(qaUrl).hostname === `${QA_BRANCH_REF}.supabase.co`, "unexpected QA branch project ref");

  const production = createClient(productionUrl, productionKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const qa = createClient(qaUrl, qaAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await qa.auth.signInWithPassword({ email: qaEmail, password: qaPassword });
  assert(!error, `QA branch authentication failed: ${error?.message}`);
  return { production, qa };
}

function dictionaryRows(rows, aliasesById = new Map(), options = {}) {
  return sortRows(rows.map((row) => ({
    canonical_id: row.id,
    name: text(row.name_ru) ?? text(row.name_en) ?? text(row.name) ?? text(row.canonical_name) ?? text(row.code) ?? text(row.slug),
    name_ru: text(row.name_ru),
    name_en: text(row.name_en),
    aliases: uniqueBy(
      [...namesOf(row), ...(aliasesById.get(row.id) ?? []).map((alias) => alias.alias)]
        .filter(Boolean)
        .map((alias) => ({ alias })),
      (item) => normalized(item.alias),
    ).map((item) => item.alias).sort((a, b) => a.localeCompare(b, "ru")),
    active: boolActive(row),
    source_table: options.sourceTable,
    raw: row,
  })), ["canonical_id"]);
}

function codeDictionary(values, sourceField) {
  return [...new Set(values.map(text).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((value) => ({
      canonical_id: value,
      name: value,
      name_ru: null,
      name_en: null,
      aliases: [],
      active: true,
      source_table: null,
      source_field: sourceField,
      raw: null,
    }));
}

async function readSnapshot() {
  const { production, qa } = await createClients();

  const [
    products,
    productAliases,
    manufacturers,
    formulations,
    components,
    componentAliases,
    componentSources,
    productComponents,
    crops,
    varieties,
    diseases,
    diseaseAliases,
    pests,
    pestAliases,
    weeds,
    weedAliases,
    legacyUsageRules,
    legacyPesticideUsageRules,
  ] = await Promise.all([
    fetchAll(production, "products", (query) => query.is("company_id", null).eq("product_type", "pesticide")),
    fetchAll(production, "global_product_aliases"),
    fetchAll(production, "agrochem_manufacturers"),
    fetchAll(production, "agrochem_formulations"),
    fetchAll(production, "glbd_components"),
    fetchAll(production, "glbd_component_aliases"),
    fetchAll(production, "glbd_component_sources"),
    fetchAll(production, "glbd_product_components"),
    fetchAll(production, "crops", (query) => query.is("company_id", null)),
    fetchAll(production, "varieties", (query) => query.is("company_id", null)),
    fetchAll(production, "diseases", (query) => query.is("company_id", null)),
    fetchAll(production, "disease_aliases"),
    fetchAll(production, "pests", (query) => query.is("company_id", null)),
    fetchAll(production, "pest_aliases"),
    fetchAll(production, "weeds", (query) => query.is("company_id", null)),
    fetchAll(production, "weed_aliases"),
    fetchOptional(production, "product_usage_rules"),
    fetchOptional(production, "pesticide_usage_rules"),
  ]);

  assert(products.length === EXPECTED_PRODUCTS, `expected ${EXPECTED_PRODUCTS} global pesticides, found ${products.length}`);
  assert(products.every((row) => row.company_id === null), "company-scoped product entered the export");
  assert(new Set(products.map((row) => row.id)).size === EXPECTED_PRODUCTS, "duplicate product IDs in production read");

  const productIds = new Set(products.map((row) => row.id));
  const productionData = {
    products: sortRows(products),
    productAliases: sortRows(productAliases.filter((row) => productIds.has(row.product_id))),
    manufacturers: sortRows(manufacturers),
    formulations: sortRows(formulations),
    components: sortRows(components),
    componentAliases: sortRows(componentAliases),
    componentSources: sortRows(componentSources),
    productComponents: sortRows(productComponents.filter((row) => productIds.has(row.product_id))),
    crops: sortRows(crops),
    varieties: sortRows(varieties),
    diseases: sortRows(diseases),
    diseaseAliases: sortRows(diseaseAliases),
    pests: sortRows(pests),
    pestAliases: sortRows(pestAliases),
    weeds: sortRows(weeds),
    weedAliases: sortRows(weedAliases),
    legacyUsageSources: [
      { table: "product_usage_rules", ...legacyUsageRules },
      { table: "pesticide_usage_rules", ...legacyPesticideUsageRules },
    ],
  };

  const [
    qaProducts,
    qaAliases,
    qaManufacturers,
    qaFormulations,
    qaComponents,
    qaProductComponents,
    qaProductSources,
    qaRegistrations,
    qaUsageRules,
    qaSafety,
  ] = await Promise.all([
    fetchAll(qa, "products"),
    fetchAll(qa, "global_product_aliases"),
    fetchAll(qa, "agrochem_manufacturers"),
    fetchAll(qa, "agrochem_formulations"),
    fetchAll(qa, "glbd_components"),
    fetchAll(qa, "glbd_product_components"),
    fetchAll(qa, "glbd_product_sources"),
    fetchAll(qa, "glbd_product_registrations"),
    fetchAll(qa, "glbd_product_usage_rules"),
    fetchAll(qa, "glbd_product_assistant_safety", (query) => query, "product_id"),
  ]);

  const qaProductIds = new Set([
    ...qaProductSources.map((row) => row.product_id),
    ...qaRegistrations.map((row) => row.product_id),
    ...qaUsageRules.map((row) => row.product_id),
    ...qaSafety.map((row) => row.product_id),
  ]);
  const qaComponentIds = new Set(
    qaProductComponents.filter((row) => qaProductIds.has(row.product_id)).map((row) => row.component_id),
  );
  const qaData = {
    products: sortRows(qaProducts.filter((row) => qaProductIds.has(row.id) && productIds.has(row.id))),
    aliases: sortRows(qaAliases.filter((row) => qaProductIds.has(row.product_id) && productIds.has(row.product_id))),
    manufacturers: sortRows(qaManufacturers),
    formulations: sortRows(qaFormulations),
    components: sortRows(qaComponents.filter((row) => qaComponentIds.has(row.id))),
    productComponents: sortRows(qaProductComponents.filter((row) => qaProductIds.has(row.product_id) && productIds.has(row.product_id))),
    productSources: sortRows(qaProductSources.filter((row) => productIds.has(row.product_id))),
    registrations: sortRows(qaRegistrations.filter((row) => productIds.has(row.product_id))),
    usageRules: sortRows(qaUsageRules.filter((row) => productIds.has(row.product_id))),
    safety: sortRows(qaSafety.filter((row) => productIds.has(row.product_id)), ["product_id"]),
  };

  return { production: productionData, qa: qaData };
}

function buildPackage(snapshot) {
  const prod = snapshot.production;
  const qa = snapshot.qa;
  const productById = new Map(prod.products.map((row) => [row.id, row]));
  const qaProductById = new Map(qa.products.map((row) => [row.id, row]));
  const manufacturerById = new Map([...prod.manufacturers, ...qa.manufacturers].map((row) => [row.id, row]));
  const formulationById = new Map([...prod.formulations, ...qa.formulations].map((row) => [row.id, row]));
  const componentById = new Map([...prod.components, ...qa.components].map((row) => [row.id, row]));
  const productionAliasesByProduct = groupBy(prod.productAliases, "product_id");
  const qaAliasesByProduct = groupBy(qa.aliases, "product_id");
  const productionLinksByProduct = groupBy(prod.productComponents, "product_id");
  const qaLinksByProduct = groupBy(qa.productComponents, "product_id");
  const productionSourceById = new Map(prod.componentSources.map((row) => [row.id, row]));
  const productSourcesByProduct = groupBy(qa.productSources, "product_id");
  const registrationsByProduct = groupBy(qa.registrations, "product_id");
  const qaRulesByProduct = groupBy(qa.usageRules, "product_id");
  const safetyByProduct = new Map(qa.safety.map((row) => [row.product_id, row]));

  const legacyRules = prod.legacyUsageSources.flatMap((source) => source.rows.map((row) => ({ ...row, _source_table: source.table })));
  const legacyRulesByProduct = groupBy(legacyRules.filter((row) => productById.has(row.product_id)), "product_id");

  const cards = prod.products.map((rawProduct) => {
    const qaProduct = qaProductById.get(rawProduct.id);
    const currentProduct = qaProduct ?? rawProduct;
    const aliasRows = uniqueBy(
      [...(productionAliasesByProduct.get(rawProduct.id) ?? []), ...(qaAliasesByProduct.get(rawProduct.id) ?? [])],
      (row) => `${row.product_id}:${normalized(row.normalized_alias ?? row.alias)}`,
    );
    const qaLinks = qaLinksByProduct.get(rawProduct.id) ?? [];
    const selectedLinks = qaLinks.length ? qaLinks : productionLinksByProduct.get(rawProduct.id) ?? [];
    const composition = sortRows(selectedLinks.map((link) => {
      const component = componentById.get(link.component_id) ?? null;
      const source = link.source_id ? productionSourceById.get(link.source_id) ?? null : null;
      return {
        link_id: link.id,
        component_id: link.component_id,
        component: component ? {
          canonical_name: component.canonical_name,
          name_ru: component.name_ru,
          name_en: component.name_en,
          component_type: component.component_type,
          active: boolActive(component),
        } : null,
        role: link.role_in_product,
        concentration: {
          value: link.concentration_value,
          unit: link.concentration_unit,
          text: link.concentration_text,
          equivalent_basis: link.equivalent_basis,
        },
        is_primary_active: link.is_primary_active,
        confidence: link.confidence,
        review_status: link.review_status,
        source_id: link.source_id,
        source: source ? {
          type: source.source_type,
          url: source.source_url ?? source.url,
          title: source.source_title ?? source.title,
          confidence: source.confidence,
        } : null,
        source_scope: qaLinks.length ? "qa_confirmed_full_card_v1" : "production_catalog",
        raw: link,
      };
    }), ["link_id"]);

    const registrations = sortRows(registrationsByProduct.get(rawProduct.id) ?? []);
    const usageRules = sortRows([
      ...(qaRulesByProduct.get(rawProduct.id) ?? []).map((row) => ({ ...row, source_scope: "qa_confirmed_full_card_v1" })),
      ...(legacyRulesByProduct.get(rawProduct.id) ?? []).map((row) => ({ ...row, source_scope: "production_legacy" })),
    ], ["id", "rule_key"]);
    const productSources = productSourcesByProduct.get(rawProduct.id) ?? [];
    const legacySources = [
      ["source_url", rawProduct.source_url],
      ["metadata_source_url", rawProduct.metadata_source_url],
    ].filter(([, value]) => text(value)).map(([field, value]) => ({
      source_type: "legacy_product_url",
      source_url: value,
      source_title: null,
      claim_fields: [field],
      verification_status: null,
      confidence: rawProduct.metadata_confidence ?? null,
      source_scope: "production_catalog",
    }));
    const sources = uniqueBy(
      [
        ...productSources.map((row) => ({ ...row, source_scope: "qa_confirmed_full_card_v1" })),
        ...legacySources,
        ...composition.filter((row) => row.source?.url).map((row) => ({
          source_type: row.source.type ?? "component_source",
          source_url: row.source.url,
          source_title: row.source.title,
          claim_fields: ["composition"],
          verification_status: row.review_status,
          confidence: row.source.confidence ?? row.confidence,
          source_scope: row.source_scope,
        })),
      ],
      (row) => `${normalized(row.source_url)}:${normalized(row.source_type)}:${normalized((row.claim_fields ?? []).join("|"))}`,
    );
    const restrictions = usageRules
      .filter((row) => text(row.restrictions))
      .map((row) => ({ usage_rule_id: row.id, text: row.restrictions, source_id: row.source_id }));
    for (const field of ["restrictions", "application_restrictions", "limitations", "notes"]) {
      if (text(rawProduct[field])) restrictions.push({ usage_rule_id: null, text: rawProduct[field], source_id: null, legacy_field: field });
    }

    const safety = safetyByProduct.get(rawProduct.id) ?? {
      read_allowed: null,
      recommendation_allowed: false,
      missing_critical_fields: [],
      blocked_reason: null,
      verified_at: null,
      source_scope: "not_configured",
    };
    const manufacturerRef = currentProduct.manufacturer_id ? manufacturerById.get(currentProduct.manufacturer_id) : null;
    const formulationRef = currentProduct.formulation_id ? formulationById.get(currentProduct.formulation_id) : null;
    const missing = [];
    if (!text(currentProduct.trade_name ?? currentProduct.name)) missing.push("official_trade_name");
    if (!manufacturerRef && !text(currentProduct.manufacturer)) missing.push("manufacturer");
    if (!formulationRef && !text(currentProduct.formulation ?? currentProduct.product_form)) missing.push("formulation");
    if (!composition.length) missing.push("composition");
    if (!registrations.length && !text(rawProduct.registration_status_kz)) missing.push("registrations");
    if (!usageRules.length) missing.push("usage_rules");
    if (!sources.length) missing.push("sources");

    const researchStatus = safety.read_allowed === false
      ? "BLOCKED"
      : safety.read_allowed === true && (safety.missing_critical_fields ?? []).length === 0
        ? "READ_READY"
        : safety.read_allowed === true
          ? "READ_PARTIAL"
          : missing.length
            ? "NEED_RESEARCH"
            : "NEED_OWNER_REVIEW";

    return {
      product_id: rawProduct.id,
      trade_name: text(currentProduct.trade_name ?? currentProduct.name),
      official_trade_name: text(currentProduct.trade_name ?? currentProduct.name),
      names: {
        ru: text(currentProduct.name_ru),
        en: text(currentProduct.name_en),
      },
      aliases: sortRows(aliasRows.map((row) => ({
        alias: row.alias,
        normalized_alias: row.normalized_alias,
        language: row.language ?? null,
        source: row.source ?? null,
      })), ["normalized_alias", "alias"]),
      manufacturer: {
        id: currentProduct.manufacturer_id ?? null,
        name: text(manufacturerRef?.name ?? currentProduct.manufacturer),
      },
      category: {
        product_type: currentProduct.product_type ?? null,
        category: currentProduct.category ?? null,
        pesticide_category: currentProduct.pesticide_category ?? null,
        subcategory: currentProduct.subcategory ?? currentProduct.product_subcategory ?? null,
      },
      formulation: {
        id: currentProduct.formulation_id ?? null,
        code: formulationRef?.code ?? null,
        name: text(formulationRef?.name_ru ?? currentProduct.formulation ?? currentProduct.product_form),
      },
      composition,
      registrations,
      usage_rules: usageRules,
      crops: uniqueBy(usageRules.filter((row) => row.crop_id).map((row) => ({ crop_id: row.crop_id })), (row) => row.crop_id),
      diseases: uniqueBy(usageRules.filter((row) => row.disease_id).map((row) => ({ disease_id: row.disease_id })), (row) => row.disease_id),
      pests: uniqueBy(usageRules.filter((row) => row.pest_id).map((row) => ({ pest_id: row.pest_id })), (row) => row.pest_id),
      weeds: uniqueBy(usageRules.filter((row) => row.weed_id).map((row) => ({ weed_id: row.weed_id })), (row) => row.weed_id),
      restrictions,
      sources,
      assistant_safety: safety,
      research_status: researchStatus,
      research_notes: null,
      current_completeness: {
        complete: missing.length === 0,
        missing_fields: missing,
        known_fields: ["official_trade_name", "manufacturer", "formulation", "composition", "registrations", "usage_rules", "sources"].filter((field) => !missing.includes(field)),
      },
      raw_legacy_values: rawProduct,
      normalized_values_source: qaProduct ? "qa_confirmed_full_card_v1" : "production_catalog",
    };
  });

  const componentAliasesById = groupBy(prod.componentAliases, "component_id");
  const diseaseAliasesById = groupBy(prod.diseaseAliases, "disease_id");
  const pestAliasesById = groupBy(prod.pestAliases, "pest_id");
  const weedAliasesById = groupBy(prod.weedAliases, "weed_id");
  const concentrationUnits = cards.flatMap((card) => card.composition.map((row) => row.concentration.unit));
  const usageUnits = cards.flatMap((card) => card.usage_rules.flatMap((row) => [row.rate_unit, row.working_fluid_unit]));
  const applicationMethods = cards.flatMap((card) => card.usage_rules.map((row) => row.application_method));

  const dictionaries = {
    schema_version: "full-pesticide-card-v1-research-export",
    manufacturers: dictionaryRows(prod.manufacturers, new Map(), { sourceTable: "agrochem_manufacturers" }),
    formulations: dictionaryRows(prod.formulations, new Map(), { sourceTable: "agrochem_formulations" }),
    components: dictionaryRows(prod.components, componentAliasesById, { sourceTable: "glbd_components" }),
    crops: dictionaryRows(prod.crops, new Map(), { sourceTable: "crops" }),
    varieties: dictionaryRows(prod.varieties, new Map(), { sourceTable: "varieties" }),
    diseases: dictionaryRows(prod.diseases, diseaseAliasesById, { sourceTable: "diseases" }),
    pests: dictionaryRows(prod.pests, pestAliasesById, { sourceTable: "pests" }),
    weeds: dictionaryRows(prod.weeds, weedAliasesById, { sourceTable: "weeds" }),
    units: codeDictionary([...concentrationUnits, ...usageUnits], "glbd_product_components.concentration_unit / usage rule units"),
    application_methods: codeDictionary(applicationMethods, "glbd_product_usage_rules.application_method"),
  };

  const productSourceRows = cards.flatMap((card) => card.sources.map((source) => ({ product_id: card.product_id, ...source })));
  const existingSources = {
    schema_version: "full-pesticide-card-v1-research-export",
    product_sources: sortRows(productSourceRows, ["product_id", "source_url", "source_type"]),
    component_sources: prod.componentSources,
    source_counts: {
      product_sources: productSourceRows.length,
      component_sources: prod.componentSources.length,
      products_with_any_source: cards.filter((card) => card.sources.length).length,
    },
  };

  const importContract = {
    contract: "Full Pesticide Card V1 research return",
    version: 1,
    scope: "global pesticide cards only",
    root: {
      type: "object",
      required: ["schema_version", "cards"],
      cards: {
        type: "array",
        item_required: ["product_id", "official_trade_name", "composition", "registrations", "usage_rules", "restrictions", "sources", "assistant_safety", "research_status", "research_notes"],
      },
    },
    required_fields: {
      product: ["product_id", "official_trade_name", "research_status"],
      composition: ["component_id", "role", "concentration.value", "concentration.unit", "source_id"],
      source: ["source_type", "source_url", "claim_fields", "verification_status"],
      registration: ["country_code", "registration_number", "registration_status", "source_id"],
      usage_rule: ["product_id", "crop_id", "target_type", "rate_min", "rate_max", "rate_unit", "application_method", "source_id"],
    },
    nullable_fields: [
      "names.ru", "names.en", "manufacturer.id", "manufacturer.name", "formulation.id", "formulation.code", "formulation.name",
      "composition[].concentration.value", "composition[].concentration.unit", "composition[].concentration.text", "composition[].concentration.equivalent_basis",
      "registrations[].valid_from", "registrations[].valid_until", "registrations[].registrant",
      "usage_rules[].variety_id", "usage_rules[].disease_id", "usage_rules[].pest_id", "usage_rules[].weed_id", "usage_rules[].target_text",
      "usage_rules[].working_fluid_min", "usage_rules[].working_fluid_max", "usage_rules[].working_fluid_unit",
      "usage_rules[].crop_stage", "usage_rules[].target_stage", "usage_rules[].timing_condition", "usage_rules[].max_treatments",
      "usage_rules[].harvest_interval_days", "usage_rules[].reentry_hours", "usage_rules[].restrictions", "usage_rules[].notes", "research_notes",
    ],
    enums: {
      component_role: ["active", "safener", "biological_agent", "formulation_component", "unknown"],
      source_type: ["official_label", "official_registry", "manufacturer_site", "official_distributor"],
      source_verification_status: ["verified", "conflict", "expired", "blocked"],
      registration_status: ["active", "expired", "suspended", "cancelled", "unknown"],
      usage_target_type: ["disease", "pest", "weed", "desiccation", "growth_regulation", "other"],
      research_status: ["READY_FOR_IMPORT", "NEED_OWNER_REVIEW", "BLOCKED", "READ_READY", "READ_PARTIAL", "NEED_RESEARCH"],
    },
    allowed_units: dictionaries.units.map((row) => row.canonical_id),
    application_methods: dictionaries.application_methods.map((row) => row.canonical_id),
    deduplication: {
      product: "exact existing product_id; never create a product from trade_name",
      alias: "product_id + NFKC/lowercase/trimmed alias; global collisions require NEED_OWNER_REVIEW",
      component: "exact component_id from canonical_reference_dictionaries.json",
      source: "product_id + normalized https URL + source_type",
      registration: "product_id + country_code + registration_number",
      usage_rule: "stable rule_key plus exact product_id/crop_id/target identity/rate/application method",
    },
    usage_rule_product_link: "Every usage rule must carry the existing product_id and an existing canonical crop_id. Exactly one disease_id, pest_id, weed_id or non-empty target_text must match target_type.",
    source_format: {
      url: "absolute HTTPS URL",
      claim_fields: "non-empty array of fields supported by this source",
      checked_on: "ISO date YYYY-MM-DD",
      confidence: "number from 0 to 1",
    },
    review_rules: {
      BLOCKED: "Use when identity or source evidence is insufficient. Importer must make no catalog mutation.",
      NEED_OWNER_REVIEW: "Use for conflicts, ambiguous aliases, new units, unknown canonical IDs or contradictory sources.",
      READY_FOR_IMPORT: "Allowed only when required fields use existing canonical IDs and every changed claim is source-backed.",
    },
    prohibitions: [
      "Do not auto-create manufacturers, formulations, components, crops, varieties, diseases, pests, weeds, units or application methods.",
      "Do not replace raw_legacy_values; normalized values are a separate proposal surface.",
      "Do not guess missing values or combine multiple component concentrations into one record.",
      "Do not import company-scoped products or business data.",
      "No returned package is apply-approved without owner review, backup and live preflight.",
    ],
  };

  const researchPack = {
    schema_version: "full-pesticide-card-v1-research-export",
    task: TASK,
    source: {
      production_project_ref: PRODUCTION_REF,
      qa_detail_branch_ref: QA_BRANCH_REF,
      production_scope: "global pesticide reference rows only",
      qa_scope: "existing source-backed Full Card V1 pilot details only",
      company_data_included: false,
    },
    counts: {
      products: cards.length,
      unique_product_ids: new Set(cards.map((card) => card.product_id)).size,
      company_products: cards.filter((card) => card.raw_legacy_values.company_id !== null).length,
      aliases: cards.reduce((sum, card) => sum + card.aliases.length, 0),
      composition_rows: cards.reduce((sum, card) => sum + card.composition.length, 0),
      registrations: cards.reduce((sum, card) => sum + card.registrations.length, 0),
      usage_rules: cards.reduce((sum, card) => sum + card.usage_rules.length, 0),
      qa_confirmed_cards: cards.filter((card) => card.normalized_values_source === "qa_confirmed_full_card_v1").length,
    },
    cards,
  };

  return { researchPack, dictionaries, existingSources, importContract };
}

function packageFingerprint(packageData) {
  return sha256(stableJson(packageData, 0));
}

async function main() {
  const first = buildPackage(await readSnapshot());
  const second = buildPackage(await readSnapshot());
  const firstFingerprint = packageFingerprint(first);
  const secondFingerprint = packageFingerprint(second);
  assert(firstFingerprint === secondFingerprint, "second read produced a different export fingerprint");

  const cards = first.researchPack.cards;
  const uniqueProductIds = new Set(cards.map((card) => card.product_id));
  const duplicateRows = cards.length - uniqueProductIds.size;
  const companyProducts = cards.filter((card) => card.raw_legacy_values.company_id !== null).length;
  const brokenUnicode = uniqueBy(
    collectStrings(first).filter(hasBrokenUnicode).map((value) => ({ value })),
    (row) => row.value,
  );
  const rawPreserved = cards.every((card) => card.raw_legacy_values?.id === card.product_id);
  const separateNormalized = cards.every((card) => card.raw_legacy_values !== card && "normalized_values_source" in card);
  const concentrationsSeparated = cards.every((card) => card.composition.every((row) => (
    row.concentration && !Array.isArray(row.concentration.value) && !Array.isArray(row.concentration.unit)
  )));

  assert(cards.length === EXPECTED_PRODUCTS, `export has ${cards.length} cards`);
  assert(uniqueProductIds.size === EXPECTED_PRODUCTS, `export has ${uniqueProductIds.size} unique IDs`);
  assert(duplicateRows === 0, `export has ${duplicateRows} duplicate rows`);
  assert(companyProducts === 0, `export has ${companyProducts} company products`);
  assert(brokenUnicode.length === 0, `export contains ${brokenUnicode.length} broken Unicode values`);
  assert(rawPreserved, "raw legacy values were not preserved for every card");
  assert(separateNormalized, "normalized values are not separated from raw values");
  assert(concentrationsSeparated, "a composition entry combines concentrations or units");

  const validation = {
    task: TASK,
    status: "PASS",
    expected_products: EXPECTED_PRODUCTS,
    products: cards.length,
    unique_product_ids: uniqueProductIds.size,
    duplicate_export_rows: duplicateRows,
    company_products: companyProducts,
    company_data_exported: 0,
    broken_unicode_values: brokenUnicode,
    raw_values_preserved: rawPreserved,
    normalized_values_separate_from_raw: separateNormalized,
    composition_concentrations_separate: concentrationsSeparated,
    second_export_fingerprint_match: true,
    export_fingerprint_sha256: firstFingerprint,
    production_write_operations: 0,
    qa_write_operations: 0,
    source_table_presence: Object.fromEntries(first.researchPack.source ? snapshotSourcePresence(first) : []),
  };

  const contents = new Map([
    ["pesticide_full_research_pack.json", stableJson(first.researchPack)],
    ["pesticide_full_research_pack.csv", toCsv(cards)],
    ["canonical_reference_dictionaries.json", stableJson(first.dictionaries)],
    ["existing_sources.json", stableJson(first.existingSources)],
    ["import_contract.json", stableJson(first.importContract)],
    ["export_validation.json", stableJson(validation)],
  ]);

  await mkdir(outputDir, { recursive: true });
  for (const name of outputFiles) await writeFile(path.join(outputDir, name), contents.get(name), "utf8");
  const manifest = outputFiles
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((name) => `${sha256(contents.get(name))}  ${name}`)
    .join("\n");
  await writeFile(path.join(outputDir, "manifest.sha256"), `${manifest}\n`, "utf8");

  for (const line of manifest.split("\n")) {
    const [expected, name] = line.split(/\s{2}/);
    assert(sha256(await readFile(path.join(outputDir, name))) === expected, `manifest mismatch for ${name}`);
  }

  console.log(JSON.stringify({
    task: TASK,
    output_dir: outputDir,
    products: cards.length,
    unique_product_ids: uniqueProductIds.size,
    duplicate_rows: duplicateRows,
    company_products: companyProducts,
    broken_unicode_values: brokenUnicode.length,
    qa_confirmed_cards: first.researchPack.counts.qa_confirmed_cards,
    second_export_fingerprint_match: true,
    fingerprint: firstFingerprint,
  }, null, 2));
}

function snapshotSourcePresence(packageData) {
  return [
    ["production_global_catalog", packageData.researchPack.counts.products === EXPECTED_PRODUCTS],
    ["qa_confirmed_full_card_v1", packageData.researchPack.counts.qa_confirmed_cards > 0],
  ];
}

await main();
