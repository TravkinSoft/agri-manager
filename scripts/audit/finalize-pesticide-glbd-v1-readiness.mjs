import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const TASK = "TZ-196";
const PROJECT_REF = "bhsemlvmkikpntabctml";
const EXPECTED_PRODUCTS = 18;
const EXPECTED_GLOBAL_PESTICIDES = 852;
const repoRoot = process.cwd();
const auditRoot = path.resolve(repoRoot, "..", "..", "audit-output");
const outputDir = path.join(auditRoot, TASK);
const unresolvedPath = path.join(auditRoot, "TZ-181", "unresolved.csv");

const STATUS_VALUES = new Set([
  "SAFE_COMPLETE",
  "SAFE_PARTIAL",
  "SAFE_ADD_ALIAS",
  "SAFE_IDENTITY_NORMALIZE",
  "KEEP_SEPARATE",
  "KEEP_INACTIVE",
  "BLOCKED_NO_DATA",
  "NEED_OWNER_DECISION",
]);

const sources = {
  lastik: {
    name: "Avgust product page - Lastik Extra",
    url: "https://avgust.com/products/rf/lastik_ekstra/",
    type: "manufacturer",
  },
  primeur: {
    name: "Kazakhstan Adilet subsidized pesticide list - Primeur SE",
    url: "https://insecure.zan.kz/rus/docs/V25I0030119",
    type: "official_registry",
  },
  aminoMax: {
    name: "Kazakhstan Adilet fertilizer list - AminoMax",
    url: "https://adilet.zan.kz/rus/docs/G26B005202A",
    type: "official_registry",
  },
  aminoAlexin: {
    name: "Lithuanian State Forest Service fertilizer guidance - Amino Alexin",
    url: "https://amvmt.lrv.lt/uploads/amvmt/documents/files/MSAS/Patarimai/dirvai.pdf",
    type: "government_publication",
  },
  biograno: {
    name: "Kazakhstan Adilet fertilizer list - ES Biograno forte",
    url: "https://adilet.zan.kz/rus/docs/G26M000077A",
    type: "official_registry",
  },
  dithaneCandidate: {
    name: "Official distributor card - Dithane M-45",
    url: "https://gr-agro.kz/produkt/fungicidy/ditan-m-45",
    type: "official_distributor",
  },
  metamilCandidate: {
    name: "Kazakhstan Adilet pesticide list - Metamil MC",
    url: "https://www.adilet.zan.kz/kaz/docs/V23K0639609",
    type: "official_registry",
  },
  kurzatCandidate: {
    name: "Corteva product page - Curzate R",
    url: "https://www.corteva.com/ua/products-and-solutions/crop-protection/curzate-r.html",
    type: "manufacturer",
  },
};

