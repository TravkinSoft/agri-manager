import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createTicketSubmissionFingerprint,
  parsePersistedCreateTicketAttempt,
  resolveCreateTicketAttempt,
  serializePersistedCreateTicketAttempt,
} from "../lib/weighbridge/create-ticket-idempotency";

const key1 = "11111111-1111-4111-8111-111111111111";
const key2 = "22222222-2222-4222-8222-222222222222";
const firstPayload = {
  ticket: { vehicle_id: "vehicle-1", gross_weight_kg: 12_500 },
  lines: [{ crop_id: "crop-1", quantity: 12_500 }],
};
const samePayloadDifferentKeyOrder = {
  lines: [{ quantity: 12_500, crop_id: "crop-1" }],
  ticket: { gross_weight_kg: 12_500, vehicle_id: "vehicle-1" },
};
const changedPayload = {
  ticket: { vehicle_id: "vehicle-2", gross_weight_kg: 12_500 },
  lines: [{ crop_id: "crop-1", quantity: 12_500 }],
};

const firstFingerprint = createTicketSubmissionFingerprint(firstPayload);
const sameFingerprint = createTicketSubmissionFingerprint(samePayloadDifferentKeyOrder);
const changedFingerprint = createTicketSubmissionFingerprint(changedPayload);
assert.equal(firstFingerprint, sameFingerprint, "equivalent request payload must keep its retry fingerprint");
assert.notEqual(firstFingerprint, changedFingerprint, "changed ticket payload must receive another key");

const firstAttempt = resolveCreateTicketAttempt(null, firstFingerprint, () => key1);
assert.equal(firstAttempt.key, key1);
assert.equal(resolveCreateTicketAttempt(firstAttempt, sameFingerprint, () => key2).key, key1);
assert.equal(resolveCreateTicketAttempt(firstAttempt, changedFingerprint, () => key2).key, key2);
assert.deepEqual(parsePersistedCreateTicketAttempt(serializePersistedCreateTicketAttempt(firstAttempt)), firstAttempt);
assert.equal(parsePersistedCreateTicketAttempt(key1), null, "legacy bare UUID must not be reused without its payload fingerprint");
assert.equal(parsePersistedCreateTicketAttempt('{"version":1,"key":"bad","fingerprint":"x"}'), null);

const page = fs.readFileSync(path.join(process.cwd(), "app/(dashboard)/weighbridge/page.tsx"), "utf8");
assert.match(page, /resolveCreateTicketAttempt\([\s\S]*createPayloadFingerprint/);
assert.match(page, /serializePersistedCreateTicketAttempt\(createAttempt\)/);
assert.match(page, /rawAttempt && !restoredAttempt[\s\S]*localStorage\.removeItem/);
assert.match(page, /e\?\.status === 409[\s\S]*createTicketIdempotencyRef\.current = null/);

console.log("P0 weighbridge create idempotency: 10/10 PASS");
