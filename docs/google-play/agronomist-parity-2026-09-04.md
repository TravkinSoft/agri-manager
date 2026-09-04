# Full Agronomist cabinet — parity acceptance

Owner correction, 2026-09-04: Android must contain the entire working Agronomist cabinet on travkinflow.com, not only identity/profile details. The previous 92% release-preparation estimate does not measure this scope. Play upload automation remains paused.

Owner clarification, 2026-09-05: do not invent a standalone «Работы в поле» page. Operation history and «Создать план работы» remain inside «Структура посевов», exactly as in the website information architecture. The standalone «Талоны» page is deferred from the current visible Android scope; its dormant code is not exposed through navigation or drilldowns.

## Verified baseline

- Android worktree: project-google-market-native-v1, branch codex/google-market-native-v1; initial clean HEAD 4a1daf07b5deba4ae2d77127025cc2fb60dbd0eb.
- Current local `origin/master`: `99bfca6277d9528d36b9d5087a2b3e0f51ceba66`. The changes after the pinned operation-catalog baseline affect only traffic/PTC files, not the Agronomist navigation or operation contract. Production deployment was not reverified or changed in this checkpoint.
- Current website Agronomist navigation is five destinations: harvest summary, crop structure, warehouses, tickets and weather. Vehicle traffic is not an Agronomist menu destination. The owner currently defers tickets, leaving four visible native primary sections.
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
| Tickets | deferred by owner | Dormant prior code is not reachable in the current visible build; no further ticket work in this stage |
| Weather | /api/weather-lab/* | Locality selection; current/hourly forecast; existing weather settings and operating-window functionality |

Shared: session, profile/settings, notifications, native back navigation, loading/error/offline, keyboard/rotation/foreground, negative role/company tests, physical Android acceptance. Maps/administration/Weighman workspace are not added simply because a Global Admin sees them.

## Development checkpoint (ongoing, not accepted)

- Source exposes four primary native sections plus notifications/settings, crop editor, weather-profile CRUD, historical seasons/operation/material reads and harvest filters/party drilldowns. Commands are single-flight, fresh-role/company checked, no automatic retry. None has been executed against Production.
- Latest completed local run: **77 tests, 0 failures/0 errors**, testDebugUnitTest, lintDebug and assembleDebug PASS. This proves compilation/pure contracts only, not live payloads, UI quality or role acceptance. No release artifact rebuilt.
- Corrected old actor DTO: current `/api/auth/actor` returns camelCase `companyId`, not only `company_id`. Both contracts covered by tests. Real-role session still required.
- The GM worktree remains isolated; `origin/master` advanced independently to `99bfca6277d9528d36b9d5087a2b3e0f51ceba66`. No merge into GM, main-branch edit or Production action occurred.
- Operation catalog (12 categories, 70 subtypes) is generated from the actual web engine into native assets. «Создать план работы» is connected inside current-season field details only. The native client refreshes actor/company/field/season/assets before POST, uses a stable UUID idempotency key, and accepts only a server-confirmed operation UUID. Complete non-material workflows are exposed; material-heavy workflows remain hidden until their product/batch/rate-basis/multi-target forms are complete.
- PDF save added for harvest tickets and field dossiers. Fresh actual actor/company/object/season checks precede fixed GET endpoints; ticket PDF bytes are preserved, field-card HTML is reduced to printable text with table cell boundaries and natively paginated. No executable HTML, token-bearing URLs, external browser or automatic external-storage write. The user chooses a PDF destination via Android's system picker. Six pure export tests pass; device rendering, Cyrillic layout and full browser-print fidelity remain unverified. Existing web endpoints were not changed.
- Global-admin-only field_material_consumptions feed was NOT added to Agronomist. Materials are read through that role's operation relationships. Hidden proactive settings are preserved, not exposed/invoked by Android.
- No Android device/emulator connected and no dedicated permanent Agronomist QA session verified. Owner asked whether to use phone or emulator; no answer yet. QA Auth configuration requires verification before delivery of a usable test APK.
- Read-only network diagnostics: QA `/api/healthz`, `/api/auth/actor`, `/auth/login` return **302 -> vercel.com**, with automatic redirects disabled. The native client has no browser Vercel SSO session. Production cannot substitute for QA mutation checks because this stream's DB writes must remain 0. Do not embed a protection-bypass secret in the APK or turn off protection without authorization.
- Signing-script guard PASS (expected stop before key access). Direct Gradle preReleaseBuild guard PASS (expected failure while unaccepted). Debug APK is compilation evidence, not a usable/live-verified full-cabinet release.
- Next: complete the material-heavy operation forms and detailed actions, then resolve a safe Android QA access path and run a real Agronomist/device smoke. Do not publish or report full parity from this checkpoint.

## Release gate

READY_FOR_INTERNAL_TEST = NO until the matrix and role-realistic device checks pass. No old minimal AAB may be described as the full cabinet. Preserve the last signed bundle and signing key. No master merge, Production deployment, DB writes or automatic Play upload.

Rollback of an unreleased Android change is to the prior GM commit/artifact; web and database need no rollback because they are unchanged.
