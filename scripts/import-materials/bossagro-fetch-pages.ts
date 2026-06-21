import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureDirs,
  fetchText,
  LinkRow,
  OUTPUT_DIR,
  randomDelay,
  RAW_DIR,
  readCsv,
  sleep,
  writeCsv,
} from "./bossagro-lib";

async function main() {
  await ensureDirs();
  const linksPath = path.join(OUTPUT_DIR, "product_links.csv");
  const links = (await readCsv(linksPath)) as LinkRow[];
  const unique = Array.from(new Map(links.map((row) => [row.product_url, row])).values());
  const errors: Record<string, string | number>[] = [];
  let downloaded = 0;
  let skippedExisting = 0;

  for (const row of unique) {
    const outputPath = path.join(RAW_DIR, `${row.slug}.html`);
    let exists = false;
    try {
      const existing = await readFile(outputPath, "utf8");
      exists = existing.length > 200;
    } catch {
      exists = false;
    }
    if (exists) {
      skippedExisting += 1;
      continue;
    }
    try {
      const result = await fetchText(row.product_url, 3);
      await writeFile(outputPath, result.text, "utf8");
      downloaded += 1;
    } catch (error) {
      errors.push({
        product_url: row.product_url,
        slug: row.slug,
        status_code: "unknown",
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(randomDelay());
  }

  await writeCsv(path.join(OUTPUT_DIR, "fetch_errors.csv"), errors, [
    "product_url",
    "slug",
    "status_code",
    "error_message",
  ]);

  console.log(JSON.stringify({
    unique_links: unique.length,
    downloaded,
    skipped_existing: skippedExisting,
    errors: errors.length,
    rawDir: RAW_DIR,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

