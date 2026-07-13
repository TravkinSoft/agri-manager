# Core Live State

LAST_UPDATED: 2026-07-14
CORE_BRANCH: `copilot-v1`
CORE_COMMIT: `SELF` (commit, содержащий это обновление Live-state; предыдущий core commit: `c6788b6`)
PRODUCTION_COMMIT: `321e45fa681fecff89307545d0ec3fa600b4c982`
ACTIVE_SEASON: `2026` для ТОО «Астык-STEM» и `2026 тестовый сезон` для TravkinFlowTest1
PRODUCTION_STATUS: `READY_WITH_CONTROLLED_P1_GAPS`; production работает, но ветка `copilot-v1` содержит ещё не выпущенные изменения, включая ТЗ №136, №138 и локальный складской контракт ТЗ №144. После push ТЗ №148 складской scope заморожен как `FROZEN_PENDING_FUTURE_APPLY`; основной текущий фокус снова GLBD.

## Current system status

| Модуль | Статус | Текущая правда |
| --- | --- | --- |
| Поля | READY | В production 100 company-scoped полей; Field остаётся главным производственным объектом. |
| Структура посевов | IN_PROGRESS | В production 122 строки. Основной flow и lazy-load больших компаний проверены; fix сохранения участка «Пар» готов в `copilot-v1` по ТЗ №136, но ещё не выпущен в production. |
| Операции | READY | Создание, роли, материальная сверка и закрытие проверены E2E; формула выдачи и факта контролируется сервером. |
| Склады | FROZEN_PENDING_FUTURE_APPLY | ТЗ №144 локально перевело 15 проблемных writer paths на единый контракт `base_quantity + base_uom + optional mass_kg`, обязательный `batch_class` и доказуемую плотность. ТЗ №148 доказало repeat safety. Commit `c6788b6` отправлен в `origin/copilot-v1`; migration `20260713183038` не применена, backfill не запускался, scope заморожен до отдельного production preflight и approval. |
| Ledger | LOCAL_READY | Новые ledger/balance views разделяют остатки по `product + warehouse + batch identity + base_uom + batch_class`; смешение `kg/l/pcs` блокируется. Legacy-строки читаются как доказанная единица или `legacy/unknown`, без автоматического kg/commodity fallback. Production migration не применена. |
| Весовая | READY | Талон, gross/tare/net, закрытие, история, PDF и company label проверены. Весовая является источником правды по массе. |
| Crop Care | LIMITED | Schema/API foundation присутствует; полный production workflow и данные компании не закрыты отдельным end-to-end acceptance. |
| ГЛБД | AUDITED_PENDING_REVIEW | Component Model V2 содержит 425 компонентов и 1373 глобальные product links, company links `0`. ТЗ №149 проверило все строки: live aliases `0`, sources `0`; подготовлены 24 безопасных alias-кандидата и 349 bounded source-кандидатов, но import не выполнялся. Формы, биология, safener, возможные дубли и мусор оставлены на ручной review; app read-cutover не разрешён. |
| Сезоны | LIMITED | Контекст 2026 используется. В live есть несколько исторических season rows с `archived=false`; принудительный read-only режим закрытого сезона требует отдельной проверки. |
| Пользователи и роли | READY | Company isolation, role switcher и основные роли Test1 проверены. Доступ всегда должен подтверждаться серверной сессией и RLS/ACL. |

## Current database state

- Supabase project: `bhsemlvmkikpntabctml`.
- Remote migration history: 76 записей; head `20260712203746` (`glbd_component_model_v2`).
- Восемь ранее отсутствовавших версий `20260623170000`–`20260712203746` уже синхронизированы с remote history без повторного запуска migration SQL.
- ТЗ №140 синхронизировало 6 проверенных `SUPERSEDED` versions: `20260412234000`, `20260413182000`, `20260417103000`, `20260430110000`, `20260510110000`, `20260521100500`. Выполнялся только официальный history repair; migration SQL не запускался.
- После ТЗ №140 остаётся 57 старых local-only migration-history позиций из программы аудита ТЗ №135. ТЗ №142 подробно классифицировало 15 из них с неполным результатом: 7 schema-only corrections, 2 schema+data corrections и 6 superseded intents. Ни одна версия не repaired/applied.
- `db push`: **НЕ РАЗРЕШЁН** до отдельного owner-approved batch plan по старым migration versions.
- Активные блокеры DB-процесса: для 15 неполных версий есть batch roadmap, но нет owner approval на apply; остальные local-only versions также нельзя repair/apply массово. Повторное исполнение старого SQL запрещено.
- Последний подтверждённый migration-history backup: `C:\Users\TRAVKIN\Downloads\CodecSaaS\audit-output\TZ-140\backups\migration-history-20260713T161533631Z`; manifest SHA-256 `60dde2ad4d9150c42babf01485c183017611c7bf2245468d8a90c086eb0fb683`. Backup содержит все 70 pre-repair history rows со statements, local/remote inventories, hashes шести файлов и evidence ТЗ №137; это не полный PITR backup бизнес-данных.
- Post-repair read-only snapshot ТЗ №140: products 1231; fields 100; crop_structure 122; operations 8; warehouses 2; legacy AI 425/1373; GLBD V2 425/1373. Public schema, variety и crop-identity fingerprints совпали с pre-repair snapshot.

