# Contract proposal — Assistant P0 core security boundary

PROPOSAL_DATE: `2026-07-13`
SOURCE_TASK: `TZ-A101`
SOURCE_BRANCH: `assistant-v1`
TARGET_OWNER: `CORE`
STATUS: `PROPOSED_NOT_APPLIED`
ASSISTANT_V1_POLICY: `FORBIDDEN_UNTIL_CORE_FIX_ACCEPTED`

## Problem

The A100 audit confirmed two core-side service-role write paths that do not meet the future Travkin Assistant contract:

1. the legacy `app/api/operations/confirm-draft/route.ts` path can create an operation without the canonical operation-create role and active-season guards;
2. Knowledge Base DELETE accepts a caller-provided document ID and archives it without a server-enforced `company_id` ownership predicate.

Neither core implementation is changed by TZ-A101. The A101 model schema, API response, and main/legacy assistant UI paths make both functions unreachable from Travkin Assistant V1.

## Requested core changes

### 1. Close or canonicalize legacy confirm-draft

Core should choose one of these outcomes:

- remove/disable the legacy endpoint and route all supported creation through the canonical `/api/operations` contract; or
- make the endpoint enforce exactly the canonical server actor, allowed operation-create roles, server-selected company, active/open season, field/company ownership, idempotency, and audit invariants before any service-role mutation.

Client-provided `companyId`, `userId`, role, or season must never grant authority. A closed season must fail closed. A draft remains untrusted input until every referenced entity is resolved inside the authenticated company/season scope.

### 2. Enforce company ownership for KB DELETE

Before archive/delete, core must resolve actor and company server-side and mutate only a row satisfying both document ID and current `company_id` (plus user/role policy where applicable). A missing or foreign document must return not-found/denied without revealing foreign metadata. Service-role use must never remove the ownership predicate.

### 3. Keep both capabilities forbidden in Assistant V1 until accepted

Until the fixes are reviewed and the integration contract is updated:

- no confirm-draft schema, endpoint reference, action, or card may be exposed to the assistant model;
- no KB create/update/delete tool may be exposed;
- unknown model attempts must fail with `TOOL_NOT_ALLOWED` and must not fall back to a legacy route;
- no client navigation/action handler may turn assistant prose into either write.

## Acceptance evidence requested from core

- negative role test against confirm-draft;
- closed-season denial test;
- cross-company field/entity denial test;
- idempotent duplicate test through the canonical path;
- cross-company KB DELETE test proving the foreign row is unchanged;
- direct endpoint tests showing client-supplied company/user values cannot widen scope;
- updated integration contract/version and core/assistant sync state.

## Assistant-side status

TZ-A101 exposes only eight read-only tools, all marked `side_effect=none`, and executes them with an authenticated user JWT/RLS client plus a central company/result policy. `create_*`, generic SQL/resolvers, navigation execution, draft confirmation, and KB mutations are absent from the model-facing schema. The original core vulnerabilities therefore do not reproduce through the A101 runtime, while legitimate read-only field, stock, crop, operation, and context queries remain available.
