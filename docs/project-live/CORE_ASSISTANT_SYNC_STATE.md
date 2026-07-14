# Core Assistant Sync State

LAST_REVIEW_AT: 2026-07-14T23:01:15+05:00
CORE_BRANCH: `copilot-v1`
CORE_COMMIT: `SELF` (previous core commit: `8dee404f`)

ASSISTANT_BRANCH_REVIEWED: `origin/assistant-v1`
ASSISTANT_COMMIT_REVIEWED: `b22f765583b2cd556a29b9e25c332561f19dd262`
ASSISTANT_LIVE_STATE_REVIEWED_AT: 2026-07-14T23:01:15+05:00
ASSISTANT_SYNC_STATE_REVIEWED_AT: 2026-07-14T23:01:15+05:00
LATEST_ASSISTANT_TASK_REPORT: `origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A105.md` — conversation summary, unresolved-question metadata and candidate-first memory prototype completed locally; mocked QA `26/26`, DB/OpenAI/ERP writes `0`, real memory acceptance blocked by schema/contract gate.

ASSISTANT_CHANGES_FOUND: YES — TZ-A105 adds local-only summary/unresolved-question/memory lifecycle prototypes and requests an additive schema/RLS contract. Core/schema/production were not changed by the Assistant branch.
CORE_IMPACT_FOUND: YES — Core must approve storage ownership, RLS, non-production acceptance environment and the only permitted memory write boundary.
INTEGRATION_CONTRACT_IMPACT: YES — TZ-153 advances the contract from 0.2 to 0.3 and approves user-scoped candidate memory only in isolated non-production A106.
INTEGRATION_CONTRACT_VERSION: `0.3`
INTEGRATION_CONTRACT_SHA256: `D198522F103407C92BF34B86E9AC9EB265BF648559FA03AB4F0C010E67D9F9F6`
CORE_ACTION_REQUIRED: COMPLETED_BY_TZ153 — schema reviewed against live production metadata; minimal entities and RLS contract approved without merge or DB mutation.
NEXT_SAFE_ACTION: Keep TZ-A106 blocked. TZ-160 canonicalized the legacy test-user cleanup, but clean replay now fails at independent company cleanup `20260328150705`. Do not execute metadata repair until that migration is resolved and all 76 rows reproduce production.

## TZ-160 review result

TZ160_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ160_CORE_IMPACT_FOUND: `YES - test-user cleanup passes safely and exposes the next independent company-cleanup blocker`.
TZ160_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 and Assistant code are unchanged.
TZ160_CLEANUP_DECISION: `SAFE_CONDITIONAL_CLEANUP`; exact owner gate plus four explicit UUID/email pairs, no company deletion.
TZ160_LOCAL_RESULT: `PASS`; parser 135/135, no-owner, allowlist, ordinary-user/company, mismatch and second-apply checks pass.
TZ160_RECOVERY_PACKAGE: `PASS_REFRESHED`; repair 39, second repair 0, rollback 39, unchanged 37/37.
TZ160_FULL_REPLAY: `FAIL_AFTER_35_MIGRATIONS_520_STATEMENTS`; `20260328150705...sql:80` violates `seasons_company_id_fkey` while deleting a company.
TZ160_PRODUCTION_IMPACT: `NONE`; read-only metadata checks only, no history/schema/Auth/business-data write, migration apply, branch, merge or deploy.
TZ160_ACTION: `READY_FOR_METADATA_REPAIR=NO`; TZ-154 and TZ-A106 remain blocked pending a separate audit of `20260328150705` and complete production-parity replay.

## TZ-159 review result

TZ159_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ159_CORE_IMPACT_FOUND: `YES - both prior demo blockers pass, but clean bootstrap exposes the next independent Auth-dependent cleanup`.
TZ159_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 and Assistant code are unchanged.
TZ159_DEMO_DECISIONS: `20260308153257=SUPERSEDED_NOOP; 20260327175004=SUPERSEDED_NOOP`.
TZ159_LOCAL_RESULT: `PASS`; parser 135/135, each demo file first/second apply PASS with zero persistent changes.
TZ159_RECOVERY_PACKAGE: `PASS_REFRESHED`; repair 39, second repair 0, rollback 39, unchanged 37/37.
TZ159_FULL_REPLAY: `FAIL_AFTER_29_MIGRATIONS_503_STATEMENTS`; `20260327215913_cleanup_test_users_v3.sql:78` requires one pre-existing real Auth user/profile.
TZ159_PRODUCTION_IMPACT: `NONE`; read-only metadata checks only, no history/schema/Auth/business-data write, migration apply, branch, merge or deploy.
TZ159_ACTION: `READY_FOR_METADATA_REPAIR=NO`; TZ-154 and TZ-A106 remain blocked pending a separate audit of `20260327215913` and complete production-parity replay.

## TZ-158 review result

