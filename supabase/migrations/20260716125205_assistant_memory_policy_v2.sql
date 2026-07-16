-- Travkin Assistant memory policy V2 (Contract 0.4).
--
-- Acceptance target: Supabase development branch assistant-memory-a106 only.
-- This migration must not be applied to production without a separate owner-approved task.

begin;

drop trigger if exists assistant_memories_audit_v1_trigger on public.assistant_memories;
drop trigger if exists assistant_memories_lifecycle_v1_trigger on public.assistant_memories;

alter table public.assistant_memories
  add column if not exists provenance text,
  add column if not exists normalized_fact text,
  add column if not exists approval_mode text;

alter table public.assistant_memory_events
  add column if not exists memory_scope text,
  add column if not exists provenance text;

alter table public.assistant_memories
  drop constraint if exists assistant_memories_company_id_user_id_scope_category_memory_key,
  drop constraint if exists assistant_memories_lifecycle_v1_check,
  drop constraint if exists assistant_memories_provenance_v1_check,
  drop constraint if exists assistant_memories_scope_check,
  drop constraint if exists assistant_memories_source_v1_check,
  drop constraint if exists assistant_memories_status_v1_check,
  drop constraint if exists assistant_memories_type_v1_check,
  drop constraint if exists assistant_memories_user_scope_v1_check;

alter table public.assistant_memory_events
  drop constraint if exists assistant_memory_events_event_type_check,
  drop constraint if exists assistant_memory_events_from_status_check,
  drop constraint if exists assistant_memory_events_memory_type_check,
  drop constraint if exists assistant_memory_events_to_status_check,
  drop constraint if exists assistant_memory_events_user_scope_check;

-- Preserve the five V1 QA records as explicit legacy lifecycle rows. New V2 writes
-- cannot create candidates or rejected rows.
update public.assistant_memories
set scope = 'user_global',
    provenance = case source
      when 'explicit_user_command' then 'user_explicit'
      else 'legacy_candidate_v1'
    end,
    normalized_fact = coalesce(nullif(btrim(value), ''), memory_key),
    approval_mode = 'legacy_v1'
where status is not null
  and scope = 'user';

update public.assistant_memory_events
set memory_scope = coalesce(memory_scope, 'user_global'),
    provenance = coalesce(provenance, 'legacy_candidate_v1')
where memory_scope is null
   or provenance is null;

alter table public.assistant_memories
  add constraint assistant_memories_scope_v2_check
    check (scope in ('user_global', 'company')),
  add constraint assistant_memories_status_v2_check
    check (status is null or status in ('candidate', 'approved', 'rejected')),
  add constraint assistant_memories_source_v2_check
    check (
      status is null
      or source in (
        'explicit_user_command', 'assistant_proposal',
        'user_explicit', 'assistant_inferred', 'company_explicit'
      )
    ),
  add constraint assistant_memories_type_v2_check
    check (
      memory_type is null
      or memory_type in (
        'name', 'preferred_address', 'language', 'response_style',
        'response_brevity', 'durable_work_preference',
        'explanation_level', 'preferred_format', 'confirmed_role',
        'source_preference', 'durable_work_rule',
        'company_rule', 'company_terminology', 'company_process_preference'
      )
    ),
  add constraint assistant_memories_provenance_v2_check
    check (
      status is null
      or (
        source_message_id is not null
        and created_by is not null
        and memory_type is not null
        and provenance in (
          'user_explicit', 'assistant_inferred',
          'company_explicit', 'legacy_candidate_v1'
        )
        and approval_mode in (
          'direct_user_explicit', 'model_inferred',
          'company_authorized', 'legacy_v1'
        )
        and nullif(btrim(normalized_fact), '') is not null
      )
    ),
  add constraint assistant_memories_lifecycle_v2_check
    check (
      status is null
      or (
        approval_mode = 'legacy_v1'
        and (
          (status = 'candidate' and not active and approved_by is null
            and approved_at is null and rejected_at is null)
          or (status = 'approved' and active and approved_by is not null
            and approved_at is not null and rejected_at is null)
          or (status = 'rejected' and not active and approved_by is null
            and approved_at is null and rejected_at is not null)
        )
      )
      or (
        status = 'approved'
        and active
        and approved_at is not null
        and rejected_at is null
        and (
          (provenance = 'assistant_inferred' and approved_by is null
            and approval_mode = 'model_inferred')
          or (provenance = 'user_explicit' and approved_by is not null
            and approval_mode = 'direct_user_explicit')
          or (provenance = 'company_explicit' and approved_by is not null
            and approval_mode = 'company_authorized')
        )
      )
    ),
  add constraint assistant_memories_inferred_allowlist_v2_check
    check (
      provenance is distinct from 'assistant_inferred'
      or (
        scope = 'user_global'
        and status = 'approved'
        and active
        and confidence >= 0.850
        and memory_type in (
          'name', 'preferred_address', 'language', 'response_style',
          'response_brevity', 'durable_work_preference'
        )
      )
    ),
  add constraint assistant_memories_company_scope_v2_check
    check (
      scope <> 'company'
      or (
        provenance = 'company_explicit'
        and memory_type in (
          'company_rule', 'company_terminology', 'company_process_preference'
        )
      )
    );

