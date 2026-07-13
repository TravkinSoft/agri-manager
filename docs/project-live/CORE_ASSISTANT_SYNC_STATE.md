# Core Assistant Sync State

LAST_REVIEW_AT: NOT_SET
CORE_BRANCH: `copilot-v1`
CORE_COMMIT: `SELF` (documentation commit that establishes the isolated assistant workflow)

ASSISTANT_BRANCH_REVIEWED: NOT_CREATED
ASSISTANT_COMMIT_REVIEWED: NOT_SET
ASSISTANT_LIVE_STATE_REVIEWED_AT: NOT_SET
ASSISTANT_SYNC_STATE_REVIEWED_AT: NOT_SET
LATEST_ASSISTANT_TASK_REPORT: NOT_SET

ASSISTANT_CHANGES_FOUND: INITIAL_REVIEW_NOT_RUN
CORE_IMPACT_FOUND: UNKNOWN
INTEGRATION_CONTRACT_IMPACT: UNKNOWN
CORE_ACTION_REQUIRED: YES - run the mandatory CORE pre-task review after `origin/assistant-v1` exists.
NEXT_SAFE_ACTION: Create `assistant-v1` from this documentation commit, push it, then verify reciprocal read access with `git show` without merge or rebase.

## Mandatory rule

Перед каждым CORE-ТЗ основной поток обязан обновить этот файл фактическими commit/date/report значениями после чтения состояния `origin/assistant-v1`. Если найдено влияние на core или [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md), текущая задача получает `STOP` до отдельного решения владельца. Автоматический merge или rebase между ветками запрещён.
