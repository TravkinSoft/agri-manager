# Assistant Live State

LAST_UPDATED: `2026-07-19`
STATUS: `A109_COMPLETE_OWNER_ACCEPTANCE_PASS`
BRANCH: `assistant-v1`
BASE_ASSISTANT_COMMIT: `164ade7233c27855e1568decfdf729ab12448204`
CORE_COMMIT_REVIEWED: `d626ef36c96dfc2b10f7fd3ccaaae22b192c616b`
CONTRACT_VERSION_REVIEWED: `0.4`
ALLOWED_MODE: `A109_LOCAL_TEST_BRANCH_READ_ONLY_VALIDATION`
WRITE_CAPABILITY: `ASSISTANT_QA_TRANSCRIPT_ONLY; ERP_WRITES_FORBIDDEN`

RUNTIME: `ASSISTANT_A104_SERVER_CONVERSATION_V2`
CONVERSATION_HISTORY: `SERVER_VERIFIED_RECENT_LIMIT_60; 59_PRIOR_PLUS_CURRENT`
THREAD_STATE: `THREAD_SCOPED_STRUCTURED_STATE_NO_NEW_TABLE`
FIELD_SEARCH: `TYPED_NAME_NUMBER_AREA_TOLERANCE_SEASON`
MODEL_PATH: `EXPLICIT_CHAT_COMPLETIONS_LEGACY_OR_STATELESS_RESPONSES_V2_NO_FALLBACK`
MODEL_TOOLS: `8_READ_ONLY_SCHEMAS_ALL_SIDE_EFFECT_NONE`
TOOL_DATA_CLIENT: `AUTHENTICATED_USER_JWT_WITH_RLS_NOT_SERVICE_ROLE`
WRITE_TOOLS: `NOT_EXPOSED`
NAVIGATION_ACTIONS: `NOT_EXPOSED_OR_EXECUTED`
DRAFT_CARDS: `NOT_GENERATED_OR_CONFIRMABLE`
LEGACY_CONFIRM_DRAFT: `UNREACHABLE_FROM_ASSISTANT_V1`
KB_DELETE: `UNREACHABLE_FROM_ASSISTANT_V1`
DATABASE_SCHEMA: `CORE_BOOTSTRAPPED_BRANCH_135_OF_135_NO_ASSISTANT_LOCAL_MIGRATION`
PRODUCTION: `NOT_CALLED_OR_CHANGED`

A105_SUMMARY: `STRUCTURED_SERVER_METADATA_AFTER_20_MESSAGES`
A105_RECENT_MESSAGES: `19_PRIOR_PLUS_CURRENT_VERBATIM`
A105_UNRESOLVED: `THREAD_SCOPED_OPEN_RESOLVED_CANCELLED`
A105_CONFIRMED_MEMORY: `LOCAL_PROTOTYPE_DISABLED_BY_DEFAULT_AND_ALWAYS_DISABLED_IN_PRODUCTION`
A105_SCHEMA: `INSUFFICIENT; CONTRACT_PROPOSAL_ONLY; NO MIGRATION`

A106_TEST_BRANCH: `gsglkmudcwkdetqtocae`
A106_RUNTIME_CLIENT: `REQUEST_SCOPED_USER_JWT_NO_SERVICE_ROLE`
A106_MEMORY_SCHEMA: `FIRST_CLASS_LIFECYCLE_AND_PROVENANCE_ACTIVE_IN_TEST_BRANCH`
A106_AUTOMATED_ACCEPTANCE: `MEMORY_POLICY_V2_REAL_10_OF_10_PASS`
A106_OWNER_ACCEPTANCE: `PASS`
A106_KNOWN_ISSUE: `NAME_MEMORY_MAY_BE_UNSTABLE_IN_ISOLATED_SCENARIOS_DEFERRED_TO_UX_MEMORY_HARDENING`
A107_READINESS: `COMPLETE_OWNER_ACCEPTANCE_PASS_READY_FOR_PREVIEW_INTEGRATION`
A108_READINESS: `COMPLETE_OWNER_APPROVAL_PASS_READY_FOR_CORE_PREVIEW_INTEGRATION`
A109_READINESS: `COMPLETE_OWNER_ACCEPTANCE_PASS_READY_FOR_CORE_INTEGRATION`

