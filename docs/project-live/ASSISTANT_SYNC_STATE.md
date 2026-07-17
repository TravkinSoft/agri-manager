# Assistant Sync State

LAST_SYNC_AT: `2026-07-17` (A107 Core QA dataset gate)
ASSISTANT_BRANCH: `assistant-v1`
ASSISTANT_BASE_COMMIT: `a3f652313daa780909d65ee698d2d6f48d7abb2a`
ASSISTANT_COMMIT: `A107_DELIVERY_COMMIT_AUTHORIZED`

CORE_BRANCH_REVIEWED: `origin/copilot-v1`
CORE_COMMIT_REVIEWED: `c765f59f2ac27ea9b6763a70c4e65a2be3d26c95`
CORE_LIVE_STATE_REVIEWED_AT: `2026-07-16` (fresh fetch)
LATEST_CORE_REPORT_REVIEWED: `TZ-176.md; TZ-177.md`
INTEGRATION_CONTRACT_VERSION: `0.4`
INTEGRATION_CONTRACT_HASH: `23F7C742DAA9C991933D3298404A8E8C2AF58A2DC0222B1523923F9E59038FF1`

CORE_PRODUCTION_COMMIT_REVIEWED: `321e45fa681fecff89307545d0ec3fa600b4c982`
CORE_PRODUCTION_STATUS: `READY_WITH_CONTROLLED_P1_GAPS`
ASSISTANT_ALLOWED_MODE: `CONTRACT_0_4_A107_ISOLATED_BRANCH_REAL_ERP_READ_ONLY_ACCEPTANCE`
WRITE_CAPABILITY_APPROVED: `NO_ERP_WRITES; REQUEST_SCOPED_USER_JWT_READS_ONLY`

CORE_CHANGES_SINCE_LAST_SYNC: `Contract 0.4 and branch-only Memory Policy V2 migration published; production migration head unchanged.`
CONTRACT_CHANGES_FOUND: `YES; direct explicit approval, allowlisted model inference, user-global/company scopes, and immediate audited delete are approved on A106 branch.`
ASSISTANT_API_CONTRACT_CHANGES_FOUND: `NO; exactly eight read-only tools remain approved`
INCOMPATIBLE_CHANGES_FOUND: `NO for the implemented Contract 0.4 branch-only runtime.`
OWNER_TASK_OVERRIDE: `OWNER_ACCEPTANCE PASS; candidate-first remains superseded; isolated name-memory instability is deferred as a non-blocking UX/memory hardening backlog item.`
SYNC_STATUS: `A107_COMPLETE_OWNER_ACCEPTANCE_PASS`
SYNC_BLOCKER: `NONE_FOR_SELECTIVE_A107_COMMIT_AND_PUSH`
NEXT_SAFE_ACTION: `Push the selective A107 delivery to origin/assistant-v1; do not merge or deploy production; preview integration may proceed after the push.`

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

## A106 compatibility and automated result

After `git fetch origin`, Core commit `2cb147dee0a19ec77f81f7387e1d407ffdacc396`, contract 0.3/hash above, `CORE_LIVE_STATE.md`, `TASK_NUMBERING.md`, and `TZ-166.md` were read with `git show`. No merge or rebase occurred. The exact isolated branch ref is `gsglkmudcwkdetqtocae`; production ref `bhsemlvmkikpntabctml` was not used by the data-plane runtime.

Core's branch bootstrap and memory contract are compatible with the A105 architecture. Summary/unresolved state remains server-owned chat message metadata. Confirmed memory now uses first-class lifecycle/provenance columns and database triggers/events. Runtime database access is request-scoped user JWT; service-role is not used by the A106 assistant query/thread/message/memory paths.

Real JWT legacy-chat security gate passed 8/8. Real A106 acceptance passed 20/20, including reload, independent session, cross-thread isolation, candidate/approve/reject, new-thread retrieval, expiry, delete event, cross-user/company denial, scope spoof denial, and ERP-write denial. The A106 context window now uses one `RECENT_MESSAGES_LIMIT=60`: 59 prior user/final-assistant messages plus current, with older messages summarized and memory/entity/system context separate. The 80-message mocked regression passed 21/21 and verified the assistant can see its own prior final answer and receives only compact structured tool results. Read-only and mocked-memory regressions remain 24/24 and 26/26. Typecheck and build pass; the build retains the known Supabase Realtime dynamic-dependency warning.

Only branch QA chats/messages/memories/events changed during the earlier acceptance. Production connections/writes, ERP mutations, merge, rebase, and deploy are all 0. Automated acceptance made 0 OpenAI calls; the earlier owner-approved REAL handoff made exactly one successful preflight call to requested/effective `gpt-5.6-terra` with reasoning effort `medium`. After the replacement owner policy exposed the compatibility gate, both local ports 3106 and 3107 are stopped so the obsolete candidate-first behavior is not presented for acceptance. Service-role remains absent. Exactly nine audit artifacts remain outside selective Git staging under `audit-output/TZ-A106/`.

The Supabase security advisor reports pre-existing branch-wide findings outside A106 (including RLS-disabled public tables and legacy security-definer surfaces). No unrelated schema change was made. Targeted A106 tables have RLS enabled and passed real JWT isolation. Broader advisor remediation remains a separate Core prerequisite for production review.

