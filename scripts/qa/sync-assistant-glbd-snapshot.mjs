import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const TASK = "TZ-198";
const BRANCH_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_REF = "bhsemlvmkikpntabctml";
const QA_USER_ID = "49a8ee17-7e28-49f5-a674-060ff277aa63";
const QA_COMPANY_ID = "8a0f2c0e-6638-4a31-99a8-cab4237d287d";
const QA_COMPANY_NAME = "Астык-STEM QA";

const EXPECTED_HASHES = {
  products: "ae9f5b4747e13c86231d881fb102fe7b3c33434b30f33b9bb0b918a1b61b483b",
  productAliases: "dbd85b1ff6c8d175ebfb61430f26e081f55c8029203041709446dbd816f12f38",
  formulations: "85fee1ba63666d615cd58f52db7dc57ffa01e9414b4536a81ab3993f32e0234c",
  components: "0e323128646e57a3fc214698be2f09b6d47d2ee86873030d8dc4cde5d5933e04",
  componentSources: "69249cecc28de490e81a6cdc0ceba5f6a391b1cd6391e1a7f4642e790bfcf5c8",
  productComponents: "a006fcbca22bab8f74cc500e8d6ca261c1d15a57bbaebf1026e59d2adea56cd2",
  componentAliases: "ae197227294544711065705d360fbe729e1d73090327b0d51f4b2bc9681e968c",
  safetyMatrix: "9ed2c1367febcf703db1034fb897a9ab9ea5321841ce20b67d9311044415211a",
  safeApplyPreview: "bbdfbe490fbc870fe964199e4802f61689c7017f9cfc1d67115d4858f6849471",
};

const EXPECTED_COUNTS = {
  matrix: 852,
  blockedNoData: 10,
  products: 834,
  ready: 19,
  partial: 815,
  productAliases: 609,
  formulations: 6,
  components: 367,
  componentAliases: 63,
  componentSources: 336,
  productComponents: 1382,
};

const LINK_GROUPS = [
  {
    productId: "99354f52-c7ba-411a-ab28-7b27a62b4609",
    sourceType: "manufacturer_site",
    sourceUrl: "https://avgust.com/products/rf/lastik_ekstra/",
    sourceTitle: "Avgust: Lastik Extra",
    links: [
      { componentId: "79287e52-50a3-4f2d-88d0-8172b79a13dd", role: "active", value: 70, unit: "g/L", text: "70 g/L", primary: true },
      { componentId: "16ea719d-e077-5d8a-bbde-9e90ac8de58f", role: "safener", value: 40, unit: "g/L", text: "40 g/L", primary: false },
    ],
  },
  {
    productId: "a4e046c8-b0e3-464d-b2f1-489cb0932546",
    sourceType: "official_registry",
    sourceUrl: "https://insecure.zan.kz/rus/docs/V25I0030119",
    sourceTitle: "Kazakhstan registry: Primeur, SE",
    links: [
      { componentId: "b23bbd0a-df2a-414d-b793-6b91ba996b20", role: "active", value: 452.42, unit: "g/L", text: "2,4-D acid as 2-ethylhexyl ester", primary: true },
      { componentId: "a03a4041-a0e5-4dac-ae30-5f55e4a922d6", role: "active", value: 6.25, unit: "g/L", text: "6.25 g/L", primary: false },
    ],
  },
];

const repoRoot = process.cwd();
const workspaceRoot = path.resolve(repoRoot, "..", "..");
const auditRoot = path.join(workspaceRoot, "audit-output");
const outputDir = path.join(auditRoot, TASK);
const tz196Dir = path.join(auditRoot, "TZ-196");
const tz197Dir = path.join(auditRoot, "TZ-197");
const tz184Dir = path.join(auditRoot, "TZ-184");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function deterministicUuid(seed) {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = "8";
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function loadVerifiedJson(filePath, expectedHash, label) {
  const bytes = await readFile(filePath);
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) throw new Error(`STOP: ${label} SHA drift: ${actualHash}`);
  return JSON.parse(bytes.toString("utf8"));
}

