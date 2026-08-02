# Assistant Intent UX Hardening Backlog

LAST_UPDATED: `2026-07-17`
SOURCE_TASK: `A107`
STATUS: `DEFERRED_OWNER_ACCEPTED_NON_BLOCKING`
TARGET_STAGE: `NEXT_UX_INTENT_HARDENING`

## INTENT-UX-001 — conversational praise misclassified as catalog lookup

The phrase `Маладээс` was interpreted as a product request and triggered an ERP catalog search. The A107 owner explicitly accepted this as a known non-blocking issue.

Future intent hardening must:

- distinguish praise, acknowledgements, and colloquial conversation from catalog or inventory requests;
- normalize and recognize variants such as `молодец`, `маладец`, and `маладээс`;
- require an explicit product, stock, warehouse, field, operation, or other business subject before starting an ERP search;
- prefer a short conversational response when no explicit subject request exists;
- add negative regression coverage proving that praise never invokes an ERP tool.

This backlog item does not reopen or block A107. It must preserve all read-only, tenant-isolation, and no-production guarantees when implemented.
