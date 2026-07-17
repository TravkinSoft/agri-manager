import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { buildProductSearchText, normalizeCatalogName } from "../../lib/catalog/catalog-identity.ts";

const TASK = "TZ-181";
const PROJECT_REF = "bhsemlvmkikpntabctml";
const EXPECTED_INPUT_FINGERPRINT = "2d74a26055cbad5a1466b591dc77ffc2926364ccafa06cf2d26f44f05401f696";
const EXPECTED_GLBD = { components: 431, aliases: 63, sources: 318, links: 1373, companyLinks: 0 };
const EXPECTED_PRODUCTS = 45;
const VALID_STATUSES = new Set([
  "SAFE_FILL_COMPONENTS",
  "SAFE_FILL_FORMULATION",
  "SAFE_ADD_ALIAS",
  "SAFE_FIX_SEARCH",
  "SAFE_IDENTITY_NORMALIZE",
  "KEEP_SEPARATE",
  "KEEP_INACTIVE",
  "NEED_OWNER_DECISION",
  "UNRESOLVED",
]);

const repoRoot = process.cwd();
const auditRoot = path.resolve(repoRoot, "..", "..", "audit-output");
const inputDir = path.join(auditRoot, "TZ-180");
const outputDir = path.join(auditRoot, TASK);

nextEnv.loadEnvConfig(repoRoot);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Required production read credentials are unavailable");
if (!supabaseUrl.includes(PROJECT_REF)) throw new Error("STOP: wrong Supabase project");

