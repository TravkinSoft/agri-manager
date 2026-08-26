alter table public.user_notification_preferences
  add column if not exists weighbridge_updates_enabled boolean not null default true,
  add column if not exists proactive_assist_enabled boolean not null default true,
  add column if not exists proactive_assist_cadence text not null default 'events',
  add column if not exists last_proactive_assist_audit_at timestamptz;

alter table public.user_notifications
  drop constraint if exists user_notifications_category_check;
alter table public.user_notifications
  add constraint user_notifications_category_check
  check (category in ('operation', 'warehouse', 'weighbridge', 'assistant', 'system'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_notification_preferences_assist_cadence_check'
      and conrelid = 'public.user_notification_preferences'::regclass
  ) then
    alter table public.user_notification_preferences
      add constraint user_notification_preferences_assist_cadence_check
      check (proactive_assist_cadence in ('events', 'twice_daily', 'daily', 'every_3_days', 'weekly'));
  end if;
end;
$$;

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
      when p_category = 'warehouse'
        then coalesce(preference.warehouse_updates_enabled, true)
      when p_category = 'weighbridge'
        then coalesce(preference.weighbridge_updates_enabled, true)
      when p_category = 'assistant'
        then coalesce(preference.proactive_assist_enabled, true)
      else true
    end
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke all on function private.enqueue_user_notification_v1(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, text, jsonb
) from public, anon, authenticated;

create or replace function private.weighbridge_ticket_notification_context_v1(p_ticket_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'ticket_id', ticket.id,
    'ticket_no', ticket.ticket_no,
    'company_id', ticket.company_id,
    'status', ticket.status::text,
    'operation_type', ticket.op_type,
    'field_id', ticket.field_id,
    'field_name', nullif(field.name, ''),
    'crop_name', coalesce(nullif(line.product_name_snapshot, ''), nullif(product.trade_name, ''), nullif(product.name, '')),
    'variety_name', nullif(line.variety_name_snapshot, ''),
    'reproduction_name', nullif(line.reproduction_name_snapshot, ''),
    'vehicle_id', ticket.vehicle_id,
    'vehicle_name', coalesce(
      nullif(ticket.audit_json #>> '{transport,vehicle_label}', ''),
      nullif(vehicle.custom_name, ''),
      nullif(vehicle.full_name, ''),
      nullif(vehicle.name, ''),
      nullif(machine.full_name, ''),
      nullif(machine.name, '')
    ),
    'vehicle_plate', case
      when coalesce(vehicle.license_plate, vehicle.plate_number, machine.license_plate, '') ~* '^(OSV[-_ ]?ROW|IMPORT|SOURCE[-_ ]?ROW|SRC[-_ ]?ROW|ROW[-_ ]?[0-9]+)'
        then null
      else nullif(coalesce(vehicle.license_plate, vehicle.plate_number, machine.license_plate), '')
    end,
    'driver_name', nullif(driver.full_name, ''),
    'operator_name', coalesce(nullif(finalizer.full_name, ''), nullif(opener.full_name, '')),
    'source_name', nullif(source_warehouse.name, ''),
    'destination_name', nullif(destination_warehouse.name, ''),
    'gross_weight_kg', ticket.gross_weight_kg,
    'tare_weight_kg', ticket.tare_weight_kg,
    'physical_net_kg', coalesce(ticket.physical_net_kg, ticket.net_weight_kg),
    'accepted_weight_kg', coalesce(ticket.accepted_weight_kg, ticket.net_weight_kg),
    'explicit_deductions_kg', ticket.explicit_deductions_kg,
    'moisture_percent', line.moisture_percent,
    'requires_review', ticket.requires_review,
    'review_reason', ticket.review_reason,
    'correction_of_ticket_id', ticket.correction_of_ticket_id,
    'replacement_ticket_id', ticket.replacement_ticket_id,
    'processing_id', ticket.linked_processing_id,
    'processing_output_role', ticket.processing_output_role,
    'created_at', ticket.created_at,
    'finalized_at', ticket.finalized_at,
    'voided_at', ticket.voided_at
  ))
  from public.tickets ticket
  left join public.fields field on field.id = ticket.field_id and field.company_id = ticket.company_id
  left join lateral (
    select ticket_line.*
    from public.ticket_lines ticket_line
    where ticket_line.ticket_id = ticket.id
      and ticket_line.company_id = ticket.company_id
    order by ticket_line.created_at, ticket_line.id
    limit 1
  ) line on true
  left join public.products product on product.id = line.product_id
  left join public.reference_vehicles vehicle on vehicle.id = ticket.vehicle_id and vehicle.company_id = ticket.company_id
  left join public.reference_machines machine on machine.id = ticket.vehicle_id and machine.company_id = ticket.company_id
  left join public.company_people driver on driver.id = ticket.driver_id and driver.company_id = ticket.company_id
  left join public.company_people opener on opener.id = ticket.created_by_person_id and opener.company_id = ticket.company_id
  left join public.company_people finalizer on finalizer.id = ticket.finalized_by_person_id and finalizer.company_id = ticket.company_id
  left join public.warehouses source_warehouse on source_warehouse.id = ticket.warehouse_from_id and source_warehouse.company_id = ticket.company_id
  left join public.warehouses destination_warehouse on destination_warehouse.id = ticket.warehouse_to_id and destination_warehouse.company_id = ticket.company_id
  where ticket.id = p_ticket_id;
$$;

revoke all on function private.weighbridge_ticket_notification_context_v1(uuid)
  from public, anon, authenticated;

create or replace function private.weighbridge_ticket_notification_body_v1(p_context jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select concat_ws(
    ' · ',
    nullif(p_context ->> 'field_name', ''),
    nullif(p_context ->> 'crop_name', ''),
    nullif(concat_ws(' ', nullif(p_context ->> 'vehicle_name', ''), nullif(p_context ->> 'vehicle_plate', '')), ''),
    case
      when coalesce(nullif(p_context ->> 'accepted_weight_kg', ''), nullif(p_context ->> 'physical_net_kg', ''), nullif(p_context ->> 'gross_weight_kg', '')) is not null
        then coalesce(nullif(p_context ->> 'accepted_weight_kg', ''), nullif(p_context ->> 'physical_net_kg', ''), nullif(p_context ->> 'gross_weight_kg', '')) || ' кг'
      else null
    end,
    case when nullif(p_context ->> 'moisture_percent', '') is not null then 'Влажность ' || (p_context ->> 'moisture_percent') || '%' else null end,
    case when nullif(p_context ->> 'created_at', '') is not null then to_char((p_context ->> 'created_at')::timestamptz at time zone 'Asia/Almaty', 'DD.MM.YYYY HH24:MI') else null end,
    case p_context ->> 'status'
      when 'active' then 'Открыт'
      when 'ready_to_close' then 'Готов к закрытию'
      when 'finalized' then 'Завершён'
      when 'voided' then 'Аннулирован'
      else nullif(p_context ->> 'status', '')
    end
  );
$$;

revoke all on function private.weighbridge_ticket_notification_body_v1(jsonb)
  from public, anon, authenticated;

create or replace function private.emit_ticket_line_notification_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_recipient uuid;
  v_event_type text;
  v_title text;
begin
  v_context := private.weighbridge_ticket_notification_context_v1(new.ticket_id);
  if v_context is null then
    return new;
  end if;

  if nullif(v_context ->> 'correction_of_ticket_id', '') is not null then
    v_event_type := 'ticket_correction_started';
    v_title := 'Талон отправлен на исправление';
  else
    v_event_type := 'ticket_created';
    v_title := 'Новый рейс на весовой';
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
      private.weighbridge_ticket_notification_body_v1(v_context),
      '/weighbridge?ticket=' || new.ticket_id::text,
      'ticket',
      new.ticket_id,
      concat('ticket:', new.ticket_id, ':', v_event_type, ':', v_recipient),
      v_context
    );
  end loop;

  return new;
end;
$$;

revoke all on function private.emit_ticket_line_notification_v2()
  from public, anon, authenticated;

drop trigger if exists emit_ticket_line_notification_v2 on public.ticket_lines;
create trigger emit_ticket_line_notification_v2
after insert on public.ticket_lines
for each row execute function private.emit_ticket_line_notification_v2();

create or replace function private.emit_ticket_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_recipient uuid;
  v_event_type text;
  v_title text;
begin
  if new.is_finalized and not coalesce(old.is_finalized, false) then
    if new.correction_of_ticket_id is not null then
      v_event_type := 'ticket_correction_finalized';
      v_title := 'Исправление талона завершено';
    else
      v_event_type := 'ticket_finalized';
      v_title := 'Рейс принят';
    end if;
  elsif new.status::text = 'voided' and old.status::text is distinct from 'voided' then
    v_event_type := 'ticket_voided';
    v_title := 'Весовой талон аннулирован';
  else
    return new;
  end if;

  v_context := private.weighbridge_ticket_notification_context_v1(new.id);

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
      private.weighbridge_ticket_notification_body_v1(v_context),
      '/weighbridge?ticket=' || new.id::text,
      'ticket',
      new.id,
      concat('ticket:', new.id, ':', v_event_type, ':', v_recipient),
      v_context
    );

    if new.is_finalized and coalesce(new.requires_review, false) then
      perform private.enqueue_user_notification_v1(
        new.company_id,
        v_recipient,
        v_actor,
        'assistant',
        'ticket_review_required',
        'Рейс требует внимания',
        concat_ws(' · ', private.weighbridge_ticket_notification_body_v1(v_context), nullif(new.review_reason, '')),
        '/weighbridge?ticket=' || new.id::text,
        'ticket',
        new.id,
        concat('ticket:', new.id, ':review-required:', v_recipient),
        v_context || jsonb_build_object('signal', 'requires_review')
      );
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function private.emit_ticket_notifications_v1()
  from public, anon, authenticated;

