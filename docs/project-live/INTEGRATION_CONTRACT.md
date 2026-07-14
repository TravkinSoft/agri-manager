# TravkinFlow Core ↔ Assistant Integration Contract

CONTRACT_VERSION: 0.3
STATUS: ASSISTANT_MEMORY_SCHEMA_APPROVED
LAST_UPDATED: 2026-07-14
COMPATIBILITY: Read-only foundation A100-A104 remains approved. TZ-A105 at assistant commit `b22f765583b2cd556a29b9e25c332561f19dd262` is accepted as a schema-gated prototype and design proposal; its branch is not merged. TZ-A106 may implement the approved memory boundary only in an isolated non-production environment. Production migration, memory writes, merge and deployment are not approved.
ASSISTANT_ACTION_REQUIRED: Before TZ-A106 real acceptance, create a separate Supabase development branch with owner cost approval, sync this contract, and keep the feature QA-only. The production project `bhsemlvmkikpntabctml` is not a memory test environment.

## Назначение

Этот файл — официальный договор между core TravkinFlow и будущим Travkin Assistant. Он определяет источники правды, границы доступа и процедуру изменения интеграции. Контракт описывает разрешённое, но сам по себе не предоставляет доступ.

## Источники правды

- Живые ERP-данные: только server tools TravkinFlow, которые проверяют actor, company context и права.
- ГЛБД: структурированные глобальные таблицы. Company assets и глобальные модели остаются разными сущностями.
- Документы: Knowledge Base после отдельного permission-aware runtime audit.
- Текущий разговор: conversation storage после утверждения модели хранения и retention.
- Настройки: assistant settings после аудита существующей реализации.
- Права: server session/ACL и Supabase RLS. Клиентское состояние не является разрешением.
- Project Live: актуальные правила и handoff metadata, но не бизнес-данные.

## Ассистенту запрещено

- выполнять прямой SQL или подключаться напрямую к production DB; исключение A106 действует только для утверждённой migration в отдельном non-production контуре;
- использовать service credentials или обходить RLS/ACL;
- писать или изменять operations;
- менять warehouse state, ledger, заявки, выдачу или возврат;
- закрывать операции;
- менять crop structure, fields или season state;
- менять migration history, migrations или schema;
- делать deploy, merge или push без отдельного разрешения;
- считать существующие unaudited `/api/assistant/**` routes автоматически одобренными tools.
- использовать create tools, draft confirmation или navigation execution;
- изменять Knowledge Base;
- вызывать warehouse или operation writes;
- использовать generic SQL или любые tools со скрытыми side effects.

## Утверждённый read-only foundation

- читать код в согласованном scope;
- проводить read-only аудит runtime, storage, permissions и API boundaries;
- читать файлы Project Live;
- создавать архитектурные и security отчёты;
- локально разрабатывать и проверять `assistant-v1` без production deployment;
- создавать предложения по изменению контракта.

Модели разрешены ровно восемь read-only tools A101:

1. `get_current_context`;
2. `search_fields`;
3. `get_field_card`;
4. `get_field_land_bank_summary`;
5. `get_field_materials`;
6. `get_warehouse_stock`;
7. `get_crop_structure_summary`;
8. `get_active_operations_summary`.

Каждый tool обязан иметь `side_effect=none`, использовать server-authenticated actor/company/season context и пользовательский JWT/RLS read path. Любой другой tool закрыт по умолчанию.

## Утверждённая память пользователя V1

TZ-A105 одобрен как архитектурная основа со schema gate. Он не разрешает production writes и не включает assistant-код в core. Утверждены следующие сущности:

1. `chats` — существующий разговор, всегда с конкретными `user_id` и `company_id`.
2. `chat_messages` — сообщения разговора. Резюме и незакрытые вопросы хранятся в версионированном `metadata`, а не в новой дублирующей таблице.
3. `assistant_memories` — существующая user-scoped таблица памяти. `category`, `memory_key` и `value` остаются каноническим содержимым; lifecycle/provenance дополняются first-class полями.
4. `assistant_memory_events` — единственная новая таблица: content-free неизменяемая история создания candidate, подтверждения, отклонения и удаления. Общий `audit_log` не используется, потому что он company-visible и не обеспечивает приватность личной памяти.

Для `assistant_memories` разрешено добавить: `source_message_id`, `created_by`, `approved_by`, `memory_type`, `status`, `approved_at`, `rejected_at`, `expires_at`. Дублирующий `content` не создаётся: используется существующий `value`. Три существующие legacy-записи не backfill-ятся автоматически и не участвуют в approved retrieval, пока их `status` не определён отдельным решением.

Conversation summary хранит только устойчивый контекст разговора и указатель на покрытый диапазон сообщений. Unresolved question хранит вопрос, требуемое уточнение, bounded object IDs, время и состояние `open/resolved/cancelled`. Эти записи принадлежат одному chat/user/company и не являются долгосрочной памятью.

### Разрешённые типы памяти

- язык общения;
- краткость ответа;
- уровень объяснения;
- предпочитаемый формат;
- подтверждённая роль пользователя;
- предпочтение источников;
- устойчивое правило совместной работы.

