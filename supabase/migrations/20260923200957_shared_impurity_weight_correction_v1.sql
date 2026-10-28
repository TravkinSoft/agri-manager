-- P0 shared impurity weight correction V1.
-- Filename aligned to the version recorded by Supabase apply_migration.
-- Correct the same finalized document, within its still-open accounting shift.
-- Frozen source identities/proportions and dates never move to today's shift.
-- Ledger is append-only: full-fidelity reversals + replacement postings.
begin;

create table private.weighbridge_impurity_weight_revisions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  ticket_id uuid not null references public.tickets(id),
  group_id uuid not null references public.weighbridge_shared_impurity_groups(id),
  actor_id uuid not null references public.profiles(id),
  operator_person_id uuid not null references public.company_people(id),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  before_values jsonb not null,
  after_values jsonb not null,
  source_allocations jsonb not null,
  created_at timestamptz not null default now(),
  unique (ticket_id, id)
);
create index on private.weighbridge_impurity_weight_revisions(ticket_id, created_at);
create table private.weighbridge_impurity_weight_revision_entries (
  revision_id uuid not null references private.weighbridge_impurity_weight_revisions(id),
  old_entry_id uuid unique references public.stock_ledger_entries(id),
  new_entry_id uuid unique references public.stock_ledger_entries(id),
  check (old_entry_id is not null or new_entry_id is not null)
);
revoke all on private.weighbridge_impurity_weight_revisions,
  private.weighbridge_impurity_weight_revision_entries from public, anon, authenticated, service_role;

-- One indexed aggregation, not one full warehouse scan per historical source.
create function private.shared_impurity_weight_balances_v1(p_group_id uuid)
returns table(batch_id uuid,balance_kg numeric)
language sql stable security definer set search_path='' as $balances$
  with targets as materialized (
    select s.inventory_batch_id id,s.company_id,s.warehouse_id
      from public.weighbridge_shared_impurity_source_batches s where s.group_id=p_group_id
    union
    select g.pool_inventory_batch_id,g.company_id,g.source_warehouse_id
      from public.weighbridge_shared_impurity_groups g where g.id=p_group_id
  ), entries as (
    select t.id,e.delta_qty_signed from targets t join public.stock_ledger_entries e
      on e.company_id=t.company_id and e.warehouse_id=t.warehouse_id and e.inventory_batch_id=t.id
    union all
    select t.id,e.delta_qty_signed from targets t join public.stock_ledger_entries e
      on e.company_id=t.company_id and e.warehouse_id=t.warehouse_id and e.inventory_batch_id is null
      and nullif(e.batch_id_text,'')=t.id::text
    union all
    select t.id,e.delta_qty_signed from targets t join public.stock_ledger_entries e
      on e.company_id=t.company_id and e.warehouse_id=t.warehouse_id and e.inventory_batch_id is null
      and nullif(e.batch_id_text,'') is null and nullif(e.batch_id,'')=t.id::text
  ) select t.id,pg_catalog.round(coalesce(sum(e.delta_qty_signed),0),6)
    from targets t left join entries e on e.id=t.id group by t.id;
$balances$;
revoke all on function private.shared_impurity_weight_balances_v1(uuid) from public,anon,authenticated,service_role;

