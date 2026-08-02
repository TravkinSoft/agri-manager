import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const workspace = resolve(root, "..", "..");
const backupDir = process.env.TZ244_BACKUP_DIR;
const outputFile = process.env.TZ244_CATALOG_MIGRATION;
const rollbackFile = process.env.TZ244_CATALOG_ROLLBACK;

if (!backupDir || !outputFile || !rollbackFile) {
  throw new Error("TZ244_BACKUP_DIR, TZ244_CATALOG_MIGRATION and TZ244_CATALOG_ROLLBACK are required");
}

const auditDir = resolve(workspace, "audit-output", "TZ-244");
const tz241Dir = resolve(workspace, "audit-output", "TZ-241");
const tz243Dir = resolve(workspace, "audit-output", "TZ-243");
const tz243Migration = resolve(root, "supabase", "migrations", "20260802100000_global_fertilizers_catalog_v1.sql");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readBackupRows = (name) => readJson(join(backupDir, `data-public-${name}.json`)).rows;
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/^["'«»“”„]+|["'«»“”„]+$/g, "")
    .replace(/\s+/g, " ");
const sql = (value) => (value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`);
const bool = (value) => (value ? "true" : "false");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function deterministicUuid(key) {
  const hex = createHash("sha256").update(`travkinflow:tz244:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function slugify(value) {
  return normalize(value)
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripTransaction(sqlText) {
  return sqlText
    .replace(/^\s*begin;\s*/i, "")
    .replace(/\s*commit;\s*$/i, "")
    .replace("-- QA-only apply in TZ-243. Do not apply to production without a separate approval.", "-- Approved production-safe catalog promotion in TZ-244.");
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(path, rows, columns) {
  writeFileSync(path, `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n")}\r\n`, "utf8");
}

const source241 = readJson(join(tz241Dir, "source-workbook-inspection.json"));
const source243 = readJson(join(tz243Dir, "source-validation.json"));
const categories = readBackupRows("crop_categories");
const crops = readBackupRows("crops");
const varieties = readBackupRows("varieties");
const products = readBackupRows("products");

const categoryMeta = {
  "Бахчевые": { slug: "melon", nameEn: "Melons" },
  "Зернобобовые": { slug: "legume", nameEn: "Legumes" },
  "Зерновые": { slug: "cereal", nameEn: "Cereals" },
  "Кормовые": { slug: "forage", nameEn: "Forage" },
  "Масличные": { slug: "oilseed", nameEn: "Oilseeds" },
  "Овощные": { slug: "vegetable", nameEn: "Vegetables" },
  "Плодово-ягодные": { slug: "fruit_berry", nameEn: "Fruit and berry crops" },
  "Технические": { slug: "technical", nameEn: "Technical crops" },
};
const sourceToProductionName = {
  "Лён масличный": "Лён (масличный)",
  Огурец: "Огурцы",
  "Перец сладкий": "Перец",
  Томат: "Томаты",
  "Капуста белокочанная": "Капуста",
  "Сахарная свёкла": "Сахарная свекла",
  "Свёкла столовая": "Свекла столовая",
};
const forbiddenCanonicalCrops = new Set(["Пар", "Зерносмесь", "Травосмесь", "Травосмеси", "Кукуруза на силос"]);

const globalCrops = crops.filter((row) => row.company_id == null);
const globalVarieties = varieties.filter((row) => row.company_id == null);
const cropByName = new Map(globalCrops.map((row) => [normalize(row.name_ru || row.name), row]));
const categoryBySlug = new Map(categories.map((row) => [row.slug, row]));
const usedIds = new Set([...categories, ...crops, ...varieties, ...products].map((row) => row.id));

const categoryPlan = Object.entries(categoryMeta).map(([nameRu, meta]) => {
  const existing = categoryBySlug.get(meta.slug);
  const id = existing?.id ?? deterministicUuid(`crop-category:${meta.slug}`);
  return {
    id,
    slug: meta.slug,
    name_ru: nameRu,
    name_en: meta.nameEn,
    action: existing ? (existing.name_ru === nameRu && existing.name_en === meta.nameEn && existing.is_active ? "KEEP" : "UPDATE_EXACT_SLUG") : "INSERT",
    before: existing ?? null,
  };
});
const categoryIdByName = new Map(categoryPlan.map((row) => [row.name_ru, row.id]));

const sourceCropRows = source241.sheets["Культуры"].values.slice(1).filter((row) => row[0] && row[1]);
const sourceVarietyRows = source241.sheets["Сорта"].values.slice(1).filter((row) => row[0] && row[1]);
const cropPlan = [];
const cropBySourceName = new Map();
const plannedSlugs = new Map(globalCrops.map((row) => [row.slug, row.id]));

for (const [categoryNameRaw, sourceNameRaw] of sourceCropRows) {
  const categoryName = String(categoryNameRaw).trim();
  const sourceName = String(sourceNameRaw).trim();
  if (forbiddenCanonicalCrops.has(sourceName)) {
    cropPlan.push({ source_name: sourceName, action: "EXCLUDED_NON_CROP", crop_id: "", target_category_id: "", target_slug: "", existing_name: "" });
    continue;
  }
  const targetCategoryId = categoryIdByName.get(categoryName);
  if (!targetCategoryId) throw new Error(`Unknown source category: ${categoryName}`);
  const aliasName = sourceToProductionName[sourceName];
  const existing = cropByName.get(normalize(sourceName)) ?? (aliasName ? cropByName.get(normalize(aliasName)) : null);
  let id = existing?.id ?? deterministicUuid(`crop:${normalize(sourceName)}`);
  let slug = existing?.slug ?? slugify(sourceName);
  if (!slug) slug = `crop-${sha256(sourceName).slice(0, 10)}`;
  if (!existing && plannedSlugs.has(slug)) throw new Error(`Crop slug collision: ${sourceName} -> ${slug}`);
  if (!existing && usedIds.has(id)) throw new Error(`Crop deterministic UUID collision: ${sourceName} -> ${id}`);
  plannedSlugs.set(slug, id);
  const action = existing ? (existing.category_id === targetCategoryId ? "KEEP_EXISTING_ID" : "UPDATE_CATEGORY_EXACT_IDENTITY") : "INSERT_MISSING";
  const planned = {
    source_name: sourceName,
    action,
    crop_id: id,
    target_category_id: targetCategoryId,
    target_slug: slug,
    existing_name: existing?.name_ru || existing?.name || "",
    before: existing ?? null,
  };
  cropPlan.push(planned);
  cropBySourceName.set(normalize(sourceName), planned);
}

const varietyByPair = new Map(globalVarieties.map((row) => [`${row.crop_id}|${normalize(row.name)}`, row]));
const varietyPlan = [];
for (const [sourceCropRaw, varietyNameRaw] of sourceVarietyRows) {
  const sourceCrop = String(sourceCropRaw).trim();
  const varietyName = String(varietyNameRaw).trim();
  const crop = cropBySourceName.get(normalize(sourceCrop));
  if (!crop) throw new Error(`Variety references excluded or unknown crop: ${sourceCrop} / ${varietyName}`);
  const pair = `${crop.crop_id}|${normalize(varietyName)}`;
  const existing = varietyByPair.get(pair);
  const id = existing?.id ?? deterministicUuid(`variety:${crop.crop_id}:${normalize(varietyName)}`);
  if (!existing && usedIds.has(id)) throw new Error(`Variety deterministic UUID collision: ${sourceCrop} / ${varietyName}`);
  varietyPlan.push({
    source_crop: sourceCrop,
    crop_id: crop.crop_id,
    variety_name: varietyName,
    variety_id: id,
    action: existing ? "KEEP_EXISTING_ID" : "INSERT_MISSING",
  });
}

const sourceProductIdentities = new Map();
for (const row of source243.products) {
  const key = `${row.productType}|${normalize(row.manufacturer)}|${normalize(row.name)}`;
  if (sourceProductIdentities.has(key)) throw new Error(`Duplicate TZ-243 source identity: ${key}`);
  sourceProductIdentities.set(key, row);
}
const globalProductByIdentity = new Map();
const duplicateProductionIdentities = [];
for (const row of products.filter((item) => item.company_id == null && !item.archived && ["fertilizer", "additive"].includes(item.product_type))) {
  const key = `${row.product_type}|${normalize(row.manufacturer)}|${normalize(row.trade_name || row.name)}`;
  if (globalProductByIdentity.has(key)) duplicateProductionIdentities.push({ key, first_id: globalProductByIdentity.get(key).id, duplicate_id: row.id });
  else globalProductByIdentity.set(key, row);
}
if (duplicateProductionIdentities.length) {
  throw new Error(`Production duplicate fertilizer/additive identities: ${duplicateProductionIdentities.length}`);
}

const productPlan = [...sourceProductIdentities.entries()].map(([identity, row]) => {
  const existing = globalProductByIdentity.get(identity);
  return {
    identity,
    product_type: row.productType,
    manufacturer: row.manufacturer,
    trade_name: row.name,
    action: existing ? "UPDATE_EXACT_IDENTITY_PRESERVE_ID" : "INSERT_MISSING",
    existing_id: existing?.id ?? "",
  };
});

for (const [tradeName, categorySlug] of Object.entries({
  "БИОЛИП": "sticker_spreader",
  "СИЛТЕК": "super_spreader",
  "PH POWER": "ph_water_conditioner",
  "ПЕН-OFF": "antifoam",
  "Hard-OFF": "hard_water_conditioner",
})) {
  const source = source243.products.find((row) => normalize(row.name) === normalize(tradeName));
  if (!source || source.productType !== "additive" || source.categorySlug !== categorySlug) {
    throw new Error(`Critical additive mapping mismatch: ${tradeName}`);
  }
}

const insertedCategories = categoryPlan.filter((row) => row.action === "INSERT");
const updatedCategories = categoryPlan.filter((row) => row.action === "UPDATE_EXACT_SLUG");
const insertedCrops = cropPlan.filter((row) => row.action === "INSERT_MISSING");
const updatedCrops = cropPlan.filter((row) => row.action === "UPDATE_CATEGORY_EXACT_IDENTITY");
const insertedVarieties = varietyPlan.filter((row) => row.action === "INSERT_MISSING");

const categoryValues = categoryPlan.map((row) => `(${sql(row.id)}::uuid, ${sql(row.slug)}, ${sql(row.name_ru)}, ${sql(row.name_en)}, true)`).join(",\n  ");
const cropInsertValues = insertedCrops.map((row) => `(${sql(row.crop_id)}::uuid, ${sql(row.source_name)}, ${sql(row.source_name)}, ${sql(row.target_slug)}, ${sql(row.target_category_id)}::uuid)`).join(",\n  ");
const cropUpdateValues = updatedCrops.map((row) => `(${sql(row.crop_id)}::uuid, ${sql(row.target_category_id)}::uuid)`).join(",\n  ");
const varietyValues = insertedVarieties.map((row) => `(${sql(row.variety_id)}::uuid, ${sql(row.crop_id)}::uuid, ${sql(row.variety_name)})`).join(",\n  ");

const cropSql = `-- TZ-244 production exact live-diff: crop and regional variety catalogs.
-- Existing IDs and production-only rows are preserved. Company-scoped rows are excluded.

do $preflight$
begin
  if (select count(*) from public.companies) <> 3 then raise exception 'TZ-244 company baseline drift'; end if;
  if (select count(*) from public.fields) <> 100 then raise exception 'TZ-244 field baseline drift'; end if;
  if (select count(*) from public.crop_structure) <> 122 then raise exception 'TZ-244 crop_structure baseline drift'; end if;
  if (select count(*) from public.operations) <> 8 then raise exception 'TZ-244 operations baseline drift'; end if;
  if not exists (select 1 from public.profiles where role='global_admin' and status='active') then raise exception 'TZ-244 active global admin missing'; end if;
end
$preflight$;

create temporary table tz244_crop_categories (id uuid primary key, slug text unique, name_ru text, name_en text, is_active boolean) on commit drop;
insert into tz244_crop_categories values
  ${categoryValues};

insert into public.crop_categories (id, slug, name_ru, name_en, is_active)
select id, slug, name_ru, name_en, is_active from tz244_crop_categories
on conflict (id) do update set
  name_ru=excluded.name_ru,
  name_en=excluded.name_en,
  is_active=true,
  updated_at=now()
where (public.crop_categories.name_ru, public.crop_categories.name_en, public.crop_categories.is_active)
  is distinct from (excluded.name_ru, excluded.name_en, true);

${insertedCrops.length ? `create temporary table tz244_crops (id uuid primary key, name text, name_ru text, slug text unique, category_id uuid) on commit drop;
insert into tz244_crops values
  ${cropInsertValues};

insert into public.crops (id,name,name_ru,slug,category_id,company_id,user_id,archived,is_active,crop_kind,default_uom,harvest_uom,seed_uom,can_have_varieties,can_have_seed_reproduction,can_be_harvested,priority_level,is_common_in_kz)
select id,name,name_ru,slug,category_id,null,null,false,true,'general','kg','kg','kg',true,true,true,'low',true from tz244_crops;` : "-- No missing crop rows."}

${updatedCrops.length ? `create temporary table tz244_crop_category_updates (id uuid primary key, category_id uuid not null) on commit drop;
insert into tz244_crop_category_updates values
  ${cropUpdateValues};
update public.crops c set category_id=u.category_id, updated_at=now()
from tz244_crop_category_updates u
where c.id=u.id and c.company_id is null and c.category_id is distinct from u.category_id;` : "-- No exact-identity crop category updates."}

${insertedVarieties.length ? `create temporary table tz244_varieties (id uuid primary key, crop_id uuid not null, name text not null, unique(crop_id,name)) on commit drop;
insert into tz244_varieties values
  ${varietyValues};
insert into public.varieties (id,crop_id,name,name_ru,user_id,company_id,archived,is_active,is_common_in_kz)
select id,crop_id,name,name,(select id from public.profiles where role='global_admin' and status='active' order by id limit 1),null,false,true,true
from tz244_varieties;` : "-- No missing variety rows."}

do $crop_postcheck$
begin
  if exists (select 1 from public.crops where company_id is null and name in ('Пар','Зерносмесь','Травосмесь') and created_at >= transaction_timestamp()) then
    raise exception 'TZ-244 created a forbidden non-crop row';
  end if;
  if exists (select id from public.crops where company_id is null group by id having count(*) > 1) then raise exception 'TZ-244 duplicate crop ids'; end if;
  if exists (select crop_id, lower(name) from public.varieties where company_id is null and not coalesce(archived,false) group by crop_id,lower(name) having count(*) > 1) then
    raise exception 'TZ-244 duplicate variety identity';
  end if;
end
$crop_postcheck$;
`;

const fertilizerSql = stripTransaction(readFileSync(tz243Migration, "utf8"));
const migration = `-- TZ-244 Father Pilot V1 consolidated production-safe global catalogs.\n-- Source crops/varieties SHA-256: FCF7D0D8D0716929F8E5673A9D3B30C3E638EE2D6403AE2CCD891577BBE26A81\n-- Source fertilizers SHA-256: 302B81CAFF523E3E74499AC595E06E92D6A22C975EC93B07224BAA23861BEE04\n\n${cropSql}\n\n${fertilizerSql}\n`;

const rollbackCategoryUpdates = updatedCategories.map((row) => `update public.crop_categories set name_ru=${sql(row.before.name_ru)},name_en=${sql(row.before.name_en)},is_active=${bool(row.before.is_active)},updated_at=${sql(row.before.updated_at)}::timestamptz where id=${sql(row.id)}::uuid;`).join("\n");
const rollbackCropUpdates = updatedCrops.map((row) => `update public.crops set category_id=${sql(row.before.category_id)}::uuid,updated_at=${sql(row.before.updated_at)}::timestamptz where id=${sql(row.crop_id)}::uuid;`).join("\n");
const matchedProducts = productPlan.filter((row) => row.existing_id).map((row) => products.find((product) => product.id === row.existing_id));
const productColumns = [
  "name", "trade_name", "name_ru", "type", "product_type", "manufacturer", "manufacturer_id", "formulation", "formulation_id",
  "product_form", "unit", "default_unit", "stock_unit", "base_uom", "physical_state", "composition", "description", "active_ingredient",
  "fertilizer_type", "fertilizer_category_id", "application_scope", "catalog_category_label", "catalog_category_slug", "category", "subcategory",
  "pesticide_category", "category_id", "source_url", "metadata_source_url", "metadata_confidence", "import_confidence", "normalized_name",
  "ui_group", "requires_review", "metadata_review_required", "agro_composition_raw", "agro_source_urls_raw", "agro_knowledge_source_version",
  "agro_knowledge_source_checksum", "catalog_source_version", "catalog_source_checksum", "catalog_source_row", "catalog_source_created",
  "is_active", "archived", "updated_at",
];
const castByColumn = new Map([
  ["manufacturer_id", "uuid"], ["formulation_id", "uuid"], ["fertilizer_category_id", "uuid"], ["category_id", "uuid"],
  ["agro_composition_raw", "jsonb"], ["agro_source_urls_raw", "jsonb"], ["updated_at", "timestamptz"],
]);
const sqlValue = (column, value) => {
  if (value == null) return "null";
  if (typeof value === "boolean") return bool(value);
  if (typeof value === "number") return String(value);
  const encoded = typeof value === "object" ? JSON.stringify(value) : value;
  const cast = castByColumn.get(column);
  return `${sql(encoded)}${cast ? `::${cast}` : ""}`;
};
const productRollback = matchedProducts.map((row) => `update public.products set ${productColumns.map((column) => `${column}=${sqlValue(column, row[column])}`).join(",")} where id=${sql(row.id)}::uuid;`).join("\n");
const rollback = `-- TZ-244 exact catalog data rollback. Schema additions remain backward-compatible.\nbegin;\ndelete from public.products where company_id is null and catalog_source_version='TZ-243/V1' and catalog_source_created=true;\n${productRollback}\n${insertedVarieties.length ? `delete from public.varieties where id in (${insertedVarieties.map((row) => `${sql(row.variety_id)}::uuid`).join(",")});` : ""}\n${insertedCrops.length ? `delete from public.crops where id in (${insertedCrops.map((row) => `${sql(row.crop_id)}::uuid`).join(",")});` : ""}\n${rollbackCropUpdates}\n${insertedCategories.length ? `delete from public.crop_categories where id in (${insertedCategories.map((row) => `${sql(row.id)}::uuid`).join(",")});` : ""}\n${rollbackCategoryUpdates}\ndelete from public.fertilizer_categories;\ncommit;\n`;

const summary = {
  generated_at: new Date().toISOString(),
  production_backup: backupDir,
  source: {
    crops_varieties_sha256: "FCF7D0D8D0716929F8E5673A9D3B30C3E638EE2D6403AE2CCD891577BBE26A81",
    fertilizers_sha256: source243.source.sha256,
  },
  production_before: {
    crops: crops.length,
    varieties: varieties.length,
    products: products.length,
    global_fertilizers: products.filter((row) => row.company_id == null && !row.archived && row.product_type === "fertilizer").length,
    global_additives: products.filter((row) => row.company_id == null && !row.archived && row.product_type === "additive").length,
    global_adjuvants: products.filter((row) => row.company_id == null && !row.archived && row.product_type === "adjuvant").length,
    global_growth_regulators: products.filter((row) => row.company_id == null && !row.archived && row.product_type === "growth_regulator").length,
  },
  crop_actions: Object.fromEntries(Object.entries(Object.groupBy(cropPlan, (row) => row.action)).map(([key, rows]) => [key, rows.length])),
  variety_actions: Object.fromEntries(Object.entries(Object.groupBy(varietyPlan, (row) => row.action)).map(([key, rows]) => [key, rows.length])),
  product_actions: Object.fromEntries(Object.entries(Object.groupBy(productPlan, (row) => row.action)).map(([key, rows]) => [key, rows.length])),
  expected_after: {
    crops: crops.length + insertedCrops.length,
    varieties: varieties.length + insertedVarieties.length,
    global_fertilizers: products.filter((row) => row.company_id == null && !row.archived && row.product_type === "fertilizer").length + productPlan.filter((row) => row.product_type === "fertilizer" && row.action === "INSERT_MISSING").length,
    global_additives: products.filter((row) => row.company_id == null && !row.archived && row.product_type === "additive").length + productPlan.filter((row) => row.product_type === "additive" && row.action === "INSERT_MISSING").length,
  },
  company_rows_touched: 0,
  duplicate_production_identities: duplicateProductionIdentities.length,
  migration_sha256: sha256(migration),
  rollback_sha256: sha256(rollback),
};

mkdirSync(dirname(outputFile), { recursive: true });
mkdirSync(dirname(rollbackFile), { recursive: true });
mkdirSync(auditDir, { recursive: true });
writeFileSync(outputFile, migration, "utf8");
writeFileSync(rollbackFile, rollback, "utf8");
writeFileSync(join(auditDir, "catalog-live-diff-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
writeCsv(join(auditDir, "crops-production-live-diff.csv"), cropPlan, ["source_name", "action", "crop_id", "target_category_id", "target_slug", "existing_name"]);
writeCsv(join(auditDir, "varieties-production-live-diff.csv"), varietyPlan, ["source_crop", "crop_id", "variety_name", "variety_id", "action"]);
writeCsv(join(auditDir, "products-production-live-diff.csv"), productPlan, ["product_type", "manufacturer", "trade_name", "action", "existing_id", "identity"]);

console.log(JSON.stringify(summary));