## Current source-of-truth rules

- `Field` — главный объект, к которому привязываются сезон, структура и производственные факты.
- `crop_structure` — план использования площади, культуры, сорта и репродукции в сезон.
- `operation` — производственный процесс и подтверждённый факт выполнения.
- Warehouse ledger — единственный источник складской правды; UI balance не должен жить отдельно от ledger.
- Weighbridge ticket — источник правды по массе; `net = gross - tare`.
- Любой company-scoped read/write обязан использовать выбранную компанию и активный season context.
- Закрытый сезон должен быть read-only. Полнота enforcement пока отмечена как `LIMITED`.
- Вода — технологический объём баковой смеси, а не складской материал и не строка расхода продукта.

## Current API and data contracts

Подтверждены только уже существующие server surfaces:

- Server actor берётся из сессии. Обычный пользователь работает только со своей компанией; global admin может использовать явно выбранный company context там, где route вызывает `resolveCompanyForActor`/server ACL.
- `GET /api/references/company-assets` возвращает только active, non-archived machines/equipment/vehicles выбранной компании и canonical model joins.
- `GET /api/crop-structure/bootstrap` загружает стартовый company/season список; `GET /api/crop-structure/fields/[id]` загружает детали только открытого поля.
- `GET /api/tasks/operation-identities` берёт crop/variety/reproduction из связанной `crop_structure`, с fallback на operation line.
- Material flow идёт через `/api/material-requests/**` и `/api/operations/**`: ledger OUT только после warehouse issue, ledger IN только после warehouse return acceptance; закрытие требует `issued = consumed + returned + loss` и завершённую сверку.
- После применения migration `20260713183038` все новые warehouse writers обязаны использовать общий server resolver `resolveWarehouseStockContract`: canonical units `kg/l/pcs`, обязательный `batch_class`, `mass_kg` для жидкости только с verified density evidence. До отдельного production preflight этот контракт остаётся локальным и не меняет live DB.
- `GET /api/weighbridge/resources` возвращает company-scoped vehicles и допустимых responsible persons; `/api/weighbridge/tickets/**` хранит и закрывает талон; company label берётся из записи талона.
- GLBD legacy и V2 находятся в production параллельно. Наличие V2 не разрешает ассистенту или UI самовольно переключать read path.
- Legacy `/api/assistant/**` в core не становятся автоматически разрешёнными. Contract 0.2 принимает только изолированный A101 read-only runtime на `assistant-v1` с восемью явно перечисленными tools; merge и production deployment не разрешены.

## Known P0/P1 issues

### P0

- Legacy `operations/confirm-draft` не применяет канонические operation-create права и защиту сезона; маршрут запрещён Travkin Assistant до отдельного core fix.
- Knowledge Base DELETE не доказывает company ownership документа перед service-role mutation; KB mutations запрещены Travkin Assistant до отдельного core fix.

### P1

- 57 старых migration-history позиций остаются в staged audit/repair program; массовый repair запрещён.
- Шесть `SUPERSEDED` versions ТЗ №137 синхронизированы ТЗ №140. Остальные версии не получили автоматического статуса и требуют отдельного доказательства.
- Material request crop/product identity отображается не полностью единообразно во всех экранах; canonical IDs и warehouse flow не должны заменяться UI fallback-текстом.
- Fix участка «Пар» (ТЗ №136) и canonical varieties migration (ТЗ №138) находятся только в `copilot-v1`, production их ещё не получил.
- Closed-season read-only enforcement не подтверждён как полный для всех write routes.
- GLBD Component Model V2 ещё не стал app read source; legacy/V2 cutover должен быть отдельным ТЗ.
- Складская базовая единица и batch identity: ТЗ №144 локально подготовила additive schema, единый resolver, исправления 15 writer paths и unit-aware views; isolated migration/E2E PASS. Migration ещё не применена к production, а 7 inventory/7 ledger legacy rows не backfill-ились. Перед production нужен отдельный backup, live preflight, preview E2E и owner approval.
- Land legal MVP не имеет трёх integrity guards. Live duplicate preflight чистый и land tables пусты, но до начала реального ввода нужен отдельный schema-only corrective batch.

