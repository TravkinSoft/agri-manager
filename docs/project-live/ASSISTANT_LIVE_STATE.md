# Assistant Live State

LAST_UPDATED: `2026-07-13`
STATUS: `A101_READ_ONLY_FOUNDATION_IMPLEMENTED_LOCAL_VALIDATION_PASSING`
BRANCH: `assistant-v1`
BASE_ASSISTANT_COMMIT: `4cb8cdf77f140da5a04ade53a5f4022bc04b9bc4`
CORE_COMMIT_REVIEWED: `03696a7914a134b6f2b1ab7d7411e9e7c76be8e3`
CONTRACT_VERSION_REVIEWED: `0.1`
ALLOWED_MODE: `OWNER_APPROVED_TZ_A101_READ_ONLY_IMPLEMENTATION`
WRITE_CAPABILITY: `NOT_APPROVED_AND_NOT_EXPOSED`

RUNTIME: `ASSISTANT_A101_READ_ONLY_V1`
CONVERSATION_HISTORY: `SERVER_VERIFIED_CURRENT_THREAD_MAX_20_USER_ASSISTANT_MESSAGES`
THREAD_STATE: `THREAD_SCOPED_STRUCTURED_STATE_NO_NEW_TABLE`
FIELD_SEARCH: `TYPED_NAME_NUMBER_AREA_TOLERANCE_SEASON`
MODEL_PATH: `ONE_SETTINGS_SELECTED_CHAT_COMPLETIONS_MODEL_NO_MODEL_ROUTING`
MODEL_TOOLS: `8_READ_ONLY_SCHEMAS_ALL_SIDE_EFFECT_NONE`
TOOL_DATA_CLIENT: `AUTHENTICATED_USER_JWT_WITH_RLS_NOT_SERVICE_ROLE`
WRITE_TOOLS: `NOT_EXPOSED`
NAVIGATION_ACTIONS: `NOT_EXPOSED_OR_EXECUTED`
DRAFT_CARDS: `NOT_GENERATED_OR_CONFIRMABLE`
LEGACY_CONFIRM_DRAFT: `UNREACHABLE_FROM_ASSISTANT_V1`
KB_DELETE: `UNREACHABLE_FROM_ASSISTANT_V1`
DATABASE_SCHEMA: `UNCHANGED`
PRODUCTION: `NOT_CALLED_OR_CHANGED`

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

## Governance note

The explicit owner task grants `READ_ONLY_IMPLEMENTATION_APPROVED=YES` and `WRITE_CAPABILITY_APPROVED=NO` for TZ-A101. At reviewed core commit `03696a7`, contract 0.1 still says foundation-only and `TASK_NUMBERING.md` does not yet contain the A101 row. No core-owned file is edited here. Core must reconcile the task registry/contract before treating A101 as contract-approved for production integration.
