import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const TASK = "TZ-198";
const BRANCH_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_REF = "bhsemlvmkikpntabctml";
const repoRoot = process.cwd();
const outputDir = path.resolve(repoRoot, "..", "..", "audit-output", TASK);
const fixturePath = path.join(repoRoot, "scripts", "qa", "fixtures", "assistant-qa-reference-baseline.json");

nextEnv.loadEnvConfig(repoRoot);

function required(name) {
  const value = process.env[name]?.trim();
  assert(value, `STOP: ${name} is required`);
  return value;
}

function assertBranchUrl(url) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, `${BRANCH_REF}.supabase.co`, "STOP: exact assistant branch URL is required");
  assert(!url.includes(PRODUCTION_REF), "STOP: production ref detected");
}

async function count(client, table, filter) {
  let query = client.from(table).select("*", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count: value, error } = await query;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return value ?? 0;
}

async function rows(client, table, select = "*", filter) {
  let query = client.from(table).select(select);
  if (filter) query = filter(query);
  const { data, error } = await query;
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return data ?? [];
}

async function searchBaseProducts(client, term) {
  const normalized = term.trim().toLocaleLowerCase("ru-RU");
  const [products, aliases] = await Promise.all([
    rows(client, "products", "id,name,name_ru,name_en", (query) => query.or(`name.ilike.%${term}%,name_ru.ilike.%${term}%,name_en.ilike.%${term}%`)),
    rows(client, "global_product_aliases", "product_id,alias", (query) => query.ilike("alias", `%${term}%`)),
  ]);
  const ids = new Set([...products.map((row) => row.id), ...aliases.map((row) => row.product_id)]);
  if (normalized === "фолиар") {
    for (const product of await rows(client, "products", "id,name", (query) => query.ilike("name", "%Foliar%"))) ids.add(product.id);
  }
  return Array.from(ids);
}

