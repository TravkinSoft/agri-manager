# Assistant Sync State

LAST_SYNC_AT: `2026-07-13T23:42:35+05:00`
ASSISTANT_BRANCH: `assistant-v1`
ASSISTANT_BASE_COMMIT: `4cb8cdf77f140da5a04ade53a5f4022bc04b9bc4`
ASSISTANT_COMMIT: `SELF` (TZ-A101 implementation commit)

CORE_BRANCH_REVIEWED: `origin/copilot-v1`
CORE_COMMIT_REVIEWED: `03696a7914a134b6f2b1ab7d7411e9e7c76be8e3`
CORE_LIVE_STATE_REVIEWED_AT: `2026-07-13T23:42:35+05:00`
INTEGRATION_CONTRACT_VERSION: `0.1`
INTEGRATION_CONTRACT_HASH: `834b8d942a401aae380ecd62a1883758ed7722d2c8764fd1f2592d9f113873f4`

CORE_PRODUCTION_COMMIT_REVIEWED: `321e45fa681fecff89307545d0ec3fa600b4c982`
CORE_PRODUCTION_STATUS: `READY_WITH_CONTROLLED_P1_GAPS`
CORE_DB_STATUS_REVIEWED: `76 remote history rows; head 20260712203746; 57 old local-only versions remain; db push prohibited`
ASSISTANT_ALLOWED_MODE: `EXPLICIT_OWNER_APPROVAL_FOR_TZ_A101_READ_ONLY_IMPLEMENTATION_ONLY`
WRITE_CAPABILITY_APPROVED: `NO`

CORE_CHANGES_SINCE_LAST_SYNC: `TZ-143 warehouse unit correction plan and Project Live updates; no new assistant API, schema, contract permission, or A101 registry row`
CONTRACT_CHANGES_FOUND: `NO; version/hash unchanged`
ASSISTANT_API_CONTRACT_CHANGES_FOUND: `NO_NEW_CORE_API_OR_SCHEMA_REQUIRED_BY_A101`
INCOMPATIBLE_CHANGES_FOUND: `GOVERNANCE_DRIFT_ONLY: contract remains foundation-only and A101 row is absent from core TASK_NUMBERING`
OWNER_TASK_OVERRIDE: `TZ-A101 explicitly states READ_ONLY_IMPLEMENTATION_APPROVED=YES and WRITE_CAPABILITY_APPROVED=NO`
SYNC_STATUS: `COMPATIBLE_FOR_NARROW_ASSISTANT_ONLY_LOCAL_IMPLEMENTATION_BY_EXPLICIT_OWNER_APPROVAL`
SYNC_BLOCKER: `NONE_FOR_THIS_LOCAL_IMPLEMENTATION; CORE_REGISTRY_AND_CONTRACT_RECONCILIATION_REQUIRED_BEFORE_PRODUCTION_ACCEPTANCE`
NEXT_SAFE_ACTION: `Complete local verification and publish assistant-v1; core reviews the security proposal and reconciles A101 governance without merging automatically.`

## Reviewed core sources

The following files were read from the fetched core ref with `git show`, without merge or rebase:

- `origin/copilot-v1:docs/project-live/CORE_LIVE_STATE.md`;
- `origin/copilot-v1:docs/project-live/INTEGRATION_CONTRACT.md`;
- `origin/copilot-v1:docs/project-live/TASK_NUMBERING.md`;
- `origin/copilot-v1:docs/project-live/CORE_ASSISTANT_SYNC_STATE.md`.

Core commit `03696a7` reports the warehouse unit correction plan, no new assistant read API, no contract version change, and no permission for writes. It keeps the two assistant security findings isolated for separate core work. The database migration restrictions remain unchanged and were not touched by A101.

## A101 compatibility decision

The A101 implementation is confined to assistant-owned runtime and UI code, uses existing read surfaces through authenticated user JWT/RLS, adds no migration or database table, and exposes no write, navigation, SQL, resolver, or KB mutation tool. This satisfies the task-level owner approval without changing a core-owned contract or workflow. The implementation must not be treated as production-approved until core records A101 and resolves the contract drift.

## Mandatory rule

Before every subsequent task in `assistant-v1`, fetch `origin/copilot-v1`, read the four mandatory core files with `git show`, and record the actual ref, contract version/hash, compatibility result, and allowed mode here. Contract changes, new core API requirements, database/schema work, or any write capability require `STOP` and separate owner/core approval. No automatic merge or rebase is allowed.
