# Contract proposal — Assistant confirmed memory schema V1

STATUS: `PROPOSED — NOT APPROVED — NOT APPLIED`
DATE: `2026-07-14`
OWNER: `assistant-v1 / TZ-A105`
PRODUCTION_CHANGE: `NONE`

## Why the current schema is insufficient

The tracked `assistant_memories` schema has `company_id`, `user_id`, `scope`, `category`, `memory_key`, `value`, `confidence`, `source`, `metadata`, `active`, timestamps and a tenant/user/key uniqueness constraint. It does not have first-class `source_message_id`, `created_by`, `approved_by`, `memory_type`, `content`, `status`, or `expires_at` fields. Candidate, approved and rejected states can only be hidden in JSON metadata, which is not a sufficient production contract for authorization, lifecycle filtering or auditability.

RLS is enabled on the table, but the tracked migration defines no authenticated-user policies. The current memory route uses the service-role client. A service-role request bypasses RLS, so tenant and user isolation currently depend entirely on route filters. That is not accepted as the final A105 production boundary.

## Requested additive schema

Core approval is requested for an additive migration that gives every V1 memory record these first-class fields:

- `id uuid primary key`;
- `company_id uuid not null`;
- `user_id uuid not null`;
- `scope text not null check (scope = 'user')` for V1;
- `source_message_id uuid not null`;
- `created_by uuid not null`;
- `approved_by uuid null`;
- `memory_type text not null` with the seven A105 user-preference types;
- `memory_key text not null`;
- `content text not null`;
- `confidence numeric not null check (confidence between 0 and 1)`;
- `source text not null check (source in ('explicit_user_command','assistant_proposal'))`;
- `status text not null check (status in ('candidate','approved','rejected'))`;
- `created_at timestamptz not null`;
- `updated_at timestamptz not null`;
- `expires_at timestamptz null`.

The approval invariant should be enforced in SQL: `approved_by` is non-null only for `approved`; a candidate is never active or retrievable; changing a status to `approved` must not increase model-assigned confidence. `company` scope is excluded from the V1 check constraint and requires a separate contract.

Suggested indexes:

```sql
create index assistant_memories_user_retrieval_v1_idx
  on public.assistant_memories(company_id, user_id, status, expires_at, updated_at desc)
  where scope = 'user' and status = 'approved';

create unique index assistant_memories_user_key_v1_uidx
  on public.assistant_memories(company_id, user_id, memory_type, memory_key)
  where scope = 'user' and status in ('candidate', 'approved');
```

This is a design sketch, not an executable migration.

## Required RLS contract

All authenticated policies must bind the row to the signed-in profile and that profile's current company. The intended effective condition is:

```sql
user_id = (select auth.uid())
and company_id = (
  select p.company_id from public.profiles p where p.id = (select auth.uid())
)
and scope = 'user'
```

Required policies:

1. `SELECT`: own user memory in the current company only.
2. `INSERT`: `user_id`, `created_by` and authenticated profile must match; status must be `candidate`; `approved_by` must be null.
3. `UPDATE`: own current-company candidate only; allowed transitions are `candidate -> approved|rejected`; the row's user/company/scope/source/content fields cannot be reassigned through the API contract.
4. `DELETE`: own current-company row only; application still requires a separate explicit confirmation and writes an assistant audit event.

The preferred runtime is a request-scoped authenticated Supabase client so RLS remains an independent enforcement layer. If Core retains a backend service client, the route must keep mandatory equality filters on `id + company_id + user_id + scope`, derive both IDs from the verified session, reject spoof fields, and maintain cross-tenant tests. The service credential must never reach the browser.

## Retrieval and audit contract

Retrieval is server-only and must filter `scope='user'`, current `company_id`, current `user_id`, `status='approved'`, and `(expires_at is null or expires_at > now())`, then rank and cap at five. Diagnostics may expose only count, categories and record IDs.

Candidate creation, approval/rejection and deletion should be auditable. Deletion must emit `assistant_memory_delete` with actor, company, memory ID/type and timestamp, but not secret prompt text. ERP tables and the eight read-only tool contract are outside this mutation scope.

## Safe rollout gates

1. Core reviews and approves the schema/RLS design.
2. A migration is authored in a separate approved task.
3. Migration and policies are tested against two users and two companies in a non-production environment.
4. The local feature flag is enabled only for QA.
5. Mocked and real QA pass, including foreign read/confirm/delete denial.
6. Production apply/deploy requires a separate explicit approval.

Until all gates pass, `ASSISTANT_MEMORY_V1_ENABLED` remains off by default and is forced off in production.
