# Contract proposal — Owner memory behavior V2

STATUS: `ACCEPTED_BY_CORE_CONTRACT_0_4_AND_IMPLEMENTED_IN_A106`
DATE: `2026-07-16`
OWNER: `assistant-v1 / TZ-A106 correction`
CURRENT_CORE_CONTRACT: `0.4`
REQUESTED_CORE_CONTRACT: `0.4 — ACCEPTED`
PRODUCTION_CHANGE: `NONE`

## Owner decision

The owner replaces candidate-first confirmation for ordinary assistant memory.

1. An explicit user instruction such as `remember my name`, `address me as ...`,
   or `answer briefly` creates approved memory immediately. No candidate and no
   second confirmation are allowed.
2. GPT-5.6 Terra may infer and immediately save durable name, preferred address,
   language, response style, brevity, stable work preferences, and stable role
   characteristics from meaning rather than keywords alone.
3. Live ERP facts, temporary conversation state, emotions, reasoning,
   unconfirmed assumptions, assistant mistakes, secrets, sensitive identifiers,
   and unsupported third-party data must never become long-term memory.
4. User-global preferences apply to all chats for that user. Company memory is
   isolated to the matching company. Selected objects, current topic, and open
   clarification remain thread-only state.
5. Explicit forget/delete language deletes the matching memory without another
   confirmation and records a content-free audit event.
6. Confirmation remains mandatory for ERP and other responsible business
   actions. Ordinary assistant memory is not an ERP mutation.

## Conflict with Contract 0.3

The current Core contract explicitly requires candidate-first lifecycle and
explicit user approval, disables company-wide memory, and prohibits automatic
approval in TZ-A106. The assistant branch is not allowed to edit that contract.
Therefore the owner decision cannot be activated until Core publishes a new
contract version and the assistant branch performs the mandatory compatibility
sync.

## Required storage and RLS decision

The isolated A106 schema is built around candidate insertion followed by an
approved/rejected transition. A direct approved insert must not be implemented
as a hidden candidate-then-approve sequence because the owner explicitly
forbids creation of a candidate.

Core must approve an additive branch-only migration that defines:

- an atomic direct-approved insert path for explicit commands;
- provenance for model-inferred approval without falsely attributing a user
  confirmation (`approval_mode` or equivalent);
- allowed sources including an explicit model-inferred source;
- user-global versus company-scoped identity and retrieval semantics;
- company-memory write/read roles and tenant isolation;
- deterministic replacement of an older value such as a changed name;
- immediate scoped deletion and a content-free creation/deletion audit event;
- RLS `USING` and `WITH CHECK` rules for every new insert/update/delete path;
- continued prohibition of service-role as the primary runtime.

The current `company_id + user_id + scope='user'` retrieval contract is not
sufficient to claim cross-company user-global behavior or company-shared memory.
Those semantics must be explicit rather than inferred in application code.

## Required model contract

Core must approve how GPT-5.6 Terra returns a memory decision without weakening
the exact eight-tool ERP boundary. Recommended boundary:

- the eight ERP tools remain unchanged and `side_effect=none`;
- memory extraction is a separate server-owned structured decision, never a
  general write tool and never a client-supplied payload;
- the server validates the model decision against an allowlist, secret and
  sensitive-data filters, actor/company scope, and source-message ownership;
- a model decision cannot store live ERP/tool output or assistant-authored text;
- model failure produces no memory write and no silent heuristic approval;
- diagnostics expose only safe category/scope/event IDs, never secret content.

## Required acceptance

The corrected TZ-A106 must prove on the isolated branch only:

1. a reported name is immediately approved;
2. a new chat knows the name;
3. an old chat sees the updated name on its next request;
4. preferred address works in every user chat;
5. company memory stays in its company;
6. a live warehouse balance is not saved;
7. `forget my name` removes it from every old and new chat;
8. user B cannot read user A memory;
9. company B cannot read company A memory;
10. creation and deletion events exist without copying memory content;
11. ERP write tools remain zero and ERP table fingerprints do not change;
12. production connections and writes remain zero.

## Activation gate resolution

Core published `INTEGRATION_CONTRACT.md` version 0.4 and the branch-only
schema/RLS migration. A106 implemented and accepted the approved behavior only
on test branch `gsglkmudcwkdetqtocae`. Production, merge, and deploy remained
untouched.
