# Core Assistant Sync State

LAST_REVIEW_AT: 2026-07-17T17:25:44+05:00
CORE_BRANCH: `copilot-v1`
CORE_COMMIT: `SELF` (previous core commit: `65e2d5c`)

ASSISTANT_BRANCH_REVIEWED: `origin/assistant-v1`
ASSISTANT_COMMIT_REVIEWED: `b22f765583b2cd556a29b9e25c332561f19dd262`
ASSISTANT_LIVE_STATE_REVIEWED_AT: 2026-07-16T13:30:00+05:00
ASSISTANT_SYNC_STATE_REVIEWED_AT: 2026-07-16T13:30:00+05:00
LATEST_ASSISTANT_TASK_REPORT: local untracked `assistant-v1:docs/project-live/task-reports/assistant/TZ-A106.md` — V1 candidate-first branch acceptance exists only in the Assistant worktree and is superseded for memory behavior by Contract 0.4. The latest committed Assistant report remains TZ-A105 at `b22f765`.

ASSISTANT_CHANGES_FOUND: YES — local untracked owner-memory-behavior-v2 proposal and A106 V1 implementation/report were reviewed read-only; `origin/assistant-v1` still points to `b22f765`. No merge or rebase occurred.
CORE_IMPACT_FOUND: YES — owner decision requires direct-approved USER_GLOBAL memory, safe inferred allowlist, role-gated COMPANY memory and immediate deletion.
INTEGRATION_CONTRACT_IMPACT: YES — TZ-169 advances the contract from 0.3 to 0.4 and supersedes candidate-first behavior.
INTEGRATION_CONTRACT_VERSION: `0.4`
INTEGRATION_CONTRACT_SHA256: `23F7C742DAA9C991933D3298404A8E8C2AF58A2DC0222B1523923F9E59038FF1`
CORE_ACTION_REQUIRED: COMPLETED_BY_TZ169 — Memory Policy V2 applied only to `gsglkmudcwkdetqtocae`; real JWT acceptance passed without production mutation.
NEXT_SAFE_ACTION: TZ-181 does not change the Assistant contract or branch. A107 may start only on `gsglkmudcwkdetqtocae`; production memory migration, merge and deploy remain disabled. GLBD may continue only after owner review of the 10 decision cards and explicit approval of a selective safe apply; 15 unresolved cards remain blocked.

## TZ-181 review result

TZ181_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime, QA branch, dataset and Contract 0.4 were not touched.
TZ181_CORE_IMPACT_FOUND: `YES - universal read-only Batch 1 review script, external evidence package and live-state documentation`.
TZ181_SCOPE: `45/45 unique TZ-180 BATCH_1_P0 cards`; unclassified and duplicate rows `0`.
TZ181_CLASSIFICATION: `20 SAFE_AUTO_APPLY / 10 OWNER_APPROVAL_REQUIRED / 15 UNRESOLVED`.
TZ181_DATA_PREVIEW: `17 source-backed component links / 4 existing canonical formulation assignments`; component duplicate and alias conflict previews `0`.
TZ181_SEARCH: `50/50 target scenarios expected pass`; 30 direct and 20 scenarios across ten RU queries require disambiguation; new alias rows `0`.
TZ181_IDENTITY: `Celest Top / Селест Топ, КС` classified as one likely identity, but merge remains owner-gated and executed merges are `0`.
TZ181_REPRODUCIBILITY: `PASS - two runs produced fingerprint 49774e39ff293e24490b0c7ae90d7b23e7c88b10f845eeaf12b6846242a9e580 and byte-identical manifests`.
TZ181_PRODUCTION_IMPACT: `NONE`; writes, merges, links, aliases, migration, deploy and master merge are `0`.
TZ181_ACTION: `READY_FOR_OWNER_REVIEW`; no production apply is authorized.

## TZ-180 review result