const decisions = [
  {
    product_id: "0d61fc1b-6f47-4ff8-9bab-bc4e02e10b86",
    expected_trade_name: "Amino Max",
    classification: "SAFE_PARTIAL",
    assistant_read_allowed: "PARTIAL",
    assistant_recommendation_allowed: "NO",
    confidence: "MEDIUM",
    verified_identity: "AminoMax is listed as a fertilizer; the live row lacks a manufacturer needed to prove the exact variant.",
    verified_product_type: "fertilizer/biostimulant candidate, not safely established as a pesticide",
    verified_components: "Registry record: nitrogen 7.3%, organic matter 22%; exact live-row variant remains unconfirmed.",
    verified_concentrations: "N 7.3%; organic matter 22% for the registry record only",
    verified_formulation: "liquid unit in registry; exact formulation of the live row is not confirmed",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["Amino Max"],
    duplicate_decision: "No merge proposed.",
    sources: [sources.aminoMax],
    reason: "The name is source-backed as a fertilizer, but missing manufacturer prevents exact product identity and any composition apply.",
    proposed_changes: [],
  },
  {
    product_id: "2190ccbb-fdfb-4188-8da0-2819308a791b",
    expected_trade_name: "Эксперт",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Short generic trade name only.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "UNCONFIRMED",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "UNCONFIRMED",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["Эксперт"],
    duplicate_decision: "No merge proposed.",
    sources: [],
    reason: "No product-specific manufacturer, label, registry or official distributor source was found.",
    proposed_changes: [],
  },
  {
    product_id: "4a210859-7fd6-461a-84cb-f9f64d1cb9e6",
    expected_trade_name: "ES Biograno Forte",
    classification: "KEEP_INACTIVE",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "HIGH",
    verified_identity: "ES Biograno forte",
    verified_product_type: "complex fertilizer, not a pesticide",
    verified_components: "P2O5, K2O, MgO and organic matter",
    verified_concentrations: "P2O5 >=2.2%; K2O >=1.5%; MgO >=0.5%; organic matter >=3.0%",
    verified_formulation: "Registry fertilizer entry; pesticide formulation is not applicable.",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["ES Biograno Forte", "Эс Биоранo форте"],
    duplicate_decision: "No merge proposed.",
    sources: [sources.biograno],
    reason: "The official registry classifies this product as a complex fertilizer, so it must not remain in ordinary pesticide results.",
    proposed_changes: [
      {
        field: "is_active",
        proposed_value: false,
        reason: "Keep the non-pesticide row out of the ordinary pesticide catalog pending a fertilizer model decision.",
      },
    ],
  },
  {
    product_id: "6398881b-83ce-49dc-9b24-6d15b057135b",
    expected_trade_name: "Анкорал",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Short trade name only.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "UNCONFIRMED",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "UNCONFIRMED",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["Анкорал"],
    duplicate_decision: "No merge proposed.",
    sources: [],
    reason: "No reliable product-specific source was found.",
    proposed_changes: [],
  },
  {
    product_id: "72cff92c-a758-424b-b193-50c3b426555f",
    expected_trade_name: "Caravan SC",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Caravan SC label in the live row is not matched to an official product-specific source.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "The imported quinmerac/chlorotoluron claim is unverified and must not be used.",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "SC appears in the name, but exact product identity is not confirmed.",
    verified_manufacturer: "The live Avgust value is not confirmed by an official matching product page.",
    verified_aliases: ["Caravan SC", "Караван КС"],
    duplicate_decision: "No merge proposed.",
    sources: [],
    reason: "Exact-name searches did not produce a reliable matching label or registry record.",
    proposed_changes: [],
  },
  {
    product_id: "8dcbd003-1621-4ef2-b50c-f9e853a7a4e2",
    expected_trade_name: "Amino Alexin",
    classification: "KEEP_INACTIVE",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "HIGH",
    verified_identity: "Amino Alexin",
    verified_product_type: "foliar fertilizer/biostimulant, not a pesticide",
    verified_components: "P2O5, K2O and free L-alpha amino acids",
    verified_concentrations: "P2O5 30%; K2O 20%; free L-alpha amino acids 4%",
    verified_formulation: "foliar fertilizer product",
    verified_manufacturer: "Bioiberica",
    verified_aliases: ["Amino Alexin", "Аминно Алексин"],
    duplicate_decision: "No merge proposed.",
    sources: [sources.aminoAlexin],
    reason: "A government publication identifies it as a fertilizer/biostimulant, so it must be hidden from ordinary pesticide results.",
    proposed_changes: [
      {
        field: "is_active",
        proposed_value: false,
        reason: "Keep the non-pesticide row out of the ordinary pesticide catalog pending a fertilizer/biostimulant model decision.",
      },
    ],
  },
  {
    product_id: "99354f52-c7ba-411a-ab28-7b27a62b4609",
    expected_trade_name: "Lastik Extra",
    classification: "SAFE_COMPLETE",
    assistant_read_allowed: "YES",
    assistant_recommendation_allowed: "NO",
    confidence: "HIGH",
    verified_identity: "Lastik Extra / Ластик Экстра",
    verified_product_type: "herbicide",
    verified_components: "Fenoxaprop-P-ethyl (active) + cloquintocet-mexyl (safener)",
    verified_concentrations: "70 g/L + 40 g/L",
    verified_formulation: "EC / концентрат эмульсии",
    verified_manufacturer: "Avgust",
    verified_aliases: ["Lastik Extra", "Ластик Экстра"],
    duplicate_decision: "No product merge; reuse the active canonical component and safener rows.",
    sources: [sources.lastik],
    reason: "The manufacturer confirms identity, role-safe composition, concentrations and formulation.",
    proposed_changes: [
      { field: "pesticide_category", proposed_value: "herbicide", reason: "Manufacturer classifies the product as a herbicide." },
      { field: "subcategory", proposed_value: "herbicide", reason: "Remove the incorrect adjuvant/safener category." },
      { field: "formulation_id", proposed_value: "b0fac829-5800-4d89-96ac-0565a51a697b", reason: "Existing EC formulation row." },
      { field: "formulation", proposed_value: "Концентрат эмульсии", reason: "Manufacturer-confirmed formulation." },
      {
        field: "component_links",
        proposed_value: [
          { component_id: "79287e52-50a3-4f2d-88d0-8172b79a13dd", role_in_product: "active", concentration_value: 70, concentration_unit: "g/L" },
          { component_id: "16ea719d-e077-5d8a-bbde-9e90ac8de58f", role_in_product: "safener", concentration_value: 40, concentration_unit: "g/L" },
        ],
        reason: "Manufacturer-confirmed active ingredient and safener.",
      },
    ],
  },
  {
    product_id: "a211ec5c-d068-48c5-8216-7389dc1923d0",
    expected_trade_name: "Мамба",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Ambiguous short trade name only.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "UNCONFIRMED",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "UNCONFIRMED",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["Мамба"],
    duplicate_decision: "No merge proposed.",
    sources: [],
    reason: "The same short name can refer to materially different agricultural products.",
    proposed_changes: [],
  },
  {
    product_id: "a4e046c8-b0e3-464d-b2f1-489cb0932546",
    expected_trade_name: "Праймур, СЭ",
    classification: "SAFE_PARTIAL",
    assistant_read_allowed: "PARTIAL",
    assistant_recommendation_allowed: "NO",
    confidence: "HIGH",
    verified_identity: "Праймур, СЭ",
    verified_product_type: "herbicide",
    verified_components: "2,4-D acid as 2-ethylhexyl ester + florasulam",
    verified_concentrations: "452.42 g/L + 6.25 g/L",
    verified_formulation: "SE / суспензионная эмульсия",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["Праймур, СЭ"],
    duplicate_decision: "No merge proposed.",
    sources: [sources.primeur],
    reason: "Official Kazakhstan sources confirm identity, composition and formulation, but the manufacturer remains unconfirmed.",
    proposed_changes: [
      { field: "formulation", proposed_value: "Суспензионная эмульсия", reason: "The current WDG value conflicts with the official SE record." },
      {
        field: "component_links",
        proposed_value: [
          { component_id: "b23bbd0a-df2a-414d-b793-6b91ba996b20", role_in_product: "active", concentration_value: 452.42, concentration_unit: "g/L", concentration_text: "2,4-D acid as 2-ethylhexyl ester" },
          { component_id: "a03a4041-a0e5-4dac-ae30-5f55e4a922d6", role_in_product: "active", concentration_value: 6.25, concentration_unit: "g/L" },
        ],
        reason: "Official Kazakhstan source confirms both active ingredients and concentrations.",
      },
    ],
  },
  {
    product_id: "a52070b9-bde3-4f78-bff7-c1dde2916d88",
    expected_trade_name: "Агро Голд",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Short trade name only.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "UNCONFIRMED",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "UNCONFIRMED",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["Агро Голд"],
    duplicate_decision: "No merge proposed.",
    sources: [],
    reason: "No reliable product-specific source was found.",
    proposed_changes: [],
  },
  {
    product_id: "a573f3b4-4742-4d7b-bd42-af3b8cf16f41",
    expected_trade_name: "Sunny WDG",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Sunny WDG label is not matched to a reliable product-specific source.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "The imported sulfonylurea guess is rejected as evidence.",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "WDG appears in the name, but exact product identity is not confirmed.",
    verified_manufacturer: "The live Avgust value is not confirmed by an official matching product page.",
    verified_aliases: ["Sunny WDG"],
    duplicate_decision: "No merge proposed.",
    sources: [],
    reason: "No exact official label, registry or manufacturer match was found.",
    proposed_changes: [],
  },
  {
    product_id: "ae4ed6b2-87a4-4bf6-ad70-afd8731c2e96",
    expected_trade_name: "Симба",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Ambiguous short trade name only.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "UNCONFIRMED",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "UNCONFIRMED",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["Симба"],
    duplicate_decision: "No merge proposed.",
    sources: [],
    reason: "No reliable product-specific source was found.",
    proposed_changes: [],
  },
  {
    product_id: "b40abfe2-e5b8-491b-a480-bf5a8fe9d731",
    expected_trade_name: "Region Extra VR",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Exact identity is not proven; possible similarity to another trade name is not sufficient.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "The imported imazapic/imazamox claim is unverified.",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "VR appears in the name, but exact product identity is not confirmed.",
    verified_manufacturer: "The live Avgust value is not confirmed by an official matching product page.",
    verified_aliases: ["Region Extra VR"],
    duplicate_decision: "No typo normalization or merge proposed.",
    sources: [],
    reason: "No reliable exact-name product source was found.",
    proposed_changes: [],
  },
  {
    product_id: "ddf99660-ee6b-43f6-a45b-38b646c96548",
    expected_trade_name: "ES Biofix",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Exact product identity and microbial strain are not proven.",
    verified_product_type: "UNCONFIRMED biological input",
    verified_components: "The imported generic nitrogen-fixing bacteria claim is not product-specific evidence.",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "UNCONFIRMED",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["ES Biofix", "Эс Биофикс"],
    duplicate_decision: "No merge proposed.",
    sources: [],
    reason: "Search results refer to unrelated Biofix products and do not prove this live row.",
    proposed_changes: [],
  },
  {
    product_id: "fa06b3f4-cd6d-4f0a-9ac5-82e2e35e7186",
    expected_trade_name: "Andoral",
    classification: "BLOCKED_NO_DATA",
    assistant_read_allowed: "NO",
    assistant_recommendation_allowed: "NO",
    confidence: "LOW",
    verified_identity: "Exact product identity is not proven.",
    verified_product_type: "UNCONFIRMED",
    verified_components: "UNCONFIRMED",
    verified_concentrations: "UNCONFIRMED",
    verified_formulation: "UNCONFIRMED",
    verified_manufacturer: "UNCONFIRMED",
    verified_aliases: ["Andoral"],
    duplicate_decision: "No spelling normalization or merge proposed.",
    sources: [],
    reason: "No reliable product-specific source was found.",
    proposed_changes: [],
  },
  {
    product_id: "146046ab-5edd-455c-9556-6167cdf50486",
    expected_trade_name: "Дитан",
    classification: "KEEP_SEPARATE",
    assistant_read_allowed: "PARTIAL",
    assistant_recommendation_allowed: "NO",
    confidence: "MEDIUM",
    verified_identity: "The short live name Дитан is not sufficient to identify Dithane M-45.",
    verified_product_type: "fungicide family candidate",
    verified_components: "Dithane M-45 is mancozeb 800 g/kg, but that composition is not assigned to this short row.",
    verified_concentrations: "Candidate only: 800 g/kg mancozeb",
    verified_formulation: "Candidate only: wettable powder",
    verified_manufacturer: "UNCONFIRMED for the short live row",
    verified_aliases: ["Дитан"],
    duplicate_decision: "KEEP SEPARATE from Dithane M-45 until the exact commercial identity is proven.",
    sources: [sources.dithaneCandidate],
    reason: "A reliable Dithane M-45 source exists, but it does not prove that the incomplete Дитан row is that product.",
    proposed_changes: [],
  },
  {
    product_id: "4cb7a4d5-deb6-4f50-aafe-56121518449f",
    expected_trade_name: "Метамил",
    classification: "KEEP_SEPARATE",
    assistant_read_allowed: "PARTIAL",
    assistant_recommendation_allowed: "NO",
    confidence: "MEDIUM",
    verified_identity: "The short live name Метамил is not sufficient to identify Метамил МЦ.",
    verified_product_type: "fungicide family candidate",
    verified_components: "Метамил МЦ is mancozeb + metalaxyl, but that composition is not assigned to this short row.",
    verified_concentrations: "Candidate only: 640 + 80 g/kg",
    verified_formulation: "Candidate only: wettable powder",
    verified_manufacturer: "UNCONFIRMED for the short live row",
    verified_aliases: ["Метамил"],
    duplicate_decision: "KEEP SEPARATE from Метамил МЦ until the exact commercial identity is proven.",
    sources: [sources.metamilCandidate],
    reason: "The registry proves Метамил МЦ, not the incomplete short-name row.",
    proposed_changes: [],
  },
  {
    product_id: "e8fb92fe-4c03-479c-8148-b0ce5b2de85b",
    expected_trade_name: "Курзат",
    classification: "KEEP_SEPARATE",
    assistant_read_allowed: "PARTIAL",
    assistant_recommendation_allowed: "NO",
    confidence: "MEDIUM",
    verified_identity: "The short live name Курзат does not identify a specific product version.",
    verified_product_type: "fungicide family candidate",
    verified_components: "Курзат Р is cymoxanil + copper oxychloride, but that composition is not assigned to this short row.",
    verified_concentrations: "Candidate only: 4.2% + 39.8%",
    verified_formulation: "Candidate only: wettable powder",
    verified_manufacturer: "UNCONFIRMED for the short live row",
    verified_aliases: ["Курзат"],
    duplicate_decision: "KEEP SEPARATE from Курзат Р and other family variants until the exact version is proven.",
    sources: [sources.kurzatCandidate],
    reason: "The manufacturer source proves Курзат Р, not the incomplete family-name row.",
    proposed_changes: [],
  },
];

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLocaleLowerCase("en");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const unique = (values) => Array.from(new Set(values.filter(Boolean)));
const validUrl = (value) => /^https?:\/\/[^\s]+$/iu.test(text(value));
const technicalEmpty = new Set(["", "-", "—", "unknown", "n/a", "na", "none", "null", "неизвестно", "не указан", "не указано"]);
const isEmpty = (value) => technicalEmpty.has(lower(value));
const hasMojibake = (value) => /\uFFFD|(?:Р.|С.){3,}/u.test(text(value));
const normalize = (value) => lower(value).normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = key(row);
    const group = result.get(id) || [];
    group.push(row);
    result.set(id, group);
  }
  return result;
}

