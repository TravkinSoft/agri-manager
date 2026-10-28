import assert from "node:assert/strict";
import { mtmSaveSchema, mtmDatabaseFailure, parseMtmPage } from "../lib/mtm/validation";

const payload = {
  companyId: "10000000-0000-4000-8000-000000000001", expected_revision: 0,
  category: "part", part_number: "00012-A/7", barcode: "000009876543", internal_code: null,
  specifications: "Размер: 30 × 62 × 16 мм", accounting_unit_note: "Одна штука",
  applicability: [{ model_kind: "machine", model_id: "10000000-0000-4000-8000-000000000002", node: "Ступица", status: "confirmed", source: "Каталог производителя, стр. 4", restrictions: null }],
};
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`); };
check("leading zeros/full manufacturer number preserved", () => {
  const parsed = mtmSaveSchema.parse(payload);
  assert.equal(parsed.barcode, "000009876543"); assert.equal(parsed.part_number, "00012-A/7");
});
check("manufacturer number is optional for consumable", () => {
  assert.equal(mtmSaveSchema.parse({ ...payload, category: "ppe", part_number: null, applicability: [] }).part_number, null);
});
for (const [name, patch] of Object.entries({
  "numeric identifier": { part_number: 123 }, "numeric barcode": { barcode: 123 },
  "negative revision": { expected_revision: -1 }, "fractional revision": { expected_revision: 0.5 },
  "bad company": { companyId: "invalid" }, "empty specifications": { specifications: " " },
  "missing accounting meaning": { accounting_unit_note: "" }, "control character barcode": { barcode: "123\n456" },
  "unknown category": { category: "invented" }, "unknown writable field": { name: "Should not rename product" },
})) check(`reject ${name}`, () => assert.equal(mtmSaveSchema.safeParse({ ...payload, ...patch }).success, false));
check("confirmed applicability requires source", () => assert.equal(mtmSaveSchema.safeParse({ ...payload, applicability: [{ ...payload.applicability[0], source: null }] }).success, false));
check("pending applicability is not auto confirmed", () => assert.equal(mtmSaveSchema.parse({ ...payload, applicability: [{ ...payload.applicability[0], status: "pending", source: null }] }).applicability[0].status, "pending"));
check("duplicate applicability rejected", () => assert.equal(mtmSaveSchema.safeParse({ ...payload, applicability: [payload.applicability[0], payload.applicability[0]] }).success, false));
check("model display name is not trusted as write input", () => assert.equal(mtmSaveSchema.safeParse({ ...payload, applicability: [{ ...payload.applicability[0], model_name: "Invented" }] }).success, false));
check("bounded pagination", () => { assert.equal(parseMtmPage(new URLSearchParams("limit=100&offset=50")).limit, 100); assert.throws(() => parseMtmPage(new URLSearchParams("limit=101"))); assert.throws(() => parseMtmPage(new URLSearchParams("offset=-1"))); });
check("search and barcode are bounded strings", () => { assert.equal(parseMtmPage(new URLSearchParams("barcode=00001")).barcode, "00001"); assert.throws(() => parseMtmPage(new URLSearchParams({ search: "x".repeat(201) }))); });
check("missing schema is actionable 503", () => assert.equal(mtmDatabaseFailure({ code: "PGRST202" }).status, 503));
check("revision and barcode conflicts differentiated", () => { assert.equal(mtmDatabaseFailure({ message: "MTM_REVISION_CONFLICT" }).code, "MTM_REVISION_CONFLICT"); assert.equal(mtmDatabaseFailure({ message: "MTM_BARCODE_CONFLICT" }).code, "MTM_BARCODE_CONFLICT"); assert.notEqual(mtmDatabaseFailure({ code: "23505", message: "other_constraint" }).code, "MTM_BARCODE_CONFLICT"); });
console.log(`MTM domain: ${checks}/${checks} PASS (no external services)`);
