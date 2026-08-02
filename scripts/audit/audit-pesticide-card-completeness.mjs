import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  buildCatalogIdentityKey,
  buildProductDisplayLabel,
  matchCatalogSearch,
  normalizeCatalogName,
  stripManufacturerPrefixCandidate,
} from "../../lib/catalog/catalog-identity.ts";
import {
  buildGlbdComponentSearchEntries,
  glbdComponentMatchesSearch,
  isVisibleGlbdComponent,
} from "../../lib/glbd/component-discovery.ts";

const PROJECT_REF = "bhsemlvmkikpntabctml";
const EXPECTED_GLBD = { components: 431, aliases: 63, sources: 318, links: 1373, companyLinks: 0 };
const ISSUE_FLAGS = [
  "MISSING_COMPONENT",
  "COMPONENT_SOURCE_GAP",
  "COMPONENT_ROLE_CONFLICT",
  "SAFENER_MODEL_GAP",
  "BIOLOGICAL_MODEL_GAP",
  "MISSING_FORMULATION",
  "FORMULATION_CONFLICT",
  "MISSING_MANUFACTURER",
  "MANUFACTURER_IN_TRADE_NAME",
  "MISSING_RU_ALIAS",
  "MISSING_EN_ALIAS",
  "IDENTITY_DUPLICATE",
  "COMPANY_GLOBAL_CONFLICT",
  "SOURCE_GAP",
  "REGULATORY_GAP",
  "USAGE_RULE_GAP",
  "SEARCH_FAILURE",
  "MOJIBAKE",
  "NEED_OWNER_REVIEW",
];
const READINESS = [
  "READY_COMPLETE",
  "READY_WITH_MINOR_GAPS",
  "BLOCKED_COMPONENT",
  "BLOCKED_IDENTITY",
  "BLOCKED_FORMULATION",
  "BLOCKED_SOURCE",
  "NEED_OWNER_REVIEW",
];
const VALID_ROLE_BY_TYPE = {
  active_ingredient: "active",
  safener: "safener",
  synergist: "synergist",
  biological_component: "biological_agent",
  formulation_component: "formulation_component",
};
const TECHNICAL_EMPTY = new Set(["", "-", "unknown", "n/a", "na", "none", "null", "неизвестно", "не указано"]);
const MOJIBAKE_PATTERNS = [
  /\uFFFD/u,
  /\u00C2/u,
  /\u00C3/u,
  /\u00D0/u,
  /\u00D1/u,
  /\u0420[\u0080-\u00BF]/u,
  /\u0421[\u0080-\u00BF]/u,
];
const FORM_CODES = new Map([
  ["EC", "EC"], ["\u041a\u042d", "EC"],
  ["SC", "SC"], ["\u041a\u0421", "SC"],
  ["WG", "WG"], ["\u0412\u0414\u0413", "WG"],
  ["SL", "SL"], ["\u0412\u0420", "SL"], ["\u0412\u0420\u041a", "SL"],
  ["FS", "FS"], ["\u0424\u0421", "FS"],
  ["CS", "CS"], ["\u041c\u041a\u0421", "CS"], ["\u0421\u041a", "CS"],
]);
const repoRoot = process.cwd();
const outputDir = path.resolve(repoRoot, "..", "..", "audit-output", "TZ-180");

nextEnv.loadEnvConfig(repoRoot);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Required production read credentials are unavailable");
if (!supabaseUrl.includes(PROJECT_REF)) throw new Error("STOP: wrong Supabase project");

