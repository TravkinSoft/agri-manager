# Core Live State

LAST_UPDATED: 2026-07-13
CORE_BRANCH: `copilot-v1`
CORE_COMMIT: `SELF` (commit, содержащий этот foundation-файл; baseline до ТЗ №139: `4eb2d585a6570c1d382ae4c47963f60d23e12800`)
PRODUCTION_COMMIT: `321e45fa681fecff89307545d0ec3fa600b4c982`
ACTIVE_SEASON: `2026` для ТОО «Астык-STEM» и `2026 тестовый сезон` для TravkinFlowTest1
PRODUCTION_STATUS: `READY_WITH_CONTROLLED_P1_GAPS`; production работает, но ветка `copilot-v1` содержит ещё не выпущенные изменения ТЗ №136, №138 и №139.

## Current system status

| Модуль | Статус | Текущая правда |
| --- | --- | --- |
| Поля | READY | В production 100 company-scoped полей; Field остаётся главным производственным объектом. |
| Структура посевов | IN_PROGRESS | В production 122 строки. Основной flow и lazy-load больших компаний проверены; fix сохранения участка «Пар» готов в `copilot-v1` по ТЗ №136, но ещё не выпущен в production. |
| Операции | READY | Создание, роли, материальная сверка и закрытие проверены E2E; формула выдачи и факта контролируется сервером. |
| Склады | LIMITED | В production 2 склада; выдача, возврат и ledger работают. Открыт P1 по единообразной crop/material request identity в отдельных представлениях. |
| Ledger | READY | `stock_ledger_entries` и канонические balance views являются источником складской правды; OUT создаёт складская выдача, IN — приём возврата или подтверждённый приход. |
| Весовая | READY | Талон, gross/tare/net, закрытие, история, PDF и company label проверены. Весовая является источником правды по массе. |
| Crop Care | LIMITED | Schema/API foundation присутствует; полный production workflow и данные компании не закрыты отдельным end-to-end acceptance. |
| ГЛБД | LIMITED | Legacy AI и Component Model V2 имеют паритет 425 компонентов / 1373 связей. V2 schema live; app read-cutover на V2 ещё не выполнен и не разрешён этим документом. |
| Сезоны | LIMITED | Контекст 2026 используется. В live есть несколько исторических season rows с `archived=false`; принудительный read-only режим закрытого сезона требует отдельной проверки. |
| Пользователи и роли | READY | Company isolation, role switcher и основные роли Test1 проверены. Доступ всегда должен подтверждаться серверной сессией и RLS/ACL. |

## Current database state

- Supabase project: `bhsemlvmkikpntabctml`.
- Remote migration history head: `20260712203746` (`glbd_component_model_v2`).
- Восемь ранее отсутствовавших версий `20260623170000`–`20260712203746` уже синхронизированы с remote history без повторного запуска migration SQL.
- Остаётся аудит 63 более старых локальных migration-history позиций из ТЗ №135: 30 `LIVE_EQUIVALENT`, 14 `PARTIALLY_EQUIVALENT`, 1 `NOT_APPLIED`, 6 `SUPERSEDED`, 10 `DATA_EVIDENCE_REQUIRED`, 2 `NOT_APPLICABLE`.
- ТЗ №137 уточнило 6 `SUPERSEDED`: один canonical migration исправлен и сохранён ТЗ №138; пять являются кандидатами `REPAIR_AS_SUPERSEDED`, но repair не выполнялся.
- `db push`: **НЕ РАЗРЕШЁН** до отдельного owner-approved batch plan по старым migration versions.
- Активные блокеры DB-процесса: незакрытая классификация 63 старых версий, отсутствие approval на batch repair, запрет повторного исполнения уже эквивалентных SQL.
- Последний подтверждённый production backup artifact: `C:\Users\TRAVKIN\Downloads\CodecSaaS\audit-output\TZ-129\backups\glbd-component-v2-20260712T223018445Z`; manifest SHA-256 `725232ed737effb46c5fbdcd2be999a861dd89980b42cd83a0a3aca689db97eb`. Это scope-backup GLBD apply, а не обещание полного PITR всей базы.
- Read-only snapshot ТЗ №139: products 1231; fields 100; crop_structure 122; operations 8; warehouses 2; legacy AI 425/1373; GLBD V2 425/1373.

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

- 63 старые migration-history позиции остаются в staged audit/repair program; массовый repair запрещён.
- Из 6 `SUPERSEDED` ТЗ №137 один canonical file сохранён ТЗ №138, пять ещё требуют отдельного owner-approved history decision.
- Material request crop/product identity отображается не полностью единообразно во всех экранах; canonical IDs и warehouse flow не должны заменяться UI fallback-текстом.
- Fix участка «Пар» (ТЗ №136) и canonical varieties migration (ТЗ №138) находятся только в `copilot-v1`, production их ещё не получил.
- Closed-season read-only enforcement не подтверждён как полный для всех write routes.
- GLBD Component Model V2 ещё не стал app read source; legacy/V2 cutover должен быть отдельным ТЗ.

## Current tasks

| ТЗ | Статус | Результат |
| --- | --- | --- |
| №136 | DONE | Fix сохранения участка «Пар», commit `e36ab0a`; production release не выполнен. |
| №138 | DONE | Canonical global varieties migration, commit `4eb2d58`; push/release не выполнен. |
| №139 | DONE_IN_THIS_COMMIT | Создана Project Live и handoff foundation; app/DB не менялись. |

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

Assistant implementation: `NOT_STARTED`. Ветка `assistant-v1`: `NOT_CREATED`. Production writes: `DISABLED`.
