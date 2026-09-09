# TF2 M08 — agronomist read-only fields map

Date: 2026-09-09 (Asia/Qyzylorda)

## Cause and classification

`/fields-map` was intentionally placed behind the historical hidden-pilot route gate in `1ffe624`. TravkinFlow 2 later accepted M08 with an explicit agronomist read-only contract, but the route gate and navigation were not updated. This is a pre-existing pilot restriction that became a missed TF2 acceptance item; it is not a regression introduced by the TF2 map rewrite.

## Corrective scope

- Allow only the exact `/fields-map` page for `agronomist`.
- Keep `/map`, `/fields-map/*`, company-admin access, and every other hidden-pilot route unchanged.
- Keep map reads for `agronomist`.
- Deny engineering-object writes for `agronomist` at the server role boundary.
- Keep boundary/import/link/state mutations exact-`global_admin` and behind the existing server flag.
- Add the existing localized `field_map` item to the agronomist desktop navigation. Mobile `More` already derives the item from `canAccessPath`.

The map component is intentionally outside this corrective because a concurrent map-layout corrective owns it. That integration must hide engineering draw/create/edit/delete controls for `agronomist`; the server already returns `403` if a stale or crafted client attempts those writes.

## Verification

- `npm run qa:fields-map:access` — PASS, 133 assertions, no remote calls.
- `npm run qa:fields-map:boundaries` — PASS, 38 assertions, no remote calls. The QA read helper normalizes Windows CRLF to LF before source assertions; the SQL and the assertion itself are unchanged.
- `npm run qa:tz274` — PASS, 15/15.
- Scoped ESLint for the six changed TypeScript/TSX files — PASS.
- `npm run typecheck` — PASS.
- `git diff --check` — PASS.

## Operational boundary

No deployment, alias, environment variable, authentication context, database schema, or business data was changed. Product remains outside this corrective. The patch must be combined with the map UI role guard and pass the authenticated agronomist browser/API matrix before becoming a release candidate.