async function resolveInputs() {
  const backup197 = (await readFile(path.join(tz197Dir, "latest-backup.txt"), "utf8")).trim();
  const backup184 = (await readFile(path.join(tz184Dir, "latest-backup.txt"), "utf8")).trim();
  if (!backup197.startsWith(path.join(tz197Dir, "backups"))) throw new Error("STOP: TZ-197 backup pointer escaped its audit directory");
  if (!backup184.startsWith(path.join(tz184Dir, "backups"))) throw new Error("STOP: TZ-184 backup pointer escaped its audit directory");
  return { backup197, backup184 };
}

function postTz197State(products, links, sources, safeApplyPreview) {
  const productById = new Map(products.map((row) => [row.id, { ...row }]));
  for (const item of safeApplyPreview) {
    const product = productById.get(item.product_id);
    if (!product) throw new Error(`STOP: TZ-197 product missing: ${item.product_id}`);
    for (const action of item.actions) {
      if (action.field === "component_links") continue;
      if (JSON.stringify(product[action.field]) !== JSON.stringify(action.current_value)) {
        throw new Error(`STOP: TZ-197 pre-apply value drift: ${item.product_id}.${action.field}`);
      }
      product[action.field] = action.proposed_value;
    }
  }

  const nextLinks = links.map((row) => ({ ...row }));
  const nextSources = sources.map((row) => ({ ...row }));
  for (const group of LINK_GROUPS) {
    for (const [index, link] of group.links.entries()) {
      const linkId = deterministicUuid(`TZ-197:link:${group.productId}:${link.componentId}:${link.role}`);
      const sourceId = deterministicUuid(`TZ-197:source:${group.productId}:${link.componentId}:${group.sourceUrl}`);
      if (nextLinks.some((row) => row.id === linkId)) throw new Error(`STOP: reconstructed link already exists: ${linkId}`);
      if (nextSources.some((row) => row.id === sourceId)) throw new Error(`STOP: reconstructed source already exists: ${sourceId}`);
      nextSources.push({
        id: sourceId,
        component_id: link.componentId,
        source_type: group.sourceType,
        source_url: group.sourceUrl,
        source_title: group.sourceTitle,
        claim_scope: `TZ-197 confirmed product composition for ${group.productId}`,
        confidence: 1,
        checked_at: "2026-07-18T22:52:34.587Z",
        notes: "Owner-approved TZ-197 source verification.",
        created_at: "2026-07-18T22:52:34.587Z",
      });
      nextLinks.push({
        id: linkId,
        product_id: group.productId,
        component_id: link.componentId,
        legacy_product_active_ingredient_id: null,
        role_in_product: link.role,
        concentration_value: link.value,
        concentration_unit: link.unit,
        concentration_text: link.text,
        equivalent_basis: null,
        is_primary_active: link.primary,
        source_id: sourceId,
        confidence: 1,
        review_status: "approved",
        sort_order: index + 1,
        created_at: "2026-07-18T22:52:34.587Z",
        updated_at: "2026-07-18T22:52:34.587Z",
      });
    }
  }
  return { products: Array.from(productById.values()), links: nextLinks, sources: nextSources };
}

function assertUnique(rows, key, label) {
  const values = rows.map(key);
  if (new Set(values).size !== values.length) throw new Error(`STOP: duplicate ${label}`);
}

function base64Json(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function loadRows(targetName, rows, columns) {
  const names = columns.map(([name]) => name).join(", ");
  const definitions = columns.map(([name, type]) => `${name} ${type}`).join(", ");
  const selected = columns.map(([name]) => `payload.${name}`).join(", ");
  return `
INSERT INTO public.${targetName} (${names})
SELECT ${selected}
FROM jsonb_to_recordset(convert_from(decode('${base64Json(rows)}', 'base64'), 'utf8')::jsonb)
  AS payload(${definitions});`;
}

function chunks(rows, size = 150) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result.length > 0 ? result : [[]];
}