## A101 runtime

The main `/api/assistant/query` path uses an isolated read-only runtime. It builds one bounded model conversation from constant rules, server-authenticated actor/company/season/page context, structured focus for the verified thread, at most 59 prior user/final-assistant messages, and the current user message. The current message plus retained verbatim history never exceeds `RECENT_MESSAGES_LIMIT=60`; summary, confirmed memory, unresolved state, and entity focus are loaded separately. Client `system` hints and messages with a different thread scope are excluded. History is context only and never a source of live ERP facts.

The model receives exactly these tools:

1. `get_current_context`;
2. `search_fields`;
3. `get_field_card`;
4. `get_field_land_bank_summary`;
5. `get_field_materials`;
6. `get_warehouse_stock`;
7. `get_crop_structure_summary`;
8. `get_active_operations_summary`.

The central policy checks authentication, server-selected company, actor/company match, platform role and tool permission, fixed allowlist, `side_effect=none`, requested/result row bounds, season where required, and cross-company markers in tool results. Model tool execution uses a request-bound user JWT Supabase client so helper lookups remain under RLS even when the legacy registry lacks a company column. The old registry remains present but is not the model-facing runtime.

Thread state contains `threadId`, selected field ID/label, selected warehouse ID, selected operation ID, last intent, and unresolved question. It is recovered only from assistant metadata in the verified current thread or a matching request state. UI state is keyed by thread. Switching threads resets mismatched focus. Field focus is derived from tool output, never from regex analysis of assistant prose.

Field search distinguishes name, number, and area. `Сад` maps to `name`, `поле 28` to `number=28`, and `22 га` to `area_ha=22`; multiple matches stay unresolved and require clarification. The tested follow-up `Покажи поле 28` → `А материалы?` calls `get_field_materials` with the structured focus for field 28.

## Model/settings diagnostics

The runtime resolves settings once and uses that single model for every turn in the current tool loop. It does not use the previous fast/heavy model routing. Diagnostics expose requested model, effective model returned by OpenAI, requested reasoning plus `unsupported` effective reasoning, effective temperature only when the selected model supports it, retained history count, total conversation count, and the eight available tools. Local A101 tests use mocked OpenAI and mocked Supabase only; no live model was invoked.

## Write boundary

No ERP write tool, generic SQL, resolver, navigation tool, KB mutation, `create_*` schema, write action, or confirmable draft card is available to the model. The main panel ignores legacy stored actions/cards, its confirmation handler is read-only, navigation actions are blocked, and the legacy specialist confirm call was removed. Existing chat/thread transcript persistence remains infrastructure outside the model tool boundary; it does not grant ERP write capability.

The unsafe core endpoint and KB DELETE implementation are not modified on this branch. Required core fixes are proposed in [2026-07-assistant-p0-core-security.md](contract-proposals/assistant/2026-07-assistant-p0-core-security.md).

## Validation

- `npm ci`: pass, lockfile unchanged;
- baseline and post-change `npm run typecheck`: pass;
- baseline `npm run build`: pass;
- `npx --no-install tsx scripts/qa-assistant-a101-read-only.ts`: 16/16 pass, production calls 0, DB writes 0;
- final `npm run build`, sequential `npm run typecheck`, mocked QA, diff check, and security greps: pass. The build retains the pre-existing Supabase Realtime dynamic-dependency warning.

## A102 real local runtime validation

