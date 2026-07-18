# Contract proposal — Core preview data pages without service role

DATE: `2026-07-18`
SOURCE TASK: `A108`
TARGET BRANCH: `copilot-v1`
TARGET BASE REVIEWED: `abce1bb9e18fc118c68dfc6add6fb31d05ffe81c`
STATUS: `IMPLEMENTED_AND_VALIDATED_ON_A108_PREVIEW`

## Problem statement

The A108 preview process intentionally contains no `SUPABASE_SERVICE_ROLE_KEY`, database URL, direct credentials, or admin credential. Authenticated Assistant reads work under the QA user's JWT and RLS, but several Core-owned pages call Core route handlers that unconditionally create `getServiceClient()`.

The resulting server error is `Supabase service credentials are not configured`. Adding a service role would violate the A108 security contract and is not an acceptable fix.

The affected Core files are byte-identical to Core commit `1fbb3998c8dc82ee8e4af0b439b8a32c0b76a034`; the A108 Assistant file delta does not modify them. This is therefore a Core ordinary-user data-path defect, not an Assistant env-wiring defect.

## Reproduced pages and request chains

| Page | Observed result | Blocking request path | Core source |
|---|---|---|---|
| `/crop-structure` | Error banner and toast; no fields/season/structure | `GET /api/crop-structure/bootstrap?companyId=...` | `app/api/crop-structure/bootstrap/route.ts` |
| `/warehouses` | Error banner/toast; 0 warehouses; stock UI empty | `GET /api/warehouses?companyId=...`; `GET /api/warehouses/products?companyId=...` | `app/api/warehouses/route.ts`; `app/api/warehouses/products/route.ts` |
| `/operations` | Main journal loads through direct user-RLS reads, but opening a row/card triggers the same error | `GET /api/operations/[id]/lines?companyId=...` | `app/api/operations/[id]/lines/route.ts` |

The warehouse page also loads balances and ledger movements directly through the authenticated browser client, but its `Promise.all` rejects when either Core route above fails, so all four datasets are discarded.

## Core-owned root

1. `lib/supabase/service.ts` throws when `SUPABASE_SERVICE_ROLE_KEY` is absent.
2. `lib/auth/server-session.ts` calls `getServiceClient()` during ordinary profile/company resolution before its user-JWT fallback can complete.
3. The affected route handlers call `getServiceClient()` again for tenant data and pass it into `assertActorAccess`.
4. This makes an administrative credential a hidden runtime requirement for normal agronomist reads, bypassing the intended user-JWT/RLS boundary.

## Required Core contract

### 1. Request-scoped authenticated client

Core must provide one shared helper equivalent to the A108 request-scoped client:

- require both public Supabase URL and anon/publishable key;
- parse and require `Authorization: Bearer <user JWT>`;
- create a Supabase client with that Authorization header;
- disable persistence and token refresh on the server;
- validate the user with `auth.getUser(token)`;
- perform all ordinary company reads and writes under that same user JWT;
- keep exact `company_id` predicates in addition to RLS.

It must never read or fall back to `SUPABASE_SERVICE_ROLE_KEY` for ordinary authenticated pages.

### 2. Session and ACL path

Core files:

- `lib/auth/server-session.ts`;
- `lib/auth/server-acl.ts`;
- `lib/supabase/service.ts`.

Required changes:

- make the ordinary-role actor path user-JWT-first and user-JWT-only;
- remove unconditional service-client queries from profile and company resolution;
- make `assertActorAccess` accept the request-scoped RLS client;
- preserve fail-closed actor status, canonical role, home-company, selected-company, and cross-company checks;
- keep global-admin impersonation/admin lifecycle outside the ordinary route path. If it still needs privileged infrastructure, it remains disabled in this preview rather than loading a service key.

If authenticated Data API privileges are missing, Core must add explicit `GRANT SELECT`/required mutation privileges plus tenant/user RLS policies in a reviewed Core migration. A `SECURITY DEFINER` bypass or service-role fallback is forbidden.

### 3. Page route migration

Minimum read blockers:

- `app/api/crop-structure/bootstrap/route.ts`;
- `app/api/warehouses/route.ts` — `GET`;
- `app/api/warehouses/products/route.ts` — `GET`;
- `app/api/operations/[id]/lines/route.ts` — `GET`.

The same request-scoped contract must also be applied before claiming full page functionality to:

- `app/api/crop-structure/fields/[id]/route.ts`;
- `app/api/crop-structure/fields/[id]/pdf/route.ts`;
- `app/api/warehouses/[id]/route.ts`;
- `app/api/warehouses/[id]/history/route.ts`;
- `app/api/warehouses/[id]/delete-check/route.ts`;
- `app/api/warehouses/products/[id]/route.ts`;
- `app/api/warehouses/transactions/route.ts`;
- `app/api/warehouses/transactions/[id]/route.ts`;
- `app/api/operations/route.ts`;
- `app/api/operations/[id]/material-request/route.ts`;
- `app/api/operation-lines/[lineId]/route.ts`;
- `app/api/operations/reports/potato-material-consumption/route.ts`;
- `app/api/material-requests/route.ts` and its ordinary-user helpers.

Mutation methods must retain the existing role gates and use user-JWT RLS. A108 read smoke performs no mutation and must report `ERP_WRITES=0`.

### 4. Mojibake correction

Core file: `app/(dashboard)/warehouses/page.tsx`.

Replace the corrupted observer badge literals with valid UTF-8:

- Russian: `Режим только чтение`;
- Kazakh: `Тек оқу режимі`;
- English remains `Read-only mode`.

