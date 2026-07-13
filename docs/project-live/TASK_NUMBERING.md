# Task Numbering Registry

Реестр обновляет только координатор основной ветки. Номер ТЗ никогда не используется повторно, даже если задача отменена или заменена.

Допустимые направления: `CORE`, `DATABASE`, `GLBD`, `ASSISTANT`, `UI`, `OPERATIONS`, `WAREHOUSE`.

| task_number | direction | title | branch | status | depends_on | report_path | commit_hash |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TZ-135 | DATABASE | Legacy migration audit | copilot-v1 | DONE | TZ-134 | `external: audit-output/TZ-135/` | N/A (audit outputs not committed) |
| TZ-136 | UI | Fallow crop structure fix | copilot-v1 | DONE | — | Not created before Project Live foundation | `e36ab0a` |
| TZ-137 | DATABASE | Superseded migrations review | copilot-v1 | DONE | TZ-135 | `external: audit-output/TZ-137/` | N/A (audit outputs not committed) |
| TZ-138 | DATABASE | Canonical varieties selective commit | copilot-v1 | DONE | TZ-137 | Not created before Project Live foundation | `4eb2d58` |
| TZ-139 | CORE | Project Live and assistant handoff foundation | copilot-v1 | DONE | TZ-135,TZ-137,TZ-138 | [task-reports/core/TZ-139.md](task-reports/core/TZ-139.md) | `3ef0afe` |
| TZ-140 | DATABASE | Push core commits and repair six legacy history entries | copilot-v1 | DONE | TZ-137,TZ-138,TZ-139 | [task-reports/core/TZ-140.md](task-reports/core/TZ-140.md) | `SELF` |
| TZ-141 | ASSISTANT / GOVERNANCE | Assistant isolated branch and Live sync | copilot-v1 -> assistant-v1 | IN_PROGRESS | TZ-139,TZ-140 | [task-reports/core/TZ-141.md](task-reports/core/TZ-141.md) | `SELF` |
| TZ-142 | ASSISTANT | Current Architecture & Runtime Audit | assistant-v1 | PLANNED | TZ-141 | Not created | NOT_SET |
| TZ-143 | DATABASE | Audit partially equivalent legacy migrations | copilot-v1 | PLANNED | TZ-141 | Not created | NOT_SET |

## Status values

Use one of: `PLANNED`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED`, `SUPERSEDED`.

## Registration rule

1. Before issuing a new number, search this file.
2. Add the task once with direction and branch.
3. Update status and report path after completion; do not delete the row.
4. `SELF` is allowed only when the registry row and task report are committed together with the task itself.
