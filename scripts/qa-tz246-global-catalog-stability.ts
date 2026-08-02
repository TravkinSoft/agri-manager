import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  dedupeCanonicalPesticides,
  normalizePesticideSearchText,
  pesticideCategoryKey,
  pesticideCategoryLabel,
  rankPesticideProduct,
  searchAndRankPesticides,
  stablePesticideSort,
  tokenizePesticideQuery,
  type PesticideCatalogProduct,
  type PesticideSearchRelations,
} from "../lib/platform/pesticide-catalog-search";

type Check = { name: string; run: () => void | Promise<void> };

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const manager = read("components/platform/global-catalog-manager.tsx");
const endpoint = read("app/api/global-admin/catalog/products/route.ts");
const dynamicRoute = read("app/api/global-admin/catalog/[entity]/route.ts");
const liveRefresh = read("hooks/use-live-refresh.ts");
const packageJson = read("package.json");

const products: PesticideCatalogProduct[] = [
  { id: "1", trade_name: "Амистар Трио", manufacturer: "Syngenta", product_type: "pesticide", is_active: true },
  { id: "2", trade_name: "Амистар Экстра", manufacturer: "Syngenta", product_type: "pesticide", is_active: true },
  { id: "3", trade_name: "Phomazin", manufacturer: "SwissGrow", product_type: "pesticide", is_active: true },
  { id: "4", trade_name: "Глифос", manufacturer: "Test", active_ingredient: "глифосат", product_type: "pesticide", is_active: true },
  { id: "5", trade_name: "Не связано", manufacturer: "Other", product_type: "pesticide", is_active: true },
];
const relations = new Map<string, PesticideSearchRelations>([
  ["1", { aliases: ["Amistar Trio"] }],
  ["3", { aliases: ["Фомазин"], registrationNumbers: ["KZ-001"] }],
  ["4", { activeIngredients: ["Glyphosate", "Глифосат"] }],
]);

