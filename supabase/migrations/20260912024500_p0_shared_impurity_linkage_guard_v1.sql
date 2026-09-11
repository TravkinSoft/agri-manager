begin;

-- Corrective guard for environments where the shared-impurity foundation was
-- already applied.  A shared ticket is deliberately isolated from correction,
-- request and processing flows because those links change stock availability
-- semantics.  Clearing a malformed link remains possible; finalizing one does
-- not.
do $preconditions$
begin
  if pg_catalog.to_regclass('public.tickets') is null
     or pg_catalog.to_regclass('public.weighbridge_shared_impurity_groups') is null
     or (
       select pg_catalog.count(*)
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'tickets'
         and column_name in (
           'correction_of_ticket_id',
           'linked_request_id',
           'linked_processing_id',
           'processing_output_role'
         )
     ) <> 4
  then
    raise exception 'SHARED_IMPURITY_LINKAGE_GUARD_PREREQUISITE_MISSING'
      using errcode = '55000';
  end if;
end
$preconditions$;

create or replace function private.reject_shared_impurity_ticket_correction_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.correction_of_ticket_id is not null
     and exists (
       select 1
       from public.weighbridge_shared_impurity_groups pool
       where pool.ticket_id = new.correction_of_ticket_id
     )
     and (
       tg_op = 'INSERT'
       or (
         tg_op = 'UPDATE'
         and (
           new.correction_of_ticket_id is distinct from old.correction_of_ticket_id
           or (
             new.status::text = 'finalized'
             and old.status::text is distinct from 'finalized'
           )
           or (
             coalesce(new.is_finalized, false)
             and not coalesce(old.is_finalized, false)
           )
         )
       )
     )
  then
    raise exception 'SHARED_IMPURITY_CORRECTION_REQUIRES_VOID_NEW|%',
      new.correction_of_ticket_id
      using errcode = '23514';
  end if;

  if exists (
       select 1
       from public.weighbridge_shared_impurity_groups pool
       where pool.ticket_id = new.id
     )
     and (
       (
         tg_op = 'INSERT'
         and (
           new.correction_of_ticket_id is not null
           or new.linked_request_id is not null
           or new.linked_processing_id is not null
           or new.processing_output_role is not null
         )
       )
       or (
         tg_op = 'UPDATE'
         and (
           (new.correction_of_ticket_id is not null
             and new.correction_of_ticket_id is distinct from old.correction_of_ticket_id)
           or (new.linked_request_id is not null
             and new.linked_request_id is distinct from old.linked_request_id)
           or (new.linked_processing_id is not null
             and new.linked_processing_id is distinct from old.linked_processing_id)
           or (new.processing_output_role is not null
             and new.processing_output_role is distinct from old.processing_output_role)
         )
       )
     )
  then
    raise exception 'SHARED_IMPURITY_TICKET_LINKAGE_FORBIDDEN|%', new.id
      using errcode = '23514';
  end if;
  return new;
end
$function$;

revoke all on function private.reject_shared_impurity_ticket_correction_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists reject_shared_impurity_ticket_correction_v1 on public.tickets;
create trigger reject_shared_impurity_ticket_correction_v1
before insert or update of correction_of_ticket_id, linked_request_id,
  linked_processing_id, processing_output_role, status, is_finalized
  on public.tickets
for each row execute function private.reject_shared_impurity_ticket_correction_v1();

create or replace function private.assert_shared_impurity_group_ticket_linkage_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT'
     or (
       tg_op = 'UPDATE'
       and new.state = 'finalized'
       and old.state is distinct from new.state
     )
  then
    if not exists (
      select 1
      from public.tickets ticket
      where ticket.id = new.ticket_id
        and ticket.company_id = new.company_id
    ) then
      raise exception 'SHARED_IMPURITY_TICKET_SCOPE_CHANGED'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.tickets ticket
      where ticket.id = new.ticket_id
        and (
          ticket.correction_of_ticket_id is not null
          or ticket.linked_request_id is not null
          or ticket.linked_processing_id is not null
          or ticket.processing_output_role is not null
        )
    ) then
      raise exception 'SHARED_IMPURITY_TICKET_LINKAGE_FORBIDDEN|%', new.ticket_id
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$function$;

revoke all on function private.assert_shared_impurity_group_ticket_linkage_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists assert_shared_impurity_group_ticket_linkage_v1
  on public.weighbridge_shared_impurity_groups;
create trigger assert_shared_impurity_group_ticket_linkage_v1
before insert or update of state on public.weighbridge_shared_impurity_groups
for each row execute function private.assert_shared_impurity_group_ticket_linkage_v1();