TZ180_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime, QA branch, dataset and Contract 0.4 were not touched.
TZ180_CORE_IMPACT_FOUND: `YES - universal read-only pesticide-card audit script, external evidence package and live-state documentation`.
TZ180_SCOPE: `852/852 global active pesticide cards`; fertilizers, company-local products and archived technical rows excluded.
TZ180_CLASSIFICATION: `PASS - complete 0, minor gaps 776, blocked/review 76, unclassified 0, duplicate audit rows 0`.
TZ180_SEARCH: `1059 scenarios / 1009 pass / 50 fail across 24 cards`; known Curamin/Phomazin RU/EN cases pass outside pesticide scope.
TZ180_REPRODUCIBILITY: `PASS - two runs produced fingerprint 2d74a26055cbad5a1466b591dc77ffc2926364ccafa06cf2d26f44f05401f696; manifest errors 0`.
TZ180_PRODUCTION_IMPACT: `NONE`; production writes, component-link changes, migration, deploy and merge are 0.
TZ180_ACTION: `READY_FOR_BATCH_1_READ_ONLY_REVIEW`; this does not authorize catalog merges or production writes.

## TZ-179 review result

TZ179_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime, QA branch, dataset and Contract 0.4 were not touched.
TZ179_CORE_IMPACT_FOUND: `YES - owner-approved production GLBD catalog apply and live-state evidence`.
TZ179_PRODUCTION_APPLY: `PASS - fresh backup, verified manifests, no-drift preflight and one-transaction apply of 53 approved decisions`.
TZ179_FINAL_STATE: `431 components / 63 aliases / 318 sources / 1373 global product links / 0 company links`; Humic acids unchanged.
TZ179_ACCEPTANCE: `PASS - duplicates/conflicts/garbage/mojibake 0, RU/EN/API/UI helper PASS, second apply exact NOOP, six critical routes HTTP 200`.
TZ179_PRODUCTION_IMPACT: `APPROVED_GLOBAL_CATALOG_DATA_ONLY`; product rows, company/business data, schema, migration history, deploy and master are unchanged.
TZ179_ACTION: `READY_FOR_NEXT_GLBD_STAGE`; Assistant branch-only gates remain unchanged.

## TZ-178 review result

TZ178_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime, QA dataset, branch and Contract 0.4 were not touched.
TZ178_CORE_IMPACT_FOUND: `YES - reproducible UTF-8-safe GLBD generator, external package and live-state evidence`.
TZ178_ROOT_CAUSE: `Windows PowerShell 5.1 default ANSI decoding of BOM-less UTF-8 before database-tool serialization; PostgreSQL UTF8 was not the source`.
TZ178_PACKAGE: `PASS - exact 53 decisions, Humic excluded, 4655 canonical text values, NFC PASS, mojibake 0, ASCII-only SQL and verified 9-file manifest`.
TZ178_ISOLATED_ACCEPTANCE: `PASS - real component-discovery helper, first apply, second NOOP, 18127 DB texts clean, RU/EN/API/UI PASS and exact rollback`.
TZ178_PRODUCTION_IMPACT: `NONE`; production remains ACTIVE_HEALTHY at 425/24/295/1373 with company links 0; writes, migration, db push, deploy and merge are 0.
TZ178_ACTION: `READY_FOR_SELECTIVE_APPLY_WITH_SEPARATE_OWNER_APPROVAL`; TZ-179 must repeat backup, manifest and live no-drift preflight.

## TZ-177 review result

TZ177_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime and Contract 0.4 were not changed.
TZ177_CORE_IMPACT_FOUND: `YES - owner-approved branch-only catalog security alignment and repeated JWT gate`.
TZ177_BRANCH_APPLY: `PASS - only 20260716114950 applied to gsglkmudcwkdetqtocae; SHA matched; no db push or other migration`.
TZ177_SECURITY_STATE: `PASS - RLS 8/8, policies 32, functions 27/27, PUBLIC/anon execute 0/0, authenticated execute exactly 5`.
TZ177_REAL_JWT: `PASS - ordinary and company-admin alias mutations denied, global-admin CRUD allowed, anon denied, cross-company denied`.
TZ177_DATASET: `UNCHANGED - 8 fields / 1000 ha / 9 crop lines / 5 operations / warehouses 2+1 / ledger 6+1 / exact balances`.
TZ177_PRODUCTION_IMPACT: `NONE`; production writes 0, schema/Auth/business data/deploy/master unchanged.
TZ177_ACTION: `A107_MAY_START_BRANCH_ONLY`; production Assistant migration, merge and deploy remain disabled.