Final A106 closure, selective commit `feat(assistant): validate confirmed memory in isolated branch`, and push remain pending the owner's explicit browser result.

## A106 owner memory-policy correction gate

On 2026-07-16 the owner replaced candidate-first memory with immediate approval
for explicit remember commands, model-inferred durable memory, scoped immediate
forget/delete, and separate user-global/company/thread scopes. Fresh sync against
`origin/copilot-v1` commit `8fdc5ac7686106e79211b064c1e1ad804aaaa341`
found Contract 0.3 unchanged. It explicitly forbids automatic approval and
company-wide memory and requires a new Core contract version before activation.

No runtime or database mutation change was made under the contradictory
contract. Proposal
`contract-proposals/assistant/2026-07-16-owner-memory-behavior-v2.md` requests
Contract 0.4 plus the required atomic direct-approved insert, provenance,
user/company scope, RLS, deletion, audit, and model-decision boundaries.
Production, schema, ERP data, merge, rebase, and deploy remain unchanged.

## A106 Contract 0.4 resync and result

After `git fetch origin`, Core commit `ffe53b08d7220ef91eae19924b34434e1bd6f02a`, Contract 0.4, Core report `TZ-169.md`, and migration `20260716125205_assistant_memory_policy_v2.sql` were read with `git show`; no merge or rebase occurred. Core confirms that migration only on branch `gsglkmudcwkdetqtocae`, with production on the preceding migration head.

The Assistant runtime now follows Memory Policy V2. Real JWT branch acceptance passed 10/10, including direct approved explicit memory without candidates, real-model inference on the six-type allowlist at confidence `>=0.850`, user-global retrieval across new/existing chats, immediate audited delete, A/B isolation, and the ordinary-user company-role denial. Conversation regression is 21/21, read-only regression is 24/24, typecheck/build pass, and the model/tool invariants remain `gpt-5.6-terra`, medium reasoning, Responses `store:false`, recent limit 60, exactly eight read-only ERP tools, ERP writes 0, service role 0, and production connections 0. A106 is ready for repeated manual owner acceptance but remains open and uncommitted.

## A107 Core gate and automated result

After `git fetch origin`, Core commit `c765f59f2ac27ea9b6763a70c4e65a2be3d26c95`, Contract 0.4, `CORE_LIVE_STATE.md`, `CORE_ASSISTANT_SYNC_STATE.md`, and reports `TZ-176.md` and `TZ-177.md` were read with `git show`; no merge or rebase occurred. Core authorizes the QA dataset only on test branch `gsglkmudcwkdetqtocae`.

The runtime is guarded by an exact allowlist before auth, OpenAI, and ERP access. Both Supabase URLs must be valid HTTPS URLs with hostname exactly `gsglkmudcwkdetqtocae.supabase.co`, and `A107_BRANCH_REF` must exactly match the branch ref. Any service-role, database, direct, or admin credential fails closed. The safe build used no dotenv file; the bundle contains zero production-ref/URL matches and positive test-branch matches. Auth preflight reached only the exact allowed hostname with a valid QA User A session.

REAL acceptance passed `45/45` with `100.00%` ERP numeric accuracy, field-search/follow-up/unit accuracy PASS, cross-company leaks `0`, ERP mutations `0`, and production connections `0`. The effective model is `gpt-5.6-terra`, reasoning is `medium`, Responses `store:false`, and the model-facing surface remains exactly eight read-only tools. Typecheck, clean build, diff check, and the `24/24` read-only regression pass. The local REAL runtime remains available at `http://127.0.0.1:3106/fields`. This automated gate originally blocked delivery pending owner acceptance; the final owner result below supersedes that hold.

## A107 owner context-connection retest

The Copilot frontend uses the correct same-origin `/api/assistant/context` endpoint on port 3106. The reported `Failed to fetch` was reproduced after the foreground owner server had exited. The route also retained a legacy service-role client for post-auth context reads. It now applies the exact A107 branch guard before auth and performs company/season reads with the request-scoped QA user JWT under RLS.

A clean build and bundle scan passed (`0/0` production matches, `44/44` branch matches, no service-role or database/admin credentials). The owner runtime is now a hidden detached process with a port readiness gate. Real auth/context preflight and browser reload passed on the exact allowed Supabase hostname. The dashboard and Copilot both resolve the same QA company/season, input submission works, and a REAL read-only query returned 8 fields and 1,000 ha. Production connections and ERP writes remain zero. This correction originally awaited repeated owner acceptance; that gate is now satisfied.

The next owner correction keeps the same eight-tool contract while adding canonical warehouse directory reads, unambiguous canonical/localized/partial/transliterated product matching, and a concise generic eight-field list with crop/variety that clears stale selected-field focus. The Core QA row for Curamin Foliar lacks a Russian localized name; a branch-only dataset proposal was recorded and Core data was not mutated. After quota restoration, the final REAL owner regression passed `7/7`, and the focused follow-up/isolation/write-denial regression passed `6/6`. ERP writes and production connections remained `0`; fallback remained disabled. The owner returned `OWNER_ACCEPTANCE: PASS`.

The owner accepted one non-blocking UX issue: the phrase `Маладээс` can be misclassified as a catalog request. Backlog item `INTENT-UX-001` requires praise/colloquial detection, typo-aware variants, and an explicit subject before any ERP lookup. A107 remains complete and is ready for preview integration after selective push; merge and production deploy remain forbidden.
