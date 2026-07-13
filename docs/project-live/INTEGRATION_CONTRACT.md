# TravkinFlow Core ↔ Assistant Integration Contract

CONTRACT_VERSION: 0.2
STATUS: READ_ONLY_ASSISTANT_FOUNDATION_APPROVED
LAST_UPDATED: 2026-07-14
COMPATIBILITY: TZ-A100 and TZ-A101 at assistant commit `51e878e7306d0b6a821a21b9a7174466e165d10c` are approved only as a local read-only foundation. Merge and production deployment are not approved.
ASSISTANT_ACTION_REQUIRED: TZ-A102 may perform real local runtime validation only after syncing this contract. Writes, direct SQL, database changes, merge and deploy remain forbidden.

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

- выполнять прямой SQL или подключаться напрямую к production DB;
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

### 0.2 — 2026-07-14

- Приняты результаты TZ-A100 и локальный read-only foundation TZ-A101.
- Разрешена локальная разработка и TZ-A102 runtime validation без merge/deploy.
- Зафиксированы восемь разрешённых read-only tools и запрет любых side effects.
- Два legacy core P0 оставлены запрещёнными до отдельного исправления и acceptance evidence.

### 0.1 — 2026-07-13

- Создан foundation-only контракт.
- Разрешены только design/audit и contract proposals.
- Production access и write actions запрещены.
