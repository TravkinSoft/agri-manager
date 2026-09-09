import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_ROLES, type CanonicalRole } from "../lib/auth/role-contract";
import {
  assertFieldMapMutation,
  assertFieldMapRead,
  assertFieldMapWrite,
  canMutateFieldMap,
  canReadFieldMap,
  canWriteFieldMap,
} from "../lib/fields-map/access";
import type { ServerActorContext } from "../lib/auth/server-session";

const READ_ROLES = new Set<CanonicalRole>([
  "global_admin",
  "company_admin",
  "director",
  "agronomist",
  "legal_operator",
]);
const WRITE_ROLES = new Set<CanonicalRole>([
  "global_admin",
  "company_admin",
  "director",
  "agronomist",
]);

function actorForRole(role: CanonicalRole): ServerActorContext {
  return {
    id: "profile-id",
    authUserId: "auth-user-id",
    role,
    roleRawKey: role,
    roleIsLegacyAlias: false,
    companyId: "company-id",
    homeCompanyId: "company-id",
    contextCompanyId: "company-id",
    status: "active",
    email: "qa@example.com",
    isImpersonating: false,
    impersonatedProfileId: null,
    impersonatedCompanyId: null,
    impersonatedByProfileId: null,
    impersonatedByAuthUserId: null,
  };
}

let assertions = 0;
for (const role of CANONICAL_ROLES) {
  const actor = actorForRole(role);
  const canRead = READ_ROLES.has(role);
  const canWrite = WRITE_ROLES.has(role);
  const canMutate = role === "global_admin";

  assert.equal(canReadFieldMap(role), canRead, `${role}: read capability`);
  assert.equal(canWriteFieldMap(role), canWrite, `${role}: engineering write capability`);
  assert.equal(canMutateFieldMap(role), canMutate, `${role}: import/link/state mutation capability`);
  assertions += 3;

  canRead
    ? assert.doesNotThrow(() => assertFieldMapRead(actor))
    : assert.throws(() => assertFieldMapRead(actor), (error: any) => error?.status === 403);
  canWrite
    ? assert.doesNotThrow(() => assertFieldMapWrite(actor))
    : assert.throws(() => assertFieldMapWrite(actor), (error: any) => error?.status === 403);
  canMutate
    ? assert.doesNotThrow(() => assertFieldMapMutation(actor))
    : assert.throws(
        () => assertFieldMapMutation(actor),
        (error: any) => error?.status === 403 && /global_admin/u.test(error.message)
      );
  assertions += 3;
}

for (const invalidRole of [null, undefined, "", "admin", "unknown"]) {
  assert.equal(canReadFieldMap(invalidRole), false);
  assert.equal(canWriteFieldMap(invalidRole), false);
  assert.equal(canMutateFieldMap(invalidRole), false);
  assertions += 3;
}

for (const legacyGlobalAdminAlias of ["super_admin", "superadmin", "globaladmin"]) {
  const actor = {
    ...actorForRole("global_admin"),
    roleRawKey: legacyGlobalAdminAlias,
    roleIsLegacyAlias: true,
  };
  assert.throws(
    () => assertFieldMapMutation(actor),
    (error: any) => error?.status === 403 && /global_admin/u.test(error.message),
    `${legacyGlobalAdminAlias}: normalized legacy alias must not gain exact-role mutations`
  );
  assertions += 1;
}

const repoRoot = path.resolve(__dirname, "..");
const guardedRoutes = [
  "app/api/fields-map/import/preview/route.ts",
  "app/api/fields-map/import/confirm/route.ts",
  "app/api/fields-map/imports/[id]/route.ts",
  "app/api/fields-map/boundaries/mutate/route.ts",
];
for (const relativePath of guardedRoutes) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  assert.match(source, /resolveFieldsMapContext\(request, \{ mutation: true \}\)/u, relativePath);
  assert.doesNotMatch(source, /resolveFieldsMapContext\(request, \{ write: true \}\)/u, relativePath);
  assertions += 2;
}

const importStateSource = fs.readFileSync(
  path.join(repoRoot, "app/api/fields-map/imports/[id]/route.ts"),
  "utf8"
);
assert.equal((importStateSource.match(/\{ mutation: true \}/gu) || []).length, 2);
assert.match(importStateSource, /action === "activate"/u);
assert.match(importStateSource, /action === "deactivate"/u);
assert.match(importStateSource, /action === "delete" \|\| action === "archive"/u);
assertions += 4;

for (const relativePath of [
  "app/api/fields-map/imports/route.ts",
  "app/api/fields-map/imports/[id]/download/route.ts",
]) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  assert.match(source, /resolveFieldsMapContext\(request, \{ write: false \}\)/u, relativePath);
  assertions += 1;
}

const previewSource = fs.readFileSync(
  path.join(repoRoot, "app/api/fields-map/import/preview/route.ts"),
  "utf8"
);
assert.match(previewSource, /parseKmlToGeoJson\(kmlText\)/u);
assert.doesNotMatch(previewSource, /body\??\.polygons/u);
const confirmSource = fs.readFileSync(
  path.join(repoRoot, "app/api/fields-map/import/confirm/route.ts"),
  "utf8"
);
assert.match(confirmSource, /validateParsedPolygonsForImport/u);
assert.match(confirmSource, /status \|\| ""\) !== "draft"/u);
assert.match(confirmSource, /rpc\("confirm_field_map_import_v2"/u);
assert.doesNotMatch(confirmSource, /from\("field_geometries"\)/u);
const fieldsMapServerSource = fs.readFileSync(path.join(repoRoot, "lib/fields-map/server.ts"), "utf8");
assert.match(fieldsMapServerSource, /FIELD_BOUNDARY_WRITE_V1 !== "1"/u);
const serviceSource = fs.readFileSync(path.join(repoRoot, "lib/services/fields-map.ts"), "utf8");
const previewServiceSource = serviceSource.slice(
  serviceSource.indexOf("export async function previewFieldMapImport"),
  serviceSource.indexOf("export async function confirmFieldMapImport")
);
assert.doesNotMatch(previewServiceSource, /body: JSON\.stringify\(payload\)/u);
assert.match(previewServiceSource, /kmlText: payload\.kmlText/u);
assertions += 9;

console.log(`Fields map access gate PASS: ${assertions} assertions. No remote calls.`);
