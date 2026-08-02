import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const TASK = "TZ-187";
const PROJECT_REF = "bhsemlvmkikpntabctml";
const EXPECTED_TZ180_FINGERPRINT = "2d74a26055cbad5a1466b591dc77ffc2926364ccafa06cf2d26f44f05401f696";
const EXPECTED_REMAINING_CARDS = 807;
const MAX_BATCH_CARDS = 50;
const EXCLUDED_NAMES = new Set(["дитан", "метамил", "курзат"]);
const FORMULATION_SUFFIX = /(?:,|\s)\s*(?:вдг|кс|кэ|вр|врк|ск|мкс|сп|wp|ec|sc|wg|sl|fs|cs)\s*$/iu;
const FORMULATION_EQUIVALENTS = {
  "вдг": "wg",
  "в д г": "wg",
  wg: "wg",
  "кс": "sc",
  "к с": "sc",
  sc: "sc",
  "кэ": "ec",
  "к е": "ec",
  ec: "ec",
  "вр": "sl",
  "в р": "sl",
  "врк": "sl",
  sl: "sl",
};

const repoRoot = process.cwd();
const auditRoot = path.resolve(repoRoot, "..", "..", "audit-output");
const inputDir = path.join(auditRoot, "TZ-180");
const reviewDir = path.join(auditRoot, "TZ-181");
const outputDir = path.join(auditRoot, TASK);

nextEnv.loadEnvConfig(repoRoot);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Required production read credentials are unavailable");
if (!supabaseUrl.includes(PROJECT_REF)) throw new Error("STOP: wrong Supabase project");

const client = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "x-travkin-audit": `${TASK}-read-only` } },
});

const text = (value) => String(value ?? "").trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const unique = (values) => Array.from(new Set(values.filter(Boolean)));
const hasCyrillic = (value) => /[\u0400-\u04ff]/u.test(text(value));
const hasLatin = (value) => /[A-Za-z]/u.test(text(value));

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compactSpaces(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}

function normalizeFormulations(value) {
  let next = value;
  for (const [source, target] of Object.entries(FORMULATION_EQUIVALENTS)) {
    next = next.replace(new RegExp(`(^|\\s)${escapeRegex(source)}(?=\\s|$)`, "giu"), `$1${target}`);
  }
  return next;
}

