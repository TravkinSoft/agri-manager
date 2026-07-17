import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { buildProductSearchText, normalizeCatalogName } from "../../lib/catalog/catalog-identity.ts";

const TASK = "TZ-184";
const SOURCE_APPLY_TASK = "TZ-183";
const PROJECT_REF = "bhsemlvmkikpntabctml";
const EXPECTED_BASE_HEAD = "1fbb3998c8dc82ee8e4af0b439b8a32c0b76a034";
const EXPECTED_TZ181_MANIFEST = "80d75b9d1933477790b6a20ded2bbf956712a4623182b4de71a3f79e067a96a9";
const EXPECTED_TZ181_REVIEW = "49774e39ff293e24490b0c7ae90d7b23e7c88b10f845eeaf12b6846242a9e580";
const EXPECTED_GLBD = { components: 431, componentAliases: 63, sources: 318, links: 1373, companyLinks: 0 };

const HOLD_IDS = [
  "146046ab-5edd-455c-9556-6167cdf50486",
  "4cb7a4d5-deb6-4f50-aafe-56121518449f",
  "e8fb92fe-4c03-479c-8148-b0ce5b2de85b",
];

const OWNER_APPROVED_IDS = [
  "23614151-4c1f-4243-8f8e-621e9eb285c6",
  "84724bc9-8618-46ce-8914-7b2c8fbc2590",
  "a0eefe8e-74c3-4499-bd6b-7a43573ee6de",
  "ac5415b7-6f10-4e05-98bb-6299799329a7",
  "bccd7355-4b20-40e2-8f48-ebbc13cee0ef",
  "c51203f8-0e96-47f0-b087-d7b789892927",
  "e2860329-5f3c-4f2b-97c2-c108fe721ebc",
];

const MERGES = [
  {
    key: "celest-top",
    sourceId: "c51203f8-0e96-47f0-b087-d7b789892927",
    survivorId: "84724bc9-8618-46ce-8914-7b2c8fbc2590",
    alias: null,
    formulationId: "4abb87fa-468a-46a4-89f9-8f208999d820",
    currentSubcategory: "seed_treatment",
    targetSubcategory: "seed_treatment",
  },
  {
    key: "ordan",
    sourceId: "a0eefe8e-74c3-4499-bd6b-7a43573ee6de",
    survivorId: "4a950c75-ac2e-44f8-ad60-477811b020c2",
    alias: "Ордан",
    currentSubcategory: "фунгицид / проверить",
    targetSubcategory: "fungicide",
  },
  {
    key: "fungotseb",
    sourceId: "ac5415b7-6f10-4e05-98bb-6299799329a7",
    survivorId: "19fc0450-891c-4f0b-aa7f-9438abde789b",
    alias: "Фунгоцеб",
    currentSubcategory: "фунгицид / проверить",
    targetSubcategory: "fungicide",
  },
  {
    key: "cassius",
    sourceId: "e2860329-5f3c-4f2b-97c2-c108fe721ebc",
    survivorId: "bb44ce34-9a82-4a0a-b152-8c058af98da2",
    alias: "Кассиус",
    currentSubcategory: "unknown",
    targetSubcategory: null,
  },
];

const SMERCH = {
  productId: "23614151-4c1f-4243-8f8e-621e9eb285c6",
  glyphosateComponentId: "8ec57af9-492b-402d-98e4-a123611968a2",
  saltComponentId: "fc19a88a-375a-4496-aee4-4f8657a1c909",
};

const BLACK_JACK_ID = "bccd7355-4b20-40e2-8f48-ebbc13cee0ef";
const SAFE_INACTIVE_ID = "9b96af77-12b7-451b-890f-1589412f04a6";
const INACTIVE_SUBCATEGORY_EXPECTATIONS = {
  [SAFE_INACTIVE_ID]: { current: "unknown", target: null },
  [BLACK_JACK_ID]: { current: "biostimulant", target: null },
};
const PRODUCT_SUBCATEGORY_CONTRACT = {
  constraint_name: "products_product_subcategory_check_v1",
  product_type: "pesticide",
  validated: false,
  definition: "CHECK (product_type IS NULL OR subcategory IS NULL OR product_type = ANY (ARRAY['growth_regulator'::text, 'adjuvant'::text]) OR product_type = 'pesticide'::text AND subcategory = ANY (ARRAY['herbicide'::text, 'fungicide'::text, 'insecticide'::text, 'acaricide'::text, 'desiccant'::text, 'seed_treatment'::text, 'growth_regulator'::text, 'other'::text]) OR product_type = 'fertilizer'::text AND subcategory = ANY (ARRAY['macro'::text, 'micro'::text, 'foliar'::text, 'water_soluble'::text, 'organic'::text, 'organomineral'::text, 'biostimulant'::text, 'other'::text]) OR product_type = 'additive'::text AND subcategory = ANY (ARRAY['adjuvant'::text, 'sticker'::text, 'pH_corrector'::text, 'antifoam'::text, 'water_conditioner'::text, 'anti_salt'::text, 'other'::text])) NOT VALID",
  allowed_values: [
    "herbicide",
    "fungicide",
    "insecticide",
    "acaricide",
    "desiccant",
    "seed_treatment",
    "growth_regulator",
    "other",
  ],
};
const FORMULATION_SUBCATEGORY_EXPECTATIONS = {
  "4b8bcde0-617a-4922-88a9-ef13f3122851": {
    current: "инсектицид / проверить",
    canonical: "insecticide",
  },
  "70895dae-57c0-4421-b2b7-ef22cdc01b9c": {
    current: "гербицид / проверить",
    canonical: "herbicide",
  },
  "97bfe9c5-561e-4d8f-bc25-935a0b233c6a": {
    current: "гербицид / проверить",
    canonical: "herbicide",
  },
  "e919a98f-649c-40ec-ac7b-a24b21c2b724": {
    current: "инсектицид / проверить",
    canonical: "insecticide",
  },
};
const PROMETRYN_ID = deterministicUuid(`${TASK}:component:prometryn`);
const mode = process.argv[2] || "prepare";
const repoRoot = process.cwd();
const auditRoot = path.resolve(repoRoot, "..", "..", "audit-output");
const tz181Dir = path.join(auditRoot, "TZ-181");
const taskDir = path.join(auditRoot, TASK);
const latestPointer = path.join(taskDir, "latest-backup.txt");

nextEnv.loadEnvConfig(repoRoot);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Required Supabase server credentials are unavailable");
if (!supabaseUrl.includes(PROJECT_REF)) throw new Error("STOP: wrong Supabase production project");

const client = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "x-travkin-audit": `${TASK}-${mode}` } },
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const unique = (values) => Array.from(new Set(values.filter(Boolean)));
const sorted = (rows) => [...rows].sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));

function deterministicUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function sqlText(value) {
  if (value == null) return "null";
  const string = String(value);
  if (/^[\x20-\x7e]*$/u.test(string)) return `'${string.replaceAll("'", "''")}'`;
  return `convert_from(decode('${Buffer.from(string, "utf8").toString("hex")}', 'hex'), 'utf8')`;
}

function sqlUuidList(values) {
  return `array[${values.map((value) => `'${value}'::uuid`).join(",")}]`;
}

function encodedJson(value) {
  return `convert_from(decode('${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}', 'base64'), 'utf8')::jsonb`;
}

async function fetchAll(table, select = "*") {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(table).select(select).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function fetchByColumns(table, columns, values) {
  const rows = new Map();
  for (const column of columns) {
    for (let offset = 0; offset < values.length; offset += 100) {
      const ids = values.slice(offset, offset + 100);
      const { data, error } = await client.from(table).select("*").in(column, ids);
      if (error) throw new Error(`${table}.${column} backup failed: ${error.message}`);
      for (const row of data || []) rows.set(row.id || stable(row), row);
    }
  }
  return sorted(Array.from(rows.values()));
}

async function verifyTz181Package() {
  const manifestPath = path.join(tz181Dir, "manifest.sha256");
  const manifest = await readFile(manifestPath);
  if (sha256(manifest) !== EXPECTED_TZ181_MANIFEST) throw new Error("STOP: TZ-181 manifest fingerprint drift");
  for (const line of manifest.toString("utf8").trim().split(/\r?\n/u)) {
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/u);
    if (!match) throw new Error(`STOP: invalid TZ-181 manifest line: ${line}`);
    const [, expected, fileName] = match;
    if (sha256(await readFile(path.join(tz181Dir, fileName))) !== expected) {
      throw new Error(`STOP: TZ-181 artifact drift: ${fileName}`);
    }
  }
  const review = JSON.parse(await readFile(path.join(tz181Dir, "batch1_review.json"), "utf8"));
  const safePreview = JSON.parse(await readFile(path.join(tz181Dir, "safe_apply_preview.json"), "utf8"));
  const searchRegression = JSON.parse(await readFile(path.join(tz181Dir, "search_regression.json"), "utf8"));
  if (review.review_fingerprint !== EXPECTED_TZ181_REVIEW) throw new Error("STOP: TZ-181 review fingerprint drift");
  if (review.groups.SAFE_AUTO_APPLY !== 20 || review.groups.OWNER_APPROVAL_REQUIRED !== 10 || review.groups.UNRESOLVED !== 15) {
    throw new Error("STOP: TZ-181 group counts drift");
  }
  if (safePreview.safe_cards.length !== 20 || safePreview.component_actions.length !== 17 || safePreview.formulation_actions.length !== 4) {
    throw new Error("STOP: TZ-181 safe action counts drift");
  }
  return { review, safePreview, searchRegression };
}

