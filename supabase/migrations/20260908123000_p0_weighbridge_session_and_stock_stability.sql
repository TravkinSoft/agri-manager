begin;

-- Keep the existing stock contract available while providing a resolver that
-- evaluates ledger identity candidates once per request instead of once per
-- aggregate-lot member.
create or replace view public.v_harvest_lot_stock_v2
with (security_invoker = true)
as
with ledger_base as materialized (
  select
    sle.id as ledger_entry_id,
    sle.company_id,
    sle.warehouse_id,
    sle.delta_qty_signed,
    sle.inventory_batch_id,
    case
      when sle.batch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then sle.batch_id_text::uuid
      else null::uuid
    end as batch_text_uuid,
    sle.ticket_id
  from public.stock_ledger_entries sle
), resolution_candidates as materialized (
  select
    lb.ledger_entry_id,
    lb.company_id,
    lb.warehouse_id,
    lb.delta_qty_signed,
    ib.id as resolved_inventory_batch_id,
    0 as precedence,
    ib.created_at as resolved_batch_created_at
  from ledger_base lb
  join public.inventory_batches ib
    on ib.company_id = lb.company_id
   and ib.id = lb.inventory_batch_id
  join public.harvest_lot_batches linked
    on linked.company_id = ib.company_id
   and linked.inventory_batch_id = ib.id
  where lb.inventory_batch_id is not null

  union all

  select
    lb.ledger_entry_id,
    lb.company_id,
    lb.warehouse_id,
    lb.delta_qty_signed,
    ib.id,
    1,
    ib.created_at
  from ledger_base lb
  join public.inventory_batches ib
    on ib.company_id = lb.company_id
   and ib.id = lb.batch_text_uuid
  join public.harvest_lot_batches linked
    on linked.company_id = ib.company_id
   and linked.inventory_batch_id = ib.id
  where lb.inventory_batch_id is null
    and lb.batch_text_uuid is not null

  union all

  select
    lb.ledger_entry_id,
    lb.company_id,
    lb.warehouse_id,
    lb.delta_qty_signed,
    ib.id,
    2,
    ib.created_at
  from ledger_base lb
  join public.inventory_batches ib
    on ib.company_id = lb.company_id
   and ib.source_ticket_id = lb.ticket_id
  join public.harvest_lot_batches linked
    on linked.company_id = ib.company_id
   and linked.inventory_batch_id = ib.id
  where lb.inventory_batch_id is null
    and lb.ticket_id is not null
), resolved_ledger as materialized (
  select
    company_id,
    resolved_inventory_batch_id as inventory_batch_id,
    warehouse_id,
    delta_qty_signed
  from (
    select
      candidate.*,
      row_number() over (
        partition by ledger_entry_id
        order by precedence, resolved_batch_created_at, resolved_inventory_batch_id
      ) as resolution_rank
    from resolution_candidates candidate
  ) ranked
  where resolution_rank = 1
), ledger_by_batch as materialized (
  select
    company_id,
    inventory_batch_id,
    warehouse_id,
    sum(delta_qty_signed)::numeric(18,3) as current_weight_kg
  from resolved_ledger
  group by company_id, inventory_batch_id, warehouse_id
)
select
  hl.company_id,
  hl.id as harvest_lot_id,
  lbs.warehouse_id,
  count(distinct coalesce(
    hlb.source_ticket_id,
    ib.source_ticket_id,
    parent_link.source_ticket_id,
    parent_batch.source_ticket_id
  ))::integer as trip_count,
  coalesce(sum(lbs.current_weight_kg), 0)::numeric(18,3) as current_weight_kg,
  coalesce(ib.batch_class, 'commodity') as batch_class,
  coalesce(ib.physical_state, 'SOURCE') as physical_state
from public.harvest_lots hl
join public.harvest_lot_batches hlb
  on hlb.harvest_lot_id = hl.id
join public.inventory_batches ib
  on ib.id = hlb.inventory_batch_id
 and ib.company_id = hlb.company_id
left join public.inventory_batches parent_batch
  on parent_batch.id = ib.parent_batch_id
 and parent_batch.company_id = ib.company_id
