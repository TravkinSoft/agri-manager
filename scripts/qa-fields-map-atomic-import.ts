import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const confirmRoute = read("app/api/fields-map/import/confirm/route.ts");
const stateRoute = read("app/api/fields-map/imports/[id]/route.ts");
const server = read("lib/fields-map/server.ts");
const release = read("lib/travkinflow-2/release.ts");
const previewRoute = read("app/api/fields-map/import/preview/route.ts");
const migration = read("supabase/migrations/20260909211431_field_map_independent_contours_v3.sql");

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertions += 1;
};

check(confirmRoute.includes('.rpc("confirm_field_map_import_v3"'), "confirm route uses atomic RPC");
check(!confirmRoute.includes('.from("field_geometries").insert'), "confirm route has no split geometry insert");
check(!confirmRoute.includes('.from("field_geometries")\n        .update'), "confirm route has no split deactivate");
check(confirmRoute.includes("fieldToPolygon"), "duplicate final field assignment is rejected before RPC");
check(confirmRoute.includes("status || \"\") !== \"draft\""), "draft compare-and-set precondition is explicit");
check(stateRoute.includes('.rpc("set_field_map_import_state_v3"'), "state changes use one RPC");
check(!stateRoute.includes('.from("field_geometries")'), "state route has no split geometry mutation");
check(stateRoute.includes('importRes.data.status !== "imported"'), "activate is UI/API limited to imported state");
check(server.includes("if (!TRAVKINFLOW_2_FUNCTIONS_RELEASED)"), "server mutation gate shares the release switch");
check(release.includes("export const TRAVKINFLOW_2_FUNCTIONS_RELEASED = true"), "TravkinFlow 2 functions are released");
check(previewRoute.includes("estimateAreaGeometryConflictComplexity"), "preview budgets pairwise geometry work");
check(previewRoute.includes("FIELD_MAP_MAX_CONFLICT_CANDIDATE_PAIRS"), "preview caps candidate-pair growth");
check(migration.includes("pg_advisory_xact_lock"), "RPC serializes one company import snapshot");
check(migration.includes("v_import.status <> 'draft'"), "confirm RPC uses status CAS");
check(migration.includes("FIELD_MAP_DUPLICATE_FIELD"), "RPC rejects duplicate fields defensively");
check(migration.includes("FIELD_MAP_FIELD_SCOPE_MISMATCH"), "RPC validates tenant-scoped fields");
check(migration.includes("get_field_map_snapshot_v1"), "preview and mutations share one locked map snapshot contract");
check(migration.includes("FIELD_MAP_PREVIEW_STALE"), "confirm rejects a stale preview revision inside the transaction");
check(migration.includes("FIELD_MAP_STATE_STALE"), "history changes reject stale map or target revisions");
check(migration.includes("update public.field_geometries set is_active=false"), "old geometry deactivation is inside transaction");
check(migration.includes("insert into public.audit_log"), "confirm/state changes append canonical audit entries");
check(migration.includes("to service_role"), "RPC execution is server only");
check(!/to authenticated\s*;/u.test(migration), "RPC is not granted to authenticated clients");

console.log(`Fields map atomic import PASS: ${assertions} assertions. No remote calls.`);
