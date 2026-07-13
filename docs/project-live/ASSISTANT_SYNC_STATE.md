# Assistant Sync State

LAST_SYNC_AT: `2026-07-14T06:00:00+05:00`
ASSISTANT_BRANCH: `assistant-v1`
ASSISTANT_BASE_COMMIT: `2152b73f8013b11b1dc37a4ea5c94cf08b4d752c`
ASSISTANT_COMMIT: `SELF` (TZ-A105 implementation and report commit)

CORE_BRANCH_REVIEWED: `origin/copilot-v1`
CORE_COMMIT_REVIEWED: `350d9572833bdc0b3d93fec7958fa2b04aae856e`
CORE_LIVE_STATE_REVIEWED_AT: `2026-07-14T06:00:00+05:00`
LATEST_CORE_REPORT_REVIEWED: `TZ-151.md`
INTEGRATION_CONTRACT_VERSION: `0.2`
INTEGRATION_CONTRACT_HASH: `20EDC32A8D3540DF9C779C7DF3C8F931E0AA91349327111BF8A924460871C307`

CORE_PRODUCTION_COMMIT_REVIEWED: `321e45fa681fecff89307545d0ec3fa600b4c982`
CORE_PRODUCTION_STATUS: `READY_WITH_CONTROLLED_P1_GAPS`
ASSISTANT_ALLOWED_MODE: `LOCAL_READ_ONLY_DEVELOPMENT_AND_VALIDATION`
WRITE_CAPABILITY_APPROVED: `NO`

CORE_CHANGES_SINCE_LAST_SYNC: `TZ-151 imported the approved GLBD alias/source batch. It does not change the Assistant API or contract.`
CONTRACT_CHANGES_FOUND: `NO; version 0.2 and exact hash unchanged`
ASSISTANT_API_CONTRACT_CHANGES_FOUND: `NO; exactly eight read-only tools remain approved`
INCOMPATIBLE_CHANGES_FOUND: `NO`
OWNER_TASK_OVERRIDE: `The owner explicitly supplied TZ-A105; core TASK_NUMBERING contains only A100-A103, so the registry gap is recorded and core-owned files remain untouched.`
SYNC_STATUS: `A105_SUMMARY_PASS_MEMORY_SCHEMA_PROPOSAL_REQUIRED`
SYNC_BLOCKER: `Real memory mutation QA is blocked until Core approves the memory schema/RLS and local write validation.`
NEXT_SAFE_ACTION: `Review 2026-07-assistant-memory-schema-v1.md; do not apply migration, enable production memory, merge, rebase or deploy.`

## Reviewed core sources

After `git fetch origin`, the following current sources were read with `git show`, without merge or rebase:

- `origin/copilot-v1:docs/project-live/CORE_LIVE_STATE.md`;
- `origin/copilot-v1:docs/project-live/INTEGRATION_CONTRACT.md`;
- `origin/copilot-v1:docs/project-live/TASK_NUMBERING.md`;
- `origin/copilot-v1:docs/project-live/CORE_ASSISTANT_SYNC_STATE.md`;
- `origin/copilot-v1:docs/project-live/task-reports/core/TZ-151.md`.

The latest core commit is `350d9572833bdc0b3d93fec7958fa2b04aae856e`. Contract 0.2 remains byte-for-byte at the hash above. TZ-151 reports the approved GLBD alias/source import and no Assistant integration change. `TASK_NUMBERING.md` contains A100-A103 but not A104/A105; the explicit user-supplied task is the recorded owner authorization for this isolated assistant branch work, not authorization to edit core-owned files.

## A103 compatibility and result

The A103 implementation stays inside the existing A101 boundary: exactly eight `side_effect=none` schemas, user-JWT/RLS reads, no application write route, no database/schema/data/import change, and no production call. The central request policy now suppresses tools for ordinary conversation, refuses write/SQL/forbidden-tool requests, and denies explicit foreign-company requests before OpenAI and ERP tools.

Final real local acceptance against `TravkinFlowTest1` is 20/20 PASS. The dynamically read field `Тестовое поле 1` retained the same structured ID through field, materials, and active-operation follow-ups; same-thread history reached OpenAI; the new thread inherited no focus. The measured final run used 45 Supabase GET requests, 0 non-read requests, 0 foreign rows, and 0 database writes.

Configured `gpt-5.3` remains unchanged and unavailable. Explicit preflight selected the approved process-only `gpt-5.4-mini` override; OpenAI returned `gpt-5.4-mini-2026-03-17`. Silent fallback was not used. The expired QA access token was refreshed at the separate security gate using the existing local refresh token and the rotated pair was stored only in ignored `.env.local`; no secret was printed or committed. The final measured acceptance run itself required no auth refresh and contained only GET/read-only Supabase transport.

## Mandatory rule

Before every subsequent task in `assistant-v1`, fetch `origin/copilot-v1`, read the mandatory core sources with `git show`, and record the actual ref, contract version/hash, compatibility result, and allowed mode here. No automatic merge or rebase is allowed.

## A104 compatibility and result

After `git fetch origin`, core commit `f4a7088e7516ebab42739f2b2277f3b6254e9b48`, contract 0.2, `TASK_NUMBERING.md`, `CORE_ASSISTANT_SYNC_STATE.md`, and `TZ-150.md` were reviewed with `git show`. No incompatible Assistant contract change was found. The two open core P0 surfaces remain forbidden and untouched. No merge or rebase was performed.

A104 stays within the exact eight-tool read-only boundary and adds a local stateless Responses adapter plus server-owned conversation replay. Production default remains the legacy Chat Completions adapter. Existing chat tables and message metadata were sufficient; no schema proposal, SQL, or migration was needed.

Mocked A104 acceptance is 20/20, legacy regression is 24/24, and real local acceptance is 12/12. The real probe confirmed reload, independent-client continuity, newest-message ordering, cross-thread isolation, client history/state rejection, malformed UI-ID rejection, write denial, and a real read-only field land-bank tool path. ERP/business writes, foreign rows, production mutations, merge, rebase, and deploy were zero. Audit evidence remains uncommitted in exactly seven `TZ-A104` files.

## A105 compatibility and result

After `git fetch origin`, Core commit `350d9572833bdc0b3d93fec7958fa2b04aae856e`, contract 0.2/hash above, `TASK_NUMBERING.md`, `CORE_ASSISTANT_SYNC_STATE.md`, and `TZ-151.md` were read with `git show`. No Assistant API change was found. The exact eight read-only ERP tools remain the only model tools. No merge or rebase occurred.

Conversation summary and unresolved clarification use existing chat message metadata and need no schema change. The current long-term memory table is insufficient for confirmed lifecycle/provenance and lacks tracked authenticated-user RLS policies while the route uses service role. Per A105 and contract 0.2, no migration or real memory mutation was attempted. A contract proposal was created, and the local prototype is disabled by default and always disabled in production.

Mocked memory acceptance is 26/26; prior conversation and read-only suites remain 20/20 and 24/24. Typecheck/build/diff checks pass. A105 produced zero OpenAI calls, Test1 DB writes, ERP writes, production changes, merges, rebases or deploys. Exactly seven `TZ-A105` audit files remain uncommitted.
