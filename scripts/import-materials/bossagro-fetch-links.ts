import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  absoluteUrl,
  ensureDirs,
  extractAnchors,
  isCategoryUrl,
  isProductGlossaryUrl,
  LinkRow,
  OUTPUT_DIR,
  ROOT_CATEGORY_URL,
  slugFromUrl,
  writeCsv,
  fetchText,
} from "./bossagro-lib";

const CATEGORY_ALLOWLIST = new Set([
  "pesticides",
  "herbicides",
  "desiccants",
  "insecticides",
  "molluscicides",
  "nematicides",
  "repellents",
  "rodenticides",
  "pheromones",
  "fumigants",
  "fungicides",
  "regulyatory-rosta-rastenij",
]);

async function main() {
  await ensureDirs();
  const root = await fetchText(ROOT_CATEGORY_URL);
  const rootAnchors = extractAnchors(root.text);
  const categoryMap = new Map<string, string>([["Пестициды", ROOT_CATEGORY_URL]]);

  for (const anchor of rootAnchors) {
    if (!isCategoryUrl(anchor.href)) continue;
    const slug = slugFromUrl(anchor.href);
    if (!CATEGORY_ALLOWLIST.has(slug)) continue;
    categoryMap.set(anchor.text || slug, absoluteUrl(anchor.href));
  }

  const rows: LinkRow[] = [];
  const categoryStats: Record<string, number> = {};

  for (const [categoryName, categoryUrl] of Array.from(categoryMap.entries())) {
    const page = categoryUrl === ROOT_CATEGORY_URL ? root : await fetchText(categoryUrl);
    const anchors = extractAnchors(page.text);
    const categoryRows: LinkRow[] = [];
    for (const anchor of anchors) {
      if (!isProductGlossaryUrl(anchor.href)) continue;
      categoryRows.push({
        category_name: categoryName,
        category_url: categoryUrl,
        trade_name_from_list: anchor.text,
        product_url: absoluteUrl(anchor.href),
        slug: slugFromUrl(anchor.href),
      });
    }
    categoryStats[categoryName] = categoryRows.length;
    rows.push(...categoryRows);
  }

  const byKey = new Map<string, LinkRow>();
  for (const row of rows) {
    const key = `${row.category_url}::${row.product_url}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  const categoryDeduped = Array.from(byKey.values()).sort((a, b) =>
    a.category_name.localeCompare(b.category_name, "ru") || a.trade_name_from_list.localeCompare(b.trade_name_from_list, "ru")
  );
  const uniqueUrls = new Set(categoryDeduped.map((row) => row.product_url));

  const outputCsv = path.join(OUTPUT_DIR, "product_links.csv");
  const outputJson = path.join(OUTPUT_DIR, "product_links.json");
  await writeCsv(outputCsv, categoryDeduped, ["category_name", "category_url", "trade_name_from_list", "product_url", "slug"]);
  await writeFile(outputJson, JSON.stringify(categoryDeduped, null, 2), "utf8");
  await writeFile(
    path.join(OUTPUT_DIR, "link_stats.json"),
    JSON.stringify(
      {
        categories_found: categoryMap.size,
        links_total: rows.length,
        links_after_category_dedupe: categoryDeduped.length,
        unique_links: uniqueUrls.size,
        duplicate_links: categoryDeduped.length - uniqueUrls.size,
        by_category: categoryStats,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({
    categories_found: categoryMap.size,
    links_total: rows.length,
    links_after_category_dedupe: categoryDeduped.length,
    unique_links: uniqueUrls.size,
    duplicate_links: categoryDeduped.length - uniqueUrls.size,
    outputCsv,
    outputJson,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