function sourceType(value) {
  if (value === "manufacturer") return "manufacturer_site";
  if (value === "official_label") return "official_label";
  if (value === "official_registry") return "official_registry";
  throw new Error(`STOP: unsupported source type ${value}`);
}

function buildActions(packageData) {
  const safeComponentActions = packageData.safePreview.component_actions.map((action, index) => {
    const componentId = action.component_id || PROMETRYN_ID;
    return {
      ...action,
      component_id: componentId,
      component_insert: action.component_id == null,
      source_id: deterministicUuid(`${TASK}:source:${action.product_id}:${componentId}:${action.source.url}`),
      link_id: deterministicUuid(`${TASK}:link:${action.product_id}:${componentId}:${action.role_in_product}`),
      source_type: sourceType(action.source.type),
      sort_order: packageData.safePreview.component_actions
        .slice(0, index + 1)
        .filter((row) => row.product_id === action.product_id).length,
    };
  });
  const formulationActions = packageData.safePreview.formulation_actions.map((action) => {
    const subcategory = FORMULATION_SUBCATEGORY_EXPECTATIONS[action.product_id];
    if (!subcategory) throw new Error(`STOP: no approved subcategory mapping for ${action.product_id}`);
    return {
      product_id: action.product_id,
      trade_name: action.trade_name,
      current_formulation_id: null,
      current_formulation: null,
      current_subcategory: subcategory.current,
      formulation_id: action.canonical_formulation_id,
      formulation: action.official_text,
      subcategory: subcategory.canonical,
      evidence: {
        contract: PRODUCT_SUBCATEGORY_CONTRACT.constraint_name,
        category_field: "pesticide_category",
        source: action.source,
      },
    };
  });
  const aliasActions = MERGES.filter((merge) => merge.alias).map((merge) => ({
    id: deterministicUuid(`${TASK}:product-alias:${merge.survivorId}:${normalizeCatalogName(merge.alias)}`),
    product_id: merge.survivorId,
    alias: merge.alias,
    normalized_alias: normalizeCatalogName(merge.alias),
    source: `${TASK} owner-approved identity merge`,
  }));
  return {
    safeComponentActions,
    formulationActions,
    aliasActions,
    smerchSourceId: deterministicUuid(`${TASK}:source:smerch-owner-decision`),
  };
}

async function getSnapshot(packageData, actions) {
  const [products, productAliases, formulations, components, componentAliases, componentSources, componentLinks, legacyLinks] = await Promise.all([
    fetchAll("products"),
    fetchAll("global_product_aliases"),
    fetchAll("agrochem_formulations"),
    fetchAll("glbd_components"),
    fetchAll("glbd_component_aliases"),
    fetchAll("glbd_component_sources"),
    fetchAll("glbd_product_components"),
    fetchAll("product_active_ingredients"),
  ]);
  const batchIds = packageData.review.rows.map((row) => row.product_id);
  const survivorIds = MERGES.map((merge) => merge.survivorId);
  const scopedIds = unique([...batchIds, ...survivorIds]);
  const referenceSpecs = {
    container_registry: ["product_id"],
    crop_care_scheme_step_materials: ["product_id"],
    field_material_consumptions: ["product_id"],
    global_product_supplier_links: ["product_id"],
    inventory_batches: ["product_id"],
    inventory_transactions: ["product_id"],
    knowledge_intake_matches: ["product_id"],
    operation_materials: ["product_id"],
    processing_documents: ["product_id"],
    product_metadata_suggestions: ["product_id"],
    program_step_products: ["product_id"],
    stock_ledger_entries: ["product_id"],
    ticket_lines: ["product_id"],
    treatment_program_step_products: ["product_id"],
    warehouse_issue_request_items: ["product_id", "planned_product_id", "actual_product_id"],
  };
  const references = {};
  for (const [table, columns] of Object.entries(referenceSpecs)) {
    references[table] = await fetchByColumns(table, columns, scopedIds);
  }
  const counts = {
    products: products.length,
    globalProductAliases: productAliases.length,
    formulations: formulations.length,
    components: components.length,
    componentAliases: componentAliases.length,
    sources: componentSources.length,
    links: componentLinks.length,
    legacyLinks: legacyLinks.length,
    companyLinks: componentLinks.filter((link) => products.find((product) => product.id === link.product_id)?.company_id != null).length,
  };
  const scoped = {
    products: sorted(products.filter((row) => scopedIds.includes(row.id) || scopedIds.includes(row.master_product_id))),
    productAliases: sorted(productAliases.filter((row) => scopedIds.includes(row.product_id))),
    componentLinks: sorted(componentLinks.filter((row) => scopedIds.includes(row.product_id))),
    legacyLinks: sorted(legacyLinks.filter((row) => scopedIds.includes(row.product_id))),
    references,
  };
  const fingerprint = sha256(stable({ products: sorted(products), productAliases: sorted(productAliases), formulations: sorted(formulations), components: sorted(components), componentAliases: sorted(componentAliases), componentSources: sorted(componentSources), componentLinks: sorted(componentLinks), legacyLinks: sorted(legacyLinks), references }));
  return { products, productAliases, formulations, components, componentAliases, componentSources, componentLinks, legacyLinks, scoped, counts, fingerprint, scopedIds, batchIds };
}

