# Assistant Live State

STATUS: NOT_STARTED
BRANCH: NOT_CREATED
BASE_CORE_COMMIT: `4eb2d585a6570c1d382ae4c47963f60d23e12800` (baseline before Project Live foundation commit)
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

Первый будущий этап: `ASSIST-0 / ASSIST-1` — создать ветку отдельным согласованным ТЗ, выполнить sync protocol и провести read-only audit текущего assistant runtime. До этого production access отсутствует, write actions выключены.
