alter table public.tickets
  add column if not exists correction_of_ticket_id uuid references public.tickets(id) on delete restrict,
  add column if not exists replacement_ticket_id uuid references public.tickets(id) on delete restrict,
  add column if not exists correction_reason text,
  add column if not exists correction_started_at timestamptz,
  add column if not exists correction_completed_at timestamptz;

alter table public.tickets
  drop constraint if exists tickets_correction_not_self_v1;
alter table public.tickets
  add constraint tickets_correction_not_self_v1 check (
    id is distinct from correction_of_ticket_id
    and id is distinct from replacement_ticket_id
  ) not valid;

create unique index if not exists tickets_one_active_correction_v1
  on public.tickets (correction_of_ticket_id)
  where correction_of_ticket_id is not null and coalesce(is_voided, false) = false;
create index if not exists tickets_replacement_ticket_idx_v1
  on public.tickets (replacement_ticket_id)
  where replacement_ticket_id is not null;

create or replace function private.assert_weighbridge_ticket_correction_actor_v1(
  p_company_id uuid,
  p_operator_person_id uuid default null,
  p_shift_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authenticated session is required';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and coalesce(p.status, 'active') = 'active';

  if not found or v_actor.role not in (
    'global_admin', 'admin', 'company_admin', 'director',
    'weighman', 'weighbridge_operator'
  ) then
    raise exception 'Actor role is not allowed to correct weighbridge tickets';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;

  if v_actor.role in ('weighman', 'weighbridge_operator') and not exists (
    select 1
    from public.weighbridge_shifts s
    where s.id = p_shift_id
      and s.company_id = p_company_id
      and s.status = 'open'
      and s.operator_person_id = p_operator_person_id
  ) then
    raise exception 'Active weighbridge operator shift is required';
  end if;

  return v_actor;
end;
$function$;

create or replace function private.weighbridge_ticket_has_downstream_dependencies_v1(
  p_ticket_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  with source_batches as (
    select ib.id, ib.batch_code
    from public.inventory_batches ib
    where ib.source_ticket_id = p_ticket_id
  )
  select
    exists (
      select 1
      from public.batch_transformation_inputs bti
      join source_batches sb on sb.id = bti.batch_id
    )
    or exists (
      select 1
      from public.stock_ledger_entries sle
      where coalesce(sle.is_storno, false) = false
        and sle.ticket_id is distinct from p_ticket_id
        and (
          sle.inventory_batch_id in (select id from source_batches)
          or sle.batch_id_text in (select id::text from source_batches)
          or sle.batch_id_text in (select batch_code from source_batches)
        )
    )
    or exists (
      select 1
      from public.ticket_lines tl
      join public.tickets t on t.id = tl.ticket_id
      where tl.ticket_id <> p_ticket_id
        and coalesce(t.is_voided, false) = false
        and (
          tl.batch_id in (select id::text from source_batches)
          or tl.batch_id in (select batch_code from source_batches)
          or tl.lot_id in (select id::text from source_batches)
          or tl.lot_id in (select batch_code from source_batches)
        )
    );
$function$;

create or replace function public.update_open_weighbridge_ticket_v1(
  p_ticket_id uuid,
  p_patch jsonb,
  p_tare_variance_confirmed boolean default false,
  p_operator_person_id uuid default null,
  p_shift_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_before jsonb;
  v_gross numeric;
  v_tare numeric;
  v_net numeric;
  v_previous_tare numeric;
  v_difference_percent numeric;
  v_status text;
begin
  select t.* into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;
  if not found then raise exception 'Ticket not found'; end if;

  v_actor := private.assert_weighbridge_ticket_correction_actor_v1(
    v_ticket.company_id, p_operator_person_id, p_shift_id
  );
  if v_ticket.is_finalized or v_ticket.is_voided or v_ticket.status::text in ('finalized', 'voided') then
    raise exception 'Finalized/voided ticket is read-only';
  end if;

  if p_patch ? 'gross_weight_kg' and coalesce(p_patch ->> 'gross_weight_kg', '') !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$' then
    raise exception 'Брутто указывается только числом в килограммах.';
  end if;
  if p_patch ? 'tare_weight_kg' and coalesce(p_patch ->> 'tare_weight_kg', '') !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$' then
    raise exception 'Тара указывается только числом в килограммах.';
  end if;

  v_gross := case when p_patch ? 'gross_weight_kg' then (p_patch ->> 'gross_weight_kg')::numeric else v_ticket.gross_weight_kg end;
  v_tare := case when p_patch ? 'tare_weight_kg' then (p_patch ->> 'tare_weight_kg')::numeric else v_ticket.tare_weight_kg end;
  if v_gross is null or v_gross <= 0 then raise exception 'Брутто должно быть больше нуля.'; end if;
  if v_tare is not null and v_tare <= 0 then raise exception 'Тара должна быть больше нуля.'; end if;
  if v_tare is not null and v_tare >= v_gross then raise exception 'Тара должна быть меньше брутто.'; end if;
  v_net := case when v_tare is null then null else v_gross - v_tare end;
  if v_net is not null and v_net <= 0 then raise exception 'Нетто должно быть больше нуля.'; end if;

  if p_patch ? 'tare_weight_kg' and v_ticket.vehicle_id is not null then
    select t.tare_weight_kg into v_previous_tare
    from public.tickets t
    where t.company_id = v_ticket.company_id
      and t.vehicle_id = v_ticket.vehicle_id
      and t.id <> v_ticket.id
      and t.status::text = 'finalized'
      and coalesce(t.is_finalized, false) = true
      and coalesce(t.is_voided, false) = false
      and t.tare_weight_kg > 0
    order by t.finalized_at desc nulls last, t.updated_at desc
    limit 1;

    if v_previous_tare is not null then
      v_difference_percent := round(((v_tare - v_previous_tare) / v_previous_tare) * 100, 2);
      if abs(v_difference_percent) >= 20 and not p_tare_variance_confirmed then
        return jsonb_build_object(
          'ok', false,
          'requires_confirmation', true,
          'code', 'tare_variance_confirmation_required',
          'previous_tare_kg', v_previous_tare,
          'current_tare_kg', v_tare,
          'difference_percent', v_difference_percent
        );
      end if;
    end if;
  end if;

  v_before := jsonb_build_object(
    'gross_weight_kg', v_ticket.gross_weight_kg,
    'tare_weight_kg', v_ticket.tare_weight_kg,
    'net_weight_kg', v_ticket.net_weight_kg,
    'notes', v_ticket.notes,
    'status', v_ticket.status
  );
  v_status := coalesce(nullif(trim(p_patch ->> 'status'), ''), v_ticket.status::text);
  if v_status not in ('draft', 'active', 'ready_to_close') then
    raise exception 'Invalid status for open ticket update';
  end if;

  update public.tickets
  set gross_weight_kg = v_gross,
      tare_weight_kg = v_tare,
      net_weight_kg = v_net,
      notes = case when p_patch ? 'notes' then nullif(trim(p_patch ->> 'notes'), '') else notes end,
      status = v_status::public.ticket_status,
      manual_correction_reason = case
        when nullif(trim(coalesce(p_reason, '')), '') is not null then trim(p_reason)
        else manual_correction_reason
      end,
      audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'last_weight_edit', jsonb_build_object(
          'at', now(), 'actor_user_id', v_actor.id, 'operator_person_id', p_operator_person_id,
          'shift_id', p_shift_id, 'tare_variance_confirmed', coalesce(p_tare_variance_confirmed, false),
          'tare_difference_percent', v_difference_percent
        )
      ),
      updated_at = now()
  where id = p_ticket_id;

  if v_tare is not null and (
    select count(*) from public.ticket_lines tl where tl.ticket_id = p_ticket_id
  ) = 1 then
    update public.ticket_lines
    set quantity = v_net, mass_kg = v_net, net_line_weight_kg = v_net
    where ticket_id = p_ticket_id;
  end if;

  insert into public.ticket_weighings (
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id, weighbridge_shift_id, comment
  ) values (
    p_ticket_id, v_ticket.company_id, 1, v_gross, now(), 'manual',
    v_actor.id, p_operator_person_id, p_shift_id, 'Исправлено в открытом талоне'
  ) on conflict (ticket_id, weighing_no) do update set
    measured_weight_kg = excluded.measured_weight_kg,
    measured_at = excluded.measured_at,
    device_source = excluded.device_source,
    operator_user_id = excluded.operator_user_id,
    operator_person_id = excluded.operator_person_id,
    weighbridge_shift_id = excluded.weighbridge_shift_id,
    comment = excluded.comment;

  if v_tare is not null then
    insert into public.ticket_weighings (
      ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
      device_source, operator_user_id, operator_person_id, weighbridge_shift_id, comment
    ) values (
      p_ticket_id, v_ticket.company_id, 2, v_tare, now(), 'manual',
      v_actor.id, p_operator_person_id, p_shift_id,
      case when coalesce(p_tare_variance_confirmed, false) then 'Необычная тара подтверждена оператором' else 'Исправлено в открытом талоне' end
    ) on conflict (ticket_id, weighing_no) do update set
      measured_weight_kg = excluded.measured_weight_kg,
      measured_at = excluded.measured_at,
      device_source = excluded.device_source,
      operator_user_id = excluded.operator_user_id,
      operator_person_id = excluded.operator_person_id,
      weighbridge_shift_id = excluded.weighbridge_shift_id,
      comment = excluded.comment;
  end if;

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_ticket.company_id, v_actor.id, 'weighbridge_ticket', p_ticket_id::text,
    'open_ticket_corrected', v_before,
    jsonb_build_object(
      'gross_weight_kg', v_gross, 'tare_weight_kg', v_tare, 'net_weight_kg', v_net,
      'operator_person_id', p_operator_person_id, 'shift_id', p_shift_id,
      'tare_variance_confirmed', coalesce(p_tare_variance_confirmed, false),
      'tare_difference_percent', v_difference_percent
    ), nullif(trim(coalesce(p_reason, '')), '')
  );

  return jsonb_build_object(
    'ok', true,
    'ticket_id', p_ticket_id,
    'tare_variance_confirmed', coalesce(p_tare_variance_confirmed, false),
    'difference_percent', v_difference_percent
  );
end;
$function$;

create or replace function public.start_weighbridge_ticket_correction_v1(
  p_ticket_id uuid,
  p_reason text,
  p_operator_person_id uuid default null,
  p_shift_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor public.profiles%rowtype;
  v_old public.tickets%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_new_no text;
  v_existing_id uuid;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Причина исправления обязательна.';
  end if;
  select t.* into v_old from public.tickets t where t.id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  v_actor := private.assert_weighbridge_ticket_correction_actor_v1(v_old.company_id, p_operator_person_id, p_shift_id);
  if not v_old.is_finalized or v_old.is_voided or v_old.status::text <> 'finalized' then
    raise exception 'Исправить можно только действующий завершённый талон.';
  end if;
  if private.weighbridge_ticket_has_downstream_dependencies_v1(p_ticket_id) then
    raise exception 'Этот приход уже использован в последующих движениях. Простое исправление невозможно.';
  end if;

  select t.id into v_existing_id
  from public.tickets t
  where t.correction_of_ticket_id = p_ticket_id
    and coalesce(t.is_voided, false) = false
  order by t.created_at desc
  limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  v_new_no := v_old.ticket_no || '-R' || upper(substr(replace(v_new_id::text, '-', ''), 1, 6));
  insert into public.tickets (
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, destination_kind, destination_id, field_id,
    warehouse_from_id, warehouse_to_id, processing_point_from_id, processing_point_to_id,
    supplier_id, buyer_id, vehicle_id, driver_id, responsible_user_id, created_by,
    gross_weight_kg, tare_weight_kg, net_weight_kg, weigh_method,
    linked_operation_id, linked_request_id, linked_processing_id, notes, shift_id,
    processing_node_id, source_type, destination_type, harvest_year, weight_source,
    manual_correction_reason, stored_tare_used, quality_json, local_sync_status,
    requires_review, review_reason, audit_json, crop_structure_allocation_id,
    supplier_document_no, receipt_mode, supplier_receipt_kind, field_operation_type,
    season_id, shipment_purpose, destination_text, external_document_no,
    field_material_category, disposal_category, created_by_person_id,
    correction_of_ticket_id, correction_reason, correction_started_at
  ) values (
    v_new_id, v_old.company_id, v_new_no, v_old.ticket_type, v_old.op_type, 'active', v_old.direction,
    v_old.source_kind, v_old.source_id, v_old.destination_kind, v_old.destination_id, v_old.field_id,
    v_old.warehouse_from_id, v_old.warehouse_to_id, v_old.processing_point_from_id, v_old.processing_point_to_id,
    v_old.supplier_id, v_old.buyer_id, v_old.vehicle_id, v_old.driver_id, v_old.responsible_user_id, v_actor.id,
    v_old.gross_weight_kg, v_old.tare_weight_kg, v_old.net_weight_kg, v_old.weigh_method,
    v_old.linked_operation_id, v_old.linked_request_id, v_old.linked_processing_id, v_old.notes, coalesce(p_shift_id, v_old.shift_id),
    v_old.processing_node_id, v_old.source_type, v_old.destination_type, v_old.harvest_year, v_old.weight_source,
    trim(p_reason), v_old.stored_tare_used, v_old.quality_json, v_old.local_sync_status,
    v_old.requires_review, v_old.review_reason,
    coalesce(v_old.audit_json, '{}'::jsonb) || jsonb_build_object('correction_of_ticket_id', v_old.id, 'correction_started_by', v_actor.id),
    v_old.crop_structure_allocation_id, v_old.supplier_document_no, v_old.receipt_mode,
    v_old.supplier_receipt_kind, v_old.field_operation_type, v_old.season_id,
    v_old.shipment_purpose, v_old.destination_text, v_old.external_document_no,
    v_old.field_material_category, v_old.disposal_category, p_operator_person_id,
    v_old.id, trim(p_reason), now()
  );

  insert into public.ticket_lines (
    ticket_id, company_id, product_id, product_type, product_name_snapshot, uom,
    gross_line_weight_kg, tare_line_weight_kg, net_line_weight_kg, quantity,
    moisture_percent, dockage_percent, dirt_tare_percent, class_grade,
    variety_id, reproduction_id, packaging_type, returned_container_qty,
    disposable_container_qty, notes, crop_id, warehouse_from_id, warehouse_to_id,
    quantity_kg, quality_json, line_type, variety_name_snapshot,
    reproduction_name_snapshot, batch_class, operation_line_id, unit_price, amount,
    mass_kg, density_kg_per_l, density_unit, density_source,
    density_verification_status, density_verified_at, unit_source,
    unit_contract_version, composition_snapshot, composition_hash, is_mixed_harvest
  )
  select
    v_new_id, tl.company_id, tl.product_id, tl.product_type, tl.product_name_snapshot, tl.uom,
    tl.gross_line_weight_kg, tl.tare_line_weight_kg, tl.net_line_weight_kg, tl.quantity,
    tl.moisture_percent, tl.dockage_percent, tl.dirt_tare_percent, tl.class_grade,
    tl.variety_id, tl.reproduction_id, tl.packaging_type, tl.returned_container_qty,
    tl.disposable_container_qty, tl.notes, tl.crop_id, tl.warehouse_from_id, tl.warehouse_to_id,
    tl.quantity_kg, tl.quality_json, tl.line_type, tl.variety_name_snapshot,
    tl.reproduction_name_snapshot, tl.batch_class, tl.operation_line_id, tl.unit_price, tl.amount,
    tl.mass_kg, tl.density_kg_per_l, tl.density_unit, tl.density_source,
    tl.density_verification_status, tl.density_verified_at, tl.unit_source,
    tl.unit_contract_version, tl.composition_snapshot, tl.composition_hash, tl.is_mixed_harvest
  from public.ticket_lines tl
  where tl.ticket_id = v_old.id;

  insert into public.ticket_weighings (
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, comment, operator_person_id, weighbridge_shift_id
  )
  select v_new_id, tw.company_id, tw.weighing_no, tw.measured_weight_kg, now(),
    'manual', v_actor.id, 'Скопировано для исправления талона ' || v_old.ticket_no,
    p_operator_person_id, coalesce(p_shift_id, tw.weighbridge_shift_id)
  from public.ticket_weighings tw
  where tw.ticket_id = v_old.id;

  insert into public.audit_log (company_id, who, entity_type, entity_id, action, old_values, new_values, reason)
  values (
    v_old.company_id, v_actor.id, 'weighbridge_ticket', v_new_id::text,
    'ticket_correction_started', jsonb_build_object('ticket_id', v_old.id, 'ticket_no', v_old.ticket_no),
    jsonb_build_object('ticket_id', v_new_id, 'ticket_no', v_new_no, 'operator_person_id', p_operator_person_id, 'shift_id', p_shift_id),
    trim(p_reason)
  );
  return v_new_id;
end;
$function$;

create or replace function public.finalize_weighbridge_ticket_correction_v1(
  p_ticket_id uuid,
  p_operator_person_id uuid default null,
  p_shift_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor public.profiles%rowtype;
  v_new public.tickets%rowtype;
  v_old public.tickets%rowtype;
  v_entry public.stock_ledger_entries%rowtype;
begin
  select t.* into v_new from public.tickets t where t.id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_new.correction_of_ticket_id is null then raise exception 'Ticket is not a correction'; end if;
  select t.* into v_old from public.tickets t where t.id = v_new.correction_of_ticket_id for update;
  if not found then raise exception 'Original ticket not found'; end if;
  v_actor := private.assert_weighbridge_ticket_correction_actor_v1(v_new.company_id, p_operator_person_id, p_shift_id);

  if v_new.is_finalized or v_new.is_voided or v_new.status::text in ('finalized', 'voided') then
    raise exception 'Correction ticket is not open';
  end if;
  if not v_old.is_finalized or v_old.is_voided or v_old.status::text <> 'finalized' then
    raise exception 'Original ticket is no longer correctable';
  end if;
  if private.weighbridge_ticket_has_downstream_dependencies_v1(v_old.id) then
    raise exception 'Этот приход уже использован в последующих движениях. Простое исправление невозможно.';
  end if;

  for v_entry in
    select sle.*
    from public.stock_ledger_entries sle
    where sle.ticket_id = v_old.id
      and coalesce(sle.is_storno, false) = false
      and not exists (
        select 1 from public.stock_ledger_entries x where x.storno_of_entry_id = sle.id
      )
    order by sle.created_at, sle.id
  loop
    insert into public.stock_ledger_entries (
      company_id, ticket_id, processing_id, product_id, warehouse_id, direction,
      quantity, uom, delta_qty_signed, reason_type, reason_ref_id, batch_id,
      occurred_at, created_by, is_storno, storno_of_entry_id, notes,
      variety_id, reproduction_id, batch_id_text, batch_class, operation_line_id,
      mass_kg, density_kg_per_l, density_unit, density_source,
      density_verification_status, density_verified_at, unit_source,
      unit_contract_version, warehouse_issue_allocation_id, crop_id, inventory_batch_id
    ) values (
      v_entry.company_id, v_entry.ticket_id, v_entry.processing_id, v_entry.product_id, v_entry.warehouse_id,
      case when v_entry.direction::text = 'in' then 'out'::public.ledger_direction else 'in'::public.ledger_direction end,
      v_entry.quantity, v_entry.uom, -v_entry.delta_qty_signed,
      'storno_' || v_entry.reason_type, v_entry.reason_ref_id, v_entry.batch_id,
      now(), v_actor.id, true, v_entry.id, 'Исправление талона: ' || v_new.correction_reason,
      v_entry.variety_id, v_entry.reproduction_id, v_entry.batch_id_text, v_entry.batch_class,
      v_entry.operation_line_id, v_entry.mass_kg, v_entry.density_kg_per_l,
      v_entry.density_unit, v_entry.density_source, v_entry.density_verification_status,
      v_entry.density_verified_at, v_entry.unit_source, v_entry.unit_contract_version,
      v_entry.warehouse_issue_allocation_id, v_entry.crop_id, v_entry.inventory_batch_id
    );
  end loop;

  update public.inventory_batches
  set current_weight_kg = 0,
      current_quantity = case when current_quantity is null then null else 0 end,
      updated_at = now()
  where source_ticket_id = v_old.id;

  update public.tickets
  set is_voided = true,
      status = 'voided',
      voided_by = v_actor.id,
      voided_at = now(),
      void_reason = 'Аннулирован — исправление: ' || v_new.correction_reason,
      replacement_ticket_id = v_new.id,
      correction_completed_at = now(),
      updated_at = now()
  where id = v_old.id;

  perform public.finalize_weighbridge_ticket_for_session_v1(v_new.id);

  update public.tickets
  set correction_completed_at = now(),
      finalized_by_person_id = coalesce(p_operator_person_id, finalized_by_person_id),
      updated_at = now()
  where id = v_new.id;

  insert into public.audit_log (company_id, who, entity_type, entity_id, action, old_values, new_values, reason)
  values (
    v_new.company_id, v_actor.id, 'weighbridge_ticket', v_old.id::text,
    'ticket_replaced',
    jsonb_build_object('ticket_id', v_old.id, 'ticket_no', v_old.ticket_no, 'net_weight_kg', v_old.net_weight_kg),
    jsonb_build_object('ticket_id', v_new.id, 'ticket_no', v_new.ticket_no, 'net_weight_kg', v_new.net_weight_kg,
      'operator_person_id', p_operator_person_id, 'shift_id', p_shift_id),
    v_new.correction_reason
  );
  return v_new.id;
end;
$function$;

revoke all on function private.assert_weighbridge_ticket_correction_actor_v1(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.weighbridge_ticket_has_downstream_dependencies_v1(uuid) from public, anon, authenticated;
revoke all on function public.update_open_weighbridge_ticket_v1(uuid, jsonb, boolean, uuid, uuid, text) from public, anon;
revoke all on function public.start_weighbridge_ticket_correction_v1(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.finalize_weighbridge_ticket_correction_v1(uuid, uuid, uuid) from public, anon;
grant execute on function public.update_open_weighbridge_ticket_v1(uuid, jsonb, boolean, uuid, uuid, text) to authenticated;
grant execute on function public.start_weighbridge_ticket_correction_v1(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.finalize_weighbridge_ticket_correction_v1(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