create or replace function private.enforce_shared_impurity_lifecycle_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket_id uuid;
  v_ticket_finalized boolean;
  v_ticket_voided boolean;
  v_ticket_terminal boolean;
  v_pool_state text;
begin
  if tg_table_name = 'tickets' then
    v_ticket_id := new.id;
  else
    v_ticket_id := new.ticket_id;
  end if;

  select
    (
      not coalesce(ticket.is_voided, false)
      and coalesce(ticket.is_finalized, false)
      and ticket.status::text = 'finalized'
    ),
    (
      coalesce(ticket.is_voided, false)
      and ticket.status::text = 'voided'
    ),
    (
      coalesce(ticket.is_finalized, false)
      or coalesce(ticket.is_voided, false)
      or ticket.status::text in ('finalized', 'voided')
    ),
    pool.state
  into v_ticket_finalized, v_ticket_voided, v_ticket_terminal, v_pool_state
  from public.tickets ticket
  join public.weighbridge_shared_impurity_groups pool
    on pool.ticket_id = ticket.id
  where ticket.id = v_ticket_id;

  if not found then
    return new;
  end if;

  if (v_pool_state = 'finalized') is distinct from v_ticket_finalized
     or (v_pool_state = 'voided') is distinct from v_ticket_voided
     or (
       v_pool_state = 'open'
       and v_ticket_terminal
     )
  then
    raise exception 'SHARED_IMPURITY_LIFECYCLE_MISMATCH|%|%|%',
      v_ticket_id, v_pool_state,
      case
        when v_ticket_voided then 'voided'
        when v_ticket_finalized then 'finalized'
        else 'open'
      end
      using errcode = '23514';
  end if;

  return new;
end
$function$;

revoke all on function private.enforce_shared_impurity_lifecycle_v1()
  from public, anon, authenticated, service_role;

do $existing_rows$
begin
  if exists (
    select 1
    from public.weighbridge_shared_impurity_groups pool
    join public.tickets ticket on ticket.id = pool.ticket_id
    where (
      (pool.state = 'finalized') is distinct from (
        not coalesce(ticket.is_voided, false)
        and coalesce(ticket.is_finalized, false)
        and ticket.status::text = 'finalized'
      )
      or (pool.state = 'voided') is distinct from (
        coalesce(ticket.is_voided, false)
        and ticket.status::text = 'voided'
      )
      or (
        pool.state = 'open'
        and (
          coalesce(ticket.is_voided, false)
          or coalesce(ticket.is_finalized, false)
          or ticket.status::text in ('finalized', 'voided')
        )
      )
    )
  ) then
    raise exception 'SHARED_IMPURITY_EXISTING_LIFECYCLE_MISMATCH'
      using errcode = '23514';
  end if;
end
$existing_rows$;

drop trigger if exists enforce_shared_impurity_ticket_lifecycle_v1
  on public.tickets;
create constraint trigger enforce_shared_impurity_ticket_lifecycle_v1
after insert or update of status, is_finalized, is_voided on public.tickets
deferrable initially deferred
for each row execute function private.enforce_shared_impurity_lifecycle_v1();

drop trigger if exists enforce_shared_impurity_group_lifecycle_v1
  on public.weighbridge_shared_impurity_groups;
create constraint trigger enforce_shared_impurity_group_lifecycle_v1
after insert or update of state on public.weighbridge_shared_impurity_groups
deferrable initially deferred
for each row execute function private.enforce_shared_impurity_lifecycle_v1();

do $postconditions$
begin
  if pg_catalog.to_regprocedure(
       'private.reject_shared_impurity_ticket_correction_v1()'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.assert_shared_impurity_group_ticket_linkage_v1()'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.enforce_shared_impurity_lifecycle_v1()'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.tickets'::pg_catalog.regclass
         and trigger_row.tgname = 'reject_shared_impurity_ticket_correction_v1'
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.tickets'::pg_catalog.regclass
         and trigger_row.tgname = 'enforce_shared_impurity_ticket_lifecycle_v1'
         and trigger_row.tgdeferrable
         and trigger_row.tginitdeferred
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'public.weighbridge_shared_impurity_groups'::pg_catalog.regclass
         and trigger_row.tgname = 'enforce_shared_impurity_group_lifecycle_v1'
         and trigger_row.tgdeferrable
         and trigger_row.tginitdeferred
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'public.weighbridge_shared_impurity_groups'::pg_catalog.regclass
         and trigger_row.tgname = 'assert_shared_impurity_group_ticket_linkage_v1'
         and not trigger_row.tgisinternal
     )
  then
    raise exception 'SHARED_IMPURITY_LINKAGE_GUARD_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;
end
$postconditions$;

commit;
