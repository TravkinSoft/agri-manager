import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatCropStructureIdentity,
  normalizeCropStructureSeedAttributes,
  validateAndNormalizeCropStructureRows,
} from "../lib/crop-structure/fallow";
import { agronomicReproductionRank, compactReproductionLabel } from "../lib/crop-structure/editor";
import { formatCropIdentity, formatVarietyReproduction } from "../lib/operations/crop-identity";

type Row = {
  land_use_type: "crop" | "crop_mix" | "fallow";
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  area: number | null;
};

const crops = new Map([
  ["corn", { id: "corn", slug: "corn" }],
  ["wheat", { id: "wheat", slug: "wheat" }],
]);
const varieties = new Map([
  ["rodnik", { id: "rodnik", crop_id: "corn" }],
  ["lamis", { id: "lamis", crop_id: "wheat" }],
]);
const validate = (rows: Row[], fieldArea: number) =>
  validateAndNormalizeCropStructureRows({ rows, cropsById: crops, varietiesById: varieties, fieldArea });

const checks: Array<[string, () => void]> = [
  ["fallow 286 ha saves without seed identity", () => {
    const result = validate([{ land_use_type: "fallow", crop_id: null, variety_id: null, reproduction_id: null, area: 286 }], 286);
    assert.equal(result.ok, true);
  }],
  ["corn Rodnik 25 ha saves without reproduction", () => {
    const result = validate([{ land_use_type: "crop", crop_id: "corn", variety_id: "rodnik", reproduction_id: null, area: 25 }], 25);
    assert.equal(result.ok, true);
  }],
  ["wheat Lamis saves without reproduction", () => {
    const result = validate([{ land_use_type: "crop", crop_id: "wheat", variety_id: "lamis", reproduction_id: null, area: 10 }], 10);
    assert.equal(result.ok, true);
  }],
  ["crop saves without variety and reproduction", () => {
    const result = validate([{ land_use_type: "crop", crop_id: "corn", variety_id: null, reproduction_id: null, area: 25 }], 25);
    assert.equal(result.ok, true);
  }],
  ["missing crop uses the canonical validation message", () => {
    const result = validate([{ land_use_type: "crop", crop_id: null, variety_id: null, reproduction_id: null, area: 25 }], 25);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, "Укажите культуру и площадь.");
  }],
  ["selected variety still has to belong to crop", () => {
    const result = validate([{ land_use_type: "crop", crop_id: "wheat", variety_id: "rodnik", reproduction_id: null, area: 10 }], 10);
    assert.equal(result.ok, false);
  }],
  ["normalization preserves existing seed identity", () => {
    const row: Row = { land_use_type: "crop", crop_id: "wheat", variety_id: "lamis", reproduction_id: "r1", area: 10 };
    assert.deepEqual(normalizeCropStructureSeedAttributes(row, crops.get("wheat")), row);
  }],
  ["fallow normalization removes seed identity", () => {
    const row: Row = { land_use_type: "fallow", crop_id: "wheat", variety_id: "lamis", reproduction_id: "r1", area: 286 };
    const normalized = normalizeCropStructureSeedAttributes(row, crops.get("wheat"));
    assert.deepEqual([normalized.crop_id, normalized.variety_id, normalized.reproduction_id], [null, null, null]);
  }],
  ["missing identity parts are omitted from structure labels", () => {
    assert.equal(formatCropStructureIdentity({ landUseType: "crop", cropName: "Кукуруза" }), "Кукуруза");
  }],
  ["missing identity parts are omitted from operation labels", () => {
    assert.equal(formatCropIdentity({ cropName: "Кукуруза" }), "Кукуруза");
    assert.equal(formatVarietyReproduction({ varietyName: "Родник" }), "Родник");
  }],
  ["F1 has canonical rank and compact label", () => {
    const f1 = { code: "F1", name: "F1", level_order: 90 };
    assert.equal(agronomicReproductionRank(f1), 90);
    assert.equal(compactReproductionLabel(f1), "F1");
  }],
];

const pageSource = readFileSync(resolve("app/(dashboard)/crop-structure/page.tsx"), "utf8");
const routeSource = readFileSync(resolve("app/api/crop-structure/fields/[id]/route.ts"), "utf8");
const migrationSource = readFileSync(resolve("supabase/migrations/20260817215725_crop_structure_optional_seed_identity.sql"), "utf8");
const ordinaryEditorSource = pageSource.slice(
  pageSource.indexOf("{row.crop_id && vars.length > 0 ? ("),
  pageSource.indexOf("{isCropMixRow ? ("),
);

checks.push(
  ["ordinary UI labels are optional", () => {
    assert.match(ordinaryEditorSource, />Сорт<\/Label>/);
    assert.match(ordinaryEditorSource, />Репродукция \/ поколение<\/Label>/);
    assert.doesNotMatch(ordinaryEditorSource, />Сорт \*<\/Label>/);
    assert.doesNotMatch(ordinaryEditorSource, />Репродукция \/ поколение \*<\/Label>/);
  }],
  ["ordinary variety field is hidden when no options exist", () => assert.match(pageSource, /row\.crop_id && vars\.length > 0/)],
  ["closed season remains read only", () => assert.match(routeSource, /Closed season is read-only/)],
  ["migration adds canonical F1 without generated hardcoded id", () => {
    assert.match(migrationSource, /insert into public\.seed_reproductions/);
    assert.match(migrationSource, /'F1 Hybrid'/);
    assert.doesNotMatch(migrationSource, /seed_reproductions[\s\S]{0,80}'[0-9a-f]{8}-[0-9a-f-]{27,}'/i);
  }],
  ["RPC requires crop but keeps variety and reproduction optional", () => {
    assert.match(migrationSource, /if nullif\(v_row ->> 'crop_id', ''\) is null then/);
    assert.match(migrationSource, /if nullif\(v_row ->> 'variety_id', ''\) is not null and not exists/);
    assert.doesNotMatch(migrationSource, /Crop row requires crop, variety and reproduction/);
  }],
  ["grain mix identity remains strict", () => assert.match(migrationSource, /Every crop mix component requires crop, variety, reproduction and positive rate/)],
  ["migration does not rewrite crop structure business rows", () => assert.doesNotMatch(migrationSource, /update\s+public\.crop_structure\s+set/i)],
  ["migration never derives F1 from food-purpose notes", () => assert.doesNotMatch(migrationSource, /продовольствен/i)],
);

for (const [name, run] of checks) {
  run();
  console.log(`PASS ${name}`);
}

console.log(`Crop structure optional seed identity: ${checks.length}/${checks.length} PASS`);
