import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FIELD_MAP_SKIP_DECISION,
  FIELD_MAP_UNLINKED_DECISION,
  buildFieldMapConfirmOverrides,
  resolveFieldMapDecision,
  summarizeFieldMapReview,
  type FieldMapMatchDecisions,
} from "../lib/fields-map/import-review";
import type { FieldMapPreviewMatch, GeoJsonAreaGeometry } from "../lib/types/fields-map";

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertions += 1;
};
const equal = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
};
const fieldA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fieldB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const geometry: GeoJsonAreaGeometry = {
  type: "MultiPolygon",
  coordinates: [
    [
      [[69, 54], [69.1, 54], [69.1, 54.1], [69, 54.1], [69, 54]],
      [[69.02, 54.02], [69.02, 54.03], [69.03, 54.03], [69.03, 54.02], [69.02, 54.02]],
    ],
    [[[70, 54], [70.1, 54], [70.1, 54.1], [70, 54]]],
  ],
};
const row = (overrides: Partial<FieldMapPreviewMatch> = {}): FieldMapPreviewMatch => ({
  polygon_id: "source-1",
  polygon_name: "Исходный контур № 1 / без хозяйственного поля",
  area_ha: 25,
  geometry,
  match_status: "not_found",
  match_stage: "unmatched",
  confidence_score: 0,
  matched_by: null,
  field_id: null,
  field_display_name: null,
  candidates: [],
  ...overrides,
});
const auto = row({ polygon_id: "auto", field_id: fieldA, match_status: "matched", match_stage: "auto_matched" });
const ambiguous = row({
  polygon_id: "ambiguous",
  match_status: "ambiguous",
  match_stage: "manual_required",
  suggested_field_id: fieldB,
  reason_codes: ["geometry_conflict"],
  candidates: [{ field_id: fieldB, field_display_name: "Поле 2", technical_key: null }],
});
const unknown = row({ polygon_id: "unknown" });
const rows = [auto, ambiguous, unknown];

equal(resolveFieldMapDecision(auto, {}), {
  fieldId: fieldA, explicit: false, skipped: false, unlinked: false, action: "link",
}, "exact automatic link is retained");
for (const source of [ambiguous, unknown, row({ field_id: fieldB }), row({ match_status: "matched", field_id: " " })]) {
  equal(resolveFieldMapDecision(source, {}), {
    fieldId: null, explicit: false, skipped: false, unlinked: true, action: "unlinked",
  }, "unknown or non-exact suggestions remain independent contours");
}
equal(resolveFieldMapDecision(auto, { auto: FIELD_MAP_UNLINKED_DECISION }), {
  fieldId: null, explicit: true, skipped: false, unlinked: true, action: "unlinked",
}, "explicit keep-unlinked overrides an automatic match");
equal(resolveFieldMapDecision(unknown, { unknown: ` ${fieldB} ` }), {
  fieldId: fieldB, explicit: true, skipped: false, unlinked: false, action: "link",
}, "manual link remains possible and trims input");
for (const decision of [FIELD_MAP_SKIP_DECISION, "", " ", null]) {
  const legacy = { auto: decision } as unknown as FieldMapMatchDecisions;
  equal(resolveFieldMapDecision(auto, legacy), {
    fieldId: null, explicit: true, skipped: true, unlinked: false, action: "skip",
  }, "legacy empty or null decision remains an explicit skip, never an automatic fallback");
}

let summary = summarizeFieldMapReview(rows, {});
equal([summary.total, summary.linked, summary.unlinked, summary.skipped, summary.pending], [3, 1, 2, 0, 0], "default review counts every source contour");
check(summary.canConfirm, "all valid contours can be confirmed without creating extra fields");
equal(buildFieldMapConfirmOverrides(rows, {}), [
  { polygon_id: "ambiguous", field_id: null, action: "unlinked" },
  { polygon_id: "unknown", field_id: null, action: "unlinked" },
], "default-unlinked is sent explicitly so null cannot become a legacy skip");
equal(buildFieldMapConfirmOverrides(rows, { auto: FIELD_MAP_UNLINKED_DECISION, ambiguous: fieldB, unknown: FIELD_MAP_SKIP_DECISION }), [
  { polygon_id: "auto", field_id: null, action: "unlinked" },
  { polygon_id: "ambiguous", field_id: fieldB, action: "link" },
  { polygon_id: "unknown", field_id: null, action: "skip" },
], "wire payload distinguishes all three decisions");
equal(buildFieldMapConfirmOverrides([auto], { unrelated: FIELD_MAP_SKIP_DECISION }), [], "stale decisions cannot create a contour or override a different import");