TZ158_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ158_CORE_IMPACT_FOUND: `YES - repaired history removes the backslash parser failure but does not yet bootstrap a clean database`.
TZ158_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 and Assistant code are unchanged.
TZ158_RECOVERY_PACKAGE: `PASS`; exactly 38 homogeneous rows plus separate `20260610123000`, with guarded 39-row repair and exact rollback.
TZ158_LOCAL_METADATA_TEST: `PASS`; repair 39, second repair 0, rollback 39, unchanged 37/37, tamper rollback PASS.
TZ158_FULL_REPLAY: `FAIL`; first clean error is missing hard-coded Auth identity in `20260327175004`; diagnostic fixture reveals multi-row RETURNING in `20260308153257`.
TZ158_PRODUCTION_IMPACT: `NONE`; no history/schema/Auth/business-data write, migration apply, branch, merge or deploy.
TZ158_ACTION: `READY_FOR_METADATA_REPAIR=NO`; TZ-154 and TZ-A106 remain blocked pending canonicalization and a full production-parity replay.

## TZ-157 review result

TZ157_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ157_CORE_IMPACT_FOUND: `YES - invalid local migration syntax blocked clean-chain replay and future isolated Assistant branch bootstrap`.
TZ157_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 and Assistant code are unchanged.
TZ157_LOCAL_CHAIN_RESULT: `135/135 parser-valid`; PostgreSQL 15 parsed `2524` statements with zero failures.
TZ157_ISOLATED_RESULT: `PASS`; first and second apply pass, duplicate guards reject case-insensitive duplicates and the sentinel business row remains unchanged.
TZ157_ARCHITECTURE: `MINIMAL_LEGACY_COMPATIBILITY`; `transport_models` remains canonical and historical global/company seed data is not replayed.
TZ157_PRODUCTION_IMPACT: `NONE`; no migration apply, history repair, schema write or business-data write.
TZ157_ACTION: `READY_FOR_EXACT_38_ROW_RECOVERY_PREVIEW_ONLY`; TZ-154 and TZ-A106 remain blocked pending separate recovery approval and execution.

## TZ-156 review result

TZ156_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ156_CORE_IMPACT_FOUND: `YES - migration 20260610123000 history is not a reproducible source for the current production objects`.
TZ156_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 and Assistant code are unchanged.
TZ156_CLASSIFICATION: `LOCAL_FILE_IS_CANONICAL`.
TZ156_EVIDENCE: both variants parse and execute in isolated PostgreSQL, but schema fingerprints differ; current production columns and both function-body MD5 values exactly match local SQL.
TZ156_ROOT_CAUSE: history stores an earlier two-statement draft; the file was expanded before its first Git commit and production was later aligned outside that history payload.
TZ156_PRODUCTION_IMPACT: `NONE`; read-only metadata queries only, with no history/schema/business-data write.
TZ156_ACTION: `A106_REMAINS_BLOCKED`; a future owner-approved task may prepare history-only repair metadata, but must not replay migration SQL.

## TZ-155 review result

TZ155_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ155_CORE_IMPACT_FOUND: `YES — A106 non-production environment cannot bootstrap from current production migration history`.
TZ155_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 remains unchanged and no Assistant code was merged.
TZ155_FAILED_BRANCH: `assistant-memory-a106` ended `MIGRATIONS_FAILED`; evidence was saved without secrets and the branch was deleted to stop billing.
TZ155_HISTORY_BACKUP: `PASS`; all 76 rows and all 135 local file hashes are outside Git with a verified SHA-256 manifest.
TZ155_CORRUPTION_RESULT: `38 homogeneous corrupted rows plus one separate unresolved history/local drift case, not 39`.
TZ155_LOCAL_CHAIN_RESULT: `134/135 parser-valid`; local-only `20260509142000` fails at `unique (lower(name))` and was not changed.
TZ155_PRODUCTION_IMPACT: `NONE`; no repair, migration SQL, schema write, business-data write, merge or deploy occurred.
TZ155_ACTION: `STOP`; A106 remains blocked until the owner separates and approves the three migration scopes above.

## TZ-153 review result

TZ153_ASSISTANT_CHANGES_FOUND: `A105_LOCAL_MEMORY_PROTOTYPE_AND_SCHEMA_PROPOSAL`
TZ153_ASSISTANT_COMMIT_VERIFIED: `b22f765583b2cd556a29b9e25c332561f19dd262`
TZ153_LIVE_SCHEMA_AUDIT: `PASS_WITH_SECURITY_GAPS`; `chats`/`chat_messages` are reusable but have legacy public-true policies, `assistant_memories` is reusable but has no RLS policies, and `assistant_audit_logs` is absent.
TZ153_APPROVED_STORAGE: `chat_messages.metadata + assistant_memories + new assistant_memory_events`
TZ153_COMPANY_MEMORY: `DISABLED`
TZ153_RUNTIME: `USER_JWT_RLS_PRIMARY`; service role is not an approved primary memory runtime.
TZ153_TEST_ENVIRONMENT: `SEPARATE_SUPABASE_BRANCH_REQUIRED`; current branch list is empty and only production project exists. Estimated branch cost returned by Supabase: `$0.01344/hour`; creation requires owner confirmation.
TZ153_PRODUCTION_IMPACT: `NONE`; no DB/schema/business-data/deploy/merge/rebase occurred.
TZ153_INTEGRATION_CONTRACT: `0.3 ASSISTANT_MEMORY_SCHEMA_APPROVED`
TZ153_ACTION: Reserve A106 for implementation/real acceptance after branch provisioning and A107 for the future full Knowledge Base.