create or replace function public.correct_shared_impurity_ticket_weights_v1(
  p_ticket_id uuid,
  p_session_token text,
  p_gross_weight_kg numeric,
  p_tare_weight_kg numeric,
  p_expected_gross_weight_kg numeric,
  p_expected_tare_weight_kg numeric,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = ''
set lock_timeout = '3s'
as $function$
declare
  v_principal uuid := auth.uid();
  v_gate record;
  v_actor public.profiles%rowtype;
  v_session private.weighbridge_operator_sessions%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_ticket public.tickets%rowtype;
  v_group public.weighbridge_shared_impurity_groups%rowtype;
  v_prior private.weighbridge_impurity_weight_revisions%rowtype;
  v_gross numeric := pg_catalog.round(p_gross_weight_kg,3);
  v_tare numeric := pg_catalog.round(p_tare_weight_kg,3);
  v_net numeric;
  v_allocations jsonb;
  v_plan jsonb;
  v_before jsonb;
  v_after jsonb;
  v_balances jsonb;
  v_pool_out uuid := extensions.gen_random_uuid();
  v_pool_split uuid := extensions.gen_random_uuid();
begin
  if v_principal is null then raise exception 'SHARED_WEIGHT_AUTH_REQUIRED' using errcode='42501'; end if;
  if p_ticket_id is null or p_idempotency_key is null
     or nullif(pg_catalog.btrim(p_reason),'') is null or length(p_reason)>2000
     or v_gross is null or v_tare is null
     or v_gross::text in ('NaN','Infinity','-Infinity')
     or v_tare::text in ('NaN','Infinity','-Infinity')
     or v_gross <= v_tare or v_tare < 0 or v_gross > 99999999999
     or p_expected_gross_weight_kg is null or p_expected_tare_weight_kg is null then
    raise exception 'SHARED_WEIGHT_INPUT_INVALID' using errcode='22023';
  end if;
  v_net := v_gross-v_tare;
  select * into v_gate from private.resolve_processing_gate_session_actor_v1();
  select * into v_actor from public.profiles
    where id=v_gate.actor_profile_id and coalesce(status,'active')='active';
  if not found or v_actor.role not in ('global_admin','company_admin','weighman')
     or (v_actor.role<>'global_admin' and v_actor.company_id is distinct from v_gate.selected_company_id) then
    raise exception 'SHARED_WEIGHT_FORBIDDEN' using errcode='42501';
  end if;
  select * into v_ticket from public.tickets
    where id=p_ticket_id and company_id=v_gate.selected_company_id;
  if not found then raise exception 'SHARED_WEIGHT_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_group from public.weighbridge_shared_impurity_groups
    where ticket_id=v_ticket.id and company_id=v_ticket.company_id;
  if not found then raise exception 'SHARED_WEIGHT_NOT_FOUND' using errcode='P0002'; end if;

  perform private.assert_processing_gate_actor_v1(v_ticket.company_id,v_actor.id);
  perform private.tz315_lock_company_season_write_gate_v1(v_ticket.company_id,v_group.season_id);
  select * into v_session from private.weighbridge_operator_sessions
    where company_id=v_ticket.company_id and auth_user_id=v_principal
      and token_hash=pg_catalog.encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
      and status='active'
    order by created_at desc limit 1 for update;
  if not found or v_session.expires_at<=pg_catalog.now() then
    raise exception 'SHARED_WEIGHT_SESSION_EXPIRED' using errcode='42501';
  end if;
  select * into v_shift from public.weighbridge_shifts
    where id=v_session.shift_id and company_id=v_ticket.company_id for update;
  if not found or v_shift.status<>'open'
     or v_shift.last_activity_at+interval '24 hours'<=pg_catalog.now()
     or v_shift.operator_person_id is distinct from v_session.person_id
     or not exists (select 1 from public.company_people where id=v_session.person_id
       and company_id=v_ticket.company_id and role_type='weighbridge_operator'
       and status='active' and deleted_at is null) then
    raise exception 'SHARED_WEIGHT_SESSION_EXPIRED' using errcode='42501';
  end if;

  select * into v_ticket from public.tickets where id=p_ticket_id for update;
  select * into v_group from public.weighbridge_shared_impurity_groups where id=v_group.id for update;
  -- Replay before optimistic conflict checking, but never replay another actor/company's request.
  select * into v_prior from private.weighbridge_impurity_weight_revisions where id=p_idempotency_key;
  if found then
    if v_prior.ticket_id is distinct from v_ticket.id or v_prior.actor_id is distinct from v_actor.id
       or v_prior.company_id is distinct from v_ticket.company_id
       or v_prior.reason is distinct from pg_catalog.btrim(p_reason)
       or (v_prior.after_values->>'gross_weight_kg')::numeric is distinct from v_gross
       or (v_prior.after_values->>'tare_weight_kg')::numeric is distinct from v_tare
       or (v_prior.before_values->>'gross_weight_kg')::numeric is distinct from p_expected_gross_weight_kg
       or (v_prior.before_values->>'tare_weight_kg')::numeric is distinct from p_expected_tare_weight_kg then
      raise exception 'SHARED_WEIGHT_KEY_REUSED' using errcode='23505';
    end if;
    return pg_catalog.jsonb_build_object('ok',true,'ticket_id',v_ticket.id,'revision_id',v_prior.id,'replayed',true);
  end if;
  if v_ticket.status::text<>'finalized' or not v_ticket.is_finalized or coalesce(v_ticket.is_voided,false)
     or v_ticket.replacement_ticket_id is not null or v_ticket.correction_of_ticket_id is not null
     or v_ticket.linked_processing_id is not null or v_ticket.linked_request_id is not null
     or v_ticket.op_type<>'weighbridge_impurities' or v_ticket.direction::text<>'outgoing'
     or v_ticket.ticket_type<>'impurity_removal' or v_group.state<>'finalized'
     or v_group.settlement_mode<>'proportional_members_v2'
     or v_group.member_resolution_status<>'proportional'
     or v_ticket.warehouse_from_id is distinct from v_group.source_warehouse_id then
    raise exception 'SHARED_WEIGHT_STATE_INVALID' using errcode='23514';
  end if;
  -- Closed reports are immutable snapshots. Do not silently rewrite a closed shift
  -- or move its correction into the current shift.
  perform 1 from public.weighbridge_shifts
    where id=v_ticket.shift_id and company_id=v_ticket.company_id and status='open' for update;
  if not found then raise exception 'SHARED_WEIGHT_ACCOUNTING_SHIFT_CLOSED' using errcode='23514'; end if;
  if v_ticket.gross_weight_kg is distinct from p_expected_gross_weight_kg
     or v_ticket.tare_weight_kg is distinct from p_expected_tare_weight_kg then
    raise exception 'SHARED_WEIGHT_CONFLICT' using errcode='40001';
  end if;
  if v_gross=v_ticket.gross_weight_kg and v_tare=v_ticket.tare_weight_kg then
    return pg_catalog.jsonb_build_object('ok',true,'ticket_id',v_ticket.id,'unchanged',true);
  end if;
  if v_net>v_group.source_total_kg or v_group.source_total_kg<=0 then
    raise exception 'SHARED_WEIGHT_EXCEEDS_SOURCE' using errcode='23514';
  end if;
  if (select count(*) from public.ticket_lines where ticket_id=v_ticket.id and company_id=v_ticket.company_id)<>1
     or v_ticket.net_weight_kg is distinct from v_group.impurity_weight_kg
     or pg_catalog.abs((select coalesce(sum(delta_qty_signed),0) from public.stock_ledger_entries
       where ticket_id=v_ticket.id)+v_ticket.net_weight_kg)>0.001 then
    raise exception 'SHARED_WEIGHT_ACCOUNTING_MISMATCH' using errcode='23514';
  end if;

  perform 1 from public.weighbridge_shared_impurity_source_batches
    where group_id=v_group.id order by inventory_batch_id for update;
  perform 1 from public.inventory_batches where id=v_group.pool_inventory_batch_id
    or id in (select inventory_batch_id from public.weighbridge_shared_impurity_source_batches where group_id=v_group.id)
    order by id for update;
  with ranked as (
    select s.*,row_number() over(order by inventory_batch_id) rn,count(*) over() cnt,
      pg_catalog.round(v_net*source_balance_snapshot_kg/v_group.source_total_kg,3) provisional
    from public.weighbridge_shared_impurity_source_batches s where group_id=v_group.id
  ), allocated as (
    select *,case when rn=cnt then v_net-coalesce(sum(provisional) over(order by inventory_batch_id
      rows between unbounded preceding and 1 preceding),0) else provisional end new_kg from ranked
  )
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',id,'batch_id',inventory_batch_id,'old_kg',allocated_impurity_kg,'new_kg',new_kg,
    'old_entry_id',impurity_out_ledger_entry_id,'template_id',coalesce(impurity_out_ledger_entry_id,source_restore_ledger_entry_id),
    'new_entry_id',case when new_kg>0 then extensions.gen_random_uuid() else null end,
    'snapshot_kg',source_balance_snapshot_kg,'state',state
  ) order by inventory_batch_id) into v_allocations from allocated;
  if v_allocations is null or exists (select 1 from pg_catalog.jsonb_to_recordset(v_allocations)
    as a(old_kg numeric,new_kg numeric,snapshot_kg numeric,state text)
    where old_kg is null or new_kg<0 or new_kg>snapshot_kg or state<>'released')
    or pg_catalog.abs((select sum(a.old_kg) from pg_catalog.jsonb_to_recordset(v_allocations) as a(old_kg numeric))-v_group.impurity_weight_kg)>0.001 then
    raise exception 'SHARED_WEIGHT_ALLOCATION_INVALID' using errcode='23514';
  end if;

  -- Only an incremental additional write-off consumes availability. A weight
  -- decrease returns stock to the same original identities, not a new batch.
  if exists (
    with reserved as (select r.batch_id,sum(r.reserved_kg) kg from public.v_weighbridge_open_ticket_reservations_v1 r
      where r.company_id=v_ticket.company_id and r.warehouse_id=v_group.source_warehouse_id
        and r.ticket_id<>v_ticket.id group by r.batch_id),
    processing as (select a.batch_id,sum(a.allocated_kg) kg from public.v_processing_active_allocations_v1 a
      where a.company_id=v_ticket.company_id and a.warehouse_id=v_group.source_warehouse_id group by a.batch_id)
    select 1 from pg_catalog.jsonb_to_recordset(v_allocations) as a(batch_id uuid,old_kg numeric,new_kg numeric)
      join private.shared_impurity_weight_balances_v1(v_group.id) b using(batch_id)
      left join reserved r using(batch_id) left join processing p using(batch_id)
      where a.new_kg>a.old_kg and b.balance_kg-coalesce(r.kg,0)-coalesce(p.kg,0)+0.001<a.new_kg-a.old_kg
  ) then raise exception 'SHARED_WEIGHT_STOCK_COMMITTED' using errcode='23514'; end if;
  v_before := pg_catalog.jsonb_build_object('gross_weight_kg',v_ticket.gross_weight_kg,
    'tare_weight_kg',v_ticket.tare_weight_kg,'net_weight_kg',v_ticket.net_weight_kg,
    'shift_id',v_ticket.shift_id,'finalized_at',v_ticket.finalized_at);
  v_after := pg_catalog.jsonb_build_object('gross_weight_kg',v_gross,
    'tare_weight_kg',v_tare,'net_weight_kg',v_net,'shift_id',v_ticket.shift_id,'finalized_at',v_ticket.finalized_at);
  insert into private.weighbridge_impurity_weight_revisions
    (id,company_id,ticket_id,group_id,actor_id,operator_person_id,reason,before_values,after_values,source_allocations)
    values(p_idempotency_key,v_ticket.company_id,v_ticket.id,v_group.id,v_actor.id,v_session.person_id,
      pg_catalog.btrim(p_reason),v_before,v_after,v_allocations);

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'old_id',a.old_entry_id,'new_id',a.new_entry_id,'template_id',a.template_id,'quantity',a.new_kg,
    'reason_type','weighbridge_impurities_shared_member','reason_ref_id',a.id)), '[]'::jsonb)
  into v_plan from pg_catalog.jsonb_to_recordset(v_allocations)
    as a(id uuid,old_entry_id uuid,new_entry_id uuid,template_id uuid,new_kg numeric,old_kg numeric)
    where a.new_kg is distinct from a.old_kg;
  -- Equal rounded allocations retain their original ledger entry and pointer.
  v_plan := v_plan || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('old_id',v_group.impurity_out_ledger_entry_id,'new_id',v_pool_out,
      'template_id',v_group.impurity_out_ledger_entry_id,'quantity',v_net,'reason_type','weighbridge_impurities_shared','reason_ref_id',v_ticket.id),
    pg_catalog.jsonb_build_object('old_id',v_group.pool_split_out_ledger_entry_id,
      'new_id',case when v_group.source_total_kg>v_net then v_pool_split else null end,
      'template_id',coalesce(v_group.pool_split_out_ledger_entry_id,v_group.impurity_out_ledger_entry_id),
      'quantity',v_group.source_total_kg-v_net,'reason_type','harvest_pool_split_out','reason_ref_id',v_group.id)
  );
  if exists(select 1 from pg_catalog.jsonb_to_recordset(v_plan) as x(old_id uuid,template_id uuid)
    left join public.stock_ledger_entries e on e.id=x.template_id
    where e.id is null or e.ticket_id is distinct from v_ticket.id or e.company_id is distinct from v_ticket.company_id
      or coalesce(e.is_storno,false) or (x.old_id is not null and exists(
        select 1 from public.stock_ledger_entries r where r.storno_of_entry_id=x.old_id))) then
    raise exception 'SHARED_WEIGHT_LEDGER_CHANGED' using errcode='40001';
  end if;
  insert into public.stock_ledger_entries (
    company_id,ticket_id,processing_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,
    reason_type,reason_ref_id,batch_id,occurred_at,created_by,is_storno,storno_of_entry_id,notes,
    variety_id,reproduction_id,batch_id_text,batch_class,operation_line_id,mass_kg,density_kg_per_l,
    density_unit,density_source,density_verification_status,density_verified_at,unit_source,unit_contract_version,
    warehouse_issue_allocation_id,crop_id,inventory_batch_id
  ) select e.company_id,e.ticket_id,e.processing_id,e.product_id,e.warehouse_id,
    case when e.direction::text='in' then 'out'::public.ledger_direction else 'in'::public.ledger_direction end,
    e.quantity,e.uom,-e.delta_qty_signed,'storno_'||e.reason_type,e.reason_ref_id,e.batch_id,
    e.occurred_at,v_actor.id,true,e.id,'Исправление веса: '||pg_catalog.btrim(p_reason),
    e.variety_id,e.reproduction_id,e.batch_id_text,e.batch_class,e.operation_line_id,e.mass_kg,e.density_kg_per_l,
    e.density_unit,e.density_source,e.density_verification_status,e.density_verified_at,e.unit_source,e.unit_contract_version,
    e.warehouse_issue_allocation_id,e.crop_id,e.inventory_batch_id
  from pg_catalog.jsonb_to_recordset(v_plan) as x(old_id uuid)
    join public.stock_ledger_entries e on e.id=x.old_id;
  insert into public.stock_ledger_entries (
    id,company_id,ticket_id,processing_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,
    reason_type,reason_ref_id,batch_id,occurred_at,created_by,is_storno,notes,
    variety_id,reproduction_id,batch_id_text,batch_class,operation_line_id,mass_kg,density_kg_per_l,
    density_unit,density_source,density_verification_status,density_verified_at,unit_source,unit_contract_version,
    warehouse_issue_allocation_id,crop_id,inventory_batch_id
  ) select x.new_id,e.company_id,e.ticket_id,e.processing_id,e.product_id,e.warehouse_id,
    'out'::public.ledger_direction,x.quantity,'kg',-x.quantity,x.reason_type,x.reason_ref_id,e.batch_id,
    e.occurred_at,v_actor.id,false,'Исправление веса: '||pg_catalog.btrim(p_reason),
    e.variety_id,e.reproduction_id,e.batch_id_text,e.batch_class,e.operation_line_id,x.quantity,e.density_kg_per_l,
    e.density_unit,e.density_source,e.density_verification_status,e.density_verified_at,e.unit_source,e.unit_contract_version,
    e.warehouse_issue_allocation_id,e.crop_id,e.inventory_batch_id
  from pg_catalog.jsonb_to_recordset(v_plan) as x(new_id uuid,template_id uuid,quantity numeric,reason_type text,reason_ref_id uuid)
    join public.stock_ledger_entries e on e.id=x.template_id where x.quantity>0;
  insert into private.weighbridge_impurity_weight_revision_entries(revision_id,old_entry_id,new_entry_id)
    select p_idempotency_key,x.old_id,x.new_id from pg_catalog.jsonb_to_recordset(v_plan) as x(old_id uuid,new_id uuid)
    where x.old_id is not null or x.new_id is not null;

  update public.weighbridge_shared_impurity_source_batches s
    set allocated_impurity_kg=a.new_kg,impurity_out_ledger_entry_id=a.new_entry_id,updated_at=pg_catalog.now()
    from pg_catalog.jsonb_to_recordset(v_allocations) as a(id uuid,new_kg numeric,old_kg numeric,new_entry_id uuid)
    where s.id=a.id and s.group_id=v_group.id and a.new_kg is distinct from a.old_kg;
  update public.weighbridge_shared_impurity_members m set
    allocated_impurity_kg=a.kg,clean_total_kg=m.source_total_snapshot_kg-a.kg,updated_at=pg_catalog.now()
    from (select member_id,sum(allocated_impurity_kg) kg from public.weighbridge_shared_impurity_source_batches
      where group_id=v_group.id group by member_id) a where m.id=a.member_id and m.group_id=v_group.id;
  update public.weighbridge_shared_impurity_groups set impurity_weight_kg=v_net,
    clean_total_kg=source_total_kg-v_net,impurity_out_ledger_entry_id=v_pool_out,
    pool_split_out_ledger_entry_id=case when source_total_kg>v_net then v_pool_split else null end,
    audit_json=coalesce(audit_json,'{}'::jsonb)||pg_catalog.jsonb_build_object('last_weight_revision_id',p_idempotency_key),
    updated_at=pg_catalog.now() where id=v_group.id;
  update public.tickets set gross_weight_kg=v_gross,tare_weight_kg=v_tare,net_weight_kg=v_net,
    manual_correction_reason=pg_catalog.btrim(p_reason),
    audit_json=coalesce(audit_json,'{}'::jsonb)||pg_catalog.jsonb_build_object(
      'last_weight_revision',pg_catalog.jsonb_build_object('id',p_idempotency_key,'before',v_before,'after',v_after,
      'reason',pg_catalog.btrim(p_reason),'actor_id',v_actor.id,'operator_person_id',v_session.person_id,'at',pg_catalog.now())),
    updated_at=pg_catalog.now() where id=v_ticket.id;
  update public.ticket_lines set gross_line_weight_kg=v_gross,tare_line_weight_kg=v_tare,
    net_line_weight_kg=v_net,quantity=v_net,quantity_kg=v_net,mass_kg=v_net,updated_at=pg_catalog.now()
    where ticket_id=v_ticket.id and company_id=v_ticket.company_id;
  -- Original weighing observations remain evidence, not rewritten measurements.
  insert into public.audit_log(company_id,who,entity_type,entity_id,action,old_values,new_values,reason)
    values(v_ticket.company_id,v_actor.id,'weighbridge_ticket',v_ticket.id::text,
      'shared_impurity_weight_corrected',v_before,
      v_after||pg_catalog.jsonb_build_object('revision_id',p_idempotency_key,'operator_person_id',v_session.person_id),
      pg_catalog.btrim(p_reason));
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b)) into v_balances
    from private.shared_impurity_weight_balances_v1(v_group.id) b;
  if exists(select 1 from pg_catalog.jsonb_to_recordset(v_balances) as b(balance_kg numeric) where b.balance_kg < -0.001) then
    raise exception 'SHARED_WEIGHT_NEGATIVE_BALANCE' using errcode='23514'; end if;
  update public.inventory_batches ib set current_quantity=greatest(b.balance_kg,0),
    current_weight_kg=greatest(b.balance_kg,0),mass_kg=greatest(b.balance_kg,0),updated_at=pg_catalog.now()
    from pg_catalog.jsonb_to_recordset(v_balances) as b(batch_id uuid,balance_kg numeric)
    where ib.id=b.batch_id and ib.company_id=v_ticket.company_id;
  if pg_catalog.abs((select coalesce(sum(delta_qty_signed),0) from public.stock_ledger_entries
      where ticket_id=v_ticket.id)+v_net)>0.001
    or pg_catalog.abs((select coalesce(sum(delta_qty_signed),0) from public.stock_ledger_entries
      where company_id=v_ticket.company_id and inventory_batch_id=v_group.pool_inventory_batch_id))>0.001 then
    raise exception 'SHARED_WEIGHT_POSTCONDITION_FAILED' using errcode='23514';
  end if;
  return pg_catalog.jsonb_build_object('ok',true,'ticket_id',v_ticket.id,'revision_id',p_idempotency_key,
    'net_weight_kg',v_net,'stock_delta_kg',v_ticket.net_weight_kg-v_net);