function csvValue(value) {
  const raw = Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : String(value ?? "");
  return `"${raw.replaceAll('"', '""')}"`;
}

function toCsv(rows, columns) {
  return `${[columns.map(csvValue).join(","), ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(","))].join("\n")}\n`;
}

async function fetchAll(client, table, select = "*", apply = (query) => query) {
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

function currentValue(product, field) {
  if (field === "component_links") return product.component_links;
  return product[field] ?? null;
}

function recommendationReady(product, readStatus) {
  if (readStatus !== "YES") return false;
  const registration = lower(product.registration_status_kz);
  const registered = registration && !["unknown", "неизвестно", "pending", "requires_review"].includes(registration);
  const usage = Boolean(product.crop_id || text(product.target_crops) || text(product.target_pests));
  const rate = product.application_rate != null || text(product.application_rate_text);
  return Boolean(registered && usage && rate);
}

nextEnv.loadEnvConfig(repoRoot);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Required production read credentials are unavailable");
if (!supabaseUrl.includes(PROJECT_REF)) throw new Error("STOP: wrong Supabase project");

const unresolvedCsv = await readFile(unresolvedPath, "utf8");
const unresolvedIds = unique(unresolvedCsv.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu) || []);
const decisionIds = decisions.map((row) => row.product_id);
const uniqueDecisionIds = new Set(decisionIds);
if (unresolvedIds.length !== 15) throw new Error(`STOP: TZ-181 unresolved expected 15, found ${unresolvedIds.length}`);
if (decisions.length !== EXPECTED_PRODUCTS || uniqueDecisionIds.size !== EXPECTED_PRODUCTS) {
  throw new Error(`STOP: scope expected ${EXPECTED_PRODUCTS}, found rows=${decisions.length}, unique=${uniqueDecisionIds.size}`);
}
if (unresolvedIds.some((id) => !uniqueDecisionIds.has(id))) throw new Error("STOP: a TZ-181 unresolved ID is missing from TZ-196 scope");
if (decisions.some((row) => !STATUS_VALUES.has(row.classification))) throw new Error("STOP: unclassified decision row");

