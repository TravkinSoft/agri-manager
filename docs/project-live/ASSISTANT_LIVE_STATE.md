# Assistant Live State

LAST_UPDATED: `2026-07-13`
STATUS: `A100_AUDIT_COMPLETE_IMPLEMENTATION_NOT_APPROVED`
BRANCH: `assistant-v1`
BASE_ASSISTANT_COMMIT: `d19258762bb7eaf2afcca94eb7d611d56eedbd41`
CORE_COMMIT_REVIEWED: `719cad6d575c8b7fefdce03464ab313c39669d33`
CONTRACT_VERSION_REVIEWED: `0.1`
ALLOWED_MODE: `READ_ONLY_DESIGN_AND_AUDIT`

RUNTIME_AUDIT: `DONE_TZ_A100`
LEGACY_RUNTIME: `AUDITED_NOT_APPROVED_FOR_ASSISTANT_V1`
CONVERSATION_MEMORY: `PARTIAL_MESSAGES_PERSIST_BUT_NOT_SENT_TO_MODEL`
ENTITY_STATE: `PARTIAL_CLIENT_LOCALSTORAGE_NOT_THREAD_SCOPED`
CONTEXT_BUILDER: `PARTIAL_RUNTIME_AND_SESSION_HINTS_ONLY`
ERP_TOOLS: `AUDITED_62_RUNTIME_TOOLS_41_MODEL_SCHEMAS_POLICY_GAPS_FOUND`
KNOWLEDGE_BASE: `AUDITED_KEYWORD_RUNTIME_NO_EMBEDDINGS_CRITICAL_ISOLATION_GAP_FOUND`
PERSISTENT_MEMORY: `PARTIAL_USER_MEMORY_ASYNC_CAPTURE_NOT_GUARANTEED`
SETTINGS_ROOM: `AUDITED_WORKING_PARTIAL_DECORATIVE_AND_CONFLICTING_CONTROLS_FOUND`
STREAMING: `NOT_IMPLEMENTED_FOR_ASSISTANT_QUERY`
FEEDBACK: `NOT_IMPLEMENTED`
EVALUATIONS: `STATIC_TRACE_ONLY_NO_PRODUCTION_CALLS`
PRODUCTION_ACCESS: `NONE_DURING_A100`
WRITE_ACTIONS: `NO_WRITES_EXECUTED; LEGACY_CONFIRM_ROUTE_EXISTS_AND_IS_NOT_V1_APPROVED`

## A100 outcome

The current main panel is a hybrid legacy runtime, not a clean model-native conversation:

- the UI persists and reloads threads, then submits up to 20 recent messages;
- the server accepts that history but neither the GPT decision call, the general-answer call, nor the model planner includes it in OpenAI messages;
- follow-up continuity therefore depends on a small client-side `sessionState`, stored in `localStorage` and shared across thread switches within one shell session;
- a fast GPT classifier runs first, but deterministic regex routing, hardcoded tool maps, direct fast tools, and legacy fallback logic can still dominate or override the path;
- platform controls are not uniformly enforced: some work, some only change prompt text, and some are unused;
- 62 runtime tools and 41 model-facing schemas exist, but there is no single enforced policy boundary for role, allowed-tools, company, season, and side effects;
- Knowledge Base runtime performs keyword search without embeddings or vector search and contains a cross-company archive flaw in the service-role DELETE path;
- normal chat requests create only drafts; the default main-panel card posts to canonical `/api/operations`, but the older specialist surface and its directly callable legacy `confirm-draft` endpoint perform ERP writes without the canonical operation-create role and season guards.

The complete evidence, scenario traces, tool inventory, findings, priorities, and proposed A101 scope are in [TZ-A100.md](task-reports/assistant/TZ-A100.md).

## Governance status

No application code, API, OpenAI integration, prompt, router, tools, database, migration, data, import script, deployment, merge, or rebase was changed by TZ-A100. The presence of existing legacy routes does not grant them Travkin Assistant V1 approval.

## Next assistant action

`STOP` before implementation. The owner must approve TZ-A101 and the core side must accept any required contract/API capability. The proposed first scope is read-only: enforce one server policy boundary, pass bounded thread history to the model, make state thread-scoped, correct typed field search, and disable all write/draft-confirm/navigation side effects from the V1 path. No DB/schema change is part of that proposal.
