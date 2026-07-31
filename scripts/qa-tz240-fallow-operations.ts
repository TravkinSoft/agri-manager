import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  LAND_USE_TYPES,
  formatCropStructureIdentity,
  getCropStructureLandUseType,
  normalizeCropStructureSeedAttributes,
  validateAndNormalizeCropStructureRows,
} from "../lib/crop-structure/fallow";
import {
  OPERATION_SUBTYPE_DEFINITIONS,
  getOperationCropRequirement,
  isCropIndependentFieldOperation,
} from "../lib/operations/operation-engine";
import { summarizeLandUseAreas } from "../lib/crop-structure/analytics";
import {
  hasCropStructureChanges,
  sortReproductionsAgronomically,
  summarizeCropStructureChanges,
} from "../lib/crop-structure/editor";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  process.stdout.write(`PASS ${passed.toString().padStart(2, "0")} ${name}\n`);
}

const cropId = "00000000-0000-4000-8000-000000000001";
const varietyId = "00000000-0000-4000-8000-000000000002";
const reproductionId = "00000000-0000-4000-8000-000000000003";
const otherCropId = "00000000-0000-4000-8000-000000000004";
const crops = new Map([
  [cropId, { id: cropId, slug: "wheat" }],
  [otherCropId, { id: otherCropId, slug: "barley" }],
]);
const varieties = new Map([[varietyId, { id: varietyId, crop_id: cropId }]]);
type TestRow = {
  land_use_type: "crop" | "fallow";
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  area: number;
};
const validCropRow: TestRow = {
  land_use_type: "crop" as const,
  crop_id: cropId,
  variety_id: varietyId,
  reproduction_id: reproductionId,
  area: 80,
};
const validFallowRow: TestRow = {
  land_use_type: "fallow" as const,
  crop_id: null,
  variety_id: null,
  reproduction_id: null,
  area: 20,
};
const validate = (rows: TestRow[], fieldArea = 100) =>
  validateAndNormalizeCropStructureRows({ rows, cropsById: crops, varietiesById: varieties, fieldArea });

check("land use enum is canonical", () => assert.deepEqual(LAND_USE_TYPES, ["crop", "fallow"]));
check("crop land use stays crop", () => assert.equal(getCropStructureLandUseType(validCropRow), "crop"));
check("fallow land use stays fallow", () => assert.equal(getCropStructureLandUseType(validFallowRow), "fallow"));
check("fallow normalization clears identity", () => {
  const row = normalizeCropStructureSeedAttributes({ ...validCropRow, land_use_type: "fallow" as const }, crops.get(cropId));
  assert.deepEqual([row.crop_id, row.variety_id, row.reproduction_id], [null, null, null]);
});
check("fallow with crop identity is rejected", () => {
  const result = validate([{ ...validCropRow, land_use_type: "fallow" }]);
  assert.equal(result.ok, false);
});
check("crop without crop id is rejected", () => {
  const result = validate([{ ...validCropRow, crop_id: null }]);
  assert.equal(result.ok, false);
});
check("crop without variety is rejected", () => {
  const result = validate([{ ...validCropRow, variety_id: null }]);
  assert.equal(result.ok, false);
});
check("crop without reproduction is rejected", () => {
  const result = validate([{ ...validCropRow, reproduction_id: null }]);
  assert.equal(result.ok, false);
});
check("valid crop row passes", () => assert.equal(validate([validCropRow]).ok, true));
check("valid fallow row passes", () => assert.equal(validate([validFallowRow]).ok, true));
check("crop and fallow can share one field", () => assert.equal(validate([validCropRow, validFallowRow]).ok, true));
check("variety crop mismatch is rejected", () => {
  const result = validate([{ ...validCropRow, crop_id: otherCropId }]);
  assert.equal(result.ok, false);
});
check("duplicate crop identity is rejected", () => {
  const result = validate([{ ...validCropRow, area: 40 }, { ...validCropRow, area: 40 }]);
  assert.equal(result.ok, false);
});
check("zero area is rejected", () => assert.equal(validate([{ ...validFallowRow, area: 0 }]).ok, false));
check("negative area is rejected", () => assert.equal(validate([{ ...validFallowRow, area: -1 }]).ok, false));
check("field area overflow is rejected", () => assert.equal(validate([validCropRow, { ...validFallowRow, area: 21 }]).ok, false));
check("exact field area is accepted", () => assert.equal(validate([validCropRow, validFallowRow], 100).ok, true));
check("fallow has a human label", () => assert.equal(formatCropStructureIdentity({ landUseType: "fallow" }), "Пар"));
check("crop identity has a human label", () => {
  assert.equal(formatCropStructureIdentity({ landUseType: "crop", cropName: "Пшеница", varietyName: "Айна" }), "Пшеница / Айна");
});
check("plowing does not require crop", () => assert.equal(getOperationCropRequirement({ typeSlug: "plowing" }), "crop_not_required"));
check("snow retention does not require crop", () => assert.equal(getOperationCropRequirement({ typeSlug: "snow_retention" }), "crop_not_required"));
check("seeding still requires crop", () => assert.equal(getOperationCropRequirement({ typeSlug: "seeding" }), "crop_required"));
check("harvesting still requires crop", () => assert.equal(getOperationCropRequirement({ typeSlug: "grain_harvesting" }), "crop_required"));
check("only approved V1 works are crop independent", () => {
  const slugs = OPERATION_SUBTYPE_DEFINITIONS
    .filter((item) => isCropIndependentFieldOperation({ categorySlug: item.categorySlug, typeSlug: item.slug }))
    .map((item) => item.slug)
    .sort();
  assert.deepEqual(slugs, ["plowing", "snow_retention"]);
});
check("analytics separates crop and fallow areas", () => {
  assert.deepEqual(summarizeLandUseAreas([validCropRow, validFallowRow]), { cropArea: 80, fallowArea: 20 });
});
check("reproductions follow agronomic multiplication order", () => {
  const rows = ["РС1", "ЭС", "ОС", "РС2", "СЭ", "ССЭ"].map((code) => ({ code }));
  assert.deepEqual(sortReproductionsAgronomically(rows).map((row) => row.code), ["ОС", "ССЭ", "СЭ", "ЭС", "РС1", "РС2"]);
});
check("structure editor detects add update and delete separately", () => {
  const base = {
    land_use_type: "crop" as const,
    crop_id: cropId,
    variety_id: varietyId,
    reproduction_id: reproductionId,
    notes: "",
    area: 50,
  };
  const previous = [{ ...base, id: "row-1" }, { ...base, id: "row-2" }];
  const next = [{ ...base, id: "row-1", area: 60 }, { ...base, area: 40 }];
  assert.deepEqual(summarizeCropStructureChanges(previous, next), { added: 1, updated: 1, deleted: 1 });
});
check("unchanged structure does not request save", () => {
  const rows = [{
    id: "row-1",
    land_use_type: "fallow" as const,
    crop_id: null,
    variety_id: null,
    reproduction_id: null,
    notes: "Чистый пар",
    area: 20,
  }];
  assert.equal(hasCropStructureChanges(summarizeCropStructureChanges(rows, rows.map((row) => ({ ...row })))), false);
});