const client = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "x-travkin-audit": "TZ-196-read-only" } },
});

const [products, aliases, manufacturers, formulations, components, componentSources, componentLinks] = await Promise.all([
  fetchAll(client, "products", "*", (query) => query.is("company_id", null).eq("product_type", "pesticide")),
  fetchAll(client, "global_product_aliases"),
  fetchAll(client, "agrochem_manufacturers"),
  fetchAll(client, "agrochem_formulations"),
  fetchAll(client, "glbd_components"),
  fetchAll(client, "glbd_component_sources"),
  fetchAll(client, "glbd_product_components"),
]);

if (products.length !== EXPECTED_GLOBAL_PESTICIDES) {
  throw new Error(`STOP: expected ${EXPECTED_GLOBAL_PESTICIDES} global pesticide cards, found ${products.length}`);
}

const productById = new Map(products.map((row) => [row.id, row]));
const manufacturerById = new Map(manufacturers.map((row) => [row.id, row]));
const formulationById = new Map(formulations.map((row) => [row.id, row]));
const componentById = new Map(components.map((row) => [row.id, row]));
const aliasesByProduct = groupBy(aliases, (row) => row.product_id);
const sourcesByComponent = groupBy(componentSources, (row) => row.component_id);
const linksByProduct = groupBy(
  componentLinks.filter((row) => productById.has(row.product_id) && !["archived", "rejected"].includes(row.review_status)),
  (row) => row.product_id,
);
const decisionById = new Map(decisions.map((row) => [row.product_id, row]));

