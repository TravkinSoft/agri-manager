# TravkinFlow Native Android V1 — архитектура и границы MVP

Статус: foundation в работе. Этот документ фиксирует архитектуру до реализации.

## Проверенная база

- Источник: `origin/master` на SHA `9b64a4d74964da6a728586a803251d604436233d`.
- Изолированная ветка: `codex/google-market-native-v1`.
- Package/application id: `com.travkin.flow`.
- Следующий свободный кандидат: `versionCode 3`, `versionName 3.0.0`.
- Старые ветки `codex/google-market-v1` и `codex/google-market-release-v3` остаются техническими черновиками и не входят в native-релиз.
- Production, БД и Google Play на этом этапе не изменяются.

## Необсуждаемая граница

Бизнес-интерфейс реализуется собственными Jetpack Compose-экранами. `WebView`, TWA и fallback на встроенный сайт запрещены. Внешняя ссылка может открываться только системным браузером и не считается частью рабочего интерфейса.

Мобильный scope подтверждён только для ролей:

- `global_admin` — Global Admin;
- `company_admin` — Company Admin;
- `agronomist` — Агроном;
- `weighman` — Весовщик;
- `specialist` — Специалист.

`warehouse`, `warehouse_operator`, `director`, `legal_operator`, `fuel_operator`, `brigadier` и неизвестные роли блокируются fail-closed и не получают навигацию.

## Целевая схема

```text
Compose UI
  -> ViewModel + immutable UiState
    -> Repository (single source of truth)
      -> local cache (V1: private app storage; далее Room)
      -> HTTPS API client
        -> Supabase Auth /auth/v1/token
        -> TravkinFlow /api/* с Authorization: Bearer <JWT>
          -> server-session + server-acl
            -> user-scoped Supabase client + RLS
```

Клиент никогда не содержит `service_role`, signing password, PIN или Production-секрет. Пароль существует только в памяти на время входа. Access/refresh tokens хранятся зашифрованно ключом Android Keystore (`AES/GCM/NoPadding`) и удаляются при выходе или необратимой ошибке refresh.

## Слои Android

1. `ui`: Compose, Material 3, role-aware navigation, состояния loading/content/stale/error/offline.
2. `domain`: модели ролей, capability policy и use cases; неизвестные поля ответа допускаются, неизвестная роль запрещается.
3. `data`: repositories, DTO mapping, token refresh, локальный cache, будущая очередь команд.
4. `network`: отдельные клиенты Supabase Auth и TravkinFlow API; TLS only, без cleartext; Bearer JWT; ограниченные timeouts; без body-логирования.
5. `security`: Android Keystore, очистка токенов, запрет backup, release без debug logging.
6. `sync`: read-through cache сейчас; Room + WorkManager + уникальная idempotent queue перед первой offline-write функцией.

## Безопасная авторизация

1. Email/password отправляются напрямую в Supabase Auth по HTTPS.
2. Полученная пара access/refresh tokens сохраняется только в Keystore-backed storage.
3. `GET /api/auth/actor` является каноническим серверным источником роли, статуса и company context. Роль из локального JWT/UI не используется для авторизации.
4. Каждая TravkinFlow API-команда несёт access token. При `401` выполняется один сериализованный refresh; новый refresh token атомарно заменяет старый.
5. После refresh повторяется только безопасный GET. POST/PATCH/DELETE не повторяются автоматически без `Idempotency-Key` и явного command policy.
6. `inactive`, неподдерживаемая или неизвестная роль завершает сессию fail-closed.
7. Global Admin company context должен приходить с сервера; Android не подменяет `companyId` локально.

## Offline и очередь

