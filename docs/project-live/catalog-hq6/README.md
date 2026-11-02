# HQ-6: prepared implementation for 4,437 accepted catalogue records

Task: `TF_PARTS_PRODUCT_IMPLEMENT_HQ6_4437_20261102`. Checked 2026-11-02. State: **PREPARED_AND_RUNTIME_TESTED, NOT_RELEASED_OR_IMPORTED**. This is the implementation continuation authorised by the owner at 00:45 UTC. The previous HQ-6 research plan limited to 2,466 is historical; the authorised input now comprises 2,466 + 1,965 + 6 accepted records. Pending 5,676 and excluded 2 are omitted.

Target remains the existing Product `bhsemlvmkikpntabctml`, canonical `public.products`. No second global database, QA import, business-row migration, auth reset or broad legacy-schema synchronisation is included. The tests use invented data in disposable local engines only.

## Source and package

- Base: GitHub `TravkinSoft/agri-manager`, `origin/master` at `e4c58aedfa65d681dbcfc8dee74bed7c51085d04`.
- Isolated implementation branch: `codex/catalog-hq6-4437-20261102`. Existing dirty MTM work was not copied, reset or included; the unrelated QA password helper was not used.
- `lib/glbd/catalog-hq6-manifest.json`: adapter HQ6-4437-v1, **package revision/source_version 2**. Release manifest SHA-256: `b0addda787b4684da39dc19517bb2d1d2483d6656df4d9c13c92519dc6b73c14`.
- 4,437 products, 30,413 attribute claims, 15,583 product-scoped source links, 44 makers, 15 categories, 61 parts, each below 900,000 UTF-8 bytes. These are source links per product, not 15,583 distinct publications.
- Raw accepted inputs stay outside Git and are pinned by SHA-256 in the manifest. Source PDFs, full scraped text, screenshots, credentials and business data are absent from the code patch.
- The preliminary, unpublished revision 1 is preserved in headquarters work records. Revision 2 corrects identity derivation: material grade is metadata for an exact MPN, not a second MPN identity. Exact designation identities retain grade. No preliminary revision was imported. This revision does not add/remove accepted research facts.

## Implemented boundary

Three migrations add `catalog_only`, extend the existing product type/shape compatibly, add neutral category/maker/details/evidence tables, and add user-scoped import/search/retirement functions. Old agro defaults and user/unit requirements remain; the new NULLs are allowed only by the new-type conditional check. PostgreSQL UNKNOWN cannot pass it. No source units or dimensions become an accounting unit.

Import creates inactive global drafts with review flags. Restrictive parent SELECT policy closes the previous `user_id IS NULL` opening. The existing private admin schema is not opened to authenticated users. Tables have RLS before explicit grants. Public RPCs are security-invoker, require a genuine active global-admin profile and the current Auth user; service-role execution is revoked. The existing SQL tool's `postgres` identity is not accepted as a fabricated user.

The private reference trigger is the only new SECURITY DEFINER function. It rejects catalogue-only IDs in 22 existing business FK paths, including planned/actual materials, ledger, tickets, balances and master products. It needs visibility of hidden drafts to enforce referential integrity; it has no direct EXECUTE grants. It returns old-product writes unchanged. No existing operational SQL function was replaced.

Each part is one transaction with a logical-key advisory lock, immutable digest, unique exact identity, parent/source/claim FKs and journal fingerprints. A repeated part verifies its saved after-state and returns unchanged. Different digest, existing incompatible identity, altered after-state and unsafe rollback stop with a conflict. Rollback retires only the batch's unchanged new rows; it does not delete old rows or remove schema/enum values.

The CLI pins every part to the approved manifest, requires the exact Product URL and a short-lived real user session, validates `auth.getUser()` and the active profile, and does not auto-load `.env`, persist/refresh sessions, create users or impersonate claims. It stops on an uncertain result; inspect the journal before resuming.

Service-role application readers bypass RLS. `protectLegacyProductReads` excludes only the three new types from legacy `products.select(...)` requests and counts. Other tables and insert/update-returning flows are unchanged. New catalogue search uses the authenticated RPC, exact MPN first and keyset pagination. The prepared service-reader guard **must be deployed and verified before importing**, including any separate runtime using its own privileged client. The dirty local MTM branch is not part of this release and has not been certified against the new catalogue.

## Verified and not verified