## TZ-152 review result

TZ152_ASSISTANT_CHANGES_FOUND: `A104_SERVER_CONVERSATION_RUNTIME_V2_ONLY`
TZ152_CORE_IMPACT_FOUND: `NO_BLOCKER_FOR_GLBD_ALIAS_SOURCE_READ_PATH`
TZ152_INTEGRATION_CONTRACT_IMPACT: `NO`; Integration Contract was not edited.
TZ152_ACTION: Connected existing GLBD aliases to core catalog and knowledge-intake discovery and existing verified sources to lazy component cards. No Assistant code, merge, rebase, database write, migration or deployment was performed.

## TZ-151 review result

TZ151_ASSISTANT_CHANGES_FOUND: `A103_READ_ONLY_RUNTIME_FIXES_AND_ACCEPTANCE_ONLY`
TZ151_CORE_IMPACT_FOUND: `NO_BLOCKER_FOR_EXACT_GLBD_ALIAS_SOURCE_INSERT`
TZ151_INTEGRATION_CONTRACT_IMPACT: `NO`; Integration Contract was not edited.
TZ151_ACTION: Imported exactly 24 aliases and 295 sources after backup and live preflight. No merge, rebase, Assistant code change, migration, deployment, component/product-link/company mutation or blocked-row import occurred.

## TZ-150 review result

TZ150_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES_AFTER_A102`
TZ150_CORE_IMPACT_FOUND: `NO_BLOCKER_FOR_GLBD_PREVIEW_ONLY`
TZ150_INTEGRATION_CONTRACT_IMPACT: `NO`; Integration Contract was not edited.
TZ150_ACTION: Generated and isolated-tested the alias/source preview outside Git. No merge, rebase, Assistant code change, production import, database write, migration or deployment occurred.

## TZ-149 review result

TZ149_ASSISTANT_CHANGES_FOUND: `A102_DOCUMENTATION_AND_FINDINGS_ONLY`
TZ149_CORE_IMPACT_FOUND: `NO_BLOCKER_FOR_READ_ONLY_GLBD_AUDIT`
TZ149_INTEGRATION_CONTRACT_IMPACT: `NO`
TZ149_ACTION: Warehouse scope is frozen and the core focus returns to GLBD. No merge, rebase, Assistant code change, database write, import or deployment occurred.

## TZ-148 review result

TZ148_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`
TZ148_CORE_IMPACT_FOUND: `NO`; Warehouse Units V2 repeat-safety work is isolated to core migration/QA/docs.
TZ148_INTEGRATION_CONTRACT_IMPACT: `NO`; contract 0.2 and the eight-tool read-only allowlist remain unchanged.
TZ148_ACTION: Migration `20260713183038` is locally repeat-safe and ready for a fresh production preflight. No migration apply, production write, Assistant merge, or Assistant code change occurred.

## TZ-147 review result

TZ147_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`
TZ147_CORE_IMPACT_FOUND: `AUTH_TEST_IDENTITY_AND_GOVERNANCE_ONLY`
TZ147_INTEGRATION_CONTRACT_IMPACT: `NO`; contract 0.2 and the eight-tool read-only allowlist remain unchanged.
TZ147_QA_IDENTITY: `READY`; one confirmed `agronomist` profile belongs only to TravkinFlowTest1 and is neither global nor company admin.
TZ147_TOKEN_STORAGE: `LOCAL_IGNORED_ENV_ONLY`; values were not exposed or committed.
TZ147_RLS_TEST: `PASS`; Test1 reads pass and cross-company reads return zero rows.
TZ147_PRODUCTION_IMPACT: `AUTH_PROFILE_ONLY`; business data, schema, migrations, app code, merge, and deploy unchanged.

## TZ-146 review result

TZ146_ASSISTANT_CHANGES_FOUND: `NO_NEW_CHANGES`
TZ146_CORE_IMPACT_FOUND: `NO`
TZ146_INTEGRATION_CONTRACT_IMPACT: `NO`
TZ146_ACTION: Warehouse preflight continued; no stop condition was triggered.

## Mandatory rule

Перед каждым CORE-ТЗ основной поток обязан обновить этот файл фактическими commit/date/report значениями после чтения состояния `origin/assistant-v1`. Если найдено влияние на core или [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md), текущая задача получает `STOP` до отдельного решения владельца. Автоматический merge или rebase между ветками запрещён.
