# Google Play Production release draft

Date: 2026-09-02

Status: draft only. Nothing in this file has been uploaded or submitted to Google Play.

## Main store listing — Russian

### App name

`TravkinFlow` (11/30 characters)

### Short description

`Урожай, весовая, склады и погода — рабочие данные TravkinFlow в телефоне` (72/80 characters)

### Full description

TravkinFlow — нативное Android-приложение для сотрудников агропредприятий, работающих в системе TravkinFlow.

После входа под рабочим аккаунтом приложение показывает актуальную оперативную сводку и доступные пользователю разделы с учётом его роли и выбранной компании.

В приложении доступны:

- оперативные показатели смены и приёмки;
- список талонов и подробности взвешиваний;
- сводка урожая по полям и культурам;
- остатки складов и производственных объектов;
- рабочее пространство Весовой в разрешённом режиме;
- поиск населённых пунктов по КАТО и прогноз погоды;
- уведомления, профиль и состояние защищённой сессии.

TravkinFlow поддерживает роли Global Admin, Company Admin, Агроном, Весовщик и Специалист. Набор разделов определяется сервером и правами пользователя. Для работы требуется активный аккаунт организации и подключение к интернету; при временной потере связи приложение может показывать последние защищённые локальные данные.

Пароль не сохраняется. Сессия и локальные рабочие кэши защищаются средствами Android Keystore. Приложение не содержит рекламы, WebView или браузерной версии интерфейса.

## App access for review

The app is entirely login-gated. Before any review submission, Play Console must receive a permanent review account for a supported role, exact sign-in steps, and any company-context instructions. Credentials must be entered only in Play Console App access; they must not be committed to Git or copied into this document.

Recommended review path:

1. Sign in with the dedicated reviewer account.
2. Confirm the operational overview loads.
3. Open Tickets and one ticket detail.
4. Open Notifications and Profile.
5. If the reviewer role permits it, open Harvest, Warehouses, Weather and the read-only Weighbridge workspace.
6. Use Safe logout and confirm the login screen returns immediately.

## Data Safety draft — not ready to submit

Google Play defines collection as transmission of user data off the device. The native V3 client directly transmits authentication and authenticated business requests to TravkinFlow/Supabase over HTTPS.

| Play data type | Native V3 evidence | Draft declaration | Purpose | Required/optional |
| --- | --- | --- | --- | --- |
| Personal info — Email address | Email is sent to Supabase Auth during sign-in and returned in actor profile | Collected | App functionality; account management | Required for login |
| Personal info — User IDs | Auth UID/actor ID is sent with authenticated requests and used for RLS | Collected | App functionality; account management; security | Required |
| App activity — App interactions | Authenticated API requests and server logs may describe used features | Backend retention/log audit required | App functionality; security/fraud prevention if applicable | To be confirmed |
| User-generated content / business records | Production V3 reads operational data; release Weighbridge writes are compile-time disabled | Do not declare from V3 alone; audit every active Play artifact and backend first | To be confirmed | To be confirmed |
| Approximate/precise location | No Android location permission; weather uses user-entered KATO search | Not collected by native permission/API | N/A | N/A |
| Photos/videos/files, contacts, SMS, call logs, health, financial, advertising ID | No relevant manifest permission or SDK/API found | Not collected by native V3 | N/A | N/A |
| Crash/diagnostic data | No crash reporting or analytics SDK is bundled | Backend/CDN log audit required before declaring "not collected" | To be confirmed | To be confirmed |

Provisional security answers:

- Data is encrypted in transit: **Yes for native V3** — cleartext traffic is disabled and all configured endpoints must be HTTPS.
- Data deletion request mechanism: **Not live verified**. A public request URL or documented organization-admin process is required before submission.
- Data sharing: no advertising or marketing SDK is present. Whether Supabase/Vercel processing qualifies for a Play sharing exception must be confirmed against actual contracts and legal ownership.
- Independent security review: do not claim unless a qualifying review has actually been completed.

Critical scope rule: Play has one Data Safety declaration covering the sum of data practices across active versions. The currently distributed versionCode 2 TWA/web artifact must therefore be audited together with native V3 before the form can be submitted. Native V3 evidence alone is insufficient.

## Privacy policy draft — legal fields still required

Proposed public URL: `https://travkinflow.com/privacy` — live check on 2026-09-02 returned **HTTP 404**.

