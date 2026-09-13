-- Ordinary weighbridge ticket creation used to span four independent HTTP
-- writes. Keep the complete ticket skeleton in one database transaction and
-- make the server-issued idempotency key mandatory at this boundary.
create or replace function public.create_weighbridge_ticket_atomic_v1(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_ticket jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_weighings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.tickets%rowtype;
  v_ticket public.tickets%rowtype;
  v_line public.ticket_lines%rowtype;
  v_weighing public.ticket_weighings%rowtype;
  v_item jsonb;
  v_ticket_json jsonb;
  v_machine_id uuid;
  v_vehicle_exists boolean := false;
  v_trailer_id uuid;
  v_updated integer := 0;
begin
  if p_company_id is null or p_actor_user_id is null or p_idempotency_key is null then
    raise exception 'WEIGHBRIDGE_CREATE_REQUIRED_IDENTITY';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), '') is null then
    raise exception 'WEIGHBRIDGE_CREATE_REQUIRED_FINGERPRINT';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_ticket, '{}'::jsonb)) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_weighings, '[]'::jsonb)) <> 'array' then
    raise exception 'WEIGHBRIDGE_CREATE_INVALID_PAYLOAD';
  end if;

  -- Serialize replays before looking up the key. Two concurrent requests with
  -- the same key can never create two tickets.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('weighbridge-create:' || p_idempotency_key::text, 0)
  );
  select * into v_existing
  from public.tickets
  where id = p_idempotency_key
  for update;
  if found then
    if v_existing.company_id is distinct from p_company_id
       or coalesce(v_existing.audit_json->>'request_fingerprint', '') <> p_request_fingerprint then
      raise exception 'WEIGHBRIDGE_IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'ticket_id', v_existing.id,
      'idempotent_replay', true
    );
  end if;

  if coalesce(p_ticket->>'company_id', '') <> p_company_id::text
     or coalesce(p_ticket->>'created_by', '') <> p_actor_user_id::text then
    raise exception 'WEIGHBRIDGE_CREATE_SCOPE_MISMATCH';
  end if;

  v_ticket_json := pg_catalog.jsonb_build_object(
      'id', p_idempotency_key,
      'company_id', p_company_id,
      'created_by', p_actor_user_id,
      'status', 'active',
      'weigh_method', 'double_weighing',
      'is_finalized', false,
      'is_voided', false,
      'stored_tare_used', false,
      'requires_review', false,
      'created_at', pg_catalog.clock_timestamp(),
      'updated_at', pg_catalog.clock_timestamp()
    )
    || p_ticket
    || pg_catalog.jsonb_build_object(
      'id', p_idempotency_key,
      'company_id', p_company_id,
      'created_by', p_actor_user_id,
      'status', 'active',
      'is_finalized', false,
      'is_voided', false,
      'audit_json', coalesce(p_ticket->'audit_json', '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'idempotency_key', p_idempotency_key,
          'request_fingerprint', p_request_fingerprint
        )
    );
  v_ticket := pg_catalog.jsonb_populate_record(null::public.tickets, v_ticket_json);

  if nullif(pg_catalog.btrim(coalesce(v_ticket.ticket_no, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(v_ticket.ticket_type, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(v_ticket.op_type, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(v_ticket.source_kind, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(v_ticket.destination_kind, '')), '') is null then
    raise exception 'WEIGHBRIDGE_CREATE_REQUIRED_FIELDS';
  end if;

  if v_ticket.vehicle_id is not null then
    select rv.source_machine_id into v_machine_id
    from public.reference_vehicles rv
    where rv.company_id = p_company_id
      and rv.id = v_ticket.vehicle_id
      and rv.is_active
      and not coalesce(rv.archived, false);
    v_vehicle_exists := found;

    if not v_vehicle_exists then
      select rm.id into v_machine_id
      from public.reference_machines rm
      where rm.company_id = p_company_id
        and rm.id = v_ticket.vehicle_id
        and rm.is_active
        and not coalesce(rm.archived, false);
      v_vehicle_exists := found;
    end if;
    if not v_vehicle_exists then
      raise exception 'WEIGHBRIDGE_CREATE_VEHICLE_UNAVAILABLE';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'weighbridge-vehicle:' || p_company_id::text || ':' || coalesce(v_machine_id, v_ticket.vehicle_id)::text,
        0
      )
    );
    if exists (
      select 1
      from public.tickets active_ticket
      where active_ticket.company_id = p_company_id
        and active_ticket.status::text in ('draft', 'active', 'ready_to_close')
        and not active_ticket.is_voided
        and (
          active_ticket.vehicle_id = v_ticket.vehicle_id
          or (v_machine_id is not null and active_ticket.vehicle_id = v_machine_id)
          or (v_machine_id is not null and exists (
            select 1 from public.reference_vehicles alias_vehicle
            where alias_vehicle.id = active_ticket.vehicle_id
              and alias_vehicle.company_id = p_company_id
              and alias_vehicle.source_machine_id = v_machine_id
          ))
        )
    ) then
      raise exception 'WEIGHBRIDGE_CREATE_VEHICLE_BUSY';
    end if;
  end if;

  if v_ticket.driver_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'weighbridge-driver:' || p_company_id::text || ':' || v_ticket.driver_id::text,
        0
      )
    );
    if exists (
      select 1 from public.tickets active_ticket
      where active_ticket.company_id = p_company_id
        and active_ticket.driver_id = v_ticket.driver_id
        and active_ticket.status::text in ('draft', 'active', 'ready_to_close')
        and not active_ticket.is_voided
    ) then
      raise exception 'WEIGHBRIDGE_CREATE_DRIVER_BUSY';
    end if;
  end if;

  begin
    v_trailer_id := nullif(v_ticket.audit_json->'transport'->>'trailer_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'WEIGHBRIDGE_CREATE_TRAILER_INVALID';
  end;
  if v_trailer_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'weighbridge-trailer:' || p_company_id::text || ':' || v_trailer_id::text,
        0
      )
    );
    if exists (
      select 1 from public.tickets active_ticket
      where active_ticket.company_id = p_company_id
        and active_ticket.status::text in ('draft', 'active', 'ready_to_close')
        and not active_ticket.is_voided
        and active_ticket.audit_json->'transport'->>'trailer_id' = v_trailer_id::text
    ) then
      raise exception 'WEIGHBRIDGE_CREATE_TRAILER_BUSY';
    end if;
  end if;

  insert into public.tickets select v_ticket.*;

  for v_item in select value from pg_catalog.jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception 'WEIGHBRIDGE_CREATE_LINE_INVALID';
    end if;
    v_line := pg_catalog.jsonb_populate_record(
      null::public.ticket_lines,
      pg_catalog.jsonb_build_object(
        'id', pg_catalog.gen_random_uuid(),
        'ticket_id', p_idempotency_key,
        'company_id', p_company_id,
        'uom', 'kg',
        'composition_snapshot', '[]'::jsonb,
        'is_mixed_harvest', false,
        'created_at', pg_catalog.clock_timestamp(),
        'updated_at', pg_catalog.clock_timestamp()
      ) || v_item || pg_catalog.jsonb_build_object(
        'ticket_id', p_idempotency_key,
        'company_id', p_company_id
      )
    );
    insert into public.ticket_lines select v_line.*;
  end loop;

  for v_item in select value from pg_catalog.jsonb_array_elements(coalesce(p_weighings, '[]'::jsonb))
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception 'WEIGHBRIDGE_CREATE_WEIGHING_INVALID';
    end if;
    v_weighing := pg_catalog.jsonb_populate_record(
      null::public.ticket_weighings,
      pg_catalog.jsonb_build_object(
        'id', pg_catalog.gen_random_uuid(),
        'ticket_id', p_idempotency_key,
        'company_id', p_company_id,
        'measured_at', pg_catalog.clock_timestamp(),
        'device_source', 'manual'
      ) || v_item || pg_catalog.jsonb_build_object(
        'ticket_id', p_idempotency_key,
        'company_id', p_company_id
      )
    );
    insert into public.ticket_weighings select v_weighing.*;
  end loop;

  if v_ticket.vehicle_id is not null then
    update public.reference_vehicles rv
    set status = 'in_trip'
    where rv.company_id = p_company_id
      and (
        rv.id = v_ticket.vehicle_id
        or (v_machine_id is not null and rv.source_machine_id = v_machine_id)
      );
    get diagnostics v_updated = row_count;
    if v_updated = 0 and v_machine_id is null then
      raise exception 'WEIGHBRIDGE_CREATE_VEHICLE_STATUS_NOT_UPDATED';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'ticket_id', p_idempotency_key,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_weighbridge_ticket_atomic_v1(uuid,uuid,uuid,text,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_weighbridge_ticket_atomic_v1(uuid,uuid,uuid,text,jsonb,jsonb,jsonb)
  to service_role;

comment on function public.create_weighbridge_ticket_atomic_v1(uuid,uuid,uuid,text,jsonb,jsonb,jsonb)
is 'Atomically creates an ordinary weighbridge ticket, details, weighings and vehicle busy state.';

-- The storno procedure and release of the same physical vehicle must commit or
-- fail together. This wrapper preserves the existing authenticated contract.
create or replace function public.void_weighbridge_ticket_for_session_v1(
  p_ticket_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_ticket public.tickets%rowtype;
  v_machine_id uuid;
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_ticket.vehicle_id is not null then
    select rv.source_machine_id into v_machine_id
    from public.reference_vehicles rv
    where rv.company_id = v_ticket.company_id and rv.id = v_ticket.vehicle_id;
    if not found and exists (
      select 1 from public.reference_machines rm
      where rm.company_id = v_ticket.company_id and rm.id = v_ticket.vehicle_id
    ) then
      v_machine_id := v_ticket.vehicle_id;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'weighbridge-vehicle:' || v_ticket.company_id::text || ':' || coalesce(v_machine_id, v_ticket.vehicle_id)::text,
        0
      )
    );
  end if;

  perform public.void_ticket_with_storno_v2(p_ticket_id, v_auth_user_id, p_reason);

  if v_ticket.vehicle_id is not null and not exists (
    select 1
    from public.tickets active_ticket
    where active_ticket.company_id = v_ticket.company_id
      and active_ticket.id <> p_ticket_id
      and active_ticket.status::text in ('draft', 'active', 'ready_to_close')
      and not active_ticket.is_voided
      and (
        active_ticket.vehicle_id = v_ticket.vehicle_id
        or (v_machine_id is not null and active_ticket.vehicle_id = v_machine_id)
        or (v_machine_id is not null and exists (
          select 1 from public.reference_vehicles alias_vehicle
          where alias_vehicle.id = active_ticket.vehicle_id
            and alias_vehicle.company_id = v_ticket.company_id
            and alias_vehicle.source_machine_id = v_machine_id
        ))
      )
  ) then
    update public.reference_vehicles rv
    set status = 'free'
    where rv.company_id = v_ticket.company_id
      and (
        rv.id = v_ticket.vehicle_id
        or (v_machine_id is not null and rv.source_machine_id = v_machine_id)
      );

    if exists (
      select 1 from public.reference_vehicles rv
      where rv.company_id = v_ticket.company_id
        and (
          rv.id = v_ticket.vehicle_id
          or (v_machine_id is not null and rv.source_machine_id = v_machine_id)
        )
        and coalesce(rv.status, '') <> 'free'
    ) then
      raise exception 'WEIGHBRIDGE_VOID_VEHICLE_RELEASE_FAILED';
    end if;
  end if;

  return p_ticket_id;
end;
$$;

revoke all on function public.void_weighbridge_ticket_for_session_v1(uuid, text)
  from public, anon;
grant execute on function public.void_weighbridge_ticket_for_session_v1(uuid, text)
  to authenticated, service_role;

comment on function public.void_weighbridge_ticket_for_session_v1(uuid, text)
is 'Voids a ticket and releases its physical vehicle atomically when no other open ticket uses it.';
