import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GRAIN_MIX_MAX_COMPONENTS,
  GRAIN_MIX_MIN_COMPONENTS,
  grainMixComponentTotalKg,
  grainMixDisplayName,
  grainMixFingerprint,
  grainMixTotalKg,
  validateGrainMixComponents,
  type GrainMixComponent,
} from "../lib/crop-structure/grain-mix";
import {
  LAND_USE_TYPES,
  formatCropStructureIdentity,
  isCropMixLandUse,
  normalizeCropStructureSeedAttributes,
  validateAndNormalizeCropStructureRows,
} from "../lib/crop-structure/fallow";
import { summarizeCropStructureChanges } from "../lib/crop-structure/editor";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });

const oat: GrainMixComponent = { crop_id: "crop-oat", variety_id: "var-oat", reproduction_id: "rep-r1", seed_rate_kg_ha: 70 };
const pea: GrainMixComponent = { crop_id: "crop-pea", variety_id: "var-pea", reproduction_id: "rep-elite", seed_rate_kg_ha: 50 };
const crops = new Map([
  ["crop-oat", { id: "crop-oat", name_ru: "Овёс" }],
  ["crop-pea", { id: "crop-pea", name_ru: "Горох" }],
  ["crop-wheat", { id: "crop-wheat", name_ru: "Пшеница" }],
  ["crop-barley", { id: "crop-barley", name_ru: "Ячмень" }],
]);
const varieties = new Map([
  ["var-oat", { id: "var-oat", crop_id: "crop-oat" }],
  ["var-pea", { id: "var-pea", crop_id: "crop-pea" }],
]);
const validate = (components: GrainMixComponent[]) => validateGrainMixComponents({ components, cropsById: crops, varietiesById: varieties });

