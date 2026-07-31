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

const migrationPath = join(process.cwd(), "supabase", "migrations", "20260731144242_crop_structure_fallow_operations_v1.sql");
const migration = readFileSync(migrationPath, "utf8");
const snowRetentionMigrationPath = join(process.cwd(), "supabase", "migrations", "20260731151000_operation_snow_retention_v1.sql");
const snowRetentionMigration = readFileSync(snowRetentionMigrationPath, "utf8");
check("migration adds land_use_type", () => assert.match(migration, /ADD COLUMN IF NOT EXISTS land_use_type/));
check("migration enforces fallow null identity", () => assert.match(migration, /land_use_type = 'fallow'[\s\S]*crop_id IS NULL/));
check("migration derives target scope", () => assert.match(migration, /GENERATED ALWAYS AS/));
check("migration does not delete crop data", () => assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:crops|crop_structure)/i));
check("snow retention migration is idempotent", () => assert.match(snowRetentionMigration, /ON CONFLICT \(slug\) DO UPDATE/));
check("snow retention does not require product", () => assert.match(snowRetentionMigration, /'snow_retention'[\s\S]*false,[\s\S]*false,[\s\S]*true/));

async function verifyMigrationReplay() {
  const db = new PGlite();
  await db.exec(`
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
      crop_structure_id uuid
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
  await db.close();
  process.stdout.write(`TZ-240 automated contract checks: ${passed}/${passed} PASS\n`);
}

verifyMigrationReplay().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
