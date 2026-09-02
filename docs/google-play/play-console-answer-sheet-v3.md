# Google Play V3 exact answer sheet

Date: 2026-09-02

Target: `TravkinFlow`, package `com.travkin.flow`, native versionCode `3`.

Status: technically evidence-complete draft derived from the native V3 source, merged manifests, live read-only infrastructure evidence, the V2/V3 Data Safety audit and a read-only inspection of the current Russian Play Console forms. Owner/legal gates below still prevent submission. Nothing in this document has been saved or submitted in Play Console.

## External facts and approvals still required

Only the following items cannot be completed from verified repository/Console evidence:

1. **Reviewer access gate:** the release AAB targets `https://travkinflow.com` and Production Supabase. A QA-only permanent account cannot authenticate to that artifact. Owner must separately authorize a dedicated, least-privilege, non-personal reviewer account in the Play-facing environment and validate it on the signed RC. Credentials must be entered only in Play Console and never committed or pasted into chat.
2. **Data Safety legal/vendor gate:** whether Supabase, Vercel, OpenStreetMap Nominatim, Open-Meteo, UAV Forecast and any V2 OpenAI processing qualifies for Google's service-provider sharing exceptions under the contracts actually applicable to `LWP LTD, TOO`. The repository cannot approve this legal classification.
3. **Retention/deletion owner gate:** the actual Vercel/Supabase plans and add-ons, any custom `UAV_FORECAST_API_URL`, mandatory business/legal retention, identity verification, deletion/anonymization order and residual JWT/backup handling. `https://travkinflow.com/privacy` currently returns HTTP 404 and cannot be submitted until a separately authorized deploy and verification pass.
4. **Store media gate:** final owner approval of the icon/feature graphic and real RC screenshots captured after the QA login/device gate.
5. **External marketing:** owner decision whether Google may advertise the app outside Google Play. The current Console checkbox is enabled by default/current state, but product intent is not established by code.

Signing and V3 upload/rollout are separate external gates and are not App content answers.

## 1. Privacy policy

Console field `Privacy policy URL`:

`https://travkinflow.com/privacy`

Enter only after the separately authorized Production deploy returns public HTTP 200 with no login, redirect or geofence. The source now identifies the Console-verified operator `LWP LTD, TOO` and public support email `travkin.group@gmail.com`.

Privacy exact-sheet boundary:

- **Code/infrastructure confirmed:** native data categories and destinations in section 6; no native self-registration/account deletion; email-based request wording; HTTPS; Android Keystore AES-256-GCM local storage; password not stored; local caches cleared at logout; Supabase/Vercel infrastructure and weather-provider destinations.
- **Owner/legal decision only:** statements about contractual legal basis, processor/service-provider status, “sharing” exceptions, mandatory retention, deletion/anonymization order, identity-verification standard and jurisdiction-specific user rights.
- **Do not deploy as final legal text yet:** sections 4–6 and 8 of the local privacy source express policy/legal commitments that code cannot prove. They require owner/legal approval; this checkpoint does not change or publish them.

## 2. Ads

Question `Does your app contain ads?`:

`No, my app does not contain ads.`

Evidence: no advertising SDK, ad UI or `AD_ID` permission in native V3.

## 3. Credentials / App access

Question `Does your app have restricted sections?`:

`Yes.`

Access method:

`Username/email and password credentials.`

Do not select payment, referral/QR, OTP/2FA, biometric or another-device requirements unless the dedicated reviewer account proves otherwise during QA.

Instruction name:

`TravkinFlow reviewer account`

Instruction body:

```text
1. Open TravkinFlow.
2. Enter the dedicated reviewer email and password supplied in these Play Console fields.
3. No payment, subscription, QR code, OTP, two-factor authentication or biometric authentication is required.
4. After sign-in, wait for the operational overview to load.
5. Open Tickets and a ticket detail, then Notifications and Profile.
6. Open Harvest, Warehouses, Weather and the read-only Weighbridge workspace when those sections are available to the supplied reviewer role.
7. Use Safe logout to return to the sign-in screen.
```

Reviewer username/password and any required company-selection step remain the reviewer access gate. Never place their values in this file. Follow `docs/google-play/reviewer-access-plan.md`; the QA smoke account and Play reviewer account are different environment-bound credentials unless the signed artifact is rebuilt for QA, which is not the Play release configuration.

## 4. Content rating (IARC)

- Contact email: `travkin.group@gmail.com`.
- Category: `All other app types`.
- IARC terms: the authorized account operator must accept them when submitting; this is a submission action, not an unknown product answer.

Questionnaire answers for native V3:

- Violence or graphic content: `No`.
- Fear/horror content: `No`.
- Sexual content or nudity: `No`.
- Profanity or crude humor: `No`.
- Controlled substances, alcohol or tobacco content: `No`.
- Gambling, simulated gambling or betting: `No`.
- User-to-user communication/free exchange of user-created content: `No`.
- Sharing a user's location with other users: `No`.
- Digital purchases or randomized purchases: `No`.
- Unrestricted web/Internet browsing: `No`.

The app uses authenticated HTTPS APIs, but it does not expose a browser, social feed, chat, payments or location-sharing feature.

## 5. Target audience and content

- Target age group: `18 and over` only.
- Designed for children: `No`.
- Store listing likely to appeal primarily to children: `No`.

Evidence: this is a login-gated B2B agricultural operations client for authorized employees and administrators. Do not select any child age band.

## 6. Data Safety

Current track rule: while the app is exclusively active in Internal Testing, Google exempts it from the Data Safety section. The form may remain unsubmitted until a covered track is prepared.

If completing the form for a closed, open or Production V3 release:

- `Does the app collect or share required user data?` — `Yes` (collection).
- Data encrypted in transit — `Yes`; all audited destinations are HTTPS and Android cleartext is disabled.
- Users can request data deletion — **OWNER GATE / DO NOT SUBMIT YET**. Native V3 has no self-registration or in-app account deletion. The local privacy source names an email request route, but the public URL currently returns 404 and no approved end-to-end deletion runbook was proven.
- Independent security review — `No` unless a qualifying review is completed later.
- UPI payments accreditation — `No / not applicable`.

V3 data-type answers:

| Play data type | Collected | Shared | Required / optional | Purpose |
| --- | --- | --- | --- | --- |
| Email address | Yes | **LEGAL/VENDOR GATE** | Required | App functionality, account management, security |
| User/account IDs | Yes | **LEGAL/VENDOR GATE** | Required | App functionality, account management, security |
| Authentication information | Yes | **LEGAL/VENDOR GATE** | Required | Account authentication and security |
| Approximate location | Yes | **LEGAL/VENDOR GATE** | Optional, user initiated | Weather/locality functionality |
| App interactions | Yes | **LEGAL/VENDOR GATE** | Required | App functionality, security, diagnostics |
| Diagnostics | Yes | **LEGAL/VENDOR GATE** | Required | Security and diagnostics |
| Crash logs | No | No | N/A | No crash-reporting SDK or native crash upload path |

Native V3 answer `Not collected` for: precise device location; name, postal address and phone number; financial information; health information; messages; photos and videos; audio; files and documents; calendar; contacts; web browsing history; installed apps; advertising/device IDs; and user-generated/business write content. Release Weighbridge writes are compile-time disabled and no other native write/upload surface was found.

Why app interactions and diagnostics are now exact `Yes`: Supabase documents Auth/API/edge/database log ingestion, and Vercel Runtime Logs include request path, status, User-Agent, search parameters and invocation metadata. Exact retention remains plan-dependent, but non-ephemeral log collection is confirmed and no longer supports an “unknown collection” answer.

Confirmed native V3 processing path:

- Direct Android → Production Supabase: email/password authentication, access/refresh tokens, user/company identifiers and notification SELECT metadata.
- Direct Android → `travkinflow.com`/Vercel: bearer token, user/company context, requested section/ticket identifiers, selected KATO/locality/coordinates and request headers.
- Server → OpenStreetMap Nominatim/Open-Meteo/UAV Forecast: selected locality text or locality coordinates for geocoding/forecast. The audited calls do not forward TravkinFlow bearer tokens, emails, user IDs or company IDs.
- No native telemetry SDK or independent Firebase/FCM/ads/analytics/crash destination exists.

Retention/deletion facts that do not need owner interpretation:

- Native actor offline fallback: 12 hours. Other encrypted native caches: no code TTL; cleared on logout/app-data clear/uninstall or replaced by refresh.
- Server weather cache: in-memory 10 minutes; location resolver cache: in-memory 30-day TTL, possibly shorter on process restart.
- Vendor capability documentation states Supabase hosted project data is encrypted at rest/in transit and Vercel uses AES-256 at rest plus HTTPS/TLS 1.3 in transit; the applicable accepted contracts remain an owner/legal fact.
- Vercel Runtime Logs: plan/add-on range 1 hour/1 day/3 days/30 days; actual plan unknown. Supabase log and backup retention: plan-dependent; actual plan/PITR/Log Drains unknown.
- Web/full-service self-registration exists, but native V3 does not expose it. Global Admin company hard-delete exists but is blocked when operational rows remain and is not user self-service deletion.
- Exact business-record retention, legal basis, service-provider sharing exception and complete deletion/anonymization procedure remain owner/legal decisions.