The final policy must replace every bracketed field and be approved by the data controller before publication.

### Политика конфиденциальности TravkinFlow

Дата вступления в силу: [дата]

[Полное юридическое наименование], далее «Оператор», предоставляет сервис TravkinFlow организациям и их уполномоченным сотрудникам.

TravkinFlow обрабатывает данные, необходимые для входа и предоставления рабочих функций: адрес электронной почты, идентификатор пользователя, роль, контекст организации, а также производственные записи, доступные пользователю в соответствии с его правами. Приложение передаёт данные только по защищённому HTTPS-соединению.

На Android-устройстве токены сессии и рабочие кэши хранятся в зашифрованном виде с использованием Android Keystore. Пароль пользователя не сохраняется. При выходе приложение немедленно удаляет локальную сессию и кэши, связанные с текущим пользователем.

Приложение не запрашивает доступ к геолокации устройства, контактам, сообщениям, звонкам, камере или файлам. В текущей версии отсутствуют рекламные, аналитические и push/FCM SDK.

Данные могут обрабатываться поставщиками инфраструктуры, действующими по поручению Оператора, включая хостинг приложения и сервис аутентификации. Перечень поставщиков, страны обработки и сроки хранения: [заполнить по действующим договорам и backend retention policy].

Пользователь или его организация может запросить доступ, исправление или удаление данных по адресу [контактный email/URL]. Часть производственных записей может храниться в сроки, предусмотренные законом или договорными обязательствами; такие исключения должны быть описаны Оператором.

По вопросам конфиденциальности: [полное юридическое наименование, адрес, email].

## Store assets draft

### Ready source asset

- Store icon candidate: `android/app/src/main/res/drawable/travkinflow_icon.png`.
- Measured: 512 × 512, 32-bit ARGB with alpha, 285,283 bytes.
- It meets the Play file-shape limits (512 × 512 PNG, alpha, less than 1 MB); final visual approval is still required.
- The existing gold/black TravkinFlow mark is authoritative and must not be redrawn or reinterpreted.

### Feature graphic — production brief, not generated

- Required export: 1024 × 500, JPEG or 24-bit PNG without alpha.
- Keep the focal area near the centre and avoid edge-critical copy.
- Proposed direction only: restrained gold-on-deep-neutral composition extending the existing mark, with minimal operational/agricultural geometry and no device frame, Play badge, rankings, testimonials or time-sensitive claims.
- Typography and exact palette have not been supplied/approved. A text-bearing final graphic must not be generated until these brand slots are confirmed.
- Proposed alt text: `Золотой знак TravkinFlow на фоне полевых и производственных данных`.

### Phone screenshots — capture plan

Capture at least four actual 1080 × 1920 portrait screenshots after device acceptance, without production personal data:

1. Login — alt text: `Экран входа TravkinFlow с полями email и пароля`.
2. Operational overview — alt text: `Оперативная сводка смены и приёмки урожая`.
3. Tickets — alt text: `Список талонов с весами и текущими статусами`.
4. Weather or Harvest — alt text: `Прогноз погоды по выбранному населённому пункту` or `Сводка урожая по полям и культурам`.
5. Optional: read-only Weighbridge workspace, only after its backend/device state is visually verified.
6. Optional: Notifications and Profile.

Do not use fabricated UI, production names, emails, UUIDs, weights or notifications. Store screenshots must be captured from the same RC artifact that will be uploaded.

## Submission blockers

1. Device/emulator acceptance and real screenshots are absent.
2. Public Privacy Policy URL and in-app privacy access are absent.
3. Data Safety audit of active Play versionCode 2 and backend/CDN retention is incomplete.
4. Permanent Play reviewer account/instructions are not prepared in this repository.
5. Final feature graphic awaits authoritative palette/typography approval.
6. The signed V3 AAB has not been built with the user-entered upload-key secrets.
7. Nothing has been uploaded to Play Console; this is intentional until checkpoint approval.

## Official references checked on 2026-09-02

- Target API requirements: https://developer.android.com/google/play/requirements/target-sdk
- Kotlin/AGP/R8 compatibility: https://developer.android.com/build/kotlin-support
- Data Safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Preview assets: https://support.google.com/googleplay/android-developer/answer/9866151
- Publication/login review guidance: https://support.google.com/googleplay/android-developer/answer/15191715
- Privacy disclosure guidance: https://support.google.com/googleplay/android-developer/answer/11150561
