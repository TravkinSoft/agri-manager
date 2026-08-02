#!/usr/bin/env node
/* eslint-disable no-console */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { createClient } from "@supabase/supabase-js";

const QA_REF = "gsglkmudcwkdetqtocae";
const SOURCE_SHA256 = "302B81CAFF523E3E74499AC595E06E92D6A22C975EC93B07224BAA23861BEE04";
const SOURCE_VERSION = "TZ-243/V1";
const DEFAULT_SOURCE = path.resolve(process.cwd(), "..", "..", "TravkinFlow_Fertilizers_Kazakhstan_Import_Master_V3.xlsx");
const DEFAULT_OUTPUT = path.resolve(process.cwd(), "..", "audit-output", "TZ-243");
const DEFAULT_ENV = path.resolve(process.cwd(), "..", "project-bolt-sb1-hjjzpfey-4", "project", ".env.local");
const DEFAULT_MIGRATION = path.resolve(process.cwd(), "supabase", "migrations", "20260802100000_global_fertilizers_catalog_v1.sql");

const EXPECTED = Object.freeze({ fertilizers: 418, additives: 5, categories: 13, applications: 8 });
const EXPECTED_TYPES = Object.freeze({ fertilizers: "fertilizer", additives: "additive" });
const EXPECTED_ACTION = "UPSERT";
const NORMALIZED_HYPHENS = /[\u2010\u2011\u2012\u2013\u2014\u2212]/g;
const OUTER_QUOTES = /^["'«»“”„]+|["'«»“”„]+$/g;

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, output: DEFAULT_OUTPUT, env: DEFAULT_ENV, migration: DEFAULT_MIGRATION, backup: false };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--backup") args.backup = true;
    else if (value === "--source") args.source = path.resolve(argv[++index]);
    else if (value === "--output") args.output = path.resolve(argv[++index]);
    else if (value === "--env") args.env = path.resolve(argv[++index]);
    else if (value === "--migration") args.migration = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function assert(condition, message) {
  if (!condition) throw new Error(`STOP: ${message}`);
}

