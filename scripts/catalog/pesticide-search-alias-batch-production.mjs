import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const TASK = "TZ-188";
const PROJECT_REF = "bhsemlvmkikpntabctml";
const APPROVED_SOURCE_COMMIT = "7779b7578f272adb46932488c6f527da2acdb615";
const EXPECTED_TZ187_MANIFEST_SHA256 = "7486e4bf0d272a4e3ea84673367a996e81f8b811500d7f9acb1be588f85579cf";
const EXPECTED_CARDS = 50;
const EXPECTED_ALIASES = 50;
const EXPECTED_SOURCE = "TZ-187 deterministic formulation-suffix alias from trade_name";
const mode = process.argv[2] || "prepare";

const repoRoot = process.cwd();
const auditRoot = path.resolve(repoRoot, "..", "..", "audit-output");
const sourceDir = path.join(auditRoot, "TZ-187");
const outputDir = path.join(auditRoot, TASK);
const latestPointer = path.join(outputDir, "latest-backup.txt");

nextEnv.loadEnvConfig(repoRoot);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Required production server credentials are unavailable");
if (!supabaseUrl.includes(PROJECT_REF)) throw new Error("STOP: wrong Supabase production project");

const client = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "x-travkin-audit": `${TASK}-${mode}` } },
});

const text = (value) => String(value ?? "").trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const unique = (values) => Array.from(new Set(values.filter(Boolean)));

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeCatalogName(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/\b(рн|pн|ph)\b/giu, "ph")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeSearchText(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'`]/gu, "")
    .replace(/\b(кс|вдг|вр|sc|wg|ec|fs)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sqlText(value) {
  if (value == null) return "null";
  const raw = String(value);
  if (/^[\x20-\x7e]*$/u.test(raw)) return `'${raw.replaceAll("'", "''")}'`;
  return `convert_from(decode('${Buffer.from(raw, "utf8").toString("base64")}', 'base64'), 'utf8')`;
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
      } else if (char === '"') quoted = false;
      else field += char;
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
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
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

async function verifyManifest(directory) {
  const manifestPath = path.join(directory, "manifest.sha256");
  const manifest = await readFile(manifestPath);
  for (const line of manifest.toString("utf8").trim().split(/\r?\n/gu)) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/u);
    if (!match) throw new Error(`STOP: invalid manifest line: ${line}`);
    const [, expected, fileName] = match;
    if (sha256(await readFile(path.join(directory, fileName))) !== expected) {
      throw new Error(`STOP: manifest mismatch for ${fileName}`);
    }
  }
  return sha256(manifest);
}

function assertSourceCommit() {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", APPROVED_SOURCE_COMMIT, "HEAD"], { cwd: repoRoot, stdio: "ignore" });
  } catch {
    throw new Error(`STOP: approved commit ${APPROVED_SOURCE_COMMIT} is not an ancestor of HEAD`);
  }
}

async function readApprovedActions() {
  const manifestSha = await verifyManifest(sourceDir);
  if (manifestSha !== EXPECTED_TZ187_MANIFEST_SHA256) throw new Error("STOP: TZ-187 manifest SHA-256 drift");
  const csvRows = parseCsv(await readFile(path.join(sourceDir, "batch_01_cards.csv"), "utf8"));
  const preview = JSON.parse(await readFile(path.join(sourceDir, "batch_01_apply_preview.json"), "utf8"));
  if (csvRows.length !== EXPECTED_CARDS || preview.actions.length !== EXPECTED_ALIASES) {
    throw new Error(`STOP: expected ${EXPECTED_CARDS}/${EXPECTED_ALIASES}, found ${csvRows.length}/${preview.actions.length}`);
  }
  const csvByProduct = new Map(csvRows.map((row) => [row.product_id, row]));
  const actions = preview.actions.map((action) => {
    const csv = csvByProduct.get(action.product_id);
    if (!csv || csv.alias !== action.alias || csv.normalized_alias !== action.normalized_alias || csv.trade_name !== action.trade_name) {
      throw new Error(`STOP: CSV/preview mismatch for ${action.product_id}`);
    }
    if (action.candidate_type !== "SHORT_FORMULATION_ALIAS" || action.source !== EXPECTED_SOURCE) {
      throw new Error(`STOP: unauthorized alias action for ${action.product_id}`);
    }
    return action;
  });
  if (new Set(actions.map((row) => row.product_id)).size !== EXPECTED_CARDS || new Set(actions.map((row) => row.alias_id)).size !== EXPECTED_ALIASES) {
    throw new Error("STOP: duplicate card or alias IDs in approved package");
  }
  return { actions, manifestSha };
}