Before submission, verify in Console that legacy V2 is not active or servable on a covered track/device configuration. If it is, replace the V3-only rows with the conservative V2+V3 union in `data-safety-v2-v3-audit.md`.

## 7. Advertising ID

Question `Does your app use the advertising ID?`:

`No.`

Evidence: neither the source nor merged manifests declare `com.google.android.gms.permission.AD_ID`; there is no advertising/analytics SDK.

## 8. Government apps

Question `Is the app developed by or on behalf of a government organization?`:

`No.`

Evidence: Console verifies the organization as `LWP LTD, TOO`; the product is a private agricultural operations platform and contains no government-service claim.

## 9. Financial features

Select only:

`My app doesn't provide any financial features.`

Do not select banking, loans, payments/transfers, rewards, trading, financial advice, insurance or Other. Operational weights, inventory and business records are not Google Play financial-service features.

## 10. Health apps

Select only:

`My app doesn't provide any health-related features.`

Do not select health/fitness, medical, research or Other. Native V3 has no health feature, claim, permission or health-data integration.

## Store Listing — Russian (`ru-RU`)

### Text

- App name: `TravkinFlow`.
- Short description: `Урожай, весовая, склады и погода — рабочие данные TravkinFlow в телефоне`.
- Full description:

```text
TravkinFlow — нативное Android-приложение для сотрудников агропредприятий, работающих в системе TravkinFlow.

После входа под рабочим аккаунтом приложение показывает актуальную оперативную сводку и доступные пользователю разделы с учётом его роли и выбранной компании.

В приложении доступны:

• оперативные показатели смены и приёмки;
• список талонов и подробности взвешиваний;
• сводка урожая по полям и культурам;
• остатки складов и производственных объектов;
• рабочее пространство Весовой в разрешённом режиме;
• поиск населённых пунктов по КАТО и прогноз погоды;
• уведомления, профиль и состояние защищённой сессии.

TravkinFlow поддерживает роли Global Admin, Company Admin, Агроном, Весовщик и Специалист. Набор разделов определяется сервером и правами пользователя. Для работы требуется активный аккаунт организации и подключение к интернету; при временной потере связи приложение может показывать последние защищённые локальные данные.

Пароль не сохраняется. Сессия и локальные рабочие кэши защищаются средствами Android Keystore. Приложение не содержит рекламы, WebView или браузерной версии интерфейса.
```

### Category, tags and contact

- App or game: `App`.
- Category: `Business`.
- Tags: `Business`, `Work`, `Weather`.
- Public support email: `travkin.group@gmail.com`.
- Website: `https://travkinflow.com/`.
- Phone: leave blank (optional; not needed for this listing).
- External marketing: **OWNER DECISION**.

### Visual assets

- App icon: `docs/google-play/store-assets/play-store-icon-512.png`.
- Feature graphic: `docs/google-play/store-assets/feature-graphic-1024x500.png`.
- YouTube video: leave blank.
- Phone screenshots: upload 4 real 1080 × 1920 portrait RC captures after the QA login/device gate — Operational overview, Tickets, Ticket detail and Weather. No fabricated UI or Production data.
- Tablet, Chromebook and Android XR assets: leave blank unless those form sections become required by the selected device support/release checks.

## Submission boundary

- This sheet does not authorize filling, saving or submitting a Play form.
- Privacy Production deploy remains separately authorized work.
- QA login/device/screenshots, the Play-environment reviewer account and signed V3 AAB remain external gates.
- Play save/upload/publish: `0` for this checkpoint.
- Production deploy/database writes: `0`.

## Official references checked on 2026-09-02

- Data Safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Content ratings and target audience prerequisites: https://support.google.com/googleplay/android-developer/answer/9859655
- Target audience: https://support.google.com/googleplay/android-developer/answer/9867159
- Financial features declaration: https://support.google.com/googleplay/android-developer/answer/13849271
- Health apps: https://support.google.com/googleplay/android-developer/answer/13996367
- Store listing setup/contact fields: https://support.google.com/googleplay/android-developer/answer/9859152
- Account deletion requirement: https://support.google.com/googleplay/android-developer/answer/13327111
- Supabase Logs: https://supabase.com/docs/guides/monitoring-and-debugging/logs
- Supabase Database Backups: https://supabase.com/docs/guides/platform/backups
- Supabase User Management/deletion: https://supabase.com/docs/guides/auth/managing-user-data
- Supabase Shared Responsibility Model: https://supabase.com/docs/guides/deployment/shared-responsibility-model
- Vercel Runtime Logs: https://vercel.com/docs/logs/runtime
- Vercel security/encryption: https://vercel.com/docs/security/compliance
