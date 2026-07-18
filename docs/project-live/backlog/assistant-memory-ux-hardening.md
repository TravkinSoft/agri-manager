# Assistant UX / Memory Hardening Backlog

LAST_UPDATED: `2026-07-19`
SOURCE_TASK: `A106, A109`
STATUS: `DEFERRED_OWNER_ACCEPTED_NON_BLOCKING`
TARGET_STAGE: `NEXT_UX_MEMORY_HARDENING`

## MEM-UX-001 — unstable user name persistence in isolated scenarios

In individual scenarios the `name` user-global memory may be saved or recovered inconsistently, even though preferred address and other user-global preferences work across chats. The A106 owner explicitly accepted this as a known non-blocking issue.

Future hardening must reproduce the unstable path with the Core QA Dataset, distinguish extraction failure from INSERT/UPSERT or retrieval failure, and add deterministic coverage for explicit name save, cross-chat load, page reload, re-authentication, replacement, and deletion. A user-facing “saved” acknowledgement must continue to require confirmed returned database rows.

This backlog item does not reopen or block A106. A107 must not start until the Core QA Dataset is ready.

## MEM-UX-002 — temporary chat cleanup blocked by memory source FK

During A109 REAL acceptance cleanup, deleting temporary test chat messages produced a non-blocking warning because `assistant_memories.source_message_id` referenced one source `chat_messages.id`.

This did not affect A109 acceptance, tenant isolation, ERP data, or runtime behavior: the ERP snapshot before and after the suite was identical, ERP writes remained `0`, and the owner accepted A109 with this warning deferred. Future memory hardening should define a safe cleanup policy for test threads/messages that are referenced by approved memory, without weakening memory provenance or deleting audit evidence.

This backlog item does not reopen or block A109. A109 does not change memory logic.