The dedicated `TravkinFlowTest1` QA identity from TZ-147 was validated through its existing user JWT. The runner used a request-scoped Supabase client with a transport guard that allowed only `GET`, `HEAD`, and `OPTIONS`; the measured full run made 37 Supabase `GET` requests, zero non-read requests, and zero database writes. Cross-company RLS probes for companies, fields, and profiles each returned zero rows. No service-role credential, direct SQL, migration, transcript persistence, application write route, merge, or deployment was used.

All 20 required real scenarios ran against OpenAI. The measured full run produced 14 PASS and 6 FAIL, 41 OpenAI HTTP requests, 54,220 total tokens, and 2,724 ms average scenario latency. History was present in the real OpenAI input for same-thread follow-ups; a new thread received zero retained messages and no old field focus. Every model request exposed exactly the eight A101 schemas, and every executed tool belonged to that allowlist.

The local configured model alias `gpt-5.3` returned `404 model_not_found`. The env file was not changed. Validation continued with a process-only override to the existing project default `gpt-5.4-mini`; OpenAI reported effective snapshot `gpt-5.4-mini-2026-03-17`. Requested reasoning was `medium`; the A101 chat-completions adapter reports effective reasoning as `unsupported`.

Observed failures are retained as findings without code changes:

1. `Привет` unnecessarily called `get_current_context`.
2. The QA fixture has no field 28, so scenarios 4–6 could not prove selected-field materials/operations end to end, although same-thread history reached OpenAI and follow-ups retained the textual field reference.
3. `Спиши материал` called the read-only context tool and asked for details instead of explicitly refusing the write request; no write tool or write request executed.
4. A request for `Астык-STEM` was answered with the current company's land-bank result instead of being refused. RLS still returned zero foreign rows, but the model-layer company-intent policy failed.

Field name/area/number parsing, warehouse product lookup, nonexistent-material empty result, crop summary routing, active-operation summary, SQL refusal, forbidden-tool refusal, exact allowlist, and cross-thread isolation passed. Audit evidence is stored locally in uncommitted `audit-output/TZ-A102/`.

## A102 validation commands

- `npm run typecheck`: PASS.
- `npm run build`: PASS with the pre-existing Supabase Realtime dynamic-dependency warning.
- `npm run qa:assistant:readonly-v1`: FAIL because the script is absent from `package.json`; code was not changed to manufacture a pass.
- `npx --no-install tsx scripts/qa-assistant-a101-read-only.ts`: PASS, 16/16 mocked regression scenarios.
- `git diff --check`: required after the documentation update and recorded in the task report.

## Governance note

Core contract 0.2 at `ec694129` approves A102 only for local read-only validation. A102 is complete as a validation phase, but its findings block any claim that the real runtime fully passes acceptance. No merge, rebase, preview/production deploy, production mutation, or write capability is approved. Core-owned Project Live files were read with `git show` and were not edited.

## A103 read-only acceptance

TZ-A103 closes the six A102 runtime findings without enabling writes. Ordinary greetings and thanks run with no ERP schemas or tool calls. Explicit write, SQL, forbidden-tool, and foreign-company requests are decided centrally before OpenAI or ERP tools. Ambiguous material requests are clarified before tools, while explicitly named materials use a deterministic read-only warehouse lookup.

The real Test1 fixture was discovered dynamically through GET: `Тестовое поле 1`, 100 ha. Its structured ID remained selected through the field, materials, and active-operations chain, same-thread history reached OpenAI, and a new thread inherited neither history nor field focus. Field names ending in digits no longer collapse into numeric field searches.

Model availability is checked explicitly. Configured `gpt-5.3` remains unchanged and unavailable; A103 used the approved process-only `gpt-5.4-mini` override, with effective snapshot `gpt-5.4-mini-2026-03-17` and no silent fallback. The package alias `qa:assistant:readonly-v1` runs the existing regression suite rather than a duplicate runner.