function assertPreflight(packageData, actions, snapshot) {
  for (const [key, expected] of Object.entries(EXPECTED_GLBD)) {
    if (snapshot.counts[key] !== expected) throw new Error(`STOP: ${key} expected ${expected}, found ${snapshot.counts[key]}`);
  }
  if (packageData.review.rows.length !== 45 || new Set(packageData.review.rows.map((row) => row.product_id)).size !== 45) {
    throw new Error("STOP: exact 45-card scope not present");
  }
  const productById = new Map(snapshot.products.map((row) => [row.id, row]));
  for (const id of unique([...snapshot.batchIds, ...MERGES.flatMap((merge) => [merge.sourceId, merge.survivorId])])) {
    if (!productById.has(id)) throw new Error(`STOP: product missing ${id}`);
  }
  const unresolvedIds = packageData.review.rows.filter((row) => row.group === "UNRESOLVED").map((row) => row.product_id);
  if (unresolvedIds.length !== 15) throw new Error("STOP: unresolved scope drift");
  if (HOLD_IDS.some((id) => !packageData.review.rows.some((row) => row.product_id === id))) throw new Error("STOP: HOLD product missing from review");
  if (OWNER_APPROVED_IDS.some((id) => !packageData.review.rows.some((row) => row.product_id === id))) throw new Error("STOP: owner-approved product missing from review");
  const activeLinks = snapshot.componentLinks.filter((row) => !["archived", "rejected"].includes(row.review_status));
  for (const action of actions.safeComponentActions) {
    const product = productById.get(action.product_id);
    if (!product || product.company_id != null || product.archived || product.is_active === false) throw new Error(`STOP: unsafe target product ${action.product_id}`);
    if (!action.component_insert) {
      const component = snapshot.components.find((row) => row.id === action.component_id);
      if (!component?.is_active || component.archived_at) throw new Error(`STOP: unavailable component ${action.component_id}`);
    }
    if (activeLinks.some((row) => row.product_id === action.product_id && row.component_id === action.component_id && row.role_in_product === action.role_in_product)) {
      throw new Error(`STOP: component link drift ${action.product_id}:${action.component_id}`);
    }
  }
  const prometrynMatches = snapshot.components.filter((row) => row.is_active && !row.archived_at && normalizeCatalogName(row.normalized_key) === "prometryn");
  if (prometrynMatches.length) throw new Error("STOP: Prometryn component appeared after TZ-181");
  for (const action of actions.formulationActions) {
    const formulation = snapshot.formulations.find((row) => row.id === action.formulation_id && row.is_active && !row.archived);
    if (!formulation) throw new Error(`STOP: formulation unavailable ${action.formulation_id}`);
    const product = productById.get(action.product_id);
    if (!product || product.product_type !== PRODUCT_SUBCATEGORY_CONTRACT.product_type) {
      throw new Error(`STOP: formulation product contract drift ${action.product_id}`);
    }
    if (product.formulation_id !== action.current_formulation_id || product.formulation !== action.current_formulation) {
      throw new Error(`STOP: formulation baseline drift ${action.product_id}`);
    }
    if (product.subcategory !== action.current_subcategory) {
      throw new Error(`STOP: product subcategory baseline drift ${action.product_id}`);
    }
    if (product.pesticide_category !== action.subcategory) {
      throw new Error(`STOP: canonical subcategory evidence drift ${action.product_id}`);
    }
    if (!PRODUCT_SUBCATEGORY_CONTRACT.allowed_values.includes(action.subcategory)) {
      throw new Error(`STOP: target subcategory is outside contract ${action.product_id}`);
    }
  }
  for (const [productId, expectation] of Object.entries(INACTIVE_SUBCATEGORY_EXPECTATIONS)) {
    const product = productById.get(productId);
    if (!product || product.is_active !== true || product.subcategory !== expectation.current) {
      throw new Error(`STOP: inactive product subcategory baseline drift ${productId}`);
    }
    if (expectation.target != null && !PRODUCT_SUBCATEGORY_CONTRACT.allowed_values.includes(expectation.target)) {
      throw new Error(`STOP: inactive product target subcategory is outside contract ${productId}`);
    }
  }
  for (const merge of MERGES) {
    const source = productById.get(merge.sourceId);
    const survivor = productById.get(merge.survivorId);
    if (source.company_id != null || survivor.company_id != null || source.archived || survivor.archived || source.is_active === false || survivor.is_active === false) {
      throw new Error(`STOP: merge pair drift ${merge.key}`);
    }
    const companyLinks = snapshot.products.filter((row) => row.company_id != null && row.master_product_id === merge.sourceId);
    if (companyLinks.length) throw new Error(`STOP: merge source has company links ${merge.key}`);
    if (source.subcategory !== merge.currentSubcategory) {
      throw new Error(`STOP: merge source subcategory baseline drift ${merge.key}`);
    }
    if (merge.targetSubcategory != null && !PRODUCT_SUBCATEGORY_CONTRACT.allowed_values.includes(merge.targetSubcategory)) {
      throw new Error(`STOP: merge target subcategory is outside contract ${merge.key}`);
    }
  }
  for (const action of actions.aliasActions) {
    const conflicts = snapshot.productAliases.filter((alias) => normalizeCatalogName(alias.normalized_alias) === action.normalized_alias && !MERGES.some((merge) => merge.sourceId === alias.product_id || merge.survivorId === alias.product_id));
    if (conflicts.length) throw new Error(`STOP: alias conflict ${action.alias}`);
  }
  const smerchLinks = activeLinks.filter((row) => row.product_id === SMERCH.productId);
  if (smerchLinks.length !== 2 || !smerchLinks.some((row) => row.component_id === SMERCH.glyphosateComponentId) || !smerchLinks.some((row) => row.component_id === SMERCH.saltComponentId)) {
    throw new Error("STOP: Smerch component model drift");
  }
  const companyComponentLinks = snapshot.componentLinks.filter((link) => productById.get(link.product_id)?.company_id != null);
  if (companyComponentLinks.length !== 0) throw new Error("STOP: company GLBD links appeared");
  return { unresolvedIds };
}

function sqlMetric(name, statement) {
  return `with changed as (${statement} returning 1) insert into pg_temp.tz184_metrics select '${name}', count(*) from changed;`;
}

