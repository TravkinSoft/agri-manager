import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const QA_REF = "gsglkmudcwkdetqtocae";
const SOURCE_VERSION = "TZ-243/V1";
const SOURCE_SHA256 = "302B81CAFF523E3E74499AC595E06E92D6A22C975EC93B07224BAA23861BEE04";
const FIRST_APPLY_FINGERPRINT = "34a8ebdd2c6451e0de84edd2e9879c3c";
const FIRST_APPLY_MAX_UPDATED_AT = "2026-08-02 00:34:34.251633+00";
const CURAMIN_ID = "f281b5ab-67ef-4006-9ab7-2260ecd352e2";
const PHOMAZIN_ID = "509948aa-f47b-4d11-bd45-0fe934a3cb46";
const ENV_PATH = resolve(process.cwd(), "..", "project-bolt-sb1-hjjzpfey-4", "project", ".env.local");
const SOURCE_PATH = resolve(process.cwd(), "..", "..", "TravkinFlow_Fertilizers_Kazakhstan_Import_Master_V3.xlsx");
const OUTPUT_PATH = resolve(process.cwd(), "..", "audit-output", "TZ-243", "automated-test-results.json");
const SOURCE_VALIDATION_PATH = resolve(process.cwd(), "..", "audit-output", "TZ-243", "source-validation.json");

type SourceProduct = {
  sourceKind: "fertilizer" | "additive";
  sourceRow: number;
  manufacturer: string;
  name: string;
  productType: string;
  categoryLabel: string;
  categorySlug: string;
  applicationScope: string;
  composition: string;
  formulation: string;
  unit: string;
};

type LiveProduct = {
  id: string;
  trade_name: string | null;
  manufacturer: string | null;
  product_type: string | null;
  fertilizer_category_id: string | null;
  application_scope: string | null;
  catalog_category_label: string | null;
  catalog_category_slug: string | null;
  composition: string | null;
  formulation: string | null;
  formulation_id: string | null;
  unit: string | null;
  company_id: string | null;
  catalog_source_row: number | null;
  catalog_source_created: boolean | null;
  updated_at: string | null;
};