const client = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "x-travkin-audit": "TZ-181-read-only" } },
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const text = (value) => String(value ?? "").trim();
const normalize = (value) => normalizeCatalogName(text(value));
const unique = (values) => Array.from(new Set(values.filter(Boolean)));
const sorted = (rows, key = "id") => [...rows].sort((left, right) => text(left[key]).localeCompare(text(right[key])));

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quoted) {
      if (char === '"' && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
}

function csvCell(value) {
  const raw = Array.isArray(value) ? value.join("; ") : typeof value === "object" && value !== null ? JSON.stringify(value) : text(value);
  return `"${raw.replace(/"/gu, '""')}"`;
}

function toCsv(rows, columns) {
  return `${columns.map(csvCell).join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

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

async function verifyInputManifest() {
  const manifest = await readFile(path.join(inputDir, "manifest.sha256"), "utf8");
  const errors = [];
  for (const line of manifest.trim().split(/\r?\n/u)) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/u);
    if (!match) {
      errors.push(`invalid manifest line: ${line}`);
      continue;
    }
    const [, expected, name] = match;
    const actual = sha256(await readFile(path.join(inputDir, name)));
    if (actual !== expected) errors.push(`${name}: expected ${expected}, found ${actual}`);
  }
  if (errors.length) throw new Error(`STOP: TZ-180 manifest failed: ${errors.join(" | ")}`);
}

const SOURCES = {
  gardo: {
    type: "manufacturer",
    name: "Syngenta Kazakhstan - Gardo Gold",
    url: "https://www.syngenta.kz/en/product/crop-protection/gardo-gold",
  },
  paradox: { type: "manufacturer", name: "Avgust - Paradox", url: "https://avgust.com/products/rf/paradoks/" },
  milagroTribute: {
    type: "official_registry",
    name: "Kazakhstan subsidized pesticide registry 2026",
    url: "https://www.adilet.zan.kz/rus/docs/G26N000123A",
  },
  kolossal: { type: "manufacturer", name: "Avgust - Kolossal Pro", url: "https://www.avgust.com/products/rf/kolosal_pro/" },
  karate: {
    type: "manufacturer",
    name: "Syngenta Kazakhstan - Karate Zeon",
    url: "https://www.syngenta.kz/product/crop-protection/insektoakaricidy/karate-zeon",
  },
  gramminion: { type: "manufacturer", name: "Avgust - Gramminion", url: "https://www.avgust.com/products/rf/graminion/" },
  herbitox: { type: "manufacturer", name: "Avgust - Herbitox", url: "https://www.avgust.com/products/rf/gerbitoks/" },
  hacker: { type: "manufacturer", name: "Avgust - Hacker 300", url: "https://www.avgust.com/products/rf/khaker-300/" },
  mustang: {
    type: "manufacturer",
    name: "Corteva - Mustang",
    url: "https://www.corteva.com/es/productos-y-soluciones/proteccion-de-cultivos/mustang.html",
  },
  goldenDragon: {
    type: "official_registry",
    name: "Kazakhstan pesticide registry - Golden Dragon",
    url: "https://www.gov.kz/uploads/2023/6/29/8e52656aa59785e2e96a2c8552b0bed0_original.6035945.pdf",
  },
  tilt: { type: "manufacturer", name: "Syngenta Kazakhstan - Tilt", url: "https://www.syngenta.kz/product/crop-protection/fungicidy/tilt" },
  efir: {
    type: "official_registry",
    name: "Kazakhstan pesticide registry - Efir 960",
    url: "https://www.gov.kz/uploads/2024/5/15/64ca31bc7e317a46172347fe273df8a2_original.3585922.pdf",
  },
  sprut: {
    type: "manufacturer",
    name: "Schelkovo Agrohim - Sprut Extra",
    url: "https://eng.betaren.ru/catalog/pesticides/herbicides/sprut_ekstra_vr/",
  },
  gezagard: {
    type: "manufacturer",
    name: "Syngenta Kazakhstan - Gezagard",
    url: "https://www.syngenta.kz/product/crop-protection/gerbicidy-i-desikanty/gezagard",
  },
  borei: { type: "manufacturer", name: "Avgust - Borei", url: "https://www.avgust.com/products/rf/borey/" },
  oplot: { type: "manufacturer", name: "Avgust - Oplot Trio", url: "https://avgust.com/products/rf/oplot_trio/" },
  ampligo: {
    type: "official_label",
    name: "Syngenta Kazakhstan - Ampligo label",
    url: "https://www.syngenta.kz/sites/g/files/kgtney1456/files/media/document/2023/09/07/ampligo_2022.pdf",
  },
  virtuos: { type: "official_registry", name: "Kazakhstan registry - Virtuos WDG", url: "https://adilet.zan.kz/rus/docs/V16P0005173" },
  celest: {
    type: "official_label",
    name: "Syngenta - Celest Top label",
    url: "https://www.syngenta.co.za/sites/g/files/kgtney1636/files/media/document/2021/01/19/celest_top_-_eng_-.pdf",
  },
  ditan: { type: "manufacturer", name: "Corteva - Dithane M-45", url: "https://www.corteva.com/rs/proizvodi/zastita-bilja/dithane-m45.html" },
  ordan: { type: "manufacturer", name: "Avgust - Ordan", url: "https://avgust.com/products/rf/ordan/" },
  cassius: { type: "official_registry", name: "Kazakhstan registry - Cassius", url: "https://adilet.zan.kz/rus/docs/G26N000123A" },
  kurzat: {
    type: "manufacturer",
    name: "Corteva Kazakhstan - Kurzat R",
    url: "https://www.kz.corteva.com/content/dam/dpagco/corteva/as/kz/ru/files/Kurzat_web.pdf",
  },
  registry2025: {
    type: "official_registry",
    name: "Kazakhstan pesticide registry 2025",
    url: "https://www.gov.kz/uploads/2025/4/29/ee32a5ae573725df5e9a7b477e8c2c7c_original.4511398.pdf",
  },
};

const COMPONENT = {
  sMetolachlor: { component_id: "45d60879-4da8-4575-8614-de9959b7b477", name_ru: "С-метолахлор", name_en: "S-metolachlor" },
  terbuthylazine: { component_id: "fc3558d6-7169-436c-bcb9-37eceff78a44", name_ru: "Тербутилазин", name_en: "Terbuthylazine" },
  imidacloprid: { component_id: "f9b24a4f-3d76-40ae-a401-8b8264b6ea61", name_ru: "Имидаклоприд", name_en: "Imidacloprid" },
  lambdaCyhalothrin: { component_id: "e166c5ea-e04a-4b2c-bf21-ff9ad26a1776", name_ru: "Лямбда-цигалотрин", name_en: "Lambda-cyhalothrin" },
  propiconazole: { component_id: "3233aa4e-3f0f-4aee-bc24-ba0f72947cf9", name_ru: "Пропиконазол", name_en: "Propiconazole" },
  tebuconazole: { component_id: "64a1fb1e-11d4-42a0-9b46-de5d1ea15648", name_ru: "Тебуконазол", name_en: "Tebuconazole" },
  difenoconazole: { component_id: "84021071-909d-4d9c-9fd4-ca15eb9ec01d", name_ru: "Дифеноконазол", name_en: "Difenoconazole" },
  azoxystrobin: { component_id: "2868fe5a-03f8-48d9-a1a1-137876c3fe8a", name_ru: "Азоксистробин", name_en: "Azoxystrobin" },
  clopyralid: { component_id: "02cbf472-0bb1-4ec4-9898-1b55c6141f0e", name_ru: "Клопиралид", name_en: "Clopyralid" },
  bentazone: { component_id: "c88832b3-386c-41f2-9663-ad134191349d", name_ru: "Бентазон", name_en: "Bentazone" },
  glyphosate: { component_id: "8ec57af9-492b-402d-98e4-a123611968a2", name_ru: "Глифосат", name_en: "Glyphosate" },
  twoFourDEster: { component_id: "402c03ff-6625-4e7f-8363-391d3fb64c62", name_ru: "2,4-Д (2-этилгексиловый эфир)", name_en: "2,4-D 2-ethylhexyl ester" },
  chlorantraniliprole: { component_id: "34f91769-0bdb-4de0-8f22-27926378992e", name_ru: "Хлорантранилипрол", name_en: "Chlorantraniliprole" },
  prometryn: { component_id: null, name_ru: "Прометрин", name_en: "Prometryn", normalized_key: "prometryn" },
};

const c = (component, concentration_value, concentration_unit, extra = {}) => ({
  ...component,
  role_in_product: "active",
  concentration_value,
  concentration_unit,
  ...extra,
});

const DECISIONS = [
  {
    product_id: "0b2f6da7-11eb-42d4-8d06-83891596e337",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "Manufacturer confirms the two missing active ingredients and concentrations.",
    components: [c(COMPONENT.sMetolachlor, 312.5, "g/L"), c(COMPONENT.terbuthylazine, 187.5, "g/L")],
    source: SOURCES.gardo,
  },
  { product_id: "0d61fc1b-6f47-4ff8-9bab-bc4e02e10b86", status: "UNRESOLVED", group: "UNRESOLVED", reason: "No reliable product-specific pesticide composition source was found; the name is compatible with multiple amino products." },
  {
    product_id: "146046ab-5edd-455c-9556-6167cdf50486",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "The short record may be Dithane M-45, but identity consolidation cannot be automatic.",
    owner_option: "Confirm whether this row is the same product as Dithane M-45; if yes, normalize/merge only after snapshot approval.",
    candidate_fact: "Mancozeb 800 g/kg; WP",
    source: SOURCES.ditan,
  },
  { product_id: "1a08e48e-a125-4df9-bb1e-342890dbb3b4", status: "SAFE_FIX_SEARCH", group: "SAFE_AUTO_APPLY", reason: "Composition is already linked; the stored RU name and aliases are omitted by the current search read path.", search_fix: true, source: SOURCES.paradox },
  { product_id: "2190ccbb-fdfb-4188-8da0-2819308a791b", status: "UNRESOLVED", group: "UNRESOLVED", reason: "The name Expert matches several different registered products; no product-specific identity can be selected safely." },
  {
    product_id: "23614151-4c1f-4243-8f8e-621e9eb285c6",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "The current record models potassium salt as a second active component. Parent/form normalization needs an explicit component-model decision.",
    owner_option: "Keep one glyphosate active ingredient and represent potassium salt as equivalent basis/form only after owner approval.",
    search_fix: true,
  },
  { product_id: "23659e98-0bfc-441a-963f-01f3069275dc", status: "SAFE_FIX_SEARCH", group: "SAFE_AUTO_APPLY", reason: "Source-verified links already exist; the RU alias is omitted by the current search read path.", search_fix: true, source: SOURCES.milagroTribute },
  {
    product_id: "36724851-93b2-4584-ae1f-63f315ba9999",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "Manufacturer confirms the missing two-component composition; the imported 150+60 text is stale and must not be reused.",
    components: [c(COMPONENT.propiconazole, 300, "g/L"), c(COMPONENT.tebuconazole, 200, "g/L")],
    source: SOURCES.kolossal,
    search_fix: true,
  },
  { product_id: "38d339c2-2afc-455b-b678-f37faf7fd355", status: "SAFE_FIX_SEARCH", group: "SAFE_AUTO_APPLY", reason: "The verified three-component links already exist; stored aliases must be included in search.", search_fix: true, source: SOURCES.milagroTribute },
  { product_id: "4a210859-7fd6-461a-84cb-f9f64d1cb9e6", status: "UNRESOLVED", group: "UNRESOLVED", reason: "The record appears biological, but no reliable strain/product source identifies a safe pesticide component model." },
  {
    product_id: "4b8bcde0-617a-4922-88a9-ef13f3122851",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "Manufacturer confirms the missing active ingredient, concentration and suspension form.",
    components: [c(COMPONENT.lambdaCyhalothrin, 50, "g/L")],
    formulation: { canonical_code: "SC", official_text: "с.к. (суспензионный концентрат)" },
    source: SOURCES.karate,
  },
  {
    product_id: "4cb7a4d5-deb6-4f50-aafe-56121518449f",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "The official registry contains Metamil MC, but the short imported name does not prove that identity.",
    owner_option: "Confirm identity with METAMIL MC before filling composition or merging.",
    candidate_fact: "Mancozeb 640 g/kg + metalaxyl 80 g/kg; WP",
    source: SOURCES.registry2025,
  },
  { product_id: "5b54f523-a278-432b-b34f-a6934a62c30e", status: "SAFE_FIX_SEARCH", group: "SAFE_AUTO_APPLY", reason: "The active component link exists; the RU alias is omitted by the search read path.", search_fix: true, source: SOURCES.gramminion },
  { product_id: "6398881b-83ce-49dc-9b24-6d15b057135b", status: "UNRESOLVED", group: "UNRESOLVED", reason: "No authoritative product source was found for this exact spelling; it may be a typo or a distinct trade name." },
  { product_id: "6aa78145-f5e7-486d-bcea-14015707e141", status: "SAFE_FIX_SEARCH", group: "SAFE_AUTO_APPLY", reason: "The verified component link exists; the RU alias is omitted by the search read path.", search_fix: true, source: SOURCES.herbitox },
  {
    product_id: "70895dae-57c0-4421-b2b7-ef22cdc01b9c",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "Manufacturer confirms the missing clopyralid composition and aqueous-solution formulation.",
    components: [c(COMPONENT.clopyralid, 300, "g/L")],
    formulation: { canonical_code: "SL", official_text: "водный раствор" },
    source: SOURCES.hacker,
  },
  { product_id: "72cff92c-a758-424b-b193-50c3b426555f", status: "UNRESOLVED", group: "UNRESOLVED", reason: "Caravan SC is used by unrelated biological and chemical products in different markets; manufacturer identity is missing." , search_fix: true },
  {
    product_id: "84724bc9-8618-46ce-8914-7b2c8fbc2590",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "Both Celest rows match the same official three-component product identity, but automatic merge is forbidden.",
    owner_option: "Choose survivor Celest Top after snapshot; preserve Russian name as alias and relink only with explicit approval.",
    candidate_fact: "Fludioxonil 25 + difenoconazole 25 + thiamethoxam 262.5 g/L; FS/SC seed-treatment suspension",
    source: SOURCES.celest,
  },
  { product_id: "8dcbd003-1621-4ef2-b50c-f9e853a7a4e2", status: "UNRESOLVED", group: "UNRESOLVED", reason: "No reliable product-specific pesticide source was found; the name suggests a nutrition/biostimulant product." , search_fix: true },
  { product_id: "96975341-3cb9-4a65-94f8-2595ffae5c8f", status: "SAFE_FIX_SEARCH", group: "SAFE_AUTO_APPLY", reason: "The verified two-component links already exist; the RU alias is omitted by the search read path.", search_fix: true, source: SOURCES.mustang },
  {
    product_id: "97bfe9c5-561e-4d8f-bc25-935a0b233c6a",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "The official Kazakhstan registry uniquely confirms bentazone and the aqueous-solution form for this exact trade name.",
    components: [c(COMPONENT.bentazone, 480, "g/L")],
    formulation: { canonical_code: "SL", official_text: "водный раствор" },
    source: SOURCES.goldenDragon,
  },
  { product_id: "99354f52-c7ba-411a-ab28-7b27a62b4609", status: "UNRESOLVED", group: "UNRESOLVED", reason: "The exact product and role are not source-confirmed; it may be an adjuvant/safener rather than a pesticide active product." , search_fix: true },
  { product_id: "9b96af77-12b7-451b-890f-1589412f04a6", status: "KEEP_INACTIVE", group: "SAFE_AUTO_APPLY", reason: "The record explicitly identifies itself as nonexistent test/technical data; no product identity change is proposed." },
  { product_id: "a029e1de-b3a6-4c28-8381-9fead5276527", status: "SAFE_FIX_SEARCH", group: "SAFE_AUTO_APPLY", reason: "The verified propiconazole link and formulation already exist; the RU name/aliases are omitted by search.", search_fix: true, source: SOURCES.tilt },
  {
    product_id: "a0eefe8e-74c3-4499-bd6b-7a43573ee6de",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "The short row matches the official Ordan product and an existing full catalog row, but merge/normalization requires owner approval.",
    owner_option: "Confirm survivor Ordan, preserve the short label as alias, then relink only after snapshot approval.",
    candidate_fact: "Copper oxychloride 689 g/kg + cymoxanil 42 g/kg; WP",
    source: SOURCES.ordan,
  },
  { product_id: "a211ec5c-d068-48c5-8216-7389dc1923d0", status: "UNRESOLVED", group: "UNRESOLVED", reason: "The short name Mamba is used by multiple pesticide identities; the current row lacks manufacturer and formulation evidence." },
  { product_id: "a4e046c8-b0e3-464d-b2f1-489cb0932546", status: "UNRESOLVED", group: "UNRESOLVED", reason: "The available distributor note does not identify active ingredients reliably enough for a component proposal." },
  { product_id: "a52070b9-bde3-4f78-bff7-c1dde2916d88", status: "UNRESOLVED", group: "UNRESOLVED", reason: "No reliable source identifies this exact trade name and composition; similar Gold products are not evidence." },
  { product_id: "a573f3b4-4742-4d7b-bd42-af3b8cf16f41", status: "UNRESOLVED", group: "UNRESOLVED", reason: "The name and WG form are insufficient to identify a unique product or composition." , search_fix: true },
  {
    product_id: "a95f13a4-e8e1-48e7-8154-c96798a86667",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "The Kazakhstan registry confirms 2,4-D acid as 2-ethylhexyl ester at 960 g/L and EC formulation.",
    components: [c(COMPONENT.twoFourDEster, 960, "g/L")],
    source: SOURCES.efir,
    search_fix: true,
  },
  {
    product_id: "ac5415b7-6f10-4e05-98bb-6299799329a7",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "The official registry confirms Fungotseb 80% WP, but the short row duplicates an existing full catalog identity.",
    owner_option: "Confirm the full Fungotseb 80% WP row as survivor; no automatic merge.",
    candidate_fact: "Mancozeb 800 g/kg; WP",
    source: SOURCES.registry2025,
  },
  { product_id: "ae4ed6b2-87a4-4bf6-ad70-afd8731c2e96", status: "UNRESOLVED", group: "UNRESOLVED", reason: "The short name Simba is not a unique pesticide identity and no reliable product-specific source was found." },
  { product_id: "b40abfe2-e5b8-491b-a480-bf5a8fe9d731", status: "UNRESOLVED", group: "UNRESOLVED", reason: "No authoritative source was found for this exact Region Extra VR identity and composition." , search_fix: true },
  {
    product_id: "bccd7355-4b20-40e2-8f48-ebbc13cee0ef",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "The record appears to be a humic/biostimulant product and should not receive pesticide active ingredients without reclassification approval.",
    owner_option: "Decide whether to move outside pesticide scope or keep inactive; do not create pesticide components.",
    search_fix: true,
  },
  {
    product_id: "c329cccc-b9e8-4181-a723-a6a5acbe0607",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "Manufacturer confirms glyphosate acid/potassium salt 540 g/L; potassium salt is equivalent basis, not a second active ingredient.",
    components: [c(COMPONENT.glyphosate, 540, "g/L", { equivalent_basis: "potassium salt" })],
    source: SOURCES.sprut,
    search_fix: true,
  },
  {
    product_id: "c51203f8-0e96-47f0-b087-d7b789892927",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "This is the Russian duplicate candidate of Celest Top; same official composition, no automatic merge.",
    owner_option: "If approved, preserve Селест Топ, КС as RU alias of the selected survivor.",
    candidate_fact: "Fludioxonil 25 + difenoconazole 25 + thiamethoxam 262.5 g/L; FS/SC seed-treatment suspension",
    source: SOURCES.celest,
  },
  {
    product_id: "d4931200-027c-412b-8a41-c0857cb4e9c2",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "Manufacturer confirms prometryn 500 g/L and SC. No active component with this normalized identity exists, so preview includes one new canonical component plus one link.",
    components: [c(COMPONENT.prometryn, 500, "g/L")],
    source: SOURCES.gezagard,
    search_fix: true,
  },
  {
    product_id: "d4f981e2-322b-47fb-888e-0d3a37f595cd",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "Manufacturer confirms imidacloprid plus lambda-cyhalothrin; the imported alpha-cypermethrin value belongs to Borei Neo and is rejected.",
    components: [c(COMPONENT.imidacloprid, 150, "g/L"), c(COMPONENT.lambdaCyhalothrin, 50, "g/L")],
    source: SOURCES.borei,
    search_fix: true,
  },
  { product_id: "ddf99660-ee6b-43f6-a45b-38b646c96548", status: "UNRESOLVED", group: "UNRESOLVED", reason: "A product-specific microbial organism/strain source was not found; biological components must not be guessed." , search_fix: true },
  {
    product_id: "e23b0f3b-3aea-4679-9ab2-f836751d7087",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "Manufacturer confirms the missing three-component composition.",
    components: [c(COMPONENT.difenoconazole, 90, "g/L"), c(COMPONENT.tebuconazole, 45, "g/L"), c(COMPONENT.azoxystrobin, 40, "g/L")],
    source: SOURCES.oplot,
    search_fix: true,
  },
  {
    product_id: "e2860329-5f3c-4f2b-97c2-c108fe721ebc",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "Official records confirm Cassius 250 g/kg, but the short row overlaps an existing Cassius, VRP identity.",
    owner_option: "Confirm survivor and preserve the short name as alias before any merge.",
    candidate_fact: "Rimsulfuron 250 g/kg; water-soluble powder",
    source: SOURCES.cassius,
  },
  {
    product_id: "e8fb92fe-4c03-479c-8148-b0ce5b2de85b",
    status: "NEED_OWNER_DECISION",
    group: "OWNER_APPROVAL_REQUIRED",
    reason: "Kurzat is a product family/short name; the source proves Kurzat R but not that this row must be merged into it.",
    owner_option: "Confirm whether this row is Kurzat R before normalization.",
    candidate_fact: "Copper oxychloride 689.5 g/kg + cymoxanil 42 g/kg; WP",
    source: SOURCES.kurzat,
  },
  {
    product_id: "e919a98f-649c-40ec-ac7b-a24b21c2b724",
    status: "SAFE_FILL_COMPONENTS",
    group: "SAFE_AUTO_APPLY",
    reason: "The official label confirms the missing two-component composition and microencapsulated suspension form.",
    components: [c(COMPONENT.chlorantraniliprole, 100, "g/L"), c(COMPONENT.lambdaCyhalothrin, 50, "g/L")],
    formulation: { canonical_code: "CS", official_text: "микрокапсулированная суспензия" },
    source: SOURCES.ampligo,
  },
  { product_id: "f224cfdc-9bab-4627-9768-9df5671c9b43", status: "SAFE_FIX_SEARCH", group: "SAFE_AUTO_APPLY", reason: "The verified clopyralid link already exists; the RU alias is omitted by the search read path.", search_fix: true, source: SOURCES.virtuos },
  { product_id: "fa06b3f4-cd6d-4f0a-9ac5-82e2e35e7186", status: "UNRESOLVED", group: "UNRESOLVED", reason: "No authoritative source was found for the exact Andoral identity; possible spelling similarity is not merge evidence." },
];

function productLabel(product) {
  return text(product.trade_name || product.name || product.normalized_name);
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = typeof key === "function" ? key(row) : row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

const FORM_CODE_EQUIVALENTS = {
  SC: new Set(["sc", "кс", "кc", "с к", "суспензионныйконцентрат", "концентратсуспензии"]),
  SL: new Set(["sl", "вр", "врк", "водныйраствор", "водорастворимыйконцентрат"]),
  CS: new Set(["cs", "мкс", "микрокапсулированнаясуспензия", "микрокапсульнаясуспензия"]),
};

function resolveFormulation(formulations, proposal) {
  if (!proposal) return null;
  const accepted = FORM_CODE_EQUIVALENTS[proposal.canonical_code];
  const matches = formulations.filter((row) => {
    if (row.archived || row.is_active === false) return false;
    const values = [row.code, row.name_ru, row.name_en].map(normalize);
    return values.some((value) => accepted.has(value));
  });
  if (matches.length !== 1) {
    return { ...proposal, canonical_formulation_id: null, resolution: `BLOCKED_${matches.length}_CANONICAL_MATCHES`, matches: matches.map((row) => row.id) };
  }
  return { ...proposal, canonical_formulation_id: matches[0].id, canonical_name_ru: matches[0].name_ru, resolution: "LINK_EXISTING" };
}

function previewSearchMatch(product, query, searchIndex) {
  const needle = normalize(query);
  return (searchIndex.get(product.id) || []).some((value) => value.includes(needle));
}

async function getSnapshot() {
  const [products, aliases, formulations, components, componentAliases, componentSources, productComponents] = await Promise.all([
    fetchAll(
      "products",
      "id,name,trade_name,normalized_name,name_ru,name_en,company_id,manufacturer,product_type,type,category,subcategory,pesticide_category,fertilizer_type,notes,formulation,formulation_id,archived,is_active,updated_at",
      (query) => query.is("company_id", null).eq("archived", false),
    ),
    fetchAll("global_product_aliases"),
    fetchAll("agrochem_formulations"),
    fetchAll("glbd_components"),
    fetchAll("glbd_component_aliases"),
    fetchAll("glbd_component_sources"),
    fetchAll("glbd_product_components"),
  ]);
  const globalProductIds = new Set(products.map((row) => row.id));
  const counts = {
    components: components.length,
    aliases: componentAliases.length,
    sources: componentSources.length,
    links: productComponents.length,
    companyLinks: productComponents.filter((row) => !globalProductIds.has(row.product_id)).length,
  };
  const fingerprint = sha256(stableStringify({
    products: sorted(products),
    aliases: sorted(aliases),
    formulations: sorted(formulations),
    components: sorted(components),
    componentAliases: sorted(componentAliases),
    componentSources: sorted(componentSources),
    productComponents: sorted(productComponents),
  }));
  return { products, aliases, formulations, components, componentAliases, componentSources, productComponents, counts, fingerprint };
}

await verifyInputManifest();
console.error("TZ-181 stage: input manifest verified");
const readiness = JSON.parse(await readFile(path.join(inputDir, "readiness_summary.json"), "utf8"));
if (readiness.audit_fingerprint_sha256 !== EXPECTED_INPUT_FINGERPRINT) throw new Error("STOP: TZ-180 audit fingerprint drift");
const auditRows = JSON.parse(await readFile(path.join(inputDir, "pesticide_cards_audit.json"), "utf8"));
const inputRows = auditRows.filter((row) => row.batch === "BATCH_1_P0").sort((left, right) => left.product_id.localeCompare(right.product_id));
if (inputRows.length !== EXPECTED_PRODUCTS) throw new Error(`STOP: expected ${EXPECTED_PRODUCTS} Batch 1 rows, found ${inputRows.length}`);
if (new Set(inputRows.map((row) => row.product_id)).size !== EXPECTED_PRODUCTS) throw new Error("STOP: duplicate Batch 1 input rows");
if (DECISIONS.length !== EXPECTED_PRODUCTS || new Set(DECISIONS.map((row) => row.product_id)).size !== EXPECTED_PRODUCTS) {
  throw new Error("STOP: decisions must contain exactly 45 unique products");
}
const decisionById = new Map(DECISIONS.map((row) => [row.product_id, row]));
for (const input of inputRows) {
  if (!decisionById.has(input.product_id)) throw new Error(`STOP: unclassified product ${input.product_id}`);
}
for (const decision of DECISIONS) {
  if (!VALID_STATUSES.has(decision.status)) throw new Error(`STOP: invalid status ${decision.status}`);
  if (!inputRows.some((row) => row.product_id === decision.product_id)) throw new Error(`STOP: out-of-scope decision ${decision.product_id}`);
}

console.error("TZ-181 stage: exact 45-card scope verified");
const before = await getSnapshot();
console.error("TZ-181 stage: production before-snapshot captured");
for (const [key, expected] of Object.entries(EXPECTED_GLBD)) {
  if (before.counts[key] !== expected) throw new Error(`STOP: ${key} expected ${expected}, found ${before.counts[key]}`);
}

const productById = new Map(before.products.map((row) => [row.id, row]));
const componentById = new Map(before.components.map((row) => [row.id, row]));
const activeComponentKeys = new Map();
for (const component of before.components.filter((row) => row.is_active && !row.archived_at)) {
  for (const value of [component.name_ru, component.name_en, component.canonical_name, component.normalized_key]) {
    const key = normalize(value);
    if (!key) continue;
    if (!activeComponentKeys.has(key)) activeComponentKeys.set(key, new Set());
    activeComponentKeys.get(key).add(component.id);
  }
}
for (const alias of before.componentAliases) {
  const component = componentById.get(alias.component_id);
  if (!component?.is_active || component.archived_at) continue;
  const key = normalize(alias.alias_text || alias.normalized_text);
  if (!key) continue;
  if (!activeComponentKeys.has(key)) activeComponentKeys.set(key, new Set());
  activeComponentKeys.get(key).add(component.id);
}

const activeLinksByProduct = groupBy(before.productComponents.filter((row) => !["archived", "rejected"].includes(row.review_status)), "product_id");
const searchFailures = parseCsv(await readFile(path.join(inputDir, "search_failures.csv"), "utf8"));
const failedByProduct = groupBy(searchFailures, "expected_product_id");
const productAliasesByProduct = groupBy(before.aliases, "product_id");
const previewSearchIndex = new Map(before.products.map((product) => [
  product.id,
  unique([
    buildProductSearchText(product),
    product.name_ru,
    product.name_en,
    ...(productAliasesByProduct.get(product.id) || []).map((row) => row.alias),
  ].map(normalize)),
]));
const reviewRows = [];
const componentPreview = [];
const formulationPreview = [];
let componentDuplicatePreview = 0;
let criticalFacts = 0;

for (const input of inputRows) {
  const decision = decisionById.get(input.product_id);
  const product = productById.get(input.product_id);
  if (!product) throw new Error(`STOP: live product missing ${input.product_id}`);
  const resolvedComponents = [];
  for (const proposal of decision.components || []) {
    let resolution;
    let componentId = proposal.component_id;
    if (componentId) {
      const live = componentById.get(componentId);
      if (!live || !live.is_active || live.archived_at) throw new Error(`STOP: proposed component unavailable ${componentId}`);
      const identityKeys = unique([proposal.name_ru, proposal.name_en, live.name_ru, live.name_en, live.canonical_name].map(normalize));
      const conflicts = unique(identityKeys.flatMap((key) => Array.from(activeComponentKeys.get(key) || []))).filter((id) => id !== componentId);
      if (conflicts.length) componentDuplicatePreview += conflicts.length;
      resolution = "LINK_EXISTING";
    } else {
      const keys = unique([proposal.name_ru, proposal.name_en, proposal.normalized_key].map(normalize));
      const candidates = unique(keys.flatMap((key) => Array.from(activeComponentKeys.get(key) || [])));
      if (candidates.length > 1) {
        componentDuplicatePreview += candidates.length;
        resolution = "BLOCKED_DUPLICATE_COMPONENT_CANDIDATES";
      } else if (candidates.length === 1) {
        componentId = candidates[0];
        resolution = "LINK_EXISTING";
      } else {
        resolution = "CREATE_COMPONENT_PREVIEW";
      }
    }
    const existing = (activeLinksByProduct.get(input.product_id) || []).some((row) => row.component_id === componentId && row.role_in_product === proposal.role_in_product);
    const result = { ...proposal, component_id: componentId, resolution: existing ? "NOOP_EXISTING_LINK" : resolution };
    resolvedComponents.push(result);
    componentPreview.push({ product_id: input.product_id, trade_name: input.trade_name, ...result, source: decision.source });
    criticalFacts += 1;
  }
  const resolvedFormulation = resolveFormulation(before.formulations, decision.formulation);
  if (resolvedFormulation) {
    formulationPreview.push({ product_id: input.product_id, trade_name: input.trade_name, ...resolvedFormulation, source: decision.source });
    criticalFacts += 1;
  }
  const searchCases = failedByProduct.get(input.product_id) || [];
  const searchExpectedPass = searchCases.filter((test) => previewSearchMatch(product, test.query, previewSearchIndex)).length;
  reviewRows.push({
    product_id: input.product_id,
    trade_name: input.trade_name,
    current_readiness: input.readiness_status,
    current_issue_flags: input.issue_flags,
    primary_status: decision.status,
    group: decision.group,
    current_components: input.component_count,
    proposed_components: resolvedComponents,
    current_formulation: input.formulation,
    proposed_formulation: resolvedFormulation,
    search_cases: searchCases.length,
    search_expected_pass: searchExpectedPass,
    search_fix: Boolean(decision.search_fix || searchCases.length),
    identity_decision: decision.owner_option || "",
    candidate_fact: decision.candidate_fact || "",
    reason: decision.reason,
    source: decision.source || null,
    risk: decision.group === "SAFE_AUTO_APPLY" ? "LOW_TO_MEDIUM" : decision.group === "OWNER_APPROVAL_REQUIRED" ? "HIGH_UNTIL_APPROVED" : "BLOCKED",
    rollback: decision.group === "SAFE_AUTO_APPLY" ? "ID-scoped snapshot; remove only inserted links/component/formulation assignments or revert search integration." : "No apply is authorized.",
    owner_approval_required: decision.group !== "SAFE_AUTO_APPLY",
  });
}
console.error("TZ-181 stage: 45 decisions resolved against live catalog");

const blockedForms = formulationPreview.filter((row) => row.resolution !== "LINK_EXISTING");
if (blockedForms.length) throw new Error(`STOP: canonical formulation resolution failed for ${blockedForms.map((row) => row.trade_name).join(", ")}`);
if (componentDuplicatePreview !== 0) throw new Error(`STOP: component duplicate preview ${componentDuplicatePreview}`);

const proposedAliasRows = [];
const aliasConflictsPreview = proposedAliasRows.length;
if (aliasConflictsPreview !== 0) throw new Error(`STOP: alias conflicts preview ${aliasConflictsPreview}`);

const regressionCases = searchFailures.map((test) => {
  const product = productById.get(test.expected_product_id);
  const matched = before.products.filter((row) => previewSearchMatch(row, test.query, previewSearchIndex));
  return {
    scope: test.scope,
    kind: test.kind,
    query: test.query,
    expected_product_id: test.expected_product_id,
    expected_trade_name: test.expected_trade_name,
    current_pass: false,
    preview_pass: Boolean(product && previewSearchMatch(product, test.query, previewSearchIndex)),
    matched_product_ids: matched.map((row) => row.id),
    ambiguity: matched.length > 1,
  };
});

const controlQueries = [
  { query: "Curamin", expected: "Curamin Foliar" },
  { query: "Курамин", expected: "Curamin Foliar" },
  { query: "Фолиар", expected: "Curamin Foliar" },
  { query: "Curamin Foliar", expected: "Curamin Foliar" },
  { query: "Phomazin", expected: "Phomazin" },
  { query: "Фомазин", expected: "Phomazin" },
].map((test) => {
  const matched = before.products.filter((row) => previewSearchMatch(row, test.query, previewSearchIndex));
  return {
    ...test,
    preview_pass: matched.some((row) => normalize(productLabel(row)).includes(normalize(test.expected))),
    matched_product_ids: matched.map((row) => row.id),
    matched_trade_names: matched.map(productLabel),
    ambiguity: matched.length > 1,
  };
});

if (regressionCases.some((row) => !row.preview_pass) || controlQueries.some((row) => !row.preview_pass)) {
  const failures = [
    ...regressionCases.filter((row) => !row.preview_pass).map((row) => `${row.expected_trade_name}: ${row.query}`),
    ...controlQueries.filter((row) => !row.preview_pass).map((row) => `${row.expected}: ${row.query}`),
  ];
  throw new Error(`STOP: proposed search regression matrix contains failures: ${failures.join(" | ")}`);
}
console.error("TZ-181 stage: search regression preview passed");

const groupCounts = Object.fromEntries(["SAFE_AUTO_APPLY", "OWNER_APPROVAL_REQUIRED", "UNRESOLVED"].map((group) => [group, reviewRows.filter((row) => row.group === group).length]));
if (Object.values(groupCounts).reduce((sum, value) => sum + value, 0) !== EXPECTED_PRODUCTS) throw new Error("STOP: group counts do not sum to 45");

const reviewFingerprint = sha256(stableStringify(reviewRows));
const safeRows = reviewRows.filter((row) => row.group === "SAFE_AUTO_APPLY");
const unresolvedRows = reviewRows.filter((row) => row.group === "UNRESOLVED");
const ownerRows = reviewRows.filter((row) => row.group === "OWNER_APPROVAL_REQUIRED");

const reviewJson = {
  task: TASK,
  mode: "READ_ONLY_PRODUCTION_REVIEW_PREVIEW",
  project_ref: PROJECT_REF,
  input_task: "TZ-180",
  input_audit_fingerprint: EXPECTED_INPUT_FINGERPRINT,
  baseline: before.counts,
  products_expected: EXPECTED_PRODUCTS,
  products_reviewed: reviewRows.length,
  duplicate_rows: reviewRows.length - new Set(reviewRows.map((row) => row.product_id)).size,
  unclassified: inputRows.filter((row) => !decisionById.has(row.product_id)).length,
  groups: groupCounts,
  critical_facts_with_source: criticalFacts,
  proposed_component_links: componentPreview.length,
  proposed_formulation_assignments: formulationPreview.length,
  component_duplicates_preview: componentDuplicatePreview,
  alias_conflicts_preview: aliasConflictsPreview,
  merges_executed: 0,
  production_writes: 0,
  review_fingerprint: reviewFingerprint,
  rows: reviewRows,
};

const safePreview = {
  task: TASK,
  apply_executed: false,
  production_writes: 0,
  owner_approval_still_required_before_any_apply: true,
  search_integration: {
    action: "Extend catalog search read path with products.name_ru, products.name_en and global_product_aliases.alias.",
    affected_batch_cards: unique(searchFailures.map((row) => row.expected_product_id)).length,
    regression_cases: regressionCases.length,
    expected_pass: regressionCases.filter((row) => row.preview_pass).length,
    new_alias_rows: 0,
    rollback: "Revert only the search read-path change.",
  },
  component_actions: componentPreview,
  formulation_actions: formulationPreview,
  inactive_actions: safeRows.filter((row) => row.primary_status === "KEEP_INACTIVE").map((row) => ({ product_id: row.product_id, trade_name: row.trade_name, action: "KEEP_INACTIVE" })),
  safe_cards: safeRows,
};

const searchRegression = {
  task: TASK,
  proposed_search_change: "Use existing localized product fields and database aliases in addition to the current catalog helper.",
  current_failed_cases: regressionCases.length,
  unique_failed_cards: unique(regressionCases.map((row) => row.expected_product_id)).length,
  preview_expected_pass: regressionCases.filter((row) => row.preview_pass).length,
  ambiguities: regressionCases.filter((row) => row.ambiguity).length,
  new_alias_rows: 0,
  cases: regressionCases,
  control_cases: controlQueries,
};

const ownerMarkdown = `# TZ-181 owner decisions\n\n` +
  `Production was read-only. No merge or catalog update was executed.\n\n` +
  `## Summary\n\n` +
  `- Safe technical preview: ${groupCounts.SAFE_AUTO_APPLY} cards.\n` +
  `- Owner decision required: ${groupCounts.OWNER_APPROVAL_REQUIRED} cards.\n` +
  `- Unresolved: ${groupCounts.UNRESOLVED} cards.\n\n` +
  `## Celest Top\n\n` +
  `Celest Top and Селест Топ, КС match one source-backed product composition, but no automatic merge is allowed. Approve a survivor and preserve the other label as an alias only after a fresh ID-scoped backup.\n\n` +
  `## Decisions required (${ownerRows.length})\n\n` +
  `| Product | Why approval is needed | Proposed owner decision | Evidence |\n| --- | --- | --- | --- |\n` +
  ownerRows.map((row) => `| ${row.trade_name} | ${row.reason} | ${row.identity_decision || "Confirm classification before any change."} | ${row.source ? `[${row.source.name}](${row.source.url})` : "No critical data change proposed"} |`).join("\n") +
  `\n\n## Unresolved (${unresolvedRows.length})\n\n` +
  unresolvedRows.map((row) => `- **${row.trade_name}:** ${row.reason}`).join("\n") +
  `\n`;

await mkdir(outputDir, { recursive: true });
const csvColumns = [
  "product_id", "trade_name", "current_readiness", "current_issue_flags", "primary_status", "group",
  "current_components", "proposed_components", "current_formulation", "proposed_formulation", "search_cases",
  "search_expected_pass", "search_fix", "identity_decision", "candidate_fact", "reason", "source", "risk",
  "rollback", "owner_approval_required",
];
await writeFile(path.join(outputDir, "batch1_review.csv"), toCsv(reviewRows, csvColumns), "utf8");
await writeFile(path.join(outputDir, "batch1_review.json"), `${JSON.stringify(reviewJson, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDir, "safe_apply_preview.json"), `${JSON.stringify(safePreview, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDir, "owner_decisions.md"), ownerMarkdown, "utf8");
await writeFile(path.join(outputDir, "unresolved.csv"), toCsv(unresolvedRows, ["product_id", "trade_name", "primary_status", "reason", "risk", "owner_approval_required"]), "utf8");
await writeFile(path.join(outputDir, "search_regression.json"), `${JSON.stringify(searchRegression, null, 2)}\n`, "utf8");
console.error("TZ-181 stage: external artifacts written");

const artifactNames = (await readdir(outputDir)).filter((name) => name !== "manifest.sha256").sort();
const manifestLines = [];
for (const name of artifactNames) manifestLines.push(`${sha256(await readFile(path.join(outputDir, name)))}  ${name}`);
await writeFile(path.join(outputDir, "manifest.sha256"), `${manifestLines.join("\n")}\n`, "utf8");

for (const line of manifestLines) {
  const [expected, name] = line.split(/\s{2}/u);
  const actual = sha256(await readFile(path.join(outputDir, name)));
  if (actual !== expected) throw new Error(`STOP: output manifest verification failed for ${name}`);
}

const after = await getSnapshot();
console.error("TZ-181 stage: production after-snapshot captured");
if (before.fingerprint !== after.fingerprint || stableStringify(before.counts) !== stableStringify(after.counts)) {
  throw new Error("STOP: production snapshot changed during read-only review");
}

console.log(JSON.stringify({
  task: TASK,
  status: "PASS",
  output_dir: outputDir,
  products_reviewed: reviewRows.length,
  groups: groupCounts,
  proposed_component_links: componentPreview.length,
  proposed_formulations: formulationPreview.length,
  search_cases: regressionCases.length,
  search_expected_pass: regressionCases.filter((row) => row.preview_pass).length,
  search_ambiguities: regressionCases.filter((row) => row.ambiguity).length,
  component_duplicates_preview: componentDuplicatePreview,
  alias_conflicts_preview: aliasConflictsPreview,
  critical_facts_with_source: criticalFacts,
  review_fingerprint: reviewFingerprint,
  production_snapshot_fingerprint: before.fingerprint,
  production_writes: 0,
}, null, 2));