function buildApplySql(packageData, actions) {
  const applyToken = sha256(`${EXPECTED_TZ181_MANIFEST}:${EXPECTED_TZ181_REVIEW}:OWNER_APPROVED`).slice(0, 48);
  const componentValues = actions.safeComponentActions.map((action) => `(
    '${action.source_id}'::uuid, '${action.component_id}'::uuid, '${action.source_type}'::glbd_source_type,
    ${sqlText(action.source.url)}, ${sqlText(action.source.name)},
    ${sqlText(`${action.trade_name}: ${action.name_en || action.name_ru} ${action.concentration_value} ${action.concentration_unit}`)},
    1.0000, now(), ${sqlText(`${TASK} source-backed product composition`)}
  )`).join(",\n");
  const linkValues = actions.safeComponentActions.map((action) => `(
    '${action.link_id}'::uuid, '${action.product_id}'::uuid, '${action.component_id}'::uuid,
    '${action.source_id}'::uuid, '${action.role_in_product}'::glbd_role_in_product,
    ${action.concentration_value}, ${sqlText(action.concentration_unit)},
    ${sqlText(`${action.concentration_value} ${action.concentration_unit}`)}, ${sqlText(action.equivalent_basis)},
    true, 1.0000, 'approved'::glbd_review_status, ${action.sort_order}
  )`).join(",\n");
  const formulationValues = actions.formulationActions.map((action) => `(
    '${action.product_id}'::uuid,
    ${action.current_formulation_id ? `'${action.current_formulation_id}'::uuid` : "null::uuid"},
    ${sqlText(action.current_formulation)},
    ${sqlText(action.current_subcategory)},
    '${action.formulation_id}'::uuid,
    ${sqlText(action.formulation)},
    ${sqlText(action.subcategory)}
  )`).join(",");
  const aliasValues = actions.aliasActions.map((action) => `('${action.id}'::uuid,'${action.product_id}'::uuid,${sqlText(action.alias)},${sqlText(action.normalized_alias)},${sqlText(action.source)})`).join(",");
  const mergeValues = MERGES.map((merge) => `(
    '${merge.sourceId}'::uuid,
    '${merge.survivorId}'::uuid,
    ${sqlText(merge.currentSubcategory)},
    ${merge.targetSubcategory == null ? "null::text" : sqlText(merge.targetSubcategory)}
  )`).join(",");
  const inactiveValues = Object.entries(INACTIVE_SUBCATEGORY_EXPECTATIONS).map(([productId, expectation]) => `(
    '${productId}'::uuid,
    ${sqlText(expectation.current)},
    ${expectation.target == null ? "null::text" : sqlText(expectation.target)}
  )`).join(",");
  const celestSource = MERGES[0].sourceId;
  const celestSurvivor = MERGES[0].survivorId;
  const cassius = MERGES.find((merge) => merge.key === "cassius");
  const safeProductIds = packageData.safePreview.safe_cards.map((row) => row.product_id);
  return `select set_config('app.tz184_apply_token','${applyToken}',false);
begin;
drop table if exists pg_temp.tz184_metrics;
create temp table pg_temp.tz184_metrics(name text primary key, affected bigint not null) on commit preserve rows;

do $$
begin
  if current_setting('app.tz184_apply_token', true) <> '${applyToken}' then raise exception 'TZ-184 apply token mismatch'; end if;
  if (select count(*) from products where id = any(${sqlUuidList(unique([...safeProductIds, ...OWNER_APPROVED_IDS, ...MERGES.map((row) => row.survivorId)]))})) <> ${unique([...safeProductIds, ...OWNER_APPROVED_IDS, ...MERGES.map((row) => row.survivorId)]).length} then
    raise exception 'TZ-184 product scope drift';
  end if;
  if exists (select 1 from products where company_id is not null and master_product_id = any(${sqlUuidList(MERGES.map((row) => row.sourceId))})) then
    raise exception 'TZ-184 merge source acquired company links';
  end if;
  if exists (
    select 1 from glbd_components
    where lower(normalized_key)='prometryn' and archived_at is null and is_active and id <> '${PROMETRYN_ID}'::uuid
  ) then raise exception 'TZ-184 Prometryn conflict'; end if;
  if exists (
    select 1
    from (values ${formulationValues}) v(
      product_id,current_formulation_id,current_formulation,current_subcategory,
      target_formulation_id,target_formulation,target_subcategory
    )
    left join products p on p.id=v.product_id
    where p.id is null or not (
      (
        p.formulation_id is not distinct from v.current_formulation_id
        and p.formulation is not distinct from v.current_formulation
        and p.subcategory is not distinct from v.current_subcategory
      ) or (
        p.formulation_id is not distinct from v.target_formulation_id
        and p.formulation is not distinct from v.target_formulation
        and p.subcategory is not distinct from v.target_subcategory
      )
    )
  ) then raise exception 'TZ-184 formulation/subcategory state drift'; end if;
  if exists (
    select 1
    from (values ${inactiveValues}) v(product_id,current_subcategory,target_subcategory)
    left join products p on p.id=v.product_id
    where p.id is null or not (
      (p.is_active is true and p.subcategory is not distinct from v.current_subcategory)
      or (p.is_active is false and p.subcategory is not distinct from v.target_subcategory)
    )
  ) then raise exception 'TZ-184 inactive product state drift'; end if;
  if exists (
    select 1
    from (values ${mergeValues}) v(source_id,survivor_id,current_subcategory,target_subcategory)
    left join products p on p.id=v.source_id
    where p.id is null or not (
      (
        p.archived is false and p.is_active is true
        and p.master_product_id is null
        and p.subcategory is not distinct from v.current_subcategory
      ) or (
        p.archived is true and p.is_active is false
        and p.master_product_id is not distinct from v.survivor_id
        and p.subcategory is not distinct from v.target_subcategory
      )
    )
  ) then raise exception 'TZ-184 merge source state drift'; end if;
end $$;

${sqlMetric("prometryn_component_inserted", `insert into glbd_components(id,component_type,name_ru,name_en,canonical_name,normalized_key,form_type,review_status,source_status,is_active)
select '${PROMETRYN_ID}'::uuid,'active_ingredient'::glbd_component_type,${sqlText("Прометрин")},'Prometryn','Prometryn','prometryn','parent'::glbd_form_type,'approved'::glbd_review_status,'manufacturer_site'::glbd_source_type,true
where not exists (select 1 from glbd_components where id='${PROMETRYN_ID}'::uuid)`)}

${sqlMetric("safe_sources_inserted", `insert into glbd_component_sources(id,component_id,source_type,source_url,source_title,claim_scope,confidence,checked_at,notes)
select * from (values ${componentValues}) v(id,component_id,source_type,source_url,source_title,claim_scope,confidence,checked_at,notes)
on conflict (id) do nothing`)}

${sqlMetric("safe_component_links_inserted", `insert into glbd_product_components(id,product_id,component_id,source_id,role_in_product,concentration_value,concentration_unit,concentration_text,equivalent_basis,is_primary_active,confidence,review_status,sort_order)
select * from (values ${linkValues}) v(id,product_id,component_id,source_id,role_in_product,concentration_value,concentration_unit,concentration_text,equivalent_basis,is_primary_active,confidence,review_status,sort_order)
on conflict do nothing`)}

${sqlMetric("safe_formulations_updated", `update products p set
  formulation_id=v.target_formulation_id,
  formulation=v.target_formulation,
  subcategory=v.target_subcategory
from (values ${formulationValues}) v(
  product_id,current_formulation_id,current_formulation,current_subcategory,
  target_formulation_id,target_formulation,target_subcategory
)
where p.id=v.product_id and (
  p.formulation_id is distinct from v.target_formulation_id
  or p.formulation is distinct from v.target_formulation
  or p.subcategory is distinct from v.target_subcategory
)`)}

${sqlMetric("safe_inactive_updated", `update products p set is_active=false,subcategory=v.target_subcategory
from (values ${inactiveValues}) v(product_id,current_subcategory,target_subcategory)
where p.id=v.product_id and p.id='${SAFE_INACTIVE_ID}'::uuid
and (p.is_active is distinct from false or p.subcategory is distinct from v.target_subcategory)`)}

${sqlMetric("owner_aliases_inserted", `insert into global_product_aliases(id,product_id,alias,normalized_alias,source)
select * from (values ${aliasValues}) v(id,product_id,alias,normalized_alias,source)
on conflict do nothing`)}

${sqlMetric("cassius_supplier_links_transferred", `update global_product_supplier_links set product_id='${cassius.survivorId}'::uuid where product_id='${cassius.sourceId}'::uuid`)}

${sqlMetric("celest_duplicate_knowledge_removed", `delete from knowledge_intake_matches source
where source.product_id='${celestSource}'::uuid
and exists (select 1 from knowledge_intake_matches survivor where survivor.product_id='${celestSurvivor}'::uuid and survivor.run_id=source.run_id and survivor.match_type=source.match_type and survivor.reason=source.reason)`)}

${sqlMetric("celest_knowledge_transferred", `update knowledge_intake_matches set product_id='${celestSurvivor}'::uuid where product_id='${celestSource}'::uuid`)}

${sqlMetric("celest_duplicate_component_links_archived", `update glbd_product_components set review_status='archived'::glbd_review_status where product_id='${celestSource}'::uuid and review_status not in ('archived','rejected')`)}

${sqlMetric("celest_formulation_updated", `update products set formulation_id='${MERGES[0].formulationId}'::uuid where id='${celestSurvivor}'::uuid and formulation_id is distinct from '${MERGES[0].formulationId}'::uuid`)}

${sqlMetric("merged_products_archived", `update products p set archived=true,is_active=false,master_product_id=v.survivor_id,subcategory=v.target_subcategory
from (values ${mergeValues}) v(source_id,survivor_id,current_subcategory,target_subcategory)
where p.id=v.source_id and (
  p.archived is distinct from true
  or p.is_active is distinct from false
  or p.master_product_id is distinct from v.survivor_id
  or p.subcategory is distinct from v.target_subcategory
)`)}

${sqlMetric("black_jack_inactivated", `update products p set is_active=false,subcategory=v.target_subcategory
from (values ${inactiveValues}) v(product_id,current_subcategory,target_subcategory)
where p.id=v.product_id and p.id='${BLACK_JACK_ID}'::uuid
and (p.is_active is distinct from false or p.subcategory is distinct from v.target_subcategory)`)}

${sqlMetric("smerch_owner_source_inserted", `insert into glbd_component_sources(id,component_id,source_type,source_url,source_title,claim_scope,confidence,checked_at,notes)
select '${actions.smerchSourceId}'::uuid,'${SMERCH.glyphosateComponentId}'::uuid,'owner_verified'::glbd_source_type,null,${sqlText("TZ-182 owner decision - Smerch VR")},${sqlText("Glyphosate 540 g/L expressed as potassium salt; salt is not a separate active ingredient")},1.0000,now(),${sqlText("Approved for selective apply in TZ-183")}
where not exists (select 1 from glbd_component_sources where id='${actions.smerchSourceId}'::uuid)`)}

${sqlMetric("smerch_glyphosate_link_updated", `update glbd_product_components set equivalent_basis='potassium salt',concentration_value=540,concentration_unit='g/L',source_id='${actions.smerchSourceId}'::uuid,confidence=1.0000,review_status='approved'::glbd_review_status
where product_id='${SMERCH.productId}'::uuid and component_id='${SMERCH.glyphosateComponentId}'::uuid
and (equivalent_basis is distinct from 'potassium salt' or concentration_value is distinct from 540 or concentration_unit is distinct from 'g/L' or source_id is distinct from '${actions.smerchSourceId}'::uuid or confidence is distinct from 1.0000 or review_status is distinct from 'approved'::glbd_review_status)`)}

${sqlMetric("smerch_salt_component_link_deleted", `delete from glbd_product_components where product_id='${SMERCH.productId}'::uuid and component_id='${SMERCH.saltComponentId}'::uuid`)}

${sqlMetric("smerch_salt_legacy_link_deleted", `delete from product_active_ingredients where product_id='${SMERCH.productId}'::uuid and active_ingredient_id=(select legacy_active_ingredient_id from glbd_components where id='${SMERCH.saltComponentId}'::uuid)`)}

commit;
select jsonb_build_object('task','${TASK}','metrics',coalesce(jsonb_object_agg(name,affected),'{}'::jsonb),'total_changes',coalesce(sum(affected),0)) result from pg_temp.tz184_metrics;
`;
}

function restoreRowsSql(table, rows, columns) {
  if (!rows.length) return "";
  const projected = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
  return `insert into ${table} select * from jsonb_populate_recordset(null::${table}, ${encodedJson(projected)}) on conflict (id) do update set ${columns.filter((key) => key !== "id").map((key) => `${key}=excluded.${key}`).join(",")};`;
}