Core must also scan the touched operation/warehouse routes for existing mojibake literals. One confirmed example is the Russian fallback-token list in `app/api/operations/[id]/lines/route.ts`; it must use real UTF-8 words such as `посев`, `посад`, and `уборк`.

## Corrected Core smoke contract

HTTP 200 for a page shell is transport smoke only and can never satisfy `CORE_SMOKE`.

`CORE_SMOKE=PASS` requires all of the following in an authenticated QA User A session:

1. `/crop-structure` finishes loading within 10 seconds, displays season 2026 and the eight QA fields/structure data, and contains no error banner or destructive toast.
2. `/warehouses` finishes loading within 10 seconds, displays two warehouses (`Основной склад`, `Полевой склад`) and real stock rows, with no error banner/toast.
3. `/operations` displays five operations; opening the Field 28 operation card completes the `operation_lines` request with 2xx JSON and the card leaves its loading state without an error toast.
4. No page contains `Supabase service credentials are not configured`, a permanent spinner/skeleton, or a false empty state caused by a failed request.
5. Visible Russian/Kazakh UI contains no known mojibake sequence; the observer badge is valid UTF-8.
6. API responses are validated for status and schema, not only page HTTP status.
7. `SUPABASE_SERVICE_ROLE_KEY`, database/direct/admin credentials are absent from build and runtime.
8. Destination hostname is exactly `gsglkmudcwkdetqtocae.supabase.co`; production connections are 0.
9. Cross-company probes return zero foreign rows.
10. Read smoke leaves the ERP snapshot unchanged: ERP writes are 0.

Core should add a dedicated `qa:core:preview-data-pages` test covering these assertions. The test must use existing QA identities and must not create users or mutate production.

## Rollback

Revert only the Core request-scoped route/session changes and UTF-8 literal correction. Do not restore service-role usage on ordinary user routes. If user-JWT grants/RLS are insufficient, fail closed and keep A108 blocked until the Core migration is reviewed and validated on the test branch.

## Requested Core response

Core should return:

- exact commit containing the route/session/UI correction;
- migration name if grants/RLS change;
- `qa:core:preview-data-pages` result;
- crop structure, warehouse, and operation-card data assertions;
- `SERVICE_ROLE_LOADED=NO`;
- `PRODUCTION_CONNECTIONS=0`;
- `ERP_WRITES=0`.

## 2026-07-18 verification of Core commit 5b5a57c

Commit `5b5a57c8b8490340c92b72e2a74a4ca4404d4613` resolves the original user-JWT/service-role blockers and the visible warehouse mojibake:

- `/crop-structure` renders all 9 structure rows without an error state;
- `/operations` renders 5 rows and its authenticated operation-lines route returns 200;
- service role, database/direct/admin credentials remain absent;
- destination remains exactly `gsglkmudcwkdetqtocae.supabase.co`;
- the three smoke pages contain 0 mojibake matches.

One new Core-owned blocker remains in `app/api/warehouses/balances/route.ts`. The route asks PostgREST to embed:

- `varieties:variety_id (...)`;
- `reproductions:reproduction_id (...)`.

However, `supabase/migrations/20260510093000_add_batch_class_and_identity_flow.sql` explicitly drops both `stock_ledger_entries_variety_id_fkey` and `stock_ledger_entries_reproduction_id_fkey`. Therefore PostgREST has no relationship metadata for either embed. Authenticated browser smoke and Core's own `scripts/qa/smoke-core-preview-data.ts` reproduce HTTP 400: `Could not find a relationship between 'stock_ledger_entries' and 'variety_id' in the schema cache`.

### Required Core correction

Do not add a service role and do not restore a foreign key merely to satisfy PostgREST embedding. Keep the ledger read under the request-scoped user JWT and exact company guard, then resolve display names explicitly:

1. Select ledger rows without `varieties:variety_id` and `reproductions:reproduction_id` embeds.
2. Collect the non-null `variety_id` and `reproduction_id` values.
3. Read `varieties` and `seed_reproductions` with the same user-JWT client using bounded `.in("id", ids)` queries.
4. Build ID-to-name maps and preserve the current response schema, unit conversion, grouping, and numeric totals.
5. Return a fail-closed non-2xx response if any required user-RLS read fails; do not silently return zero balances.

If Core prefers a view/RPC, it must remain invoker/RLS-safe, company-scoped, and reviewed separately. A `SECURITY DEFINER` or privileged credential is not an acceptable substitute.

### Focused acceptance

After the route correction, `qa:core:preview-data-pages` must pass end to end and the authenticated `/warehouses` UI must show:

- 2 warehouses: `Основной склад`, `Полевой склад`;
- `Аммиачная селитра` — `1550 kg` total;
- `Curamin Foliar` — `520 l` total;
- `Phomazin` — `200 l` total;
- no error banner/toast, false zero state, or permanent loading;
- company-B endpoints return 403 and foreign rows remain 0;
- service role, production connections, and ERP writes remain 0.

The A108 manifest does not include this Core route or either referenced migration. Assistant did not modify Core code or schema while producing this proposal.

## Resolution verification at abce1bb

Core commit `abce1bb9e18fc118c68dfc6add6fb31d05ffe81c` removes the legacy PostgREST relationship embeds from the balances route. In the fresh detached A108 preview, Core's route remained unmodified by Assistant and passed both the authenticated Core harness and visible UI smoke.

Verified result: 2 warehouses; 1550 kg ammonium nitrate; 520 l Curamin Foliar; 200 l Phomazin; no error banner/toast; company-B denial; mojibake 0; service role 0; production connections 0; ERP writes 0. This proposal is fulfilled for A108 and has no remaining requested Core action.
