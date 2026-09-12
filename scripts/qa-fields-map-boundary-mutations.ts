import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FIELD_MAP_SKIP_DECISION,
  buildFieldMapConfirmOverrides,
  resolveFieldMapDecision,
  summarizeFieldMapReview,
} from "../lib/fields-map/import-review";
import type { FieldMapPreviewMatch, GeoJsonAreaGeometry } from "../lib/types/fields-map";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs
  .readFileSync(path.join(root, relativePath), "utf8")
  .replace(/\r\n/gu, "\n");
const geometry: GeoJsonAreaGeometry = {
  type: "Polygon",
  coordinates: [[[69, 54], [69.01, 54], [69.01, 54.01], [69, 54]]],
};

const row = (overrides: Partial<FieldMapPreviewMatch>): FieldMapPreviewMatch => ({
  polygon_id: "polygon-1",
  polygon_name: "Поле 1",
  area_ha: 10,
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

const fieldA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fieldB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rows = [
  row({ polygon_id: "auto", match_status: "matched", match_stage: "auto_matched", field_id: fieldA }),
  row({ polygon_id: "manual", match_status: "ambiguous", match_stage: "manual_required" }),
  row({ polygon_id: "skip", match_status: "not_found" }),
];

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertions += 1;
};

let summary = summarizeFieldMapReview(rows, {});
check(summary.linked === 1, "high-confidence row remains automatically linked");
check(summary.unlinked === 2 && summary.pending === 0, "ambiguous and no-match rows remain independent contours");
check(summary.canConfirm, "all valid contours can be saved without invented fields");

const decisions = { manual: fieldB, skip: FIELD_MAP_SKIP_DECISION };
summary = summarizeFieldMapReview(rows, decisions);
check(summary.linked === 2 && summary.skipped === 1 && summary.pending === 0, "explicit decisions resolve queue");
check(summary.canConfirm, "fully decided unique queue can be confirmed");
check(resolveFieldMapDecision(rows[2], decisions).skipped, "explicit skip never falls back to an automatic field");
check(
  buildFieldMapConfirmOverrides(rows, decisions).some((item) => item.polygon_id === "skip" && item.field_id === null),
  "explicit skip is sent to server as null"
);

summary = summarizeFieldMapReview(rows, { manual: fieldA, skip: FIELD_MAP_SKIP_DECISION });
check(summary.duplicateFieldIds.length === 1 && summary.duplicateFieldIds[0] === fieldA, "duplicate final field is detected");
check(!summary.canConfirm, "duplicate final assignment blocks confirmation");

const route = read("app/api/fields-map/boundaries/mutate/route.ts");
const confirmRoute = read("app/api/fields-map/import/confirm/route.ts");
const importsRoute = read("app/api/fields-map/imports/route.ts");
const migration = read("supabase/migrations/20260908232606_field_boundary_revision_v1.sql");
const contourMigration = read("supabase/migrations/20260909211431_field_map_independent_contours_v3.sql");
const page = read("components/fields-map/fields-map-page.tsx");
const review = read("components/fields-map/field-map-import-review.tsx");
const env = read(".env.example");
const release = read("lib/travkinflow-2/release.ts");

check(route.includes("resolveFieldsMapContext(request, { mutation: true })"), "boundary route uses global-admin server gate");
check(route.includes("validateParsedPolygonsForImport"), "replacement geometry is server validated");
check(route.includes('.rpc("mutate_field_contour_v3"'), "boundary write is one versioned RPC");
check(confirmRoute.includes("row.field_id === null ? null"), "confirm API preserves explicit skip");
check(confirmRoute.includes('override?.action === "skip"'), "explicit skip overrides automatic match");
check(confirmRoute.includes('row.match_status === "matched" ? row.field_id : null'), "server keeps ambiguous and unmatched contours unlinked");
check(migration.includes("drop policy if exists \"Users can insert company field geometries\""), "legacy geometry insert policy is removed");
check(migration.includes("drop policy if exists \"Users can update company field map imports\""), "legacy import update policy is removed");
check(migration.includes("revoke insert, update, delete on table public.field_geometries from public, anon, authenticated"), "direct geometry DML is revoked");
check(migration.includes("revoke insert, update, delete on table public.field_map_imports from public, anon, authenticated"), "direct import DML is revoked");
check(migration.includes("has_table_privilege('authenticated', 'public.field_geometries', 'INSERT')"), "migration fails closed if authenticated geometry DML survives");
check(migration.includes("has_table_privilege('authenticated', 'public.field_map_imports', 'DELETE')"), "migration fails closed if authenticated import DML survives");
check(migration.includes("has_table_privilege('anon', 'public.field_geometries', 'UPDATE')"), "migration verifies anonymous direct DML is absent");
check(migration.includes("profile.role = 'global_admin'"), "RPC rechecks global-admin role");
check(migration.includes("pg_advisory_xact_lock"), "RPC serializes company boundary revisions");
check(migration.includes("and geometry_row.is_active = true\n      for update"), "active geometry id is a locked CAS token");
check(migration.includes("insert into public.audit_log"), "every boundary mutation appends audit log");
check(contourMigration.includes("s.import_id,s.source_import_id"), "new versions keep immutable import lineage");
check(contourMigration.includes("and g.contour_version>s.contour_version"), "restore rejects superseded versions");
check(contourMigration.includes("v_action='restore' and s.deleted_at is null"), "restore requires the current deletion tombstone");
check(migration.includes("to service_role"), "boundary RPC is service-role only");
check(!/grant execute on function public\.mutate_field_boundary_v1[\s\S]*?to authenticated/u.test(migration), "authenticated users cannot call boundary RPC");
check(/export const TRAVKINFLOW_2_FUNCTIONS_RELEASED = true/u.test(release), "TravkinFlow 2 functions are released through one code switch");
check(!/FIELD_BOUNDARY_WRITE_V1|NEXT_PUBLIC_FIELD_BOUNDARY_WRITE_V1/u.test(env), "obsolete boundary environment flags are absent");
check(page.includes('profile?.role === "global_admin"'), "client mutation UI checks effective role");
check(page.includes("FIELD_BOUNDARY_UI_ENABLED = TRAVKINFLOW_2_FUNCTIONS_RELEASED"), "client mutation UI shares the release switch");
check(importsRoute.includes("TRAVKINFLOW_2_FUNCTIONS_RELEASED &&"), "import revision uses the same release switch");
check(importsRoute.includes('actor.role === "global_admin"') && importsRoute.includes('actor.roleRawKey === "global_admin"'), "import revision keeps the exact global-admin gate");
check(page.includes("<FieldMapImportReview"), "active map renders the match queue");
check(review.includes("FIELD_MAP_UNLINKED_DECISION") && review.includes("Не импортировать этот контур"), "save-unlinked and excluded are distinct decisions");
check(page.includes('event.key.toLowerCase() === "z"') && page.includes('event.key === "Escape"'), "full-boundary editor exposes undo and cancel shortcuts");
check(page.includes('action: "relink"') && page.includes('action: "unlink"') && page.includes('changeSelectedContour("restore")'), "inspector exposes link, visible detach and delete restoration");

console.log(`Fields map boundary mutation PASS: ${assertions} assertions. No remote calls.`);