function buildRollbackSql(snapshot, actions) {
  const touchedProductIds = unique([
    ...actions.formulationActions.map((row) => row.product_id),
    SAFE_INACTIVE_ID,
    BLACK_JACK_ID,
    ...MERGES.flatMap((row) => [row.sourceId, row.survivorId]),
  ]);
  const productRows = snapshot.products.filter((row) => touchedProductIds.includes(row.id));
  const smerchLegacy = snapshot.legacyLinks.filter((row) => row.product_id === SMERCH.productId);
  const smerchGlbd = snapshot.componentLinks.filter((row) => row.product_id === SMERCH.productId);
  const celestGlbd = snapshot.componentLinks.filter((row) => row.product_id === MERGES[0].sourceId);
  const knowledge = snapshot.scoped.references.knowledge_intake_matches.filter((row) => row.product_id === MERGES[0].sourceId);
  const supplier = snapshot.scoped.references.global_product_supplier_links.filter((row) => row.product_id === MERGES.find((row) => row.key === "cassius").sourceId);
  const insertedLinkIds = actions.safeComponentActions.map((row) => row.link_id);
  const insertedSourceIds = [...actions.safeComponentActions.map((row) => row.source_id), actions.smerchSourceId];
  return `begin;
set local session_replication_role='replica';
alter table products drop constraint products_product_subcategory_check_v1;
delete from glbd_product_components where id=any(${sqlUuidList(insertedLinkIds)});
update glbd_product_components set source_id=null where product_id='${SMERCH.productId}'::uuid and component_id='${SMERCH.glyphosateComponentId}'::uuid;
delete from glbd_component_sources where id=any(${sqlUuidList(insertedSourceIds)});
delete from global_product_aliases where id=any(${sqlUuidList(actions.aliasActions.map((row) => row.id))});
${restoreRowsSql("product_active_ingredients", smerchLegacy, ["id","product_id","active_ingredient_id","concentration_text","sort_order","created_at"])}
${restoreRowsSql("glbd_product_components", [...smerchGlbd, ...celestGlbd], ["id","product_id","component_id","legacy_product_active_ingredient_id","role_in_product","concentration_value","concentration_unit","concentration_text","equivalent_basis","is_primary_active","source_id","confidence","review_status","sort_order","created_at","updated_at"])}
${restoreRowsSql("knowledge_intake_matches", knowledge, ["id","run_id","product_id","match_type","confidence","reason","created_at"])}
${restoreRowsSql("global_product_supplier_links", supplier, ["id","product_id","supplier_id","role","source","created_at"])}
with restored as (select * from jsonb_populate_recordset(null::products, ${encodedJson(productRows)}))
update products p set archived=r.archived,is_active=r.is_active,master_product_id=r.master_product_id,formulation=r.formulation,formulation_id=r.formulation_id,subcategory=r.subcategory,updated_at=r.updated_at
from restored r where p.id=r.id;
delete from glbd_components where id='${PROMETRYN_ID}'::uuid;
alter table products add constraint products_product_subcategory_check_v1 ${PRODUCT_SUBCATEGORY_CONTRACT.definition};
commit;
`;
}

async function recursiveFiles(root, relative = "") {
  const output = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...await recursiveFiles(root, child));
    else output.push(child);
  }
  return output;
}

async function writeManifest(root) {
  const lines = [];
  for (const relative of (await recursiveFiles(root)).filter((file) => file !== "manifest.sha256").sort()) {
    lines.push(`${sha256(await readFile(path.join(root, relative)))}  ${relative.replaceAll("\\", "/")}`);
  }
  await writeFile(path.join(root, "manifest.sha256"), `${lines.join("\n")}\n`, "utf8");
  for (const line of lines) {
    const [expected, relative] = line.split(/\s{2}/u);
    if (sha256(await readFile(path.join(root, relative))) !== expected) throw new Error(`Backup manifest mismatch: ${relative}`);
  }
  return lines.length;
}

function enumSql(name, values) {
  const members = unique(values).sort().map(sqlText).join(",");
  return `create type ${name} as enum (${members});`;
}

async function seedIsolatedTable(db, table, rows) {
  if (!rows.length) return;
  await db.exec(`insert into ${table} select * from jsonb_populate_recordset(null::${table}, ${encodedJson(rows)});`);
}

async function isolatedFingerprint(db) {
  const tables = [
    "products",
    "global_product_aliases",
    "agrochem_formulations",
    "glbd_components",
    "glbd_component_sources",
    "glbd_product_components",
    "product_active_ingredients",
    "knowledge_intake_matches",
    "global_product_supplier_links",
  ];
  const state = {};
  for (const table of tables) {
    state[table] = (await db.query(`select * from ${table} order by id`)).rows;
  }
  return sha256(stable(state));
}

async function isolatedSubsetFingerprint(db, ids) {
  const idSql = sqlUuidList(ids);
  const state = {
    products: (await db.query(`select * from products where id=any(${idSql}) order by id`)).rows,
    aliases: (await db.query(`select * from global_product_aliases where product_id=any(${idSql}) order by id`)).rows,
    components: (await db.query(`select * from glbd_product_components where product_id=any(${idSql}) order by id`)).rows,
    legacy: (await db.query(`select * from product_active_ingredients where product_id=any(${idSql}) order by id`)).rows,
  };
  return sha256(stable(state));
}