Final real acceptance is `20/20 PASS`: 45 Supabase GET requests, 0 non-read requests, 0 database writes, 0 foreign rows, 0 production mutations, and exactly the eight approved read-only schemas. Audit evidence remains uncommitted under `audit-output/TZ-A103/`. Merge, deploy, production mutation, and write capability remain blocked.

## A104 server conversation runtime v2

The main panel no longer sends history or thread state. `/api/assistant/query` validates ownership, persists the current user row, reloads the newest server transcript in chronological order, builds bounded meaningful history and structured focus, runs the selected adapter/tool loop, persists the assistant row with structured diagnostics, and only then returns success. Assistant persistence failure cannot be reported as saved memory.

Local development defaults to `responses_v2`; production continues to default to the physically preserved `chat_completions_legacy` adapter. Responses uses `POST /v1/responses` with `store:false`, explicit instructions, ordered input, exact eight function tools, call IDs/results, final text, usage/cached tokens, latency, request ID, and model/error identity. There is no silent adapter or model fallback. The unavailable configured `gpt-5.3` stayed unchanged; real QA used an explicit process-only `gpt-5.4-mini` override.

Supabase remains the conversation source of truth. A separate real probe confirmed linked `previous_response_id` continuity and explicit invalid-ID failure, but provider state is not stored by the application. A106 supersedes the original A104 bound: history is capped at 59 prior meaningful user/final-assistant messages plus current input, for `RECENT_MESSAGES_LIMIT=60`; system/tool/debug/technical/client-hint/injection/secret-like rows are excluded. `history_truncated`, stable-prefix hash, dynamic-context size, input/cached tokens, history count, endpoint, request ID, and model identity are recorded. Older messages feed the server-owned summary.

Structured state includes field ID/label, warehouse ID, operation ID, crop-structure-line ID, last intent, last successful tool, and unresolved question. It comes only from matching server metadata, company/RLS-verified UI IDs, or current tool output. Real local acceptance passed 12/12 and mocked acceptance 20/20; the legacy suite remains 24/24. ERP/business writes, foreign rows, schema/migrations, production mutations, merge, rebase, and deploy were zero. Local chat persistence created only the QA user's own test threads/messages.

## A105 summary and confirmed memory V1

Long threads produce a versioned structured summary in server-owned assistant message metadata once the transcript exceeds the 60-message recent window. The model receives the newest 59 prior user/final-assistant messages verbatim plus the current message. Summary refresh occurs whenever another meaningful message leaves that window. Secret-like, technical, system, tool, debug and injection rows are excluded. The summary and structured unresolved-question state are added only by the server context builder and survive reload without client history/state input.

Unresolved questions are separately represented with expected clarification, related field/warehouse/operation IDs, appeared time, and open/resolved/cancelled status. The record is keyed to the verified thread and is not inherited by a new thread.

The tracked `assistant_memories` table is insufficient for production confirmed memory and has no tracked authenticated-user RLS policies. A contract proposal requests first-class lifecycle/provenance columns and RLS. No migration was created or applied. The local compatibility API is off by default, forced off in production, user-scope only, candidate-first, confirmation-gated, capped to five approved/unexpired relevant items, and audited on delete. Company memory remains disabled.

Mocked A105 acceptance is 26/26; A104 regression is 20/20; A101 read-only regression is 24/24. Typecheck and build pass. A105 made no OpenAI call, Test1 DB write, ERP write, schema change, production change, merge, rebase or deploy. Real memory QA is intentionally blocked until Core approves the schema/RLS and local memory-write validation.

## A106 real memory acceptance in isolated branch

Core commit `2cb147dee0a19ec77f81f7387e1d407ffdacc396`, Integration Contract `0.3`, `TASK_NUMBERING.md`, and Core report `TZ-166.md` were reviewed with `git show` after `git fetch origin`. No merge or rebase occurred. Core reports the development branch `assistant-memory-a106` (`gsglkmudcwkdetqtocae`) as bootstrapped 135/135 and healthy, with first-class memory lifecycle/provenance columns, RLS, authenticated grants, triggers, and immutable memory events.

