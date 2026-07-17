# Core Live State

LAST_UPDATED: 2026-07-17
CORE_BRANCH: `copilot-v1`
CORE_COMMIT: `SELF` (commit, содержащий это обновление Live-state; предыдущий core commit: `65e2d5c`)
PRODUCTION_COMMIT: `321e45fa681fecff89307545d0ec3fa600b4c982`
ACTIVE_SEASON: `2026` для ТОО «Астык-STEM» и `2026 тестовый сезон` для TravkinFlowTest1
PRODUCTION_STATUS: `READY_WITH_CONTROLLED_P1_GAPS`; production работает, но ветка `copilot-v1` содержит ещё не выпущенные изменения, включая ТЗ №136, №138, локальный складской контракт ТЗ №144 и branch-only preview read fix ТЗ №186. После push ТЗ №148 складской scope заморожен как `FROZEN_PENDING_FUTURE_APPLY`; ТЗ №186 не меняет production и требует A108 browser retest.

## Current system status

| Модуль | Статус | Текущая правда |
| --- | --- | --- |
| Поля | READY | В production 100 company-scoped полей; Field остаётся главным производственным объектом. |
| Структура посевов | IN_PROGRESS | В production 122 строки. Основной flow и lazy-load больших компаний проверены; fix сохранения участка «Пар» готов в `copilot-v1` по ТЗ №136, но ещё не выпущен в production. |
| Операции | READY | Создание, роли, материальная сверка и закрытие проверены E2E; формула выдачи и факта контролируется сервером. |
| Склады | FROZEN_PENDING_FUTURE_APPLY | ТЗ №144 локально перевело 15 проблемных writer paths на единый контракт `base_quantity + base_uom + optional mass_kg`, обязательный `batch_class` и доказуемую плотность. ТЗ №148 доказало repeat safety. Commit `c6788b6` отправлен в `origin/copilot-v1`; migration `20260713183038` не применена, backfill не запускался, scope заморожен до отдельного production preflight и approval. |
| Ledger | LOCAL_READY | Новые ledger/balance views разделяют остатки по `product + warehouse + batch identity + base_uom + batch_class`; смешение `kg/l/pcs` блокируется. Legacy-строки читаются как доказанная единица или `legacy/unknown`, без автоматического kg/commodity fallback. Production migration не применена. |
| Весовая | READY | Талон, gross/tare/net, закрытие, история, PDF и company label проверены. Весовая является источником правды по массе. |
| Crop Care | LIMITED | Schema/API foundation присутствует; полный production workflow и данные компании не закрыты отдельным end-to-end acceptance. |
| ГЛБД | TZ185_BATCH1_APPLIED | Исправленный Batch 1 применён с owner approval: 20 safe + 7 owner cards, 9 legacy subcategories, 4 formulations, search 50/50, repeat apply 0. Production GLBD теперь 432 components / 100 product aliases / 336 sources / 1389 links; company links `0`. |
| Сезоны | LIMITED | Контекст 2026 используется. В live есть несколько исторических season rows с `archived=false`; принудительный read-only режим закрытого сезона требует отдельной проверки. |
| Пользователи и роли | READY | Company isolation, role switcher и основные роли Test1 проверены. Доступ всегда должен подтверждаться серверной сессией и RLS/ACL. |
| Travkin Assistant | A107_READY_BRANCH_ONLY | TZ-177 applied the canonical catalog security migration only to `gsglkmudcwkdetqtocae`. Real JWT catalog CRUD and tenant-isolation gates pass, and the TZ-176 ERP Ground Truth is unchanged. A107 may start only on this branch; production memory migration, merge and deploy remain disabled. |

## Current database state

### TZ-186 branch-only Core preview reads

- Crop structure, warehouse list/products, warehouse balances and operation-line GET paths now use the signed-in user's Bearer JWT plus RLS instead of requiring a service-role key.
- Warehouse balances read `stock_ledger_entries` through a new context-aware endpoint with exact resolved `company_id`; the browser no longer reads the non-security-invoker balance view directly.
- QA branch `gsglkmudcwkdetqtocae` ground truth remains `9` crop rows, `2` warehouses, `5` operations and exact `1550 kg / 520 l / 200 l` balances; company B operations are `0` for its isolated fixture.
- Typecheck and production build pass. Local no-token smoke returns `401` without the old service-credential error, service-role env is absent, mojibake is `0`, and production/ERP writes are `0`.
- Full signed-user data/UI acceptance is intentionally deferred to A108 because QA JWTs/passwords were not persisted and no service credential was used to mint or reset access. `READY_FOR_A108_RETEST=YES`.

### TZ-185 corrected pesticide Batch 1 production apply

- Fresh backup and 12-file manifest passed at `C:/Users/TRAVKIN/Downloads/CodecSaaS/audit-output/TZ-184/backups/pesticide-batch-one-20260717T143023716Z/`; live fingerprint matched the TZ-184 baseline before apply.
- One approved transaction processed `20` SAFE_AUTO_APPLY and `7` owner-approved physical cards. Product rows updated `11`, legacy subcategories normalized `9/9`, formulations assigned `4/4`, timestamps outside scope `0`.
- Celest Top is the active survivor; Smerch has glyphosate only with potassium salt as equivalent basis; short Ордан/Фунгоцеб/Кассиус rows are archived and aliased to survivors; Black Jack is inactive but not deleted.
- HOLD `Дитан/Метамил/Курзат` and all `15` unresolved cards are unchanged. Product duplicates, alias conflicts, active link duplicates and company links lost are `0/0/0/0`.
- Search is `50/50`, controls `6/6`; second apply is a true no-op with `0` changes. Final fingerprint is `d1a340df99bbe8f7aec4dbd093074d1816fabba874868afc4a24c541547e3eeb`.
- Final production counts: products `1231`, product aliases `100`, formulations `6`, components `432`, component sources `336`, component links `1389`, legacy links `1372`, company links `0`.
- Supabase is `ACTIVE_HEALTHY`; six critical routes returned HTTP `200`. Rollback, migration, db push, deploy and merge were not performed.

### TZ-184 corrected pesticide Batch 1 package

- Failed TZ-183 transaction rollback confirmed: production fingerprint remains `bf07323460e43153accf2b4cfc29ed265b2238a45f80493864600c9038b241f2`; Batch 1, HOLD and unresolved rows are unchanged.
- Exact `products_product_subcategory_check_v1` permits pesticide `NULL` or `herbicide/fungicide/insecticide/acaricide/desiccant/seed_treatment/growth_regulator/other`; the constraint was not changed or relaxed.
- Four requested formulation cards are exact-ID mapped: Каратэ Зеон `SC/insecticide`, Хакер 300 `SL/herbicide`, Золотой Дракон `SL/herbicide`, Амплего `CS/insecticide`.
- Full update-target review found nine invalid legacy subcategories. Five additional exact rows are normalized without inventing new business meaning: Ордан/Fунгоцеб to `fungicide`; archived Кассиус, inactive Black Jack and the inactive safe-review row to `NULL`.
- Production-equivalent PGlite acceptance passed first apply, `0` constraint violations, search `50/50 + 6/6`, second apply with `0` changes and exact rollback fingerprint/timestamps. Component and company links were preserved except the approved Smerch salt cleanup.
- External package and verified manifest: `C:/Users/TRAVKIN/Downloads/CodecSaaS/audit-output/TZ-184/`. Production writes, migration, deploy and merge are `0`.
- `READY_TO_RETRY_BATCH_1=YES` only through a new numbered owner-approved apply task with fresh backup and live no-drift preflight. TZ-183 must not be rerun.

### TZ-181 pesticide Batch 1 review

