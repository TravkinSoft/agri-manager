# Assistant Sync State

LAST_SYNC_AT: NOT_SET
ASSISTANT_BRANCH: NOT_CREATED
ASSISTANT_COMMIT: NOT_SET

CORE_BRANCH_REVIEWED: NOT_SET
CORE_COMMIT_REVIEWED: NOT_SET
CORE_LIVE_STATE_REVIEWED_AT: NOT_SET
INTEGRATION_CONTRACT_VERSION: NOT_SET
INTEGRATION_CONTRACT_HASH: NOT_SET

CORE_CHANGES_SINCE_LAST_SYNC: INITIAL_SYNC_NOT_RUN
CONTRACT_CHANGES_FOUND: UNKNOWN
SYNC_REQUIRED: YES
SYNC_BLOCKER: ASSISTANT_BRANCH_NOT_CREATED
NEXT_SAFE_ACTION: Wait for owner-approved `ASSIST-0 / ASSIST-1`; then run the protocol from [README.md](README.md) before any implementation.

## Mandatory rule

Перед каждым ТЗ в `assistant-v1` этот файл обязан быть заполнен фактическими commit/hash/date значениями. Пустые или `NOT_SET` поля запрещают начинать реализацию. Изменение контракта или нужного core API означает `STOP` до отдельного compatibility decision.