alter table public.assistant_memory_events
  add constraint assistant_memory_events_event_type_v2_check
    check (event_type in (
      'candidate_created', 'memory_approved', 'memory_rejected',
      'memory_created', 'memory_updated', 'memory_deleted'
    )),
  add constraint assistant_memory_events_from_status_v2_check
    check (from_status is null or from_status in ('candidate', 'approved', 'rejected')),
  add constraint assistant_memory_events_to_status_v2_check
    check (to_status is null or to_status in ('candidate', 'approved', 'rejected')),
  add constraint assistant_memory_events_memory_type_v2_check
    check (memory_type in (
      'name', 'preferred_address', 'language', 'response_style',
      'response_brevity', 'durable_work_preference',
      'explanation_level', 'preferred_format', 'confirmed_role',
      'source_preference', 'durable_work_rule',
      'company_rule', 'company_terminology', 'company_process_preference'
    )),
  add constraint assistant_memory_events_scope_v2_check
    check (memory_scope in ('user_global', 'company')),
  add constraint assistant_memory_events_provenance_v2_check
    check (provenance in (
      'user_explicit', 'assistant_inferred',
      'company_explicit', 'legacy_candidate_v1'
    ));

drop index if exists public.assistant_memories_user_retrieval_v1_idx;
drop index if exists public.assistant_memories_user_global_active_v2_uidx;
drop index if exists public.assistant_memories_company_active_v2_uidx;

create unique index assistant_memories_user_global_active_v2_uidx
  on public.assistant_memories (user_id, memory_type, lower(memory_key))
  where scope = 'user_global' and status = 'approved' and active;

create unique index assistant_memories_company_active_v2_uidx
  on public.assistant_memories (company_id, memory_type, lower(memory_key))
  where scope = 'company' and status = 'approved' and active;

create index if not exists assistant_memories_user_global_retrieval_v2_idx
  on public.assistant_memories (user_id, status, expires_at, updated_at desc)
  where scope = 'user_global' and status = 'approved' and active;

create index if not exists assistant_memories_company_retrieval_v2_idx
  on public.assistant_memories (company_id, status, expires_at, updated_at desc)
  where scope = 'company' and status = 'approved' and active;

create or replace function private.enforce_assistant_memory_lifecycle_v2()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid;
  v_role text;
  v_is_owner boolean;
  v_company_admin boolean;
