create or replace function public.finalize_weighbridge_impurity_ticket_for_session_v1(
  p_ticket_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_line public.ticket_lines%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_line_count integer;
  v_net numeric(14,3);
  v_received numeric(14,3);
  v_removed numeric(14,3);
  v_stock numeric(14,3);
  v_available numeric(14,3);
begin
  select *
    into v_actor
    from public.profiles
   where id = auth.uid()
     and status = 'active';

  if not found then
    raise exception 'Active actor profile not found';
  end if;

  select *
    into v_ticket
    from public.tickets
   where id = p_ticket_id
   for update;

  if not found then
    raise exception 'Ticket not found';
  end if;
  if v_ticket.company_id <> v_actor.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;
  if coalesce(v_actor.role, '') not in ('admin', 'global_admin', 'company_admin', 'director', 'warehouse', 'warehouse_operator', 'weighman') then
    raise exception 'Actor role is not allowed to finalize weighbridge tickets';
  end if;
  if coalesce(v_ticket.is_voided, false) or v_ticket.status = 'voided' then
    raise exception 'Voided ticket cannot be finalized';
  end if;
  if coalesce(v_ticket.is_finalized, false) or v_ticket.status = 'finalized' then
    return p_ticket_id;
  end if;
  if v_ticket.direction <> 'outgoing' or v_ticket.op_type <> 'weighbridge_impurities' then
    raise exception 'Ticket is not a weighbridge impurity removal';
  end if;
  if v_ticket.batch_id is null or v_ticket.warehouse_from_id is null then
    raise exception 'Harvest batch and source warehouse are required';
  end if;
  if v_ticket.vehicle_id is null or v_ticket.driver_id is null then
    raise exception 'Vehicle and driver are required';
  end if;
  if coalesce(v_ticket.audit_json->>'impurity_type', '') not in ('soil_and_trash', 'nonconforming_crop', 'plant_residues', 'other') then
    raise exception 'Impurity type is required';
  end if;

  select count(*)
    into v_line_count
    from public.ticket_lines
   where ticket_id = p_ticket_id;
  if v_line_count <> 1 then
    raise exception 'Impurity removal requires exactly one ticket line';
  end if;

  select *
    into v_line
    from public.ticket_lines
   where ticket_id = p_ticket_id
   order by created_at asc
   limit 1
   for update;

  select *
    into v_batch
    from public.inventory_batches
   where id = v_ticket.batch_id
     and company_id = v_ticket.company_id
     and origin_type = 'harvest'
   for update;

  if not found then
    raise exception 'Harvest batch not found in ticket company';
  end if;
  if coalesce(v_line.batch_id, '') <> v_batch.id::text then
    raise exception 'Ticket line batch does not match selected harvest batch';
  end if;
  if v_line.product_id <> v_batch.product_id
     or coalesce(v_line.crop_id::text, '') <> coalesce(v_batch.crop_id::text, '')
     or coalesce(v_line.variety_id::text, '') <> coalesce(v_batch.variety_id::text, '')
     or coalesce(v_line.reproduction_id::text, '') <> coalesce(v_batch.reproduction_id::text, '') then
    raise exception 'Ticket line identity does not match selected harvest batch';
  end if;
  if not exists (
    select 1
      from public.warehouses w
     where w.id = v_ticket.warehouse_from_id
       and w.company_id = v_ticket.company_id
       and coalesce(w.archived, false) = false
       and coalesce(w.is_archived, false) = false
       and lower(coalesce(w.warehouse_type, '')) in ('grain', 'grain_storage', 'harvest', 'crop', 'produce', 'elevator')
  ) then
    raise exception 'Selected warehouse is not available for harvest';
  end if;

  if v_ticket.gross_weight_kg is null or v_ticket.tare_weight_kg is null then
    raise exception 'Gross and tare are required before finalization';
  end if;
  v_net := round((v_ticket.gross_weight_kg - v_ticket.tare_weight_kg)::numeric, 3);
  if v_net <= 0 then
    raise exception 'Net weight must be greater than zero';
  end if;

  if exists (
    select 1
      from public.stock_ledger_entries sle
     where sle.ticket_id = p_ticket_id
       and coalesce(sle.is_storno, false) = false
  ) then
    raise exception 'Ticket already has ledger entries';
  end if;

  select coalesce(sum(t.net_weight_kg), 0)
    into v_received
    from public.tickets t
   where t.company_id = v_ticket.company_id
     and t.batch_id = v_batch.id
     and t.op_type = 'harvest_incoming'
     and t.status = 'finalized'
     and coalesce(t.is_finalized, false) = true
     and coalesce(t.is_voided, false) = false;

  select coalesce(sum(t.net_weight_kg), 0)
    into v_removed
    from public.tickets t
   where t.company_id = v_ticket.company_id
     and t.batch_id = v_batch.id
     and t.op_type = 'weighbridge_impurities'
     and t.status = 'finalized'
     and coalesce(t.is_finalized, false) = true
     and coalesce(t.is_voided, false) = false
     and t.id <> p_ticket_id;

  select coalesce(sum(sbi.quantity), 0)
    into v_stock
    from public.v_stock_balance_identity sbi
   where sbi.company_id = v_ticket.company_id
     and sbi.warehouse_id = v_ticket.warehouse_from_id
     and sbi.product_id = v_batch.product_id
     and coalesce(sbi.variety_id::text, '') = coalesce(v_batch.variety_id::text, '')
     and coalesce(sbi.reproduction_id::text, '') = coalesce(v_batch.reproduction_id::text, '')
     and coalesce(sbi.batch_id, '') = v_batch.id::text
     and coalesce(sbi.batch_class, 'commodity') = coalesce(v_batch.batch_class, 'commodity')
     and sbi.uom = 'kg';

  v_available := greatest(0, least(v_received - v_removed, v_stock));
  if v_net > v_available + 0.0005 then
    raise exception 'IMPURITY_WEIGHT_EXCEEDS_AVAILABLE|%', trim(to_char(v_available, 'FM999999999990.000'));
  end if;

  update public.ticket_lines
     set quantity = v_net,
         net_line_weight_kg = v_net,
         mass_kg = v_net
   where id = v_line.id;

  insert into public.stock_ledger_entries (
    company_id,
    ticket_id,
    product_id,
    variety_id,
    reproduction_id,
    batch_id_text,
    batch_class,
    warehouse_id,
    direction,
    quantity,
    uom,
    delta_qty_signed,
    reason_type,
    reason_ref_id,
    occurred_at,
    created_by,
    notes
  ) values (
    v_ticket.company_id,
    v_ticket.id,
    v_batch.product_id,
    v_batch.variety_id,
    v_batch.reproduction_id,
    v_batch.id::text,
    coalesce(v_batch.batch_class, 'commodity'),
    v_ticket.warehouse_from_id,
    'out',
    v_net,
    'kg',
    -v_net,
    'WEIGHBRIDGE_IMPURITIES',
    v_ticket.id,
    now(),
    v_actor.id,
    v_ticket.notes
  );

  update public.tickets
     set net_weight_kg = v_net,
         is_finalized = true,
         status = 'finalized',
         closed_by = v_actor.id,
         finalized_at = now(),
         audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
           'received_kg_before_removal', v_received,
           'removed_kg_before_removal', v_removed,
           'clean_mass_kg_before_removal', v_available,
           'clean_mass_kg_after_removal', v_available - v_net
         ),
         updated_at = now()
   where id = p_ticket_id;

  return p_ticket_id;
end;
$$;

revoke all on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) from public;
revoke all on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) from anon;
grant execute on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) to authenticated;
grant execute on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) to service_role;

notify pgrst, 'reload schema';