function normalizeIdentity(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(NORMALIZED_HYPHENS, "-")
    .trim()
    .replace(OUTER_QUOTES, "")
    .trim()
    .replace(/\s+/g, " ");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

function attributeValue(attributes, ...names) {
  for (const name of names) {
    const attribute = attributes[name];
    if (attribute == null) continue;
    return typeof attribute === "object" && "value" in attribute ? String(attribute.value) : String(attribute);
  }
  return "";
}

function parseXml(xml, handlers) {
  const parser = new SaxesParser({ xmlns: false });
  if (handlers.open) parser.on("opentag", handlers.open);
  if (handlers.text) parser.on("text", handlers.text);
  if (handlers.close) parser.on("closetag", handlers.close);
  parser.write(xml).close();
}

function columnIndex(reference) {
  const letters = String(reference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function sheetRecords(matrix) {
  assert(matrix, "required workbook sheet is missing");
  const headers = (matrix[0] || []).map((value) => String(value ?? "").trim());
  const rows = [];
  for (let rowNumber = 2; rowNumber <= matrix.length; rowNumber += 1) {
    const row = matrix[rowNumber - 1] || [];
    const record = {};
    let populated = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = String(row[index] ?? "").trim();
      record[header] = value;
      if (value) populated = true;
    });
    if (populated) rows.push({ ...record, _source_row: rowNumber });
  }
  return { headers, rows };
}

function sourceIdentity(row) {
  return `${normalizeIdentity(row["Производитель / бренд"])}|${normalizeIdentity(row["Название"])}`;
}

function sqlString(value) {
  if (value == null || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlInt(value) {
  const number = Number(value);
  assert(Number.isInteger(number), `not an integer: ${value}`);
  return String(number);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  fs.writeFileSync(filePath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function loadWorkbook(sourcePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const relationshipsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  assert(workbookXml && relationshipsXml, "XLSX workbook metadata is missing");

  const relationships = new Map();
  parseXml(relationshipsXml, {
    open(tag) {
      if (tag.name.endsWith("Relationship")) {
        relationships.set(attributeValue(tag.attributes, "Id"), attributeValue(tag.attributes, "Target"));
      }
    },
  });

  const sheetTargets = new Map();
  parseXml(workbookXml, {
    open(tag) {
      if (!tag.name.endsWith("sheet")) return;
      const name = attributeValue(tag.attributes, "name");
      const relationshipId = attributeValue(tag.attributes, "r:id", "id");
      const target = relationships.get(relationshipId);
      if (name && target) sheetTargets.set(name, `xl/${target.replace(/^\/?xl\//, "")}`.replace(/\\/g, "/"));
    },
  });

  const sharedStrings = [];
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (sharedXml) {
    let inItem = false;
    let inText = false;
    let value = "";
    parseXml(sharedXml, {
      open(tag) {
        if (tag.name.endsWith("si")) { inItem = true; value = ""; }
        if (inItem && tag.name.endsWith("t")) inText = true;
      },
      text(text) { if (inItem && inText) value += text; },
      close(tag) {
        if (tag.name.endsWith("t")) inText = false;
        if (tag.name.endsWith("si")) { sharedStrings.push(value); inItem = false; }
      },
    });
  }

  const matrices = new Map();
  for (const [name, target] of sheetTargets.entries()) {
    const sheetXml = await zip.file(target)?.async("string");
    assert(sheetXml, `sheet payload is missing: ${name}`);
    const matrix = [];
    let currentCell = null;
    let captureValue = false;
    let rawValue = "";
    parseXml(sheetXml, {
      open(tag) {
        if (tag.name.endsWith("c")) {
          currentCell = {
            reference: attributeValue(tag.attributes, "r"),
            type: attributeValue(tag.attributes, "t"),
          };
          rawValue = "";
        }
        if (currentCell && (tag.name.endsWith("v") || tag.name.endsWith("t"))) captureValue = true;
      },
      text(text) { if (currentCell && captureValue) rawValue += text; },
      close(tag) {
        if (tag.name.endsWith("v") || tag.name.endsWith("t")) captureValue = false;
        if (!tag.name.endsWith("c") || !currentCell) return;
        const rowNumber = Number(currentCell.reference.match(/\d+$/)?.[0] || 1) - 1;
        const column = columnIndex(currentCell.reference);
        if (!matrix[rowNumber]) matrix[rowNumber] = [];
        matrix[rowNumber][column] = currentCell.type === "s" ? sharedStrings[Number(rawValue)] ?? "" : rawValue;
        currentCell = null;
      },
    });
    matrices.set(name, matrix);
  }

  return {
    fertilizers: sheetRecords(matrices.get("Импорт удобрений")),
    additives: sheetRecords(matrices.get("Импорт препаратов")),
    categoryAudit: sheetRecords(matrices.get("Аудит категорий")),
    categories: sheetRecords(matrices.get("Категории")),
    applications: sheetRecords(matrices.get("Применение")),
    identities: sheetRecords(matrices.get("Контроль identity")),
    menu: sheetRecords(matrices.get("Меню")),
  };
}

function validateSource(sourcePath, workbook) {
  const sourceSha = sha256File(sourcePath);
  assert(sourceSha === SOURCE_SHA256, `source SHA-256 mismatch: ${sourceSha}`);
  assert(fs.statSync(sourcePath).size === 95196, `source size mismatch: ${fs.statSync(sourcePath).size}`);
  assert(workbook.fertilizers.rows.length === EXPECTED.fertilizers, `fertilizer count is ${workbook.fertilizers.rows.length}`);
  assert(workbook.additives.rows.length === EXPECTED.additives, `additive count is ${workbook.additives.rows.length}`);
  assert(workbook.categories.rows.length === EXPECTED.categories, `category count is ${workbook.categories.rows.length}`);
  assert(workbook.applications.rows.length === EXPECTED.applications, `application count is ${workbook.applications.rows.length}`);

  const allProducts = [...workbook.fertilizers.rows, ...workbook.additives.rows];
  assert(workbook.fertilizers.rows.every((row) => row.product_type === EXPECTED_TYPES.fertilizers), "non-fertilizer row exists in fertilizer sheet");
  assert(workbook.additives.rows.every((row) => row.product_type === EXPECTED_TYPES.additives), "non-additive row exists in additive sheet");
  assert(allProducts.every((row) => row.import_action === EXPECTED_ACTION), "unsupported import_action exists");
  assert(allProducts.every((row) => row["Название"] && row.category_slug && row["Применение"] && row["Форма"] && row["Единица"]), "required source value is missing");
  assert(workbook.categoryAudit.rows.every((row) => row["Решение"] && row["Решение"] !== "REVIEW"), "category audit contains unresolved rows");

  const identityCounts = new Map();
  for (const row of allProducts) identityCounts.set(sourceIdentity(row), (identityCounts.get(sourceIdentity(row)) || 0) + 1);
  const sourceConflicts = [...identityCounts.entries()].filter(([, count]) => count > 1);
  assert(sourceConflicts.length === 0, `source contains ${sourceConflicts.length} duplicate identities`);
  assert(workbook.fertilizers.rows.some((row) => row["Название"] === "Aminosid POWER"), "Aminosid POWER is missing");
  assert(!workbook.fertilizers.rows.some((row) => normalizeIdentity(row["Название"]) === normalizeIdentity("БИОЛИП")), "BioLip must not be a fertilizer");
  assert(workbook.additives.rows.some((row) => normalizeIdentity(row["Название"]) === normalizeIdentity("БИОЛИП")), "BioLip additive is missing");
  return { sourceSha, allProducts, sourceConflicts };
}

function productSourceRows(workbook) {
  return [
    ...workbook.fertilizers.rows.map((row) => ({
      sourceKind: "fertilizer",
      manufacturer: row["Производитель / бренд"],
      name: row["Название"],
      productType: row.product_type,
      categoryLabel: row["Категория"],
      categorySlug: row.category_slug,
      applicationScope: row["Применение"],
      composition: row["Состав"],
      description: "",
      formulation: row["Форма"],
      unit: row["Единица"] === "л" ? "l" : "kg",
      sourceUrl: row["Источник продукта / линейки"],
      presenceUrl: row["Подтверждение присутствия в РК"],
      confidence: row.confidence,
      sourceRow: row._source_row,
    })),
    ...workbook.additives.rows.map((row) => ({
      sourceKind: "additive",
      manufacturer: row["Производитель / бренд"],
      name: row["Название"],
      productType: row.product_type,
      categoryLabel: row["Категория"],
      categorySlug: row.category_slug,
      applicationScope: row["Применение"],
      composition: "",
      description: row["Назначение"],
      formulation: row["Форма"],
      unit: row["Единица"] === "кг" ? "kg" : "l",
      sourceUrl: row["Источник"],
      presenceUrl: "",
      confidence: row.confidence,
      sourceRow: row._source_row,
    })),
  ];
}

function physicalState(formulation) {
  const value = normalizeIdentity(formulation);
  if (value.includes("жидк")) return "liquid";
  if (value.includes("гранул")) return "granule";
  if (value.includes("порош")) return "powder";
  if (value.includes("гель")) return "gel";
  return "solid";
}

function additiveSubtype(slug) {
  return ({
    super_spreader: ["adjuvant", "surfactant"],
    sticker_spreader: ["sticker", "surfactant"],
    ph_water_conditioner: ["pH_corrector", "pH_regulator"],
    antifoam: ["antifoam", "anti_foam"],
    hard_water_conditioner: ["water_conditioner", "water_conditioner"],
  })[slug] || ["other", "other"];
}

function valuesSql(rows) {
  return rows.map((row) => {
    const [subcategory, pesticideCategory] = row.sourceKind === "additive" ? additiveSubtype(row.categorySlug) : [null, null];
    return `(${[
      sqlString(row.sourceKind), sqlString(row.manufacturer), sqlString(row.name), sqlString(row.productType),
      sqlString(row.categoryLabel), sqlString(row.categorySlug), sqlString(row.applicationScope),
      sqlString(row.composition), sqlString(row.description), sqlString(row.formulation), sqlString(row.unit),
      sqlString(row.sourceUrl), sqlString(row.presenceUrl), sqlString(row.confidence), sqlString(physicalState(row.formulation)),
      sqlString(subcategory), sqlString(pesticideCategory), sqlInt(row.sourceRow),
    ].join(", ")})`;
  }).join(",\n  ");
}

function categoryValuesSql(rows) {
  return rows.map((row, index) => `(${sqlString(row.slug)}, ${sqlString(row["Категория"])}, ${sqlString(row["Определение"])}, ${sqlString(row["Примеры"])}, ${index + 1})`).join(",\n  ");
}

function buildMigration(workbook, rows) {
  const allowedCategories = workbook.categories.rows.map((row) => sqlString(row.slug)).join(", ");
  const allowedApplications = workbook.applications.rows.map((row) => sqlString(row["Применение"])).join(", ");
  return `-- Generated by scripts/catalog/build-tz243-global-fertilizers-package.mjs
-- Source SHA-256: ${SOURCE_SHA256}
-- QA-only apply in TZ-243. Do not apply to production without a separate approval.

begin;

create schema if not exists private;

create or replace function private.normalize_catalog_identity_text_v1(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select regexp_replace(
    trim(both ' ' from regexp_replace(
      translate(replace(lower(normalize(coalesce(value, ''), NFKC)), 'ё', 'е'), '‐‑‒–—−', '------'),
      '^["''«»“”„]+|["''«»“”„]+$', '', 'g'
    )),
    '[[:space:]]+', ' ', 'g'
  )
$function$;

revoke all on function private.normalize_catalog_identity_text_v1(text) from public, anon, authenticated;
grant execute on function private.normalize_catalog_identity_text_v1(text) to authenticated;

create table if not exists public.fertilizer_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_ru text not null,
  definition text,
  examples text,
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fertilizer_categories enable row level security;
revoke all on public.fertilizer_categories from anon;
grant select, insert, update, delete on public.fertilizer_categories to authenticated;

do $policy$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='fertilizer_categories' and policyname='fertilizer_categories_authenticated_read') then
    execute 'create policy fertilizer_categories_authenticated_read on public.fertilizer_categories for select to authenticated using (is_active and not archived)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='fertilizer_categories' and policyname='fertilizer_categories_global_admin_insert') then
    execute 'create policy fertilizer_categories_global_admin_insert on public.fertilizer_categories for insert to authenticated with check ((select private.is_active_global_admin()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='fertilizer_categories' and policyname='fertilizer_categories_global_admin_update') then
    execute 'create policy fertilizer_categories_global_admin_update on public.fertilizer_categories for update to authenticated using ((select private.is_active_global_admin())) with check ((select private.is_active_global_admin()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='fertilizer_categories' and policyname='fertilizer_categories_global_admin_delete') then
    execute 'create policy fertilizer_categories_global_admin_delete on public.fertilizer_categories for delete to authenticated using ((select private.is_active_global_admin()))';
  end if;
end
$policy$;

insert into public.fertilizer_categories (slug, name_ru, definition, examples, sort_order)
values
  ${categoryValuesSql(workbook.categories.rows)}
on conflict (slug) do update set
  name_ru=excluded.name_ru,
  definition=excluded.definition,
  examples=excluded.examples,
  sort_order=excluded.sort_order,
  is_active=true,
  archived=false,
  updated_at=now()
where (fertilizer_categories.name_ru, fertilizer_categories.definition, fertilizer_categories.examples, fertilizer_categories.sort_order, fertilizer_categories.is_active, fertilizer_categories.archived)
  is distinct from (excluded.name_ru, excluded.definition, excluded.examples, excluded.sort_order, true, false);

alter table public.products add column if not exists fertilizer_category_id uuid;
alter table public.products add column if not exists application_scope text;
alter table public.products add column if not exists catalog_category_label text;
alter table public.products add column if not exists catalog_category_slug text;
alter table public.products add column if not exists catalog_source_version text;
alter table public.products add column if not exists catalog_source_checksum text;
alter table public.products add column if not exists catalog_source_row integer;
alter table public.products add column if not exists catalog_source_created boolean not null default false;

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_fertilizer_category_id_fkey') then
    alter table public.products add constraint products_fertilizer_category_id_fkey foreign key (fertilizer_category_id) references public.fertilizer_categories(id) on update cascade on delete set null;
  end if;
  if exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_fertilizer_type_check_v2')
     and not exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_fertilizer_type_check_v3') then
    alter table public.products drop constraint products_fertilizer_type_check_v2;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_fertilizer_type_check_v3') then
    alter table public.products add constraint products_fertilizer_type_check_v3 check (
      type <> 'fertilizer' or fertilizer_type is null or fertilizer_type in ('npk', 'foliar', 'organic', ${allowedCategories})
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_application_scope_check_v1') then
    alter table public.products add constraint products_application_scope_check_v1 check (application_scope is null or application_scope in (${allowedApplications}));
  end if;
end
$constraints$;

create index if not exists idx_products_fertilizer_category_id on public.products(fertilizer_category_id);
create index if not exists idx_products_global_fertilizer_application on public.products(application_scope) where company_id is null and product_type='fertilizer' and archived=false;
create unique index if not exists ux_products_global_fertilizer_additive_identity_v1
  on public.products(product_type, private.normalize_catalog_identity_text_v1(manufacturer), private.normalize_catalog_identity_text_v1(coalesce(trade_name, name)))
  where company_id is null and product_type in ('fertilizer','additive') and archived=false;

drop policy if exists "Users can create own products" on public.products;
do $product_policies$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Global admins can insert global products') then
    execute 'create policy "Global admins can insert global products" on public.products for insert to authenticated with check (company_id is null and (select private.is_active_global_admin()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Global admins can update global products') then
    execute 'create policy "Global admins can update global products" on public.products for update to authenticated using (company_id is null and (select private.is_active_global_admin())) with check (company_id is null and (select private.is_active_global_admin()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Global admins can delete global products') then
    execute 'create policy "Global admins can delete global products" on public.products for delete to authenticated using (company_id is null and (select private.is_active_global_admin()))';
  end if;
end
$product_policies$;

create temporary table tz243_source_products (
  source_kind text not null,
  manufacturer text,
  trade_name text not null,
  product_type text not null,
  category_label text not null,
  category_slug text not null,
  application_scope text not null,
  composition text,
  description text,
  formulation text not null,
  unit text not null,
  source_url text not null,
  presence_url text,
  confidence text not null,
  physical_state text not null,
  subcategory text,
  pesticide_category text,
  source_row integer not null,
  identity_key text generated always as (private.normalize_catalog_identity_text_v1(manufacturer) || '|' || private.normalize_catalog_identity_text_v1(trade_name)) stored
) on commit drop;

insert into tz243_source_products (
  source_kind, manufacturer, trade_name, product_type, category_label, category_slug,
  application_scope, composition, description, formulation, unit, source_url,
  presence_url, confidence, physical_state, subcategory, pesticide_category, source_row
)
values
  ${valuesSql(rows)};

do $validate$
declare
  active_admins integer;
begin
  if (select count(*) from tz243_source_products) <> 423 then raise exception 'TZ-243 source count mismatch'; end if;
  if (select count(*) from tz243_source_products where product_type='fertilizer') <> 418 then raise exception 'TZ-243 fertilizer count mismatch'; end if;
  if (select count(*) from tz243_source_products where product_type='additive') <> 5 then raise exception 'TZ-243 additive count mismatch'; end if;
  if exists (select identity_key from tz243_source_products group by identity_key having count(*) > 1) then raise exception 'TZ-243 duplicate source identity'; end if;
  if exists (
    select 1 from tz243_source_products s join public.products p
      on p.company_id is null and not coalesce(p.archived,false)
     and p.product_type in ('fertilizer','additive')
     and private.normalize_catalog_identity_text_v1(p.manufacturer)=private.normalize_catalog_identity_text_v1(s.manufacturer)
     and private.normalize_catalog_identity_text_v1(coalesce(p.trade_name,p.name))=private.normalize_catalog_identity_text_v1(s.trade_name)
    group by s.identity_key having count(*) > 1
  ) then raise exception 'TZ-243 ambiguous live identity'; end if;
  select count(*) into active_admins from public.profiles where role='global_admin' and status='active';
  if active_admins < 1 then raise exception 'TZ-243 active global admin is required for product ownership'; end if;
end
$validate$;

insert into public.agrochem_manufacturers(name, is_active, archived)
select distinct s.manufacturer, true, false
from tz243_source_products s
where nullif(trim(s.manufacturer),'') is not null
  and not exists (
    select 1 from public.agrochem_manufacturers m
    where not m.archived and private.normalize_catalog_identity_text_v1(m.name)=private.normalize_catalog_identity_text_v1(s.manufacturer)
  );

insert into public.agrochem_formulations(code, name_ru, is_active, archived)
select 'TZ243_' || upper(substr(md5(private.normalize_catalog_identity_text_v1(s.formulation)),1,12)), s.formulation, true, false
from (select distinct formulation from tz243_source_products) s
where not exists (
  select 1 from public.agrochem_formulations f
  where not f.archived and private.normalize_catalog_identity_text_v1(f.name_ru)=private.normalize_catalog_identity_text_v1(s.formulation)
);

create temporary table tz243_product_matches on commit drop as
select s.*, p.id as product_id
from tz243_source_products s
left join public.products p
  on p.company_id is null and not coalesce(p.archived,false)
 and p.product_type in ('fertilizer','additive')
 and private.normalize_catalog_identity_text_v1(p.manufacturer)=private.normalize_catalog_identity_text_v1(s.manufacturer)
 and private.normalize_catalog_identity_text_v1(coalesce(p.trade_name,p.name))=private.normalize_catalog_identity_text_v1(s.trade_name);

update public.products p set
  name=s.trade_name,
  trade_name=s.trade_name,
  name_ru=s.trade_name,
  type=case when s.product_type='fertilizer' then 'fertilizer' else 'pesticide' end,
  product_type=s.product_type,
  manufacturer=nullif(s.manufacturer,''),
  manufacturer_id=(select m.id from public.agrochem_manufacturers m where not m.archived and private.normalize_catalog_identity_text_v1(m.name)=private.normalize_catalog_identity_text_v1(s.manufacturer) limit 1),
  formulation=s.formulation,
  formulation_id=(select f.id from public.agrochem_formulations f where not f.archived and private.normalize_catalog_identity_text_v1(f.name_ru)=private.normalize_catalog_identity_text_v1(s.formulation) limit 1),
  product_form=s.formulation,
  unit=s.unit,
  default_unit=s.unit,
  stock_unit=s.unit,
  base_uom=s.unit,
  physical_state=s.physical_state,
  composition=nullif(s.composition,''),
  description=coalesce(nullif(s.description,''),p.description),
  active_ingredient=case when s.product_type='fertilizer' then null else p.active_ingredient end,
  fertilizer_type=case when s.product_type='fertilizer' then s.category_slug else null end,
  fertilizer_category_id=case when s.product_type='fertilizer' then (select c.id from public.fertilizer_categories c where c.slug=s.category_slug) else null end,
  application_scope=s.application_scope,
  catalog_category_label=s.category_label,
  catalog_category_slug=s.category_slug,
  category=case when s.product_type='fertilizer' then 'fertilizer' else 'additive' end,
  subcategory=s.subcategory,
  pesticide_category=s.pesticide_category,
  category_id=null,
  source_url=s.source_url,
  metadata_source_url=s.source_url,
  metadata_confidence=s.confidence,
  import_confidence=s.confidence,
  normalized_name=private.normalize_catalog_identity_text_v1(s.trade_name),
  ui_group=case when s.product_type='fertilizer' then 'fertilizers' else 'pesticides' end,
  requires_review=false,
  metadata_review_required=false,
  agro_source_urls_raw=case
    when coalesce(p.agro_source_urls_raw,'[]'::jsonb) @> jsonb_build_array(s.source_url) then coalesce(p.agro_source_urls_raw,'[]'::jsonb)
    else coalesce(p.agro_source_urls_raw,'[]'::jsonb) || jsonb_build_array(s.source_url)
  end,
  agro_knowledge_source_version='${SOURCE_VERSION}',
  agro_knowledge_source_checksum='${SOURCE_SHA256}',
  catalog_source_version='${SOURCE_VERSION}',
  catalog_source_checksum='${SOURCE_SHA256}',
  catalog_source_row=s.source_row,
  is_active=true,
  archived=false,
  updated_at=now()
from tz243_product_matches s
where s.product_id=p.id
  and jsonb_build_array(
    p.name,p.trade_name,p.name_ru,p.type,p.product_type,p.manufacturer,p.manufacturer_id,p.formulation,p.formulation_id,
    p.product_form,p.unit,p.default_unit,p.stock_unit,p.base_uom,p.physical_state,p.composition,
    p.fertilizer_type,p.fertilizer_category_id,p.application_scope,p.catalog_category_label,p.catalog_category_slug,
    p.category,p.subcategory,p.pesticide_category,p.category_id,p.source_url,p.metadata_source_url,p.metadata_confidence,
    p.import_confidence,p.normalized_name,p.ui_group,p.requires_review,p.metadata_review_required,p.catalog_source_version,
    p.catalog_source_checksum,p.catalog_source_row,p.is_active,p.archived
  ) is distinct from jsonb_build_array(
    s.trade_name,s.trade_name,s.trade_name,case when s.product_type='fertilizer' then 'fertilizer' else 'pesticide' end,s.product_type,
    nullif(s.manufacturer,''),(select m.id from public.agrochem_manufacturers m where not m.archived and private.normalize_catalog_identity_text_v1(m.name)=private.normalize_catalog_identity_text_v1(s.manufacturer) limit 1),
    s.formulation,(select f.id from public.agrochem_formulations f where not f.archived and private.normalize_catalog_identity_text_v1(f.name_ru)=private.normalize_catalog_identity_text_v1(s.formulation) limit 1),
    s.formulation,s.unit,s.unit,s.unit,s.unit,s.physical_state,nullif(s.composition,''),
    case when s.product_type='fertilizer' then s.category_slug else null end,
    case when s.product_type='fertilizer' then (select c.id from public.fertilizer_categories c where c.slug=s.category_slug) else null end,
    s.application_scope,s.category_label,s.category_slug,case when s.product_type='fertilizer' then 'fertilizer' else 'additive' end,
    s.subcategory,s.pesticide_category,null,s.source_url,s.source_url,s.confidence,s.confidence,
    private.normalize_catalog_identity_text_v1(s.trade_name),case when s.product_type='fertilizer' then 'fertilizers' else 'pesticides' end,
    false,false,'${SOURCE_VERSION}','${SOURCE_SHA256}',s.source_row,true,false
  );

insert into public.products (
  name,trade_name,name_ru,type,product_type,user_id,company_id,manufacturer,manufacturer_id,formulation,formulation_id,
  product_form,unit,default_unit,stock_unit,base_uom,physical_state,composition,description,active_ingredient,
  fertilizer_type,fertilizer_category_id,application_scope,catalog_category_label,catalog_category_slug,
  category,subcategory,pesticide_category,source_url,metadata_source_url,metadata_confidence,import_confidence,
  normalized_name,ui_group,requires_review,metadata_review_required,agro_composition_raw,agro_source_urls_raw,
  agro_knowledge_source_version,agro_knowledge_source_checksum,catalog_source_version,catalog_source_checksum,
  catalog_source_row,catalog_source_created,is_active,archived
)
select
  s.trade_name,s.trade_name,s.trade_name,case when s.product_type='fertilizer' then 'fertilizer' else 'pesticide' end,s.product_type,
  (select id from public.profiles where role='global_admin' and status='active' order by id limit 1),null,
  nullif(s.manufacturer,''),(select m.id from public.agrochem_manufacturers m where not m.archived and private.normalize_catalog_identity_text_v1(m.name)=private.normalize_catalog_identity_text_v1(s.manufacturer) limit 1),
  s.formulation,(select f.id from public.agrochem_formulations f where not f.archived and private.normalize_catalog_identity_text_v1(f.name_ru)=private.normalize_catalog_identity_text_v1(s.formulation) limit 1),
  s.formulation,s.unit,s.unit,s.unit,s.unit,s.physical_state,nullif(s.composition,''),nullif(s.description,''),null,
  case when s.product_type='fertilizer' then s.category_slug else null end,
  case when s.product_type='fertilizer' then (select c.id from public.fertilizer_categories c where c.slug=s.category_slug) else null end,
  s.application_scope,s.category_label,s.category_slug,case when s.product_type='fertilizer' then 'fertilizer' else 'additive' end,
  s.subcategory,s.pesticide_category,s.source_url,s.source_url,s.confidence,s.confidence,
  private.normalize_catalog_identity_text_v1(s.trade_name),case when s.product_type='fertilizer' then 'fertilizers' else 'pesticides' end,
  false,false,case when nullif(s.composition,'') is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('raw_value',s.composition,'source_row',s.source_row)) end,
  jsonb_build_array(s.source_url),'${SOURCE_VERSION}','${SOURCE_SHA256}','${SOURCE_VERSION}','${SOURCE_SHA256}',s.source_row,true,true,false
from tz243_product_matches s
where s.product_id is null;

do $postcheck$
begin
  if (select count(*) from public.fertilizer_categories where not archived and is_active) <> 13 then raise exception 'TZ-243 category postcheck failed'; end if;
  if (select count(*) from public.products where company_id is null and not coalesce(archived,false) and catalog_source_version='${SOURCE_VERSION}' and product_type='fertilizer') <> 418 then raise exception 'TZ-243 fertilizer postcheck failed'; end if;
  if (select count(*) from public.products where company_id is null and not coalesce(archived,false) and catalog_source_version='${SOURCE_VERSION}' and product_type='additive') <> 5 then raise exception 'TZ-243 additive postcheck failed'; end if;
  if exists (
    select product_type, private.normalize_catalog_identity_text_v1(manufacturer), private.normalize_catalog_identity_text_v1(coalesce(trade_name,name))
    from public.products where company_id is null and not coalesce(archived,false) and product_type in ('fertilizer','additive')
    group by 1,2,3 having count(*) > 1
  ) then raise exception 'TZ-243 duplicate live identity'; end if;
end
$postcheck$;

commit;
`;
}

async function authenticatedClient(envPath) {
  loadEnv(envPath);
  const url = process.env.A106_SUPABASE_URL || "";
  const anon = process.env.A106_SUPABASE_ANON_KEY || "";
  assert(url.includes(QA_REF), "QA Supabase URL is required");
  assert(anon, "QA anon key is required");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({
    email: process.env.A106_TEST_USER_A_EMAIL || "",
    password: process.env.A106_TEST_USER_A_PASSWORD || "",
  });
  if (error) throw error;
  return client;
}

async function fetchAll(client, table, columns = "*") {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
}

async function fetchOptionalAll(client, table, columns = "*") {
  try {
    return { table, rows: await fetchAll(client, table, columns), error: null };
  } catch (error) {
    return { table, rows: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function createBackup(client, rows, outputDir) {
  const [products, manufacturers, formulations, aliases, ...relationResults] = await Promise.all([
    fetchAll(client, "products"),
    fetchAll(client, "agrochem_manufacturers"),
    fetchAll(client, "agrochem_formulations"),
    fetchAll(client, "global_product_aliases"),
    fetchOptionalAll(client, "inventory_batches", "id,product_id"),
    fetchOptionalAll(client, "stock_ledger_entries", "id,product_id"),
    fetchOptionalAll(client, "operation_materials", "id,product_id"),
    fetchOptionalAll(client, "warehouse_request_items", "id,product_id"),
    fetchOptionalAll(client, "inventory_transactions", "id,product_id"),
    fetchOptionalAll(client, "crop_care_scheme_materials", "id,product_id"),
  ]);
  const sourceKeys = new Set(rows.map((row) => `${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.name)}`));
  const affectedProducts = products.filter((row) => row.company_id == null && sourceKeys.has(`${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.trade_name || row.name)}`));
  const affectedIds = new Set(affectedProducts.map((row) => row.id));
  const identityConflicts = [];
  for (const sourceRow of rows) {
    const key = `${normalizeIdentity(sourceRow.manufacturer)}|${normalizeIdentity(sourceRow.name)}`;
    const matches = affectedProducts.filter((row) => `${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.trade_name || row.name)}` === key);
    if (matches.length > 1) identityConflicts.push({ identity_key: key, match_count: matches.length, ids: matches.map((row) => row.id).join("|") });
  }
  assert(identityConflicts.length === 0, `live QA contains ${identityConflicts.length} ambiguous identities`);
  const relationCountsByProduct = new Map();
  for (const result of relationResults) {
    for (const row of result.rows) {
      const productId = String(row.product_id || "");
      if (!affectedIds.has(productId)) continue;
      const current = relationCountsByProduct.get(productId) || {};
      current[result.table] = (current[result.table] || 0) + 1;
      relationCountsByProduct.set(productId, current);
    }
  }
  for (const row of products.filter((item) => item.company_id != null && affectedIds.has(item.master_product_id))) {
    const current = relationCountsByProduct.get(row.master_product_id) || {};
    current.company_overrides = (current.company_overrides || 0) + 1;
    relationCountsByProduct.set(row.master_product_id, current);
  }

  const backup = {
    task: "TZ-243",
    project_ref: QA_REF,
    created_at: new Date().toISOString(),
    source_sha256: SOURCE_SHA256,
    affected_products: affectedProducts,
    affected_aliases: aliases.filter((row) => affectedIds.has(row.product_id)),
    affected_company_overrides: products.filter((row) => row.company_id != null && affectedIds.has(row.master_product_id)),
    affected_relation_counts: Object.fromEntries(relationCountsByProduct),
    relation_read_errors: relationResults.filter((result) => result.error).map((result) => ({ table: result.table, error: result.error })),
    manufacturers,
    formulations,
    baseline_counts: {
      all_products: products.length,
      global_products: products.filter((row) => row.company_id == null).length,
      global_fertilizers: products.filter((row) => row.company_id == null && row.product_type === "fertilizer").length,
      global_additives: products.filter((row) => row.company_id == null && row.product_type === "additive").length,
    },
  };
  fs.writeFileSync(path.join(outputDir, "qa-backup-before-import.json"), `${JSON.stringify(backup, null, 2)}\n`, "utf8");
  return { backup, identityConflicts };
}

function sqlJson(value) {
  return `$backup$${JSON.stringify(value).replace(/\$backup\$/g, "$ backup $")}$backup$::jsonb`;
}

function buildRollback(backup, categories, sourceRows) {
  const productColumns = backup.affected_products[0] ? Object.keys(backup.affected_products[0]).filter((key) => key !== "id") : [];
  const restoreAssignments = productColumns.map((column) => `${column}=b.${column}`).join(",\n  ");
  const previousManufacturerIds = new Set(backup.manufacturers.map((row) => row.id));
  const previousFormulationIds = new Set(backup.formulations.map((row) => row.id));
  const sourceManufacturers = [...new Set(sourceRows.map((row) => row.manufacturer).filter(Boolean))];
  const sourceFormulations = [...new Set(sourceRows.map((row) => row.formulation).filter(Boolean))];
  return `-- TZ-243 exact QA rollback preview. Review before execution.\n\nbegin;\n\ndelete from public.products where catalog_source_version=${sqlString(SOURCE_VERSION)} and catalog_source_created=true;\n\n${backup.affected_products.length ? `with backup_rows as (select * from jsonb_populate_recordset(null::public.products, ${sqlJson(backup.affected_products)}))\nupdate public.products p set\n  ${restoreAssignments}\nfrom backup_rows b where p.id=b.id;` : "-- No pre-existing source identities required restoration."}\n\ndelete from public.agrochem_manufacturers m\nwhere private.normalize_catalog_identity_text_v1(m.name) in (${sourceManufacturers.map((value) => `private.normalize_catalog_identity_text_v1(${sqlString(value)})`).join(",") || "null"})\n  and m.id not in (${[...previousManufacturerIds].map(sqlString).join(",") || "null"})\n  and not exists (select 1 from public.products p where p.manufacturer_id=m.id);\n\ndelete from public.agrochem_formulations f\nwhere private.normalize_catalog_identity_text_v1(f.name_ru) in (${sourceFormulations.map((value) => `private.normalize_catalog_identity_text_v1(${sqlString(value)})`).join(",") || "null"})\n  and f.id not in (${[...previousFormulationIds].map(sqlString).join(",") || "null"})\n  and not exists (select 1 from public.products p where p.formulation_id=f.id);\n\ndrop index if exists public.ux_products_global_fertilizer_additive_identity_v1;\ndrop index if exists public.idx_products_global_fertilizer_application;\ndrop index if exists public.idx_products_fertilizer_category_id;\n\ndrop policy if exists \"Global admins can delete global products\" on public.products;\ndrop policy if exists \"Global admins can update global products\" on public.products;\ndrop policy if exists \"Global admins can insert global products\" on public.products;\ncreate policy \"Users can create own products\" on public.products for insert to authenticated with check (user_id is null or auth.uid()=user_id);\n\nalter table public.products drop constraint if exists products_application_scope_check_v1;\nalter table public.products drop constraint if exists products_fertilizer_type_check_v3;\nalter table public.products add constraint products_fertilizer_type_check_v2 check (case when type='fertilizer' then fertilizer_type in ('nitrogen','phosphorus','potassium','npk','micronutrient','foliar','organic') else true end);\nalter table public.products drop constraint if exists products_fertilizer_category_id_fkey;\nalter table public.products drop column if exists catalog_source_created;\nalter table public.products drop column if exists catalog_source_row;\nalter table public.products drop column if exists catalog_source_checksum;\nalter table public.products drop column if exists catalog_source_version;\nalter table public.products drop column if exists catalog_category_slug;\nalter table public.products drop column if exists catalog_category_label;\nalter table public.products drop column if exists application_scope;\nalter table public.products drop column if exists fertilizer_category_id;\n\ndrop table if exists public.fertilizer_categories;\ndrop function if exists private.normalize_catalog_identity_text_v1(text);\n\ncommit;\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  assert(fs.existsSync(args.source), `source workbook not found: ${args.source}`);
  fs.mkdirSync(args.output, { recursive: true });
  const workbook = await loadWorkbook(args.source);
  const validation = validateSource(args.source, workbook);
  const rows = productSourceRows(workbook);
  const migration = buildMigration(workbook, rows);
  fs.writeFileSync(args.migration, migration, "utf8");

  const sourceExport = {
    task: "TZ-243",
    source: { path: args.source, size: fs.statSync(args.source).size, sha256: validation.sourceSha },
    counts: {
      audit: workbook.categoryAudit.rows.length,
      fertilizers: workbook.fertilizers.rows.length,
      additives: workbook.additives.rows.length,
      categories: workbook.categories.rows.length,
      applications: workbook.applications.rows.length,
      unresolved: workbook.categoryAudit.rows.filter((row) => !row["Решение"] || row["Решение"] === "REVIEW").length,
      duplicate_identities: validation.sourceConflicts.length,
    },
    categories: workbook.categories.rows,
    applications: workbook.applications.rows,
    products: rows,
  };
  fs.writeFileSync(path.join(args.output, "source-validation.json"), `${JSON.stringify(sourceExport, null, 2)}\n`, "utf8");
  writeCsv(path.join(args.output, "identity-conflicts.csv"), ["identity_key", "source_count", "live_count", "decision"], []);
  writeCsv(path.join(args.output, "import-preview.csv"), ["source_row", "product_type", "manufacturer", "trade_name", "category", "application_scope", "formulation", "unit", "decision"], rows.map((row) => ({
    source_row: row.sourceRow, product_type: row.productType, manufacturer: row.manufacturer, trade_name: row.name,
    category: row.categoryLabel, application_scope: row.applicationScope, formulation: row.formulation, unit: row.unit, decision: "PREFLIGHT_PENDING",
  })));

  let backupSummary = null;
  if (args.backup) {
    const client = await authenticatedClient(args.env);
    const { backup, identityConflicts } = await createBackup(client, rows, args.output);
    const existingKeys = new Set(backup.affected_products.map((row) => `${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.trade_name || row.name)}`));
    const preview = rows.map((row) => ({
      source_row: row.sourceRow, product_type: row.productType, manufacturer: row.manufacturer, trade_name: row.name,
      category: row.categoryLabel, application_scope: row.applicationScope, formulation: row.formulation, unit: row.unit,
      decision: existingKeys.has(`${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.name)}`) ? "UPDATE_EXISTING_ID" : "INSERT_NEW",
    }));
    writeCsv(path.join(args.output, "import-preview.csv"), Object.keys(preview[0]), preview);
    writeCsv(path.join(args.output, "identity-conflicts.csv"), ["identity_key", "match_count", "ids"], identityConflicts);
    fs.writeFileSync(path.join(args.output, "rollback-preview.sql"), buildRollback(backup, workbook.categories.rows, rows), "utf8");
    const existingByKey = new Map(backup.affected_products.map((row) => [`${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.trade_name || row.name)}`, row]));
    const diffRows = rows.map((row) => {
      const existing = existingByKey.get(`${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.name)}`);
      const categoryChanged = Boolean(existing && row.sourceKind === "fertilizer" && normalizeIdentity(existing.fertilizer_type) !== normalizeIdentity(row.categorySlug));
      return {
        source_brand: row.manufacturer,
        source_trade_name: row.name,
        normalized_brand: normalizeIdentity(row.manufacturer),
        normalized_trade_name: normalizeIdentity(row.name),
        existing_product_id: existing?.id || "",
        existing_product_type: existing?.product_type || "",
        existing_category: existing?.fertilizer_type || existing?.pesticide_category || existing?.category || "",
        source_category: row.categorySlug,
        relation_counts: existing ? JSON.stringify(backup.affected_relation_counts[existing.id] || {}) : "{}",
        decision: existing ? (categoryChanged ? "UPDATE_CATEGORY" : "UPDATE_APPLICATION") : "ADD_NEW",
        reason: existing
          ? `Exact manufacturer + normalized trade_name; ID preserved; application_scope ${existing.application_scope ? "verified" : "will be added"}`
          : "No exact manufacturer + normalized trade_name match in QA",
      };
    });
    const diffHeaders = ["source_brand", "source_trade_name", "normalized_brand", "normalized_trade_name", "existing_product_id", "existing_product_type", "existing_category", "source_category", "relation_counts", "decision", "reason"];
    writeCsv(path.join(args.output, "fertilizers-live-diff.csv"), diffHeaders, diffRows.filter((row) => rows.find((source) => source.name === row.source_trade_name && source.manufacturer === row.source_brand)?.sourceKind === "fertilizer"));
    writeCsv(path.join(args.output, "additives-live-diff.csv"), diffHeaders, diffRows.filter((row) => rows.find((source) => source.name === row.source_trade_name && source.manufacturer === row.source_brand)?.sourceKind === "additive"));
    backupSummary = { existing_matches: backup.affected_products.length, insert_new: rows.length - backup.affected_products.length, identity_conflicts: identityConflicts.length };
    await client.auth.signOut();
  }

  const manifestTargets = fs.readdirSync(args.output).filter((name) => name !== "manifest.sha256").sort();
  const manifest = manifestTargets.map((name) => `${sha256File(path.join(args.output, name))}  ${name}`).join("\n");
  fs.writeFileSync(path.join(args.output, "manifest.sha256"), `${manifest}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", project_ref: QA_REF, source_sha256: validation.sourceSha, counts: sourceExport.counts, backup: backupSummary, migration: args.migration, output: args.output }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