- Exact TZ-180 Batch 1 scope `45/45` reviewed; duplicate and unclassified rows are `0`.
- Classification: `20 SAFE_AUTO_APPLY`, `10 OWNER_APPROVAL_REQUIRED`, `15 UNRESOLVED`.
- Safe data preview contains `17` source-backed component links and `4` assignments to existing canonical formulation rows. Component duplicate and alias conflict previews are `0`.
- Search preview uses existing localized product names and database aliases without creating alias rows. All `50/50` prior failing target scenarios pass; `20` scenarios across ten RU queries require disambiguation because more than one catalog row matches.
- `Celest Top` and `Селест Топ, КС` are one likely source-backed identity, but merge remains owner-gated and was not executed.
- External artifacts and verified manifest are at `C:/Users/TRAVKIN/Downloads/CodecSaaS/audit-output/TZ-181/`. Two complete runs produced fingerprint `49774e39ff293e24490b0c7ae90d7b23e7c88b10f845eeaf12b6846242a9e580` and byte-identical manifests.
- Production writes, product merges, component/alias inserts, migrations, deploy and master merge are `0`. Next safe action is owner review of the ten decisions and explicit approval of a selective apply subset; the fifteen unresolved cards remain blocked.

### TZ-180 global pesticide-card completeness audit

- Production read-only preflight passed at `431` components, `63` aliases, `318` sources, `1373` product links and `0` company links; active duplicates and mojibake are `0`.
- Exact live scope contains `852` global active pesticide cards. All `852` were audited and classified once; duplicate rows and unclassified products are `0`.
- Readiness is `0` complete, `776` ready with minor gaps, `12` blocked component, `2` blocked identity, `0` independently blocked formulation, `38` blocked source and `24` owner review.
- Main gaps are regulatory `852`, product source/confidence `850`, component-link source `818`, usage rules `821`, manufacturer `799`, EN alias `789`, missing components `34` and missing formulations `16`.
- Real catalog-helper search ran `1059` scenarios: `1009` pass and `50` fail across `24` unique cards. Known Curamin/Phomazin RU/EN cases pass and remain fertilizer-scope, outside pesticide counts.
- External artifacts and verified manifest are at `C:/Users/TRAVKIN/Downloads/CodecSaaS/audit-output/TZ-180/`. Two complete runs produced the same fingerprint `2d74a26055cbad5a1466b591dc77ffc2926364ccafa06cf2d26f44f05401f696`.
- Batch plan is non-overlapping: P0 `45`, P1 `0`, P2 `807`. P1 is zero because all 16 formulation gaps already carry higher-priority P0/owner blockers.
- Production writes, component-link changes, migrations, deploy and merge are `0`. Next safe action is a source-backed, read-only Batch 1 review package.

### TZ-179 production selective component apply

- Owner-approved пакет ТЗ №178 применён к production project `bhsemlvmkikpntabctml` одной транзакцией после fresh backup, SHA-256 manifest verification и live no-drift preflight.
- Exact scope: `53` решения (`3` direct attachments, `33` alias decisions, `6` safeners, `10` inactive decisions, `1` rejected source); физически добавлены `39` aliases и `23` source rows. `Humic acids / Гуминовые кислоты` не изменена.
- Production state: components `431`, aliases `63`, sources `318`, product links `1373`, company links `0`. Product rows и company/business data не менялись.
- Component duplicates, alias conflicts, active link duplicates, garbage components и mojibake равны `0`. Все шесть safeners проходят RU/EN search, API JSON и реальный UI display helper; inactive rows скрыты от обычного поиска и доступны raw Global Admin catalog read.
- Повторный apply прошёл как точный no-op: counts и полный SHA-256 fingerprint `d58c6ae8c277bcd350764199cf9ed38c1cf7ed4fe16cff3503c10dc7cfab9bc4` не изменились.
- Production route smoke вернул HTTP `200` для component catalog, `/references`, `/operations`, `/crop-structure`, `/warehouses/requests` и `/weighbridge`. Rollback не потребовался; production остаётся `ACTIVE_HEALTHY`.
- Migration, db push, deploy и merge не выполнялись.

### TZ-178 reproducible UTF-8-safe component package

- Production read-only baseline remains exact: `425/24/295/1373`, company links `0`, server/client encoding `UTF8`, Humic acids unchanged and project `ACTIVE_HEALTHY`.
- The retained TZ-173 failed snapshot contains `64` mojibake values (`61` unique). Root cause remains Windows PowerShell 5.1 ANSI-default decoding of BOM-less UTF-8 before database serialization.
- `scripts/catalog/rebuild-component-utf8-package.mjs` now enforces strict fatal UTF-8 decoding, rejects BOM input, normalizes NFC, emits ASCII-only SQL with PostgreSQL Unicode literals, verifies task tokens and regenerates/rechecks the SHA-256 manifest.
- External package path: `C:/Users/TRAVKIN/Downloads/CodecSaaS/audit-output/TZ-178/apply-package/`. It preserves all `53` decisions and exact UUIDs; `4655` package text values have mojibake `0`.
- Production-equivalent PGlite acceptance with the real `component-discovery` helper passed. First apply reached `431/63/318/1373`, all `18127` DB text values were clean, RU/EN/API/UI checks passed, second apply was a true no-op and exact rollback restored the baseline fingerprint and timestamps.
- Production writes, QA dataset changes, migration, db push, deploy and merge are `0`. `READY_FOR_SELECTIVE_APPLY=YES` technically, subject to a separate TZ-179 with fresh backup, no-drift preflight and explicit owner approval.

### TZ-177 Assistant QA branch security alignment

- The approved migration `20260716114950_catalog_rls_function_security_hardening.sql` was applied only to `assistant-memory-a106` (`gsglkmudcwkdetqtocae`) from an isolated CLI workdir with exactly one pending version. SHA-256 matched `1c8d9d7633b2515e45da60609e076984a05247911b556b1009896efd78d27448`.
- Branch target state is RLS `8/8`, policies `32`, public SECURITY DEFINER functions hardened `27/27`, `PUBLIC` execute `0`, anon execute `0`, and exactly five authenticated browser/session functions.
- Real JWT User A/User B/company-admin/global-admin/anon acceptance passed. Ordinary and company-admin users may read global aliases but cannot mutate them; global-admin CRUD passed; cross-company reads remain denied.
- The ERP QA dataset was not recreated and remains exact: `8` fields, `1000 ha`, `9` crop rows, `5` operations, warehouses `2+1`, ledger `6+1`, company-A balances `1550 kg / 520 l / 200 l`, and isolated company-B balance `777 kg`.
- Temporary JWT-test users, profiles and aliases were removed with residue `0`. Production was read-only and remains `ACTIVE_HEALTHY`; production writes, deploy, merge and master changes are `0`.
- `TZ-A107` may now start only on this isolated branch. Production Assistant migration, memory writes, merge and deploy remain disabled.

### TZ-176 Assistant QA Dataset V1

- TZ-175 had stopped before writes because the isolated branch lacked canonical Gala/R1/product references. TZ-176 created Gala, R1, three global products and five aliases only on `assistant-memory-a106`; the second reference seed created zero rows.
- The branch now has two preserved QA tenants, eight company-A fields totalling 1000 ha, nine crop rows, five operations, two company-A warehouses and one isolation warehouse. Canonical ledger balances are 1550 kg ammonium nitrate, 520 l Curamin Foliar and 200 l Phomazin; company B has an isolated 777 kg balance.
- Dataset second seed is a no-op. Exact cleanup and full reseed passed. Real JWT A/B tests denied cross-company fields, warehouses, operations, ledger, chats and memories in both directions.
- The TZ-176 alias-RLS blocker was resolved by the separately approved TZ-177 branch-only security alignment. The original failed mutation evidence remains valid as the pre-apply baseline; the repeated real-JWT gate now passes.
- Production schema, Auth, business data, migration history, merge and deploy were unchanged. Permitted production access was read-only reference verification only.

### TZ-174 UTF-8-safe component package

- Root cause TZ-173 confirmed: valid BOM-less UTF-8 SQL was decoded by Windows PowerShell 5.1 without explicit `-Encoding UTF8` before it reached PostgreSQL. Production `client_encoding` remained `UTF8` and was not the corruption source.
- The external package preserves exactly 53 decisions and excludes Humic acids from both SQL scripts. `4012` package text values are NFC-normalized; mojibake is `0`.
- Human artifacts are strict UTF-8. Apply and rollback SQL are ASCII-only and encode every non-ASCII value with PostgreSQL `U&` literals, making the executable bytes code-page independent.
- Production-equivalent isolated replay loaded the 425/24/295/1373 snapshot and real GLBD constraints/triggers. First apply reached 431/63/318/1373; all six safeners passed source, alias, product-role, RU/EN search, API JSON and real `component-discovery` UI-helper checks.
- Component duplicates, alias conflicts, link duplicates and active garbage components are `0`. Second apply is a true no-op. Exact rollback restored fingerprint `16b1932a2481f5ec3d8f84e6fc0038a46f99d3f5997b2f1fefe23a083050187e`, including timestamps.
- Package path: `C:/Users/TRAVKIN/Downloads/CodecSaaS/audit-output/TZ-174/apply-package/` outside Git. Production database, business data, migration history, deploy and master are unchanged.
- `READY_FOR_NEW_SELECTIVE_APPLY=YES` technically, but a separate owner-approved task with fresh backup and live preflight is mandatory.