## TZ-176 review result

TZ176_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime, memory tables and Contract 0.4 were not changed.
TZ176_CORE_IMPACT_FOUND: `YES - reproducible branch-only canonical references and ERP QA dataset under scripts/qa`.
TZ176_DATASET: `PASS - 8 fields / 1000 ha / 9 crop lines / 5 operations / 2 company-A warehouses / exact 1550 kg + 520 l + 200 l balances`.
TZ176_REPEAT_SAFETY: `PASS - reference second seed 0, dataset second seed 0, exact cleanup and full reseed PASS`.
TZ176_REAL_JWT_ISOLATION: `PASS - A/B cross-company ERP, chats and memories all return 0`.
TZ176_SECURITY_GATE: `RESOLVED_BY_TZ177 - the pre-apply failure remains recorded; repeated branch-only JWT acceptance now passes`.
TZ176_PRODUCTION_IMPACT: `NONE`; only permitted read-only global reference evidence was used.
TZ176_ACTION: `SUPERSEDED_BY_TZ177_BRANCH_SECURITY_PASS`.

## TZ-174 review result

TZ174_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime, branch and Contract 0.4 were not touched.
TZ174_CORE_IMPACT_FOUND: `YES - external UTF-8-safe GLBD apply package and live-state evidence only`.
TZ174_ROOT_CAUSE: `Windows PowerShell 5.1 default ANSI decoding of BOM-less UTF-8 before database-tool serialization; PostgreSQL client_encoding was UTF8`.
TZ174_PACKAGE: `PASS - exact 53 decisions, Humic excluded, 4012 text values, NFC PASS, mojibake 0, SQL ASCII-only with U& Unicode literals`.
TZ174_ISOLATED_ACCEPTANCE: `PASS - production snapshot, real GLBD constraints/triggers and component-discovery helper; first apply, second NOOP, RU/EN/API/UI smoke and exact timestamp-preserving rollback`.
TZ174_PRODUCTION_IMPACT: `NONE`; production remains 425/24/295/1373, company links 0, Humic unchanged; no migration, deploy or merge.
TZ174_ACTION: `READY_FOR_NEW_SELECTIVE_APPLY_WITH_SEPARATE_OWNER_APPROVAL`; fresh backup and live preflight remain mandatory.

## TZ-173 review result

TZ173_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime, branch and Contract 0.4 were not touched.
TZ173_CORE_IMPACT_FOUND: `YES - owner-approved GLBD selective apply stopped at required catalog smoke and was rolled back exactly`.
TZ173_PREFLIGHT_AND_APPLY: `PASS - fresh backup, verified manifest, no-drift preflight, one transaction and second-apply NOOP`.
TZ173_SMOKE: `FAIL - six new safener RU labels were mojibake; EN search passed but RU alias/exact search failed`.
TZ173_ROLLBACK: `PASS_EXACT - 425/24/295/1373 restored; five business snapshots and schema fingerprint match baseline; Humic unchanged`.
TZ173_PRODUCTION_IMPACT: `NONE_AFTER_ROLLBACK`; no business/company data change, migration, deploy or merge.
TZ173_ACTION: `BLOCK_UNCHANGED_RETRY`; regenerate a UTF-8-safe package in a separate task and require fresh approval. Humic acids remains HOLD_OUT_OF_SCOPE.

## TZ-172 review result

TZ172_ASSISTANT_CHANGES_FOUND: `NO`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ172_CORE_IMPACT_FOUND: `YES - read-only GLBD classification and guarded selective apply package outside Git`.
TZ172_CLASSIFICATION: `PASS - 54/54 classified, unclassified 0, owner HOLD 1`.
TZ172_ISOLATED_ACCEPTANCE: `PASS - first apply, second NOOP, exact rollback, duplicates 0, links preserved 1373, RU/EN search PASS`.
TZ172_PRODUCTION_IMPACT: `NONE`; no database write, migration, deploy, merge or business-data change.
TZ172_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.4, Assistant runtime and branch-only memory policy are unchanged.
TZ172_ACTION: `SEPARATE_OWNER_APPROVAL_REQUIRED_FOR_SELECTIVE_GLBD_APPLY`; Humic acids stays on HOLD.

