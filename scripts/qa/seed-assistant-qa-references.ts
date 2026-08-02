import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUDIT_DIR,
  createBranchAdmin,
  ensureExactRow,
  loadFixture,
  normalizedAlias,
  requireExactRow,
  writeAuditJson,
  writeAuditText,
} from "./assistant-qa-common";

async function main() {
  const fixture = await loadFixture();
  const client = createBranchAdmin(fixture);
  const created: Record<string, string[]> = {
    manufacturers: [], varieties: [], reproductions: [], products: [], aliases: [],
  };

  for (const crop of Object.values(fixture.crops)) {
    await requireExactRow(client, "crops", crop.id, { name: crop.name });
  }

  for (const manufacturer of fixture.manufacturers) {
    const result = await ensureExactRow(client, "agrochem_manufacturers", {
      id: manufacturer.id,
      name: manufacturer.name,
      is_active: true,
      archived: false,
    });
    if (result === "created") created.manufacturers.push(manufacturer.id);
  }

  const varietyRow = {
    id: fixture.variety.id,
    crop_id: fixture.crops.potato.id,
    name: fixture.variety.name,
    name_ru: fixture.variety.name,
    name_en: fixture.variety.nameEn,
    user_id: fixture.users.a.id,
    company_id: null,
    archived: false,
    is_active: true,
    is_common_in_kz: true,
    origin_country: "Germany",
    variety_type: "table",
    maturity_group: "early",
    notes: fixture.marker,
  };
  if (await ensureExactRow(client, "varieties", varietyRow) === "created") {
    created.varieties.push(fixture.variety.id);
  }

  const reproductionRow = {
    id: fixture.reproduction.id,
    name: fixture.reproduction.name,
    name_ru: fixture.reproduction.nameRu,
    name_en: "First reproduction",
    code: fixture.reproduction.code,
    level_order: 4,
    description: fixture.marker,
    user_id: fixture.users.a.id,
    company_id: null,
    archived: false,
    is_active: true,
  };
  if (await ensureExactRow(client, "seed_reproductions", reproductionRow) === "created") {
    created.reproductions.push(fixture.reproduction.id);
  }

  for (const product of fixture.products) {
    const unit = String(product.unit);
    const row = {
      id: product.id,
      name: product.name,
      name_ru: product.nameRu,
      name_en: product.nameEn,
      trade_name: product.name,
      normalized_name: String(product.name).toLocaleLowerCase("ru-RU"),
      type: "fertilizer",
      product_type: "fertilizer",
      category: "fertilizer",
      subcategory: product.subcategory,
      fertilizer_type: product.fertilizerType,
      active_ingredient: product.activeIngredient,
      composition: product.activeIngredient,
      manufacturer: product.manufacturer,
      manufacturer_id: product.manufacturerId,
      user_id: fixture.users.a.id,
      company_id: null,
      unit,
      base_uom: unit,
      default_unit: unit,
      stock_unit: unit,
      physical_state: product.physicalState,
      accounting_mode: "bulk_mass",
      default_rate_type: "per_ha",
      default_rate_unit: `${unit}/ha`,
      archived: false,
      is_active: true,
      requires_review: false,
      metadata_review_required: false,
      source_url: product.sourceUrl,
      metadata_source_url: product.sourceUrl,
      metadata_confidence: "high",
      notes: fixture.marker,
      description: `Canonical branch-only QA reference (${fixture.marker})`,
    };
    if (await ensureExactRow(client, "products", row) === "created") {
      created.products.push(String(product.id));
    }
  }

  const productsByKey = Object.fromEntries(fixture.products.map((row) => [row.key, row]));
  for (const alias of fixture.aliases) {
    const product = productsByKey[alias.productKey];
    assert(product, `Unknown product key ${alias.productKey}`);
    const row = {
      id: alias.id,
      product_id: product.id,
      alias: alias.alias,
      normalized_alias: normalizedAlias(alias.alias),
      source: fixture.marker,
    };
    if (await ensureExactRow(client, "global_product_aliases", row) === "created") {
      created.aliases.push(alias.id);
    }
  }

  const { count: productCount, error: productError } = await client
    .from("products")
    .select("id", { count: "exact", head: true })
    .in("id", fixture.products.map((row) => row.id));
  if (productError) throw productError;
  assert.equal(productCount, 3);
  const createdThisRun = structuredClone(created);

  try {
    const previous = JSON.parse(
      await readFile(`${AUDIT_DIR}reference_seed_state.json`, "utf8"),
    ) as { branchRef: string; created: Record<string, string[]> };
    assert.equal(previous.branchRef, fixture.branchRef);
    for (const key of Object.keys(created)) {
      created[key] = Array.from(new Set([...(previous.created[key] ?? []), ...created[key]]));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await writeAuditJson("reference_seed_state.json", {
    fixtureVersion: fixture.version,
    branchRef: fixture.branchRef,
    created,
  });
  await writeAuditText(
    "reference_baseline_report.md",
    `# TZ-176 reference baseline\n\n- Branch: \`${fixture.branchRef}\`\n- Products: 3\n- Variety: ${fixture.variety.name}\n- Reproduction: ${fixture.reproduction.nameRu}\n- Created this run: ${Object.values(createdThisRun).reduce((sum, ids) => sum + ids.length, 0)}\n- Production writes: 0\n`,
  );

  console.log(JSON.stringify({
    status: "PASS",
    branchRef: fixture.branchRef,
    createdThisRun,
    trackedCreated: created,
    references: { products: 3, varieties: 1, reproductions: 1, aliases: 5 },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