function collisionOwners(products, aliases, action) {
  const owners = [];
  for (const product of products) {
    if (product.id === action.product_id) continue;
    const values = [product.trade_name, product.name, product.normalized_name, product.name_ru, product.name_en];
    if (values.some((value) => normalizeCatalogName(value) === action.normalized_alias)) owners.push(`product:${product.id}`);
  }
  for (const alias of aliases) {
    if (alias.product_id !== action.product_id && normalizeCatalogName(alias.normalized_alias || alias.alias) === action.normalized_alias) {
      owners.push(`alias:${alias.id}`);
    }
  }
  return unique(owners);
}

function buildValues(actions) {
  return actions.map((action) => `(
    '${action.alias_id}'::uuid,
    '${action.product_id}'::uuid,
    ${sqlText(action.trade_name)},
    ${sqlText(action.alias)},
    ${sqlText(action.normalized_alias)},
    ${sqlText(action.source)}
  )`).join(",\n");
}

function buildApplySql(actions) {
  const values = buildValues(actions);
  return `-- ${TASK} owner-approved exact 50-row apply. Generated from verified TZ-187 package.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table tz188_alias_batch (
  id uuid primary key,
  product_id uuid not null,
  expected_trade_name text not null,
  alias text not null,
  normalized_alias text not null,
  source text not null
) on commit drop;

insert into tz188_alias_batch(id,product_id,expected_trade_name,alias,normalized_alias,source)
values
${values};

do $tz188_preflight$
declare
  v_rows integer;
  v_exact integer;
begin
  select count(*) into v_rows from tz188_alias_batch;
  if v_rows <> 50 then raise exception 'TZ-188 expected 50 package rows, got %', v_rows; end if;

  if (select count(distinct product_id) from tz188_alias_batch) <> 50 then
    raise exception 'TZ-188 package product IDs are not unique';
  end if;

  if (select count(*) from products p join tz188_alias_batch b on b.product_id=p.id
      where p.company_id is null and p.product_type='pesticide' and p.archived=false and coalesce(p.trade_name,p.name)=b.expected_trade_name) <> 50 then
    raise exception 'TZ-188 target product scope or trade-name baseline drift';
  end if;

  if exists (select 1 from products p join tz188_alias_batch b on b.product_id=p.id where p.company_id is not null) then
    raise exception 'TZ-188 company product entered target scope';
  end if;

  if exists (
    select 1 from global_product_aliases a join tz188_alias_batch b on a.id=b.id
    where a.product_id<>b.product_id or a.alias<>b.alias or lower(a.normalized_alias)<>lower(b.normalized_alias) or coalesce(a.source,'')<>b.source
  ) then raise exception 'TZ-188 deterministic alias ID conflict'; end if;

  if exists (
    select 1 from global_product_aliases a join tz188_alias_batch b on a.product_id=b.product_id and lower(a.normalized_alias)=lower(b.normalized_alias)
    where a.id<>b.id or a.alias<>b.alias or coalesce(a.source,'')<>b.source
  ) then raise exception 'TZ-188 same-product alias conflict'; end if;

  if exists (
    select 1 from global_product_aliases a join tz188_alias_batch b on lower(a.normalized_alias)=lower(b.normalized_alias)
    where a.product_id<>b.product_id
  ) then raise exception 'TZ-188 foreign alias collision'; end if;

  if exists (
    select 1
    from products p
    join tz188_alias_batch b on p.id<>b.product_id
    where p.company_id is null and (
      lower(regexp_replace(replace(coalesce(p.trade_name,''),'ё','е'),'[^[:alnum:]]','','g'))=lower(b.normalized_alias)
      or lower(regexp_replace(replace(coalesce(p.name,''),'ё','е'),'[^[:alnum:]]','','g'))=lower(b.normalized_alias)
      or lower(regexp_replace(replace(coalesce(p.normalized_name,''),'ё','е'),'[^[:alnum:]]','','g'))=lower(b.normalized_alias)
      or lower(regexp_replace(replace(coalesce(p.name_ru,''),'ё','е'),'[^[:alnum:]]','','g'))=lower(b.normalized_alias)
      or lower(regexp_replace(replace(coalesce(p.name_en,''),'ё','е'),'[^[:alnum:]]','','g'))=lower(b.normalized_alias)
    )
  ) then raise exception 'TZ-188 foreign product identity collision'; end if;

  select count(*) into v_exact
  from global_product_aliases a join tz188_alias_batch b
    on a.id=b.id and a.product_id=b.product_id and a.alias=b.alias
   and lower(a.normalized_alias)=lower(b.normalized_alias) and coalesce(a.source,'')=b.source;
  if v_exact not in (0,50) then raise exception 'TZ-188 partial apply state: % exact rows', v_exact; end if;
end
$tz188_preflight$;

create temporary table tz188_metrics(metric text primary key, value integer not null) on commit preserve rows;

with inserted as (
  insert into global_product_aliases(id,product_id,alias,normalized_alias,source)
  select id,product_id,alias,normalized_alias,source from tz188_alias_batch
  on conflict do nothing
  returning 1
)
insert into tz188_metrics values ('inserted', (select count(*) from inserted));

do $tz188_postcheck$
begin
  if (select count(*) from global_product_aliases a join tz188_alias_batch b
      on a.id=b.id and a.product_id=b.product_id and a.alias=b.alias
     and lower(a.normalized_alias)=lower(b.normalized_alias) and coalesce(a.source,'')=b.source) <> 50 then
    raise exception 'TZ-188 post-apply exact row count mismatch';
  end if;
  if (select value from tz188_metrics where metric='inserted') not in (0,50) then
    raise exception 'TZ-188 inserted count must be 0 or 50';
  end if;
end
$tz188_postcheck$;

commit;
select metric,value from tz188_metrics order by metric;
`;
}

