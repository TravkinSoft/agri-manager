# Google Play reviewer provisioning — 2026-09-20

Owner explicitly authorized a separate reviewer account and isolated demo organization.

## Result

- Created through Supabase Auth Admin API, with the existing `handle_new_user` trigger provisioning the demo organization and profile.
- Auth user: `8f07365f-8be5-4ae4-98c8-b96148b324bf`.
- Demo company: `9fb971ad-b5b1-4284-8b06-c4325d385f6a`, `TravkinFlow Google Play Demo`.
- Profile is now `active`, `is_owner=false`, `preferred_language=en`; Auth ban lifted after the isolation recheck below.
- Random password stored using Windows DPAPI under the owner's Documents secure Google Play directory, outside this repository. No password in commands, outputs, or source.
- No reviewer credential submitted to Google. No real company/account modified.

## Original isolation blocker (resolved by another workstream)

A transaction temporarily activated this exact new profile, set authenticated JWT claims to the exact reviewer UUID, and checked cross-company SELECT visibility. All temporary profile changes were rolled back.

- 108 tenant tables checked through their RLS rules.
- Companies visible: 1 (reviewer's own).
- Profiles visible: 1 (reviewer's own).
- Cross-company `chats` rows visible: 55.
- `chat_messages` rows visible: 913.
- Only counts were read, not conversation contents.

Confirmed policy cause:

- `chats`: `Allow public read on chats`, PUBLIC, permissive, `USING (true)`.
- `chat_messages`: `Allow public read on chat_messages`, PUBLIC, permissive, `USING (true)`.
- Additional legacy chat policies allow `user_id IS NULL` independent of tenant.

An isolated profile alone therefore cannot satisfy the owner's no-cross-account-access requirement. Before unbanning or submitting the reviewer account, fix the affected chat access policies and verify both existing legitimate chat access and reviewer isolation. Changes to existing Production access policies require expanding the owner's earlier explicit no-permission-changes boundary; no such changes were applied in this task.

## Boundaries and next step

Production writes are no longer zero: owner-authorized new Auth identity, one demo company, one profile, and a protective ban. Activation checks rolled back. No real business records, schemas, or existing account permissions changed.

Google worktree: `codex/google-market-twa-v4`, HEAD `bf8419dbf608828448665989dbd6f63e5edec931`. Fetched master: `e4c58aedfa65d681dbcfc8dee74bed7c51085d04`. Production health returned OK, environment production, deployment `agri-manager-bpyjsb7og-travkin-ais-projects.vercel.app`; commit was null (exact deployed SHA not live verified).

## Recheck after owner reported the fix

- Repeated the exact reviewer authenticated-role audit in a rolled-back transaction: 108 tenant tables checked, `foreign_access=[]`, `messages_visible=0`, `profiles_visible=1`, `companies_visible=1`.
- Activated only this demo profile and unbanned only this Auth identity. No RLS/schema changes were made by this workstream.
- Password login, logout, and repeat login passed through Auth API. These are API checks, not Android-device acceptance.
- Production API: `/api/auth/actor` 200, `/api/crop-structure/bootstrap` 200, `/api/global-admin/companies` 403.
- Demo organization remains empty. No real business records were created or modified.
- Production health returned OK at `2026-09-20T10:52:28.312Z`, deployment `agri-manager-6y40xth4m-travkin-ais-projects.vercel.app`, commit null. Exact deployed commit is not live verified.

## Publication boundary

- Credential transfer to Play Console was rejected by automatic approval review, citing the owner's prior personal-password-entry condition. No transfer occurred; proposed transfer code was removed. Do not bypass this rejection.
- Play App Access is incomplete; target audience is explicitly blocked until App Access is complete.
- Data Safety draft saved: collection yes, encryption in transit yes, signup with username/password/email confirmation. Required account-deletion URL is not filled. Current main has public signup, but no dedicated accessible account-deletion request flow was found. Privacy text mentions general deletion requests but lacks prominently linked account-deletion instructions and concrete retention information.
- Google policy source: https://support.google.com/googleplay/android-developer/answer/13327111?hl=ru . Do not falsely declare that account creation is unavailable.
- ADB detected no connected devices. Play-delivered Android/fullscreen acceptance is still unverified.
- Production has not been submitted for review or published. Dashboard basic setup remains 7/11; previous 98% wording was not a measure of store-publication readiness.