function createPolicy(table) {
  const policy = `${table}_authenticated_read`;
  return `
ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.${table} TO authenticated;
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = '${table}' AND policyname = '${policy}'
  ) THEN
    CREATE POLICY ${policy} ON public.${table} FOR SELECT TO authenticated USING (true);
  END IF;
END
$policy$;`;
}

function guardSql() {
  return `DO $guard$
DECLARE
  existing_branch text;
BEGIN
  IF to_regclass('public.assistant_memory_events') IS NULL THEN
    RAISE EXCEPTION 'STOP: assistant branch marker table is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '${QA_USER_ID}'::uuid) THEN
    RAISE EXCEPTION 'STOP: QA User A is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '${QA_USER_ID}'::uuid AND company_id = '${QA_COMPANY_ID}'::uuid
      AND role = 'agronomist' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'STOP: QA User A profile does not match branch ground truth';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = '${QA_COMPANY_ID}'::uuid AND name = '${QA_COMPANY_NAME}') THEN
    RAISE EXCEPTION 'STOP: QA company does not match branch ground truth';
  END IF;
  IF (SELECT count(*) FROM public.fields WHERE company_id = '${QA_COMPANY_ID}'::uuid) <> 8 THEN
    RAISE EXCEPTION 'STOP: QA field count drift';
  END IF;
  IF (SELECT count(*) FROM public.products) <> 3 THEN
    RAISE EXCEPTION 'STOP: branch base product count drift';
  END IF;
  IF to_regclass('public.assistant_glbd_snapshot_meta') IS NOT NULL THEN
    SELECT branch_ref INTO existing_branch FROM public.assistant_glbd_snapshot_meta LIMIT 1;
    IF existing_branch IS NOT NULL AND existing_branch <> '${BRANCH_REF}' THEN
      RAISE EXCEPTION 'STOP: snapshot belongs to another branch';
    END IF;
  END IF;
END
$guard$;`;
}