function buildRollbackSql(actions) {
  const values = buildValues(actions);
  return `-- ${TASK} exact rollback. Run only if post-apply acceptance fails.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create temporary table tz188_alias_batch (
  id uuid primary key, product_id uuid not null, expected_trade_name text not null,
  alias text not null, normalized_alias text not null, source text not null
) on commit drop;
insert into tz188_alias_batch(id,product_id,expected_trade_name,alias,normalized_alias,source)
values
${values};

do $tz188_rollback_preflight$
begin
  if (select count(*) from global_product_aliases a join tz188_alias_batch b
      on a.id=b.id and a.product_id=b.product_id and a.alias=b.alias
     and lower(a.normalized_alias)=lower(b.normalized_alias) and coalesce(a.source,'')=b.source) <> 50 then
    raise exception 'TZ-188 rollback requires all 50 exact rows';
  end if;
end
$tz188_rollback_preflight$;

create temporary table tz188_rollback_metrics(metric text primary key, value integer not null) on commit preserve rows;
with removed as (
  delete from global_product_aliases a using tz188_alias_batch b
  where a.id=b.id and a.product_id=b.product_id and a.alias=b.alias
    and lower(a.normalized_alias)=lower(b.normalized_alias) and coalesce(a.source,'')=b.source
  returning 1
)
insert into tz188_rollback_metrics values ('deleted', (select count(*) from removed));

do $tz188_rollback_postcheck$
begin
  if (select value from tz188_rollback_metrics where metric='deleted') <> 50 then
    raise exception 'TZ-188 rollback deleted unexpected row count';
  end if;
end
$tz188_rollback_postcheck$;
commit;
select metric,value from tz188_rollback_metrics order by metric;
`;
}

async function snapshot(actions) {
  const [products, aliases] = await Promise.all([
    fetchAll("products"),
    fetchAll("global_product_aliases"),
  ]);
  const productById = new Map(products.map((row) => [row.id, row]));
  const targetIds = new Set(actions.map((row) => row.product_id));
  const targetProducts = products.filter((row) => targetIds.has(row.id));
  const targetAliases = aliases.filter((row) => targetIds.has(row.product_id));
  const exactRows = actions.filter((action) => aliases.some((alias) => alias.id === action.alias_id
    && alias.product_id === action.product_id
    && alias.alias === action.alias
    && normalizeCatalogName(alias.normalized_alias) === action.normalized_alias
    && text(alias.source) === action.source));
  const sameProductConflicts = actions.filter((action) => aliases.some((alias) => alias.product_id === action.product_id
    && normalizeCatalogName(alias.normalized_alias || alias.alias) === action.normalized_alias
    && alias.id !== action.alias_id));
  const collisions = actions.flatMap((action) => collisionOwners(products.filter((row) => row.company_id == null), aliases, action)
    .map((owner) => ({ product_id: action.product_id, alias: action.alias, owner })));
  const companyProducts = products.filter((row) => row.company_id != null);
  return {
    products,
    aliases,
    targetProducts,
    targetAliases,
    exactRows,
    sameProductConflicts,
    collisions,
    counts: {
      products: products.length,
      globalProducts: products.filter((row) => row.company_id == null).length,
      companyProducts: companyProducts.length,
      aliases: aliases.length,
    },
    companyProductsFingerprint: sha256(stable(companyProducts)),
    targetProductsFingerprint: sha256(stable(targetProducts)),
    aliasesFingerprint: sha256(stable(aliases)),
  };
}

