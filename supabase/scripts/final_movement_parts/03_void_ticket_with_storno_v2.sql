create or replace function public.void_ticket_with_storno_v2(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_entry public.stock_ledger_entries%rowtype;
  v_actor public.profiles%rowtype;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Void reason is required';
  end if;

  select *
    into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_ticket.is_voided or v_ticket.status = 'voided' then
    return p_ticket_id;
  end if;

  select *
    into v_actor
  from public.profiles
  where id = p_actor_user_id;

  if not found or v_actor.company_id <> v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;

  if coalesce(v_actor.role, '') not in ('admin', 'company_admin') then
    raise exception 'Only admin can void finalized tickets';
  end if;

  for v_entry in
    select *
    from public.stock_ledger_entries
    where ticket_id = p_ticket_id
      and coalesce(is_storno, false) = false
  loop
    if exists (
      select 1
      from public.stock_ledger_entries sle
      where sle.storno_of_entry_id = v_entry.id
    ) then
      continue;
    end if;

    insert into public.stock_ledger_entries (
      company_id,
      ticket_id,
      processing_id,
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
      batch_id,
      occurred_at,
      created_by,
      is_storno,
      storno_of_entry_id,
      notes
    )
    values (
      v_entry.company_id,
      v_entry.ticket_id,
      v_entry.processing_id,
      v_entry.product_id,
      v_entry.variety_id,
      v_entry.reproduction_id,
      v_entry.batch_id_text,
      v_entry.batch_class,
      v_entry.warehouse_id,
      case when v_entry.direction = 'in' then 'out' else 'in' end,
      v_entry.quantity,
      v_entry.uom,
      -v_entry.delta_qty_signed,
      'storno_' || v_entry.reason_type,
      v_entry.reason_ref_id,
      v_entry.batch_id,
      now(),
      p_actor_user_id,
      true,
      v_entry.id,
      p_reason
    );
  end loop;

  update public.field_material_consumptions
  set notes = concat_ws(E'\n', notes, 'РђРЅРЅСѓР»РёСЂРѕРІР°РЅРѕ С‚Р°Р»РѕРЅРѕРј: ' || p_reason),
      updated_at = now()
  where ticket_id = p_ticket_id;

  update public.tickets
  set
    is_voided = true,
    status = 'voided',
    voided_by = p_actor_user_id,
    voided_at = now(),
    void_reason = p_reason,
    updated_at = now()
  where id = p_ticket_id;

  return p_ticket_id;
end;
$$;