Two ordinary active agronomist QA users were created only in the development branch and belong to different companies. All runtime and acceptance operations use their request-scoped JWTs. The assistant memory, query, thread, and message routes no longer instantiate a service-role client. Memory runtime activation is additionally pinned to the exact A106 branch ref and cannot be enabled against the production ref or under `NODE_ENV=production`.

The mandatory legacy chat-policy gate passed 8/8 real JWT probes. Restrictive owner/company policies constrain the inherited permissive policies: own chat/message reads work, while cross-user read, message insert, chat update, company spoofing, and user spoofing return denied or zero rows.

Real acceptance passed 20/20. It persisted a conversation longer than 20 messages, created and reloaded its summary, restored it from a second authenticated session, opened/resolved an unresolved question, proved cross-thread isolation, created candidate memory without auto-approval, explicitly approved and rejected candidates, selected approved/unexpired memory in a new thread, excluded expired/rejected records, deleted an approved memory, and observed the immutable `memory_deleted` event. User B could not read, approve, or delete user A memory, and company/user/thread spoofing was denied.

The model-facing surface remains exactly eight read-only ERP tools. Operations, warehouses, and inventory transactions were 0 before and after the suite; ERP mutations were 0. Production data-plane connections and writes were 0. No OpenAI key was created. The earlier owner-approved REAL handoff reused only the existing ignored key and passed one Responses preflight with requested/effective `gpt-5.6-terra` and reasoning effort `medium`. After the owner replaced the memory lifecycle, port 3106 was no longer running; it is intentionally not restarted with obsolete candidate-first behavior. The next REAL handoff must wait for Contract 0.4, branch-only schema/RLS support, corrected tests, and a fresh safety preflight.

The Supabase branch-wide security advisor still reports pre-existing findings outside the Assistant memory scope, including public tables with RLS disabled and legacy security-definer views/functions. A106 did not auto-remediate them because the task forbids unrelated schema/ERP changes. The four targeted chat/memory tables have RLS enabled and passed real JWT isolation, but the branch-wide advisor findings must be handled by Core before any broader production-readiness claim.

The earlier automated gates remain evidence for the superseded candidate-first behavior: real memory 20/20, read-only 24/24, conversation 21/21, mocked memory 26/26, typecheck/build PASS. They do not accept the new owner policy. Corrected A106 implementation, new ten-scenario acceptance, REAL handoff, selective commit, and push remain blocked until Core publishes the replacement contract and branch schema/RLS boundary.

## A106 Contract 0.4 current state (supersedes the correction blocker above)

Core commit `ffe53b08d7220ef91eae19924b34434e1bd6f02a` publishes Contract 0.4 and reports migration `20260716125205_assistant_memory_policy_v2.sql` applied only to test branch `gsglkmudcwkdetqtocae`. The Assistant runtime now inserts explicit user memory directly as approved, permits only allowlisted model-inferred user-global memory at confidence `>=0.850`, enforces authorized company roles through branch RLS/triggers, and deletes immediately with immutable audit events. Candidate creation/confirmation is disabled.

Real branch acceptance is 10/10 PASS. The model inference scenario used requested/effective `gpt-5.6-terra` with reasoning effort `medium`; there was no mock or fallback. User-global memory crossed new and existing chats, temporary stock was not saved, deletion took effect everywhere, user B could not see/delete user A memory, and an ordinary agronomist could not create company memory. Candidate delta, ERP writes, service-role use, and production connections were all zero. Read-only regression remains 24/24, conversation/recent-60 regression remains 21/21, typecheck and build pass. A106 remains open only for repeated owner browser acceptance; commit/push/merge/deploy remain unperformed.

## A107 real ERP data acceptance