### TZ-173 safe component-source apply stop

- Fresh external backup and SHA-256 manifest were verified before the approved write. Live preflight passed for 54 blocked rows, 53 apply rows and one excluded Humic-acids HOLD.
- The exact TZ-172 package applied transactionally and its second apply was a true no-op. Database duplicate, alias, source and link checks passed.
- Required app-helper smoke failed because six new safener Russian labels were mojibake; EN search passed but RU alias/exact search failed.
- Failure handling rolled the package back immediately. A guarded timestamp-only restore also reversed trigger-written `updated_at` values.
- Final byte-for-byte snapshots match the pre-write backup for components, aliases, sources, product links and product identity. Current counts are `425/24/295/1373`, active components `415`, company links `0`, and schema fingerprint is unchanged.
- Production is `ACTIVE_HEALTHY`; seven critical routes returned HTTP 200. No deploy, migration, master merge or company/business-data change occurred.
- `READY_FOR_NEXT_GLBD_STAGE=NO`: regenerate and independently validate a UTF-8-safe package in a separate approved task. `Humic acids / Гуминовые кислоты` remains `HOLD_OUT_OF_SCOPE`.

### TZ-171 production catalog security hardening

- Owner-approved migration `20260716114950_catalog_rls_function_security_hardening.sql` was applied to production in its explicit transaction after a fresh verified backup and no-drift live preflight.
- The isolated CLI apply set contained exactly one pending version. Production history is now `136` with head `20260716114950`; Warehouse Units V2 and Assistant Memory Policy V2 were not applied by this task.
- Final security state is RLS `8/8`, policies `32`, wide write policies `0`, public SECURITY DEFINER functions `27/27` with safe search paths, and `PUBLIC`/anon execute `0/0`.
- Real signed production JWT acceptance passed `178/178`; cross-company access was denied, global-admin CRUD and own-company sync passed, and private helpers remained absent from the Data API (`404`).
- Complete public-table and target-table row counts are unchanged. Fingerprint differences are limited to the approved RLS, policy, function and grant scope; rollback was not required.
- Catalog smoke and eight critical production routes passed. Production and `assistant-memory-a106` remain `ACTIVE_HEALTHY`; the assistant branch was not touched. Core may return to GLBD work.

### TZ-172 blocked component source classification

- All `54/54` blocked rows were classified exactly once: attach existing `3`, aliases `33`, safener leaders `6`, biological `0`, keep inactive `10`, garbage `1`, owner review `1`.
- The owner HOLD is `Humic acids / Гуминовые кислоты`; no production action is generated for it.
- Six canonical safener identities are source-backed. One related mislabeled Cloquintocet-mexyl legacy component and its six exact links are included to prevent a new visual duplicate.
- The guarded package plans 6 component inserts, 23 source inserts, 39 alias inserts, 103 exact link normalizations and 41 non-destructive archives. Products and company data are outside scope.
- Isolated first apply, second-apply NOOP and exact rollback pass. Component, alias, link and source duplicates are zero; garbage/manufacturer components are zero; RU/EN search passes; links remain `1373`.
- Audit package: `C:/Users/TRAVKIN/Downloads/CodecSaaS/audit-output/TZ-172/` outside Git. Production schema, catalog data, business data, migration history, deploy and `master` are unchanged.
- `READY_FOR_SELECTIVE_APPLY=YES_WITH_OWNER_APPROVAL_AND_HUMIC_HOLD`.

### TZ-170 production-safe catalog security candidate

- Root cause of the TZ-168 safe stop is confirmed: security migration `20260716114950_catalog_rls_function_security_hardening.sql` depended on schema `private`, which existed in the TZ-167 branch only because Assistant Memory V1 had created it. Production intentionally has no Assistant Memory objects and no `private` schema.
- The same unapplied migration version is now self-contained: it creates and owns `private`, revokes `PUBLIC`/anon access, grants only required schema usage, and creates all three private helpers before policies or wrappers reference them.
- A fresh local PostgreSQL 17.6 environment replayed the exact 133-migration production head (`2556` statements), without Warehouse Units V2 or Assistant Memory. Semantic parity with production tables, columns, constraints, indexes, functions, triggers, views and policies passed with zero unexplained differences.
- The corrected migration passed atomic rollback, first apply and identical second apply. Final target state is RLS `8/8`, policies `32`, public SECURITY DEFINER functions `27/27` with safe search path, `PUBLIC` execute `0`, anon execute `0` and exactly five authenticated browser/session functions.
- Local PostgREST 14.15 and signed JWTs passed the unchanged TZ-167 matrix `178/178`; cross-company sync was denied, the private helper was not exposed (`404`), and service-role import passed inside a rolled-back transaction. Business row counts remained unchanged and rollback restored the original target state.
- Production stayed `ACTIVE_HEALTHY`: migration/history/schema/business data were not changed. `assistant-memory-a106` stayed `ACTIVE_HEALTHY` and was not used or changed. A new owner-approved production apply must be a separate TZ-171 with fresh backup and live preflight.

### TZ-169 Contract 0.4 and branch-only Memory Policy V2

- Contract advanced from `0.3` candidate-first to `0.4` direct-approved behavior. The six safe USER_GLOBAL types are name, preferred address, language, response style, response brevity and durable work preference.
- COMPANY memory is limited to rules, terminology and stable process preferences. Only an active owner, `company_admin`, `director`, or `global_admin` in the actor's own profile-company can mutate it. Ordinary employees can read same-company memory but cannot create company-wide truth.
- CONVERSATION state remains chat-local in versioned `chat_messages.metadata`; it is not promoted automatically into long-term memory.
- Migration `20260716125205_assistant_memory_policy_v2.sql` was applied only to `assistant-memory-a106` (`gsglkmudcwkdetqtocae`). Branch history advanced from `135` to `136`; production history stayed `135` and production still has no `assistant_memory_events` table.
- Real request-scoped JWT tests passed all `10/10` owner scenarios. Additional checks proved company-admin create/update/delete in its own company, cross-company read/update/delete denial, foreign-company spoof denial, and restoration of the temporary QA role to `agronomist`.
- The test migration preserves five V1 QA rows as `legacy_v1`; one old candidate remains legacy-only and no new candidate was created. Test memories/chats were cleaned up; content-free audit events remain as branch acceptance evidence.
- A106 may sync Contract 0.4 and continue only on this branch. A107 has not started. Production schema/data/Auth, ERP data, merge and deployment were not changed.

### TZ-168 production security apply safe stop

- Owner-approved migration `20260716114950_catalog_rls_function_security_hardening.sql` was attempted only after a verified backup and exact no-drift preflight.
- Apply stopped atomically at the first DDL statement with SQLSTATE `3F000`: production has no schema `private`, so `private.is_active_global_admin()` cannot be created.
- The dependency came from branch-only Assistant Memory V1: the TZ-167 test branch contained `private`, while production intentionally does not contain that Assistant schema scope.
- Repeat fingerprints prove zero production change: history remains `135`, target migration is absent, target RLS remains `0/8`, policies remain `0`, all 27 definer functions and all business row counts are unchanged.
- Production and `assistant-memory-a106` remain `ACTIVE_HEALTHY`; six critical routes returned HTTP `200`. JWT/post-apply acceptance was not run because the migration is not installed.
- Current candidate must not be retried unchanged. A separately approved revision must remove the hidden branch-only schema dependency and repeat isolated production-equivalent acceptance.

### TZ-167 isolated RLS and function hardening

