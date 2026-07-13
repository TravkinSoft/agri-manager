# Assistant Live State

LAST_UPDATED: `2026-07-14`
STATUS: `A105_SUMMARY_PASS_CONFIRMED_MEMORY_LOCAL_PROTOTYPE`
BRANCH: `assistant-v1`
BASE_ASSISTANT_COMMIT: `20117c6739f6ebb2c538e33f073822b8eb1985f3`
CORE_COMMIT_REVIEWED: `350d9572833bdc0b3d93fec7958fa2b04aae856e`
CONTRACT_VERSION_REVIEWED: `0.2`
ALLOWED_MODE: `LOCAL_READ_ONLY_DEVELOPMENT_AND_VALIDATION`
WRITE_CAPABILITY: `NOT_APPROVED_AND_NOT_EXPOSED`

RUNTIME: `ASSISTANT_A104_SERVER_CONVERSATION_V2`
CONVERSATION_HISTORY: `SERVER_VERIFIED_CURRENT_THREAD_MAX_20_USER_ASSISTANT_MESSAGES`
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
DATABASE_SCHEMA: `UNCHANGED`
PRODUCTION: `NOT_CALLED_OR_CHANGED`

A105_SUMMARY: `STRUCTURED_SERVER_METADATA_AFTER_20_MESSAGES`
A105_RECENT_MESSAGES: `19_PRIOR_PLUS_CURRENT_VERBATIM`
A105_UNRESOLVED: `THREAD_SCOPED_OPEN_RESOLVED_CANCELLED`
A105_CONFIRMED_MEMORY: `LOCAL_PROTOTYPE_DISABLED_BY_DEFAULT_AND_ALWAYS_DISABLED_IN_PRODUCTION`
A105_SCHEMA: `INSUFFICIENT; CONTRACT_PROPOSAL_ONLY; NO MIGRATION`

## A101 runtime

The main `/api/assistant/query` path now uses an isolated read-only runtime. It builds one bounded model conversation from constant rules, server-authenticated actor/company/season/page context, structured focus for the verified thread, at most 19 prior user/assistant messages, and the current user message. The current message plus retained history never exceeds 20 conversation messages; the complete initial input is additionally bounded to 24,000 characters. Client `system` hints and messages with a different thread scope are excluded. History is context only and never a source of live ERP facts.

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

Supabase remains the conversation source of truth. A separate real probe confirmed linked `previous_response_id` continuity and explicit invalid-ID failure, but provider state is not stored by the application. History is capped at 19 prior meaningful user/assistant messages plus current input; system/tool/debug/technical/client-hint/injection/secret-like rows are excluded. `history_truncated`, stable-prefix hash, dynamic-context size, input/cached tokens, history count, endpoint, request ID, and model identity are recorded. A nullable summary slot is reserved for A105.

Structured state includes field ID/label, warehouse ID, operation ID, crop-structure-line ID, last intent, last successful tool, and unresolved question. It comes only from matching server metadata, company/RLS-verified UI IDs, or current tool output. Real local acceptance passed 12/12 and mocked acceptance 20/20; the legacy suite remains 24/24. ERP/business writes, foreign rows, schema/migrations, production mutations, merge, rebase, and deploy were zero. Local chat persistence created only the QA user's own test threads/messages.

## A105 summary and confirmed memory V1

Long threads now produce a versioned structured summary in server-owned assistant message metadata after the transcript exceeds 20 meaningful messages. The model still receives the newest 19 prior messages verbatim plus the current message. Summary refresh is bounded to the initial threshold, four newly covered messages, or a material topic change. Secret-like, technical, system, tool, debug and injection rows are excluded. The summary and structured unresolved-question state are added only by the server context builder and survive reload without client history/state input.

Unresolved questions are separately represented with expected clarification, related field/warehouse/operation IDs, appeared time, and open/resolved/cancelled status. The record is keyed to the verified thread and is not inherited by a new thread.

The tracked `assistant_memories` table is insufficient for production confirmed memory and has no tracked authenticated-user RLS policies. A contract proposal requests first-class lifecycle/provenance columns and RLS. No migration was created or applied. The local compatibility API is off by default, forced off in production, user-scope only, candidate-first, confirmation-gated, capped to five approved/unexpired relevant items, and audited on delete. Company memory remains disabled.

Mocked A105 acceptance is 26/26; A104 regression is 20/20; A101 read-only regression is 24/24. Typecheck and build pass. A105 made no OpenAI call, Test1 DB write, ERP write, schema change, production change, merge, rebase or deploy. Real memory QA is intentionally blocked until Core approves the schema/RLS and local memory-write validation.