The Core QA dataset gate was reviewed at commit `c765f59f2ac27ea9b6763a70c4e65a2be3d26c95`. A107 runs only against Supabase branch `gsglkmudcwkdetqtocae`. A strict fail-closed runtime guard requires exact HTTPS hostname equality with `gsglkmudcwkdetqtocae.supabase.co` for both public and server Supabase URLs and exact equality for `A107_BRANCH_REF` before auth, OpenAI, or ERP access. Service-role, database, direct, and admin credentials are rejected.

The dotenv-free safe build and recursive `.next` scan passed: production project-ref and production URL matches are `0`; allowed branch-ref and hostname file matches are `44`; no service-role secret was loaded. Auth preflight established a valid QA User A session whose destination hostname was the exact allowed branch host. Production connections and ERP writes remained `0`.

The final REAL run used requested/effective `gpt-5.6-terra`, reasoning effort `medium`, Responses API `store:false`, and exactly eight read-only ERP tools. All `45/45` scenarios passed with `100.00%` numeric accuracy, `100%` unit accuracy, field-search and follow-up PASS, cross-company leaks `0`, and ERP mutations `0`. Typecheck, the `24/24` read-only regression, clean build, and diff check pass. The REAL runtime remains running at `http://127.0.0.1:3106/dashboard`. This automated gate originally held commit/push pending owner acceptance; the final acceptance section below supersedes that hold.

The latest owner corrections add warehouse directory mode to the existing read-only stock tool, multilingual/partial/transliterated product resolution, and a generic eight-field list that ignores stale selected-field focus while including crop and variety. The QA row for Curamin Foliar has no Russian localized value, so no Core data was changed and a branch-only Core dataset proposal was created. After quota restoration, final REAL acceptance passed `7/7`; the focused follow-up/isolation/write-denial regression passed `6/6`; the ERP snapshot remained unchanged. Silent fallback remained disabled. The owner returned `OWNER_ACCEPTANCE: PASS`.

## A107 owner context-connection correction

The failed owner check had two causes. First, the owner runtime was attached to a foreground command session and had exited, while the already loaded page continued reading test-branch QA data directly. Second, `/api/assistant/context` used a service-role client after user authentication, contradicting the A107 no-service-role runtime.

The context route now executes the exact branch allowlist before auth and uses the request-scoped QA user JWT/anon client under RLS. The frontend remains same-origin on `/api/assistant/context`, so there is no CORS or `localhost`/`127.0.0.1` mismatch. The safe owner launcher now starts a hidden detached process and verifies port readiness.

Fresh auth/context preflight and browser verification pass. The dashboard shows 8 fields and 1,000 ha; Copilot loads `Астык-STEM QA · 2026 · agronomist`; the input accepts and sends a query; the REAL read-only response reports 8 fields and 1,000 ha. After a clean reload there are no new frontend/network errors. Production connections and ERP writes remain `0`, service role remains unloaded, and the detached server is running on port 3106. Owner acceptance is `PASS`.

## A107 final owner acceptance

A107 is complete with owner acceptance `PASS` and is ready for selective push to `origin/assistant-v1`, followed by preview integration. The minor phrase-intent issue where `Маладээс` was treated as a product lookup is recorded as non-blocking backlog item `INTENT-UX-001` in `docs/project-live/backlog/assistant-intent-ux-hardening.md`. Merge and production deploy remain forbidden.

## A108 preview integration package

After `git fetch origin`, Assistant commit `a71e292e85a1c7d7b7503275174c34f94fa39bd5` was compared with Core commit `1fbb3998c8dc82ee8e4af0b439b8a32c0b76a034` without merge or rebase. The Assistant delta contains 58 files: 43 added and 15 modified. The selective preview package applies 56 files; the two Core-owned Assistant live/sync state files are retained from Core and updated only on the Assistant branch as handoff documentation. Three paths changed in both branches: `package.json` and the two state documents.

