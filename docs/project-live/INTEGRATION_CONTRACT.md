# TravkinFlow Core ↔ Assistant Integration Contract

CONTRACT_VERSION: 0.1
STATUS: FOUNDATION_ONLY
LAST_UPDATED: 2026-07-13
COMPATIBILITY: No assistant implementation is approved yet.
ASSISTANT_ACTION_REQUIRED: Run initial sync and runtime audit only under owner-reserved ТЗ A100.

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

## Разрешено на первом этапе

- читать код в согласованном scope;
- проводить read-only аудит runtime, storage, permissions и API boundaries;
- читать файлы Project Live;
- создавать архитектурные и security отчёты;
- проектировать узкие read-only ERP tools без их подключения к production;
- создавать предложения по изменению контракта.

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

### 0.1 — 2026-07-13

- Создан foundation-only контракт.
- Разрешены только design/audit и contract proposals.
- Production access и write actions запрещены.
