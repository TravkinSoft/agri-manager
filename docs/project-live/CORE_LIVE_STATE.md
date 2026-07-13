# Core Live State

LAST_UPDATED: 2026-07-13
CORE_BRANCH: `copilot-v1`
CORE_COMMIT: `SELF` (commit, содержащий это обновление Live-state; предыдущий docs commit: `3ef0afe239e9fe682cef76b2d3495f5fc5e02bad`)
PRODUCTION_COMMIT: `321e45fa681fecff89307545d0ec3fa600b4c982`
ACTIVE_SEASON: `2026` для ТОО «Астык-STEM» и `2026 тестовый сезон` для TravkinFlowTest1
PRODUCTION_STATUS: `READY_WITH_CONTROLLED_P1_GAPS`; production работает, но ветка `copilot-v1` содержит ещё не выпущенные изменения ТЗ №136, №138 и №139.

## Current system status

| Модуль | Статус | Текущая правда |
| --- | --- | --- |
| Поля | READY | В production 100 company-scoped полей; Field остаётся главным производственным объектом. |
| Структура посевов | IN_PROGRESS | В production 122 строки. Основной flow и lazy-load больших компаний проверены; fix сохранения участка «Пар» готов в `copilot-v1` по ТЗ №136, но ещё не выпущен в production. |
| Операции | READY | Создание, роли, материальная сверка и закрытие проверены E2E; формула выдачи и факта контролируется сервером. |
| Склады | LIMITED | В production 2 склада; выдача, возврат и ledger работают. ТЗ №143 нашло 18 writer-сценариев, из них 15 имеют прямой unit fallback/дефект. Выбран additive контракт `base_quantity + base_uom + optional mass_kg`; writers должны быть исправлены до адресного backfill. |
| Ledger | LIMITED | `stock_ledger_entries` остаётся источником складской правды, но current views суммируют без `uom`, а `batch_class=NULL` маскируют как `commodity`. Для 7 inventory/7 ledger строк подготовлен только адресный план; production data не менялась. |
| Весовая | READY | Талон, gross/tare/net, закрытие, история, PDF и company label проверены. Весовая является источником правды по массе. |
| Crop Care | LIMITED | Schema/API foundation присутствует; полный production workflow и данные компании не закрыты отдельным end-to-end acceptance. |
| ГЛБД | LIMITED | Legacy AI и Component Model V2 имеют паритет 425 компонентов / 1373 связей. V2 schema live; app read-cutover на V2 ещё не выполнен и не разрешён этим документом. |
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
- `GET /api/weighbridge/resources` возвращает company-scoped vehicles и допустимых responsible persons; `/api/weighbridge/tickets/**` хранит и закрывает талон; company label берётся из записи талона.
- GLBD legacy и V2 находятся в production параллельно. Наличие V2 не разрешает ассистенту или UI самовольно переключать read path.
- Существующие `/api/assistant/**` routes считаются **UNAUDITED LEGACY RUNTIME** и не входят в одобренный контракт Travkin Assistant V1 до отдельного runtime audit.

## Known P0/P1 issues

### P0

- Подтверждённых открытых P0 на момент обновления нет.

### P1

- 57 старых migration-history позиций остаются в staged audit/repair program; массовый repair запрещён.
- Шесть `SUPERSEDED` versions ТЗ №137 синхронизированы ТЗ №140. Остальные версии не получили автоматического статуса и требуют отдельного доказательства.
- Material request crop/product identity отображается не полностью единообразно во всех экранах; canonical IDs и warehouse flow не должны заменяться UI fallback-текстом.
- Fix участка «Пар» (ТЗ №136) и canonical varieties migration (ТЗ №138) находятся только в `copilot-v1`, production их ещё не получил.
- Closed-season read-only enforcement не подтверждён как полный для всех write routes.
- GLBD Component Model V2 ещё не стал app read source; legacy/V2 cutover должен быть отдельным ТЗ.
- Складская базовая единица и batch identity: ТЗ №143 подтвердила 18 writer-сценариев и 15 прямых unit/class fallback-рисков. У 7 inventory rows `base_quantity_kg=NULL`, у 7 ledger rows `batch_class=NULL`; пять литровых строк нельзя превращать в kg без verified density. До backfill нужны additive schema, исправление всех writers, unit-aware views, backup и отдельный approval.
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

## Forbidden actions

Без отдельного явного owner approval запрещены:

- `supabase db push`, migration apply/up и запуск migration SQL;
- массовый `migration repair`;
- production DB writes и изменение business data;
- merge в `master`, deploy preview/production и promotion deploy;
- автоматический merge/rebase между `copilot-v1` и будущей `assistant-v1`;
- прямое изменение ассистентом core contract или core live state.

## Assistant readiness

ASSISTANT_CORE_READINESS: `FOUNDATION_ONLY`
ASSISTANT_ALLOWED_MODE: `READ_ONLY_DESIGN_AND_AUDIT`
ASSISTANT_ALLOWED_DATA: код репозитория; Project Live; approved architecture text; документированные read-only server contracts; обезличенные audit findings по отдельному ТЗ
ASSISTANT_BLOCKED_AREAS: production DB connection; direct SQL; write tools; operation/warehouse/crop-structure/season mutations; migration history; RLS bypass; deploy; contract edits

Assistant implementation: `NOT_STARTED`. Ветка `assistant-v1`: `EXISTS`; TZ-A100 read-only runtime audit завершён. Production writes: `DISABLED`.