- A separate data-less branch `core-security-tz167` (`shwhfrceabafxbmaivzk`) bootstrapped all `135/135` canonical migrations and was deleted after acceptance to stop hourly cost. The protected `assistant-memory-a106` branch was not changed.
- Six global reference tables now have authenticated read plus active-global-admin-only write policies in the candidate migration. Two internal equipment staging/review tables are denied to ordinary/company roles and available only to the active global-admin process. No artificial company scope was introduced.
- All 27 public `SECURITY DEFINER` functions have deterministic non-writable search paths in the candidate. `PUBLIC`/anon execute is zero; authenticated execution is limited to five proven session/browser functions; import RPCs are service-role only.
- The browser treatment-program sync now uses a guarded wrapper: company admin/agronomist/director may sync only their own company, global admin/service role retain authorized access, and cross-company calls are denied.
- Branch acceptance passed first and second migration apply, `178/178` real-JWT checks, service-role control, typecheck, production build and diff check. Exact apply/rollback previews are in `audit-output/TZ-167/`.
- Production schema, migration history, Auth, business data, deployment and master were not changed. The new migration requires a separate production preflight, backup and explicit owner approval.

### TZ-166 canonical history and A106 branch

- Owner-approved metadata repair changed only
  `supabase_migrations.schema_migrations`: `39` canonical rows were preserved,
  `37` existing payloads were updated and `59` missing versions were inserted.
  Remote history is now canonical `135/135`; a second repair changes `0` rows.
- Fresh backup is verified outside Git at
  `audit-output/TZ-166/pre-repair-backup/`; manifest SHA-256 is
  `c905087d55e8ced333e2802bcb51b97c1affaab06803b29db23c6057ceb090a2`.
- Production schema and business-count fingerprints did not change. No
  migration SQL, `db push`, deploy or master merge was executed. Production
  stayed `ACTIVE_HEALTHY`; critical route smoke returned HTTP 200.
- The new data-less branch `assistant-memory-a106` has reference
  `gsglkmudcwkdetqtocae`, status `FUNCTIONS_DEPLOYED` and preview project status
  `ACTIVE_HEALTHY`. Bootstrap processed all `135/135` versions with no error.
- Production-head replay through version 133 matches production semantically.
  The full branch additionally contains the explained non-production Warehouse
  Units V2 and Assistant Memory V1 scopes; unexplained schema differences are
  zero, but exact branch/production schema equality is therefore false.
- `chats`, `chat_messages`, `assistant_memories` and
  `assistant_memory_events` exist on the branch with RLS, indexes, policies and
  foreign keys. Legacy permissive public chat policies remain a known A106
  real-JWT acceptance risk and were not changed in this database-only task.
- TZ-A106 may now start on this isolated branch only. Production memory writes,
  migration, merge and deploy remain disabled. The two production-history
  entries for Warehouse V2 and Assistant Memory V1 need a separate owner
  decision before any future automated production migration run.

- TZ-165 applied the owner-approved guarded repair to exactly 39
  `supabase_migrations.schema_migrations.statements` rows. The other 37 rows,
  production schema and exact counts of all 145 public tables were unchanged;
  the second repair changed 0 rows and rollback was not required.
- A new data-less `assistant-memory-a106` branch (`xhlfixtoubejuxnpdzyx`) was
  created after the repair, but bootstrap failed at history version
  `20260413182000`: its stored payload calls
  `public.ensure_updated_at_column()` without creating the helper. Evidence was
  captured and the failed paid branch was deleted. A106 remains blocked.
- The next safe database action is a separate owner-approved canonical
  metadata task for the remaining history payloads and missing versions. It
  must use the tested 135-row preview, fresh backup and guarded rollback; no
  production migration SQL is permitted.

- TZ-164 restored canonical migration sources for all ten production baseline
  gaps: seven tables, one import function and two triggers. Production-head
  replay passes `133/133`, the complete local chain passes `135/135`, and the
  semantic catalog has zero unexplained differences from production.
- The refreshed guarded metadata package passes repair `39`, second repair `0`
  and exact rollback with the other `37/37` rows unchanged. A separate full
  135-row metadata preview also passes, but no history repair was executed.
- `READY_FOR_METADATA_REPAIR=YES` is a technical readiness result only. A fresh
  backup, final live hashes and explicit owner approval remain mandatory.
- Legacy baseline tables still have production RLS disabled; import functions
  are security-definer with broad execute grants. This is recorded P1 security
  debt for a separate hardening task, not silently changed during parity work.

- Supabase project: `bhsemlvmkikpntabctml`.
- GLBD V2 после ТЗ №151: components `425`, product links `1373`, aliases `24`, sources `295`, company links `0`. Components, product links и company scope совпали с pre-import backup.
- Remote migration history: 76 записей; head `20260712203746` (`glbd_component_model_v2`). TZ-155 proved 38 homogeneous malformed `statements[]` payloads (`20260305200628`-`20260404153413`). TZ-156 resolved the separate `20260610123000` drift as `LOCAL_FILE_IS_CANONICAL`; its history still contains the older two-statement draft. No history row was changed.
- Восемь ранее отсутствовавших версий `20260623170000`–`20260712203746` уже синхронизированы с remote history без повторного запуска migration SQL.
- ТЗ №140 синхронизировало 6 проверенных `SUPERSEDED` versions: `20260412234000`, `20260413182000`, `20260417103000`, `20260430110000`, `20260510110000`, `20260521100500`. Выполнялся только официальный history repair; migration SQL не запускался.
- После ТЗ №140 остаётся 57 старых local-only migration-history позиций из программы аудита ТЗ №135. ТЗ №142 подробно классифицировало 15 из них с неполным результатом: 7 schema-only corrections, 2 schema+data corrections и 6 superseded intents. Ни одна версия не repaired/applied.
- `db push`: **НЕ РАЗРЕШЁН** до отдельного owner-approved batch plan по старым migration versions.
- Активные блокеры DB-процесса: для 15 неполных версий есть batch roadmap, но нет owner approval на apply; остальные local-only versions также нельзя repair/apply массово. TZ-156 resolved `20260610123000`, but its history metadata is still unrepaired. TZ-157 canonicalized local migration `20260509142000`; no migration SQL or history repair was executed. Повторное исполнение старого SQL запрещено.
- Последний подтверждённый migration-history backup: `C:\Users\TRAVKIN\Downloads\CodecSaaS\audit-output\TZ-140\backups\migration-history-20260713T161533631Z`; manifest SHA-256 `60dde2ad4d9150c42babf01485c183017611c7bf2245468d8a90c086eb0fb683`. Backup содержит все 70 pre-repair history rows со statements, local/remote inventories, hashes шести файлов и evidence ТЗ №137; это не полный PITR backup бизнес-данных.
- Post-repair read-only snapshot ТЗ №140: products 1231; fields 100; crop_structure 122; operations 8; warehouses 2; legacy AI 425/1373; GLBD V2 425/1373. Public schema, variety и crop-identity fingerprints совпали с pre-repair snapshot.

## Current source-of-truth rules

- `Field` — главный объект, к которому привязываются сезон, структура и производственные факты.
- `crop_structure` — план использования площади, культуры, сорта и репродукции в сезон.
- `operation` — производственный процесс и подтверждённый факт выполнения.
- Warehouse ledger — единственный источник складской правды; UI balance не должен жить отдельно от ledger.
- Weighbridge ticket — источник правды по массе; `net = gross - tare`.
- Любой company-scoped read/write обязан использовать выбранную компанию и активный season context.
- Закрытый сезон должен быть read-only. Полнота enforcement пока отмечена как `LIMITED`.
- Вода — технологический объём баковой смеси, а не складской материал и не строка расхода продукта.

## Current API and data contracts

Подтверждены только уже существующие server surfaces:

