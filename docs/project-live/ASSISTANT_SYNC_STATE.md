# Assistant Sync State

LAST_SYNC_AT: `2026-07-14T01:42:35+05:00`
ASSISTANT_BRANCH: `assistant-v1`
ASSISTANT_BASE_COMMIT: `51e878e7306d0b6a821a21b9a7174466e165d10c`
ASSISTANT_COMMIT: `SELF` (TZ-A102 documentation commit)

CORE_BRANCH_REVIEWED: `origin/copilot-v1`
CORE_COMMIT_REVIEWED: `ec6941294d7c172a58479a42c3fce1d3d1757133`
CORE_LIVE_STATE_REVIEWED_AT: `2026-07-14T01:42:35+05:00`
INTEGRATION_CONTRACT_VERSION: `0.2`
INTEGRATION_CONTRACT_HASH: `20EDC32A8D3540DF9C779C7DF3C8F931E0AA91349327111BF8A924460871C307`

CORE_PRODUCTION_COMMIT_REVIEWED: `321e45fa681fecff89307545d0ec3fa600b4c982`
CORE_PRODUCTION_STATUS: `READY_WITH_CONTROLLED_P1_GAPS`
CORE_DB_STATUS_REVIEWED: `76 remote history rows; head 20260712203746; 57 old local-only versions remain; db push prohibited`
ASSISTANT_ALLOWED_MODE: `LOCAL_READ_ONLY_DEVELOPMENT_AND_VALIDATION`
WRITE_CAPABILITY_APPROVED: `NO`

CORE_CHANGES_SINCE_LAST_SYNC: `TZ-145 approved A101 and contract 0.2; TZ-147 provisioned the dedicated Test1 QA identity and unblocked A102 local read-only validation`
CONTRACT_CHANGES_FOUND: `YES; 0.1 -> 0.2, exact current hash verified`
ASSISTANT_API_CONTRACT_CHANGES_FOUND: `NO_NEW_API_OR_SCHEMA; exactly eight read-only tools remain approved`
INCOMPATIBLE_CHANGES_FOUND: `NO_CONTRACT_INCOMPATIBILITY_FOR_A102_LOCAL_READ_ONLY_VALIDATION`
OWNER_TASK_OVERRIDE: `NOT_REQUIRED; TZ-147 and contract 0.2 explicitly unblock A102`
SYNC_STATUS: `A102_LOCAL_READ_ONLY_VALIDATION_COMPLETE_WITH_FINDINGS`
SYNC_BLOCKER: `REAL_RUNTIME_ACCEPTANCE_NOT_FULLY_PASSING: 14/20 scenarios pass; local model alias gpt-5.3 is unavailable; model-layer foreign-company refusal and write-intent refusal need fixes; QA fixture lacks field 28`
NEXT_SAFE_ACTION: `Review A102 findings and create a separately approved fix/fixture task. Keep merge, deploy, database changes, and write capability blocked.`

## Reviewed core sources

The following files were read from the fetched core ref with `git show`, without merge or rebase:

- `origin/copilot-v1:docs/project-live/CORE_LIVE_STATE.md`;
- `origin/copilot-v1:docs/project-live/INTEGRATION_CONTRACT.md`;
- `origin/copilot-v1:docs/project-live/TASK_NUMBERING.md`;
- `origin/copilot-v1:docs/project-live/task-reports/core/TZ-147.md`.

Core commit `ec694129` keeps contract 0.2, records A101 as approved local read-only foundation, and confirms the dedicated `TravkinFlowTest1` agronomist QA identity. The identity can read its own Test1 scope and sees zero rows from another company under RLS. Database, migration, production, merge, and deploy restrictions remain unchanged.

## A102 compatibility and result

The security gate passed: core contract/hash matched, the user JWT resolved only to `TravkinFlowTest1`, cross-company RLS probes returned zero rows, all Supabase transport calls were GET, and the model saw only the eight approved schemas. The complete 20-scenario runtime validation finished with 14 PASS and 6 FAIL. These failures are acceptance findings, not permission to expand scope. No assistant or core application code was changed for A102.

The configured local alias `gpt-5.3` is unavailable to the existing key. It was not edited. The measured run used a process-only `gpt-5.4-mini` override and received effective snapshot `gpt-5.4-mini-2026-03-17`. Full evidence remains uncommitted under `audit-output/TZ-A102/`.

## Mandatory rule

Before every subsequent task in `assistant-v1`, fetch `origin/copilot-v1`, read the mandatory core sources with `git show`, and record the actual ref, contract version/hash, compatibility result, and allowed mode here. Contract changes, new core API requirements, database/schema work, fixes to the A102 findings, or any write capability require a separately approved task. No automatic merge or rebase is allowed.
