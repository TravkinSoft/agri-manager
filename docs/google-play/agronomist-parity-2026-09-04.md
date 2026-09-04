# Full Agronomist cabinet — parity acceptance

Owner correction, 2026-09-04: Android must contain the entire working Agronomist cabinet on travkinflow.com, not only identity/profile details. The previous 92% release-preparation estimate does not measure this scope. Play upload automation remains paused.

## Verified baseline

- Android worktree: project-google-market-native-v1, branch codex/google-market-native-v1; initial clean HEAD 4a1daf07b5deba4ae2d77127025cc2fb60dbd0eb.
- Fetched origin/master: 9ea2c8317aad0ca7c5f50c2ba727f30b61bd0517.
- Live public /api/healthz: production, commit 9ea2c8317aad (2026-09-04T14:44:42Z).
- Current role navigation is six destinations, not the historical Google-TZ4 menu. Source: components/layout/sidebar.tsx and lib/auth/role-access.ts at the verified web SHA.
- Existing browser tab checked was Global Admin, NOT an Agronomist acceptance session. The other candidate Agronomist tab belongs to another active task and was not taken over.

## Architecture and boundaries

Native Compose screens -> native repository -> existing authenticated HTTPS APIs -> existing server authorization and company isolation. No embedded website, WebView, TWA, new database, migrations, permissions, or backend changes. Only agronomist is admitted. Server data is shared with the web; native UI changes still require an Android release.

Read requests refresh on navigation/foreground and user request. Stale/error/empty states remain distinct. In-flight results must never survive logout, account change or a later navigation request. Commands are not automatically retried. Production business writes during development/tests: 0.

## Acceptance matrix — all pending until evidenced

| Section | Existing source | Required parity |
|---|---|---|
| Harvest summary | /api/dashboard/harvest-summary | Period/filter controls; crop/field/moisture/issues/storage views and relevant drilldowns |
| Crop structure | /api/crop-structure/bootstrap, /api/crop-structure/fields/:id | Seasons/search; field dossier, crop/mix/fallow identities; operations/materials; current-season editor and supported actions; exports |
| Warehouses | /api/warehouses/summaries, existing stock/lot APIs | Availability, warehouse/item/lot/ticket drilldowns, search; only Agronomist-permitted actions |
| Tickets | /api/weighbridge/tickets and /:id | Harvest-only open/today/history; document details and print/export; no station/operator workspace |
| Vehicle traffic | /api/traffic | Current states/events; fleet selection preserving busy/archived assigned vehicles; staff access information, no operator impersonation |
| Weather | /api/weather-lab/* | Locality selection; current/hourly forecast; existing weather settings and operating-window functionality |

Shared: session, profile/settings, notifications, native back navigation, loading/error/offline, keyboard/rotation/foreground, negative role/company tests, physical Android acceptance. Maps/administration/Weighman workspace are not added simply because a Global Admin sees them.

## Development checkpoint (ongoing, not accepted)

- Source includes six primary native sections plus notifications/settings, crop editor, fleet selection, weather-profile CRUD, historical seasons/operation/material reads, harvest filters/party drilldowns. Commands are single-flight, fresh-role/company checked, no automatic retry. None has been executed against Production.
- Latest completed local run: **67 tests, 0 failures/0 errors**, testDebugUnitTest, lintDebug and assembleDebug PASS. This proves compilation/pure contracts only, not live payloads, UI quality or role acceptance. No release artifact rebuilt.
- Corrected old actor DTO: current `/api/auth/actor` returns camelCase `companyId`, not only `company_id`. Both contracts covered by tests. Real-role session still required.
- During development master/Production advanced to `41b65083e156b5c3beaef5431c8437c8f92c0fce`. Public health verified `41b65083e156` at 2026-09-04T15:39:23Z. Primary role navigation unchanged; persistent vehicle-driver assignment was ported with CAS/receipt validation and four additional unit tests. It is not live-QA-accepted. No merge into GM occurred.
- Operation catalog (12 categories, 70 subtypes) generated from the actual web engine into native assets; planner not yet connected. Advanced operation workflow parity remains pending.
- PDF save added for harvest tickets and field dossiers. Fresh actual actor/company/object/season checks precede fixed GET endpoints; ticket PDF bytes are preserved, field-card HTML is reduced to printable text with table cell boundaries and natively paginated. No executable HTML, token-bearing URLs, external browser or automatic external-storage write. The user chooses a PDF destination via Android's system picker. Six pure export tests pass; device rendering, Cyrillic layout and full browser-print fidelity remain unverified. Existing web endpoints were not changed.
- Global-admin-only field_material_consumptions feed was NOT added to Agronomist. Materials are read through that role's operation relationships. Hidden proactive settings are preserved, not exposed/invoked by Android.
- No Android device/emulator connected and no dedicated permanent Agronomist QA session verified. Owner asked whether to use phone or emulator; no answer yet. QA Auth configuration requires verification before delivery of a usable test APK.
- Read-only network diagnostics: QA `/api/healthz`, `/api/auth/actor`, `/auth/login` return **302 -> vercel.com**, with automatic redirects disabled. The native client has no browser Vercel SSO session. Production cannot substitute for QA mutation checks because this stream's DB writes must remain 0. Do not embed a protection-bypass secret in the APK or turn off protection without authorization.
- Signing-script guard PASS (expected stop before key access). Direct Gradle preReleaseBuild guard PASS (expected failure while unaccepted). Debug APK is compilation evidence, not a usable/live-verified full-cabinet release.
- Next: owner/CEO decision on a safe Android QA access path and real Agronomist/device smoke. Remaining implementation: native operation planner (idempotency and canonical material/identity rules), full detailed actions and print/export parity, then complete payload/role QA. Do not publish or report full parity from this checkpoint.

## Release gate

READY_FOR_INTERNAL_TEST = NO until the matrix and role-realistic device checks pass. No old minimal AAB may be described as the full cabinet. Preserve the last signed bundle and signing key. No master merge, Production deployment, DB writes or automatic Play upload.

Rollback of an unreleased Android change is to the prior GM commit/artifact; web and database need no rollback because they are unchanged.
