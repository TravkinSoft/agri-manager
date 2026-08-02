# TravkinFlow Project Live

Эта папка хранит короткую актуальную правду о TravkinFlow и правила передачи контекста будущей ветке Travkin Assistant. Это не архив всех обсуждений и не замена Git: подробности каждой выполненной задачи остаются в task report, а live-файлы обновляются только тогда, когда меняется текущее состояние проекта.

## Владельцы файлов

| Файл или каталог | Кто изменяет | Кто читает |
| --- | --- | --- |
| [CORE_LIVE_STATE.md](CORE_LIVE_STATE.md) | Только основной поток `copilot-v1` | `assistant-v1` и основной поток |
| [CORE_ASSISTANT_SYNC_STATE.md](CORE_ASSISTANT_SYNC_STATE.md) | Только основной поток `copilot-v1` | Основной поток и `assistant-v1` |
| [ASSISTANT_LIVE_STATE.md](ASSISTANT_LIVE_STATE.md) | Только поток `assistant-v1` | Основной поток и `assistant-v1` |
| [ASSISTANT_SYNC_STATE.md](ASSISTANT_SYNC_STATE.md) | Только поток `assistant-v1` | Основной поток и `assistant-v1` |
| [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md) | Только основной поток, отдельным согласованным ТЗ | Обе ветки |
| [TASK_NUMBERING.md](TASK_NUMBERING.md) | Только координатор основной ветки | Обе ветки |
| [task-reports/core/](task-reports/core/) | Основной поток | Обе ветки |
| [task-reports/assistant/](task-reports/assistant/) | Поток `assistant-v1` | Обе ветки |
| [contract-proposals/assistant/](contract-proposals/assistant/) | Поток `assistant-v1` | Основной поток рассматривает предложение |

`assistant-v1` не редактирует `CORE_LIVE_STATE.md`, `CORE_ASSISTANT_SYNC_STATE.md`, `INTEGRATION_CONTRACT.md` или `TASK_NUMBERING.md`. Основной поток не редактирует состояние ассистента вместо него. Так ветки не перетирают зоны ответственности друг друга.

## После каждого ТЗ

### CORE-ТЗ

1. Выполнить обязательный CORE pre-task protocol ниже и обновить `CORE_ASSISTANT_SYNC_STATE.md`.
2. Создать `task-reports/core/TZ-XXX.md` по [CORE_TASK_REPORT_TEMPLATE.md](templates/CORE_TASK_REPORT_TEMPLATE.md).
3. Обновить `CORE_LIVE_STATE.md` только если изменилась текущая правда проекта.
4. Не копировать полный отчёт задачи в live-state.
5. Зафиксировать влияние на ассистента, необходимость повторной синхронизации и изменение контракта.
6. Обновить `TASK_NUMBERING.md` через координатора основной ветки.

### ASSISTANT-ТЗ

1. Убедиться, что номер `TZ-Axxx` заранее зарегистрирован основной веткой в `TASK_NUMBERING.md`; самостоятельно присваивать номер запрещено.
2. Создать `task-reports/assistant/TZ-Axxx.md` по [ASSISTANT_TASK_REPORT_TEMPLATE.md](templates/ASSISTANT_TASK_REPORT_TEMPLATE.md).
3. Обновить `ASSISTANT_LIVE_STATE.md`.
4. Обновить `ASSISTANT_SYNC_STATE.md`.
5. Не менять `CORE_LIVE_STATE.md`, `INTEGRATION_CONTRACT.md` и `TASK_NUMBERING.md`.
6. Изменение контракта предложить через [CONTRACT_CHANGE_PROPOSAL_TEMPLATE.md](templates/CONTRACT_CHANGE_PROPOSAL_TEMPLATE.md).

## Протокол перед каждым CORE-ТЗ

1. Проверить ветку `copilot-v1` и `git status`.
2. Выполнить `git fetch origin`.
3. Если существует `origin/assistant-v1`, прочитать без изменения своей ветки:

```powershell
git show origin/assistant-v1:docs/project-live/ASSISTANT_LIVE_STATE.md
git show origin/assistant-v1:docs/project-live/ASSISTANT_SYNC_STATE.md
# Определить последний файл в docs/project-live/task-reports/assistant/ и прочитать его через git show.
```

4. Обновить `CORE_ASSISTANT_SYNC_STATE.md` фактическими commit/date/report значениями.
5. Если ассистент затронул core или Integration Contract, остановиться и запросить отдельное решение.
6. Не делать автоматический merge или rebase ветки ассистента.
7. Синхронизировать изменения только отдельным согласованным ТЗ.

## Протокол перед каждым ASSISTANT-ТЗ

1. Проверить ветку `assistant-v1` и `git status`.
2. Выполнить `git fetch origin`.
3. Прочитать без изменения своей ветки:

```powershell
git show origin/copilot-v1:docs/project-live/CORE_LIVE_STATE.md
git show origin/copilot-v1:docs/project-live/INTEGRATION_CONTRACT.md
git show origin/copilot-v1:docs/project-live/TASK_NUMBERING.md
# Определить последний файл в docs/project-live/task-reports/core/ и прочитать его через git show.
```

4. Сравнить core commit, версию и SHA-256 контракта, блокеры и используемые API.
5. Обновить `ASSISTANT_SYNC_STATE.md`.
6. Если контракт изменился, остановиться и запросить отдельное решение по совместимости.
7. Если изменился нужный core API, остановиться и подготовить compatibility report.
8. Не делать автоматический merge или rebase основной ветки.
9. Синхронизировать код только отдельным согласованным ТЗ.

## Служебные значения

- `SELF` в отчёте, который входит в тот же commit, означает «commit, содержащий этот файл». Его фактический hash берётся из Git после commit.
- Пустое поле или `NOT_SET` означает, что действие ещё не выполнялось и значение нельзя додумывать.
