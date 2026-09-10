# C35 / M09 — independent contours v3

Implementation base: `41419c84267abf021b8ead339c20e9244f391f6f`.
Worktree: `.worktrees/tf2-all-contours-20260910`.
No remote DDL, DML, deployment, environment or business-data writes were performed by this implementation stream.

## Delivered

- Every valid KML contour can be saved, including ambiguous/unknown names. Defaults preserve exact existing matches and save other contours without a field link. Explicit exclusion remains separate, including compatibility with legacy null overrides.
- Independent bootstrap/list/map selection; user-visible source name/identity, editable display name, explicit link/detach, soft delete and restore. No synthetic fields are created. Business crop/harvest/operation projection is unchanged.
- `contour_id` remains stable across immutable geometry-version IDs. Every mutation checks the expected current version under the existing company advisory lock, rechecks active exact global-admin actor, and appends audit.
- Source import UUID, polygon identity/name and original GeoJSON survive edits. A hard-deleted field detaches rather than cascading into geometry/history deletion; source UUID survives removal of the import record.
- Unlink keeps the contour active/visible. Delete creates a versioned tombstone. Activation selects latest versions by contour identity (not nullable field ID), then filters tombstones; deleted shapes do not resurrect.
- Existing Polygon/MultiPolygon parts and every hole are selectable/editable. Replacing one ring preserves all other coordinates; the complete draft is validated server-side and rendered on the map. Input Ctrl+Z keeps native text undo; map Ctrl+Z removes a vertex; Escape cancels.
- Server/client boundary-write flags and existing role rules are retained. This does not authorize agronomist writes or expand engineering permissions.

## Migration and compatibility

New file created with the Supabase CLI: `supabase/migrations/20260909211431_field_map_independent_contours_v3.sql`.
The two existing map-hardening migrations were not edited. The local harness executes both plus the new migration verbatim against a minimal legacy schema fixture; it is not a full production-schema clone.

V2 import/state and V1 boundary entrypoints delegate to v3, preventing old activation from collapsing NULL links. Full current v3 clients are required for the new editing UX; flags stay fail-closed during rollout. The corrective bootstrap fallback below keeps the pre-v3 map readable without making writes available.

## Local verification

- TypeScript full project `tsc --noEmit --incremental false`: passed.
- Scoped ESLint and `git diff --check`: passed.
- Actual-handler/access/editor tests: 22 scenarios, with only session retrieval and Supabase transport mocked.
- PGlite v3: 26 scenarios including role/company/DML gates, 130 = 18 linked + 112 unlinked, rollback, source preservation, CAS, activate/deactivate/archive, delete/restore and old-client compatibility.
- Review decisions: 171 assertions.
- Existing regressions: access 133, atomic import 22, boundary 38, server KML/geometry 16, matching 28, map UI 14 assertions.
- Actual STEM ZIP expansion replay: 9 scenarios passed, including all fingerprint/timestamp/actor/source guard failures and replay rejection. ZIP SHA256 `b5d927b63d16ea15e74cd647c9af4c1e46715b51c77ea58627e9b3d7b5e9aaa6`; source KML SHA256 `51abda21beb7a0ad276b3ac2ab926e95919f84682f107700e7b302620e619bf2`, 3,527,503 bytes, 130 shapes / 73,212 positions. `qa-stem-contours-expansion-pglite.ts` verifies exact source geometry equality and 18 full-row preservation after the generated proposal executes in local PGlite.

Browser QA of the integrated warm design + v3 schema remains ROOT's release gate. No claim of final browser QA or Product readiness is made by these local checks.

## Guarded QA expansion — ROOT only

Target ONLY QA project `gsglkmudcwkdetqtocae`, company `8a0f2c0e-6638-4a31-99a8-cab4237d287d`, existing import `097b2646-4adc-4842-b988-b3603889e271`.

1. Review and apply v3 schema through the authorized QA migration path. Preserve a before snapshot of the existing 18 IDs, links and geometries. Metadata backfill can change `updated_at`, so do not reuse a pre-migration full-row fingerprint afterward.
2. Run read-only `scripts/qa-stem-contours-expansion-preflight.sql`. Record exact post-migration revision, geometry, preview and fields MD5 plus import updated_at; independently verify the active QA global-admin UUID. Expected initial counts: 18 total/active/linked/source IDs, zero unlinked, source preview 130. Stop on any mismatch.
3. `npx tsx scripts/qa-stem-contours-expansion-proposal.ts <actor UUID> <revision MD5> <geometry MD5> <preview MD5> <fields MD5> <import timestamp>` only prints SQL. It contains no database client, credentials or execution path. Review output before ROOT executes it against QA.
4. The one transaction checks fixed source SHA/MD5/bytes, QA identity, actor, revision and all fingerprints; inserts exactly 112 unlinked shapes and updates the import review metadata. Existing 18 full rows/IDs/links/geometries and all field rows must be unchanged afterward. The audit records preserved IDs and prior fingerprints. Replays abort.
5. Read back 130 active, 18 linked, 112 unlinked; inspect map click/list/edit and restore on authorized QA fixtures, including MultiPolygon and inner rings, then recheck source and business-data fingerprints.