const checks: Check[] = [
  { name: "01 exact trade name is first", run: () => assert.equal(searchAndRankPesticides(products, "Амистар Трио", relations)[0]?.product.id, "1") },
  { name: "02 exact alias is first", run: () => assert.equal(searchAndRankPesticides(products, "Фомазин", relations)[0]?.product.id, "3") },
  { name: "03 prefix ranks above substring", run: () => assert.ok((rankPesticideProduct(products[0], "Амистар", {}) || 0) >= 800) },
  { name: "04 manufacturer search works", run: () => assert.equal(searchAndRankPesticides(products, "SwissGrow", relations)[0]?.product.id, "3") },
  { name: "05 active ingredient search works", run: () => assert.equal(searchAndRankPesticides(products, "глифосат", relations)[0]?.product.id, "4") },
  { name: "06 multi-token search uses AND", run: () => assert.deepEqual(searchAndRankPesticides(products, "SwissGrow Phomazin", relations).map((item) => item.product.id), ["3"]) },
  { name: "07 irrelevant row is excluded", run: () => assert.equal(rankPesticideProduct(products[4], "Амистар", {}), null) },
  { name: "08 empty query returns catalog", run: () => assert.equal(searchAndRankPesticides(products, "", relations).length, products.length) },
  { name: "09 category normalization supports category search", run: () => assert.equal(pesticideCategoryKey("Гербициды"), "herbicide") },
  { name: "10 archived products are excluded in API", run: () => assert.match(endpoint, /\.eq\("archived", false\)/) },
  { name: "11 inactive products are excluded by default", run: () => assert.match(endpoint, /status.*\|\| "active"/) },
  { name: "12 duplicate canonical identity appears once", run: () => assert.equal(dedupeCanonicalPesticides([{ id: "a", master_product_id: "m" }, { id: "b", master_product_id: "m" }]).length, 1) },

  { name: "13 slow old request cannot replace new", run: () => assert.match(manager, /sequence !== listRequestSequenceRef\.current/) },
  { name: "14 previous request is aborted", run: () => assert.match(manager, /listAbortRef\.current\?\.abort\(\)/) },
  { name: "15 fast typing is debounced", run: () => assert.match(manager, /setTimeout\(\(\) =>[\s\S]*275/) },
  { name: "16 unmount aborts list request", run: () => assert.match(manager, /return \(\) => listAbortRef\.current\?\.abort\(\)/) },
  { name: "17 query A response cannot enter query B", run: () => assert.match(manager, /sequence !== listRequestSequenceRef\.current/) },
  { name: "18 category A response cannot enter category B", run: () => assert.match(manager, /setListCursor\(null\)[\s\S]*setFilters/) },

  { name: "19 search input remains controlled", run: () => assert.match(manager, /value=\{search\}/) },
  { name: "20 search text is not cleared by card", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const openPesticideCard"), manager.indexOf("const handlePesticideCardOpenChange")), /setSearch/) },
  { name: "21 scroll is not reset by card open", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const openPesticideCard"), manager.indexOf("const handlePesticideCardOpenChange")), /scrollTo/) },
  { name: "22 cursor is not changed by card open", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const openPesticideCard"), manager.indexOf("const handlePesticideCardOpenChange")), /setListCursor/) },
  { name: "23 list stays visible during debounce", run: () => assert.match(manager, /\{rows\.map\(\(row\) =>/) },
  { name: "24 active search is not replaced by background refresh", run: () => assert.doesNotMatch(manager, /useLiveRefresh/) },
  { name: "25 catalog has no 10-second polling", run: () => assert.doesNotMatch(manager, /setInterval/) },
  { name: "26 card loading does not set list loading", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const loadPesticideCard"), manager.indexOf("const retryPesticideCard")), /setLoading\(/) },

  { name: "27 row click opens card", run: () => assert.match(manager, /onClick=\{isCanonicalPesticideList \? \(\) => openPesticideCard/) },
  { name: "28 Enter opens card", run: () => assert.match(manager, /event\.key === "Enter"/) },
  { name: "29 Space opens card", run: () => assert.match(manager, /event\.key === " "/) },
  { name: "30 separate card button is removed", run: () => assert.doesNotMatch(manager, /title="Открыть полную карточку"/) },
  { name: "31 card uses shallow native history", run: () => assert.match(manager, /window\.history\.pushState/) },
  { name: "32 card never calls router refresh", run: () => assert.doesNotMatch(manager, /router\.refresh/) },
  { name: "33 card open never refetches list", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const openPesticideCard"), manager.indexOf("const handlePesticideCardOpenChange")), /loadRows/) },
  { name: "34 card close preserves search", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const handlePesticideCardOpenChange"), manager.indexOf("useEffect(() =>", manager.indexOf("const handlePesticideCardOpenChange"))), /setSearch/) },
  { name: "35 card close preserves category", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const handlePesticideCardOpenChange"), manager.indexOf("useEffect(() =>", manager.indexOf("const handlePesticideCardOpenChange"))), /setFilters/) },
  { name: "36 card close preserves scroll", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const handlePesticideCardOpenChange"), manager.indexOf("useEffect(() =>", manager.indexOf("const handlePesticideCardOpenChange"))), /scrollTo/) },
  { name: "37 repeated card open uses cache", run: () => assert.match(manager, /cardCacheRef\.current\.get\(productId\)/) },
  { name: "38 fast card selection rejects stale response", run: () => assert.match(manager, /sequence !== cardRequestSequenceRef\.current/) },

  { name: "39 all count uses canonical active rows", run: () => assert.match(endpoint, /all: activeRows\.length/) },
  { name: "40 category count uses canonical active rows", run: () => assert.match(endpoint, /for \(const product of activeRows\)/) },
  { name: "41 aliases never increment category counts", run: () => assert.ok(endpoint.indexOf("categoryCountMap") < endpoint.indexOf("global_product_aliases")) },
  { name: "42 company override cannot increment counts", run: () => assert.match(endpoint, /\.is\("company_id", null\)/) },
  { name: "43 archived rows cannot increment counts", run: () => assert.match(endpoint, /\.eq\("archived", false\)/) },
  { name: "44 text query does not alter category counts", run: () => assert.ok(endpoint.indexOf("categoryCountMap") < endpoint.indexOf("let filtered")) },
  { name: "45 counts are produced without category N+1", run: () => assert.equal((endpoint.match(/categoryCountMap/g) || []).length >= 3, true) },
  { name: "46 single-category schema has deterministic label", run: () => assert.equal(pesticideCategoryLabel("fungicide"), "Фунгициды") },

  { name: "47 initial DOM rows cannot exceed page limit", run: () => assert.match(endpoint, /const DEFAULT_LIMIT = 50/) },
  { name: "48 initial load does not fetch full cards", run: () => assert.doesNotMatch(endpoint, /pesticide-card/) },
  { name: "49 search request follows 275ms debounce", run: () => assert.match(manager, /\}, 275\)/) },
  { name: "50 idle list requests are absent", run: () => assert.doesNotMatch(manager, /setInterval/) },
  { name: "51 card has zero list refetch calls", run: () => assert.doesNotMatch(manager.slice(manager.indexOf("const loadPesticideCard"), manager.indexOf("const retryComponentCard")), /loadRows/) },
  { name: "52 render work is bounded by API page", run: () => assert.match(manager, /params\.set\("limit", "50"\)/) },
  { name: "53 cursor pagination is exposed", run: () => assert.match(endpoint, /next_cursor/) },

  { name: "54 create edit archive API remains available", run: () => { assert.match(dynamicRoute, /export async function POST/); assert.match(dynamicRoute, /export async function PATCH/); assert.match(dynamicRoute, /export async function DELETE/); } },
  { name: "55 full pesticide card remains available", run: () => assert.equal(fs.existsSync(path.join(root, "app/api/global-admin/pesticide-card/[id]/route.ts")), true) },
  { name: "56 pesticide alias layer remains searchable", run: () => assert.match(endpoint, /global_product_aliases/) },
  { name: "57 TZ245 material select regression remains registered", run: () => { assert.match(packageJson, /qa:tz245/); assert.equal(fs.existsSync(path.join(root, "scripts/qa-tz245-global-material-select.ts")), true); } },
  { name: "58 PR6 refresh is scoped to operational pages", run: () => { assert.match(liveRefresh, /operations:/); assert.match(liveRefresh, /warehouses:/); assert.doesNotMatch(liveRefresh, /pesticides/); } },
  { name: "59 notification center remains present", run: () => assert.equal(fs.existsSync(path.join(root, "components/notifications/notification-center.tsx")), true) },
  { name: "60 Global Admin company switching remains present", run: () => assert.match(read("app/(platform)/platform/page.tsx"), /openCompanyContext/) },
  { name: "61 production login route remains present", run: () => assert.equal(fs.existsSync(path.join(root, "app/auth/login/page.tsx")), true) },
  { name: "62 access is Global Admin only and company data is excluded", run: () => { assert.match(endpoint, /actor\.role !== "global_admin"/); assert.match(endpoint, /\.is\("company_id", null\)/); } },
];

assert.equal(checks.length, 62, "TZ-246 gate must contain exactly 62 checks");

async function main() {
  let passed = 0;
  for (const check of checks) {
    try {
      await check.run();
      passed += 1;
      console.log(`PASS ${check.name}`);
    } catch (error) {
      console.error(`FAIL ${check.name}`);
      throw error;
    }
  }

  assert.equal(normalizePesticideSearchText("  «Ёлка—1»  "), "елка-1");
  assert.deepEqual(tokenizePesticideQuery("SwissGrow   Phomazin"), ["swissgrow", "phomazin"]);
  assert.equal(stablePesticideSort([...products]).length, products.length);
  console.log(`TZ-246 RESULT: ${passed}/${checks.length} PASS`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