- Server actor берётся из сессии. Обычный пользователь работает только со своей компанией; global admin может использовать явно выбранный company context там, где route вызывает `resolveCompanyForActor`/server ACL.
- `GET /api/references/company-assets` возвращает только active, non-archived machines/equipment/vehicles выбранной компании и canonical model joins.
- `GET /api/crop-structure/bootstrap` загружает стартовый company/season список; `GET /api/crop-structure/fields/[id]` загружает детали только открытого поля.
- `GET /api/tasks/operation-identities` берёт crop/variety/reproduction из связанной `crop_structure`, с fallback на operation line.
- Material flow идёт через `/api/material-requests/**` и `/api/operations/**`: ledger OUT только после warehouse issue, ledger IN только после warehouse return acceptance; закрытие требует `issued = consumed + returned + loss` и завершённую сверку.
- После применения migration `20260713183038` все новые warehouse writers обязаны использовать общий server resolver `resolveWarehouseStockContract`: canonical units `kg/l/pcs`, обязательный `batch_class`, `mass_kg` для жидкости только с verified density evidence. До отдельного production preflight этот контракт остаётся локальным и не меняет live DB.
- `GET /api/weighbridge/resources` возвращает company-scoped vehicles и допустимых responsible persons; `/api/weighbridge/tickets/**` хранит и закрывает талон; company label берётся из записи талона.
- GLBD legacy и V2 находятся в production параллельно. Наличие V2 не разрешает ассистенту или UI самовольно переключать read path.
- `GET /api/global-admin/catalog/active_ingredients` в `copilot-v1` дополняет legacy IDs каноническими GLBD names/aliases, а запрос с `componentId` лениво возвращает только активный компонент и его подтверждённые sources. Списки и selects не загружают source rows.
- Legacy `/api/assistant/**` в core не становятся автоматически разрешёнными. Contract 0.3 сохраняет восемь read-only tools и отдельно разрешает A106 memory mutations только в assistant chat/memory tables изолированного non-production контура; merge, production migration, memory writes и deployment не разрешены.

## Known P0/P1 issues

### P0

- Legacy `operations/confirm-draft` не применяет канонические operation-create права и защиту сезона; маршрут запрещён Travkin Assistant до отдельного core fix.
- Knowledge Base DELETE не доказывает company ownership документа перед service-role mutation; KB mutations запрещены Travkin Assistant до отдельного core fix.

### P1

- 57 старых migration-history позиций остаются в staged audit/repair program; массовый repair запрещён.
- Шесть `SUPERSEDED` versions ТЗ №137 синхронизированы ТЗ №140. Остальные версии не получили автоматического статуса и требуют отдельного доказательства.
- Material request crop/product identity отображается не полностью единообразно во всех экранах; canonical IDs и warehouse flow не должны заменяться UI fallback-текстом.
- Fix участка «Пар» (ТЗ №136) и canonical varieties migration (ТЗ №138) находятся только в `copilot-v1`, production их ещё не получил.
- Closed-season read-only enforcement не подтверждён как полный для всех write routes.
- Полный GLBD V2 product-link cutover ещё не выполнен: product identity и concentration продолжают использовать проверенные legacy links, а ТЗ №152 добавляет только каноническое отображение/поиск и lazy source cards.
- Alias/source read path ТЗ №152 находится только в `copilot-v1`; production UI ещё не получил этот код. 54 заблокированные source-строки не импортированы и fallback на них отсутствует.
- Складская базовая единица и batch identity: ТЗ №144 локально подготовила additive schema, единый resolver, исправления 15 writer paths и unit-aware views; isolated migration/E2E PASS. Migration ещё не применена к production, а 7 inventory/7 ledger legacy rows не backfill-ились. Перед production нужен отдельный backup, live preflight, preview E2E и owner approval.
- Land legal MVP не имеет трёх integrity guards. Live duplicate preflight чистый и land tables пусты, но до начала реального ввода нужен отдельный schema-only corrective batch.
- Для A106 отсутствует безопасный non-production Supabase branch. Owner-approved `assistant-memory-a106` creation reached `MIGRATIONS_FAILED`, evidence was saved, and the paid branch was deleted. A106 remains blocked until migration-history recovery is split and approved; production project нельзя использовать для memory acceptance.

## Current tasks

| ТЗ | Статус | Результат |
| --- | --- | --- |
| №173 | BLOCKED_SAFE_STOP | Approved 53-row GLBD package passed backup/preflight and DB checks, but RU safener-label catalog smoke failed. Exact rollback restored `425/24/295/1373`; Humic acids remains HOLD_OUT_OF_SCOPE. |
| №136 | DONE | Fix сохранения участка «Пар», commit `e36ab0a` в `origin/copilot-v1`; production release не выполнен. |
| №138 | DONE | Canonical global varieties migration, commit `4eb2d58` в `origin/copilot-v1`; production release не выполнен. |
| №139 | DONE | Создана Project Live и handoff foundation, commit `3ef0afe` в `origin/copilot-v1`; app/DB не менялись. |
| №140 | DONE_IN_THIS_COMMIT | Commit ТЗ №138/139 сохранены в origin; 6 history versions repaired; schema/business data не изменились; осталось 57 local-only versions. |
| №141 | DONE | Созданы изолированные branch/worktree и Live sync protocol для Travkin Assistant; runtime не запускался. |
| №142 | DONE_IN_THIS_COMMIT | Read-only аудит 15 неполных миграций: P0=0, P1=3, P2=12; подготовлены 8 безопасных corrective/supersession batches; DB не менялась. |
| №143 | DONE_IN_THIS_COMMIT | Read-only план складских единиц и batch class: 18 writer-сценариев, universal quantity contract, corrective migration preview, точечный план 7+7 строк, E2E и rollback; DB/app code не менялись. |
| №144 | DONE_IN_THIS_COMMIT | Локально созданы additive migration `20260713183038`, единый unit/batch resolver, исправления 15 writer paths и unit-aware ledger views; isolated migration/E2E PASS, production и legacy rows не менялись. |
| A100 | DONE | Проведён статический аудит legacy Assistant runtime; выявлены потеря history/context и два core P0. |
| A101 | DONE | На `assistant-v1` реализован изолированный read-only foundation: 8 tools, user JWT/RLS, mocked QA 16/16, typecheck/build PASS; production не менялась. |
| №145 | DONE_IN_THIS_COMMIT | Core принял A100/A101, обновил Integration Contract до 0.2 и зарегистрировал A102 только для локальной read-only проверки. Assistant code не объединялся. |
| A102 | DONE_WITH_FINDINGS | Real Local Runtime Validation завершён на `assistant-v1`: 14/20 PASS, Supabase GET 37, DB writes 0. До отдельного fix/rerun заблокированы Assistant acceptance, merge и deploy. |
| A103 | DONE | Все 20/20 read-only acceptance scenarios PASS на `assistant-v1`; DB writes 0, foreign rows 0, contract остаётся 0.2. Merge/deploy/write capability по-прежнему требуют отдельного approval. |
| №147 | DONE_IN_THIS_COMMIT | Создан отдельный подтверждённый QA Auth-user `Assistant QA Test1`: только TravkinFlowTest1, `agronomist`, не global/company admin. JWT сохранён только в ignored Assistant `.env.local`; RLS read/cross-company denial PASS, business data/schema unchanged. |
| №148 | DONE_IN_THIS_COMMIT | Migration `20260713183038` сделана definition-aware и безопасной при повторе: first/second apply PASS, schema fingerprint и row counts совпадают, 10 constraints/4 indexes/3 triggers без дублей, полный warehouse QA PASS. Production, backfill и legacy rows не менялись. |
| №149 | DONE_IN_THIS_COMMIT | Read-only аудит всех 425 GLBD V2 компонентов и 1373 product links; подготовлены 8 master/review файлов вне Git, second pass PASS, import/merge/archive/source writes не выполнялись. |
| №150 | DONE_IN_THIS_COMMIT | Import preview вне migrations: input 24 aliases/349 sources, final safe 24/295, blocked sources 54; first apply 24/295, second apply +0/+0, rollback 0/0, DB и business data не менялись. |
| №151 | DONE_IN_THIS_COMMIT | После verified backup/live preflight импортированы ровно 24 aliases и 295 sources; blocked 54 не затронуты, second apply +0/+0, дубли/orphans/company links 0, components/product links неизменны 425/1373. |
| A104 | DONE | На `assistant-v1` завершён server-owned conversation runtime v2: mocked 20/20, real local 12/12, ERP writes 0; core/GLBD contract не изменён. |
| №152 | DONE_IN_THIS_COMMIT | Existing Global Admin catalog API расширен batch-поиском по canonical/RU/EN/24 aliases; product composition открывает lazy component card с 295 verified sources. DB/migration/deploy не менялись. |
| A105 | DONE_WITH_SCHEMA_GATE | Local summary/unresolved-question/memory prototype: mocked 26/26, writes 0; schema/RLS approval передан Core и принят ТЗ №153. |
| №153 | DONE_IN_THIS_COMMIT | Утверждены minimal memory entities, candidate lifecycle, user+company RLS и non-production A106 boundary; production/DB/schema/merge/deploy не менялись. |
| №154 | BLOCKED | Branch `assistant-memory-a106` создана без production data, но bootstrap остановился на malformed migration-history payload; A106 не запускался. |
| №155 | BLOCKED_IN_THIS_COMMIT | Evidence и полный history backup сохранены, branch удалена; SQL-aware audit доказал 38 однородных повреждений плюс отдельный drift `20260610123000`, поэтому repair/replay остановлены. |
| №156 | DONE_IN_THIS_COMMIT | Особая версия `20260610123000` классифицирована как `LOCAL_FILE_IS_CANONICAL`; оба варианта проверены изолированно, production не менялась, metadata repair не выполнялся. |