function normalizeCatalogName(value) {
  return normalizeFormulations(
    compactSpaces(value)
      .toLowerCase()
      .replace(/ё/gu, "е")
      .replace(/[“”„«»]/gu, "\"")
      .replace(/[’`]/gu, "'")
      .replace(/\b(рн|pн|ph)\b/giu, "ph")
      .replace(/\./gu, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " "),
  ).replace(/\s+/gu, "");
}

function csvCell(value) {
  const raw = Array.isArray(value) ? value.join("; ") : value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return `"${raw.replaceAll('"', '""')}"`;
}

function toCsv(rows, columns) {
  return `${columns.map(csvCell).join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

function deterministicUuid(seed) {
  const hex = sha256(seed).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function shortFormAlias(value) {
  const original = compactSpaces(value);
  const shortened = compactSpaces(original.replace(FORMULATION_SUFFIX, ""));
  return shortened && shortened !== original && normalizeCatalogName(shortened).length >= 3 ? shortened : "";
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
  const manifest = await readFile(path.join(directory, "manifest.sha256"), "utf8");
  for (const line of manifest.trim().split(/\r?\n/gu)) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/u);
    if (!match) throw new Error(`STOP: invalid manifest line: ${line}`);
    const [, expected, fileName] = match;
    const actual = sha256(await readFile(path.join(directory, fileName)));
    if (actual !== expected) throw new Error(`STOP: manifest mismatch for ${fileName}`);
  }
  return sha256(manifest);
}

function addOwner(index, value, productId, source) {
  const key = normalizeCatalogName(value);
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push({ product_id: productId, source, value: text(value) });
}

function splitBatches(cards) {
  const batches = [];
  for (let index = 0; index < cards.length; index += MAX_BATCH_CARDS) {
    const batchCards = cards.slice(index, index + MAX_BATCH_CARDS);
    batches.push({
      batch_number: batches.length + 1,
      card_count: batchCards.length,
      action_count: batchCards.reduce((sum, card) => sum + card.actions.length, 0),
      product_ids: batchCards.map((card) => card.product_id),
      cards: batchCards,
    });
  }
  return batches;
}

function applyPreview(baselineAliases, actions) {
  const next = baselineAliases.map((row) => ({ ...row }));
  let inserts = 0;
  for (const action of actions) {
    const exists = next.some((row) => row.product_id === action.product_id && normalizeCatalogName(row.normalized_alias || row.alias) === action.normalized_alias);
    if (exists) continue;
    next.push({
      id: action.alias_id,
      product_id: action.product_id,
      alias: action.alias,
      normalized_alias: action.normalized_alias,
      source: action.source,
    });
    inserts += 1;
  }
  return { rows: next, inserts };
}

const tz180Manifest = await verifyManifest(inputDir);
const tz181Manifest = await verifyManifest(reviewDir);
const tz180Summary = JSON.parse(await readFile(path.join(inputDir, "readiness_summary.json"), "utf8"));
if (tz180Summary.audit_fingerprint_sha256 !== EXPECTED_TZ180_FINGERPRINT) {
  throw new Error("STOP: TZ-180 audit fingerprint drift");
}
const tz180Rows = JSON.parse(await readFile(path.join(inputDir, "pesticide_cards_audit.json"), "utf8"));
const remainingRows = tz180Rows.filter((row) => row.batch === "BATCH_3_P2");
if (remainingRows.length !== EXPECTED_REMAINING_CARDS || new Set(remainingRows.map((row) => row.product_id)).size !== EXPECTED_REMAINING_CARDS) {
  throw new Error(`STOP: expected ${EXPECTED_REMAINING_CARDS} unique remaining cards, found ${remainingRows.length}`);
}

const tz181Review = JSON.parse(await readFile(path.join(reviewDir, "batch1_review.json"), "utf8"));
const batchOneIds = new Set(tz181Review.rows.map((row) => row.product_id));
const unresolvedIds = new Set(tz181Review.rows.filter((row) => row.group === "UNRESOLVED").map((row) => row.product_id));
if (unresolvedIds.size !== 15) throw new Error(`STOP: expected 15 unresolved products, found ${unresolvedIds.size}`);
if (remainingRows.some((row) => batchOneIds.has(row.product_id))) throw new Error("STOP: TZ-180 remaining scope overlaps Batch 1");

const [allGlobalProducts, productAliases, manufacturers] = await Promise.all([
  fetchAll("products", "*", (query) => query.is("company_id", null)),
  fetchAll("global_product_aliases"),
  fetchAll("agrochem_manufacturers"),
]);
const productById = new Map(allGlobalProducts.map((row) => [row.id, row]));
const manufacturerById = new Map(manufacturers.map((row) => [row.id, row]));
const remainingIds = new Set(remainingRows.map((row) => row.product_id));
const missingLiveRows = remainingRows.filter((row) => !productById.has(row.product_id));
if (missingLiveRows.length) throw new Error(`STOP: ${missingLiveRows.length} remaining products are missing in production`);
const companyScoped = remainingRows.filter((row) => productById.get(row.product_id)?.company_id != null);
if (companyScoped.length) throw new Error(`STOP: ${companyScoped.length} company products entered the global scope`);
const ineligibleLiveRows = remainingRows.filter((row) => {
  const product = productById.get(row.product_id);
  return product.product_type !== "pesticide" || product.archived;
});
if (ineligibleLiveRows.length) throw new Error(`STOP: ${ineligibleLiveRows.length} remaining cards left the active global pesticide scope`);

const identityOwners = new Map();
for (const product of allGlobalProducts) {
  for (const [source, value] of [
    ["trade_name", product.trade_name],
    ["name", product.name],
    ["normalized_name", product.normalized_name],
    ["name_ru", product.name_ru],
    ["name_en", product.name_en],
  ]) addOwner(identityOwners, value, product.id, source);
}
for (const alias of productAliases) addOwner(identityOwners, alias.normalized_alias || alias.alias, alias.product_id, "alias");

const aliasesByProduct = new Map();
for (const alias of productAliases) {
  if (!aliasesByProduct.has(alias.product_id)) aliasesByProduct.set(alias.product_id, []);
  aliasesByProduct.get(alias.product_id).push(alias);
}

const collisionRows = [];
const safeCards = [];
const noActionRows = [];
const excludedRows = [];
const manufacturerPrefixRows = [];
const nameNormalizationRows = [];

for (const auditRow of remainingRows) {
  const product = productById.get(auditRow.product_id);
  const officialName = text(product.trade_name || product.name);
  const officialKey = normalizeCatalogName(officialName);
  const normalizedExcluded = normalizeCatalogName(officialName);
  if (EXCLUDED_NAMES.has(normalizedExcluded) || unresolvedIds.has(product.id)) {
    excludedRows.push({ product_id: product.id, trade_name: officialName, reason: unresolvedIds.has(product.id) ? "TZ-181_UNRESOLVED" : "OWNER_HOLD" });
    continue;
  }

  const existingAliases = aliasesByProduct.get(product.id) || [];
  const actions = [];
  const candidates = [
    { field: "name_ru", language: "ru", value: text(product.name_ru), valid: hasCyrillic, candidateType: "LOCALIZED_ALIAS" },
    { field: "name_en", language: "en", value: text(product.name_en), valid: hasLatin, candidateType: "LOCALIZED_ALIAS" },
    {
      field: "trade_name",
      language: hasCyrillic(officialName) ? "ru" : "en",
      value: shortFormAlias(officialName),
      valid: (value) => hasCyrillic(value) || hasLatin(value),
      candidateType: "SHORT_FORMULATION_ALIAS",
    },
  ];
  for (const candidate of candidates) {
    const alias = compactSpaces(candidate.value);
    const normalizedAlias = normalizeCatalogName(alias);
    if (!alias || !candidate.valid(alias) || normalizedAlias.length < 3 || normalizedAlias === officialKey) continue;
    if (existingAliases.some((row) => normalizeCatalogName(row.normalized_alias || row.alias) === normalizedAlias)) continue;
    const owners = unique((identityOwners.get(normalizedAlias) || []).map((row) => row.product_id));
    const foreignOwners = owners.filter((id) => id !== product.id);
    if (foreignOwners.length) {
      collisionRows.push({
        product_id: product.id,
        trade_name: officialName,
        candidate_alias: alias,
        normalized_alias: normalizedAlias,
        language: candidate.language,
        foreign_product_ids: foreignOwners,
        reason: "ALIAS_IDENTITY_COLLISION",
      });
      continue;
    }
    actions.push({
      action: "INSERT_GLOBAL_PRODUCT_ALIAS",
      alias_id: deterministicUuid(`${TASK}:${product.id}:${normalizedAlias}`),
      product_id: product.id,
      trade_name: officialName,
      alias,
      normalized_alias: normalizedAlias,
      language: candidate.language,
      candidate_type: candidate.candidateType,
      source_field: `products.${candidate.field}`,
      source: candidate.candidateType === "SHORT_FORMULATION_ALIAS"
        ? `${TASK} deterministic formulation-suffix alias from trade_name`
        : `${TASK} verified existing ${candidate.field}`,
      risk: "LOW_ADDITIVE",
      rollback: "Delete only the deterministic alias_id after exact product_id and normalized_alias checks.",
    });
  }

  const manufacturer = text(manufacturerById.get(product.manufacturer_id)?.name || product.manufacturer);
  if (manufacturer && officialName.toLocaleLowerCase("en").startsWith(`${manufacturer.toLocaleLowerCase("en")} `)) {
    manufacturerPrefixRows.push({
      product_id: product.id,
      trade_name: officialName,
      manufacturer,
      proposed_trade_name: compactSpaces(officialName.slice(manufacturer.length)),
      decision: "REVIEW_ONLY_NO_AUTOMATIC_UPDATE",
    });
  }
  const compactName = compactSpaces(officialName);
  if (compactName !== officialName) {
    nameNormalizationRows.push({
      product_id: product.id,
      trade_name: officialName,
      proposed_trade_name: compactName,
      decision: "SAFE_FORMAT_REVIEW_NOT_IN_BATCH_1",
    });
  }

  if (actions.length) {
    safeCards.push({
      product_id: product.id,
      trade_name: officialName,
      current_aliases: existingAliases.map((row) => row.alias).sort(),
      actions: actions.sort((left, right) => left.language.localeCompare(right.language)),
      priority: actions.some((row) => row.language === "ru") ? 1 : 2,
    });
  } else {
    noActionRows.push({ product_id: product.id, trade_name: officialName, reason: "NO_COLLISION_FREE_EXISTING_LOCALIZED_ALIAS" });
  }
}

safeCards.sort((left, right) => left.priority - right.priority || left.trade_name.localeCompare(right.trade_name, "ru") || left.product_id.localeCompare(right.product_id));
const batches = splitBatches(safeCards);
const firstBatch = batches[0] || { batch_number: 1, card_count: 0, action_count: 0, product_ids: [], cards: [] };
const firstActions = firstBatch.cards.flatMap((card) => card.actions);

const baselineScopedAliases = productAliases.filter((row) => firstBatch.product_ids.includes(row.product_id));
const beforeFingerprint = sha256(stable(baselineScopedAliases));
const firstApply = applyPreview(baselineScopedAliases, firstActions);
const firstFingerprint = sha256(stable(firstApply.rows));
const secondApply = applyPreview(firstApply.rows, firstActions);
const rollbackIds = new Set(firstActions.map((action) => action.alias_id));
const rolledBack = secondApply.rows.filter((row) => !rollbackIds.has(row.id));
const rollbackFingerprint = sha256(stable(rolledBack));
const duplicateAliasKeys = firstApply.rows.reduce((result, row) => {
  const key = `${row.product_id}:${normalizeCatalogName(row.normalized_alias || row.alias)}`;
  result.set(key, (result.get(key) || 0) + 1);
  return result;
}, new Map());
const duplicateAliasesAfterApply = Array.from(duplicateAliasKeys.values()).filter((count) => count > 1).length;
const testResults = {
  status: firstActions.length > 0 && firstApply.inserts === firstActions.length && secondApply.inserts === 0 && rollbackFingerprint === beforeFingerprint && duplicateAliasesAfterApply === 0 ? "PASS" : "FAIL",
  first_apply_inserts: firstApply.inserts,
  second_apply_inserts: secondApply.inserts,
  second_apply_noop: secondApply.inserts === 0,
  duplicate_aliases_after_apply: duplicateAliasesAfterApply,
  rollback_fingerprint_match: rollbackFingerprint === beforeFingerprint,
  before_fingerprint: beforeFingerprint,
  after_fingerprint: firstFingerprint,
  rollback_fingerprint: rollbackFingerprint,
};
if (testResults.status !== "PASS") throw new Error(`STOP: isolated preview verification failed: ${JSON.stringify(testResults)}`);

const baselineFingerprint = sha256(stable({
  remainingProducts: remainingRows.map((row) => productById.get(row.product_id)),
  aliases: productAliases,
}));
const allSafeActions = safeCards.flatMap((card) => card.actions);
const currentGlobalPesticides = allGlobalProducts.filter((row) => row.product_type === "pesticide" && !row.archived);
const summary = {
  task: TASK,
  mode: "READ_ONLY_PRODUCTION_AUDIT_AND_APPLY_PREVIEW",
  project_ref: PROJECT_REF,
  production_writes: 0,
  company_data_reads: 0,
  company_data_writes: 0,
  tz180_manifest_sha256: tz180Manifest,
  tz181_manifest_sha256: tz181Manifest,
  tz180_fingerprint: tz180Summary.audit_fingerprint_sha256,
  live_baseline_fingerprint: baselineFingerprint,
  remaining_cards_verified: remainingRows.length,
  current_global_products: allGlobalProducts.length,
  current_active_global_pesticides: currentGlobalPesticides.length,
  current_global_product_aliases: productAliases.length,
  safe_cards: safeCards.length,
  safe_alias_actions: allSafeActions.length,
  localized_ru_alias_actions: allSafeActions.filter((row) => row.candidate_type === "LOCALIZED_ALIAS" && row.language === "ru").length,
  localized_en_alias_actions: allSafeActions.filter((row) => row.candidate_type === "LOCALIZED_ALIAS" && row.language === "en").length,
  short_formulation_alias_actions: allSafeActions.filter((row) => row.candidate_type === "SHORT_FORMULATION_ALIAS").length,
  original_search_failures_in_remaining_scope: remainingRows.reduce((sum, row) => sum + Number(row.search_failure_count || 0), 0),
  collision_candidates: collisionRows.length,
  no_safe_action_cards: noActionRows.length,
  excluded_cards: excludedRows.length,
  manufacturer_prefix_review: manufacturerPrefixRows.length,
  name_normalization_review: nameNormalizationRows.length,
  batches: batches.map(({ batch_number, card_count, action_count }) => ({ batch_number, card_count, action_count })),
  first_batch: { card_count: firstBatch.card_count, action_count: firstBatch.action_count },
  first_batch_test: testResults,
  apply_ready: false,
  owner_approval_required: true,
};

const inventoryRows = remainingRows.map((auditRow) => {
  const product = productById.get(auditRow.product_id);
  const card = safeCards.find((row) => row.product_id === auditRow.product_id);
  const collisionCount = collisionRows.filter((row) => row.product_id === auditRow.product_id).length;
  return {
    product_id: auditRow.product_id,
    trade_name: text(product.trade_name || product.name),
    name_ru: text(product.name_ru),
    name_en: text(product.name_en),
    existing_aliases: (aliasesByProduct.get(product.id) || []).map((row) => row.alias),
    classification: card ? "SAFE_ALIAS_CANDIDATE" : collisionCount ? "COLLISION_REVIEW" : "NO_SAFE_ACTION",
    safe_action_count: card?.actions.length || 0,
    collision_count: collisionCount,
  };
});

const batchPlan = `# TZ-187 next safe pesticide batch plan

Status: **AUDIT_AND_PREVIEW_ONLY**. Production writes: **0**.

## Locked scope

- TZ-180 remaining P2 cards: **${remainingRows.length}**.
- Batch 1 overlap: **0**.
- TZ-181 unresolved and owner HOLD cards are outside this apply preview.
- Usage rates, registration, composition, company data and product merges are excluded.

## Safe candidate rules

A card is eligible only when the alias is derived verbatim from an existing
localized field or by removing one recognized formulation suffix from the same
trade name. The normalized alias must be absent and belong to no other global
product or alias, including archived/inactive identities. The canonical trade
name and formulation are not changed. No translation or agronomic fact is
inferred.

- Safe cards: **${safeCards.length}**.
- Safe additive alias actions: **${summary.safe_alias_actions}**.
- Existing localized RU aliases: **${summary.localized_ru_alias_actions}**.
- Existing localized EN aliases: **${summary.localized_en_alias_actions}**.
- Short formulation aliases: **${summary.short_formulation_alias_actions}**.
- Original TZ-180 search failures inside the 807-card scope: **${summary.original_search_failures_in_remaining_scope}**.
- Collision candidates held for review: **${collisionRows.length}**.
- Manufacturer-prefix candidates: **${manufacturerPrefixRows.length}** (review only).
- Formatting-only name candidates: **${nameNormalizationRows.length}** (not in Batch 1).

## Batches

${batches.length ? batches.map((batch) => `- Batch ${batch.batch_number}: ${batch.card_count} cards / ${batch.action_count} alias actions`).join("\n") : "- No safe batch could be formed."}

## Proposed first batch

- Cards: **${firstBatch.card_count}**.
- Additive aliases: **${firstBatch.action_count}**.
- First apply simulation: **${testResults.first_apply_inserts} inserts**.
- Second apply: **${testResults.second_apply_inserts} changes**.
- Exact rollback fingerprint: **${testResults.rollback_fingerprint_match ? "PASS" : "FAIL"}**.

This preview is not authorization to write production. A later numbered task
must repeat fresh backup, live no-drift preflight and owner approval.
`;

const ownerReview = `# TZ-187 owner review

Recommended decision: **APPROVE PREPARATION OF BATCH 1**, not production apply.

Batch 1 contains ${firstBatch.card_count} cards and ${firstBatch.action_count}
additive short-name aliases. Each alias is the same existing trade name with
only its trailing formulation code removed. It changes no canonical trade
name, manufacturer, formulation, composition, registration or usage rule.
Collision candidates are excluded.

| Current trade name | Proposed alias |
| --- | --- |
${firstActions.map((row) => `| ${row.trade_name.replaceAll("|", "\\|")} | ${row.alias.replaceAll("|", "\\|")} |`).join("\n")}

Reply for the next task with one of:

- APPROVE BATCH 1 APPLY PREPARATION
- HOLD BATCH 1
- REVIEW COLLISIONS FIRST
`;

const files = new Map([
  ["remaining_807_inventory.csv", toCsv(inventoryRows, ["product_id", "trade_name", "name_ru", "name_en", "existing_aliases", "classification", "safe_action_count", "collision_count"])],
  ["safe_alias_candidates.csv", toCsv(safeCards.flatMap((card) => card.actions), ["product_id", "trade_name", "alias", "normalized_alias", "language", "candidate_type", "source_field", "risk", "rollback"])],
  ["collision_review.csv", toCsv(collisionRows, ["product_id", "trade_name", "candidate_alias", "normalized_alias", "language", "foreign_product_ids", "reason"])],
  ["manufacturer_prefix_review.csv", toCsv(manufacturerPrefixRows, ["product_id", "trade_name", "manufacturer", "proposed_trade_name", "decision"])],
  ["name_normalization_review.csv", toCsv(nameNormalizationRows, ["product_id", "trade_name", "proposed_trade_name", "decision"])],
  ["batch_plan.json", json(batches)],
  ["batch_plan.md", batchPlan],
  ["batch_01_cards.csv", toCsv(firstActions, ["product_id", "trade_name", "alias", "normalized_alias", "candidate_type", "risk"])],
  ["batch_01_apply_preview.json", json({ task: TASK, apply_authorized: false, cards: firstBatch.cards, actions: firstActions })],
  ["batch_01_rollback_preview.json", json({ task: TASK, apply_authorized: false, delete_only_alias_ids: firstActions.map((row) => row.alias_id), required_checks: ["product_id", "normalized_alias", "source"] })],
  ["test_results.json", json(testResults)],
  ["readiness_summary.json", json(summary)],
  ["owner_review.md", ownerReview],
]);

await mkdir(outputDir, { recursive: true });
for (const [name, content] of files) await writeFile(path.join(outputDir, name), content, "utf8");
const manifestFiles = (await readdir(outputDir)).filter((name) => name !== "manifest.sha256").sort();
const manifest = [];
for (const name of manifestFiles) manifest.push(`${sha256(await readFile(path.join(outputDir, name)))}  ${name}`);
await writeFile(path.join(outputDir, "manifest.sha256"), `${manifest.join("\n")}\n`, "utf8");
await verifyManifest(outputDir);

console.log(json({
  status: "PASS",
  output_dir: outputDir,
  remaining_cards: remainingRows.length,
  safe_cards: safeCards.length,
  safe_alias_actions: summary.safe_alias_actions,
  collision_candidates: collisionRows.length,
  batches: summary.batches,
  first_batch: summary.first_batch,
  isolated_preview: testResults,
  production_writes: 0,
}));