- 32 actual PGlite/PostgreSQL runtime scenarios: shape, RLS/roles, all 22 business references, atomic failure, idempotency, evidence FKs, conditional retirement, actor deletion, legacy seed/fertilizer/pesticide/produce compatibility and search cursor.
- 11 separate native PostgreSQL 17.6 tests use two real connections, observe advisory-lock waiting, terminate an uncommitted backend, recover, and verify no duplicate growth. They also test RU/EN filter/oil/bearing search and bounded synthetic payloads. The synthetic 200-record batch took 1,750 ms; a 879,973-byte synthetic payload took 968 ms. These are local engine measurements, not Product/PostgREST latency guarantees. Native receipts are in the headquarters delivery, not evidence of execution in Product. The temporary loopback server was stopped after testing.
- 9 mocked HTTP/manifest boundary groups use the actual Supabase JS query builder; they are not browser E2E.
- Existing TZ-245 material-selector contract: 53/53 passed.
- TypeScript passed. `next build` completed with synthetic configuration and no real Supabase credentials; optional native websocket dependencies, Browserslist data and Realtime bundling emitted warnings. This is a build result, not a signed-in business walkthrough. The additional assistant-model smoke step in the full `npm run build` command was not run. Changed-file lint passed.
- Live read-only checks: 1,631 old products, zero old required-field violations, zero accepted-identity/name/alias candidates; proposed UUID intersection also checked. Thirteen executable privileged SQL functions referencing products are operation writers rather than catalogue list functions; their business-reference writes are covered by the new guard. No public view directly referencing products was found. This is a focused catalogue impact check, not a full product audit.
- **Not performed:** Product DDL/DML import, postflight against new Product rows, authenticated Product catalogue E2E, remote push, app deployment or production release. SQL administration and a successful local test do not count as these outcomes.

## Concrete remaining gates

1. A real existing Product Global Admin session is required. The available browser login successfully opened the **Agronomist** cabinet. The connected SQL channel reports `auth.uid() IS NULL` and `is_active_global_admin()=false`; Product has one active global-admin profile. No role promotion, password reset, claim substitution, new persistent key or new account was attempted.
2. The application read guard is local and must follow the authorised release path before catalogue data is added. Do not assume that committing/pushing a review branch publishes the guard. Do not merge/deploy unrelated dirty MTM or historical QA changes.
3. Immediately before release, refresh the narrow metadata/UUID/actor preflight and old-data fingerprints. Reconfirm the exact explicit grants and approved executing channel; do not use a tool denial as a reason to switch to an unreviewed credential/executor.

## Resume without repeating research

1. Verify this branch/commit, manifest revision **2**, frozen input hashes and approved package directory. Obtain the existing Global Admin session via the normal authorised sign-in path. The session token must remain transient and absent from Git/logs/output.
2. Release/verify the prepared service-reader boundary through the existing authorised application deployment process. Retain the previous deployment for rollback. Do not create a QA catalogue or populate real business tables for a test.
3. Apply `20261102010135_catalog_hq6_accounting_mode.sql` and commit it. Then apply `20261102010136_catalog_hq6_schema.sql`, and `20261102011920_catalog_hq6_search.sql`. Never combine first enum use with its uncommitted addition. Use the migration tool for Product DDL; lock timeout is intentionally short.
4. In the existing authorised environment set only the already-owned configuration: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and transient `TF_CATALOG_SESSION_TOKEN`. Run `npx --no-install tsx scripts/import-catalog-hq6.ts check <package-dir>`, then `apply <package-dir>`. `check` is file validation only. `apply` checks the real Auth user and live active role before RPCs.
5. Read every part receipt, run `postflight.sql` under an identified appropriate actor, compare exact product/source/claim ID-set checksums and journal fingerprints, and compare fresh before/after legacy fingerprints. Check ordinary/admin visibility through the actual application. Repeat the same 61 parts and require total inserted **0**, with no row-count growth and matching identities.
6. Only then mark imported; publication remains a separate action. If a later edit conflicts, stop that part and preserve evidence rather than overwriting it. Retirement RPC is prepared for authorised rollback, not automatically executed by the import script.

Local tests: `npx --no-install tsx scripts/qa-catalog-hq6.ts`, `npx --no-install tsx scripts/qa-catalog-hq6-readers.ts`, `npx --no-install tsx scripts/qa-tz245-global-material-select.ts`, `npx tsc --noEmit --incremental false`. For the native runner, provision a fresh **synthetic-only** PostgreSQL 17.6 cluster at loopback port 55439 with a data directory ending in `/synthetic-data`; install `pg@8.16.3` with `--ignore-scripts` under `scripts/output/catalog-hq6-native/driver`, then run `python scripts/qa-catalog-hq6-native.py`. Stop the cluster afterward. The native test was verified on Windows, not a cloud/Linux deployment. The guard refuses an external database address and does not read a Product URL or credential.

References used for design: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [native PostgreSQL test binary package](https://www.npmjs.com/package/@embedded-postgres/windows-x64). The test binary's pinned SHA-512 is retained with the local runtime receipt.