begin
  if v_actor is null then
    raise exception 'assistant memory requires an authenticated user'
      using errcode = '42501';
  end if;

  select p.company_id, p.role, coalesce(p.is_owner, false)
  into v_company, v_role, v_is_owner
  from public.profiles p
  where p.id = v_actor and p.status = 'active';

  if v_company is null then
    raise exception 'assistant memory requires an active company profile'
      using errcode = '42501';
  end if;

  v_company_admin := v_is_owner or v_role in ('global_admin', 'company_admin', 'director');

  if tg_op = 'INSERT' then
    if new.user_id is not null and new.user_id <> v_actor then
      raise exception 'assistant memory user spoofing denied' using errcode = '42501';
    end if;
    if new.company_id is not null and new.company_id <> v_company then
      raise exception 'assistant memory company spoofing denied' using errcode = '42501';
    end if;
    if new.created_by is not null and new.created_by <> v_actor then
      raise exception 'assistant memory creator spoofing denied' using errcode = '42501';
    end if;
    if new.scope not in ('user_global', 'company') then
      raise exception 'assistant memory scope is not approved' using errcode = '23514';
    end if;
    if new.status is distinct from 'approved' then
      raise exception 'V2 memory must be inserted directly as approved'
        using errcode = '42501';
    end if;
    if new.scope = 'company' and not v_company_admin then
      raise exception 'company memory requires an authorized company role'
        using errcode = '42501';
    end if;
    if new.scope = 'user_global'
      and new.provenance not in ('user_explicit', 'assistant_inferred') then
      raise exception 'user-global memory provenance is not approved'
        using errcode = '23514';
    end if;
    if new.scope = 'company' and new.provenance is distinct from 'company_explicit' then
      raise exception 'company memory must be explicit'
        using errcode = '23514';
    end if;
    if new.scope = 'user_global' and new.memory_type not in (
      'name', 'preferred_address', 'language', 'response_style',
      'response_brevity', 'durable_work_preference'
    ) then
      raise exception 'user-global memory type is not approved'
        using errcode = '23514';
    end if;
    if new.scope = 'company' and new.memory_type not in (
      'company_rule', 'company_terminology', 'company_process_preference'
    ) then
      raise exception 'company memory type is not approved'
        using errcode = '23514';
    end if;
    if new.provenance = 'assistant_inferred' and new.confidence < 0.850 then
      raise exception 'assistant-inferred memory confidence is below 0.850'
        using errcode = '23514';
    end if;
    if new.source_message_id is null or not exists (
      select 1
      from public.chat_messages m
      join public.chats c on c.id = m.chat_id
      where m.id = new.source_message_id
        and c.user_id = v_actor
        and (new.scope = 'user_global' or c.company_id = v_company)
    ) then
      raise exception 'assistant memory source message is not owned by the current user'
        using errcode = '42501';
    end if;

    new.user_id := v_actor;
    new.company_id := v_company;
    new.created_by := v_actor;
    new.source := new.provenance;
    new.normalized_fact := coalesce(nullif(btrim(new.normalized_fact), ''), btrim(new.value));
    new.status := 'approved';
    new.active := true;
    new.approved_at := now();
    new.rejected_at := null;
    new.updated_at := now();

    if new.provenance = 'assistant_inferred' then
      new.approved_by := null;
      new.approval_mode := 'model_inferred';
    elsif new.provenance = 'company_explicit' then
      new.confidence := 1.000;
      new.approved_by := v_actor;
      new.approval_mode := 'company_authorized';
    else
      new.confidence := 1.000;
      new.approved_by := v_actor;
      new.approval_mode := 'direct_user_explicit';
    end if;

    return new;
  end if;

  if old.scope = 'user_global' then
    if old.user_id <> v_actor then
      raise exception 'foreign user-global memory mutation denied' using errcode = '42501';
    end if;
  elsif old.scope = 'company' then
    if old.company_id <> v_company or not v_company_admin then
      raise exception 'foreign or unauthorized company memory mutation denied'
        using errcode = '42501';
    end if;
  else
    raise exception 'legacy memory mutation is not allowed' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if old.approval_mode = 'legacy_v1' then
    raise exception 'legacy V1 memory is delete-only' using errcode = '42501';
  end if;

  if new.company_id is distinct from old.company_id
    or new.user_id is distinct from old.user_id
    or new.scope is distinct from old.scope
    or new.category is distinct from old.category
    or new.memory_type is distinct from old.memory_type
    or new.memory_key is distinct from old.memory_key
    or new.source is distinct from old.source
    or new.provenance is distinct from old.provenance
    or new.source_message_id is distinct from old.source_message_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.status is distinct from 'approved'
    or not new.active then
    raise exception 'assistant memory identity and provenance are immutable'
      using errcode = '42501';
  end if;

  if new.provenance = 'assistant_inferred' and new.confidence < 0.850 then
    raise exception 'assistant-inferred memory confidence is below 0.850'
      using errcode = '23514';
  end if;

  new.normalized_fact := coalesce(nullif(btrim(new.normalized_fact), ''), btrim(new.value));
  new.updated_at := now();
  new.approved_at := old.approved_at;
  new.approved_by := old.approved_by;
  new.approval_mode := old.approval_mode;
  new.rejected_at := null;
  return new;
end
$$;

create or replace function private.audit_assistant_memory_lifecycle_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.assistant_memories;
begin
  if v_actor is null then
    raise exception 'assistant memory audit requires an authenticated user'
      using errcode = '42501';
  end if;

  v_row := case when tg_op = 'DELETE' then old else new end;

  insert into public.assistant_memory_events (
    memory_id, company_id, user_id, actor_user_id, source_message_id,
    event_type, from_status, to_status, memory_type,
    memory_scope, provenance, metadata
  ) values (
    v_row.id, v_row.company_id, v_row.user_id, v_actor, v_row.source_message_id,
    case tg_op
      when 'INSERT' then 'memory_created'
      when 'UPDATE' then 'memory_updated'
      else 'memory_deleted'
    end,
    case when tg_op = 'INSERT' then null else old.status end,
    case when tg_op = 'DELETE' then null else new.status end,
    v_row.memory_type, v_row.scope, v_row.provenance,
    jsonb_build_object('approval_mode', v_row.approval_mode)
  );

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop function if exists private.enforce_assistant_memory_lifecycle_v1();
drop function if exists private.audit_assistant_memory_lifecycle_v1();

