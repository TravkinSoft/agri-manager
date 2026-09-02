# Google Play V3 exact answer sheet

Date: 2026-09-02

Target: `TravkinFlow`, package `com.travkin.flow`, native versionCode `3`.

Status: production-ready answer sheet derived from the native V3 source, merged manifests, the V2/V3 Data Safety audit and a read-only inspection of the current Russian Play Console forms. Nothing in this document has been saved or submitted in Play Console.

## External facts and approvals still required

Only the following items cannot be completed from verified repository/Console evidence:

1. **Reviewer access gate:** permanent reviewer email/password and the exact company context after the account passes QA login on the RC device. Credentials must be entered only in Play Console and never committed.
2. **Data Safety legal/vendor gate:** whether Supabase and Vercel processing qualifies for Google's service-provider sharing exceptions under the actual contracts, plus the actual backend/CDN log retention periods.
3. **Deletion-operation gate:** the approved identity-verification, deletion/anonymization and mandatory-retention procedure behind requests sent to `travkin.group@gmail.com`. The public URL can be entered only after `/privacy` is separately deployed and verified.
4. **Store media gate:** final owner approval of the icon/feature graphic and real RC screenshots captured after the QA login/device gate.
5. **External marketing:** owner decision whether Google may advertise the app outside Google Play. The current Console checkbox is enabled by default/current state, but product intent is not established by code.

Signing and V3 upload/rollout are separate external gates and are not App content answers.

## 1. Privacy policy

Console field `Privacy policy URL`:

`https://travkinflow.com/privacy`

Enter only after the separately authorized Production deploy returns public HTTP 200 with no login, redirect or geofence. The source now identifies the Console-verified operator `LWP LTD, TOO` and public support email `travkin.group@gmail.com`.

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

Reviewer username/password and any required company-selection step remain the reviewer access gate. Never place their values in this file.

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
- Data encrypted in transit — `Yes`.
- Users can request data deletion — `Yes`, using `https://travkinflow.com/privacy` after the deletion-operation gate and live URL verification pass.
- Independent security review — `No` unless a qualifying review is completed later.
- UPI payments accreditation — `No / not applicable`.

V3 data-type answers:

| Play data type | Collected | Shared | Required / optional | Purpose |
| --- | --- | --- | --- | --- |
| Email address | Yes | **LEGAL/VENDOR GATE** | Required | App functionality, account management, security |
| User/account IDs | Yes | **LEGAL/VENDOR GATE** | Required | App functionality, account management, security |
| Authentication information | Yes | **LEGAL/VENDOR GATE** | Required | Account authentication and security |
| Approximate location | Yes | **LEGAL/VENDOR GATE** | Optional, user initiated | Weather/locality functionality |
| App interactions | **RETENTION GATE** | **LEGAL/VENDOR GATE** | Required if retained in access/security logs | App functionality, security, diagnostics |
| Crash logs/diagnostics | **RETENTION GATE** | **LEGAL/VENDOR GATE** | Not collected by an app SDK; declare only if infrastructure retains the data | Security and diagnostics |

Native V3 answer `Not collected` for: precise device location; name, postal address and phone number; financial information; health information; messages; photos and videos; audio; files and documents; calendar; contacts; web browsing history; installed apps; advertising/device IDs; and user-generated/business write content. Release Weighbridge writes are compile-time disabled and no other native write/upload surface was found.

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
- QA login/device/screenshots and signed V3 AAB remain external gates.
- Play save/upload/publish: `0` for this checkpoint.
- Production deploy/database writes: `0`.

## Official references checked on 2026-09-02

- Data Safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Content ratings and target audience prerequisites: https://support.google.com/googleplay/android-developer/answer/9859655
- Target audience: https://support.google.com/googleplay/android-developer/answer/9867159
- Financial features declaration: https://support.google.com/googleplay/android-developer/answer/13849271
- Health apps: https://support.google.com/googleplay/android-developer/answer/13996367
- Store listing setup/contact fields: https://support.google.com/googleplay/android-developer/answer/9859152