function assertFreshPreflight(actions, state) {
  if (state.targetProducts.length !== EXPECTED_CARDS) throw new Error(`STOP: target cards ${state.targetProducts.length}`);
  for (const action of actions) {
    const product = state.targetProducts.find((row) => row.id === action.product_id);
    if (!product || product.company_id != null || product.product_type !== "pesticide" || product.archived) {
      throw new Error(`STOP: invalid target scope ${action.product_id}`);
    }
    if (text(product.trade_name || product.name) !== action.trade_name) throw new Error(`STOP: trade-name drift ${action.product_id}`);
  }
  if (state.exactRows.length !== 0) throw new Error(`STOP: expected aliases absent, exact rows ${state.exactRows.length}`);
  if (state.sameProductConflicts.length) throw new Error(`STOP: same-product conflicts ${state.sameProductConflicts.length}`);
  if (state.collisions.length) throw new Error(`STOP: alias collisions ${state.collisions.length}`);
}

async function writeManifest(directory) {
  const files = (await readdir(directory)).filter((name) => name !== "manifest.sha256").sort();
  const lines = [];
  for (const fileName of files) lines.push(`${sha256(await readFile(path.join(directory, fileName)))}  ${fileName}`);
  await writeFile(path.join(directory, "manifest.sha256"), `${lines.join("\n")}\n`, "utf8");
  await verifyManifest(directory);
  return sha256(await readFile(path.join(directory, "manifest.sha256")));
}

async function prepare() {
  assertSourceCommit();
  const { actions, manifestSha } = await readApprovedActions();
  const state = await snapshot(actions);
  assertFreshPreflight(actions, state);

  const stamp = new Date().toISOString().replace(/[-:.]/gu, "");
  const backupDir = path.join(outputDir, "backups", `pesticide-alias-batch-one-${stamp}`);
  await mkdir(backupDir, { recursive: true });
  const preflight = {
    task: TASK,
    status: "PASS",
    project_ref: PROJECT_REF,
    approved_source_commit: APPROVED_SOURCE_COMMIT,
    tz187_manifest_sha256: manifestSha,
    cards_expected: EXPECTED_CARDS,
    cards_found: state.targetProducts.length,
    aliases_expected: EXPECTED_ALIASES,
    exact_aliases_before: state.exactRows.length,
    same_product_conflicts: state.sameProductConflicts.length,
    foreign_collisions: state.collisions.length,
    company_targets: state.targetProducts.filter((row) => row.company_id != null).length,
    counts_before: state.counts,
    target_products_fingerprint: state.targetProductsFingerprint,
    aliases_fingerprint: state.aliasesFingerprint,
    company_products_fingerprint: state.companyProductsFingerprint,
    production_writes: 0,
  };
  const files = new Map([
    ["approved_actions.json", json(actions)],
    ["target_products_before.json", json(state.targetProducts)],
    ["target_aliases_before.json", json(state.targetAliases)],
    ["all_aliases_before.json", json(state.aliases)],
    ["preflight.json", json(preflight)],
    ["apply.sql", buildApplySql(actions)],
    ["rollback.sql", buildRollbackSql(actions)],
    ["tz187_manifest.sha256", await readFile(path.join(sourceDir, "manifest.sha256"), "utf8")],
    ["batch_01_cards.csv", await readFile(path.join(sourceDir, "batch_01_cards.csv"), "utf8")],
  ]);
  for (const [name, content] of files) await writeFile(path.join(backupDir, name), content, "utf8");
  const backupManifestSha = await writeManifest(backupDir);
  await mkdir(outputDir, { recursive: true });
  await writeFile(latestPointer, `${backupDir}\n`, "utf8");
  console.log(json({ status: "PASS", backup_dir: backupDir, backup_manifest_sha256: backupManifestSha, preflight }));
}