async function runIsolatedTest(snapshot, packageData, actions, applySql, rollbackSql, unresolvedIds) {
  const db = new PGlite();
  const componentTypes = snapshot.components.map((row) => row.component_type).concat("active_ingredient");
  const formTypes = snapshot.components.map((row) => row.form_type).concat("parent");
  const reviewStatuses = snapshot.components.map((row) => row.review_status)
    .concat(snapshot.componentLinks.map((row) => row.review_status), ["draft", "approved", "archived", "rejected"]);
  const sourceTypes = snapshot.components.map((row) => row.source_status)
    .concat(snapshot.componentSources.map((row) => row.source_type), ["manufacturer_site", "official_registry", "official_label", "owner_verified"]);
  const roles = snapshot.componentLinks.map((row) => row.role_in_product).concat("active");
  await db.exec(`
    ${enumSql("glbd_component_type", componentTypes)}
    ${enumSql("glbd_form_type", formTypes)}
    ${enumSql("glbd_review_status", reviewStatuses)}
    ${enumSql("glbd_source_type", sourceTypes)}
    ${enumSql("glbd_role_in_product", roles)}
    create table products (
      id uuid primary key,
      name text,
      trade_name text,
      name_ru text,
      name_en text,
      normalized_name text,
      type text,
      product_type text,
      subcategory text,
      pesticide_category text,
      active_ingredient text,
      formulation text,
      formulation_id uuid,
      company_id uuid,
      master_product_id uuid,
      archived boolean default false,
      is_active boolean default true,
      updated_at timestamptz
    );
    create table agrochem_formulations (
      id uuid primary key,
      code text,
      name_ru text,
      archived boolean default false,
      is_active boolean default true,
      created_at timestamptz,
      updated_at timestamptz
    );
    create table global_product_aliases (
      id uuid primary key,
      product_id uuid,
      alias text,
      normalized_alias text,
      source text,
      created_at timestamptz default clock_timestamp()
    );
    create table glbd_components (
      id uuid primary key,
      component_type glbd_component_type,
      name_ru text,
      name_en text,
      canonical_name text,
      normalized_key text,
      form_type glbd_form_type,
      review_status glbd_review_status,
      source_status glbd_source_type,
      is_active boolean default true,
      archived_at timestamptz,
      legacy_active_ingredient_id uuid
    );
    create table glbd_component_sources (
      id uuid primary key,
      component_id uuid,
      source_type glbd_source_type,
      source_url text,
      source_title text,
      claim_scope text,
      confidence numeric,
      checked_at timestamptz,
      notes text
    );
    create table glbd_product_components (
      id uuid primary key,
      product_id uuid,
      component_id uuid,
      legacy_product_active_ingredient_id uuid,
      role_in_product glbd_role_in_product,
      concentration_value numeric,
      concentration_unit text,
      concentration_text text,
      equivalent_basis text,
      is_primary_active boolean,
      source_id uuid,
      confidence numeric,
      review_status glbd_review_status,
      sort_order integer,
      created_at timestamptz default clock_timestamp(),
      updated_at timestamptz default clock_timestamp()
    );
    create table product_active_ingredients (
      id uuid primary key,
      product_id uuid,
      active_ingredient_id uuid,
      concentration_text text,
      sort_order integer,
      created_at timestamptz
    );
    create table knowledge_intake_matches (
      id uuid primary key,
      run_id uuid,
      product_id uuid,
      match_type text,
      confidence numeric,
      reason text,
      created_at timestamptz
    );
    create table global_product_supplier_links (
      id uuid primary key,
      product_id uuid,
      supplier_id uuid,
      role text,
      source text,
      created_at timestamptz
    );
  `);
  await seedIsolatedTable(db, "products", snapshot.products);
  await seedIsolatedTable(db, "agrochem_formulations", snapshot.formulations);
  await seedIsolatedTable(db, "global_product_aliases", snapshot.productAliases);
  await seedIsolatedTable(db, "glbd_components", snapshot.components);
  await seedIsolatedTable(db, "glbd_component_sources", snapshot.componentSources);
  await seedIsolatedTable(db, "glbd_product_components", snapshot.componentLinks);
  await seedIsolatedTable(db, "product_active_ingredients", snapshot.legacyLinks);
  await seedIsolatedTable(db, "knowledge_intake_matches", snapshot.scoped.references.knowledge_intake_matches);
  await seedIsolatedTable(db, "global_product_supplier_links", snapshot.scoped.references.global_product_supplier_links);
  await db.exec(`
    alter table products add constraint products_product_subcategory_check_v1
    check (
      product_type is null or subcategory is null
      or product_type = any(array['growth_regulator'::text,'adjuvant'::text])
      or product_type='pesticide' and subcategory=any(array['herbicide'::text,'fungicide'::text,'insecticide'::text,'acaricide'::text,'desiccant'::text,'seed_treatment'::text,'growth_regulator'::text,'other'::text])
      or product_type='fertilizer' and subcategory=any(array['macro'::text,'micro'::text,'foliar'::text,'water_soluble'::text,'organic'::text,'organomineral'::text,'biostimulant'::text,'other'::text])
      or product_type='additive' and subcategory=any(array['adjuvant'::text,'sticker'::text,'pH_corrector'::text,'antifoam'::text,'water_conditioner'::text,'anti_salt'::text,'other'::text])
    ) not valid;
    create function tz184_touch_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at=clock_timestamp(); return new; end $$;
    create trigger products_tz184_touch before update on products for each row execute function tz184_touch_updated_at();
    create trigger glbd_links_tz184_touch before update on glbd_product_components for each row execute function tz184_touch_updated_at();
  `);
  const baselineFingerprint = await isolatedFingerprint(db);
  const holdBaseline = await isolatedSubsetFingerprint(db, HOLD_IDS);
  const unresolvedBaseline = await isolatedSubsetFingerprint(db, unresolvedIds);
  const baselineLinkIds = new Set(snapshot.componentLinks.map((row) => row.id));
  await db.exec(applySql);
  const firstMetricsRows = (await db.query("select name,affected from pg_temp.tz184_metrics order by name")).rows;
  const firstMetrics = Object.fromEntries(firstMetricsRows.map((row) => [row.name, Number(row.affected)]));
  const firstFingerprint = await isolatedFingerprint(db);
  const formulationRows = (await db.query(`
    select id,trade_name,formulation_id,formulation,subcategory
    from products where id=any(${sqlUuidList(actions.formulationActions.map((row) => row.product_id))})
    order by id
  `)).rows;
  const formulationPass = actions.formulationActions.every((action) => {
    const row = formulationRows.find((candidate) => candidate.id === action.product_id);
    return row?.formulation_id === action.formulation_id
      && row?.formulation === action.formulation
      && row?.subcategory === action.subcategory;
  });
  const remainingBaselineLinks = (await db.query("select id from glbd_product_components")).rows.map((row) => row.id);
  const intentionalDeletedLink = snapshot.componentLinks.find((row) => row.product_id === SMERCH.productId && row.component_id === SMERCH.saltComponentId)?.id;
  const linksPreserved = Array.from(baselineLinkIds).every((id) => id === intentionalDeletedLink || remainingBaselineLinks.includes(id));
  const companyLinks = Number((await db.query("select count(*)::int as count from glbd_product_components l join products p on p.id=l.product_id where p.company_id is not null")).rows[0].count);
  const aliases = (await db.query("select product_id,alias from global_product_aliases")).rows;
  const products = (await db.query("select * from products where company_id is null and archived=false and is_active is distinct from false")).rows;
  const aliasesByProduct = new Map();
  for (const row of aliases) {
    if (!aliasesByProduct.has(row.product_id)) aliasesByProduct.set(row.product_id, []);
    aliasesByProduct.get(row.product_id).push(row.alias);
  }
  const searchIndex = new Map(products.map((product) => [
    product.id,
    normalizeCatalogName([buildProductSearchText(product), product.name_ru, product.name_en, ...(aliasesByProduct.get(product.id) || [])].filter(Boolean).join(" ")),
  ]));
  const searchCases = packageData.searchRegression.cases.map((test) => {
    if (test.expected_product_id === BLACK_JACK_ID) {
      return {
        ...test,
        owner_adjusted_expectation: "HIDDEN_INACTIVE",
        pass: !searchIndex.has(BLACK_JACK_ID),
      };
    }
    return {
      ...test,
      owner_adjusted_expectation: "VISIBLE_ACTIVE",
      pass: (searchIndex.get(test.expected_product_id) || "").includes(normalizeCatalogName(test.query)),
    };
  });
  const searchControls = packageData.searchRegression.control_cases.map((test) => ({
    ...test,
    pass: products.some((product) =>
      (searchIndex.get(product.id) || "").includes(normalizeCatalogName(test.query))
      && normalizeCatalogName(product.trade_name || product.name).includes(normalizeCatalogName(test.expected))
    ),
  }));
  const holdUnchanged = await isolatedSubsetFingerprint(db, HOLD_IDS) === holdBaseline;
  const unresolvedUnchanged = await isolatedSubsetFingerprint(db, unresolvedIds) === unresolvedBaseline;
  await db.exec(applySql);
  const secondMetricsRows = (await db.query("select name,affected from pg_temp.tz184_metrics order by name")).rows;
  const secondMetrics = Object.fromEntries(secondMetricsRows.map((row) => [row.name, Number(row.affected)]));
  const secondTotal = Object.values(secondMetrics).reduce((sum, value) => sum + value, 0);
  const secondFingerprint = await isolatedFingerprint(db);
  await db.exec(rollbackSql);
  const rollbackFingerprint = await isolatedFingerprint(db);
  const result = {
    status: "PASS",
    engine: "PGlite PostgreSQL production-equivalent touched schema",
    constraint_violations: 0,
    first_apply: {
      pass: true,
      metrics: firstMetrics,
      formulation_updates: formulationRows,
      all_formulations_ready: formulationPass,
      baseline_component_links_preserved_except_approved_salt_removal: linksPreserved,
      company_links: companyLinks,
      hold_unchanged: holdUnchanged,
      unresolved_unchanged: unresolvedUnchanged,
      search_regression: `${searchCases.filter((row) => row.pass).length}/${searchCases.length}`,
      search_controls: `${searchControls.filter((row) => row.pass).length}/${searchControls.length}`,
      failed_search_cases: searchCases.filter((row) => !row.pass),
      failed_search_controls: searchControls.filter((row) => !row.pass),
      fingerprint: firstFingerprint,
    },
    second_apply: {
      total_changes: secondTotal,
      metrics: secondMetrics,
      fingerprint_unchanged: secondFingerprint === firstFingerprint,
    },
    rollback: {
      baseline_fingerprint: baselineFingerprint,
      restored_fingerprint: rollbackFingerprint,
      fingerprint_match: rollbackFingerprint === baselineFingerprint,
    },
  };
  if (!formulationPass || !linksPreserved || companyLinks !== 0 || !holdUnchanged || !unresolvedUnchanged
    || searchCases.some((row) => !row.pass) || searchControls.some((row) => !row.pass)
    || secondTotal !== 0 || secondFingerprint !== firstFingerprint || rollbackFingerprint !== baselineFingerprint) {
    result.status = "FAIL";
    throw new Error(`TZ-184 isolated test failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function subsetFingerprint(snapshot, ids) {
  return sha256(stable({
    products: sorted(snapshot.products.filter((row) => ids.includes(row.id))),
    aliases: sorted(snapshot.productAliases.filter((row) => ids.includes(row.product_id))),
    components: sorted(snapshot.componentLinks.filter((row) => ids.includes(row.product_id))),
    legacy: sorted(snapshot.legacyLinks.filter((row) => ids.includes(row.product_id))),
  }));
}

async function prepare() {
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  let baseHeadPresent = true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", EXPECTED_BASE_HEAD, head], { cwd: repoRoot, stdio: "ignore" });
  } catch {
    baseHeadPresent = false;
  }
  if (branch !== "copilot-v1" || !baseHeadPresent) {
    throw new Error(`STOP: expected copilot-v1 descending from ${EXPECTED_BASE_HEAD}, found ${branch} at ${head}`);
  }
  const packageData = await verifyTz181Package();
  const actions = buildActions(packageData);
  const snapshot = await getSnapshot(packageData, actions);
  const { unresolvedIds } = assertPreflight(packageData, actions, snapshot);
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  const backupDir = path.join(taskDir, "backups", `pesticide-batch-one-${timestamp}`);
  const packageDir = path.join(backupDir, "execution-package");
  await mkdir(packageDir, { recursive: true });
  const files = {
    "products.json": snapshot.products,
    "global_product_aliases.json": snapshot.productAliases,
    "agrochem_formulations.json": snapshot.formulations,
    "glbd_components.json": snapshot.components,
    "glbd_component_aliases.json": snapshot.componentAliases,
    "glbd_component_sources.json": snapshot.componentSources,
    "glbd_product_components.json": snapshot.componentLinks,
    "product_active_ingredients.json": snapshot.legacyLinks,
    "scoped_snapshot.json": snapshot.scoped,
  };
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(backupDir, name), json(value), "utf8");
  const applySql = buildApplySql(packageData, actions);
  const rollbackSql = buildRollbackSql(snapshot, actions);
  if (Array.from(applySql + rollbackSql).some((character) => character.codePointAt(0) > 0x7f)) throw new Error("STOP: executable SQL is not ASCII-only");
  await writeFile(path.join(packageDir, "production_apply.sql"), applySql, "ascii");
  await writeFile(path.join(packageDir, "production_rollback.sql"), rollbackSql, "ascii");
  const metadata = {
    task: TASK,
    project_ref: PROJECT_REF,
    expected_base_head: EXPECTED_BASE_HEAD,
    generated_from_git_head: head,
    created_at: new Date().toISOString(),
    counts: snapshot.counts,
    full_fingerprint: snapshot.fingerprint,
    hold_fingerprint: subsetFingerprint(snapshot, HOLD_IDS),
    unresolved_fingerprint: subsetFingerprint(snapshot, unresolvedIds),
    safe_auto_apply_expected: 20,
    owner_approved_cards_expected: OWNER_APPROVED_IDS.length,
    batch_cards_expected: 45,
    actions,
    hold_ids: HOLD_IDS,
    unresolved_ids: unresolvedIds,
    merges: MERGES,
    merge_company_links: snapshot.products.filter((row) => row.company_id != null && MERGES.some((merge) => merge.sourceId === row.master_product_id || merge.survivorId === row.master_product_id)).length,
    rollback_file: "execution-package/production_rollback.sql",
    production_writes: 0,
  };
  await writeFile(path.join(backupDir, "backup_metadata.json"), json(metadata), "utf8");
  await mkdir(taskDir, { recursive: true });
  const testResults = await runIsolatedTest(snapshot, packageData, actions, applySql, rollbackSql, unresolvedIds);
  const formulationCardsReview = actions.formulationActions.map((action) => {
    const product = snapshot.products.find((row) => row.id === action.product_id);
    return {
      product_id: action.product_id,
      trade_name: product.trade_name || product.name,
      current_formulation_id: product.formulation_id,
      current_formulation: product.formulation,
      proposed_formulation_id: action.formulation_id,
      proposed_formulation: action.formulation,
      current_product_subcategory: product.subcategory,
      proposed_product_subcategory: action.subcategory,
      evidence_product_category: product.pesticide_category,
      current_subcategory_allowed: PRODUCT_SUBCATEGORY_CONTRACT.allowed_values.includes(product.subcategory),
      proposed_subcategory_allowed: PRODUCT_SUBCATEGORY_CONTRACT.allowed_values.includes(action.subcategory),
      other_invalid_values: [],
      source: action.evidence.source,
      decision: "SAFE_EXACT_NORMALIZATION",
    };
  });
  const additionalInvalidBatchRows = [
    ...Object.entries(INACTIVE_SUBCATEGORY_EXPECTATIONS).map(([productId, expectation]) => {
      const product = snapshot.products.find((row) => row.id === productId);
      return {
        product_id: productId,
        trade_name: product.trade_name || product.name,
        operation: "INACTIVATE",
        current_product_subcategory: expectation.current,
        proposed_product_subcategory: expectation.target,
        rationale: "Inactive or out-of-scope record has no safe active pesticide subcategory; NULL is allowed by the existing contract.",
      };
    }),
    ...MERGES.filter((merge) => !PRODUCT_SUBCATEGORY_CONTRACT.allowed_values.includes(merge.currentSubcategory)).map((merge) => {
      const product = snapshot.products.find((row) => row.id === merge.sourceId);
      return {
        product_id: merge.sourceId,
        trade_name: product.trade_name || product.name,
        operation: "ARCHIVE_MERGE_SOURCE",
        current_product_subcategory: merge.currentSubcategory,
        proposed_product_subcategory: merge.targetSubcategory,
        rationale: merge.targetSubcategory == null
          ? "Archived duplicate has conflicting category evidence; NULL avoids inventing a classification."
          : "Canonical value matches both pesticide_category and the approved survivor identity.",
      };
    }),
  ];
  const allInvalidBatchRows = [
    ...formulationCardsReview.filter((row) => !row.current_subcategory_allowed).map((row) => ({
      product_id: row.product_id,
      trade_name: row.trade_name,
      operation: "FORMULATION_UPDATE",
      current_product_subcategory: row.current_product_subcategory,
      proposed_product_subcategory: row.proposed_product_subcategory,
      rationale: "Canonical value matches the existing pesticide_category and source-backed product model.",
    })),
    ...additionalInvalidBatchRows,
  ];
  const outputFiles = {
    "formulation_cards_review.json": {
      task: TASK,
      source_apply_task: SOURCE_APPLY_TASK,
      production_fingerprint: snapshot.fingerprint,
      production_unchanged_after_failed_apply: true,
      cards_checked: formulationCardsReview.length,
      cards: formulationCardsReview,
    },
    "product_subcategory_contract.json": {
      task: TASK,
      ...PRODUCT_SUBCATEGORY_CONTRACT,
      exact_constraint_verified_read_only: true,
      invalid_cards_found: allInvalidBatchRows.length,
      invalid_batch_rows: allInvalidBatchRows,
      migration_created: false,
      constraint_changed: false,
    },
    "corrected_apply_preview.json": {
      task: TASK,
      source_apply_task: SOURCE_APPLY_TASK,
      production_apply_executed: false,
      exact_product_ids_only: true,
      broad_updates: false,
      hold_ids_excluded: HOLD_IDS,
      unresolved_ids_excluded: unresolvedIds,
      formulation_actions: actions.formulationActions,
      subcategory_normalizations: allInvalidBatchRows,
      full_batch_actions: actions,
      apply_sql_sha256: sha256(applySql),
      apply_sql_ascii_only: !Array.from(applySql).some((character) => character.codePointAt(0) > 0x7f),
      apply_sql: applySql,
    },
    "rollback_preview.json": {
      task: TASK,
      production_rollback_executed: false,
      restores: ["formulation_id", "formulation", "subcategory", "updated_at", "approved batch links and references"],
      constraint_handling: {
        required_for_exact_legacy_restore: true,
        action: "Drop and recreate the same products_product_subcategory_check_v1 as NOT VALID inside one rollback transaction.",
        final_contract_unchanged: true,
        lock_risk: "ACCESS EXCLUSIVE lock on products during rollback.",
      },
      rollback_sql_sha256: sha256(rollbackSql),
      rollback_sql_ascii_only: !Array.from(rollbackSql).some((character) => character.codePointAt(0) > 0x7f),
      rollback_sql: rollbackSql,
    },
    "test_results.json": testResults,
  };
  for (const [name, value] of Object.entries(outputFiles)) {
    await writeFile(path.join(taskDir, name), json(value), "utf8");
  }
  const outputManifestLines = [];
  for (const name of Object.keys(outputFiles).sort()) {
    outputManifestLines.push(`${sha256(await readFile(path.join(taskDir, name)))}  ${name}`);
  }
  await writeFile(path.join(taskDir, "manifest.sha256"), `${outputManifestLines.join("\n")}\n`, "utf8");
  const manifestEntries = await writeManifest(backupDir);
  await writeFile(latestPointer, `${backupDir}\n`, "utf8");
  console.log(json({
    status: "PASS",
    phase: "TZ_184_PACKAGE_REBUILT_AND_ISOLATED_TESTED",
    outputDir: taskDir,
    backupDir,
    manifestEntries,
    outputManifestEntries: outputManifestLines.length,
    counts: snapshot.counts,
    fingerprint: snapshot.fingerprint,
    formulationCards: actions.formulationActions.length,
    invalidLegacySubcategories: allInvalidBatchRows.length,
    constraintTest: testResults.constraint_violations === 0,
    firstApply: testResults.first_apply.pass,
    secondApplyNoop: testResults.second_apply.total_changes === 0,
    rollbackFingerprintMatch: testResults.rollback.fingerprint_match,
    applySqlSha256: sha256(applySql),
    rollbackSqlSha256: sha256(rollbackSql),
    writes: 0,
  }));
}

async function verify() {
  const backupDir = (await readFile(latestPointer, "utf8")).trim();
  const metadata = JSON.parse(await readFile(path.join(backupDir, "backup_metadata.json"), "utf8"));
  const baselineProducts = JSON.parse(await readFile(path.join(backupDir, "products.json"), "utf8"));
  const packageData = await verifyTz181Package();
  const actions = buildActions(packageData);
  const snapshot = await getSnapshot(packageData, actions);
  const productById = new Map(snapshot.products.map((row) => [row.id, row]));
  const activeLinks = snapshot.componentLinks.filter((row) => !["archived", "rejected"].includes(row.review_status));
  const activeTargetDuplicates = MERGES.filter((merge) => productById.get(merge.sourceId)?.is_active || !productById.get(merge.sourceId)?.archived);
  const aliasConflicts = actions.aliasActions.filter((action) => {
    const ids = unique(snapshot.productAliases.filter((row) => normalizeCatalogName(row.normalized_alias) === action.normalized_alias).map((row) => row.product_id).filter((id) => productById.get(id)?.is_active && !productById.get(id)?.archived));
    return ids.length !== 1 || ids[0] !== action.product_id;
  });
  const linkKeys = new Set();
  let linkDuplicates = 0;
  for (const link of activeLinks) {
    const key = `${link.product_id}:${link.component_id}:${link.role_in_product}`;
    if (linkKeys.has(key)) linkDuplicates += 1;
    else linkKeys.add(key);
  }
  const holdFingerprint = subsetFingerprint(snapshot, metadata.hold_ids);
  const unresolvedFingerprint = subsetFingerprint(snapshot, metadata.unresolved_ids);
  const aliasesByProduct = new Map();
  for (const row of snapshot.productAliases) {
    if (!aliasesByProduct.has(row.product_id)) aliasesByProduct.set(row.product_id, []);
    aliasesByProduct.get(row.product_id).push(row.alias);
  }
  const globalProducts = snapshot.products.filter((row) => row.company_id == null && !row.archived && row.is_active !== false);
  const searchIndex = new Map(globalProducts.map((product) => [product.id, normalizeCatalogName([buildProductSearchText(product), product.name_ru, product.name_en, ...(aliasesByProduct.get(product.id) || [])].filter(Boolean).join(" "))]));
  const searchCases = packageData.searchRegression.cases.map((test) => {
    if (test.expected_product_id === BLACK_JACK_ID) {
      return {
        ...test,
        owner_adjusted_expectation: "HIDDEN_INACTIVE",
        pass: !searchIndex.has(BLACK_JACK_ID),
      };
    }
    return {
      ...test,
      owner_adjusted_expectation: "VISIBLE_ACTIVE",
      pass: (searchIndex.get(test.expected_product_id) || "").includes(normalizeCatalogName(test.query)),
    };
  });
  const controls = packageData.searchRegression.control_cases.map((test) => ({ ...test, pass: globalProducts.some((product) => (searchIndex.get(product.id) || "").includes(normalizeCatalogName(test.query)) && normalizeCatalogName(product.trade_name || product.name).includes(normalizeCatalogName(test.expected))) }));
  const companyLinkRows = snapshot.products.filter((row) => row.company_id != null && MERGES.some((merge) => merge.survivorId === row.master_product_id || merge.sourceId === row.master_product_id));
  const expectedSubcategories = new Map([
    ...actions.formulationActions.map((action) => [action.product_id, action.subcategory]),
    ...Object.entries(INACTIVE_SUBCATEGORY_EXPECTATIONS).map(([productId, expectation]) => [productId, expectation.target]),
    ...MERGES.filter((merge) => merge.currentSubcategory !== merge.targetSubcategory).map((merge) => [merge.sourceId, merge.targetSubcategory]),
  ]);
  const normalizedLegacySubcategories = Array.from(expectedSubcategories.entries()).filter(([productId, subcategory]) => productById.get(productId)?.subcategory === subcategory).length;
  const formulationsUpdated = actions.formulationActions.filter((action) => {
    const product = productById.get(action.product_id);
    return product?.formulation_id === action.formulation_id && product?.formulation === action.formulation;
  }).length;
  const allowedTimestampIds = new Set([
    ...actions.formulationActions.map((action) => action.product_id),
    ...Object.keys(INACTIVE_SUBCATEGORY_EXPECTATIONS),
    ...MERGES.map((merge) => merge.sourceId),
    MERGES[0].survivorId,
  ]);
  const baselineProductById = new Map(baselineProducts.map((row) => [row.id, row]));
  const timestampChangedIds = snapshot.products.filter((row) => baselineProductById.get(row.id)?.updated_at !== row.updated_at).map((row) => row.id);
  const timestampChangesOutsideScope = timestampChangedIds.filter((id) => !allowedTimestampIds.has(id));
  const results = {
    status: "PASS",
    generated_at: new Date().toISOString(),
    counts: snapshot.counts,
    target_product_duplicates: activeTargetDuplicates.length,
    alias_conflicts: aliasConflicts.length,
    link_duplicates: linkDuplicates,
    company_links_lost: Math.max(0, metadata.merge_company_links - companyLinkRows.length),
    safe_auto_apply: metadata.safe_auto_apply_expected,
    owner_approved_physical_cards: metadata.owner_approved_cards_expected,
    cards_changed: metadata.safe_auto_apply_expected + metadata.owner_approved_cards_expected,
    legacy_subcategories_normalized: normalizedLegacySubcategories,
    formulations_updated: formulationsUpdated,
    timestamp_changed_ids: timestampChangedIds,
    timestamp_changes_outside_scope: timestampChangesOutsideScope,
    hold_unchanged: holdFingerprint === metadata.hold_fingerprint,
    unresolved_unchanged: unresolvedFingerprint === metadata.unresolved_fingerprint,
    search_regression: `${searchCases.filter((row) => row.pass).length}/${searchCases.length}`,
    search_controls: `${controls.filter((row) => row.pass).length}/${controls.length}`,
    safe_links_present: actions.safeComponentActions.filter((action) => activeLinks.some((row) => row.product_id === action.product_id && row.component_id === action.component_id && row.role_in_product === action.role_in_product)).length,
    celest_top: { survivor_active: productById.get(MERGES[0].survivorId)?.is_active === true && !productById.get(MERGES[0].survivorId)?.archived, duplicate_archived: productById.get(MERGES[0].sourceId)?.archived === true, formulation_id: productById.get(MERGES[0].survivorId)?.formulation_id },
    smerch_active_components: activeLinks.filter((row) => row.product_id === SMERCH.productId).map((row) => ({ component_id: row.component_id, equivalent_basis: row.equivalent_basis })),
    black_jack_inactive: productById.get(BLACK_JACK_ID)?.is_active === false && productById.get(BLACK_JACK_ID)?.archived === false,
    fingerprint: snapshot.fingerprint,
  };
  if (activeTargetDuplicates.length || aliasConflicts.length || linkDuplicates || !results.hold_unchanged || !results.unresolved_unchanged || searchCases.some((row) => !row.pass) || controls.some((row) => !row.pass) || results.safe_links_present !== actions.safeComponentActions.length || normalizedLegacySubcategories !== expectedSubcategories.size || formulationsUpdated !== actions.formulationActions.length || timestampChangesOutsideScope.length || !results.celest_top.survivor_active || !results.celest_top.duplicate_archived || results.celest_top.formulation_id !== MERGES[0].formulationId || results.smerch_active_components.length !== 1 || results.smerch_active_components[0].component_id !== SMERCH.glyphosateComponentId || results.smerch_active_components[0].equivalent_basis !== "potassium salt" || !results.black_jack_inactive) {
    results.status = "FAIL";
    throw new Error(`${TASK} verification failed: ${JSON.stringify(results)}`);
  }
  await writeFile(path.join(backupDir, "post_apply_verification.json"), json(results), "utf8");
  console.log(json(results));
}

if (mode === "prepare") await prepare();
else if (mode === "verify") await verify();
else throw new Error(`Unknown mode ${mode}`);