create trigger assistant_memories_lifecycle_v2_trigger
before insert or update or delete on public.assistant_memories
for each row execute function private.enforce_assistant_memory_lifecycle_v2();

create trigger assistant_memories_audit_v2_trigger
after insert or update or delete on public.assistant_memories
for each row execute function private.audit_assistant_memory_lifecycle_v2();

drop policy if exists assistant_memories_select_own_v1 on public.assistant_memories;
drop policy if exists assistant_memories_insert_candidate_own_v1 on public.assistant_memories;
drop policy if exists assistant_memories_transition_candidate_own_v1 on public.assistant_memories;
drop policy if exists assistant_memories_delete_own_v1 on public.assistant_memories;
drop policy if exists assistant_memory_events_select_own_v1 on public.assistant_memory_events;

create policy assistant_memories_select_v2
on public.assistant_memories for select to authenticated
using (
  (scope = 'user_global' and user_id = (select auth.uid()))
  or (scope = 'company' and company_id = (select public.get_my_company_id()))
);

create policy assistant_memories_insert_user_global_v2
on public.assistant_memories for insert to authenticated
with check (
  scope = 'user_global'
  and user_id = (select auth.uid())
  and created_by = (select auth.uid())
  and company_id = (select public.get_my_company_id())
  and status = 'approved'
  and provenance in ('user_explicit', 'assistant_inferred')
);

create policy assistant_memories_update_user_global_v2
on public.assistant_memories for update to authenticated
using (scope = 'user_global' and user_id = (select auth.uid()))
with check (scope = 'user_global' and user_id = (select auth.uid()));

create policy assistant_memories_delete_user_global_v2
on public.assistant_memories for delete to authenticated
using (scope = 'user_global' and user_id = (select auth.uid()));

create policy assistant_memories_insert_company_v2
on public.assistant_memories for insert to authenticated
with check (
  scope = 'company'
  and company_id = (select public.get_my_company_id())
  and created_by = (select auth.uid())
  and status = 'approved'
  and provenance = 'company_explicit'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.company_id = assistant_memories.company_id
      and p.status = 'active'
      and (coalesce(p.is_owner, false) or p.role in ('global_admin', 'company_admin', 'director'))
  )
);

create policy assistant_memories_update_company_v2
on public.assistant_memories for update to authenticated
using (
  scope = 'company'
  and company_id = (select public.get_my_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.company_id = assistant_memories.company_id
      and p.status = 'active'
      and (coalesce(p.is_owner, false) or p.role in ('global_admin', 'company_admin', 'director'))
  )
)
with check (
  scope = 'company'
  and company_id = (select public.get_my_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.company_id = assistant_memories.company_id
      and p.status = 'active'
      and (coalesce(p.is_owner, false) or p.role in ('global_admin', 'company_admin', 'director'))
  )
);

create policy assistant_memories_delete_company_v2
on public.assistant_memories for delete to authenticated
using (
  scope = 'company'
  and company_id = (select public.get_my_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.company_id = assistant_memories.company_id
      and p.status = 'active'
      and (coalesce(p.is_owner, false) or p.role in ('global_admin', 'company_admin', 'director'))
  )
);

create policy assistant_memory_events_select_v2
on public.assistant_memory_events for select to authenticated
using (
  (memory_scope = 'user_global' and user_id = (select auth.uid()))
  or (memory_scope = 'company' and company_id = (select public.get_my_company_id()))
);

revoke all on table public.assistant_memories from anon, authenticated;
grant select, insert, update, delete on table public.assistant_memories to authenticated;

revoke all on table public.assistant_memory_events from anon, authenticated;
grant select on table public.assistant_memory_events to authenticated;

revoke all on function private.enforce_assistant_memory_lifecycle_v2() from public;
revoke all on function private.audit_assistant_memory_lifecycle_v2() from public;

comment on column public.assistant_memories.provenance is
  'Contract 0.4 provenance: user_explicit, assistant_inferred, company_explicit, or legacy_candidate_v1.';
comment on column public.assistant_memories.normalized_fact is
  'Short normalized fact used for safe long-term retrieval; never stores secrets or live ERP state.';
comment on column public.assistant_memories.approval_mode is
  'Direct user command, safe model inference, authorized company command, or legacy V1 lifecycle.';

commit;