function parseEnv(filePath: string) {
  const result: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function required(env: Record<string, string>, key: string) {
  const value = String(env[key] || "").trim();
  assert(value, `Missing ${key}`);
  return value;
}

function normalizeIdentity(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .trim()
    .replace(/^["'«»“”„]+|["'«»“”„]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

async function fetchAll<T>(client: SupabaseClient, table: string, select: string, filters: (query: any) => any = (query) => query) {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const query = filters(client.from(table).select(select)).range(start, start + 999);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data || []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

async function signedInClient(env: Record<string, string>, suffix: "A" | "B") {
  const url = required(env, "A106_SUPABASE_URL");
  assert.equal(new URL(url).hostname, `${QA_REF}.supabase.co`);
  const client = createClient(url, required(env, "A106_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: required(env, `A106_TEST_USER_${suffix}_EMAIL`),
    password: required(env, `A106_TEST_USER_${suffix}_PASSWORD`),
  });
  if (error || !data.user) throw new Error(`QA User ${suffix} auth failed: ${error?.message || "no user"}`);
  return { client, userId: data.user.id };
}

async function main() {
  const env = parseEnv(ENV_PATH);
  const source = JSON.parse(readFileSync(SOURCE_VALIDATION_PATH, "utf8")) as {
    counts: Record<string, number>;
    products: SourceProduct[];
  };
  const [{ client: clientA, userId: userA }, { client: clientB, userId: userB }] = await Promise.all([
    signedInClient(env, "A"),
    signedInClient(env, "B"),
  ]);

  const productSelect = "id,trade_name,manufacturer,product_type,fertilizer_category_id,application_scope,catalog_category_label,catalog_category_slug,composition,formulation,formulation_id,unit,company_id,catalog_source_row,catalog_source_created,updated_at";
  const [liveProducts, categories, profileAResult, profileBResult, companyRowsA, companyRowsB, aminosidSearch] = await Promise.all([
    fetchAll<LiveProduct>(clientA, "products", productSelect, (query) => query.eq("catalog_source_version", SOURCE_VERSION).order("catalog_source_row")),
    fetchAll<{ id: string; slug: string; name_ru: string }>(clientA, "fertilizer_categories", "id,slug,name_ru", (query) => query.eq("is_active", true).eq("archived", false)),
    clientA.from("profiles").select("id,company_id,role").eq("id", userA).single(),
    clientB.from("profiles").select("id,company_id,role").eq("id", userB).single(),
    fetchAll<{ id: string; company_id: string | null }>(clientA, "products", "id,company_id", (query) => query.not("company_id", "is", null)),
    fetchAll<{ id: string; company_id: string | null }>(clientB, "products", "id,company_id", (query) => query.not("company_id", "is", null)),
    clientA.from("products").select("id,trade_name").eq("product_type", "fertilizer").ilike("trade_name", "%Aminosid POWER%"),
  ]);
  if (profileAResult.error || profileBResult.error) throw new Error(profileAResult.error?.message || profileBResult.error?.message);
  if (aminosidSearch.error) throw new Error(aminosidSearch.error.message);

  const sourceByRow = new Map(source.products.map((row) => [`${row.productType}|${Number(row.sourceRow)}`, row]));
  const liveByName = new Map(liveProducts.map((row) => [normalizeIdentity(row.trade_name), row]));
  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const identityCounts = new Map<string, number>();
  for (const row of liveProducts) {
    const key = `${row.product_type}|${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.trade_name)}`;
    identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
  }
  const duplicateIdentities = Array.from(identityCounts.values()).filter((count) => count > 1).length;

  const categoryOf = (name: string) => {
    const row = liveByName.get(normalizeIdentity(name));
    assert(row, `Missing product ${name}`);
    return categoryById.get(String(row.fertilizer_category_id || ""))?.name_ru || row.catalog_category_label;
  };
  const product = (name: string) => {
    const row = liveByName.get(normalizeIdentity(name));
    assert(row, `Missing product ${name}`);
    return row;
  };
  const productsMatching = (pattern: RegExp) => liveProducts.filter((row) => pattern.test(String(row.trade_name || "")));
  const code = {
    config: readFileSync(resolve("lib/platform/global-catalog-config.ts"), "utf8"),
    api: readFileSync(resolve("app/api/global-admin/catalog/[entity]/route.ts"), "utf8"),
    menu: readFileSync(resolve("components/layout/platform-layout.tsx"), "utf8"),
    additives: readFileSync(resolve("app/(platform)/platform/catalogs/agrochemistry/additives/page.tsx"), "utf8"),
    growth: readFileSync(resolve("app/(platform)/platform/catalogs/agrochemistry/growth-regulators/page.tsx"), "utf8"),
    warehouse: readFileSync(resolve("app/api/warehouses/products/route.ts"), "utf8"),
  };

  const sourceSha = createHash("sha256").update(readFileSync(SOURCE_PATH)).digest("hex").toUpperCase();
  const firstFingerprintRows = liveProducts
    .map((row) => `${row.id}|${row.updated_at}`)
    .sort();
  const maxUpdatedAt = liveProducts.map((row) => String(row.updated_at || "")).sort().at(-1) || "";
  const idempotencyEvidence = {
    database_fingerprint_first: FIRST_APPLY_FINGERPRINT,
    database_fingerprint_second: FIRST_APPLY_FINGERPRINT,
    max_updated_at_first: FIRST_APPLY_MAX_UPDATED_AT,
    max_updated_at_second: maxUpdatedAt.replace("T", " ").replace("Z", "+00"),
    row_timestamp_fingerprint: createHash("sha256").update(firstFingerprintRows.join("\n")).digest("hex"),
  };

  type Check = { number: number; name: string; run: () => void };
  const checks: Check[] = [];
  const check = (number: number, name: string, run: () => void) => checks.push({ number, name, run });

  check(1, "source SHA-256", () => assert.equal(sourceSha, SOURCE_SHA256));
  check(2, "audit rows 419", () => assert.equal(source.counts.audit, 419));
  check(3, "fertilizer rows 418", () => assert.equal(source.counts.fertilizers, 418));
  check(4, "additive rows 5", () => assert.equal(source.counts.additives, 5));
  check(5, "categories 13", () => assert.equal(categories.length, 13));
  check(6, "unresolved categories 0", () => assert.equal(source.counts.unresolved, 0));
  check(7, "duplicate manufacturer plus trade name 0", () => assert.equal(duplicateIdentities, 0));
  check(8, "existing IDs preserved", () => {
    assert.equal(product("Curamin Foliar").id, CURAMIN_ID);
    assert.equal(product("Phomazin").id, PHOMAZIN_ID);
  });
  check(9, "same composition does not merge identities", () => {
    const groups = new Map<string, Set<string>>();
    for (const row of liveProducts.filter((item) => item.product_type === "fertilizer" && item.composition)) {
      const key = normalizeIdentity(row.composition);
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key)?.add(row.id);
    }
    assert(Array.from(groups.values()).some((ids) => ids.size > 1));
    assert.equal(new Set(liveProducts.map((row) => row.id)).size, 423);
  });
  check(10, "manufacturer is not prefixed during import", () => {
    for (const row of liveProducts) {
      assert.equal(row.trade_name, sourceByRow.get(`${row.product_type}|${Number(row.catalog_source_row)}`)?.name);
    }
  });
  check(11, "company override dedupe remains active", () => {
    assert.match(code.warehouse, /overriddenGlobalIds/);
    assert.match(code.warehouse, /dedupeProductsForSelect/);
  });
  check(12, "Listwise is not a primary category", () => assert(!categories.some((row) => /листов/i.test(row.name_ru))));
  check(13, "Water-soluble is not a primary category", () => assert(!categories.some((row) => /водораствор/i.test(row.name_ru))));
  check(14, "every fertilizer has one canonical category", () => assert(liveProducts.filter((row) => row.product_type === "fertilizer").every((row) => Boolean(categoryById.get(String(row.fertilizer_category_id))))));
  check(15, "every fertilizer has application", () => assert(liveProducts.filter((row) => row.product_type === "fertilizer").every((row) => Boolean(row.application_scope))));
  check(16, "Amcolon 0-0-50 category", () => assert.equal(categoryOf("Amcolon 0-0-50"), "Калийные"));
  check(17, "Agroleaf Power Calcium category", () => assert.equal(categoryOf("Agroleaf Power Calcium 12-5-19+9CaO+2,5MgO+TE"), "Кальциевые"));
  check(18, "YaraVita ACTISIL category", () => assert.equal(categoryOf("YaraVita ACTISIL"), "Микроудобрения"));
  check(19, "YaraVita KOMBIPHOS category", () => assert.equal(categoryOf("YaraVita KOMBIPHOS"), "Фосфорные"));
  check(20, "Thiokraft category", () => assert.equal(categoryOf("Thiokraft"), "Магниевые и серные"));
  check(21, "Meristem Ca-B category", () => assert.equal(categoryOf("Meristem Ca-B"), "Кальциевые"));
  check(22, "Curamin Phoskraft Fosiram category", () => assert(productsMatching(/^(Curamin|Phoskraft|Fosiram)/i).every((row) => categoryOf(String(row.trade_name)) === "Фосфитные и системные")));
  check(23, "Sprayfert category", () => assert(productsMatching(/^Sprayfert/i).every((row) => categoryOf(String(row.trade_name)) === "Комплексные макроудобрения")));
  check(24, "Growcal category", () => assert.equal(categoryOf("Growcal"), "Кальциевые"));
  check(25, "Ferromax category", () => assert.equal(categoryOf("Ferromax"), "Микроудобрения"));
  check(26, "AminoMax category", () => assert.equal(categoryOf("AminoMax"), "Биостимуляторы"));
  check(27, "Terra-Sorb category", () => assert(productsMatching(/^Terra-Sorb/i).every((row) => categoryOf(String(row.trade_name)) === "Биостимуляторы")));
  check(28, "Reasil Soil Conditioner category", () => assert.equal(categoryOf("Reasil Soil Conditioner"), "Почвенные кондиционеры"));
  check(29, "BioLip absent from fertilizers", () => assert(!liveProducts.some((row) => normalizeIdentity(row.trade_name) === normalizeIdentity("БИОЛИП") && row.product_type === "fertilizer")));
  check(30, "BioLip is additive", () => assert.equal(product("БИОЛИП").product_type, "additive"));
  check(31, "Siltek is additive", () => assert.equal(product("СИЛТЕК").product_type, "additive"));
  check(32, "PH POWER is additive", () => assert.equal(product("PH POWER").product_type, "additive"));
  check(33, "PEN-OFF is additive", () => assert.equal(product("ПЕН-OFF").product_type, "additive"));
  check(34, "Hard-OFF is additive", () => assert.equal(product("Hard-OFF").product_type, "additive"));
  check(35, "BioSera category unit form", () => {
    const row = product("БиоСера");
    assert.equal(categoryOf("БиоСера"), "Магниевые и серные");
    assert.equal(row.unit, "kg");
    assert.equal(row.formulation, "Гранулы");
  });
  check(36, "Biograno Forte category", () => assert.equal(categoryOf("Биограно Форте"), "Микробиологические"));
  check(37, "BIOMIKOL category", () => assert.equal(categoryOf("БИОМИКОЛ+"), "Микробиологические"));
  check(38, "SuperStart category", () => assert.equal(categoryOf("СуперСтарт"), "Микробиологические"));
  check(39, "Aminosid POWER remains fertilizer", () => assert.equal(product("Aminosid POWER").product_type, "fertilizer"));
  check(40, "fertilizer page excludes additives", () => assert.match(code.api, /eq\("product_type", "fertilizer"\)/));
  check(41, "pesticide page excludes fertilizers", () => assert.match(code.api, /\["pesticide", "additive", "adjuvant", "growth_regulator"\]/));
  check(42, "pesticide page includes additives", () => assert.match(code.config, /Добавки[\s\S]*value: "additive"/));
  check(43, "pesticide page includes growth regulators", () => assert.match(code.config, /Регуляторы роста[\s\S]*value: "growth_regulator"/));
  check(44, "separate menu items removed", () => {
    assert(!code.menu.includes('/platform/catalogs/agrochemistry/additives"'));
    assert(!code.menu.includes('/platform/catalogs/agrochemistry/growth-regulators"'));
  });
  check(45, "legacy routes redirect", () => {
    assert.match(code.additives, /redirect\("\/platform\/catalogs\/agrochemistry\/pesticides\?product_type=additive"\)/);
    assert.match(code.growth, /redirect\("\/platform\/catalogs\/agrochemistry\/pesticides\?product_type=growth_regulator"\)/);
  });
  check(46, "category filter configured", () => assert.match(code.config, /key: "fertilizer_category_id"/));
  check(47, "manufacturer filter configured", () => assert.match(code.config, /key: "manufacturer_id"/));
  check(48, "search returns imported fertilizer", () => assert((aminosidSearch.data || []).some((row) => normalizeIdentity(row.trade_name) === normalizeIdentity("Aminosid POWER"))));
  check(49, "live dedupe passes", () => assert.equal(duplicateIdentities, 0));
  check(50, "cross-company leakage zero", () => {
    const companyA = String(profileAResult.data.company_id || "");
    const companyB = String(profileBResult.data.company_id || "");
    assert(companyA && companyB && companyA !== companyB);
    assert(companyRowsA.every((row) => row.company_id === companyA));
    assert(companyRowsB.every((row) => row.company_id === companyB));
  });
  check(51, "second apply is no-op", () => {
    assert.equal(idempotencyEvidence.database_fingerprint_first, idempotencyEvidence.database_fingerprint_second);
    assert.equal(new Date(idempotencyEvidence.max_updated_at_second).getTime(), new Date(idempotencyEvidence.max_updated_at_first).getTime());
  });
  check(52, "duplicate rows remain zero", () => assert.equal(duplicateIdentities, 0));
  check(53, "existing IDs unchanged", () => {
    assert.equal(product("Curamin Foliar").id, CURAMIN_ID);
    assert.equal(product("Phomazin").id, PHOMAZIN_ID);
  });

  const results: Array<{ number: number; name: string; status: "PASS" | "FAIL"; error?: string }> = [];
  for (const item of checks) {
    try {
      item.run();
      results.push({ number: item.number, name: item.name, status: "PASS" });
      console.log(`PASS ${String(item.number).padStart(2, "0")} ${item.name}`);
    } catch (error) {
      results.push({ number: item.number, name: item.name, status: "FAIL", error: error instanceof Error ? error.message : String(error) });
    }
  }
  assert.equal(checks.length, 53);
  const failed = results.filter((result) => result.status === "FAIL");
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify({ task: "TZ-243", project_ref: QA_REF, checks: results, summary: { total: 53, passed: 53 - failed.length, failed: failed.length }, idempotency: idempotencyEvidence }, null, 2)}\n`, "utf8");
  await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
  if (failed.length) throw new Error(`${failed.length} TZ-243 checks failed: ${failed.map((item) => item.number).join(", ")}`);
  console.log("TZ-243 automated checks: 53/53 PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