## TZ-171 review result

TZ171_ASSISTANT_CHANGES_FOUND: `NO`; `assistant-memory-a106` remained `gsglkmudcwkdetqtocae / ACTIVE_HEALTHY` and was not used, reset, rebased or changed.
TZ171_CORE_IMPACT_FOUND: `YES - approved production catalog security hardening is installed`.
TZ171_PRODUCTION_APPLY: `PASS - only 20260716114950 applied in its explicit transaction; history 136, head 20260716114950`.
TZ171_SECURITY_ACCEPTANCE: `PASS - RLS 8/8, policies 32, wide writes 0, 27/27 hardened, PUBLIC/anon execute 0/0, JWT 178/178, cross-company denied`.
TZ171_DATA_AND_SMOKE: `PASS - all public row counts unchanged, catalog reads healthy, temporary QA identities removed, critical routes 8/8 HTTP 200`.
TZ171_PRODUCTION_IMPACT: `APPROVED_SECURITY_SCHEMA_ONLY`; business data, app deploy and master unchanged; rollback not required.
TZ171_ACTION: `READY_TO_RETURN_TO_GLBD`; Assistant Contract 0.4 branch-only gate remains unchanged.

## TZ-170 review result

TZ170_ASSISTANT_CHANGES_FOUND: `NO`; `assistant-memory-a106` remained `gsglkmudcwkdetqtocae / ACTIVE_HEALTHY` and was neither used nor changed.
TZ170_CORE_IMPACT_FOUND: `YES - security migration is now self-contained on the real production baseline`.
TZ170_ROOT_CAUSE: `TZ-167 inherited private from branch-only Assistant Memory V1; production has no private schema`.
TZ170_PRODUCTION_EQUIVALENT: `PASS - 133/133 production-head migrations, 2556 statements, no Assistant Memory or Warehouse V2, zero unexplained semantic schema differences`.
TZ170_SECURITY_ACCEPTANCE: `PASS - atomic rollback, first/second apply, RLS 8/8, policies 32, 27/27 hardened, JWT 178/178, rollback PASS`.
TZ170_PRODUCTION_IMPACT: `NONE`; no production SQL, migration-history change, schema/business-data write, deploy or merge.
TZ170_ACTION: `SEPARATE_OWNER_APPROVAL_REQUIRED_FOR_TZ171`; fresh backup and live preflight are mandatory before production apply.

## TZ-169 review result

TZ169_PROPOSAL_REVIEWED: `YES_LOCAL_WORKTREE_ONLY`; requested proposal path is untracked in `project-assistant-v1` and absent from `origin/assistant-v1`, SHA-256 `053481AE571BEB4E20A3C67F54437F8A3903EC7B82F59F20C141E5D8E3AFA196`.
TZ169_CONTRACT: `0.4 / DIRECT_APPROVED_MEMORY_V2`.
TZ169_BRANCH: `assistant-memory-a106 / gsglkmudcwkdetqtocae / ACTIVE_HEALTHY / history 136`.
TZ169_MIGRATION: `20260716125205_assistant_memory_policy_v2.sql / BRANCH_ONLY_APPLIED`.
TZ169_ACCEPTANCE: `PASS - mandatory scenarios 10/10; cross-user and cross-company denied; authorized company-admin own-company lifecycle PASS; QA role restored`.
TZ169_PRODUCTION_IMPACT: `NONE`; production history remains 135, `assistant_memory_events` remains absent, business data/Auth/schema/deploy unchanged.
TZ169_ACTION: `A106_MAY_SYNC_AND_RESUME_BRANCH_ONLY`; A107 remains not started, production migration/merge/deploy disabled.

## TZ-168 review result

TZ168_ASSISTANT_CHANGES_FOUND: `NO`; `assistant-memory-a106` remained `gsglkmudcwkdetqtocae / ACTIVE_HEALTHY` and was not used or changed.
TZ168_CORE_IMPACT_FOUND: `YES - production catalog security apply is blocked by a hidden branch-only schema dependency`.
TZ168_APPLY_RESULT: `SAFE_STOP`; SQLSTATE `3F000`, schema `private` absent, transaction rolled back atomically.
TZ168_PRODUCTION_IMPACT: `NONE`; history `135`, target RLS `0/8`, policies `0`, 27 definer functions and business row counts unchanged.
TZ168_ASSISTANT_GATE: `UNCHANGED`; A106 remains isolated to its own branch and production Assistant schema/writes remain disabled.
TZ168_ACTION: `DO_NOT_RETRY_CURRENT_MIGRATION`; prepare a separately approved production-safe helper-schema revision and repeat production-equivalent isolated JWT acceptance.