## TZ-146 warehouse preflight

- TZ-146 status: `DONE_WITH_BLOCKER`; report: [task-reports/core/TZ-146.md](task-reports/core/TZ-146.md).
- Fresh read-only backup is verified outside Git at `C:\Users\TRAVKIN\Downloads\TravkinFlow-backups\TZ-146\warehouse-units-v2-20260713T194902571Z`; manifest SHA-256 `A1DDB99AC36FC85296E5BA188E31B89CB57293857454FFE6DA16CBA7A733498F`.
- First isolated migration apply and full warehouse QA pass; the known legacy 7+7 rows remain unchanged.
- Production preflight found 87 products with unsupported `base_uom=unknown`, 7 ledger rows with NULL `batch_class`, and one legacy mixed kg/l group. Existing inventory/ledger movements have no unsupported unit after RU/EN canonicalization and have zero cross-company conflicts.
- Repeat apply fails because `products_density_contract_v2` already exists. Migration `20260713183038` must be made repeat-safe and retested before owner approval.
- Required future order: warehouse-write pause, fresh backup/preflight, migration, schema postcheck, immediate TZ-144 code deploy, smoke, then resume writes.
- Production DB, migration history, business data, balances, deploy state, and legacy rows were not changed by TZ-146.

## TZ-147 Assistant QA identity

- TZ-147 status: `DONE`; report: [task-reports/core/TZ-147.md](task-reports/core/TZ-147.md).
- The only exact `TravkinFlowTest1` company was selected; one confirmed Auth user and one canonical `profiles` link were created.
- Authorization state is `role=agronomist`, `status=active`, `is_owner=false`; global/company admin privileges are absent and there is no `company_people` row.
- Normal Auth sign-in and user-JWT RLS checks passed: Test1 season/field/crop structure are readable, while another company's company/profile/field rows are invisible.
- Access and refresh tokens exist only in ignored `project-assistant-v1/.env.local`. Secret values were neither printed nor committed.
- Final business fingerprint matches preflight; schema, migrations, migration history, app code, and deployment were not changed.
- A102 is unblocked only for the already approved local read-only runtime validation. All Assistant write paths remain forbidden.

## TZ-148 Warehouse Units V2 repeat safety

- TZ-148 status: `DONE`; report: [task-reports/core/TZ-148.md](task-reports/core/TZ-148.md).
- Repeat failure was caused by ten named CHECK constraints being added without a definition-aware existence guard; the first visible conflict was `products_density_contract_v2`.
- Every named constraint now follows create-if-absent, no-op-if-identical, and STOP-if-different semantics. No differing constraint is silently dropped or replaced.
- Isolated first and second apply both pass with schema fingerprint `2939db9075816906de24f76db7a4d6db58f190c4e7afe8290bcc93063b4518a9`, equal row counts, and zero duplicate constraints, indexes, or triggers.
- Full kg/l/pcs/seed/transfer/issue/return/reconciliation/storno and protection QA passes; legacy rows changed `0`, production calls `0`.
- A fresh production backup and repeat preflight are still mandatory. Migration apply, backfill, production writes, merge, and deploy were not performed.

## TZ-149 GLBD Component V2 alias and source audit

- TZ-149 status: `DONE`; report: [task-reports/core/TZ-149.md](task-reports/core/TZ-149.md).
- Live read-only snapshot: components `425`, global product links `1373`, company links `0`, existing aliases `0`, existing sources `0`.
- All 425 components and 1373 links were covered. There are 365 components without an English name, 425 without a source row, 12 links without concentration and 1357 links without a verified product-specific source.
- Outside Git, the owner package contains 528 alias review rows, 441 bounded source rows, 172 identity/review rows and all eight required master/self-check files.
- Import candidates remain proposals only: aliases `24`; sources `349` (`333` internal-existing-data identity/classification claims plus `16` previously source-verified product claims). Owner approval and a separate import preflight are mandatory.
- Manual queues: merge-review components `43`, form relations `22`, biological `22`, safener `23`, garbage/relink `15`, needs-source components `92`. No disputed row was marked READY automatically.
- Production database, business data, schema, migrations, product links, component status and deployment were not changed.

## TZ-150 GLBD aliases and sources import preview

- TZ-150 status: `DONE_WITH_BLOCKED_ROWS`; report: [task-reports/core/TZ-150.md](task-reports/core/TZ-150.md).
- Input hashes and counts matched TZ-149 exactly: aliases `24`, sources `349`; live production remained components `425`, product links `1373`, aliases `0`, sources `0`, company links `0`.
- Final safe subset: aliases `24`, sources `295` (`internal_existing_data=279`, `official_registry=6`, `manufacturer_site=7`, `official_label=3`).
- Sources blocked: `54` distinct rows. Of these, 44 intersect explicit review queues and 10 point to inactive components. Category counts may overlap: merge `20`, safener `21`, garbage/relink `1`, needs-source `3`, inactive `10`.
- SQL previews are outside `supabase/migrations`, fail closed without exact batch tokens, use deterministic IDs and semantic duplicate checks, and contain no component/product/company mutation.
- Isolated PGlite result: first apply `24/295`; second apply added `0/0`; duplicate groups `0`; orphans `0`; company links `0`; exact rollback restored aliases/sources to `0/0`; components/product links stayed `425/1373`.
- `READY_FOR_PRODUCTION_IMPORT=NO`: this task grants no apply approval, and the 54 blocked source rows require separate owner decisions. A future apply may use only the exact 24/295 subset after fresh live preflight, backup and explicit approval.
- Production database, business data, schema, migration history, deployment, Assistant code and Integration Contract were not changed.

## TZ-151 GLBD aliases and sources production import

- TZ-151 status: `DONE`; report: [task-reports/core/TZ-151.md](task-reports/core/TZ-151.md).
- Exact TZ-150 candidate hashes passed: aliases `24`, sources `295`, blocked IDs in apply `0`.
- Verified backup is outside Git at `C:\Users\TRAVKIN\Downloads\CodecSaaS\db-backups\glbd-aliases-sources-tz151-20260713T215635254Z`; backup manifest was verified before apply.
- One guarded transaction inserted the two approved tables only. The second identical apply added aliases `0`, sources `0`.
- Final production: aliases `24`, sources `295`, alias/source duplicates `0/0`, collisions `0`, orphans `0/0`, company links `0`.
- Full pre/post snapshots prove components and product links unchanged at `425/1373`; product/company scope also stayed unchanged.
- Exact-ID rollback was not run in production. The production-ready rollback restored the isolated baseline from `24/295` to `0/0` while preserving `425/1373`.
- Database-level canonical/English/Russian/case/hyphen-normalized search resolves to one active component. Current app code has no alias/source-table reads, so UI cutover remains separate.
- The 54 blocked source rows remain outside production tables and require their own owner-review task.

## TZ-152 GLBD alias search and component source cards