## Current tasks

| ТЗ | Статус | Результат |
| --- | --- | --- |
| №136 | DONE | Fix сохранения участка «Пар», commit `e36ab0a` в `origin/copilot-v1`; production release не выполнен. |
| №138 | DONE | Canonical global varieties migration, commit `4eb2d58` в `origin/copilot-v1`; production release не выполнен. |
| №139 | DONE | Создана Project Live и handoff foundation, commit `3ef0afe` в `origin/copilot-v1`; app/DB не менялись. |
| №140 | DONE_IN_THIS_COMMIT | Commit ТЗ №138/139 сохранены в origin; 6 history versions repaired; schema/business data не изменились; осталось 57 local-only versions. |
| №141 | DONE | Созданы изолированные branch/worktree и Live sync protocol для Travkin Assistant; runtime не запускался. |
| №142 | DONE_IN_THIS_COMMIT | Read-only аудит 15 неполных миграций: P0=0, P1=3, P2=12; подготовлены 8 безопасных corrective/supersession batches; DB не менялась. |
| №143 | DONE_IN_THIS_COMMIT | Read-only план складских единиц и batch class: 18 writer-сценариев, universal quantity contract, corrective migration preview, точечный план 7+7 строк, E2E и rollback; DB/app code не менялись. |
| №144 | DONE_IN_THIS_COMMIT | Локально созданы additive migration `20260713183038`, единый unit/batch resolver, исправления 15 writer paths и unit-aware ledger views; isolated migration/E2E PASS, production и legacy rows не менялись. |
| A100 | DONE | Проведён статический аудит legacy Assistant runtime; выявлены потеря history/context и два core P0. |
| A101 | DONE | На `assistant-v1` реализован изолированный read-only foundation: 8 tools, user JWT/RLS, mocked QA 16/16, typecheck/build PASS; production не менялась. |
| №145 | DONE_IN_THIS_COMMIT | Core принял A100/A101, обновил Integration Contract до 0.2 и зарегистрировал A102 только для локальной read-only проверки. Assistant code не объединялся. |
| A102 | DONE_WITH_FINDINGS | Real Local Runtime Validation завершён на `assistant-v1`: 14/20 PASS, Supabase GET 37, DB writes 0. До отдельного fix/rerun заблокированы Assistant acceptance, merge и deploy. |
| №147 | DONE_IN_THIS_COMMIT | Создан отдельный подтверждённый QA Auth-user `Assistant QA Test1`: только TravkinFlowTest1, `agronomist`, не global/company admin. JWT сохранён только в ignored Assistant `.env.local`; RLS read/cross-company denial PASS, business data/schema unchanged. |
| №148 | DONE_IN_THIS_COMMIT | Migration `20260713183038` сделана definition-aware и безопасной при повторе: first/second apply PASS, schema fingerprint и row counts совпадают, 10 constraints/4 indexes/3 triggers без дублей, полный warehouse QA PASS. Production, backfill и legacy rows не менялись. |
| №149 | DONE_IN_THIS_COMMIT | Read-only аудит всех 425 GLBD V2 компонентов и 1373 product links; подготовлены 8 master/review файлов вне Git, second pass PASS, import/merge/archive/source writes не выполнялись. |

## TZ-146 warehouse preflight

- TZ-146 status: `DONE_WITH_BLOCKER`; report: [task-reports/core/TZ-146.md](task-reports/core/TZ-146.md).
- Fresh read-only backup is verified outside Git at `C:\Users\TRAVKIN\Downloads\TravkinFlow-backups\TZ-146\warehouse-units-v2-20260713T194902571Z`; manifest SHA-256 `A1DDB99AC36FC85296E5BA188E31B89CB57293857454FFE6DA16CBA7A733498F`.
- First isolated migration apply and full warehouse QA pass; the known legacy 7+7 rows remain unchanged.
- Production preflight found 87 products with unsupported `base_uom=unknown`, 7 ledger rows with NULL `batch_class`, and one legacy mixed kg/l group. Existing inventory/ledger movements have no unsupported unit after RU/EN canonicalization and have zero cross-company conflicts.
- Repeat apply fails because `products_density_contract_v2` already exists. Migration `20260713183038` must be made repeat-safe and retested before owner approval.
- Required future order: warehouse-write pause, fresh backup/preflight, migration, schema postcheck, immediate TZ-144 code deploy, smoke, then resume writes.
- Production DB, migration history, business data, balances, deploy state, and legacy rows were not changed by TZ-146.