A detached temporary worktree based exactly on the Core commit was created at `C:\Users\TRAVKIN\Downloads\CodecSaaS\project-assistant-a108-preview-temp`. Core package scripts and `@electric-sql/pglite` were preserved while Assistant QA scripts were added. No Assistant migration is transferred; Core already owns the Memory Policy V2 migration required by the test branch.

The initial REAL preview run exposed one semantic integration conflict: the short product-phrase heuristic routed the inflected phrase `поливы` to warehouse stock. The manifest now requires the isolated A108 resolution patch, which excludes praise variants and suffix-inflected irrigation/business subjects from catalog lookup. The rebuilt temporary copy passed typecheck, build, A106 memory `10/10`, A107 REAL ERP `45/45` with numeric accuracy `100%`, greeting `4/4`, and owner warehouses/product/field findings `7/7`. The eight Core page HTTP checks are retained only as transport evidence and no longer count as Core smoke.

The exact per-file transfer and rollback instructions are in `audit-output/TZ-A108/integration-manifest.json`; the value-free environment handoff is in `audit-output/TZ-A108/preview-env-checklist.md`. The REAL temporary runtime remains at `http://127.0.0.1:3106/dashboard`. No commit, push, merge, deploy, production connection, or Core branch mutation was performed for A108.

## A108 owner failure and Core proposal

The owner returned `OWNER_APPROVAL: FAIL`. Authenticated browser validation showed that `/crop-structure` and `/warehouses` render Core error states because their routes require `getServiceClient()` while A108 correctly keeps the service role absent. `/operations` loads its main journal through user-RLS reads, but the operation-card lines route has the same Core service-client dependency. The warehouse observer badge contains literal mojibake already present in the reviewed Core commit.

The affected Core page, service, auth, and API files have no Assistant diff from `1fbb3998c8dc82ee8e4af0b439b8a32c0b76a034`. A108 integration/env wiring is therefore not the cause. No Core code was changed in `assistant-v1`.

Core proposal `contract-proposals/assistant/2026-07-17-a108-core-user-jwt-data-pages.md` requires ordinary routes to use the authenticated request JWT under RLS, forbids service-role fallback, lists the exact route families, corrects the UTF-8 literals, and defines data-level smoke acceptance. HTTP 200 alone is no longer a pass: pages must load expected QA data with no error banner/toast, no permanent spinner, no mojibake, zero foreign rows, zero ERP writes, zero production connections, and no service role.

## A108 resync to Core 5b5a57c

Fresh `git fetch origin` resolved Core to `5b5a57c8b8490340c92b72e2a74a4ca4404d4613`. A new detached preview copy was built from that exact commit after removing the previous temporary worktree. The verified manifest applied exactly 56 selected paths plus its semantic patch; no Core data route or Core state document was overwritten.

The new Core user-JWT implementation fixes crop structure, operation details, and visible mojibake. Authenticated UI/API evidence shows 9 crop-structure rows, 5 operations, operation-lines 200, company-B denial, and mojibake 0. Typecheck/build pass. Fresh A106 memory is 10/10, greeting is 4/4, and A107 is 45/45 with 100% numeric accuracy, zero cross-company leaks, zero ERP mutations, and zero production connections.

A108 remains blocked by one Core-owned balances route. `app/api/warehouses/balances/route.ts` asks PostgREST to embed `varieties:variety_id` and `reproductions:reproduction_id`, but migration `20260510093000_add_batch_class_and_identity_flow.sql` drops those two foreign keys. The authenticated route returns HTTP 400, so `/warehouses` shows an error banner/toast and a false zero state instead of 2 warehouses and the expected balances. Assistant changed neither file nor schema. The updated Core proposal records the required user-JWT-safe explicit lookup fix. The REAL preview remains running at `http://127.0.0.1:3106/operations`; commit, push, merge, deploy, and owner approval remain blocked.

## A108 final Core resync and owner gate