for (const decision of decisions) {
  const product = productById.get(decision.product_id);
  if (!product) throw new Error(`STOP: missing scoped product ${decision.product_id}`);
  if (text(product.trade_name || product.name) !== decision.expected_trade_name) {
    throw new Error(`STOP: identity drift for ${decision.product_id}: ${text(product.trade_name || product.name)}`);
  }
}

const activeIdentityGroups = groupBy(
  products.filter((row) => row.is_active && !row.archived),
  (row) => normalize(row.trade_name || row.name),
);
const duplicateIdentityIds = new Set(
  Array.from(activeIdentityGroups.values()).filter((rows) => rows.length > 1).flatMap((rows) => rows.map((row) => row.id)),
);

const reviewRows = decisions.map((decision) => {
  const product = productById.get(decision.product_id);
  const productAliases = aliasesByProduct.get(product.id) || [];
  const links = (linksByProduct.get(product.id) || []).map((link) => ({
    ...link,
    component: componentById.get(link.component_id) || null,
  }));
  return {
    product_id: product.id,
    current_trade_name: text(product.trade_name || product.name),
    current_manufacturer: text(manufacturerById.get(product.manufacturer_id)?.name || product.manufacturer) || null,
    current_product_type: product.product_type,
    current_pesticide_category: product.pesticide_category,
    current_formulation: text(formulationById.get(product.formulation_id)?.name_ru || product.formulation || product.product_form) || null,
    current_active_ingredient: text(product.active_ingredient) || null,
    current_aliases: productAliases.map((row) => row.alias).sort(),
    current_component_links: links.map(({ component, ...link }) => ({
      component_id: link.component_id,
      component_name: component?.canonical_name || null,
      role_in_product: link.role_in_product,
      concentration_value: link.concentration_value,
      concentration_unit: link.concentration_unit,
      concentration_text: link.concentration_text,
      source_id: link.source_id,
    })),
    classification: decision.classification,
    assistant_read_allowed: decision.assistant_read_allowed,
    assistant_recommendation_allowed: decision.assistant_recommendation_allowed,
    confidence: decision.confidence,
    verified_identity: decision.verified_identity,
    verified_product_type: decision.verified_product_type,
    verified_components: decision.verified_components,
    verified_concentrations: decision.verified_concentrations,
    verified_formulation: decision.verified_formulation,
    verified_manufacturer: decision.verified_manufacturer,
    verified_aliases: decision.verified_aliases,
    duplicate_decision: decision.duplicate_decision,
    source_count: decision.sources.length,
    sources: decision.sources,
    reason: decision.reason,
    proposed_change_count: decision.proposed_changes.length,
  };
}).sort((left, right) => left.current_trade_name.localeCompare(right.current_trade_name, "ru"));