- Read: экран сначала показывает последний company-scoped cache с отметкой времени, затем обновляет его с сервера.
- Stale cache не выдаётся за live: UI показывает `Офлайн`/`Данные от ...`.
- Смена пользователя или компании очищает/разделяет cache по `actorId + companyId`.
- Write queue до реализации содержит только архитектурный контракт. Каждая команда обязана иметь UUID idempotency key, actor/company scope, тип, payload schema version, createdAt, attempts и terminal error.
- Очередь будет храниться в Room и отправляться уникальной WorkManager-задачей только при сети. PIN весовщика, пароль и access token в очередь не попадают.
- Конфликт `409/422` не ретраится автоматически; пользователь видит безопасное разрешение конфликта.

## Камера, файлы, push и deep links

- Камера/файлы: только Activity Result API, Photo Picker/системный document picker и короткоживущие `content://` URI. Разрешение на всю медиатеку не требуется.
- Upload: только после отдельного server endpoint с проверкой MIME, размера, company scope и Storage policy. Service key в приложении запрещён.
- Push: FCM добавляется только после появления backend endpoint регистрации/ротации токена устройства и server-side authorization. Analytics не включается автоматически.
- Deep links: App Links `https://travkinflow.com/...`; ссылка преобразуется в строго типизированный native route. Неизвестный путь открывает безопасный home/error, а не WebView.

## Матрица web -> API -> native

| Web-сценарий | Проверенный источник/API | Native-экран | Роль V1 | Риск или пробел |
|---|---|---|---|---|
| `/auth/login` | Supabase `/auth/v1/token`; затем `GET /api/auth/actor` | `LoginScreen` + session bootstrap | все 5 | Нужны build-time Supabase URL/publishable key; секреты не коммитить |
| `/dashboard` harvest | `GET /api/dashboard/harvest-summary`; роли admin/agronomist/director | `HarvestSummaryScreen` | агроном, admins | Endpoint не разрешает `weighman`/`specialist` |
| `/weighbridge/dashboard` | `GET /api/weighbridge/bootstrap?summary=true`; `WEIGHBRIDGE_READ_ROLES` | `OperationalOverviewScreen` | агроном, весовщик, admins, специалист | Подходит как первый общий read-only срез; payload пока не версионирован |
| `/crop-structure` | `GET /api/crop-structure/bootstrap`; admin/agronomist | `CropStructureScreen` | агроном, admins | Большой payload; нужен mobile DTO/version и pagination при росте |
| `/tickets` | `GET /api/weighbridge/tickets` | `TicketListScreen`/`TicketDetailsScreen` | агроном, весовщик, admins, специалист read-only | Нужна формальная pagination/cursor и стабильная error schema |
| `/weighbridge` | tickets/resources/allocations/shifts/finalize API + operator-session cookie | `WeighingWorkspaceScreen` | весовщик, admins | Не включать write до native operator-session/cookie test, idempotency и device E2E |
| `/tasks` | `GET /api/operations`, `/api/tasks/operation-identities`, material requests; write endpoints имеют idempotency | `MyTasksScreen` | специалист | Нужен компактный mobile bootstrap и единая capability schema |
| `/platform` | разрозненные `/api/global-admin/*` | `PlatformOverviewScreen` | global admin | Нужен безопасный агрегированный read-only bootstrap; impersonation отдельно |
| `/users`, `/settings` | существующие admin/settings endpoints | `CompanyAdminScreen` | admins | Не входит в первый read-only slice; действия требуют отдельной приёмки |

## Реальный MVP по этапам

### M0 — native foundation

- Compose-only Activity; ни одного WebView/TWA класса или зависимости.
- Login, encrypted session, refresh, `GET /api/auth/actor`.
- Fail-closed role routing для пяти подтверждённых ролей.
- Общий `OperationalOverviewScreen` через `/api/weighbridge/bootstrap?summary=true`.
- Локальный read-cache, offline/stale/error shell, logout.
- Unit tests для role policy, cache scope и DTO mapping.

### M1 — полезные read-сценарии

- Агроном: harvest summary, структура посевов, талоны, погода.
- Весовщик: смена/счётчики, активные и последние талоны без изменений.
- Специалист: мои задачи и детали.
- Admins: platform/company operational overview и role-aware diagnostics.

