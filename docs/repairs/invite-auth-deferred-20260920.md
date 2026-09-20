# P0: director invitation / Database error creating new user

## Status: PRODUCTION APPLIED AND AUTH API VERIFIED

User explicitly approved the shared registration trigger change in the following turn. Applied Production migration: `20260920182051_p0_invite_deferred_auth_metadata_v1` (replaces the proposed local filename below). Real Auth API createUser now succeeds for a pending non-owner director in the exact test tenant. The disposable user/profile were removed; no email or session was created. Function ACL remains `{postgres=X/postgres}`. 76 local checks passed again. Security advisor counts unchanged across all seven categories; existing unrelated findings were not modified.

Initial application after authorization rolled back because postgres is not owner of auth.users. It does have TRIGGER privilege. The final migration follows Supabase's documented restricted-schema procedure: assert handle_new_user has exactly the one expected trigger dependency, drop that owned function with CASCADE, recreate function and deferred trigger in the same transaction, revoke all non-owner execution. No grants on auth.users or privileged role membership were changed. Source: https://supabase.com/docs/guides/database/postgres/triggers#dropping-a-trigger .

The historical investigation below records the earlier blocked state, not current status.

20 September 2026. Production deployment remains dpl_7q2kEtdsuT8TmDRXCNBizLxYVXmT (READY). No web release was attempted. The database migration application was rejected by automatic safety review because changing the shared Auth trigger requires explicit authorization for all-user provisioning behavior. Do not bypass the rejection; obtain user approval first.

## Root cause

The production auth.users AFTER INSERT trigger calls public.handle_new_user immediately. Current code requires trusted invitation app_metadata or an explicit company-registration name. Supabase Auth adminUserCreate inserts the user with provider metadata first, then updates app_metadata in the same transaction. The trigger raises AUTH_COMPANY_NAME_REQUIRED before trusted invitation metadata is available.

Evidence:

- A rolled-back SQL probe with marker present at INSERT succeeds.
- The real INSERT-then-UPDATE sequence fails with AUTH_COMPANY_NAME_REQUIRED (P0001), with full rollback.
- Actual Auth admin createUser against an existing test company, pending disposable director, no password/email/session: HTTP 500 unexpected_failure, Database error creating new user. No test account created.
- The target account from the screenshot has no auth user or profile. No new email-named company appeared.
- Primary upstream implementation: https://github.com/supabase/auth/blob/master/internal/api/admin.go (tx.Create before UpdateAppMetaData).

## Proposed fix and scope

Migration 20260920154147_p0_invite_deferred_auth_metadata_v1 replaces only handle_new_user's entry handling and the existing on_auth_user_created trigger. The trigger becomes a DEFERRABLE INITIALLY DEFERRED INSERT constraint trigger. Before commit, it reads the final auth.users row (NEW would otherwise retain the INSERT snapshot) and executes the unchanged role/tenant/pending validation.

No fallback to untrusted user_metadata authorization. No new grants, role allowlist changes, activation, RLS changes, company creation by invitation, rebinding of existing profiles or business data changes. Existing users are not replayed. Direct deliberate company registration retains its existing behavior. A malformed or missing trusted marker without deliberate registration fails the entire transaction at commit.

Risk: the trigger serves all new account provisioning, not just directors. A defect can block all new registrations; deferred validation errors surface at commit. Existing logins and users are not targeted. Rollback would restore the exact original trigger/function and also restore the current invitation failure.

## Local verification

`node scripts/qa-company-creation-identity.mjs --deferred-auth`: 76 checks PASS, no Production connections.

Coverage: reproducible pre-fix split-write failure; generic roles and all three PTC roles; pending non-owner profiles; exact tenant matching despite forged user_metadata; no invitation-created companies; privilege/ambiguous-marker rejection; existing profile unaffected by later user metadata updates; explicit company registration; duplicate company prevention; archived tenant rejection; unchanged definer/search_path boundary.

`scripts/qa-invite-auth-api-smoke.mjs --production-smoke` is an explicit opt-in real API smoke for after authorization/application. It creates a disposable pending director in TravkinFlowTest1 without email/activation/session and removes only that exact identity. Before application, `--expect-failure` reproduced the Production error. After the denied migration, the success-mode probe still failed as expected; nothing was created. The local Node runtime also emitted a shutdown assertion on failed runs; this is distinct from the verified remote HTTP 500.

Next: explicit user authorization for the shared trigger change; apply the migration once; verify real Auth API provisioning and cleanup; run advisors delta and save the actual migration version; invite the real person only through the intended company context, not by guessing it from their name.