const applyPreview = decisions
  .filter((decision) => decision.proposed_changes.length)
  .map((decision) => {
    const product = productById.get(decision.product_id);
    const currentLinks = (linksByProduct.get(product.id) || []).map((link) => ({
      component_id: link.component_id,
      role_in_product: link.role_in_product,
      concentration_value: link.concentration_value,
      concentration_unit: link.concentration_unit,
      concentration_text: link.concentration_text,
    }));
    const productWithLinks = { ...product, component_links: currentLinks };
    return {
      product_id: product.id,
      trade_name: text(product.trade_name || product.name),
      classification: decision.classification,
      actions: decision.proposed_changes.map((change) => ({
        field: change.field,
        current_value: currentValue(productWithLinks, change.field),
        proposed_value: change.proposed_value,
        reason: change.reason,
        critical_source_urls: decision.sources.map((source) => source.url),
        risk: change.field === "is_active" ? "MEDIUM - catalog visibility changes" : "MEDIUM - agronomic identity data changes",
        rollback: `Restore ${change.field} from a fresh ID-scoped pre-apply snapshot for product ${product.id}.`,
        owner_approval_required: true,
      })),
    };
  });

const safetyMatrix = products.map((product) => {
  const explicit = decisionById.get(product.id);
  const productAliases = aliasesByProduct.get(product.id) || [];
  const links = (linksByProduct.get(product.id) || []).map((link) => ({ link, component: componentById.get(link.component_id) || null }));
  const visible = Boolean(product.is_active && !product.archived);
  const identity = text(product.trade_name || product.name);
  const manufacturer = text(manufacturerById.get(product.manufacturer_id)?.name || product.manufacturer);
  const formulation = text(formulationById.get(product.formulation_id)?.name_ru || product.formulation || product.product_form);
  const manufacturerReady = !isEmpty(manufacturer);
  const formulationReady = !isEmpty(formulation);
  const linkedComponentsReady = links.length > 0 && links.every(({ component }) => component && component.is_active && !component.archived_at);
  const concentrationsReady = links.length > 0 && links.every(({ link }) => (
    (link.concentration_value != null && !isEmpty(link.concentration_unit)) || !isEmpty(link.concentration_text)
  ));
  const sourcesReady = links.length > 0 && links.every(({ link, component }) => (
    Boolean(link.source_id) || (sourcesByComponent.get(component?.id) || []).some((source) => validUrl(source.source_url || source.url))
  ));
  const searchReady = Boolean(identity && (productAliases.length || product.name_ru || product.name_en || product.normalized_name));
  const duplicateFree = !duplicateIdentityIds.has(product.id);
  const strings = [identity, product.name_ru, product.name_en, manufacturer, formulation, ...productAliases.map((row) => row.alias)];
  const mojibakeFree = !strings.some(hasMojibake);
  const productSourceReady = [product.source_url, product.metadata_source_url].some(validUrl);

  let readStatus;
  let readReason;
  if (explicit) {
    readStatus = explicit.assistant_read_allowed;
    readReason = `TZ-196 source review: ${explicit.reason}`;
  } else if (!visible) {
    readStatus = "NO";
    readReason = "Inactive or archived cards are excluded from normal Assistant reads.";
  } else if (!identity || !duplicateFree || !mojibakeFree) {
    readStatus = "NO";
    readReason = "Identity duplicate, missing identity or mojibake blocks safe reading.";
  } else if (manufacturerReady && formulationReady && linkedComponentsReady && concentrationsReady && sourcesReady && searchReady) {
    readStatus = "YES";
    readReason = "Identity, manufacturer, components, concentrations, formulation, source and search gates pass.";
  } else if (linkedComponentsReady || productSourceReady) {
    readStatus = "PARTIAL";
    readReason = "Existing reviewed product/component data is readable, but at least one GLBD V1 completeness gate remains open.";
  } else {
    readStatus = "NO";
    readReason = "No complete source-backed identity/component path is available to the Assistant.";
  }

  const recommendationAllowed = explicit
    ? explicit.assistant_recommendation_allowed === "YES"
    : recommendationReady(product, readStatus);

  return {
    product_id: product.id,
    trade_name: identity,
    is_active: product.is_active,
    archived: product.archived,
    assistant_read_allowed: readStatus,
    assistant_recommendation_allowed: recommendationAllowed ? "YES" : "NO",
    requires_approved_apply_before_runtime_read: Boolean(
      explicit && explicit.proposed_changes.length && explicit.assistant_read_allowed !== "NO"
    ),
    read_reason: readReason,
    scope_18: Boolean(explicit),
    scope_18_classification: explicit?.classification || null,
    gates: {
      identity: Boolean(identity),
      manufacturer: manufacturerReady,
      components: linkedComponentsReady,
      concentrations: concentrationsReady,
      formulation: formulationReady,
      sources: sourcesReady || productSourceReady,
      aliases_and_search: searchReady,
      duplicate_free: duplicateFree,
      mojibake_free: mojibakeFree,
      visible,
    },
  };
}).sort((left, right) => left.product_id.localeCompare(right.product_id));

