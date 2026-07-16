# TravkinFlow Core ↔ Assistant Integration Contract

CONTRACT_VERSION: 0.4
STATUS: ASSISTANT_MEMORY_POLICY_V2_BRANCH_ACCEPTED
LAST_UPDATED: 2026-07-16
COMPATIBILITY: Read-only foundation A100-A104 and the A106 safety boundary remain approved. Contract 0.4 supersedes only the candidate-first memory behavior from 0.3. The owner-memory-behavior-v2 proposal was reviewed from the local `assistant-v1` worktree because it is not present in `origin/assistant-v1`; no merge or rebase occurred. A106 may sync and continue only against Supabase branch `assistant-memory-a106` (`gsglkmudcwkdetqtocae`). Production memory migration, merge and deployment are not approved.
ASSISTANT_ACTION_REQUIRED: Sync Contract 0.4 into `assistant-v1`, replace the V1 candidate-first prototype with direct-approved Memory Policy V2, preserve all eight read-only ERP tools and repeat A106 runtime acceptance on the isolated branch. Do not start A107 and do not connect the memory runtime to production project `bhsemlvmkikpntabctml`.

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

## Утверждённая память V2

Contract 0.4 утверждает три разных уровня памяти. Они не взаимозаменяемы и не могут автоматически повышать scope.

1. `USER_GLOBAL` — личная долговременная память одного `user_id`: имя, предпочитаемое обращение, язык, стиль, краткость и устойчивые личные рабочие предпочтения. Она доступна этому пользователю во всех старых и новых чатах и не фильтруется по компании.
2. `COMPANY` — подтверждённые правила хозяйства, внутренняя терминология и устойчивые особенности процессов. Она доступна только внутри одной `company_id`. Создавать, обновлять и удалять её могут только active `company_admin`, `director`, `is_owner=true` или `global_admin` в своей profile-company; обычный сотрудник не создаёт company-wide истину.
3. `CONVERSATION` — выбранное поле, текущая тема, незакрытый вопрос и временное состояние. Она хранится в versioned `chat_messages.metadata`, принадлежит одному chat/user/company и не попадает в `assistant_memories`.

`assistant_memories` остаётся каноническим хранилищем USER_GLOBAL и COMPANY. `category`, `memory_key` и `value` сохраняют бизнес-содержимое; `provenance`, `normalized_fact`, `approval_mode`, `source_message_id`, `confidence` и lifecycle-поля являются first-class provenance. `assistant_memory_events` остаётся content-free неизменяемым аудитом без копирования значения памяти.

### USER_EXPLICIT

- Явная команда «запомни» создаёт одну атомарную запись сразу со `status=approved` и `active=true`.
- Candidate и второе подтверждение не создаются.
- Обязательны `provenance=user_explicit`, собственный `source_message_id`, `created_by`, нормализованный факт и audit event.
- `approved_by` равен текущему пользователю, `approval_mode=direct_user_explicit`, confidence фиксируется как `1.000`.

### ASSISTANT_INFERRED

Автоматически разрешены только устойчивые безопасные типы: `name`, `preferred_address`, `language`, `response_style`, `response_brevity`, `durable_work_preference`. Требуются `provenance=assistant_inferred`, собственный `source_message_id`, короткий `normalized_fact`, audit event и confidence не ниже `0.850`. Это прямой approved insert с `approval_mode=model_inferred`; он не выдаётся за явное пользовательское подтверждение.

Автоматически запрещено сохранять живые ERP-факты, остатки склада, статусы операций, текущие площади и числа, временные планы, эмоции, предположения, медицинские/финансовые/иные чувствительные сведения без явной необходимости, пароли/ключи/токены, данные других пользователей и ответы самого ассистента как факты. Эти данные не могут маскироваться под разрешённый тип.

### COMPANY memory

Разрешены только `company_rule`, `company_terminology` и `company_process_preference` с `provenance=company_explicit`. Запись и удаление role-gated; чтение ограничено той же компанией. Global admin не получает право подменить `company_id` из request body: разрешена только его собственная profile-company до отдельного server-selected-context контракта.

### Удаление и retrieval

- Команда «забудь/удали из памяти» удаляет собственную USER_GLOBAL запись немедленно, без второго подтверждения, и создаёт content-free `memory_deleted` event.
- COMPANY deletion использует тот же company role guard.
- После удаления факт не используется ни в старых, ни в новых чатах.
- Runtime retrieval выбирает только `status=approved + active=true + unexpired`; USER_GLOBAL фильтруется по `user_id`, COMPANY — по текущей подтверждённой `company_id`.
- Активные факты дедуплицируются case-insensitive unique indexes по owner/scope/type/key; обновление не может менять ownership, scope, provenance или source message.
- V1 candidate/rejected QA-записи помечаются `approval_mode=legacy_v1`, не создаются новым runtime и допускают только удаление.

### RLS и runtime

- Основной runtime использует только request-scoped Supabase client с JWT пользователя. Service role не используется как memory runtime.
- Trigger выводит actor/company из Auth/profile, запрещает spoofed user/company, прямой candidate insert и provenance/type вне allowlist.
- Пользователь читает, обновляет и удаляет только свою USER_GLOBAL память. Другой user не видит и не мутирует её даже в той же системе.
- COMPANY mutation ограничена перечисленными ролями и собственной company; другая компания не видит и не мутирует запись.
- `assistant_memory_events` разрешена клиенту только для SELECT; INSERT/UPDATE/DELETE выполняет database trigger.
- Authenticated grant ограничен `SELECT/INSERT/UPDATE/DELETE` для memories и `SELECT` для events; `TRUNCATE`, `TRIGGER` и `REFERENCES` клиенту не выдаются.

### Разрешение для TZ-A106

Branch-only migration `20260716125205_assistant_memory_policy_v2.sql` применена только к `assistant-memory-a106` (`gsglkmudcwkdetqtocae`). Real JWT acceptance Contract 0.4 прошёл 10/10 плюс company-admin/cross-company guard. A106 разрешено синхронизировать с этим контрактом и продолжить branch-only runtime acceptance.

Не меняются: восемь read-only ERP tools, Responses API, `store:false`, GPT-5.6 Terra, reasoning medium, лимит 60 сообщений, summary/entity state, запрет ERP writes и production isolation. Production migration, merge, deploy и A107 остаются запрещены.

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

### 0.4 — 2026-07-16

- Candidate-first поведение 0.3 заменено USER_EXPLICIT direct-approved и безопасной allowlist-моделью ASSISTANT_INFERRED.
- Утверждены отдельные scopes USER_GLOBAL, COMPANY и CONVERSATION; USER_GLOBAL действует во всех чатах одного пользователя независимо от компании.
- Утверждены немедленное удаление собственной памяти, content-free audit, dedupe и company role guard.
- Branch-only migration применена и проверена реальными JWT на `assistant-memory-a106`; production не менялась.
- A106 разрешено продолжить после sync Contract 0.4; A107, merge, deploy и production memory migration не разрешены.

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