const migrationPath = join(process.cwd(), "supabase", "migrations", "20260731144242_crop_structure_fallow_operations_v1.sql");
const migration = readFileSync(migrationPath, "utf8");
const snowRetentionMigrationPath = join(process.cwd(), "supabase", "migrations", "20260731151000_operation_snow_retention_v1.sql");
const snowRetentionMigration = readFileSync(snowRetentionMigrationPath, "utf8");
const wholeFieldHistoryMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260731164000_operation_whole_field_history_v1.sql"
);
const wholeFieldHistoryMigration = readFileSync(wholeFieldHistoryMigrationPath, "utf8");
const operationRoute = readFileSync(join(process.cwd(), "app", "api", "operations", "route.ts"), "utf8");
const cropStructurePage = readFileSync(join(process.cwd(), "app", "(dashboard)", "crop-structure", "page.tsx"), "utf8");
check("migration adds land_use_type", () => assert.match(migration, /ADD COLUMN IF NOT EXISTS land_use_type/));
check("migration enforces fallow null identity", () => assert.match(migration, /land_use_type = 'fallow'[\s\S]*crop_id IS NULL/));
check("migration derives target scope", () => assert.match(migration, /GENERATED ALWAYS AS/));
check("migration does not delete crop data", () => assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:crops|crop_structure)/i));
check("snow retention migration is idempotent", () => assert.match(snowRetentionMigration, /ON CONFLICT \(slug\) DO UPDATE/));
check("snow retention does not require product", () => assert.match(snowRetentionMigration, /'snow_retention'[\s\S]*false,[\s\S]*false,[\s\S]*true/));
check("closed season mutation remains blocked", () => assert.match(operationRoute, /assertSeasonWritableForMutation/));
check("operation create remains company scoped", () => assert.match(operationRoute, /crop_structure_id does not belong to this company/));
check("crop operations cannot target fallow", () => assert.match(operationRoute, /Crop operations cannot target fallow land/));
check("whole-field history is limited to crop-independent V1 works", () => {
  assert.match(wholeFieldHistoryMigration, /'plowing', 'snow_retention'/);
  assert.match(wholeFieldHistoryMigration, /crop_structure_id is null/i);
});
check("whole-field history repair is idempotent", () => {
  assert.match(wholeFieldHistoryMigration, /where not exists/i);
  assert.doesNotMatch(wholeFieldHistoryMigration, /delete\s+from/i);
});
check("field dossier reads only persisted structure rows", () => {
  assert.doesNotMatch(cropStructurePage, /const rows = draftRows\.length \? draftRows : allocByField/);
});
check("structure save requires explicit confirmation", () => {
  assert.match(cropStructurePage, /Подтвердить изменения структуры\?/);
  assert.match(cropStructurePage, /Подтвердить и сохранить/);
});
check("missing season produces a visible save error", () => {
  assert.match(cropStructurePage, /У этой компании нет активного сезона/);
  assert.match(cropStructurePage, /setEditorValidationError\(message\)/);
});