const classificationCounts = Object.fromEntries(Array.from(STATUS_VALUES).map((status) => [status, reviewRows.filter((row) => row.classification === status).length]));
const assistantCounts = {
  ASSISTANT_READ_READY: safetyMatrix.filter((row) => row.assistant_read_allowed === "YES").length,
  ASSISTANT_READ_PARTIAL: safetyMatrix.filter((row) => row.assistant_read_allowed === "PARTIAL").length,
  ASSISTANT_BLOCKED: safetyMatrix.filter((row) => row.assistant_read_allowed === "NO").length,
  ASSISTANT_RECOMMENDATION_READY: safetyMatrix.filter((row) => row.assistant_recommendation_allowed === "YES").length,
  ASSISTANT_RECOMMENDATION_BLOCKED: safetyMatrix.filter((row) => row.assistant_recommendation_allowed === "NO").length,
};

const previewComponentPairs = applyPreview.flatMap((row) => row.actions)
  .filter((action) => action.field === "component_links")
  .flatMap((action) => action.proposed_value.map((link) => `${link.component_id}:${link.role_in_product}`));
const duplicatePreview = previewComponentPairs.length - new Set(previewComponentPairs).size;
const criticalActions = applyPreview.flatMap((row) => row.actions).filter((action) => ["formulation", "formulation_id", "component_links", "is_active", "pesticide_category", "subcategory"].includes(action.field));
const criticalActionsWithSource = criticalActions.filter((action) => action.critical_source_urls.length).length;
const fingerprint = sha256(JSON.stringify({ reviewRows, applyPreview, safetyMatrix, assistantCounts }));

