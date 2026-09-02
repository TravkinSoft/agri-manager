# Google Play reviewer access plan — native V3

Date: 2026-09-02

Status: evidence-based procedure only. No account was created or changed, no credential was generated, and nothing was entered or saved in Play Console.

## Non-negotiable secret boundary

- Reviewer email/password must never appear in Git, source files, CI logs, screenshots, task/chat messages or this document.
- The owner creates and stores the credential in an approved password manager, then enters it directly into the Play Console App access fields.
- If a credential must cross the clipboard, use it only for the direct password-manager → Play Console transfer, immediately clear clipboard history and do not paste it into a terminal or chat.
- Do not reuse a personal, administrator-owner, Supabase dashboard or Google account password.

## Environment truth

The two account purposes must not be conflated:

| Account | Artifact/environment | Purpose | Can be submitted to Play for current release AAB? |
| --- | --- | --- | --- |
| Existing permanent QA account | QA app/backend (`qa.travkinflow.com`, QA Supabase) | Device smoke, screenshots and role-flow verification without Production data | **No.** Current release AAB targets `travkinflow.com` and Production Supabase |
| Dedicated Play reviewer account | Exact backend targeted by the signed release AAB | Google reviewer login during app review | **Yes**, only after separate authorization, provisioning and RC validation |

Reusing a QA email string does not bridge Supabase projects: the Auth user must exist in the environment that the release artifact actually calls. Do not change the AAB/backend merely to hide this mismatch without a separate release decision.

## Recommended reviewer identity

- Dedicated non-personal mailbox/alias controlled by `LWP LTD, TOO`; never an employee's personal account.
- Dedicated review company/tenant containing only synthetic, non-sensitive records sufficient to open Overview, Tickets, Ticket detail, Harvest, Warehouses, Weather, Notifications and Profile.
- Initial role candidate: `company_admin`, because it is a supported native V3 role and is the narrowest likely single role for the requested cross-section review. Confirm the exact visible-section matrix on the signed RC; if a lower-privilege supported role covers every instruction, use it instead.
- No Global Admin unless the signed RC proves every lower role cannot complete the reviewer path.
- No OTP, MFA, CAPTCHA, subscription, QR/referral, biometric, another-device approval, forced password reset or expiring one-time password.
- Release writes remain compile-time disabled, but tenant data and server permissions must still be least privilege.

Creating the dedicated Play-facing tenant/user or synthetic records is a Production database write. It requires a separate explicit authorization and is not performed by this checkpoint.

## Safe provisioning and Play entry procedure

1. Owner approves the Play-facing environment, company/tenant, role, synthetic dataset and retention period for the reviewer identity.
2. Authorized administrator provisions the user through the approved admin workflow; do not use an ad-hoc SQL insert or place the password in a command line.
3. Owner generates a unique strong password in the password manager and stores it only in the organization vault.
4. On a clean Android device/profile, install the exact signed RC and validate login, every instruction step, logout and repeat login. Confirm that no OTP/password-change prompt appears.
5. Confirm the account sees only the dedicated synthetic tenant and no unrelated Production company or personal data.
6. In Play Console → App content → App access/Credentials, owner enters the reviewer email and password directly and pastes the instruction text from the exact answer sheet. Do not save until the app-content submission checkpoint is explicitly authorized.
7. Re-open the saved Console form in a later authorized step and verify the credential fields are present, the instructions are readable and no secret is visible in screenshots/evidence.
8. Keep the account active and password stable throughout review and any appeal. Monitor failed sign-ins without adding an OTP challenge.

## Rotation and retirement

- To rotate, first create/validate the replacement credential, update and save Play Console in an authorized step, then revoke the old sessions and disable/delete the old credential. Never create a review outage.
- Native Safe logout clears local encrypted session/caches and attempts Supabase logout. For administrative retirement, also remove the Auth user/session through the approved backend procedure; deleting an Auth user does not retroactively invalidate an already-issued JWT until it expires unless server-side session validation closes that window.
- Company hard-delete is not the normal reviewer-user retirement path: it is blocked by operational rows and can affect all users of the company.
- Keep an owner-approved audit record containing the account identifier, tenant, role, provisioning date and retirement status, but never the password.

## Play reviewer instruction text

Use the non-secret instruction block in `play-console-answer-sheet-v3.md`. Before entry, replace no text with a secret; credentials belong only in the dedicated Console fields.

## Acceptance gate

Reviewer access is ready only when all statements are true:

- exact signed release AAB and account target the same backend;
- repeat login works without human assistance, OTP or expiring password;
- every listed screen opens with synthetic/non-sensitive data;
- logout and second login pass;
- role/company context is stable;
- credentials exist only in the password manager and Play Console;
- owner has approved Production provisioning and the Console save action separately.

Until then, App access remains an external gate. Play save/upload/publish and Production database writes for this checkpoint are `0`.