async function verifyMigrationReplay() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create table public.crop_structure (
      id uuid primary key,
      company_id uuid not null,
      season_id uuid not null,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      archived boolean not null default false
    );
    create table public.operations (
      id uuid primary key,
      company_id uuid not null,
      field_id uuid,
      crop_structure_id uuid,
      operation_type text,
      operation_category_slug text,
      operation_type_slug text,
      operation_config jsonb not null default '{}'::jsonb,
      status text,
      work_status text,
      operation_status text,
      planned_area_ha numeric,
      completed_area_ha numeric,
      specialist_comment text
    );
    create table public.seasons (
      id uuid primary key,
      company_id uuid not null,
      year integer not null,
      archived boolean not null default false
    );
    create table public.field_history_entries (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      field_id uuid,
      season_id uuid,
      season_year integer,
      history_value text,
      original_raw_value text,
      source text,
      notes text,
      operation_id uuid,
      actual_completed_area_ha numeric,
      material_facts jsonb,
      material_reconciliation_status text
    );
    create table public.operation_types (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      category_slug text not null,
      name_ru text not null,
      name_en text,
      requires_field boolean not null default true,
      requires_machine boolean not null default false,
      requires_product boolean not null default false,
      affects_inventory boolean not null default false,
      affects_field_history boolean not null default true,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    insert into public.crop_structure (id, company_id, season_id, crop_id)
    values (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004'
    );
  `);
  await db.exec(migration);
  await db.exec(snowRetentionMigration);
  check("first isolated migration apply succeeds", () => assert.ok(true));
  const first = await db.query<{ land_use_type: string }>("select land_use_type from public.crop_structure");
  check("existing rows are classified as crop", () => assert.equal(first.rows[0]?.land_use_type, "crop"));
  await db.exec(migration);
  await db.exec(snowRetentionMigration);
  check("second isolated migration apply succeeds", () => assert.ok(true));
  const operationTypes = await db.query<{ slug: string; requires_product: boolean }>(
    "select slug,requires_product from public.operation_types where slug = 'snow_retention'"
  );
  check("snow retention row exists once", () => assert.equal(operationTypes.rows.length, 1));
  check("snow retention row is material independent", () => assert.equal(operationTypes.rows[0]?.requires_product, false));
  await assert.rejects(
    db.exec(`insert into public.crop_structure (id,company_id,season_id,land_use_type,crop_id)
      values ('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','fallow','10000000-0000-4000-8000-000000000004')`)
  );
  check("database constraint rejects fallow crop identity", () => assert.ok(true));

  await db.exec(`
    insert into public.seasons (id, company_id, year)
    values ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002',2026);
    insert into public.operations (
      id,company_id,field_id,crop_structure_id,operation_type,operation_type_slug,
      operation_category_slug,operation_config,status,work_status,operation_status,
      planned_area_ha,completed_area_ha,specialist_comment
    ) values (
      '10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000012',null,'Вспашка','plowing','soil_preparation',
      '{"season_id":"10000000-0000-4000-8000-000000000010"}'::jsonb,
      'completed','completed','completed',20,20,'Изолированный тест'
    );
  `);
  await db.exec(wholeFieldHistoryMigration);
  const repairedHistory = await db.query<{ history_value: string }>(
    "select history_value from public.field_history_entries where operation_id='10000000-0000-4000-8000-000000000011'"
  );
  check("whole-field completed operation is backfilled into history", () => {
    assert.equal(repairedHistory.rows[0]?.history_value, "Operation completed: Вспашка");
  });

  await db.exec(`
    insert into public.operations (
      id,company_id,field_id,crop_structure_id,operation_type,operation_type_slug,
      operation_category_slug,operation_config,status,work_status,operation_status,
      planned_area_ha,completed_area_ha,specialist_comment
    ) values (
      '10000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000012',null,'Снегозадержание','snow_retention','soil_preparation',
      '{"season_id":"10000000-0000-4000-8000-000000000010"}'::jsonb,
      'planned','active','planned',20,0,null
    );
    update public.operations
    set status='completed',work_status='completed',operation_status='completed',
        completed_area_ha=20,specialist_comment='Изолированный тест'
    where id='10000000-0000-4000-8000-000000000013';
  `);
  const triggeredHistory = await db.query<{ history_value: string }>(
    "select history_value from public.field_history_entries where operation_id='10000000-0000-4000-8000-000000000013'"
  );
  check("whole-field completion trigger records human history", () => {
    assert.equal(triggeredHistory.rows[0]?.history_value, "Operation completed: Снегозадержание");
  });
  await db.exec(`
    update public.operations set completed_area_ha=20
    where id='10000000-0000-4000-8000-000000000013';
  `);
  const historyCount = await db.query<{ count: number }>(
    "select count(*)::int as count from public.field_history_entries where operation_id='10000000-0000-4000-8000-000000000013'"
  );
  check("whole-field history trigger does not duplicate entries", () => assert.equal(historyCount.rows[0]?.count, 1));
  await db.close();
  process.stdout.write(`TZ-240 automated contract checks: ${passed}/${passed} PASS\n`);
}

verifyMigrationReplay().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