left join public.harvest_lot_batches parent_link
  on parent_link.inventory_batch_id = parent_batch.id
 and parent_link.company_id = parent_batch.company_id
left join ledger_by_batch lbs
  on lbs.company_id = hlb.company_id
 and lbs.inventory_batch_id = hlb.inventory_batch_id
where hl.status = 'active'
group by
  hl.company_id,
  hl.id,
  lbs.warehouse_id,
  coalesce(ib.batch_class, 'commodity'),
  coalesce(ib.physical_state, 'SOURCE');

revoke all on table public.v_harvest_lot_stock_v2 from public, anon;
grant select on table public.v_harvest_lot_stock_v2 to authenticated, service_role;

-- Unlocking the same operator on another browser must not invalidate an
-- already active token for the same canonical shift and person.
create or replace function public.open_or_unlock_weighbridge_shift_v1(
  p_company_id uuid,
  p_person_id uuid,
  p_pin text,
  p_opening_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor public.profiles%rowtype;
  v_person public.company_people%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_pin jsonb;
  v_token text;
  v_expires timestamptz := now() + interval '24 hours';
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','director','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_person from public.company_people
  where id = p_person_id and company_id = p_company_id
    and role_type = 'weighbridge_operator' and status = 'active' and deleted_at is null;
  if not found then raise exception 'Active weighbridge operator not found' using errcode = '23503'; end if;

  v_pin := private.verify_weighbridge_operator_pin_v1(p_company_id, p_person_id, p_pin, v_actor.id);
  if not coalesce((v_pin ->> 'ok')::boolean, false) then return v_pin; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':weighbridge_shift', 0));
  select * into v_shift from public.weighbridge_shifts
  where company_id = p_company_id and status = 'open'
  order by opened_at desc limit 1 for update;

  if v_shift.id is not null and v_shift.last_activity_at + interval '24 hours' <= now() then
    update public.weighbridge_shifts
    set status = 'closed', closed_at = last_activity_at + interval '24 hours', closed_by = null,
        closed_by_person_id = operator_person_id, close_reason = 'inactivity_24h'
    where id = v_shift.id and status = 'open';
    v_shift := null;
  end if;

  if v_shift.id is not null and v_shift.operator_person_id is not null and v_shift.operator_person_id <> p_person_id then
    return jsonb_build_object('ok', false, 'code', 'handover_required');
  end if;
  if v_shift.id is null then
    insert into public.weighbridge_shifts (
      company_id, operator_id, operator_person_id, opened_by, opened_by_person_id,
      opening_note, status, locked_at, last_activity_at
    ) values (
      p_company_id, v_actor.id, p_person_id, v_actor.id, p_person_id,
      nullif(btrim(coalesce(p_opening_note, '')), ''), 'open', null, now()
    ) returning * into v_shift;
  else
    update public.weighbridge_shifts
    set operator_id = v_actor.id,
        operator_person_id = p_person_id,
        opened_by_person_id = coalesce(opened_by_person_id, p_person_id),
        locked_at = null,
        locked_by_person_id = null,
        last_activity_at = now()
    where id = v_shift.id returning * into v_shift;
  end if;

  update private.weighbridge_operator_sessions
  set status = 'revoked', revoked_at = now()
  where company_id = p_company_id
    and status = 'active'
    and (
      shift_id is distinct from v_shift.id
      or person_id is distinct from p_person_id
    );
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.weighbridge_operator_sessions (
    company_id, shift_id, person_id, auth_user_id, token_hash, expires_at
  ) values (
    p_company_id, v_shift.id, p_person_id, v_actor.id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires
  );

  return jsonb_build_object(
    'ok', true, 'token', v_token, 'expires_at', v_expires,
    'session_expires_at', v_expires, 'shift_expires_at', v_expires,
    'shift', to_jsonb(v_shift),
    'operator', jsonb_build_object('id', v_person.id, 'name', v_person.full_name)
  );
end
$function$;

revoke all on function public.open_or_unlock_weighbridge_shift_v1(uuid, uuid, text, text) from public, anon;
grant execute on function public.open_or_unlock_weighbridge_shift_v1(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