- TZ-152 status: `DONE`; report: [task-reports/core/TZ-152.md](task-reports/core/TZ-152.md).
- Existing Global Admin catalog flow remains the only search path: text -> `/api/global-admin/catalog/[entity]` -> batch GLBD components+aliases -> canonical dedupe -> current table UI. No parallel search service was created.
- Canonical, Russian, English and alias matching share case/space/punctuation/hyphen normalization. Exact cross-component alias conflicts return an explicit clarification instead of selecting a random component.
- Product catalogs for pesticides, fertilizers and growth regulators keep legacy product/link IDs and concentrations, but display canonical component names and open the same GLBD component card from composition.
- Component sources are loaded only when a card opens. Source type and claim scope are localized; URL is limited to HTTP(S); empty cards show a human empty state. List/select requests never load the 295 source rows.
- Live read-only verification: components `425`, visible `415`, aliases `24`, sources `295`, `needs_source=0`, source orphans `0`, cross-component alias conflicts `0`.
- The 54 rejected candidate sources remain absent from production and cannot appear through fallback. Production DB, company data, product links, concentrations, schema, migrations and deployment were not changed.

## TZ-153 Travkin Assistant memory schema approval

- Verified `origin/assistant-v1` head and A105 report/proposal at `b22f765583b2cd556a29b9e25c332561f19dd262`; no merge or rebase was performed.
- Live read-only audit: `chats=63`, `chat_messages=909`, `assistant_memories=3` and all memory rows are `scope=user`. `assistant_memories` has RLS enabled but no policies; `chats` and `chat_messages` have legacy permissive public policies; `assistant_audit_logs` is absent.
- Approved reuse: conversation summary and unresolved question in versioned `chat_messages.metadata`; candidate/approved/rejected user memory in existing `assistant_memories` with additive lifecycle/provenance columns.
- Approved one new table: `assistant_memory_events`, because generic company-visible `audit_log` cannot provide private immutable per-user memory history. Event rows contain no memory content.
- Company-wide memory remains disabled. Only explicit candidate -> user-approved/rejected transitions are allowed; rejected, expired and legacy status-null rows are not retrievable.
- Primary runtime is request-scoped user JWT/RLS. Service role is not an approved primary memory runtime. Cross-user/cross-company/anon/spoof/foreign-approval/delete denial tests are mandatory.
- A fully commented preview and rollback are outside Git at `audit-output/TZ-153/assistant_memory_schema_preview.sql`. It is not an active migration and was not executed.
- No Supabase branch exists. The selected A106 target is a separate development branch from production; quoted cost is `$0.01344/hour` and creation requires owner confirmation. Production is not a test target.
- Contract advanced to `0.3 ASSISTANT_MEMORY_SCHEMA_APPROVED`; A106 is reserved for non-production implementation/acceptance and A107 for the future permission-aware Knowledge Base.
- Production DB, schema, business data, migration history, Assistant code, merge and deployment were not changed.

## TZ-154/TZ-155 Assistant branch bootstrap and migration-history recovery gate

- The owner-approved non-production branch `assistant-memory-a106` (`omlgluwtqmhkyiwltiyr`) failed with `MIGRATIONS_FAILED`. The bootstrap created an empty history table and then hit `syntax error at or near "\\"`; checked application tables were absent.
- Full branch evidence was saved without secrets. The failed paid branch was then deleted successfully; production `main` remains the only Supabase branch.
- Verified backup outside Git: `C:\Users\TRAVKIN\Downloads\CodecSaaS\backups\tz-155-2026-07-14T150348634Z`; 76 history rows, 135 local file hashes, manifest SHA-256 `cf525850f9e417e932244f0f86b4b1c7898686d747d6841d6e8d60c480c733b6`.
- SQL-aware parser comparison proved exactly 38 homogeneous escaped-newline/naive-semicolon-split rows from `20260305200628` through `20260404153413`. All 38 match the exact forward transform of their current local files and are restorable in principle.
- The prior 39th candidate `20260610123000` contains a legitimate `E'\n'` and differs separately: production history has 2 statements, current local source has 3 and begins with an extra `alter table` statement. It is not part of the homogeneous repair and requires independent proof.
- Full local parser preflight found another separate blocker: local-only `20260509142000_personnel_vehicles_master_upgrade.sql:12` uses invalid expression constraint `unique (lower(name))`. It was not changed.
- Per TZ-155 fail-closed rules, no restored statements pack, repair preview, rollback preview, isolated replay or schema fingerprint comparison was produced. Production migration history, schema and business data remained unchanged.
- A106 stays blocked. Next owner decision must split exact 38-row metadata recovery, `20260610123000` canonical-history audit and `20260509142000` local migration correction.

## TZ-156 canonical audit for migration 20260610123000

- The local migration contains 3 statements; production history stores an older 2-statement draft. Both parse and execute, but they are not schema-equivalent.
- The local variant adds `ticket_lines.unit_price numeric(18,4)` and `ticket_lines.amount numeric(18,2)` and contains newer definitions for both V2 weighbridge functions.
- Read-only production fingerprints prove both columns exist and both current `pg_proc.prosrc` MD5 values exactly match the local function bodies, not history.
- The valid `E'\n'` in `concat_ws` is not escaped-newline corruption and must not be rewritten.
- Final classification: `LOCAL_FILE_IS_CANONICAL`. The local migration remains unchanged. Production history requires a future history-only repair, while production schema and business data require no change.
- TZ-A106 and TZ-154 remain blocked. The next safe DB scopes are an exact 38-row recovery preview and an independent correction for local-only `20260509142000`.

## TZ-157 canonical legacy vehicle migration

- TZ-157 status: `DONE`; report: [task-reports/core/TZ-157.md](task-reports/core/TZ-157.md).
- Local migration `20260509142000_personnel_vehicles_master_upgrade.sql` no longer uses invalid expression UNIQUE constraints. Case-insensitive uniqueness is implemented with production-named expression indexes.
- The migration now reproduces only the empty legacy vehicle compatibility schema, personnel checks and vehicle FKs that still exist in production. Superseded global/company seed data, triggers and old catalog behavior are not replayed.
- PostgreSQL 15 parser passes all `135/135` local migrations (`2524` statements). Isolated first and second apply both pass; valid rows are accepted and case-insensitive duplicate brands/models are rejected.
- Dependency review confirms `transport_models` remains the canonical catalog, while the empty legacy tables are retained for compatibility reads and later RLS setup.
- Production database, migration history and business data were not changed. No migration or repair command was run.
- The local chain is ready for an exact 38-row history-recovery preview only. TZ-154 and TZ-A106 remain blocked until that separate owner-approved recovery is completed.

## TZ-158 exact migration-history recovery preview

- TZ-158 status: `PASS_PACKAGE_WITH_REPLAY_BLOCKERS`; report: [task-reports/core/TZ-158.md](task-reports/core/TZ-158.md).
- TZ-157 commit `8dee404f4bea0fba2ae3b2cf3df7677af7aa8b03` is pushed to `origin/copilot-v1`; `origin/assistant-v1` remains unchanged at `b22f765583b2cd556a29b9e25c332561f19dd262`.
- The TZ-155 backup and live production history match exactly: `76` rows, `135` local migration hashes and verified manifest SHA-256 `cf525850f9e417e932244f0f86b4b1c7898686d747d6841d6e8d60c480c733b6`.
- SQL-parser reconstruction produced exactly `38` homogeneous corrupted rows plus the separate canonical `20260610123000` row. The repair/rollback previews target only `schema_migrations.statements` for those `39` existing rows.
- Local metadata tests pass: first repair `39`, second repair `0`, rollback `39`, unchanged rows `37/37`, and a tampered hash aborts with no partial write.
- The former `syntax error at or near "\\"` is resolved, but full clean replay stops after `17` migrations / `220` statements at `20260327175004`: a hard-coded missing Auth user violates `products_user_id_fkey`.
- A separate diagnostic Auth fixture also exposes `20260308153257` multi-row `INSERT ... RETURNING id INTO` as SQLSTATE `P0003`. Neither legacy migration was changed.
- The remaining legacy local-only cohort is exactly `57`: 30 live-equivalent, 14 partial, 10 evidence-required, 2 not-applicable and 1 not-applied. It cannot be mass-repaired.
- `READY_FOR_METADATA_REPAIR=NO`: the repaired 76-row history has not completed clean replay or matched the production schema. TZ-154 and TZ-A106 remain blocked.
- Production migration history, schema, Auth and business data were not changed. No repair, migration SQL, `db push`, Supabase branch, merge or deploy occurred.