end
$function$;
revoke all on function public.correct_shared_impurity_ticket_weights_v1(uuid,text,numeric,numeric,numeric,numeric,text,uuid)
  from public,anon,service_role;
grant execute on function public.correct_shared_impurity_ticket_weights_v1(uuid,text,numeric,numeric,numeric,numeric,text,uuid) to authenticated;

-- Keep canonical void validation strict: only registered, already reversed old
-- revisions are excluded from CURRENT-pointer/count checks. The existing full
-- fidelity storno check still validates ALL historical postings and reversals.
do $patch_void$
declare d text; needle text;
begin
  d := pg_catalog.replace(pg_catalog.pg_get_functiondef('private.sync_shared_impurity_pool_ticket_void_v1()'::regprocedure),pg_catalog.chr(13),'');
  needle := 'and not coalesce(base.is_storno, false)';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>3 then
    raise exception 'SHARED_WEIGHT_VOID_PATCH_CONTRACT_MISSING';
  end if;
  -- First two checks: base count and current identity/weight pointers.
  d := replace(d,'and not coalesce(base.is_storno, false);',
    'and not coalesce(base.is_storno, false)
        and not exists (select 1 from private.weighbridge_impurity_weight_revision_entries r
          where r.old_entry_id=base.id);');
  d := replace(d,'and not coalesce(base.is_storno, false)
          and (
            base.company_id',
    'and not coalesce(base.is_storno, false)
          and not exists (select 1 from private.weighbridge_impurity_weight_revision_entries r
            where r.old_entry_id=base.id)
          and (
            base.company_id');
  needle := 'where r.old_entry_id=base.id)';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then
    raise exception 'SHARED_WEIGHT_VOID_PATCH_FAILED';
  end if;
  execute d;
end $patch_void$;
commit;
