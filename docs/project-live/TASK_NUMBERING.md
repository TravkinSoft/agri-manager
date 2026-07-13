# Task Numbering Registry

Реестр обновляет только координатор основной ветки. Номер ТЗ никогда не используется повторно, даже если задача отменена или заменена.

Допустимые направления: `CORE`, `DATABASE`, `GLBD`, `ASSISTANT`, `UI`, `OPERATIONS`, `WAREHOUSE`.

## Независимые последовательности

- Основная ветка TravkinFlow использует `TZ-141`, `TZ-142`, `TZ-143` и далее; в тексте это «ТЗ №141», «ТЗ №142», «ТЗ №143».
- Ветка Travkin Assistant использует отдельную последовательность `TZ-A100`, `TZ-A101`, `TZ-A102` и далее; `A` — латинская буква.
- CORE- и ASSISTANT-номера не пересекаются и никогда не используются повторно.
- Core-отчёт называется `task-reports/core/TZ-141.md`; assistant-отчёт называется `task-reports/assistant/TZ-A100.md`.
- Основная ветка может резервировать номера `Axxx` в этом реестре.
- `assistant-v1` не присваивает себе новый номер самостоятельно: номер должен сначала появиться в этом реестре основной ветки.

| task_number | direction | title | branch | status | depends_on | report_path | commit_hash |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TZ-135 | DATABASE | Legacy migration audit | copilot-v1 | DONE | TZ-134 | `external: audit-output/TZ-135/` | N/A (audit outputs not committed) |
| TZ-136 | UI | Fallow crop structure fix | copilot-v1 | DONE | — | Not created before Project Live foundation | `e36ab0a` |
| TZ-137 | DATABASE | Superseded migrations review | copilot-v1 | DONE | TZ-135 | `external: audit-output/TZ-137/` | N/A (audit outputs not committed) |
| TZ-138 | DATABASE | Canonical varieties selective commit | copilot-v1 | DONE | TZ-137 | Not created before Project Live foundation | `4eb2d58` |
| TZ-139 | CORE | Project Live and assistant handoff foundation | copilot-v1 | DONE | TZ-135,TZ-137,TZ-138 | [task-reports/core/TZ-139.md](task-reports/core/TZ-139.md) | `3ef0afe` |
| TZ-140 | DATABASE | Push core commits and repair six legacy history entries | copilot-v1 | DONE | TZ-137,TZ-138,TZ-139 | [task-reports/core/TZ-140.md](task-reports/core/TZ-140.md) | `SELF` |
| TZ-141 | ASSISTANT / GOVERNANCE | Assistant isolated branch and Live sync | copilot-v1 -> assistant-v1 | DONE | TZ-139,TZ-140 | [task-reports/core/TZ-141.md](task-reports/core/TZ-141.md) | `d192587` |
| TZ-A100 | ASSISTANT | Current Architecture & Runtime Audit | assistant-v1 | DONE | TZ-141 | `external: origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A100.md` | `4cb8cdf` |
| TZ-A101 | ASSISTANT | Read-only Assistant Foundation | assistant-v1 | DONE | TZ-A100 | `external: origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A101.md` | `51e878e` |
| TZ-A102 | ASSISTANT | Real Local Runtime Validation | assistant-v1 | PLANNED | TZ-A101,TZ-145 | `PLANNED` | `N/A` |
| TZ-142 | DATABASE | Audit partially equivalent legacy migrations | copilot-v1 | DONE | TZ-141 | [task-reports/core/TZ-142.md](task-reports/core/TZ-142.md) | `SELF` |
| TZ-143 | WAREHOUSE | Warehouse units and batch classes correction plan | copilot-v1 | DONE | TZ-142 | [task-reports/core/TZ-143.md](task-reports/core/TZ-143.md) | `SELF` |
| TZ-144 | WAREHOUSE | Canonical warehouse units and batch identity implementation | copilot-v1 | DONE | TZ-143 | [task-reports/core/TZ-144.md](task-reports/core/TZ-144.md) | `SELF` |
| TZ-145 | CORE / ASSISTANT GOVERNANCE | Approve read-only Assistant foundation | copilot-v1 | DONE | TZ-A100,TZ-A101 | [task-reports/core/TZ-145.md](task-reports/core/TZ-145.md) | `SELF` |

| TZ-146 | WAREHOUSE / DATABASE | Warehouse Units V2 production preflight | copilot-v1 | DONE | TZ-144,TZ-145 | [task-reports/core/TZ-146.md](task-reports/core/TZ-146.md) | `SELF` |
| TZ-147 | CORE / ASSISTANT GOVERNANCE | Provision safe QA identity for A102 | copilot-v1 | DONE | TZ-A102,TZ-145 | [task-reports/core/TZ-147.md](task-reports/core/TZ-147.md) | `SELF` |
| TZ-148 | WAREHOUSE / DATABASE | Make Warehouse Units V2 migration repeat-safe | copilot-v1 | DONE | TZ-144,TZ-146,TZ-147 | [task-reports/core/TZ-148.md](task-reports/core/TZ-148.md) | `SELF` |

## Status values

Use one of: `PLANNED`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED`, `SUPERSEDED`.

## Registration rule

1. Before issuing a new number, search this file.
2. Choose the correct independent sequence: numeric CORE or Latin-`A` ASSISTANT.
3. Add the task once with direction and branch.
4. Update status and report path after completion; do not delete the row.
5. `assistant-v1` may use only an `Axxx` number already reserved here by the main branch.
6. `SELF` is allowed only when the registry row and task report are committed together with the task itself.