async function postcheck() {
  const backupDir = text(await readFile(latestPointer, "utf8"));
  const backupManifestSha = await verifyManifest(backupDir);
  const actions = JSON.parse(await readFile(path.join(backupDir, "approved_actions.json"), "utf8"));
  const preflight = JSON.parse(await readFile(path.join(backupDir, "preflight.json"), "utf8"));
  const state = await snapshot(actions);
  const exactRows = actions.filter((action) => state.aliases.some((alias) => alias.id === action.alias_id
    && alias.product_id === action.product_id
    && alias.alias === action.alias
    && normalizeCatalogName(alias.normalized_alias) === action.normalized_alias
    && text(alias.source) === action.source));
  const duplicateGroups = new Map();
  for (const alias of state.aliases) {
    const key = `${alias.product_id}:${normalizeCatalogName(alias.normalized_alias || alias.alias)}`;
    duplicateGroups.set(key, (duplicateGroups.get(key) || 0) + 1);
  }
  const duplicates = Array.from(duplicateGroups.values()).filter((count) => count > 1).length;
  const collisions = actions.flatMap((action) => collisionOwners(state.products.filter((row) => row.company_id == null), state.aliases, action)
    .filter((owner) => owner !== `alias:${action.alias_id}`)
    .map((owner) => ({ product_id: action.product_id, alias: action.alias, owner })));
  const aliasesByProduct = new Map();
  for (const alias of state.aliases) {
    if (!aliasesByProduct.has(alias.product_id)) aliasesByProduct.set(alias.product_id, []);
    aliasesByProduct.get(alias.product_id).push(alias.alias);
  }
  const activeGlobalProducts = state.products.filter((row) => row.company_id == null && !row.archived && row.is_active !== false);
  const searchResults = actions.map((action) => {
    const needle = normalizeSearchText(action.alias);
    const matches = activeGlobalProducts.filter((product) => [
      product.trade_name,
      product.name,
      product.normalized_name,
      ...(aliasesByProduct.get(product.id) || []),
    ].some((value) => normalizeSearchText(value).includes(needle)));
    return {
      product_id: action.product_id,
      query: action.alias,
      passed: matches.some((row) => row.id === action.product_id),
      match_count: matches.length,
      matched_product_ids: matches.map((row) => row.id),
    };
  });
  const controlDefinitions = [
    { query: "Curamin", expected: ["curamin foliar", "курамин фолиар"] },
    { query: "Курамин", expected: ["curamin foliar", "курамин фолиар"] },
    { query: "Фолиар", expected: ["curamin foliar", "курамин фолиар"] },
    { query: "Phomazin", expected: ["phomazin", "swissgrow phomazin", "фомазин"] },
    { query: "Фомазин", expected: ["phomazin", "swissgrow phomazin", "фомазин"] },
  ];
  const controls = controlDefinitions.map((definition) => {
    const needle = normalizeSearchText(definition.query);
    const matches = activeGlobalProducts.filter((product) => [
      product.trade_name,
      product.name,
      product.normalized_name,
      ...(aliasesByProduct.get(product.id) || []),
    ].some((value) => normalizeSearchText(value).includes(needle)));
    return {
      ...definition,
      passed: matches.some((row) => definition.expected.some((expected) =>
        normalizeCatalogName(row.trade_name || row.name) === normalizeCatalogName(expected))),
      matched_product_ids: matches.map((row) => row.id),
    };
  });
  const targetProductsFingerprint = sha256(stable(state.targetProducts));
  const result = {
    status: exactRows.length === 50
      && state.counts.aliases === preflight.counts_before.aliases + 50
      && duplicates === 0
      && collisions.length === 0
      && searchResults.every((row) => row.passed)
      && controls.every((row) => row.passed)
      && targetProductsFingerprint === preflight.target_products_fingerprint
      && state.companyProductsFingerprint === preflight.company_products_fingerprint
      ? "PASS" : "FAIL",
    backup_dir: backupDir,
    backup_manifest_sha256: backupManifestSha,
    aliases_inserted: exactRows.length,
    total_aliases_before: preflight.counts_before.aliases,
    total_aliases_after: state.counts.aliases,
    duplicate_groups: duplicates,
    alias_conflicts: collisions.length,
    search_pass: searchResults.filter((row) => row.passed).length,
    search_total: searchResults.length,
    ambiguous_search_results: searchResults.filter((row) => row.match_count > 1).length,
    controls_pass: controls.filter((row) => row.passed).length,
    controls_total: controls.length,
    target_products_unchanged: targetProductsFingerprint === preflight.target_products_fingerprint,
    company_products_unchanged: state.companyProductsFingerprint === preflight.company_products_fingerprint,
    search_results: searchResults,
    controls,
  };
  await writeFile(path.join(outputDir, "postcheck.json"), json(result), "utf8");
  console.log(json(result));
  if (result.status !== "PASS") throw new Error("STOP: TZ-188 postcheck failed; execute exact rollback");
}

if (mode === "prepare") await prepare();
else if (mode === "postcheck") await postcheck();
else throw new Error(`Unknown mode: ${mode}`);