### M2 — контролируемые write-сценарии

- Весовщик: PIN unlock/handover, новый талон, брутто, тара, finalize, повторяемость/idempotency.
- Специалист: accept/progress/complete с idempotency и конфликтами.
- Агроном/admin: только отдельно подтверждённые операции.
- Room queue + WorkManager включаются per-command feature flag; никакой универсальной «повторить всё».

### M3 — release completeness

- Камера/файлы, FCM/deep links после backend-контрактов.
- accessibility, ru locale, rotation/process death, device matrix.
- Play listing/Data Safety/privacy, signed AAB, staged Production rollout после отдельного разрешения.

## Недостающие backend-контракты

1. Версионированный `GET /api/mobile/v1/bootstrap`: actor, capabilities, company context, server time, minimum app version.
2. Компактные версионированные DTO для operational overview, crop structure, tasks и ticket list.
3. Единая error envelope: `code`, безопасный `message`, `retryable`, `correlationId`, `fieldErrors`.
4. Cursor pagination для талонов, задач и истории.
5. Native operator-session contract: Set-Cookie lifecycle, secure persistence/rotation, logout, 423 recovery и device E2E.
6. Обязательная idempotency политика для каждой мобильной write-команды.
7. Upload endpoint/policy для камеры и документов.
8. Device registration endpoint для FCM с actor/company scope, rotation и revoke.
9. Remote capabilities/minimum-version endpoint без доверия клиентским role flags.

## Feature flags

- `ANDROID_NATIVE_ENABLED` — общий server kill switch.
- `ANDROID_NATIVE_READ_OVERVIEW_ENABLED` — первый read-only экран.
- `ANDROID_NATIVE_AGRONOMY_ENABLED` — agronomy read routes.
- `ANDROID_NATIVE_WEIGH_WRITE_ENABLED` — все write весовой, по умолчанию off.
- `ANDROID_NATIVE_SPECIALIST_WRITE_ENABLED` — write задач, по умолчанию off.
- `ANDROID_NATIVE_OFFLINE_WRITES_ENABLED` — очередь, по умолчанию off.
- `ANDROID_NATIVE_PUSH_ENABLED` — FCM registration, по умолчанию off.

Клиентские BuildConfig flags управляют только видимостью/QA. Сервер всё равно проверяет JWT, actor, роль, компанию и capability.

## Миграция с versionCode 2

- Сохраняются package `com.travkin.flow` и upload key, поэтому Play видит обновление.
- Native `versionCode 3` не читает WebView cookies/localStorage как доверенную сессию. После обновления требуется чистый native login.
- Серверные данные и БД не мигрируются: меняется только клиент.
- Старый versionCode 2 остаётся доступным только как rollback artifact; его код не сливается в native-ветку.
- Rollback: остановка staged rollout, возврат пользователей на последнюю доступную Play-версию согласно возможностям Play; server kill switches выключают незрелые native-функции без DB rollback.

## Критерии приёмки публичного релиза

- Статический gate подтверждает отсутствие `WebView`, `androidx.webkit`, TWA/Bubblewrap и `loadUrl` в runtime.
- Все пять подтверждённых ролей входят, получают только разрешённую native-навигацию; остальные блокируются.
- Авторизация, refresh, logout и process death проходят на физическом Android-устройстве; секреты не попадают в Git/logcat/crash reports.
- Агроном и Весовщик выполняют согласованные реальные end-to-end сценарии; write-команды доказанно idempotent.
- Offline read показывает cache и возраст; восстановление сети не создаёт дублей.
- API errors 401/403/409/422/423/429/5xx имеют проверенные UX-состояния.
- App Links открывают native route; камера/файлы не требуют избыточных разрешений.
- Release AAB подписан существующим upload key, package/version проверены, device smoke пройден.
- Data Safety/privacy соответствуют фактическим SDK, permissions и backend data flows.
- Google Play Production rollout выполняется только после отдельного явного разрешения; Production DB writes во время подготовки foundation = 0.
