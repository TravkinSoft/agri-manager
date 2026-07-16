# Assistant UX / Memory Hardening Backlog

LAST_UPDATED: `2026-07-17`
SOURCE_TASK: `A106`
STATUS: `DEFERRED_OWNER_ACCEPTED_NON_BLOCKING`
TARGET_STAGE: `NEXT_UX_MEMORY_HARDENING`

## MEM-UX-001 — unstable user name persistence in isolated scenarios

In individual scenarios the `name` user-global memory may be saved or recovered inconsistently, even though preferred address and other user-global preferences work across chats. The A106 owner explicitly accepted this as a known non-blocking issue.

Future hardening must reproduce the unstable path with the Core QA Dataset, distinguish extraction failure from INSERT/UPSERT or retrieval failure, and add deterministic coverage for explicit name save, cross-chat load, page reload, re-authentication, replacement, and deletion. A user-facing “saved” acknowledgement must continue to require confirmed returned database rows.

This backlog item does not reopen or block A106. A107 must not start until the Core QA Dataset is ready.
