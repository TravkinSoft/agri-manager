-- In-app notification center V1. Notifications are emitted by committed
-- operational changes and are readable only by their exact recipient.
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  category text not null check (category in ('operation', 'warehouse', 'weighbridge', 'system')),
  event_type text not null,
  title text not null,
  body text,
  href text not null check (left(href, 1) = '/'),
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_notifications_recipient_created_idx
  on public.user_notifications (recipient_user_id, created_at desc);
create index if not exists user_notifications_recipient_unread_idx
  on public.user_notifications (recipient_user_id, company_id, created_at desc)
  where read_at is null;
create index if not exists user_notifications_entity_idx
  on public.user_notifications (entity_type, entity_id);

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own
on public.user_notifications
for select
to authenticated
using ((select auth.uid()) = recipient_user_id);

drop policy if exists user_notifications_update_read_own on public.user_notifications;
create policy user_notifications_update_read_own
on public.user_notifications
for update
to authenticated
using ((select auth.uid()) = recipient_user_id)
with check ((select auth.uid()) = recipient_user_id);

revoke all on table public.user_notifications from public, anon, authenticated;
grant select on table public.user_notifications to authenticated;
grant update (read_at) on table public.user_notifications to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.enqueue_user_notification_v1(
  p_company_id uuid,
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_category text,
  p_event_type text,
  p_title text,
  p_body text,
  p_href text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_recipient_user_id is null
     or p_recipient_user_id = p_actor_user_id
     or p_company_id is null then
    return;
  end if;

  insert into public.user_notifications (
    company_id,
    recipient_user_id,
    actor_user_id,
    category,
    event_type,
    title,
    body,
    href,
    entity_type,
    entity_id,
    idempotency_key,
    metadata
  )
  select
    p_company_id,
    p_recipient_user_id,
    p_actor_user_id,
    p_category,
    p_event_type,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  from public.profiles profile
  left join public.user_notification_preferences preference
    on preference.profile_id = profile.id
   and preference.company_id = p_company_id
  where profile.id = p_recipient_user_id
    and profile.company_id = p_company_id
    and profile.status = 'active'
    and case
      when p_category = 'operation'
        then coalesce(preference.operation_updates_enabled, true)
      when p_category in ('warehouse', 'weighbridge')
        then coalesce(preference.warehouse_updates_enabled, true)
      else true
    end
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke all on function private.enqueue_user_notification_v1(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, text, jsonb
) from public, anon, authenticated;

create or replace function private.emit_operation_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_recipient uuid;
  v_status text;
  v_old_status text;
  v_title text;
  v_href text;
begin
  if tg_op = 'INSERT' then
    v_recipient := coalesce(new.assigned_to, new.responsible_user_id);
    if v_recipient is not null then
      perform private.enqueue_user_notification_v1(
        new.company_id,
        v_recipient,
        v_actor,
        'operation',
        'operation_assigned',
        'Назначена новая операция',
        concat_ws(' · ', new.operation_type, new.date::text),
        '/tasks?operation=' || new.id::text,
        'operation',
        new.id,
        concat('operation:', new.id, ':assigned:', v_recipient),
        jsonb_build_object('status', coalesce(new.operation_status, new.work_status, new.status))
      );
    end if;

    if new.operation_category_slug = 'harvesting' then
      for v_recipient in
        select profile.id
        from public.profiles profile
        where profile.company_id = new.company_id
          and profile.status = 'active'
          and lower(profile.role) = 'weighman'
      loop
        perform private.enqueue_user_notification_v1(
          new.company_id,
          v_recipient,
          v_actor,
          'weighbridge',
          'harvest_operation_available',
          'Уборочная операция доступна',
          concat_ws(' · ', new.operation_type, new.date::text),
          '/weighbridge?operation=' || new.id::text,
          'operation',
          new.id,
          concat('operation:', new.id, ':weighbridge:', v_recipient),
          '{}'::jsonb
        );
      end loop;
    end if;

    return new;
  end if;

  if coalesce(new.assigned_to, new.responsible_user_id) is distinct from
     coalesce(old.assigned_to, old.responsible_user_id) then
    v_recipient := coalesce(new.assigned_to, new.responsible_user_id);
    if v_recipient is not null then
      perform private.enqueue_user_notification_v1(
        new.company_id,
        v_recipient,
        v_actor,
        'operation',
        'operation_assigned',
        'Вам назначена операция',
        concat_ws(' · ', new.operation_type, new.date::text),
        '/tasks?operation=' || new.id::text,
        'operation',
        new.id,
        concat('operation:', new.id, ':assigned:', v_recipient, ':', extract(epoch from new.updated_at)),
        '{}'::jsonb
      );
    end if;
  end if;

  v_status := coalesce(new.operation_status, new.specialist_task_status, new.work_status, new.status, 'planned');
  v_old_status := coalesce(old.operation_status, old.specialist_task_status, old.work_status, old.status, 'planned');

  if v_status is distinct from v_old_status then
    v_title := case v_status
      when 'planned' then 'Операция запланирована'
      when 'accepted' then 'Операция принята'
      when 'in_progress' then 'Операция начата'
      when 'paused' then 'Операция приостановлена'
      when 'awaiting_approval' then 'Требуется подтверждение операции'
      when 'ready_to_close' then 'Операция готова к закрытию'
      when 'completed' then 'Операция завершена'
      when 'cancelled' then 'Операция отменена'
      else 'Статус операции изменён'
    end;

    for v_recipient in
      select distinct recipient_id
      from unnest(array[new.user_id, new.assigned_to, new.responsible_user_id]) as recipient_id
      where recipient_id is not null
    loop
      select case when lower(coalesce(profile.role, '')) = 'specialist'
        then '/tasks?operation=' || new.id::text
        else '/operations?operation=' || new.id::text
      end
      into v_href
      from public.profiles profile
      where profile.id = v_recipient;

      perform private.enqueue_user_notification_v1(
        new.company_id,
        v_recipient,
        v_actor,
        'operation',
        'operation_status_changed',
        v_title,
        concat_ws(' · ', new.operation_type, 'Статус: ' || v_status),
        coalesce(v_href, '/operations?operation=' || new.id::text),
        'operation',
        new.id,
        concat('operation:', new.id, ':status:', v_status, ':', extract(epoch from new.updated_at), ':', v_recipient),
        jsonb_build_object('status', v_status, 'previous_status', v_old_status)
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function private.emit_operation_notifications_v1() from public, anon, authenticated;

drop trigger if exists emit_operation_notifications_v1 on public.operations;
create trigger emit_operation_notifications_v1
after insert or update of operation_status, specialist_task_status, work_status, status, assigned_to, responsible_user_id
on public.operations
for each row execute function private.emit_operation_notifications_v1();

create or replace function private.emit_warehouse_request_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_recipient uuid;
  v_status text;
  v_old_status text;
  v_title text;
begin
  if tg_op = 'INSERT' then
    for v_recipient in
      select profile.id
      from public.profiles profile
      where profile.company_id = new.company_id
        and profile.status = 'active'
        and lower(profile.role) = 'warehouse'
    loop
      perform private.enqueue_user_notification_v1(
        new.company_id,
        v_recipient,
        v_actor,
        'warehouse',
        'warehouse_request_created',
        'Новая заявка на склад',
        'Заявка ' || new.request_number,
        '/warehouses/requests?request=' || new.id::text,
        'warehouse_request',
        new.id,
        concat('warehouse-request:', new.id, ':created:', v_recipient),
        '{}'::jsonb
      );
    end loop;
    return new;
  end if;

  v_status := coalesce(new.warehouse_request_status, new.status);
  v_old_status := coalesce(old.warehouse_request_status, old.status);
  if v_status is not distinct from v_old_status then
    return new;
  end if;

  v_title := case v_status
    when 'ready_for_pickup' then 'Материалы готовы к выдаче'
    when 'picked_up_by_specialist' then 'Материалы выданы'
    when 'return_expected' then 'Ожидается возврат материалов'
    when 'return_received' then 'Возврат принят складом'
    when 'closed' then 'Складская заявка закрыта'
    when 'cancelled' then 'Складская заявка отменена'
    else 'Статус складской заявки изменён'
  end;

  for v_recipient in
    select distinct recipient_id
    from unnest(array[new.recipient_user_id, new.assigned_specialist_id]) as recipient_id
    where recipient_id is not null
  loop
    perform private.enqueue_user_notification_v1(
      new.company_id,
      v_recipient,
      v_actor,
      'warehouse',
      'warehouse_request_status_changed',
      v_title,
      concat('Заявка ', new.request_number, ' · ', v_status),
      '/tasks?request=' || new.id::text,
      'warehouse_request',
      new.id,
      concat('warehouse-request:', new.id, ':status:', v_status, ':', extract(epoch from new.updated_at), ':', v_recipient),
      jsonb_build_object('status', v_status, 'previous_status', v_old_status)
    );
  end loop;

  if v_status = 'return_expected' then
    for v_recipient in
      select profile.id
      from public.profiles profile
      where profile.company_id = new.company_id
        and profile.status = 'active'
        and lower(profile.role) = 'warehouse'
    loop
      perform private.enqueue_user_notification_v1(
        new.company_id,
        v_recipient,
        v_actor,
        'warehouse',
        'warehouse_return_expected',
        v_title,
        'Заявка ' || new.request_number,
        '/warehouses/requests?request=' || new.id::text,
        'warehouse_request',
        new.id,
        concat('warehouse-request:', new.id, ':return-expected:', v_recipient),
        '{}'::jsonb
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function private.emit_warehouse_request_notifications_v1() from public, anon, authenticated;

drop trigger if exists emit_warehouse_request_notifications_v1 on public.warehouse_issue_requests;
create trigger emit_warehouse_request_notifications_v1
after insert or update of warehouse_request_status, status
on public.warehouse_issue_requests
for each row execute function private.emit_warehouse_request_notifications_v1();

create or replace function private.emit_ticket_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_recipient uuid;
  v_event_type text;
  v_title text;
begin
  if new.is_finalized and not coalesce(old.is_finalized, false) then
    v_event_type := 'ticket_finalized';
    v_title := 'Весовой талон завершён';
  elsif new.status::text = 'voided' and old.status::text is distinct from 'voided' then
    v_event_type := 'ticket_voided';
    v_title := 'Весовой талон аннулирован';
  else
    return new;
  end if;

  for v_recipient in
    select profile.id
    from public.profiles profile
    where profile.company_id = new.company_id
      and profile.status = 'active'
      and lower(profile.role) in ('agronomist', 'company_admin')
  loop
    perform private.enqueue_user_notification_v1(
      new.company_id,
      v_recipient,
      v_actor,
      'weighbridge',
      v_event_type,
      v_title,
      concat('Талон ', new.ticket_no, case when new.net_weight_kg is not null then ' · ' || new.net_weight_kg::text || ' кг' else '' end),
      '/weighbridge?ticket=' || new.id::text,
      'ticket',
      new.id,
      concat('ticket:', new.id, ':', v_event_type, ':', v_recipient),
      jsonb_build_object('status', new.status::text, 'net_weight_kg', new.net_weight_kg)
    );
  end loop;

  return new;
end;
$$;

revoke all on function private.emit_ticket_notifications_v1() from public, anon, authenticated;

drop trigger if exists emit_ticket_notifications_v1 on public.tickets;
create trigger emit_ticket_notifications_v1
after update of is_finalized, status
on public.tickets
for each row execute function private.emit_ticket_notifications_v1();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end
$$;