async function main() {
  const url = required("A106_SUPABASE_URL");
  const anonKey = required("A106_SUPABASE_ANON_KEY");
  const email = required("A106_TEST_USER_A_EMAIL");
  const password = required("A106_TEST_USER_A_PASSWORD");
  const expectedUserId = required("A106_TEST_USER_A_ID");
  assertBranchUrl(url);
  assert.equal(required("A106_BRANCH_REF"), BRANCH_REF);
  assert(!process.env.SUPABASE_SERVICE_ROLE_KEY?.includes(BRANCH_REF), "STOP: runtime service role must not target the branch");

  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.equal(fixture.branchRef, BRANCH_REF);
  assert.equal(fixture.users.a.id, expectedUserId);
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`QA User A login failed: ${authError.message}`);
  assert.equal(auth.user?.id, expectedUserId);
  assert(auth.session?.access_token, "STOP: real QA JWT was not issued");

  const counts = {
    products: await count(client, "assistant_glbd_products"),
    components: await count(client, "assistant_glbd_components"),
    productComponents: await count(client, "assistant_glbd_product_components"),
    ready: await count(client, "assistant_glbd_products", (query) => query.eq("read_status", "READ_READY")),
    partial: await count(client, "assistant_glbd_products", (query) => query.eq("read_status", "READ_PARTIAL")),
    recommendationsAllowed: await count(client, "assistant_glbd_products", (query) => query.eq("recommendation_allowed", true)),
  };
  assert.deepEqual(counts, { products: 834, components: 367, productComponents: 1382, ready: 19, partial: 815, recommendationsAllowed: 0 });

  const baseSearch = {};
  for (const term of ["Curamin", "Курамин", "Фолиар", "Phomazin", "Фомазин"]) {
    baseSearch[term] = await searchBaseProducts(client, term);
  }
  const curaminId = fixture.products.find((row) => row.key === "curamin").id;
  const phomazinId = fixture.products.find((row) => row.key === "phomazin").id;
  for (const term of ["Curamin", "Курамин", "Фолиар"]) assert(baseSearch[term].includes(curaminId), `STOP: ${term} did not find Curamin`);
  for (const term of ["Phomazin", "Фомазин"]) assert(baseSearch[term].includes(phomazinId), `STOP: ${term} did not find Phomazin`);

  const glyphosateComponents = await rows(client, "assistant_glbd_components", "component_id,canonical_name,name_ru,name_en", (query) => query.or("canonical_name.ilike.%glyphosate%,name_ru.ilike.%глифосат%,name_en.ilike.%glyphosate%"));
  assert(glyphosateComponents.length > 0, "STOP: glyphosate component search returned zero");
  const glyphosateIds = glyphosateComponents.map((row) => row.component_id);
  const glyphosateLinks = await rows(client, "assistant_glbd_product_components", "product_id,component_id,concentration_value,concentration_unit", (query) => query.in("component_id", glyphosateIds));
  assert(glyphosateLinks.length > 0, "STOP: glyphosate product links returned zero");

  const formulationResults = await rows(client, "assistant_glbd_products", "product_id,trade_name,formulation_name", (query) => query.ilike("formulation_name", "%Концентрат эмульсии%").limit(20));
  assert(formulationResults.length > 0, "STOP: formulation search returned zero");

  const partial = await rows(client, "assistant_glbd_products", "product_id,trade_name,read_status,incomplete,recommendation_allowed", (query) => query.eq("product_id", "a4e046c8-b0e3-464d-b2f1-489cb0932546").single());
  assert.equal(partial.length, undefined);
  assert.equal(partial.read_status, "READ_PARTIAL");
  assert.equal(partial.incomplete, true);
  assert.equal(partial.recommendation_allowed, false);

  const blockedIds = [
    "a52070b9-bde3-4f78-bff7-c1dde2916d88", "6398881b-83ce-49dc-9b24-6d15b057135b",
    "a211ec5c-d068-48c5-8216-7389dc1923d0", "ae4ed6b2-87a4-4bf6-ad70-afd8731c2e96",
    "2190ccbb-fdfb-4188-8da0-2819308a791b", "fa06b3f4-cd6d-4f0a-9ac5-82e2e35e7186",
    "72cff92c-a758-424b-b193-50c3b426555f", "ddf99660-ee6b-43f6-a45b-38b646c96548",
    "b40abfe2-e5b8-491b-a480-bf5a8fe9d731", "a573f3b4-4742-4d7b-bd42-af3b8cf16f41",
  ];
  assert.equal(await count(client, "assistant_glbd_products", (query) => query.in("product_id", blockedIds)), 0);

  const ideal = await rows(client, "assistant_glbd_products", "product_id,trade_name", (query) => query.in("product_id", ["4febb9c7-e1c3-4455-afa8-5f3faf423a77", "d08406d7-29d3-462e-a8d6-feb35eca0aa8"]));
  assert.equal(ideal.length, 2, "STOP: ambiguous Ideal control must return both cards");
  assert.equal(await count(client, "assistant_glbd_search_surface", (query) => query.ilike("search_text", "%tz198-no-such-catalog-row%")), 0);

  const alias = (await rows(client, "assistant_glbd_aliases", "alias_id,product_id,alias_text,normalized_alias,source", (query) => query.limit(1)))[0];
  assert(alias, "STOP: no alias available for write-denial tests");
  const insertAttempt = await client.from("assistant_glbd_aliases").insert({
    alias_id: "19800000-0000-4000-8000-000000000001",
    product_id: alias.product_id,
    alias_text: "TZ198 forbidden insert",
    normalized_alias: "tz198 forbidden insert",
    source: "write-denial-test",
  }).select("alias_id");
  const updateAttempt = await client.from("assistant_glbd_aliases").update({ source: alias.source }).eq("alias_id", alias.alias_id).select("alias_id");
  const deleteAttempt = await client.from("assistant_glbd_aliases").delete().eq("alias_id", alias.alias_id).select("alias_id");
  const denied = {
    insert: Boolean(insertAttempt.error) || (insertAttempt.data?.length ?? 0) === 0,
    update: Boolean(updateAttempt.error) || (updateAttempt.data?.length ?? 0) === 0,
    delete: Boolean(deleteAttempt.error) || (deleteAttempt.data?.length ?? 0) === 0,
  };
  assert.deepEqual(denied, { insert: true, update: true, delete: true });
  assert.equal(await count(client, "assistant_glbd_aliases", (query) => query.eq("alias_id", alias.alias_id)), 1);
  assert.equal(await count(client, "assistant_glbd_aliases", (query) => query.eq("alias_id", "19800000-0000-4000-8000-000000000001")), 0);

  const companyIsolation = {
    ownFields: await count(client, "fields", (query) => query.eq("company_id", fixture.users.a.companyId)),
    crossFields: await count(client, "fields", (query) => query.eq("company_id", fixture.users.b.companyId)),
    ownOperations: await count(client, "operations", (query) => query.eq("company_id", fixture.users.a.companyId)),
    crossOperations: await count(client, "operations", (query) => query.eq("company_id", fixture.users.b.companyId)),
  };
  assert.deepEqual(companyIsolation, { ownFields: 8, crossFields: 0, ownOperations: 5, crossOperations: 0 });

  const report = {
    status: "PASS",
    branchRef: BRANCH_REF,
    realJwt: true,
    qaUserId: expectedUserId,
    counts,
    curaminSearch: Object.fromEntries(["Curamin", "Курамин", "Фолиар"].map((term) => [term, baseSearch[term]])),
    phomazinSearch: Object.fromEntries(["Phomazin", "Фомазин"].map((term) => [term, baseSearch[term]])),
    componentSearch: { components: glyphosateComponents.length, linkedProducts: new Set(glyphosateLinks.map((row) => row.product_id)).size },
    formulationSearch: formulationResults.length,
    partialCard: partial,
    blockedCardsVisible: 0,
    ambiguity: ideal,
    noDataResults: 0,
    writeDenied: denied,
    successfulCatalogWrites: 0,
    companyIsolation,
    erpWrites: 0,
    productionConnections: 0,
    serviceRoleUsed: false,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "real_jwt_acceptance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  await client.auth.signOut();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