summary = summarizeFieldMapReview([ambiguous, unknown], {});
check(summary.canConfirm && summary.linked === 0 && summary.unlinked === 2, "an entirely unlinked source is importable");
summary = summarizeFieldMapReview(rows, { auto: FIELD_MAP_SKIP_DECISION, ambiguous: "", unknown: FIELD_MAP_SKIP_DECISION });
check(!summary.canConfirm && summary.skipped === 3 && summary.unlinked === 0, "all explicitly excluded contours cannot create an empty import");
check(!summarizeFieldMapReview([], {}).canConfirm, "empty source cannot be confirmed");
summary = summarizeFieldMapReview(rows, { ambiguous: fieldA });
equal(summary.duplicateFieldIds, [fieldA], "duplicate linked field is still detected");
check(!summary.canConfirm, "duplicate linked field still blocks confirmation");
summary = summarizeFieldMapReview(rows, { auto: FIELD_MAP_UNLINKED_DECISION, ambiguous: fieldA });
check(summary.canConfirm && summary.linked === 1 && summary.unlinked === 2, "detaching one decision releases its field for another contour");
summary = summarizeFieldMapReview([unknown, { ...unknown }], {});
equal(summary.duplicatePolygonIds, [unknown.polygon_id], "source identities must remain unique even without fields");
check(!summary.canConfirm, "duplicate source identity blocks confirmation");
check(resolveFieldMapDecision(row({ polygon_id: "__proto__" }), {}).unlinked, "inherited object properties are not import decisions");

const source130 = Array.from({ length: 130 }, (_, index) => row({
  polygon_id: `source-${index + 1}`,
  polygon_name: `Исходный контур ${index + 1}`,
  ...(index < 18 ? { field_id: `existing-field-${index + 1}`, match_status: "matched" as const, match_stage: "auto_matched" as const } : {}),
}));
const before = JSON.stringify(source130);
summary = summarizeFieldMapReview(source130, {});
const overrides130 = buildFieldMapConfirmOverrides(source130, {});
equal([summary.total, summary.linked, summary.unlinked, summary.skipped], [130, 18, 112, 0], "18 linked plus 112 unknown contours are all retained");
check(summary.canConfirm, "130-contour import is not blocked by unknown matches");
equal(overrides130.length, 112, "only the 112 unlinked rows require new explicit actions");
check(overrides130.every((override) => override.field_id === null && override.action === "unlinked"), "unknown rows never generate fake field ids");
equal(JSON.stringify(source130), before, "review leaves source names, geometry parts, holes and original links untouched");
for (let index = 0; index < source130.length; index += 1) {
  const resolved = resolveFieldMapDecision(source130[index], {});
  check(index < 18 ? resolved.fieldId === `existing-field-${index + 1}` : resolved.fieldId === null && resolved.unlinked, `source contour ${index + 1} preserves its expected identity`);
}

const component = fs.readFileSync(path.resolve(__dirname, "../components/fields-map/field-map-import-review.tsx"), "utf8");
check(component.includes('"use client"'), "review keeps its existing client boundary");
check(component.includes("Сохранить контур без привязки к полю"), "UI offers independent contour preservation explicitly");
check(component.includes("Не импортировать этот контур"), "UI keeps exclusion distinct from unlinked preservation");
check(component.includes("summary.linked + summary.unlinked"), "confirm button counts linked and unlinked contours");
check(component.includes("Поле не создаётся"), "UI explains that it does not create fake fields");
check(component.includes("row.polygon_name") && component.includes("Имя из KML"), "UI identifies the original source name");
check(component.includes("disabled={assignedElsewhere}"), "UI prevents duplicate linked-field selection");
check(component.includes("disabled={busy || confirming}"), "decisions are locked while their transaction is in flight");
check(component.includes("summary.duplicatePolygonIds.length"), "UI explains duplicate source identities");
check(!/bg-\[#|text-slate-|border-white\/|bg-white\//u.test(component), "review uses semantic warm theme colors");
check(!component.includes("Решение не принято") && !component.includes("ждут решения"), "unknown contours do not misleadingly appear blocked");

console.log(`TF2 all-contours review PASS: ${assertions} assertions. Local pure contracts and UI guards only; no remote calls.`);