function buildSqlPackage(snapshot) {
  const columns = {
    products: [
      ["product_id", "uuid"], ["trade_name", "text"], ["name_ru", "text"], ["name_en", "text"],
      ["normalized_name", "text"], ["manufacturer_key", "text"], ["manufacturer_name", "text"],
      ["formulation_id", "uuid"], ["formulation_name", "text"], ["pesticide_category", "text"],
      ["product_subcategory", "text"], ["active_ingredient_text", "text"], ["read_status", "text"],
      ["incomplete", "boolean"], ["incomplete_reason", "text"], ["recommendation_allowed", "boolean"],
      ["safety_gates", "jsonb"], ["source_snapshot", "text"],
    ],
    aliases: [["alias_id", "uuid"], ["product_id", "uuid"], ["alias_text", "text"], ["normalized_alias", "text"], ["source", "text"]],
    manufacturers: [["manufacturer_key", "text"], ["source_id", "uuid"], ["name", "text"]],
    formulations: [["formulation_id", "uuid"], ["code", "text"], ["name_ru", "text"]],
    components: [
      ["component_id", "uuid"], ["component_type", "text"], ["name_ru", "text"], ["name_en", "text"],
      ["canonical_name", "text"], ["normalized_key", "text"], ["form_type", "text"],
      ["parent_component_id", "uuid"], ["review_status", "text"], ["source_status", "text"],
    ],
    componentAliases: [["alias_id", "uuid"], ["component_id", "uuid"], ["alias_text", "text"], ["normalized_text", "text"], ["language", "text"], ["alias_type", "text"], ["confidence", "numeric"]],
    componentSources: [["source_id", "uuid"], ["component_id", "uuid"], ["source_type", "text"], ["source_url", "text"], ["source_title", "text"], ["claim_scope", "text"], ["confidence", "numeric"], ["checked_at", "timestamptz"]],
    productComponents: [
      ["link_id", "uuid"], ["product_id", "uuid"], ["component_id", "uuid"], ["role_in_product", "text"],
      ["concentration_value", "numeric"], ["concentration_unit", "text"], ["concentration_text", "text"],
      ["equivalent_basis", "text"], ["is_primary_active", "boolean"], ["source_id", "uuid"],
      ["confidence", "numeric"], ["review_status", "text"], ["sort_order", "integer"],
    ],
    meta: [
      ["snapshot_key", "text"], ["branch_ref", "text"], ["source_snapshot", "text"], ["package_sha256", "text"],
      ["products_count", "integer"], ["components_count", "integer"], ["links_count", "integer"],
      ["blocked_cards_excluded", "integer"], ["recommendations_allowed", "integer"],
    ],
  };

  const tableSpecs = [
    ["assistant_glbd_manufacturers", snapshot.manufacturers, columns.manufacturers],
    ["assistant_glbd_formulations", snapshot.formulations, columns.formulations],
    ["assistant_glbd_components", snapshot.components, columns.components],
    ["assistant_glbd_products", snapshot.products, columns.products],
    ["assistant_glbd_aliases", snapshot.aliases, columns.aliases],
    ["assistant_glbd_component_aliases", snapshot.componentAliases, columns.componentAliases],
    ["assistant_glbd_component_sources", snapshot.componentSources, columns.componentSources],
    ["assistant_glbd_product_components", snapshot.productComponents, columns.productComponents],
    ["assistant_glbd_snapshot_meta", snapshot.meta, columns.meta],
  ];

  const ddl = `
CREATE TABLE IF NOT EXISTS public.assistant_glbd_products (
  product_id uuid PRIMARY KEY,
  trade_name text NOT NULL,
  name_ru text,
  name_en text,
  normalized_name text NOT NULL,
  manufacturer_key text,
  manufacturer_name text,
  formulation_id uuid,
  formulation_name text,
  pesticide_category text,
  product_subcategory text,
  active_ingredient_text text,
  read_status text NOT NULL CHECK (read_status IN ('READ_READY', 'READ_PARTIAL')),
  incomplete boolean NOT NULL,
  incomplete_reason text,
  recommendation_allowed boolean NOT NULL DEFAULT false CHECK (recommendation_allowed = false),
  safety_gates jsonb NOT NULL,
  source_snapshot text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.assistant_glbd_aliases (
  alias_id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.assistant_glbd_products(product_id) ON DELETE CASCADE,
  alias_text text NOT NULL,
  normalized_alias text NOT NULL UNIQUE,
  source text
);
CREATE TABLE IF NOT EXISTS public.assistant_glbd_manufacturers (
  manufacturer_key text PRIMARY KEY,
  source_id uuid,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.assistant_glbd_formulations (
  formulation_id uuid PRIMARY KEY,
  code text NOT NULL,
  name_ru text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.assistant_glbd_components (
  component_id uuid PRIMARY KEY,
  component_type text NOT NULL,
  name_ru text,
  name_en text,
  canonical_name text NOT NULL,
  normalized_key text NOT NULL,
  form_type text,
  parent_component_id uuid,
  review_status text NOT NULL,
  source_status text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.assistant_glbd_component_aliases (
  alias_id uuid PRIMARY KEY,
  component_id uuid NOT NULL REFERENCES public.assistant_glbd_components(component_id) ON DELETE CASCADE,
  alias_text text NOT NULL,
  normalized_text text NOT NULL UNIQUE,
  language text,
  alias_type text,
  confidence numeric
);
CREATE TABLE IF NOT EXISTS public.assistant_glbd_component_sources (
  source_id uuid PRIMARY KEY,
  component_id uuid NOT NULL REFERENCES public.assistant_glbd_components(component_id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_url text,
  source_title text,
  claim_scope text,
  confidence numeric,
  checked_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.assistant_glbd_product_components (
  link_id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.assistant_glbd_products(product_id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES public.assistant_glbd_components(component_id),
  role_in_product text NOT NULL,
  concentration_value numeric,
  concentration_unit text,
  concentration_text text,
  equivalent_basis text,
  is_primary_active boolean NOT NULL,
  source_id uuid REFERENCES public.assistant_glbd_component_sources(source_id),
  confidence numeric,
  review_status text NOT NULL,
  sort_order integer NOT NULL,
  UNIQUE (product_id, component_id, role_in_product)
);
CREATE TABLE IF NOT EXISTS public.assistant_glbd_snapshot_meta (
  snapshot_key text PRIMARY KEY,
  branch_ref text NOT NULL CHECK (branch_ref = '${BRANCH_REF}'),
  source_snapshot text NOT NULL,
  package_sha256 text NOT NULL,
  products_count integer NOT NULL,
  components_count integer NOT NULL,
  links_count integer NOT NULL,
  blocked_cards_excluded integer NOT NULL,
  recommendations_allowed integer NOT NULL CHECK (recommendations_allowed = 0)
);`;

  const tables = tableSpecs.map(([table]) => table);
  const schemaSql = `-- ${TASK}: close the read surface and prepare a branch-only snapshot reload.
BEGIN;
${guardSql()}
DROP VIEW IF EXISTS public.assistant_glbd_search_surface;
${ddl}
${tables.map((table) => `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;\nREVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`).join("\n")}
TRUNCATE TABLE
  public.assistant_glbd_product_components,
  public.assistant_glbd_component_sources,
  public.assistant_glbd_component_aliases,
  public.assistant_glbd_aliases,
  public.assistant_glbd_components,
  public.assistant_glbd_products,
  public.assistant_glbd_manufacturers,
  public.assistant_glbd_formulations,
  public.assistant_glbd_snapshot_meta;
COMMIT;
`;
  const files = new Map([["00_schema.sql", schemaSql]]);
  for (const [table, rows, defs] of tableSpecs) {
    for (const [index, part] of chunks(rows).entries()) {
      const base = table.replace("assistant_glbd_", "");
      const name = `10_${base}_${String(index + 1).padStart(2, "0")}.sql`;
      files.set(name, `-- ${TASK}: guarded branch-only seed chunk.\nBEGIN;\n${guardSql()}\n${loadRows(table, part, defs)}\nCOMMIT;\n`);
    }
  }
  const securedTables = tables.map(createPolicy).join("\n");
  const publishSql = `-- ${TASK}: atomically publish the authenticated read-only surface.
BEGIN;
${guardSql()}
${securedTables}
CREATE OR REPLACE VIEW public.assistant_glbd_search_surface
WITH (security_invoker = true)
AS
SELECT
  p.product_id,
  p.trade_name,
  p.name_ru,
  p.name_en,
  p.manufacturer_name,
  p.formulation_name,
  p.pesticide_category,
  p.product_subcategory,
  p.read_status,
  p.incomplete,
  p.incomplete_reason,
  p.recommendation_allowed,
  concat_ws(' ', p.trade_name, p.name_ru, p.name_en, p.normalized_name,
    string_agg(DISTINCT a.alias_text, ' '),
    string_agg(DISTINCT c.canonical_name, ' '),
    string_agg(DISTINCT ca.alias_text, ' ')) AS search_text
FROM public.assistant_glbd_products p
LEFT JOIN public.assistant_glbd_aliases a ON a.product_id = p.product_id
LEFT JOIN public.assistant_glbd_product_components pc ON pc.product_id = p.product_id
LEFT JOIN public.assistant_glbd_components c ON c.component_id = pc.component_id
LEFT JOIN public.assistant_glbd_component_aliases ca ON ca.component_id = c.component_id
GROUP BY p.product_id, p.trade_name, p.name_ru, p.name_en, p.manufacturer_name,
  p.formulation_name, p.pesticide_category, p.product_subcategory, p.read_status,
  p.incomplete, p.incomplete_reason, p.recommendation_allowed, p.normalized_name;
REVOKE ALL ON TABLE public.assistant_glbd_search_surface FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.assistant_glbd_search_surface TO authenticated;
DO $postcheck$
BEGIN
  IF (SELECT count(*) FROM public.assistant_glbd_products) <> ${EXPECTED_COUNTS.products} THEN RAISE EXCEPTION 'STOP: product snapshot count mismatch'; END IF;
  IF (SELECT count(*) FROM public.assistant_glbd_products WHERE read_status = 'READ_READY') <> ${EXPECTED_COUNTS.ready} THEN RAISE EXCEPTION 'STOP: READ_READY count mismatch'; END IF;
  IF (SELECT count(*) FROM public.assistant_glbd_products WHERE read_status = 'READ_PARTIAL') <> ${EXPECTED_COUNTS.partial} THEN RAISE EXCEPTION 'STOP: READ_PARTIAL count mismatch'; END IF;
  IF (SELECT count(*) FROM public.assistant_glbd_components) <> ${EXPECTED_COUNTS.components} THEN RAISE EXCEPTION 'STOP: component snapshot count mismatch'; END IF;
  IF (SELECT count(*) FROM public.assistant_glbd_product_components) <> ${EXPECTED_COUNTS.productComponents} THEN RAISE EXCEPTION 'STOP: link snapshot count mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.assistant_glbd_products WHERE recommendation_allowed) THEN RAISE EXCEPTION 'STOP: recommendation permission appeared'; END IF;
END
$postcheck$;
COMMIT;
`;
  files.set("99_publish.sql", publishSql);
  return files;
}