Core commit `abce1bb9e18fc118c68dfc6add6fb31d05ffe81c` resolves the remaining warehouse balances relation error. The previous temporary preview was safely replaced with a fresh detached copy at that exact commit; the manifest again applied exactly 56 files and left Core's balances route unchanged.

Final authenticated Core/UI smoke passes: crop structure 9 rows; warehouses 2; ammonium nitrate 1550 kg; Curamin Foliar 520 l; Phomazin 200 l; operations 5; Field 28 operation card opens; company-B denial; error banner/toast 0; mojibake 0. Typecheck/build and production-deny scans pass. Fresh A106 is 10/10 plus greeting 4/4; fresh A107 is 45/45 with 100% numeric accuracy, zero leaks, zero ERP mutations, and zero production connections.

A108 is `READY_FOR_OWNER_APPROVAL`. The REAL preview stays at `http://127.0.0.1:3106/operations`. Commit, push, merge, and deploy remain forbidden until the owner returns approval.

## A108 final owner approval

The owner returned `OWNER_APPROVAL: PASS`. A108 is complete and the verified selective A108 package is authorized for commit and push to `origin/assistant-v1`. It is ready for Core preview integration. Merge into `copilot-v1` and deploy remain forbidden.

## A109 context scope and recovery

A109 separates company-wide plural scope from explicit single-field follow-up scope. Generic field lists and company operation questions clear stale selected-field focus, while `А культура?`, `А площадь?`, and `А какие там операции?` retain the verified field. `15 полю` is parsed as Field15 and is excluded from product lookup.

An empty DATA response or a generic field list inconsistent with the preceding count triggers one corrected read-only ERP retry. Supported successful tool output has a deterministic user-facing renderer, so technical empty-answer phrases are not exposed. Conservative fuzzy product matching resolves `курмаина`, `курамин`, `фолиар`, and `Curamin` to Curamin Foliar without weakening tenant or write boundaries.

Mocked A109 acceptance is `10/10 PASS`. REAL acceptance is `12/12 PASS`; the mandatory Field15 → field count 8 → all eight fields → company-wide active operations chain is `4/4 PASS`. Typecheck, clean build, read-only `24/24`, conversation `21/21`, and greeting `4/4` pass. The ERP snapshot is unchanged; cross-company leaks, ERP writes, production connections, loaded service-role and database credentials are all `0`.

The fail-closed REAL runtime remains available at `http://127.0.0.1:3109/fields` on Supabase branch `gsglkmudcwkdetqtocae`, requested/effective model `gpt-5.6-terra`, medium reasoning, and Responses `store:false`. A109 is open only for owner acceptance. Commit, push, merge, and deploy have not been performed.

## A109 owner status correction

The owner found a Field15 status contradiction: the field card called its planned operation active, while the company-wide current-operations list correctly excluded Field15. The cause was `get_field_card.active_operations_count` treating planned as active. The Assistant runtime now uses the same active-operation predicate as the company-wide tool, exposes separate planned/active/completed counts, enforces the strict wording `planned=запланирована`, `in_progress=выполняется сейчас`, `completed=завершена`, and falls back to grounded tool text if a Field-card answer contradicts `planned>0` and `active=0`.

Fresh A109 evidence after safe rebuild: mock `10/10 PASS`, REAL `12/12 PASS`, mandatory chain `4/4 PASS`, Field15 planned PASS, company current operations returns only Field28 and Сад Южный, typecheck PASS, safe build PASS, production connections `0`, ERP writes `0`, service role `NO`.

The owner returned `OWNER_ACCEPTANCE: PASS`. A109 is complete and authorized for selective commit and push to `origin/assistant-v1`. The non-critical cleanup warning, where a temporary `chat_messages` row could not be deleted because `assistant_memories.source_message_id` referenced it, is recorded as backlog item `MEM-UX-002` in `docs/project-live/backlog/assistant-memory-ux-hardening.md`. A109 did not change memory logic for this warning. Merge and deploy remain forbidden.
