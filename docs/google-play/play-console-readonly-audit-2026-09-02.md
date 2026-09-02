# Google Play Console read-only audit

Date: 2026-09-02 (Asia/Qyzylorda)

Scope: developer account `6614218018428318590`, app `4975164020059211916`, package `com.travkin.flow`.

This checkpoint was collected from the signed-in Play Console without editing fields, saving forms, uploading an artifact, submitting declarations or publishing a release.

## Developer and public contact evidence

Play Console > Developer account showed:

- account type: Corporate;
- developer display name: `Travkin Group`;
- verified organization: `LWP LTD, TOO`;
- verified website: `https://travkinflow.com/`;
- public developer-profile email: `travkin.group@gmail.com`.

The same page explicitly separates the Google-only contact block from the data shown in the public developer profile. The email above appeared in the public-profile block, so it is suitable as the proposed public privacy/support contact. The organization name is the Console-verified legal organization and is suitable as the proposed operator name.

The app-specific Store settings contact fields are still empty: email, phone and website have not been entered for this app.

## Privacy source patch — applied after the audit

Source: the verified organization and public-profile email in Play Console > Developer account on 2026-09-02.

```ts
const operatorName = "LWP LTD, TOO";
const supportEmail = "travkin.group@gmail.com";
```

The evidence-backed patch was applied to `app/privacy/page.tsx` in the next local checkpoint. It has not been deployed to Production or entered in Play Console.

## App content declarations

The App content overview reports 10 required actions. In particular:

- Privacy policy: not submitted;
- Credentials (formerly App access): not submitted;
- Data safety: not submitted.

The Credentials form has neither `Yes` nor `No` selected and its Save button is disabled. TravkinFlow is login-gated, so the future declaration must select restricted access and provide a permanent reviewer account and exact steps only inside Play Console. No credential belongs in Git or this document.

## Store listing

- The Store listings page has no completed standard listing and shows `Create standard store listing`.
- Publishing overview already contains one unsent Store listings change for Russian (`ru-RU`): a standard-listing language/name draft referencing `TravkinFlow` and remaining required information. This was present at the read-only checkpoint; it was not created, saved or submitted by this audit.
- App category is not selected.
- App-specific public contact email, phone and website are empty.
- No store-listing form was changed or saved during this audit.

## Internal Testing V2

The internal testing track is active. Its latest release is `2 (2)`, available to internal testers, contains one version code, was released on 2026-08-11 and is marked not reviewed. Console offers `Create release`; no V3 draft exists in Console at this checkpoint.

### Safe V2 to V3 transition

1. Keep active V2 unchanged while preparing the native V3 release.
2. Create V3 in the same internal track and upload versionCode 3 only after explicit upload authorization. Saving it as a draft does not distribute it and does not alter tester delivery.
3. Resolve artifact and pre-review checks while the release remains a draft. Do not click Publish or Start rollout without separate authorization.
4. After an authorized V3 internal rollout, eligible internal testers receive the highest compatible version code, so compatible devices move from V2 to V3. Verify the track's active/shadowed status across device configurations after rollout.
5. Keep V2 in release history and preserve its source/evidence. Do not delete or pause it merely to prepare V3. A later rollback cannot reuse versionCode 2 after versionCode 3 has been delivered; a rollback build would need a new, higher version code.

Uploading or saving V3 as a draft does **not** publish it and does **not** retire V2. Only an authorized rollout changes what testers receive.

## Data Safety transition

The app is currently active only on the internal-testing track. Google states that apps exclusively active in internal testing are exempt from inclusion in the Data safety section, so the form may remain unsubmitted during this internal-only checkpoint.

Before any closed, open or Production release:

- publish the approved privacy policy;
- finish the Data Safety declaration;
- reconcile the declaration against every artifact that can still be served on any active covered track or device configuration;
- if V2 remains active or servable anywhere covered by the form, use the conservative V2+V3 union in `data-safety-v2-v3-audit.md`;
- if Console proves V2 is no longer active or servable on any covered track/configuration, retain its audit evidence but do not automatically attribute V2-only flows to V3.

Official references checked on 2026-09-02:

- Data Safety requirements and internal-only exemption: https://support.google.com/googleplay/android-developer/answer/10787469
- Internal testing, highest compatible version code and track eligibility: https://support.google.com/googleplay/android-developer/answer/9845334
- Draft preparation versus rollout: https://support.google.com/googleplay/android-developer/answer/9859348

## Mutation boundary

- Play Console saves/uploads/submissions/publications: `0`.
- Production deploys: `0`.
- Production database writes: `0`.
- Main TravkinFlow branch merges: `0`.