const client = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "x-travkin-audit": "TZ-180-read-only" } },
});

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLocaleLowerCase("en");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const unique = (values) => Array.from(new Set(values.filter(Boolean)));
const isTechnicalEmpty = (value) => TECHNICAL_EMPTY.has(lower(value));
const hasCyrillic = (value) => /[\u0400-\u04FF]/u.test(text(value));
const hasLatin = (value) => /[A-Za-z]/u.test(text(value));
const hasMojibake = (value) => MOJIBAKE_PATTERNS.some((pattern) => pattern.test(text(value)));
const validUrl = (value) => {
  const raw = text(value);
  if (!raw || /localhost|example\.|placeholder|temporary|\/tmp\//iu.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

async function fetchAll(table, select = "*", apply = (query) => query) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(select).order("id", { ascending: true }).range(from, from + pageSize - 1);
    query = apply(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = key(row);
    const list = result.get(value) || [];
    list.push(row);
    result.set(value, list);
  }
  return result;
}

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function formulationCode(value) {
  const raw = text(value).normalize("NFKC").toUpperCase().replace(/[.,;()]/gu, " ");
  for (const token of raw.split(/\s+/u).filter(Boolean)) {
    if (FORM_CODES.has(token)) return FORM_CODES.get(token);
  }
  return null;
}

function isUsableFormulation(value) {
  return !isTechnicalEmpty(value);
}

function shortenTradeName(value) {
  const raw = text(value);
  const shortened = raw.replace(/,\s*(?:[A-Z]{1,5}|[\u0410-\u042f\u0401]{1,5})\s*$/u, "").trim();
  if (shortened === raw || normalizeCatalogName(shortened).length < 3) return null;
  return shortened;
}

function csvValue(value) {
  if (Array.isArray(value)) return csvValue(value.join("; "));
  if (value && typeof value === "object") return csvValue(JSON.stringify(value));
  const raw = value == null ? "" : String(value);
  return `"${raw.replaceAll('"', '""')}"`;
}

function toCsv(rows, columns) {
  const header = columns.map(csvValue).join(",");
  const body = rows.map((row) => columns.map((column) => csvValue(row[column])).join(","));
  return `${[header, ...body].join("\n")}\n`;
}

function addFlag(flags, flag) {
  if (!ISSUE_FLAGS.includes(flag)) throw new Error(`Unknown issue flag: ${flag}`);
  flags.add(flag);
}

function resolveRecommendedAction(flags, status) {
  if (status === "READY_COMPLETE") return "NO_CHANGE";
  if (status === "BLOCKED_COMPONENT") return "SOURCE_RESEARCH_AND_COMPONENT_REVIEW";
  if (status === "BLOCKED_IDENTITY") return "OWNER_REVIEW_IDENTITY_BEFORE_MERGE";
  if (status === "BLOCKED_FORMULATION") return "SOURCE_BACKED_FORMULATION_REVIEW";
  if (status === "BLOCKED_SOURCE") return "ADD_VERIFIED_PRODUCT_AND_COMPOSITION_SOURCE";
  if (status === "NEED_OWNER_REVIEW") return "OWNER_DECISION_REQUIRED";
  const actions = [];
  if (flags.has("MISSING_MANUFACTURER")) actions.push("RESEARCH_MANUFACTURER");
  if (flags.has("MISSING_RU_ALIAS")) actions.push("ADD_VERIFIED_RU_ALIAS");
  if (flags.has("MISSING_EN_ALIAS")) actions.push("ADD_VERIFIED_EN_ALIAS");
  if (flags.has("COMPONENT_SOURCE_GAP")) actions.push("LINK_COMPONENT_SOURCES");
  if (flags.has("SOURCE_GAP")) actions.push("COMPLETE_SOURCE_METADATA");
  if (flags.has("REGULATORY_GAP")) actions.push("COMPLETE_REGULATORY_DATA");
  if (flags.has("USAGE_RULE_GAP")) actions.push("COMPLETE_USAGE_RULES");
  return actions.length ? unique(actions).join("+") : "REVIEW_MINOR_GAPS";
}

function classify(flags, explicitOwnerReview, noUsableSource) {
  if (explicitOwnerReview || flags.has("NEED_OWNER_REVIEW") || flags.has("MOJIBAKE")) return "NEED_OWNER_REVIEW";
  if (flags.has("IDENTITY_DUPLICATE") || flags.has("MANUFACTURER_IN_TRADE_NAME") || flags.has("COMPANY_GLOBAL_CONFLICT")) return "BLOCKED_IDENTITY";
  if (flags.has("MISSING_COMPONENT") || flags.has("COMPONENT_ROLE_CONFLICT") || flags.has("SAFENER_MODEL_GAP") || flags.has("BIOLOGICAL_MODEL_GAP")) return "BLOCKED_COMPONENT";
  if (flags.has("MISSING_FORMULATION") || flags.has("FORMULATION_CONFLICT")) return "BLOCKED_FORMULATION";
  if (noUsableSource) return "BLOCKED_SOURCE";
  return flags.size ? "READY_WITH_MINOR_GAPS" : "READY_COMPLETE";
}

function assignBatch(flags) {
  const batch1 = ["MISSING_COMPONENT", "COMPONENT_ROLE_CONFLICT", "IDENTITY_DUPLICATE", "MANUFACTURER_IN_TRADE_NAME", "SEARCH_FAILURE"];
  const batch2 = ["MISSING_FORMULATION", "FORMULATION_CONFLICT", "SAFENER_MODEL_GAP", "BIOLOGICAL_MODEL_GAP", "COMPANY_GLOBAL_CONFLICT"];
  if (batch1.some((flag) => flags.has(flag))) return "BATCH_1_P0";
  if (batch2.some((flag) => flags.has(flag))) return "BATCH_2_P1";
  return flags.size ? "BATCH_3_P2" : "NONE";
}

const [
  allGlobalProducts,
  companyProducts,
  productAliases,
  manufacturers,
  formulations,
  components,
  componentAliases,
  componentSources,
  productComponents,
] = await Promise.all([
  fetchAll("products", "*", (query) => query.is("company_id", null).eq("archived", false)),
  fetchAll(
    "products",
    "id,company_id,master_product_id,name,trade_name,normalized_name,manufacturer,product_type,type,category,archived,is_active",
    (query) => query.not("company_id", "is", null).eq("archived", false),
  ),
  fetchAll("global_product_aliases"),
  fetchAll("agrochem_manufacturers"),
  fetchAll("agrochem_formulations"),
  fetchAll("glbd_components"),
  fetchAll("glbd_component_aliases"),
  fetchAll("glbd_component_sources"),
  fetchAll("glbd_product_components"),
]);

const products = allGlobalProducts
  .filter((product) => product.product_type === "pesticide")
  .sort((left, right) => left.id.localeCompare(right.id));
const productIds = new Set(products.map((product) => product.id));
const productById = new Map(products.map((product) => [product.id, product]));
const manufacturerById = new Map(manufacturers.map((row) => [row.id, row]));
const formulationById = new Map(formulations.map((row) => [row.id, row]));
const componentById = new Map(components.map((row) => [row.id, row]));
const aliasesByProduct = groupBy(productAliases.filter((row) => productIds.has(row.product_id)), (row) => row.product_id);
const linksByProduct = groupBy(productComponents.filter((row) => productIds.has(row.product_id) && !["archived", "rejected"].includes(row.review_status)), (row) => row.product_id);
const sourcesByComponent = groupBy(componentSources, (row) => row.component_id);
const componentSearchEntries = buildGlbdComponentSearchEntries(components, componentAliases);
const componentSearchById = new Map(componentSearchEntries.map((row) => [row.id, row]));

const productCompanyById = new Map(allGlobalProducts.map((row) => [row.id, row.company_id]));
const glbdCounts = {
  components: components.length,
  aliases: componentAliases.length,
  sources: componentSources.length,
  links: productComponents.length,
  companyLinks: productComponents.filter((link) => productCompanyById.get(link.product_id) != null).length,
};
for (const [key, expected] of Object.entries(EXPECTED_GLBD)) {
  if (glbdCounts[key] !== expected) throw new Error(`STOP: ${key} expected ${expected}, found ${glbdCounts[key]}`);
}

const activeComponentGroups = groupBy(
  components.filter((row) => row.is_active && !row.archived_at),
  (row) => lower(row.normalized_key),
);
const componentDuplicateGroups = Array.from(activeComponentGroups.values()).filter((rows) => rows.length > 1);
if (componentDuplicateGroups.length) throw new Error(`STOP: duplicate active components ${componentDuplicateGroups.length}`);

const identityGroups = groupBy(products, (product) => buildCatalogIdentityKey(product));
const identityDuplicateIds = new Set(
  Array.from(identityGroups.values()).filter((rows) => rows.length > 1).flatMap((rows) => rows.map((row) => row.id)),
);
const companyConflictIds = new Set();
const globalByLooseIdentity = groupBy(products, (product) => buildCatalogIdentityKey(product, { includeManufacturer: false }));
for (const companyProduct of companyProducts) {
  if (companyProduct.product_type !== "pesticide" && companyProduct.type !== "pesticide") continue;
  const key = buildCatalogIdentityKey(companyProduct, { includeManufacturer: false });
  const candidates = globalByLooseIdentity.get(key) || [];
  const master = companyProduct.master_product_id ? productById.get(companyProduct.master_product_id) : null;
  if (master && buildCatalogIdentityKey(master, { includeManufacturer: false }) !== key) companyConflictIds.add(master.id);
  for (const candidate of candidates) {
    if (companyProduct.master_product_id !== candidate.id) companyConflictIds.add(candidate.id);
  }
}

function linkedComponents(productId) {
  return (linksByProduct.get(productId) || []).map((link) => ({ link, component: componentById.get(link.component_id) || null }));
}

const linkedComponentsByProduct = new Map(products.map((product) => [product.id, linkedComponents(product.id)]));
const strippedIdentityByProduct = new Map(products.map((product) => [product.id, stripManufacturerPrefixCandidate(product)]));

function searchMatchesProduct(product, query) {
  if (matchCatalogSearch(product, query)) return true;
  return (linkedComponentsByProduct.get(product.id) || []).some(({ component }) => {
    const entry = component ? componentSearchById.get(component.id) : null;
    return entry && isVisibleGlbdComponent(entry) && glbdComponentMatchesSearch(entry, query);
  });
}

const searchTests = [];
function addSearchTest(scope, kind, query, expectedProduct) {
  if (!text(query) || !expectedProduct) return;
  const passed = searchMatchesProduct(expectedProduct, query);
  // Per-card acceptance uses the real catalog helper. Full-catalog matching is
  // reserved for the small known-case suite below so this audit stays bounded.
  const matched = passed ? [expectedProduct] : [];
  searchTests.push({
    scope,
    kind,
    query: text(query),
    expected_product_id: expectedProduct.id,
    expected_trade_name: text(expectedProduct.trade_name || expectedProduct.name),
    passed,
    matched_product_ids: matched.map((row) => row.id).join(";"),
    matched_labels: matched.map((row) => buildProductDisplayLabel(row)).join("; "),
  });
}

const extendedSearchSampleIds = new Set();
function addExtendedSearchCandidates(candidates, limit) {
  if (limit <= 0) return;
  let added = 0;
  for (const product of candidates) {
    if (extendedSearchSampleIds.has(product.id)) continue;
    extendedSearchSampleIds.add(product.id);
    added += 1;
    if (added >= limit) break;
  }
}

addExtendedSearchCandidates(products.filter((product) => (aliasesByProduct.get(product.id) || []).length > 0), 40);
addExtendedSearchCandidates(products.filter((product) => strippedIdentityByProduct.get(product.id)?.isCandidate), 30);
addExtendedSearchCandidates(products.filter((product) => (linkedComponentsByProduct.get(product.id) || []).length > 1), 35);
addExtendedSearchCandidates(products.filter((product) => /[\u0400-\u04ff]/u.test(text(product.name_ru || product.trade_name || product.name))), 30);
addExtendedSearchCandidates(products.filter((product) => /^[\x00-\x7f]+$/u.test(text(product.name_en || product.trade_name || product.name))), 30);
addExtendedSearchCandidates(products, Math.max(0, 120 - extendedSearchSampleIds.size));

for (const product of products) {
  const official = text(product.trade_name || product.name);
  addSearchTest("pesticide", "trade_name", official, product);
  if (!extendedSearchSampleIds.has(product.id)) continue;
  if (text(product.name_ru) && normalizeCatalogName(product.name_ru) !== normalizeCatalogName(official)) addSearchTest("pesticide", "ru_name", product.name_ru, product);
  if (text(product.name_en) && normalizeCatalogName(product.name_en) !== normalizeCatalogName(official)) addSearchTest("pesticide", "en_name", product.name_en, product);
  for (const alias of aliasesByProduct.get(product.id) || []) addSearchTest("pesticide", "database_alias", alias.alias, product);
  const shortened = shortenTradeName(official);
  if (shortened) addSearchTest("pesticide", "short_name", shortened, product);
  const stripped = strippedIdentityByProduct.get(product.id);
  if (stripped.isCandidate) addSearchTest("pesticide", "manufacturer_prefixed_legacy", stripped.originalName, product);
  const linked = linkedComponentsByProduct.get(product.id) || [];
  if (linked.length > 1) {
    const searchable = linked.map(({ component }) => component).find((component) => component && isVisibleGlbdComponent(componentSearchById.get(component.id)));
    if (searchable) addSearchTest("pesticide", "multi_component", searchable.name_ru || searchable.name_en || searchable.canonical_name, product);
  }
}

const specialDefinitions = [
  { query: "Curamin", expected: "Curamin Foliar" },
  { query: "\u041a\u0443\u0440\u0430\u043c\u0438\u043d", expected: "Curamin Foliar" },
  { query: "\u0424\u043e\u043b\u0438\u0430\u0440", expected: "Curamin Foliar" },
  { query: "Phomazin", expected: "Phomazin" },
  { query: "\u0424\u043e\u043c\u0430\u0437\u0438\u043d", expected: "Phomazin" },
];
function specialIdentityKey(value) {
  return text(value).toLowerCase().replace(/\u0451/gu, "\u0435").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const specialIdentityGroups = {
  "Curamin Foliar": new Set(["curamin foliar", "\u043a\u0443\u0440\u0430\u043c\u0438\u043d \u0444\u043e\u043b\u0438\u0430\u0440"]),
  Phomazin: new Set(["phomazin", "swissgrow phomazin", "\u0444\u043e\u043c\u0430\u0437\u0438\u043d"]),
};
const specialCases = [];
for (const definition of specialDefinitions) {
  const expectedKeys = specialIdentityGroups[definition.expected];
  const candidates = allGlobalProducts.filter((product) => expectedKeys.has(specialIdentityKey(product.trade_name || product.name)));
  const matched = candidates.filter((product) => searchMatchesProduct(product, definition.query));
  const matchingCanonical = matched.filter((product) => expectedKeys.has(specialIdentityKey(product.trade_name || product.name)));
  specialCases.push({
    query: definition.query,
    expected: definition.expected,
    passed: matchingCanonical.length > 0,
    matched_product_ids: matched.map((row) => row.id),
    matched_labels: matched.map((row) => buildProductDisplayLabel(row)),
    matched_product_types: unique(matched.map((row) => row.product_type)),
    pesticide_scope_matches: matched.filter((row) => row.product_type === "pesticide").length,
    note: "Known Curamin/Phomazin records are currently fertilizer-scope and excluded from pesticide readiness counts.",
  });
}

const failedTestsByProduct = groupBy(searchTests.filter((test) => !test.passed && test.scope === "pesticide"), (test) => test.expected_product_id);
const mojibakeValues = unique(collectStrings({ products, productAliases, components, componentAliases, componentSources, productComponents }).filter(hasMojibake)).sort();
const auditRows = [];

for (const product of products) {
  const flags = new Set();
  const aliases = aliasesByProduct.get(product.id) || [];
  const linked = linkedComponentsByProduct.get(product.id) || [];
  const manufacturerRef = product.manufacturer_id ? manufacturerById.get(product.manufacturer_id) : null;
  const manufacturer = text(manufacturerRef?.name || product.manufacturer);
  const usableManufacturer = !isTechnicalEmpty(manufacturer);
  const formulationRef = product.formulation_id ? formulationById.get(product.formulation_id) : null;
  const rawForms = [product.formulation, product.product_form].filter(isUsableFormulation);
  const structuredForm = formulationRef && formulationRef.is_active && !formulationRef.archived ? formulationRef : null;
  const knownFormCodes = unique([
    structuredForm?.code ? formulationCode(structuredForm.code) || text(structuredForm.code).toUpperCase() : null,
    ...rawForms.map(formulationCode),
  ]);
  const formulation = structuredForm
    ? `${text(structuredForm.code)}${text(structuredForm.name_ru) ? ` / ${text(structuredForm.name_ru)}` : ""}`
    : text(rawForms[0]);
  const officialName = text(product.trade_name || product.name);
  const stripped = strippedIdentityByProduct.get(product.id);
  const identityDuplicate = identityDuplicateIds.has(product.id);
  const companyConflict = companyConflictIds.has(product.id);
  const productSourceValues = unique([product.metadata_source_url, product.source_url].map(text));
  const validProductSources = productSourceValues.filter(validUrl);
  const linkSourceIds = unique(linked.map(({ link }) => link.source_id));
  const componentCatalogSourceIds = unique(linked.flatMap(({ component }) => component ? (sourcesByComponent.get(component.id) || []).map((source) => source.id) : []));
  const concentrationProblems = linked.filter(({ link }) => {
    const pairMismatch = (link.concentration_value == null) !== (link.concentration_unit == null);
    const negative = link.concentration_value != null && Number(link.concentration_value) < 0;
    return pairMismatch || negative || hasMojibake(link.concentration_text) || hasMojibake(link.concentration_unit);
  });

  if (!linked.length || linked.some(({ component }) => !component)) addFlag(flags, "MISSING_COMPONENT");
  if (linked.some(({ link }) => !link.source_id)) addFlag(flags, "COMPONENT_SOURCE_GAP");
  const roleConflicts = linked.filter(({ link, component }) => {
    if (!component) return true;
    if (component.component_type === "unknown_component") return !(link.role_in_product === "active" && ["draft", "needs_source", "needs_owner_review"].includes(link.review_status));
    return VALID_ROLE_BY_TYPE[component.component_type] !== link.role_in_product;
  });
  if (roleConflicts.length) addFlag(flags, "COMPONENT_ROLE_CONFLICT");
  if (linked.some(({ link, component }) => component?.component_type === "safener" && link.role_in_product !== "safener")) addFlag(flags, "SAFENER_MODEL_GAP");
  if (linked.some(({ link, component }) => component?.component_type === "biological_component" && link.role_in_product !== "biological_agent")) addFlag(flags, "BIOLOGICAL_MODEL_GAP");
  if (!structuredForm && !rawForms.length) addFlag(flags, "MISSING_FORMULATION");
  if ((product.formulation_id && !structuredForm) || knownFormCodes.length > 1) addFlag(flags, "FORMULATION_CONFLICT");
  if (!usableManufacturer) addFlag(flags, "MISSING_MANUFACTURER");
  if (stripped.isCandidate) addFlag(flags, "MANUFACTURER_IN_TRADE_NAME");

  const languageValues = [officialName, product.name_ru, product.name_en, ...aliases.map((alias) => alias.alias)];
  if (hasLatin(officialName) && !languageValues.some(hasCyrillic)) addFlag(flags, "MISSING_RU_ALIAS");
  if (hasCyrillic(officialName) && !languageValues.some(hasLatin)) addFlag(flags, "MISSING_EN_ALIAS");
  if (identityDuplicate) addFlag(flags, "IDENTITY_DUPLICATE");
  if (companyConflict) addFlag(flags, "COMPANY_GLOBAL_CONFLICT");

  const sourceConfidence = text(product.metadata_confidence);
  const sourceGap = !validProductSources.length || !sourceConfidence || productSourceValues.some((value) => !validUrl(value));
  if (sourceGap) addFlag(flags, "SOURCE_GAP");
  if (isTechnicalEmpty(product.registration_status_kz)) addFlag(flags, "REGULATORY_GAP");
  const usagePresent = Boolean(
    product.crop_id || text(product.target_crops) || text(product.target_pests) ||
    product.application_rate != null || text(product.application_rate_text) || text(product.application_method),
  );
  if (!usagePresent) addFlag(flags, "USAGE_RULE_GAP");
  if (failedTestsByProduct.has(product.id)) addFlag(flags, "SEARCH_FAILURE");
  const rowTextValues = collectStrings({ product, aliases, linked });
  if (rowTextValues.some(hasMojibake)) addFlag(flags, "MOJIBAKE");

  const explicitOwnerReview = Boolean(product.requires_review || product.metadata_review_required || concentrationProblems.length);
  if (explicitOwnerReview) addFlag(flags, "NEED_OWNER_REVIEW");
  const noUsableSource = !validProductSources.length && !linkSourceIds.length;
  const status = classify(flags, explicitOwnerReview, noUsableSource);
  if (!READINESS.includes(status)) throw new Error(`Unclassified readiness: ${status}`);

  auditRows.push({
    product_id: product.id,
    trade_name: officialName,
    manufacturer,
    product_type: product.product_type,
    active_status: product.is_active ? "active" : "inactive",
    component_count: linked.length,
    safener_count: linked.filter(({ component, link }) => component?.component_type === "safener" && link.role_in_product === "safener").length,
    formulation,
    alias_count: aliases.length,
    source_count: unique([...validProductSources, ...linkSourceIds]).length,
    component_catalog_source_count: componentCatalogSourceIds.length,
    readiness_status: status,
    issue_flags: Array.from(flags).sort(),
    recommended_action: resolveRecommendedAction(flags, status),
    confidence: sourceConfidence || text(product.import_confidence) || "unknown",
    owner_review_required: explicitOwnerReview || status === "NEED_OWNER_REVIEW" || status === "BLOCKED_IDENTITY",
    batch: assignBatch(flags),
    identity_key: buildCatalogIdentityKey(product),
    company_override_conflict: companyConflict,
    component_source_mode: linkSourceIds.length ? "link_source" : validProductSources.length ? "product_source_fallback" : "none",
    component_role_conflicts: roleConflicts.map(({ link, component }) => `${component?.canonical_name || link.component_id}:${component?.component_type || "missing"}->${link.role_in_product}`),
    concentration_problem_count: concentrationProblems.length,
    search_failure_count: (failedTestsByProduct.get(product.id) || []).length,
    notes: !text(product.trade_name) ? "trade_name field is empty; name fallback used" : "",
  });
}

const productIdSet = new Set(auditRows.map((row) => row.product_id));
if (productIdSet.size !== auditRows.length) throw new Error("Duplicate audit rows detected");
const unclassified = auditRows.filter((row) => !READINESS.includes(row.readiness_status));
if (unclassified.length) throw new Error(`Unclassified products: ${unclassified.length}`);
if (searchTests.length < 100) throw new Error(`Search gate requires at least 100 tests, found ${searchTests.length}`);

const readinessBreakdown = Object.fromEntries(READINESS.map((status) => [status, auditRows.filter((row) => row.readiness_status === status).length]));
const issueCounts = Object.fromEntries(ISSUE_FLAGS.map((flag) => [flag, auditRows.filter((row) => row.issue_flags.includes(flag)).length]));
const batchCounts = {
  BATCH_1_P0: auditRows.filter((row) => row.batch === "BATCH_1_P0").length,
  BATCH_2_P1: auditRows.filter((row) => row.batch === "BATCH_2_P1").length,
  BATCH_3_P2: auditRows.filter((row) => row.batch === "BATCH_3_P2").length,
};
const auditFingerprint = sha256(JSON.stringify({
  rows: auditRows,
  searchTests,
  specialCases,
  glbdCounts,
}));
const searchSummary = {
  total: searchTests.length + specialCases.length,
  pass: searchTests.filter((test) => test.passed).length + specialCases.filter((test) => test.passed).length,
  fail: searchTests.filter((test) => !test.passed).length + specialCases.filter((test) => !test.passed).length,
  products_with_trade_name_test: products.length,
  products_in_extended_matrix: extendedSearchSampleIds.size,
};
const summary = {
  task: "TZ-180",
  generated_at: new Date().toISOString(),
  project_ref: PROJECT_REF,
  mode: "READ_ONLY_PRODUCTION_AUDIT",
  production_writes: 0,
  scope: {
    filter: "products.company_id IS NULL AND product_type = pesticide AND archived = false",
    pesticide_products: products.length,
    excluded_global_products: allGlobalProducts.length - products.length,
    company_products_read_minimally: companyProducts.length,
  },
  glbd_baseline: glbdCounts,
  readiness: readinessBreakdown,
  issues: issueCounts,
  unclassified_products: unclassified.length,
  duplicate_audit_rows: auditRows.length - productIdSet.size,
  search: searchSummary,
  mojibake_unique_values: mojibakeValues.length,
  owner_review_count: auditRows.filter((row) => row.owner_review_required).length,
  batches: batchCounts,
  schema_notes: {
    allowed_in_kazakhstan_column_exists: false,
    dedicated_product_usage_relation_exists: false,
    regulatory_audit_field: "products.registration_status_kz",
    usage_audit_fields: ["crop_id", "target_crops", "target_pests", "application_rate", "application_rate_text", "application_method"],
  },
  known_special_cases: specialCases,
  audit_fingerprint_sha256: auditFingerprint,
};

const columns = [
  "product_id", "trade_name", "manufacturer", "product_type", "active_status", "component_count",
  "safener_count", "formulation", "alias_count", "source_count", "readiness_status", "issue_flags",
  "recommended_action", "confidence", "owner_review_required", "batch", "component_source_mode",
  "component_catalog_source_count", "search_failure_count", "notes",
];
const files = new Map();
files.set("pesticide_cards_audit.csv", toCsv(auditRows, columns));
files.set("pesticide_cards_audit.json", `${JSON.stringify(auditRows, null, 2)}\n`);
files.set("readiness_summary.json", `${JSON.stringify(summary, null, 2)}\n`);
files.set("missing_components.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("MISSING_COMPONENT")), columns));
files.set("component_role_conflicts.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("COMPONENT_ROLE_CONFLICT")), columns));
files.set("safener_gaps.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("SAFENER_MODEL_GAP")), columns));
files.set("biological_gaps.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("BIOLOGICAL_MODEL_GAP")), columns));
files.set("missing_formulations.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("MISSING_FORMULATION")), columns));
files.set("formulation_conflicts.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("FORMULATION_CONFLICT")), columns));
files.set("identity_conflicts.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("IDENTITY_DUPLICATE")), columns));
files.set("manufacturer_prefix_cases.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("MANUFACTURER_IN_TRADE_NAME")), columns));
files.set("company_global_conflicts.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("COMPANY_GLOBAL_CONFLICT")), columns));
files.set("source_gaps.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("SOURCE_GAP") || row.issue_flags.includes("COMPONENT_SOURCE_GAP")), columns));
files.set("regulatory_gaps.csv", toCsv(auditRows.filter((row) => row.issue_flags.includes("REGULATORY_GAP")), columns));
files.set("search_failures.csv", toCsv(
  [...searchTests.filter((test) => !test.passed), ...specialCases.filter((test) => !test.passed).map((test) => ({ ...test, scope: "special_global", kind: "known_case", expected_product_id: "", expected_trade_name: test.expected, matched_product_ids: test.matched_product_ids.join(";"), matched_labels: test.matched_labels.join("; ") }))],
  ["scope", "kind", "query", "expected_product_id", "expected_trade_name", "passed", "matched_product_ids", "matched_labels"],
));
files.set("owner_review.csv", toCsv(auditRows.filter((row) => row.owner_review_required), columns));

const batchPlan = `# TZ-180 pesticide card batch plan

Production apply is explicitly out of scope. Counts below assign each card to its highest-priority batch, so batches do not overlap.

## BATCH 1 - P0 (${batchCounts.BATCH_1_P0} cards)

- Scope: missing components, component-role conflicts, identity duplicates, manufacturer prefixes and current search failures.
- Expected changes: source-backed component links, canonical identity/alias decisions and search integration fixes.
- Risk: HIGH. Wrong merges or composition links would change product identity and agronomic meaning.
- Owner review: REQUIRED for identity merges, ambiguous composition and conflicting aliases.
- Automatic apply: NO.
- Rollback: full product/alias/link snapshots plus deterministic ID-scoped reverse SQL.

## BATCH 2 - P1 (${batchCounts.BATCH_2_P1} cards)

- Scope: missing/conflicting formulations, safener/biological model gaps and company/global conflicts not already in Batch 1.
- Expected changes: verified formulation references and role-safe component modelling.
- Risk: MEDIUM-HIGH.
- Owner review: REQUIRED where source evidence or company override identity is ambiguous.
- Automatic apply: NO; source-backed rows may be prepared as a later reviewed preview.
- Rollback: ID-scoped snapshots of products, formulations, aliases and component links.

## BATCH 3 - P2 (${batchCounts.BATCH_3_P2} cards)

- Scope: RU/EN aliases, manufacturer gaps, source/confidence metadata, regulatory status and usage rules.
- Expected changes: additive metadata only after source verification.
- Risk: MEDIUM; low for non-conflicting aliases, higher for regulatory and usage claims.
- Owner review: REQUIRED for regulatory/usage claims and cross-product aliases.
- Automatic apply: NO by default; only a separately approved collision-free alias/source subset may become automatic.
- Rollback: exact inserted-row IDs and before/after product metadata snapshots.

## Gate for the next task

Start with Batch 1 as a read-only source-research and owner-review package. Do not merge product identities or create component links directly from this audit.
`;
files.set("batch_plan.md", batchPlan);

await mkdir(outputDir, { recursive: true });
for (const [name, content] of files) await writeFile(path.join(outputDir, name), content, "utf8");
const manifestFiles = (await readdir(outputDir)).filter((name) => name !== "manifest.sha256").sort();
const manifestLines = [];
for (const name of manifestFiles) manifestLines.push(`${sha256(await readFile(path.join(outputDir, name)))}  ${name}`);
await writeFile(path.join(outputDir, "manifest.sha256"), `${manifestLines.join("\n")}\n`, "utf8");

for (const line of manifestLines) {
  const [expected, name] = line.split(/\s{2}/u);
  if (sha256(await readFile(path.join(outputDir, name))) !== expected) throw new Error(`Manifest verification failed: ${name}`);
}

console.log(JSON.stringify({
  status: "PASS",
  output_dir: outputDir,
  pesticide_products: products.length,
  readiness: readinessBreakdown,
  issues: issueCounts,
  search: searchSummary,
  owner_review_count: summary.owner_review_count,
  batches: batchCounts,
  unclassified: unclassified.length,
  duplicate_rows: auditRows.length - productIdSet.size,
  fingerprint: auditFingerprint,
  production_writes: 0,
}, null, 2));
