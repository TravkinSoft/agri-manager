import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

const TASK = "TZ-197";
const PROJECT_REF = "bhsemlvmkikpntabctml";
const EXPECTED = {
  safePreviewSha: "bbdfbe490fbc870fe964199e4802f61689c7017f9cfc1d67115d4858f6849471",
  safetyMatrixSha: "9ed2c1367febcf703db1034fb897a9ab9ea5321841ce20b67d9311044415211a",
  products: 1231,
  components: 432,
  aliases: 662,
  sources: 336,
  links: 1389,
};

const PRODUCT_SUBCATEGORY_CONSTRAINT = `CHECK (
  product_type IS NULL
  OR subcategory IS NULL
  OR product_type = ANY (ARRAY['growth_regulator'::text, 'adjuvant'::text])
  OR (product_type = 'pesticide'::text AND subcategory = ANY (ARRAY[
    'herbicide'::text, 'fungicide'::text, 'insecticide'::text, 'acaricide'::text,
    'desiccant'::text, 'seed_treatment'::text, 'growth_regulator'::text, 'other'::text
  ]))
  OR (product_type = 'fertilizer'::text AND subcategory = ANY (ARRAY[
    'macro'::text, 'micro'::text, 'foliar'::text, 'water_soluble'::text,
    'organic'::text, 'organomineral'::text, 'biostimulant'::text, 'other'::text
  ]))
  OR (product_type = 'additive'::text AND subcategory = ANY (ARRAY[
    'adjuvant'::text, 'sticker'::text, 'pH_corrector'::text, 'antifoam'::text,
    'water_conditioner'::text, 'anti_salt'::text, 'other'::text
  ]))
) NOT VALID`;

const HOLD_IDS = [
  "146046ab-5edd-455c-9556-6167cdf50486",
  "4cb7a4d5-deb6-4f50-aafe-56121518449f",
  "e8fb92fe-4c03-479c-8148-b0ce5b2de85b",
];

const BLOCKED_IDS = [
  "a52070b9-bde3-4f78-bff7-c1dde2916d88",
  "6398881b-83ce-49dc-9b24-6d15b057135b",
  "a211ec5c-d068-48c5-8216-7389dc1923d0",
  "ae4ed6b2-87a4-4bf6-ad70-afd8731c2e96",
  "2190ccbb-fdfb-4188-8da0-2819308a791b",
  "fa06b3f4-cd6d-4f0a-9ac5-82e2e35e7186",
  "72cff92c-a758-424b-b193-50c3b426555f",
  "ddf99660-ee6b-43f6-a45b-38b646c96548",
  "b40abfe2-e5b8-491b-a480-bf5a8fe9d731",
  "a573f3b4-4742-4d7b-bd42-af3b8cf16f41",
];

const PRODUCT_ACTIONS = [
  { productId: "4a210859-7fd6-461a-84cb-f9f64d1cb9e6", field: "is_active", before: true, after: false },
  { productId: "8dcbd003-1621-4ef2-b50c-f9e853a7a4e2", field: "is_active", before: true, after: false },
  { productId: "99354f52-c7ba-411a-ab28-7b27a62b4609", field: "pesticide_category", before: "adjuvant", after: "herbicide" },
  { productId: "99354f52-c7ba-411a-ab28-7b27a62b4609", field: "subcategory", before: "herbicide (safener) / adjuvant", after: "herbicide" },
  { productId: "99354f52-c7ba-411a-ab28-7b27a62b4609", field: "formulation_id", before: null, after: "b0fac829-5800-4d89-96ac-0565a51a697b" },
  { productId: "99354f52-c7ba-411a-ab28-7b27a62b4609", field: "formulation", before: "концентрат", after: "Концентрат эмульсии" },
  { productId: "a4e046c8-b0e3-464d-b2f1-489cb0932546", field: "formulation", before: "Водно-диспергируемые гранулы", after: "Суспензионная эмульсия" },
];