Any proposal exception rolls back the full transaction. Post-commit rollback is a separate explicitly reviewed operation: disable boundary-write flags first; preserve schema and source/history. Do not drop new columns or delete source data. A rollback to 18 active contours can tombstone only the 112 inserted identities after fresh CAS/audit checks, not replace/delete the original 18.

## Integration notes

ROOT already owns warm palette changes in `fields-map-page.tsx`. Resolve any merge conflict by preserving this functional v3 logic and reapplying only presentation token changes; new controls already use semantic warm tokens. In `qa-travkinflow-2-map-ui.ts`, this patch changes only the final geometry/editor test. Preserve ROOT's three attribution color assertions.

Source overlaps remain warnings for manual review; they are not guessed field matches and do not justify dropping valid contours. This scope does not add new business fields, hectares assignments, accounting changes or automatic merge/split of source shapes.

## Corrective compatibility audit — 2026-09-10

The initial C9 bootstrap unconditionally called the new read RPC. `FIELD_BOUNDARY_WRITE_V1=0` did not protect existing reads against an absent v3 schema. The corrective code first probes `get_field_map_contours_v3`; it falls back to the previous company-scoped, active `field_geometries` projection only for exact missing-schema codes: `PGRST202` or `42883` naming that RPC, or `42703` naming a v3-only column. Authentication, permissions, network, unrelated missing objects and arbitrary errors are not swallowed or retried.

Legacy rows remain visible both as field-card geometry and independent read-only contours. Their actual geometry UUID is the stable contour identity (matching v3 backfill), their real import UUID is retained, and unavailable source polygon identities remain null. No fields, source links or database rows are fabricated. Bootstrap returns `contour_editing_available=false` until a v3 read succeeds. The client requires exactly `true`, plus the existing role and public flag, and cancels any open geometry editor if capability becomes unavailable. All server write gates and RPCs remain unchanged/fail-closed. This capability proves read-schema availability; it does not override server mutation authorization.

`scripts/qa-fields-map-bootstrap-compat-api.ts`: 9 actual-handler scenarios verify flags OFF/ON legacy reads, v3 paths including unknown contours/tombstones, precise missing-schema recognition, error visibility, read-role/session gates, company scoping, season/field summaries and the actual client capability expression. Session retrieval and Supabase transport are mocked; no remote or browser business writes occur.

Compatibility details proven by the exact-migration PGlite harness:

- A preview/revision captured before v3 is stale after the snapshot gains `contour_versions`; both old confirm/state wrappers reject it atomically. Refresh/re-preview before confirmation.
- An old linked-only confirm payload with a fresh opaque revision works through the v2 wrapper. Source geometry and source identities are preserved. V2 activation also retains all unlinked contours rather than collapsing NULL field IDs.
- V1 replacement delegates the full geometry unchanged; current and immutable source MultiPolygon parts/holes are preserved. It cannot recover detail already omitted by a caller, so the old UI's complex-geometry editing restriction must not be removed during rollback.
- Old V1 unlink now creates an active detached version. The old UI's subsequent undo references its superseded geometry UUID and fails CAS; it does not reactivate old geometry or partially mutate data. **Do not permit old UI boundary writes after schema migration.** The v3 UI uses explicit detach/relink and tombstone delete/restore.

Release/rollback order: first deploy and verify a compatible immutable TF2 server containing the strict pre-v3 read fallback and mutation flag gates, with boundary writes OFF; then apply the exact reviewed schema package through ROOT's approved release path, verify v3 bootstrap/schema and fresh revision, and complete role/geometry/browser checks before enabling writes. The live pre-TF2 server `4bae7d9` DOES NOT implement this flag and performs direct service-role map writes: schema-first while it remains the active backend is not the approved safe sequence. A full rollback to that server is unsafe even with env flags set to zero; its old confirm can partially deactivate geometry before a new NOT NULL constraint rejects insertion. See `TF2-PRODUCT-SIX-MIGRATIONS-PREFLIGHT-20260910.md` for the independently verified entrypoints. A stale old browser must refresh before editing. Roll back only to the verified compatible flags-off TF2 artifact, retaining source/history and the new schema. Legacy reads hide unknown contours but do not delete them.

Do not reverse `field_id` to NOT NULL after unlinked contours exist or restore `ON DELETE CASCADE` over retained source/history. The new `SET NULL` FK prevents field deletion from removing contours; IDs/links/geometry are preserved by the migration, while metadata backfill can advance updated timestamps. Rollback is a coordinated code/flag action, not a destructive schema downgrade. No remote QA/Product migration, repair, release or credential change was performed by this audit.