Запрещено запоминать secrets/tokens/passwords, временные складские остатки, живые операции и статусы, неподтверждённые утверждения, данные другого пользователя или компании и любые инструкции, отменяющие ACL, RLS, системные правила или права. Полноценная Knowledge Base вынесена в TZ-A107.

### Lifecycle и retrieval

- Любая новая запись сначала имеет `candidate`; модель не может сразу создать `approved`.
- `approved` допускается только после явного подтверждения текущего пользователя и фиксирует `approved_by/approved_at`.
- `rejected` и expired записи не попадают в контекст.
- Пользователь может увидеть и явно удалить только свою память; deletion сохраняет content-free audit event.
- Retrieval выполняется сервером только по `scope=user + current company_id + current user_id + status=approved + unexpired`, сортируется по свежести и ограничивается пятью строками.
- Company-wide memory отключена и требует отдельной версии контракта.

### RLS и runtime

- Основной runtime использует request-scoped Supabase client с JWT текущего пользователя. Service role не является допустимым основным runtime памяти.
- `user_id`, `company_id`, `scope`, `created_by` и approval actor выводятся сервером/Auth; значения из request body не считаются доверенными.
- SELECT/INSERT/UPDATE/DELETE разрешаются только владельцу в текущей компании. Candidate можно перевести только в `approved` или `rejected`; provenance/content/ownership после создания неизменяемы.
- `assistant_memory_events` доступна владельцу только для SELECT; события пишет database trigger, прямые client INSERT/UPDATE/DELETE запрещены.
- Для `chats` и `chat_messages` A106 обязан добавить restrictive user+company policies, потому что live audit TZ-153 обнаружил legacy permissive public policies.
- Обязательны отрицательные тесты: другой user той же компании, другая компания, anon, spoofed IDs, чужое подтверждение и чужое удаление.

### Разрешение для TZ-A106

Разрешены локальная реализация и реальные записи только в assistant chat/memory tables изолированного non-production контура, только QA-пользователем TravkinFlowTest1 и только для memory scenarios. По-прежнему запрещены ERP/warehouse/operation writes, production migration/deploy, company-wide memory и автоматическое approval.

Выбранный контур — отдельная Supabase development branch от TravkinFlow. На момент TZ-153 branch отсутствует; её создание требует отдельного owner cost confirmation. До создания branch A106 может писать код и тесты, но не выполнять real mutation acceptance.

## Открытые core P0

До отдельного исправления Travkin Assistant запрещено использовать два legacy core route:

1. `app/api/operations/confirm-draft/route.ts` — не использует канонические operation-create права и защиту активного/закрытого сезона.
2. Knowledge Base DELETE — не доказывает принадлежность документа текущей компании перед service-role mutation.

A101 не делает эти маршруты безопасными: он только исключает их из model schemas, UI actions и runtime tool boundary.

## Минимальные требования к будущему read-only tool

- actor определяется сервером, а не аргументом модели;
- company и season context проверяются сервером;
- tool возвращает только минимально нужные поля;
- обычный пользователь не может выбрать чужую компанию;
- вызов можно аудитировать;
- tool не имеет скрытых write side effects;
- отсутствие разрешения приводит к отказу, а не к fallback на глобальный доступ.

## Изменение контракта

`assistant-v1` не редактирует этот файл напрямую. Ветка создаёт предложение:

`docs/project-live/contract-proposals/assistant/<date>-<topic>.md`

Основной поток рассматривает предложение, принимает или отклоняет его и при необходимости обновляет контракт отдельным согласованным ТЗ.

## Версионирование

Любое изменение контракта обязано менять:

- `CONTRACT_VERSION`;
- `LAST_UPDATED`;
- список изменений;
- compatibility statement;
- требуемое действие `assistant-v1`.

После изменения контракта assistant sync останавливает текущую реализацию до подтверждения совместимости. SHA-256 рассчитывается по фактическому файлу при sync и записывается в `ASSISTANT_SYNC_STATE.md`.

## Changelog

### 0.3 — 2026-07-14

- Рассмотрен и принят schema-gated результат TZ-A105 на commit `b22f765` без merge/rebase.
- Утверждено повторное использование `chats`, `chat_messages` и `assistant_memories`; одобрена одна новая private-audit сущность `assistant_memory_events`.
- Зафиксированы candidate-first lifecycle, явное user approval, expiry/deletion, user+company RLS и запрет service-role primary runtime.
- Разрешена TZ-A106 реализация только в отдельном non-production контуре; production schema/data/deploy остаются запрещены.
- Полная Knowledge Base зарезервирована за TZ-A107.

### 0.2 — 2026-07-14

- Приняты результаты TZ-A100 и локальный read-only foundation TZ-A101.
- Разрешена локальная разработка и TZ-A102 runtime validation без merge/deploy.
- Зафиксированы восемь разрешённых read-only tools и запрет любых side effects.
- Два legacy core P0 оставлены запрещёнными до отдельного исправления и acceptance evidence.

### 0.1 — 2026-07-13

- Создан foundation-only контракт.
- Разрешены только design/audit и contract proposals.
- Production access и write actions запрещены.