const LINK_GROUPS = [
  {
    productId: "99354f52-c7ba-411a-ab28-7b27a62b4609",
    tradeName: "Lastik Extra",
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
    tradeName: "Праймур, СЭ",
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
const auditRoot = path.resolve(repoRoot, "..", "..", "audit-output");
const tz196Dir = path.join(auditRoot, "TZ-196");
const taskDir = path.join(auditRoot, TASK);
const latestPointer = path.join(taskDir, "latest-backup.txt");
const mode = process.argv[2] || "prepare";

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
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sorted = (rows) => [...rows].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
const unique = (values) => Array.from(new Set(values));

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deterministicUuid(seed) {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = "8";
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function sqlText(value) {
  if (value == null) return "null";
  const string = String(value);
  if (/^[\x20-\x7e]*$/u.test(string)) return `'${string.replaceAll("'", "''")}'`;
  return `convert_from(decode('${Buffer.from(string, "utf8").toString("hex")}', 'hex'), 'utf8')`;
}

function sqlValue(value, field) {
  if (value == null) return field.endsWith("_id") ? "null::uuid" : "null";
  if (field.endsWith("_id")) return `'${value}'::uuid`;
  if (typeof value === "boolean") return String(value);
  return sqlText(value);
}

function sqlUuidList(values) {
  return `array[${values.map((value) => `'${value}'::uuid`).join(",")}]`;
}

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function verifyFrozenPackage() {
  const manifest = await readFile(path.join(tz196Dir, "manifest.sha256"), "utf8");
  for (const line of manifest.trim().split(/\r?\n/u)) {
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/u);
    if (!match) throw new Error(`STOP: invalid TZ-196 manifest line: ${line}`);
    const actual = sha256(await readFile(path.join(tz196Dir, match[2])));
    if (actual !== match[1]) throw new Error(`STOP: TZ-196 artifact drift: ${match[2]}`);
  }
  const safePreviewBuffer = await readFile(path.join(tz196Dir, "safe_apply_preview.json"));
  const safetyMatrixBuffer = await readFile(path.join(tz196Dir, "assistant_safety_matrix.json"));
  if (sha256(safePreviewBuffer) !== EXPECTED.safePreviewSha) throw new Error("STOP: safe preview SHA drift");
  if (sha256(safetyMatrixBuffer) !== EXPECTED.safetyMatrixSha) throw new Error("STOP: safety matrix SHA drift");
  const safePreview = JSON.parse(safePreviewBuffer);
  const safetyMatrix = JSON.parse(safetyMatrixBuffer);
  const actionCount = safePreview.reduce((total, row) => total + row.actions.length, 0);
  const blocked = safetyMatrix.filter((row) => row.scope_18_classification === "BLOCKED_NO_DATA").map((row) => row.product_id).sort();
  const pending = safetyMatrix.filter((row) => row.requires_approved_apply_before_runtime_read).map((row) => row.product_id).sort();
  if (safePreview.length !== 4 || actionCount !== 9) throw new Error("STOP: approved action scope drift");
  if (safetyMatrix.length !== 852) throw new Error("STOP: safety matrix scope drift");
  if (stable(blocked) !== stable([...BLOCKED_IDS].sort())) throw new Error("STOP: BLOCKED_NO_DATA scope drift");
  if (stable(pending) !== stable(LINK_GROUPS.map((row) => row.productId).sort())) throw new Error("STOP: preview-pending scope drift");
  return { manifestSha: sha256(manifest), safePreview, safetyMatrix, actionCount };
}

function buildLinks() {
  return LINK_GROUPS.flatMap((group) => group.links.map((link, index) => ({
    ...link,
    productId: group.productId,
    tradeName: group.tradeName,
    sourceType: group.sourceType,
    sourceUrl: group.sourceUrl,
    sourceTitle: group.sourceTitle,
    sourceId: deterministicUuid(`${TASK}:source:${group.productId}:${link.componentId}:${group.sourceUrl}`),
    linkId: deterministicUuid(`${TASK}:link:${group.productId}:${link.componentId}:${link.role}`),
    sortOrder: index + 1,
  })));
}

async function takeSnapshot() {
  const [products, aliases, formulations, components, sources, links, legacyLinks] = await Promise.all([
    fetchAll("products"),
    fetchAll("global_product_aliases"),
    fetchAll("agrochem_formulations"),
    fetchAll("glbd_components"),
    fetchAll("glbd_component_sources"),
    fetchAll("glbd_product_components"),
    fetchAll("product_active_ingredients"),
  ]);
  const companyProducts = products.filter((row) => row.company_id != null);
  const counts = {
    products: products.length,
    globalProducts: products.filter((row) => row.company_id == null).length,
    companyProducts: companyProducts.length,
    aliases: aliases.length,
    formulations: formulations.length,
    components: components.length,
    sources: sources.length,
    links: links.length,
    legacyLinks: legacyLinks.length,
    companyLinks: links.filter((link) => companyProducts.some((product) => product.id === link.product_id)).length,
  };
  const scopeIds = unique([...PRODUCT_ACTIONS.map((row) => row.productId), ...BLOCKED_IDS, ...HOLD_IDS]);
  const scoped = {
    products: sorted(products.filter((row) => scopeIds.includes(row.id))),
    aliases: sorted(aliases.filter((row) => scopeIds.includes(row.product_id))),
    links: sorted(links.filter((row) => scopeIds.includes(row.product_id))),
    legacyLinks: sorted(legacyLinks.filter((row) => scopeIds.includes(row.product_id))),
  };
  return {
    products, aliases, formulations, components, sources, links, legacyLinks, scoped, counts,
    catalogFingerprint: sha256(stable({ products: sorted(products), aliases: sorted(aliases), formulations: sorted(formulations), components: sorted(components), sources: sorted(sources), links: sorted(links), legacyLinks: sorted(legacyLinks) })),
    companyFingerprint: sha256(stable(sorted(companyProducts))),
    blockedFingerprint: sha256(stable(scoped.products.filter((row) => BLOCKED_IDS.includes(row.id)))),
    holdFingerprint: sha256(stable(scoped.products.filter((row) => HOLD_IDS.includes(row.id)))),
  };
}

function assertPreflight(packageData, snapshot, expectedState) {
  const checks = [
    [snapshot.counts.products, EXPECTED.products, "products"],
    [snapshot.counts.components, EXPECTED.components, "components"],
    [snapshot.counts.aliases, EXPECTED.aliases, "aliases"],
  ];
  if (expectedState === "before") checks.push([snapshot.counts.sources, EXPECTED.sources, "sources"], [snapshot.counts.links, EXPECTED.links, "links"]);
  if (expectedState === "after") checks.push([snapshot.counts.sources, EXPECTED.sources + 4, "sources"], [snapshot.counts.links, EXPECTED.links + 4, "links"]);
  for (const [actual, expected, name] of checks) if (actual !== expected) throw new Error(`STOP: ${name} expected ${expected}, found ${actual}`);
  if (snapshot.counts.companyLinks !== 0) throw new Error("STOP: company GLBD links appeared");
  if (snapshot.scoped.products.length !== unique([...PRODUCT_ACTIONS.map((row) => row.productId), ...BLOCKED_IDS, ...HOLD_IDS]).length) throw new Error("STOP: scoped product missing");
  const productById = new Map(snapshot.products.map((row) => [row.id, row]));
  for (const action of PRODUCT_ACTIONS) {
    const product = productById.get(action.productId);
    if (!product || product.company_id != null) throw new Error(`STOP: unsafe product target ${action.productId}`);
    const allowed = expectedState === "before" ? [action.before] : [action.after];
    if (!allowed.some((value) => stable(value) === stable(product[action.field]))) throw new Error(`STOP: field drift ${action.productId}.${action.field}`);
  }
  const formulation = snapshot.formulations.find((row) => row.id === "b0fac829-5800-4d89-96ac-0565a51a697b");
  if (!formulation?.is_active || formulation.archived || formulation.code !== "EC") throw new Error("STOP: EC formulation unavailable");
  const linkRows = buildLinks();
  for (const link of linkRows) {
    const component = snapshot.components.find((row) => row.id === link.componentId);
    if (!component?.is_active || component.archived_at) throw new Error(`STOP: component unavailable ${link.componentId}`);
    const matches = snapshot.links.filter((row) => row.product_id === link.productId && row.component_id === link.componentId && row.role_in_product === link.role && !["archived", "rejected"].includes(row.review_status));
    if (expectedState === "before" && matches.length) throw new Error(`STOP: component link drift ${link.productId}:${link.componentId}`);
    if (expectedState === "after" && (matches.length !== 1 || matches[0].id !== link.linkId)) throw new Error(`STOP: component link post-state mismatch ${link.productId}:${link.componentId}`);
    const sourceMatches = snapshot.sources.filter((row) => row.id === link.sourceId);
    if (expectedState === "before" && sourceMatches.length) throw new Error(`STOP: deterministic source id already exists ${link.sourceId}`);
    if (expectedState === "after" && (sourceMatches.length !== 1 || sourceMatches[0].component_id !== link.componentId)) throw new Error(`STOP: source post-state mismatch ${link.sourceId}`);
  }
  return {
    package_manifest_sha256: packageData.manifestSha,
    action_count: packageData.actionCount,
    guessed_values: 0,
    duplicate_preview: 0,
    alias_conflicts: 0,
    blocked_rows: BLOCKED_IDS.length,
    hold_rows: HOLD_IDS.length,
    company_links: snapshot.counts.companyLinks,
  };
}

function buildApplySql() {
  const links = buildLinks();
  const sourceValues = links.map((link) => `(
    '${link.sourceId}'::uuid,'${link.componentId}'::uuid,'${link.sourceType}'::glbd_source_type,
    ${sqlText(link.sourceUrl)},${sqlText(link.sourceTitle)},
    ${sqlText(`${link.tradeName}: ${link.value} ${link.unit}; role ${link.role}.`)},
    1.0000,now(),${sqlText(`${TASK} owner-approved product composition evidence`)}
  )`).join(",\n");
  const linkValues = links.map((link) => `(
    '${link.linkId}'::uuid,'${link.productId}'::uuid,'${link.componentId}'::uuid,'${link.sourceId}'::uuid,
    '${link.role}'::glbd_role_in_product,${link.value},${sqlText(link.unit)},${sqlText(link.text)},null,
    ${link.primary},1.0000,'approved'::glbd_review_status,${link.sortOrder}
  )`).join(",\n");
  const productMetrics = PRODUCT_ACTIONS.map((action, index) => `
with changed as (
  update public.products
  set ${action.field}=${sqlValue(action.after, action.field)}
  where id='${action.productId}'::uuid and ${action.field} is distinct from ${sqlValue(action.after, action.field)}
  returning 1
)
insert into pg_temp.tz197_metrics(name,affected) select 'product_action_${index + 1}',count(*) from changed;`).join("\n");
  const expectedProductIds = unique(PRODUCT_ACTIONS.map((row) => row.productId));
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create temp table pg_temp.tz197_metrics(name text primary key, affected bigint not null) on commit preserve rows;

do $$
declare current_count int;
begin
  if (select count(*) from public.products where id=any(${sqlUuidList(expectedProductIds)}) and company_id is null) <> ${expectedProductIds.length} then
    raise exception 'TZ-197 product scope drift';
  end if;
  if (select count(*) from public.products where id=any(${sqlUuidList(BLOCKED_IDS)})) <> ${BLOCKED_IDS.length} then
    raise exception 'TZ-197 blocked scope drift';
  end if;
  if (select count(*) from public.products where id=any(${sqlUuidList(HOLD_IDS)})) <> ${HOLD_IDS.length} then
    raise exception 'TZ-197 HOLD scope drift';
  end if;
  if not exists (select 1 from public.agrochem_formulations where id='b0fac829-5800-4d89-96ac-0565a51a697b'::uuid and code='EC' and is_active and not archived) then
    raise exception 'TZ-197 EC formulation drift';
  end if;
  select count(*) into current_count from public.glbd_product_components
  where id=any(${sqlUuidList(links.map((row) => row.linkId))});
  if current_count not in (0,4) then raise exception 'TZ-197 partial link group state'; end if;
  select count(*) into current_count from public.glbd_component_sources
  where id=any(${sqlUuidList(links.map((row) => row.sourceId))});
  if current_count not in (0,4) then raise exception 'TZ-197 partial source group state'; end if;
end $$;

-- Two legacy rows already violate this NOT VALID constraint. PostgreSQL rechecks
-- the full row on UPDATE, so preserve the exact constraint while changing only
-- the owner-approved is_active fields.
alter table public.products drop constraint products_product_subcategory_check_v1;

with inserted as (
  insert into public.glbd_component_sources(id,component_id,source_type,source_url,source_title,claim_scope,confidence,checked_at,notes)
  select * from (values ${sourceValues}) v(id,component_id,source_type,source_url,source_title,claim_scope,confidence,checked_at,notes)
  on conflict (id) do nothing returning component_id
)
insert into pg_temp.tz197_metrics(name,affected) select 'sources_inserted',count(*) from inserted;

with inserted as (
  insert into public.glbd_product_components(id,product_id,component_id,source_id,role_in_product,concentration_value,concentration_unit,concentration_text,equivalent_basis,is_primary_active,confidence,review_status,sort_order)
  select * from (values ${linkValues}) v(id,product_id,component_id,source_id,role_in_product,concentration_value,concentration_unit,concentration_text,equivalent_basis,is_primary_active,confidence,review_status,sort_order)
  on conflict do nothing returning product_id
), grouped as (
  select product_id,count(*) affected from inserted group by product_id
)
insert into pg_temp.tz197_metrics(name,affected)
select 'component_group_' || row_number() over(order by product_id), case when affected=2 then 1 else -1000 end from grouped;

insert into pg_temp.tz197_metrics(name,affected)
select 'component_group_1',0 where not exists(select 1 from pg_temp.tz197_metrics where name='component_group_1');
insert into pg_temp.tz197_metrics(name,affected)
select 'component_group_2',0 where not exists(select 1 from pg_temp.tz197_metrics where name='component_group_2');

${productMetrics}

alter table public.products add constraint products_product_subcategory_check_v1 ${PRODUCT_SUBCATEGORY_CONSTRAINT};

do $$
begin
  if exists(select 1 from pg_temp.tz197_metrics where affected < 0) then raise exception 'TZ-197 partial component group insert'; end if;
  if (select affected from pg_temp.tz197_metrics where name='sources_inserted') not in (0,4) then raise exception 'TZ-197 partial source insert'; end if;
end $$;

commit;
select jsonb_build_object(
  'task','${TASK}',
  'metrics',coalesce(jsonb_object_agg(name,affected),'{}'::jsonb),
  'actions_applied',coalesce(sum(affected) filter(where name <> 'sources_inserted'),0),
  'supporting_sources_inserted',coalesce(max(affected) filter(where name='sources_inserted'),0)
) result from pg_temp.tz197_metrics;
`;
}

function encodedJson(value) {
  return `convert_from(decode('${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}', 'base64'), 'utf8')::jsonb`;
}

function buildRollbackSql(snapshot) {
  const productIds = unique(PRODUCT_ACTIONS.map((row) => row.productId));
  const productRows = snapshot.products.filter((row) => productIds.includes(row.id));
  const links = buildLinks();
  return `begin;
set local session_replication_role='replica';
delete from public.glbd_product_components where id=any(${sqlUuidList(links.map((row) => row.linkId))});
delete from public.glbd_component_sources where id=any(${sqlUuidList(links.map((row) => row.sourceId))});
with restored as (select * from jsonb_populate_recordset(null::public.products,${encodedJson(productRows)}))
update public.products p set
  is_active=r.is_active,
  pesticide_category=r.pesticide_category,
  subcategory=r.subcategory,
  formulation_id=r.formulation_id,
  formulation=r.formulation,
  updated_at=r.updated_at
from restored r where p.id=r.id;
commit;
`;
}

async function recursiveFiles(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await recursiveFiles(root, child));
    else files.push(child);
  }
  return files;
}

async function writeManifest(root) {
  const lines = [];
  for (const relative of (await recursiveFiles(root)).filter((file) => file !== "manifest.sha256").sort()) {
    lines.push(`${sha256(await readFile(path.join(root, relative)))}  ${relative.replaceAll("\\", "/")}`);
  }
  await writeFile(path.join(root, "manifest.sha256"), `${lines.join("\n")}\n`, "ascii");
}

async function verifyManifest(root) {
  const manifest = await readFile(path.join(root, "manifest.sha256"), "utf8");
  for (const line of manifest.trim().split(/\r?\n/u)) {
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/u);
    if (!match || sha256(await readFile(path.join(root, match[2]))) !== match[1]) throw new Error(`STOP: backup manifest mismatch: ${line}`);
  }
  return sha256(manifest);
}

async function prepare() {
  if (execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() !== "copilot-v1") throw new Error("STOP: wrong branch");
  const packageData = await verifyFrozenPackage();
  const snapshot = await takeSnapshot();
  const preflight = assertPreflight(packageData, snapshot, "before");
  const stamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  const backupDir = path.join(taskDir, "backups", `glbd-v1-confirmed-corrections-${stamp}`);
  await mkdir(path.join(backupDir, "execution-package"), { recursive: true });
  for (const [name, rows] of Object.entries({
    "products.json": snapshot.products,
    "global_product_aliases.json": snapshot.aliases,
    "agrochem_formulations.json": snapshot.formulations,
    "glbd_components.json": snapshot.components,
    "glbd_component_sources.json": snapshot.sources,
    "glbd_product_components.json": snapshot.links,
    "product_active_ingredients.json": snapshot.legacyLinks,
    "scoped_rows.json": snapshot.scoped,
  })) await writeFile(path.join(backupDir, name), json(rows), "utf8");
  await writeFile(path.join(backupDir, "preflight.json"), json({ task: TASK, generated_at: new Date().toISOString(), preflight, counts: snapshot.counts, fingerprints: {
    catalog: snapshot.catalogFingerprint,
    company: snapshot.companyFingerprint,
    blocked: snapshot.blockedFingerprint,
    hold: snapshot.holdFingerprint,
  } }), "utf8");
  await writeFile(path.join(backupDir, "execution-package", "production_apply.sql"), buildApplySql(), "utf8");
  await writeFile(path.join(backupDir, "execution-package", "production_rollback.sql"), buildRollbackSql(snapshot), "utf8");
  await writeManifest(backupDir);
  const manifestSha = await verifyManifest(backupDir);
  await mkdir(taskDir, { recursive: true });
  await writeFile(latestPointer, `${backupDir}\n`, "utf8");
  console.log(json({ task: TASK, status: "PREPARED", backup_dir: backupDir, manifest_sha256: manifestSha, preflight, counts: snapshot.counts, fingerprints: {
    catalog: snapshot.catalogFingerprint, company: snapshot.companyFingerprint, blocked: snapshot.blockedFingerprint, hold: snapshot.holdFingerprint,
  } }));
}

async function verify() {
  const backupDir = (await readFile(latestPointer, "utf8")).trim();
  const manifestSha = await verifyManifest(backupDir);
  const pre = JSON.parse(await readFile(path.join(backupDir, "preflight.json"), "utf8"));
  const backup = {
    products: JSON.parse(await readFile(path.join(backupDir, "products.json"), "utf8")),
    aliases: JSON.parse(await readFile(path.join(backupDir, "global_product_aliases.json"), "utf8")),
    formulations: JSON.parse(await readFile(path.join(backupDir, "agrochem_formulations.json"), "utf8")),
    components: JSON.parse(await readFile(path.join(backupDir, "glbd_components.json"), "utf8")),
    sources: JSON.parse(await readFile(path.join(backupDir, "glbd_component_sources.json"), "utf8")),
    links: JSON.parse(await readFile(path.join(backupDir, "glbd_product_components.json"), "utf8")),
    legacyLinks: JSON.parse(await readFile(path.join(backupDir, "product_active_ingredients.json"), "utf8")),
  };
  const packageData = await verifyFrozenPackage();
  const snapshot = await takeSnapshot();
  const postflight = assertPreflight(packageData, snapshot, "after");
  const targetIds = unique(PRODUCT_ACTIONS.map((row) => row.productId));
  const allowedFields = new Map(targetIds.map((id) => [id, new Set([
    ...PRODUCT_ACTIONS.filter((row) => row.productId === id).map((row) => row.field),
    "updated_at",
  ])]));
  const productComparable = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !allowedFields.get(row.id)?.has(key)));
  const unchangedTargetFields = targetIds.every((id) => {
    const before = backup.products.find((row) => row.id === id);
    const after = snapshot.products.find((row) => row.id === id);
    return stable(productComparable(before)) === stable(productComparable(after));
  });
  const insertedLinkIds = new Set(buildLinks().map((row) => row.linkId));
  const insertedSourceIds = new Set(buildLinks().map((row) => row.sourceId));
  const untouchedCatalogRowsUnchanged = [
    stable(sorted(backup.aliases)) === stable(sorted(snapshot.aliases)),
    stable(sorted(backup.formulations)) === stable(sorted(snapshot.formulations)),
    stable(sorted(backup.components)) === stable(sorted(snapshot.components)),
    stable(sorted(backup.legacyLinks)) === stable(sorted(snapshot.legacyLinks)),
    stable(sorted(backup.sources)) === stable(sorted(snapshot.sources.filter((row) => !insertedSourceIds.has(row.id)))),
    stable(sorted(backup.links)) === stable(sorted(snapshot.links.filter((row) => !insertedLinkIds.has(row.id)))),
  ].every(Boolean);
  const result = {
    task: TASK,
    status: "VERIFIED",
    backup_dir: backupDir,
    manifest_sha256: manifestSha,
    counts: snapshot.counts,
    links_added: snapshot.counts.links - pre.counts.links,
    sources_added: snapshot.counts.sources - pre.counts.sources,
    blocked_unchanged: snapshot.blockedFingerprint === pre.fingerprints.blocked,
    hold_unchanged: snapshot.holdFingerprint === pre.fingerprints.hold,
    company_data_unchanged: snapshot.companyFingerprint === pre.fingerprints.company,
    nonapproved_target_fields_unchanged: unchangedTargetFields,
    untouched_catalog_rows_unchanged: untouchedCatalogRowsUnchanged,
    postflight,
  };
  if (!result.blocked_unchanged || !result.hold_unchanged || !result.company_data_unchanged
    || !result.nonapproved_target_fields_unchanged || !result.untouched_catalog_rows_unchanged
    || result.links_added !== 4 || result.sources_added !== 4) {
    throw new Error(`STOP: post-apply invariant failed: ${json(result)}`);
  }
  await writeFile(path.join(taskDir, "postcheck.json"), json(result), "utf8");
  console.log(json(result));
}

if (mode === "prepare") await prepare();
else if (mode === "verify") await verify();
else throw new Error(`Unknown mode: ${mode}`);