check("01 minimum is two", () => assert.equal(GRAIN_MIX_MIN_COMPONENTS, 2));
check("02 maximum is ten", () => assert.equal(GRAIN_MIX_MAX_COMPONENTS, 10));
check("03 one component rejected", () => assert.equal(validate([oat]).ok, false));
check("04 eleven components rejected", () => assert.equal(validate(Array.from({ length: 11 }, (_, i) => ({ ...oat, variety_id: `var-${i}` }))).ok, false));
check("05 crop required", () => assert.equal(validate([{ ...oat, crop_id: null }, pea]).ok, false));
check("06 variety required", () => assert.equal(validate([{ ...oat, variety_id: null }, pea]).ok, false));
check("07 reproduction required", () => assert.equal(validate([{ ...oat, reproduction_id: null }, pea]).ok, false));
check("08 zero rate rejected", () => assert.equal(validate([{ ...oat, seed_rate_kg_ha: 0 }, pea]).ok, false));
check("09 negative rate rejected", () => assert.equal(validate([{ ...oat, seed_rate_kg_ha: -1 }, pea]).ok, false));
check("10 exact duplicate rejected", () => assert.equal(validate([oat, { ...oat }]).ok, false));
check("11 wrong crop variety rejected", () => assert.equal(validate([{ ...oat, crop_id: "crop-pea" }, pea]).ok, false));
check("12 unavailable crop rejected", () => assert.equal(validate([{ ...oat, crop_id: "crop-missing" }, pea]).ok, false));
check("13 valid two-component mix", () => assert.equal(validate([oat, pea]).ok, true));
check("14 first sort order normalized", () => assert.equal(validate([oat, pea]).components[0].sort_order, 1));
check("15 second sort order normalized", () => assert.equal(validate([oat, pea]).components[1].sort_order, 2));
check("16 numeric rate coerced", () => assert.equal(validate([{ ...oat, seed_rate_kg_ha: "70" as unknown as number }, pea]).components[0].seed_rate_kg_ha, 70));
check("17 oat total 7000 kg", () => assert.equal(grainMixComponentTotalKg(100, 70), 7000));
check("18 pea total 5000 kg", () => assert.equal(grainMixComponentTotalKg(100, 50), 5000));
check("19 combined total 12000 kg", () => assert.equal(grainMixTotalKg(100, [oat, pea]), 12000));
check("20 null rate totals zero", () => assert.equal(grainMixComponentTotalKg(100, null), 0));
check("21 decimal calculation preserved", () => assert.equal(grainMixComponentTotalKg(12.5, 1.25), 15.625));
check("22 empty display name", () => assert.equal(grainMixDisplayName([], crops), "Зерносмесь"));
check("23 crop display name", () => assert.equal(grainMixDisplayName([oat, pea], crops), "Зерносмесь: Овёс + Горох"));
check("24 duplicate crop label collapsed", () => assert.equal(grainMixDisplayName([oat, { ...oat, variety_id: "other" }], crops), "Зерносмесь: Овёс"));
check("25 display is capped", () => assert.match(grainMixDisplayName([oat, pea, { ...oat, crop_id: "crop-wheat" }, { ...pea, crop_id: "crop-barley" }], crops), /ещё 1/));
check("26 fingerprint stable", () => assert.equal(grainMixFingerprint([oat, pea]), grainMixFingerprint([{ ...oat }, { ...pea }])));
check("27 fingerprint order sensitive", () => assert.notEqual(grainMixFingerprint([oat, pea]), grainMixFingerprint([pea, oat])));
check("28 fingerprint rate sensitive", () => assert.notEqual(grainMixFingerprint([oat, pea]), grainMixFingerprint([{ ...oat, seed_rate_kg_ha: 71 }, pea])));
check("29 three land-use types", () => assert.deepEqual(LAND_USE_TYPES, ["crop", "crop_mix", "fallow"]));
check("30 crop mix predicate true", () => assert.equal(isCropMixLandUse("crop_mix"), true));
check("31 crop predicate is not mix", () => assert.equal(isCropMixLandUse("crop"), false));
check("32 crop mix identity label", () => assert.equal(formatCropStructureIdentity({ landUseType: "crop_mix" }), "Зерносмесь"));
check("33 mix normalization clears root identity", () => assert.equal(normalizeCropStructureSeedAttributes({ land_use_type: "crop_mix" as const, crop_id: "x", variety_id: "y", reproduction_id: "z", area: 100 }, null).crop_id, null));
check("34 mix normalization clears spacing", () => assert.equal(normalizeCropStructureSeedAttributes({ land_use_type: "crop_mix" as const, crop_id: null, variety_id: null, reproduction_id: null, area: 100, row_spacing_m: 0.15, seed_spacing_cm: 3 }, null).row_spacing_m, null));
check("35 mix root identity rejected", () => assert.equal(validateAndNormalizeCropStructureRows({ rows: [{ land_use_type: "crop_mix" as const, crop_id: "x", variety_id: null, reproduction_id: null, area: 100 }], cropsById: new Map(), fieldArea: 100 }).ok, false));
check("36 area over field rejected", () => assert.equal(validateAndNormalizeCropStructureRows({ rows: [{ land_use_type: "crop_mix" as const, crop_id: null, variety_id: null, reproduction_id: null, area: 101 }], cropsById: new Map(), fieldArea: 100 }).ok, false));
check("37 valid mix root accepted", () => assert.equal(validateAndNormalizeCropStructureRows({ rows: [{ land_use_type: "crop_mix" as const, crop_id: null, variety_id: null, reproduction_id: null, area: 100 }], cropsById: new Map(), fieldArea: 100 }).ok, true));
check("38 ordinary crop accepts optional seed identity", () => assert.equal(validateAndNormalizeCropStructureRows({ rows: [{ land_use_type: "crop" as const, crop_id: "crop-oat", variety_id: null, reproduction_id: null, area: 100 }], cropsById: crops, fieldArea: 100 }).ok, true));
check("39 ordinary wrong variety rejected", () => assert.equal(validateAndNormalizeCropStructureRows({ rows: [{ land_use_type: "crop" as const, crop_id: "crop-oat", variety_id: "var-pea", reproduction_id: "rep", area: 100 }], cropsById: crops, varietiesById: varieties, fieldArea: 100 }).ok, false));
check("40 change summary detects add", () => assert.equal(summarizeCropStructureChanges([], [{ land_use_type: "crop_mix", crop_id: null, variety_id: null, reproduction_id: null, area: 100, mix_components: [oat, pea] }]).added, 1));
check("41 change summary detects rate edit", () => assert.equal(summarizeCropStructureChanges([{ id: "row", land_use_type: "crop_mix", crop_id: null, variety_id: null, reproduction_id: null, area: 100, mix_components: [oat, pea] }], [{ id: "row", land_use_type: "crop_mix", crop_id: null, variety_id: null, reproduction_id: null, area: 100, mix_components: [{ ...oat, seed_rate_kg_ha: 71 }, pea] }]).updated, 1));
check("42 change summary detects delete", () => assert.equal(summarizeCropStructureChanges([{ id: "row", land_use_type: "crop_mix", crop_id: null, variety_id: null, reproduction_id: null, area: 100, mix_components: [oat, pea] }], []).deleted, 1));
check("43 unchanged mix is stable", () => assert.deepEqual(summarizeCropStructureChanges([{ id: "row", land_use_type: "crop_mix", crop_id: null, variety_id: null, reproduction_id: null, area: 100, mix_components: [oat, pea] }], [{ id: "row", land_use_type: "crop_mix", crop_id: null, variety_id: null, reproduction_id: null, area: 100, mix_components: [{ ...oat }, { ...pea }] }]), { added: 0, updated: 0, deleted: 0 }));
check("44 SQL enforces exact request identity", () => assert.match(readFileSync(resolve("supabase/migrations/20260801143322_grain_mix_v1.sql"), "utf8"), /validate_crop_mix_request_item_identity_v1/));
check("45 operation route uses atomic mix RPC", () => assert.match(readFileSync(resolve("app/api/operations/route.ts"), "utf8"), /create_crop_mix_operation_plan_atomic_v1/));

for (const item of checks) {
  item.run();
  console.log(`PASS ${item.name}`);
}
assert.equal(checks.length, 45);
console.log(`TZ-242 automated checks: ${checks.length}/45 PASS`);