create or replace function private.cleanup_deleted_ticket_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.user_notifications
  where company_id = old.company_id
    and entity_type = 'ticket'
    and entity_id = old.id;
  return old;
end;
$$;

revoke all on function private.cleanup_deleted_ticket_notifications_v1()
  from public, anon, authenticated;

drop trigger if exists cleanup_deleted_ticket_notifications_v1 on public.tickets;
create trigger cleanup_deleted_ticket_notifications_v1
after delete on public.tickets
for each row execute function private.cleanup_deleted_ticket_notifications_v1();

create or replace function private.emit_harvest_completion_notification_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.closed_by);
  v_recipient uuid;
  v_field_name text;
  v_crop_name text;
  v_destination_name text;
  v_body text;
begin
  if new.status is distinct from 'completed' or old.status is not distinct from 'completed' then
    return new;
  end if;

  select field.name,
         coalesce(nullif(crop.name_ru, ''), nullif(crop.name, '')),
         warehouse.name
  into v_field_name, v_crop_name, v_destination_name
  from public.weighbridge_active_harvests route
  left join public.fields field on field.id = route.field_id and field.company_id = route.company_id
  left join public.crop_structure structure on structure.id = route.crop_structure_id and structure.company_id = route.company_id
  left join public.crops crop on crop.id = structure.crop_id
  left join public.warehouses warehouse on warehouse.id = route.warehouse_id and warehouse.company_id = route.company_id
  where route.id = new.id;

  v_body := concat_ws(
    ' · ',
    nullif(v_field_name, ''),
    nullif(v_crop_name, ''),
    nullif(v_destination_name, ''),
    to_char(coalesce(new.closed_at, now()) at time zone 'Asia/Almaty', 'DD.MM.YYYY HH24:MI')
  );

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
      'assistant',
      'harvest_field_completed',
      'Уборка поля завершена',
      v_body,
      '/crop-structure?field=' || new.field_id::text,
      'weighbridge_active_harvest',
      new.id,
      concat('harvest-route:', new.id, ':completed:', v_recipient),
      jsonb_build_object(
        'field_id', new.field_id,
        'field_name', v_field_name,
        'crop_structure_id', new.crop_structure_id,
        'crop_name', v_crop_name,
        'warehouse_id', new.warehouse_id,
        'warehouse_name', v_destination_name,
        'closed_at', new.closed_at
      )
    );
  end loop;

  return new;