async function main() {
  const { backup197, backup184 } = await resolveInputs();
  const paths = {
    products: path.join(backup197, "products.json"),
    productAliases: path.join(backup197, "global_product_aliases.json"),
    formulations: path.join(backup197, "agrochem_formulations.json"),
    components: path.join(backup197, "glbd_components.json"),
    componentSources: path.join(backup197, "glbd_component_sources.json"),
    productComponents: path.join(backup197, "glbd_product_components.json"),
    componentAliases: path.join(backup184, "glbd_component_aliases.json"),
    safetyMatrix: path.join(tz196Dir, "assistant_safety_matrix.json"),
    safeApplyPreview: path.join(tz196Dir, "safe_apply_preview.json"),
  };
  const input = {};
  for (const [name, filePath] of Object.entries(paths)) {
    input[name] = await loadVerifiedJson(filePath, EXPECTED_HASHES[name], name);
  }
  if (input.safetyMatrix.length !== EXPECTED_COUNTS.matrix) throw new Error("STOP: safety matrix count drift");

  const reconstructed = postTz197State(input.products, input.productComponents, input.componentSources, input.safeApplyPreview);
  const matrixById = new Map(input.safetyMatrix.map((row) => [row.product_id, row]));
  const allowedIds = new Set(input.safetyMatrix.filter((row) => row.assistant_read_allowed !== "NO").map((row) => row.product_id));
  const blockedNoData = input.safetyMatrix.filter((row) => row.scope_18_classification === "BLOCKED_NO_DATA");
  if (blockedNoData.length !== EXPECTED_COUNTS.blockedNoData) throw new Error("STOP: BLOCKED_NO_DATA count drift");

  const productRows = reconstructed.products
    .filter((row) => allowedIds.has(row.id))
    .map((row) => {
      const safety = matrixById.get(row.id);
      if (row.company_id !== null || row.product_type !== "pesticide" || !row.is_active || row.archived) {
        throw new Error(`STOP: unsafe product entered snapshot: ${row.id}`);
      }
      return {
        product_id: row.id,
        trade_name: row.trade_name || row.name,
        name_ru: row.name_ru,
        name_en: row.name_en,
        normalized_name: row.normalized_name || normalize(row.trade_name || row.name),
        manufacturer_key: row.manufacturer_id || (row.manufacturer ? `name:${normalize(row.manufacturer)}` : null),
        manufacturer_name: row.manufacturer,
        formulation_id: row.formulation_id,
        formulation_name: row.formulation,
        pesticide_category: row.pesticide_category,
        product_subcategory: row.subcategory,
        active_ingredient_text: row.active_ingredient,
        read_status: safety.assistant_read_allowed === "YES" ? "READ_READY" : "READ_PARTIAL",
        incomplete: safety.assistant_read_allowed !== "YES",
        incomplete_reason: safety.assistant_read_allowed === "YES" ? null : safety.read_reason,
        recommendation_allowed: false,
        safety_gates: safety.gates,
        source_snapshot: "TZ-197-post-apply-from-verified-backup",
      };
    })
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
  const includedIds = new Set(productRows.map((row) => row.product_id));

  const aliasRows = input.productAliases
    .filter((row) => includedIds.has(row.product_id))
    .map((row) => ({ alias_id: row.id, product_id: row.product_id, alias_text: row.alias, normalized_alias: row.normalized_alias, source: row.source }))
    .sort((a, b) => a.alias_id.localeCompare(b.alias_id));
  const linkRows = reconstructed.links
    .filter((row) => includedIds.has(row.product_id) && !["rejected", "archived"].includes(row.review_status))
    .map((row) => ({
      link_id: row.id, product_id: row.product_id, component_id: row.component_id,
      role_in_product: row.role_in_product, concentration_value: row.concentration_value,
      concentration_unit: row.concentration_unit, concentration_text: row.concentration_text,
      equivalent_basis: row.equivalent_basis, is_primary_active: row.is_primary_active,
      source_id: row.source_id, confidence: row.confidence, review_status: row.review_status, sort_order: row.sort_order,
    }))
    .sort((a, b) => a.link_id.localeCompare(b.link_id));
  const componentIds = new Set(linkRows.map((row) => row.component_id));
  const componentRows = input.components
    .filter((row) => componentIds.has(row.id))
    .map((row) => ({
      component_id: row.id, component_type: row.component_type, name_ru: row.name_ru, name_en: row.name_en,
      canonical_name: row.canonical_name, normalized_key: row.normalized_key, form_type: row.form_type,
      parent_component_id: row.parent_component_id, review_status: row.review_status, source_status: row.source_status,
    }))
    .sort((a, b) => a.component_id.localeCompare(b.component_id));
  const sourceIds = new Set(linkRows.map((row) => row.source_id).filter(Boolean));
  const componentSourceRows = reconstructed.sources
    .filter((row) => componentIds.has(row.component_id) && (sourceIds.has(row.id) || row.component_id))
    .map((row) => ({
      source_id: row.id, component_id: row.component_id, source_type: row.source_type, source_url: row.source_url,
      source_title: row.source_title, claim_scope: row.claim_scope, confidence: row.confidence, checked_at: row.checked_at,
    }))
    .sort((a, b) => a.source_id.localeCompare(b.source_id));
  const componentAliasRows = input.componentAliases
    .filter((row) => componentIds.has(row.component_id))
    .map((row) => ({
      alias_id: row.id, component_id: row.component_id, alias_text: row.alias_text, normalized_text: row.normalized_text,
      language: row.language, alias_type: row.alias_type, confidence: row.confidence,
    }))
    .sort((a, b) => a.alias_id.localeCompare(b.alias_id));
  const formulationRows = input.formulations
    .filter((row) => row.is_active && !row.archived)
    .map((row) => ({ formulation_id: row.id, code: row.code, name_ru: row.name_ru }))
    .sort((a, b) => a.formulation_id.localeCompare(b.formulation_id));
  const manufacturerMap = new Map();
  for (const row of productRows) {
    if (!row.manufacturer_key || !row.manufacturer_name) continue;
    manufacturerMap.set(row.manufacturer_key, {
      manufacturer_key: row.manufacturer_key,
      source_id: row.manufacturer_key.startsWith("name:") ? null : row.manufacturer_key,
      name: row.manufacturer_name,
    });
  }
  const manufacturerRows = Array.from(manufacturerMap.values()).sort((a, b) => a.manufacturer_key.localeCompare(b.manufacturer_key));

  const counts = {
    products: productRows.length,
    ready: productRows.filter((row) => row.read_status === "READ_READY").length,
    partial: productRows.filter((row) => row.read_status === "READ_PARTIAL").length,
    productAliases: aliasRows.length,
    manufacturers: manufacturerRows.length,
    formulations: formulationRows.length,
    components: componentRows.length,
    componentAliases: componentAliasRows.length,
    componentSources: componentSourceRows.length,
    productComponents: linkRows.length,
    blockedNoDataExcluded: blockedNoData.length,
    recommendationsAllowed: productRows.filter((row) => row.recommendation_allowed).length,
  };
  for (const [key, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (["matrix", "blockedNoData"].includes(key)) continue;
    if (counts[key] !== expected) throw new Error(`STOP: ${key} expected ${expected}, found ${counts[key]}`);
  }
  if (counts.blockedNoDataExcluded !== EXPECTED_COUNTS.blockedNoData || counts.recommendationsAllowed !== 0) {
    throw new Error("STOP: assistant safety scope mismatch");
  }

  assertUnique(productRows, (row) => row.product_id, "product IDs");
  assertUnique(aliasRows, (row) => row.normalized_alias, "normalized product aliases");
  assertUnique(componentAliasRows, (row) => row.normalized_text, "normalized component aliases");
  assertUnique(linkRows, (row) => `${row.product_id}:${row.component_id}:${row.role_in_product}`, "product component roles");

  const packageCore = {
    branchRef: BRANCH_REF,
    productionRefBlocked: PRODUCTION_REF,
    sourceSnapshot: "TZ-197-post-apply-from-verified-backup",
    counts,
    inputHashes: EXPECTED_HASHES,
  };
  const packageSha = sha256(stableJson(packageCore));
  const snapshot = {
    products: productRows,
    aliases: aliasRows,
    manufacturers: manufacturerRows,
    formulations: formulationRows,
    components: componentRows,
    componentAliases: componentAliasRows,
    componentSources: componentSourceRows,
    productComponents: linkRows,
    meta: [{
      snapshot_key: "tz198-glbd-v1",
      branch_ref: BRANCH_REF,
      source_snapshot: packageCore.sourceSnapshot,
      package_sha256: packageSha,
      products_count: counts.products,
      components_count: counts.components,
      links_count: counts.productComponents,
      blocked_cards_excluded: counts.blockedNoDataExcluded,
      recommendations_allowed: 0,
    }],
  };

  await mkdir(outputDir, { recursive: true });
  for (const name of await readdir(outputDir)) {
    if (name.endsWith(".sql")) await unlink(path.join(outputDir, name));
  }
  const sqlFiles = buildSqlPackage(snapshot);
  for (const [name, sql] of sqlFiles) await writeFile(path.join(outputDir, name), sql, "utf8");
  await writeFile(path.join(outputDir, "snapshot_counts.json"), stableJson({ status: "PASS", ...packageCore, packageSha256: packageSha }), "utf8");
  await writeFile(path.join(outputDir, "snapshot_source_evidence.json"), stableJson({
    status: "PASS",
    sourceFiles: Object.fromEntries(Object.entries(paths).map(([key, filePath]) => [key, { path: filePath, sha256: EXPECTED_HASHES[key] }])),
    excludedProductIds: input.safetyMatrix.filter((row) => row.assistant_read_allowed === "NO").map((row) => row.product_id).sort(),
    blockedNoDataProductIds: blockedNoData.map((row) => row.product_id).sort(),
    companyScopedRowsCopied: 0,
  }), "utf8");
  const manifestFiles = [...sqlFiles.keys(), "snapshot_counts.json", "snapshot_source_evidence.json"];
  const manifest = [];
  for (const name of manifestFiles) manifest.push(`${sha256(await readFile(path.join(outputDir, name)))}  ${name}`);
  await writeFile(path.join(outputDir, "manifest.sha256"), `${manifest.join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", outputDir, packageSha256: packageSha, counts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
