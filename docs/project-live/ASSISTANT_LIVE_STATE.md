# Assistant Live State

STATUS: READY_FOR_ISOLATED_AUDIT
BRANCH: `assistant-v1`
BASE_CORE_COMMIT: `SELF` (documentation commit that becomes the exact base of `assistant-v1`)
RUNTIME_AUDIT: NOT_STARTED
CONVERSATION_MEMORY: NOT_IMPLEMENTED
ENTITY_STATE: NOT_IMPLEMENTED
CONTEXT_BUILDER: NOT_IMPLEMENTED
ERP_TOOLS: NOT_AUDITED
KNOWLEDGE_BASE: NOT_AUDITED
PERSISTENT_MEMORY: NOT_IMPLEMENTED
SETTINGS_ROOM: NOT_IMPLEMENTED
EVALUATIONS: NOT_IMPLEMENTED
PRODUCTION_ACCESS: NONE
WRITE_ACTIONS: DISABLED

Разработка Travkin Assistant ещё не начиналась. Первый этап — отдельный read-only аудит текущего assistant runtime. V1 начинается только в read-only режиме и не меняет core без отдельного предложения и принятого изменения [Integration Contract](INTEGRATION_CONTRACT.md).

## Approved architecture

Одобренный ориентир владельца: **TRAVKIN ASSISTANT V1 — MASTER ROADMAP & ARCHITECTURE**.

Foundation-принципы:

- GPT-first архитектура;
- один сильный ассистент вместо набора несвязанных ботов;
- V1 работает read-only;
- память хранится в Supabase только после отдельного schema/security approval;
- ERP capabilities оформляются узкими server tools;
- company isolation обязательна на каждом read path;
- RAG учитывает права пользователя и компанию;
- до реализации проводится аудит уже существующего `/api/assistant/**` runtime, storage и security boundaries.

Наличие legacy assistant routes в коде не означает, что новая архитектура реализована или допущена в production.

## Next assistant action

Не начинать без отдельной команды владельца.

Первый будущий этап: ТЗ A100 — выполнить sync protocol и провести read-only аудит текущего assistant runtime в изолированной ветке. Production access отсутствует, write actions выключены.