end;
$$;

revoke all on function private.emit_harvest_completion_notification_v1()
  from public, anon, authenticated;

drop trigger if exists emit_harvest_completion_notification_v1 on public.weighbridge_active_harvests;
create trigger emit_harvest_completion_notification_v1
after update of status on public.weighbridge_active_harvests
for each row execute function private.emit_harvest_completion_notification_v1();

create or replace function public.run_my_proactive_assist_audit_v1(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_preference record;
  v_interval interval;
  v_since timestamptz;
  v_context jsonb;
  v_ticket record;
  v_trip_count integer := 0;
  v_field_count integer := 0;
  v_total_kg numeric := 0;
  v_average_moisture numeric := null;
  v_bucket text;
  v_created integer := 0;
begin
  if v_user_id is null or p_company_id is null then
    raise exception 'Authenticated company context is required';
  end if;

  select id, company_id, lower(role) as role, status
  into v_profile
  from public.profiles
  where id = v_user_id;

  if not found or v_profile.status is distinct from 'active' then
    raise exception 'Active profile is required';
  end if;
  if v_profile.role not in ('agronomist', 'global_admin') then
    raise exception 'Proactive Assist is not available for current role';
  end if;
  if v_profile.role <> 'global_admin' and v_profile.company_id is distinct from p_company_id then
    raise exception 'Company context mismatch';
  end if;

  insert into public.user_notification_preferences (profile_id, company_id)
  values (v_user_id, p_company_id)
  on conflict (profile_id, company_id) do nothing;

  select proactive_assist_enabled, proactive_assist_cadence, last_proactive_assist_audit_at
  into v_preference
  from public.user_notification_preferences
  where profile_id = v_user_id
    and company_id = p_company_id;

  if not coalesce(v_preference.proactive_assist_enabled, true) then
    return 0;
  end if;

  v_interval := case coalesce(v_preference.proactive_assist_cadence, 'events')
    when 'twice_daily' then interval '12 hours'
    when 'daily' then interval '24 hours'
    when 'every_3_days' then interval '72 hours'
    when 'weekly' then interval '7 days'
    else interval '30 minutes'
  end;

  if v_preference.last_proactive_assist_audit_at is not null
     and v_preference.last_proactive_assist_audit_at + v_interval > now() then
    return 0;
  end if;
  v_since := coalesce(v_preference.last_proactive_assist_audit_at, now() - v_interval);

  for v_ticket in
    select id
    from public.tickets
    where company_id = p_company_id
      and status::text in ('draft', 'active', 'ready_to_close')
      and not coalesce(is_voided, false)
      and created_at < now() - interval '6 hours'
    order by created_at
    limit 20
  loop
    v_context := private.weighbridge_ticket_notification_context_v1(v_ticket.id);
    if not exists (
      select 1 from public.user_notifications
      where idempotency_key = concat('assist:stale-ticket:', v_ticket.id, ':', v_user_id)
    ) then
      perform private.enqueue_user_notification_v1(
        p_company_id,
        v_user_id,
        null,
        'assistant',
        'assist_stale_ticket',
        'Талон долго остаётся открытым',
        private.weighbridge_ticket_notification_body_v1(v_context),
        '/weighbridge?ticket=' || v_ticket.id::text,
        'ticket',
        v_ticket.id,
        concat('assist:stale-ticket:', v_ticket.id, ':', v_user_id),
        v_context || jsonb_build_object('signal', 'open_over_6h')
      );
      v_created := v_created + 1;
    end if;
  end loop;

  for v_ticket in
    select id
    from public.tickets
    where company_id = p_company_id
      and coalesce(requires_review, false)
      and not coalesce(is_voided, false)
    order by updated_at desc
    limit 20
  loop
    v_context := private.weighbridge_ticket_notification_context_v1(v_ticket.id);
    if not exists (
      select 1 from public.user_notifications
      where idempotency_key = concat('assist:ticket-review:', v_ticket.id, ':', v_user_id)
    ) then
      perform private.enqueue_user_notification_v1(
        p_company_id,
        v_user_id,
        null,
        'assistant',
        'assist_ticket_review',
        'Нужно проверить данные рейса',
        concat_ws(' · ', private.weighbridge_ticket_notification_body_v1(v_context), nullif(v_context ->> 'review_reason', '')),
        '/weighbridge?ticket=' || v_ticket.id::text,
        'ticket',
        v_ticket.id,
        concat('assist:ticket-review:', v_ticket.id, ':', v_user_id),
        v_context || jsonb_build_object('signal', 'requires_review')
      );
      v_created := v_created + 1;
    end if;
  end loop;

  if coalesce(v_preference.proactive_assist_cadence, 'events') <> 'events' then
    select
      count(distinct ticket.id)::integer,
      count(distinct ticket.field_id)::integer,
      coalesce(sum(coalesce(ticket.accepted_weight_kg, ticket.net_weight_kg)), 0),
      round(avg(line.moisture_percent)::numeric, 1)
    into v_trip_count, v_field_count, v_total_kg, v_average_moisture
    from public.tickets ticket
    left join lateral (
      select ticket_line.moisture_percent
      from public.ticket_lines ticket_line
      where ticket_line.ticket_id = ticket.id
      order by ticket_line.created_at, ticket_line.id
      limit 1
    ) line on true
    where ticket.company_id = p_company_id
      and ticket.op_type = 'harvest_incoming'
      and ticket.status::text = 'finalized'
      and coalesce(ticket.is_finalized, false)
      and not coalesce(ticket.is_voided, false)
      and ticket.finalized_at >= v_since;

    if v_trip_count > 0 then
      v_bucket := case coalesce(v_preference.proactive_assist_cadence, 'events')
        when 'twice_daily' then to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM-DD') || ':' || case when extract(hour from now() at time zone 'Asia/Almaty') < 12 then 'am' else 'pm' end
        when 'daily' then to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM-DD')
        when 'every_3_days' then floor(extract(epoch from now()) / 259200)::text
        when 'weekly' then to_char(date_trunc('week', now() at time zone 'Asia/Almaty'), 'YYYY-MM-DD')
        else to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM-DD-HH24')
      end;

      if not exists (
        select 1 from public.user_notifications
        where idempotency_key = concat('assist:harvest-summary:', p_company_id, ':', v_user_id, ':', v_bucket)
      ) then
        perform private.enqueue_user_notification_v1(
          p_company_id,
          v_user_id,
          null,
          'assistant',
          'assist_harvest_summary',
          'Сводка уборки',
          concat_ws(
            ' · ',
            v_trip_count::text || ' рейсов',
            trim(to_char(v_total_kg, 'FM999999999990D999')) || ' кг',
            v_field_count::text || ' полей',
            case when v_average_moisture is not null then 'Средняя влажность ' || v_average_moisture::text || '%' else null end
          ),
          '/weighbridge',
          'company',
          p_company_id,
          concat('assist:harvest-summary:', p_company_id, ':', v_user_id, ':', v_bucket),
          jsonb_build_object(
            'signal', 'harvest_summary',
            'since', v_since,
            'trips', v_trip_count,
            'fields', v_field_count,
            'net_kg', v_total_kg,
            'average_moisture_percent', v_average_moisture
          )
        );
        v_created := v_created + 1;
      end if;
    end if;
  end if;

  update public.user_notification_preferences
  set last_proactive_assist_audit_at = now(),
      updated_at = now()
  where profile_id = v_user_id
    and company_id = p_company_id;

  return v_created;
end;
$$;

revoke all on function public.run_my_proactive_assist_audit_v1(uuid)
  from public, anon;
grant execute on function public.run_my_proactive_assist_audit_v1(uuid)
  to authenticated;