## TZ-147 Assistant QA identity

- TZ-147 status: `DONE`; report: [task-reports/core/TZ-147.md](task-reports/core/TZ-147.md).
- The only exact `TravkinFlowTest1` company was selected; one confirmed Auth user and one canonical `profiles` link were created.
- Authorization state is `role=agronomist`, `status=active`, `is_owner=false`; global/company admin privileges are absent and there is no `company_people` row.
- Normal Auth sign-in and user-JWT RLS checks passed: Test1 season/field/crop structure are readable, while another company's company/profile/field rows are invisible.
- Access and refresh tokens exist only in ignored `project-assistant-v1/.env.local`. Secret values were neither printed nor committed.
- Final business fingerprint matches preflight; schema, migrations, migration history, app code, and deployment were not changed.
- A102 is unblocked only for the already approved local read-only runtime validation. All Assistant write paths remain forbidden.

## TZ-148 Warehouse Units V2 repeat safety

- TZ-148 status: `DONE`; report: [task-reports/core/TZ-148.md](task-reports/core/TZ-148.md).
- Repeat failure was caused by ten named CHECK constraints being added without a definition-aware existence guard; the first visible conflict was `products_density_contract_v2`.
- Every named constraint now follows create-if-absent, no-op-if-identical, and STOP-if-different semantics. No differing constraint is silently dropped or replaced.
- Isolated first and second apply both pass with schema fingerprint `2939db9075816906de24f76db7a4d6db58f190c4e7afe8290bcc93063b4518a9`, equal row counts, and zero duplicate constraints, indexes, or triggers.
- Full kg/l/pcs/seed/transfer/issue/return/reconciliation/storno and protection QA passes; legacy rows changed `0`, production calls `0`.
- A fresh production backup and repeat preflight are still mandatory. Migration apply, backfill, production writes, merge, and deploy were not performed.

## TZ-149 GLBD Component V2 alias and source audit

- TZ-149 status: `DONE`; report: [task-reports/core/TZ-149.md](task-reports/core/TZ-149.md).
- Live read-only snapshot: components `425`, global product links `1373`, company links `0`, existing aliases `0`, existing sources `0`.
- All 425 components and 1373 links were covered. There are 365 components without an English name, 425 without a source row, 12 links without concentration and 1357 links without a verified product-specific source.
- Outside Git, the owner package contains 528 alias review rows, 441 bounded source rows, 172 identity/review rows and all eight required master/self-check files.
- Import candidates remain proposals only: aliases `24`; sources `349` (`333` internal-existing-data identity/classification claims plus `16` previously source-verified product claims). Owner approval and a separate import preflight are mandatory.
- Manual queues: merge-review components `43`, form relations `22`, biological `22`, safener `23`, garbage/relink `15`, needs-source components `92`. No disputed row was marked READY automatically.
- Production database, business data, schema, migrations, product links, component status and deployment were not changed.

## Forbidden actions

Без отдельного явного owner approval запрещены:

- `supabase db push`, migration apply/up и запуск migration SQL;
- массовый `migration repair`;
- production DB writes и изменение business data;
- merge в `master`, deploy preview/production и promotion deploy;
- автоматический merge/rebase между `copilot-v1` и будущей `assistant-v1`;
- прямое изменение ассистентом core contract или core live state.

## Assistant readiness

ASSISTANT_CORE_READINESS: `READ_ONLY_ASSISTANT_FOUNDATION_APPROVED`
ASSISTANT_ALLOWED_MODE: `LOCAL_READ_ONLY_DEVELOPMENT_AND_VALIDATION`
ASSISTANT_ALLOWED_DATA: server-authenticated context and results of the eight tools listed in Integration Contract 0.2; code; Project Live; approved architecture text
ASSISTANT_BLOCKED_AREAS: production deployment; direct SQL; database/schema changes; create/draft/navigation/KB mutations; warehouse/operation writes; migration history; RLS bypass; contract edits by assistant

Assistant implementation: `A101_LOCAL_FOUNDATION_PASS` at `51e878e`; mocked QA `16/16`, typecheck/build PASS. A102 completed at `c4ec0b0` with `14/20` scenarios passing and six findings; DB writes `0`. Assistant acceptance/merge/deploy remain blocked pending a separate fix and rerun. Production writes: `DISABLED`.