## TZ-167 review result

TZ167_ASSISTANT_CHANGES_FOUND: `NO`; `assistant-memory-a106` remained `gsglkmudcwkdetqtocae / ACTIVE_HEALTHY` and was not used for Core security testing.
TZ167_CORE_IMPACT_FOUND: `YES - branch-tested catalog RLS and function-grant candidate`.
TZ167_TEST_BRANCH: `core-security-tz167 / shwhfrceabafxbmaivzk / 135 of 135 / DELETED_AFTER_PASS`.
TZ167_SECURITY_RESULT: `PASS - 8 of 8 RLS, 27 of 27 fixed search_path, PUBLIC execute 0, real JWT 178 of 178`.
TZ167_PRODUCTION_IMPACT: `NONE`; no production migration, Auth/business-data write, deploy or merge.
TZ167_ASSISTANT_GATE: `UNCHANGED`; A106 remains isolated to its own branch and Contract 0.3.
TZ167_ACTION: `SEPARATE_OWNER_APPROVAL_REQUIRED_FOR_PRODUCTION_SECURITY_APPLY`.

## TZ-166 review result

TZ166_ASSISTANT_CHANGES_FOUND: `NO`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ166_CORE_IMPACT_FOUND: `YES - production migration metadata is canonical 135/135`.
TZ166_METADATA_REPAIR: `PASS - 39 preserved, 37 updated, 59 inserted, second repair 0`.
TZ166_PRODUCTION_IMPACT: `METADATA_ONLY`; production schema, Auth and business data are unchanged; migration SQL was not executed.
TZ166_BRANCH: `assistant-memory-a106 / gsglkmudcwkdetqtocae / FUNCTIONS_DEPLOYED / ACTIVE_HEALTHY`.
TZ166_BOOTSTRAP: `PASS - 135/135 migrations, no first error`.
TZ166_SCHEMA_COMPARISON: `133-version production baseline matches; two explained branch-only scopes are Warehouse Units V2 and Assistant Memory V1; unexplained differences 0`.
TZ166_RLS_GATE: `A106_REQUIRED`; all four assistant tables have RLS, but real JWT denial must address/verify legacy permissive chat policies on the branch.
TZ166_ACTION: `A106_MAY_START_ON_ISOLATED_BRANCH_ONLY`; no production memory writes, merge or deploy.

## TZ-165 review result

TZ165_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime and A106 code were not changed.
TZ165_CORE_IMPACT_FOUND: `YES - 39 migration-history statement payloads repaired successfully`.
TZ165_METADATA_REPAIR: `PASS - 39 changed, 37 unchanged, second repair 0, schema/data unchanged`.
TZ165_BRANCH: `assistant-memory-a106 / xhlfixtoubejuxnpdzyx / MIGRATIONS_FAILED / DELETED`.
TZ165_FIRST_BOOTSTRAP_ERROR: `20260413182000 calls public.ensure_updated_at_column() but its stored history payload does not create it`.
TZ165_PRODUCTION_IMPACT: `METADATA_ONLY`; production schema, Auth and business data unchanged; no migration SQL, db push, deploy or merge.
TZ165_ACTION: `A106_REMAINS_BLOCKED`; prepare a separately approved full canonical history metadata repair before retrying Supabase Branching.

## TZ-164 review result

