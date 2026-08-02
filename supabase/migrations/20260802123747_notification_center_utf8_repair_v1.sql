-- Restore canonical UTF-8 literals in notification trigger functions.
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