## TZ-159 canonical legacy demo migrations and replay

- TZ-159 status: `PASS_DEMO_FIXES_WITH_NEW_REPLAY_BLOCKER`; report: [task-reports/core/TZ-159.md](task-reports/core/TZ-159.md).
- Legacy versions `20260308153257` and `20260327175004` are canonical `SUPERSEDED_NOOP` files. They no longer depend on an Auth user and cannot recreate obsolete demo fields, warehouses, products or stock.
- All `135` local migrations parse as PostgreSQL 15 (`2519` statements, errors `0`). Both demo files pass first and second isolated apply with zero objects/data created.
- The refreshed guarded history package targets exactly `39` rows: first repair `39`, second repair `0`, rollback `39`, unchanged rows `37/37`.
- Clean replay advances to `29` migrations / `503` statements and stops at `20260327215913_cleanup_test_users_v3.sql:78`: the cleanup requires exactly one pre-existing real `aimbeks@gmail.com` Auth user/profile.
- At stop, `chats` and `chat_messages` exist; `assistant_memories` and later schema were not reached. Production parity remains unproved.
- `READY_FOR_METADATA_REPAIR=NO`; TZ-154 and TZ-A106 remain blocked. Production migration history, schema, Auth and business data were not changed.

## TZ-160 canonical legacy test-user cleanup and replay

- TZ-160 status: `PASS_CLEANUP_FIX_WITH_NEW_REPLAY_BLOCKER`; report: [task-reports/core/TZ-160.md](task-reports/core/TZ-160.md).
- `20260327215913_cleanup_test_users_v3.sql` is now `SAFE_CONDITIONAL_CLEANUP`: it requires the exact original owner identity and removes only four explicit legacy UUID/email pairs. It never deletes companies or ordinary users.
- PostgreSQL 15 parses all `135/135` local files (`2516` statements). No-owner, allowlisted-demo, ordinary-user/company, mismatched-identity and second-apply checks pass.
- The refreshed guarded 39-row package passes repair `39`, second repair `0`, rollback `39` and unchanged rows `37/37`.
- Clean replay advances to `35` migrations / `520` statements and stops at `20260328150705_fix_profiles_rls_company_read_and_admin_service_update.sql:80`, where deleting a company violates `seasons_company_id_fkey` (`SQLSTATE 23503`).
- The new independent blocker was not modified. Full production parity is still unproved; `READY_FOR_METADATA_REPAIR=NO` and TZ-154/TZ-A106 remain blocked.
- Production still has 15 users/profiles, 3 companies, no listed legacy demo identities and the original 37-statement history row. Production schema, Auth, history and business data were not changed.

## TZ-161 legacy company cleanup and replay

- TZ-161 status: `PASS_CURRENT_LEGACY_FIX_WITH_REAL_SCHEMA_BLOCKER`; report: [task-reports/core/TZ-161.md](task-reports/core/TZ-161.md).
- The destructive company block in `20260328150705` is `SUPERSEDED_NOOP`; profile RLS changes remain active and repeat-safe. Production uses the protected company ID for 6 seasons, 99 fields and 7 profiles.
- All `135/135` local files parse (`2517` statements). The migration passes first and second isolated apply without changing company or business data.
- The refreshed guarded package passes repair `39`, second repair `0`, rollback `39` and unchanged rows `37/37`.
- Clean replay advances to `48` migrations / `758` statements and stops at working schema migration `20260413182000`: line 59 calls missing `public.ensure_updated_at_column()` (`SQLSTATE 42883`).
- Production has that function and the varieties trigger uses it, but the clean repaired history does not create it before use. The working migration was not changed.
- Full production parity remains unproved; `READY_FOR_METADATA_REPAIR=NO` and TZ-154/TZ-A106 remain blocked. Production history, schema, Auth and business data were not changed.

## Forbidden actions

Без отдельного явного owner approval запрещены:

- `supabase db push`, migration apply/up и запуск migration SQL;
- массовый `migration repair`;
- production DB writes и изменение business data;
- merge в `master`, deploy preview/production и promotion deploy;
- автоматический merge/rebase между `copilot-v1` и будущей `assistant-v1`;
- прямое изменение ассистентом core contract или core live state.

## Assistant readiness

ASSISTANT_CORE_READINESS: `A106_CONTRACT_0_4_BRANCH_ACCEPTED`
ASSISTANT_ALLOWED_MODE: `A106_BRANCH_ONLY_SYNC_IMPLEMENTATION_AND_RUNTIME_ACCEPTANCE`
ASSISTANT_ALLOWED_DATA: server-authenticated results of the eight read-only tools; own chat-local conversation state; own USER_GLOBAL approved memory across chats; same-company COMPANY memory with Contract 0.4 role guards; code; Project Live; approved architecture text
ASSISTANT_BLOCKED_AREAS: production memory writes/migration/deployment; unauthorized company memory; ERP/warehouse/operation writes; generic SQL; Knowledge Base mutations/A107; migration history; RLS bypass; service-role primary memory runtime; contract edits by assistant

Assistant implementation: A105 candidate-first prototype at `b22f765` is superseded for memory behavior by Contract 0.4. Branch `gsglkmudcwkdetqtocae` now has Memory Policy V2 and real JWT acceptance. A106 may sync and continue branch-only; merge/deploy/production writes remain `DISABLED`, and A107 remains `NOT_STARTED`.

## TZ-162 migration dependency audit and replay

- TZ-162 status: `PASS_SAFE_DEPENDENCIES_WITH_SEMANTIC_BLOCKER`; report: [task-reports/core/TZ-162.md](task-reports/core/TZ-162.md).
- PostgreSQL 15 parser passes all `135/135` local migrations (`2526` statements). The 76 history rows and 135 local files produced 45 curated chain findings.
- Exact production `ensure_updated_at_column()` is restored before its first tracked caller and passes an isolated trigger test. The local transport FK ordering, two missing product columns, separate crop-category prerequisite, numeric-to-text crop priority transition and duplicate slug assignment were also repaired from production evidence.
- Full local replay advances to `64/135` migrations / `987` statements, then stops at `20260413170000`, statement 15, SQLSTATE `23514`: legacy global crop identities lack a proven category mapping before the validated category constraint.
- This is `SEMANTIC_REVIEW_REQUIRED`; no automatic legacy crop merge, deletion or category assignment was made. `chats` and `chat_messages` exist at stop; `assistant_memories` was not reached.
- The 39-row package remains internally repeat-safe (`39 -> 0 -> rollback 39`, other rows `37/37`) but is not production-ready. It lacks the new 182000 payload and the 76-row history has 36 additional production object sources absent from history.
- Production history, schema, Auth, GLBD, warehouse and business data were unchanged. `READY_FOR_METADATA_REPAIR=NO`; TZ-154 and TZ-A106 remain blocked.

## TZ-163 canonical migration chain completion

- TZ-163 status: `PASS_LOCAL_CHAIN_WITH_NEW_BASELINE_BLOCKERS`; report: [task-reports/core/TZ-163.md](task-reports/core/TZ-163.md).
- The exact ten-row global English crop mapping is fail-closed, preserves row IDs and links, and touches only `company_id is null` rows. Company crops and production data are unchanged.
- All 36 requested missing history-source objects are resolved to 14 primary local source versions; full replay passes `135/135` migrations and `2535` statements with zero parser, missing-object, FK or duplicate-object errors.
- The guarded 39-row package remains exact (`39 -> 0 -> rollback 39`, other rows `37/37`). A separate full 135-row metadata preview also replays, but would insert 59 versions and canonicalize 37 more existing payloads, so it is not approved for production.
- Exact read-only production comparison found seven production-only tables, one function and two triggers without local canonical sources. Known local-only Warehouse V2/A106 scopes also prevent exact parity.
- Production history, schema, Auth and business data were not changed. `READY_FOR_METADATA_REPAIR=NO`; TZ-154 and TZ-A106 remain blocked pending a separate canonical baseline task.