const summary = {
  task: TASK,
  generated_at: new Date().toISOString(),
  mode: "READ_ONLY_PRODUCTION_AUDIT_AND_APPLY_PREVIEW",
  project_ref: PROJECT_REF,
  production_writes: 0,
  products_expected: EXPECTED_PRODUCTS,
  products_reviewed: reviewRows.length,
  unique_product_ids: uniqueDecisionIds.size,
  unclassified: reviewRows.filter((row) => !STATUS_VALUES.has(row.classification)).length,
  global_pesticides_audited: products.length,
  global_pesticides_active_unarchived: products.filter((row) => row.is_active && !row.archived).length,
  global_pesticides_inactive_or_archived: products.filter((row) => !row.is_active || row.archived).length,
  classifications: classificationCounts,
  assistant_safety: assistantCounts,
  quality_gates: {
    critical_facts_with_source_percent: criticalActions.length ? Math.round((criticalActionsWithSource / criticalActions.length) * 100) : 100,
    critical_actions: criticalActions.length,
    critical_actions_with_source: criticalActionsWithSource,
    guessed_compositions: 0,
    guessed_formulations: 0,
    merges_executed: 0,
    duplicate_preview: duplicatePreview,
    alias_conflicts_preview: 0,
    production_writes: 0,
  },
  glbd_v1_ready_for_assistant_read: "YES_WITH_SAFETY_MATRIX_AND_BLOCKLIST",
  assistant_runtime_read_pending_approved_apply: safetyMatrix.filter((row) => row.requires_approved_apply_before_runtime_read).length,
  a110_gate: "CAN_START_READ_ONLY_WITH_MATRIX; EXCLUDE READ=NO AND REQUIRES_APPROVED_APPLY ROWS",
  glbd_ready_for_agronomic_recommendations: assistantCounts.ASSISTANT_RECOMMENDATION_BLOCKED === 0 ? "YES" : "NO",
  safe_apply_preview_products: applyPreview.length,
  blocked_no_data: classificationCounts.BLOCKED_NO_DATA,
  audit_fingerprint_sha256: fingerprint,
};

const csvColumns = [
  "product_id", "current_trade_name", "current_manufacturer", "current_product_type", "current_pesticide_category",
  "current_formulation", "current_active_ingredient", "current_aliases", "current_component_links", "classification",
  "assistant_read_allowed", "assistant_recommendation_allowed", "confidence", "verified_identity", "verified_product_type",
  "verified_components", "verified_concentrations", "verified_formulation", "verified_manufacturer", "verified_aliases",
  "duplicate_decision", "source_count", "sources", "reason", "proposed_change_count",
];

const ownerDecisions = `# TZ-196 owner decisions

Production was not changed. The preview contains only ID-scoped, source-backed changes.

## Ready for a later approved apply

1. **Lastik Extra** - correct the product from adjuvant to herbicide, set EC formulation, add fenoxaprop-P-ethyl 70 g/L and cloquintocet-mexyl safener 40 g/L.
2. **Праймур, СЭ** - correct WDG to suspension emulsion and add 2,4-D ester 452.42 g/L plus florasulam 6.25 g/L. Manufacturer still remains unconfirmed, so Assistant read stays PARTIAL.
3. **Amino Alexin** - make inactive in the pesticide catalog; the source identifies a fertilizer/biostimulant.
4. **ES Biograno Forte** - make inactive in the pesticide catalog; the Kazakhstan registry identifies a complex fertilizer.

Suggested owner response: \`APPROVE SAFE PREVIEW\`, \`HOLD\`, or list card numbers to exclude.

## Keep separate

- **Дитан** is not automatically Dithane M-45.
- **Метамил** is not automatically Метамил МЦ.
- **Курзат** is not automatically Курзат Р.

No merge or composition transfer is proposed for these three rows.

## Still blocked

Ten cards have no reliable product-specific identity/composition source. Keep them blocked until a label, manufacturer, registry or official distributor record is supplied.
`;

const files = new Map([
  ["remaining_18_review.csv", toCsv(reviewRows, csvColumns)],
  ["remaining_18_review.json", `${JSON.stringify(reviewRows, null, 2)}\n`],
  ["assistant_safety_matrix.json", `${JSON.stringify(safetyMatrix, null, 2)}\n`],
  ["safe_apply_preview.json", `${JSON.stringify(applyPreview, null, 2)}\n`],
  ["owner_decisions.md", ownerDecisions],
  ["blocked_no_data.csv", toCsv(reviewRows.filter((row) => row.classification === "BLOCKED_NO_DATA"), csvColumns)],
  ["glbd_v1_readiness_summary.json", `${JSON.stringify(summary, null, 2)}\n`],
]);

await mkdir(outputDir, { recursive: true });
for (const [name, content] of files) await writeFile(path.join(outputDir, name), content, "utf8");
const manifestFiles = (await readdir(outputDir)).filter((name) => name !== "manifest.sha256").sort();
const manifest = [];
for (const name of manifestFiles) manifest.push(`${sha256(await readFile(path.join(outputDir, name)))}  ${name}`);
await writeFile(path.join(outputDir, "manifest.sha256"), `${manifest.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  task: TASK,
  output_dir: outputDir,
  products_reviewed: reviewRows.length,
  unique_product_ids: uniqueDecisionIds.size,
  classifications: classificationCounts,
  assistant_safety: assistantCounts,
  quality_gates: summary.quality_gates,
  audit_fingerprint_sha256: fingerprint,
}, null, 2));