TZ164_ASSISTANT_CHANGES_FOUND: `NO`; Assistant runtime and branch were not changed.
TZ164_CORE_IMPACT_FOUND: `YES - all ten production baseline sources restored`.
TZ164_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 is unchanged.
TZ164_PRODUCTION_HEAD_REPLAY: `PASS - 133/133 files, 76/76 tracked versions, 2556 statements`.
TZ164_FULL_LOCAL_REPLAY: `PASS - 135/135 files, 2643 statements`.
TZ164_SCHEMA_PARITY: `PASS - zero unexplained semantic differences; function signature/body drift 0`.
TZ164_HISTORY_PACKAGE: `PASS - repair 39, second repair 0, exact rollback, unchanged 37/37`.
TZ164_PRODUCTION_IMPACT: `NONE`; no SQL apply, history repair, schema/business-data write, deploy or merge.
TZ164_ACTION: `READY_FOR_METADATA_REPAIR=YES_TECHNICALLY`; owner approval, fresh backup and live preflight are still mandatory, then Supabase branch bootstrap may resume.

## TZ-161 review result

TZ161_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ161_CORE_IMPACT_FOUND: `YES - remaining broad company cleanup is safe, but clean bootstrap exposes a working schema dependency gap`.
TZ161_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 and Assistant code are unchanged.
TZ161_CURRENT_DECISION: `SUPERSEDED_NOOP_CLEANUP_WITH_RLS_PRESERVED`; first and second apply preserve company/business data.
TZ161_ADDITIONAL_LEGACY_BLOCKERS: `0`.
TZ161_RECOVERY_PACKAGE: `PASS_REFRESHED`; repair 39, second repair 0, rollback 39, unchanged 37/37.
TZ161_FULL_REPLAY: `STOP_AFTER_48_MIGRATIONS_758_STATEMENTS`; `20260413182000...sql:59` requires missing `public.ensure_updated_at_column()`.
TZ161_PRODUCTION_IMPACT: `NONE`; read-only metadata checks only, no history/schema/Auth/business-data write, migration apply, branch, merge or deploy.
TZ161_ACTION: `READY_FOR_METADATA_REPAIR=NO`; TZ-154 and TZ-A106 remain blocked pending separate provenance audit for the missing working-schema function and complete production-parity replay.

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

## TZ-162 review result

TZ162_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ162_CORE_IMPACT_FOUND: `YES - safe migration prerequisites restored, but clean replay found a semantic legacy crop-category blocker`.
TZ162_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 and Assistant code are unchanged.
TZ162_LOCAL_CHAIN_RESULT: `135/135 parser-valid; replay 64 migrations / 987 statements before SQLSTATE 23514`.
TZ162_HISTORY_PACKAGE: `PASS_INTERNAL_ONLY - repair 39, second repair 0, rollback 39, unchanged 37/37; not production-ready`.
TZ162_PRODUCTION_IMPACT: `NONE`; read-only metadata checks only, with no history/schema/business-data write.
TZ162_ACTION: `STOP_SEMANTIC_REVIEW_REQUIRED`; owner must approve canonical mapping for legacy global crop identities and a plan for 36 absent history-source objects before metadata repair or A106.

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

## TZ-163 review result

TZ163_ASSISTANT_CHANGES_FOUND: `NO_NEW_ASSISTANT_BRANCH_CHANGES`; `origin/assistant-v1` remains `b22f765583b2cd556a29b9e25c332561f19dd262`.
TZ163_CORE_IMPACT_FOUND: `YES - local canonical chain now replays fully, but exact production baseline parity is not yet proved`.
TZ163_INTEGRATION_CONTRACT_IMPACT: `NO`; Contract 0.3 and Assistant code are unchanged.
TZ163_LOCAL_CHAIN_RESULT: `PASS - 135/135 migrations, 2535 statements, no parser/missing-object/FK/duplicate errors`.
TZ163_HISTORY_PACKAGE: `PASS_INTERNAL_ONLY - repair 39, second repair 0, rollback 39, unchanged 37/37`.
TZ163_PRODUCTION_IMPACT: `NONE`; read-only metadata checks only, no history/schema/Auth/business-data write.
TZ163_ACTION: `A106_REMAINS_BLOCKED`; create canonical sources for seven production-only tables, one function and two triggers before any metadata repair or new Supabase branch.

## Mandatory rule

Перед каждым CORE-ТЗ основной поток обязан обновить этот файл фактическими commit/date/report значениями после чтения состояния `origin/assistant-v1`. Если найдено влияние на core или [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md), текущая задача получает `STOP` до отдельного решения владельца. Автоматический merge или rebase между ветками запрещён.
