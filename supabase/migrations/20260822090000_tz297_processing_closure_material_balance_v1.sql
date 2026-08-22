-- TZ297 Processing closure and material balance V1.
-- Additive only: existing transformations, tickets, batches and ledger rows stay intact.

alter table public.batch_transformations
  add column if not exists season_id uuid references public.seasons(id) on delete restrict,
  add column if not exists processing_state text,
  add column if not exists finish_requested_at timestamptz,
  add column if not exists finish_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists finish_signal_source text,
  add column if not exists last_main_output_marked_at timestamptz,
  add column if not exists last_main_output_marked_by uuid references public.profiles(id) on delete set null,
  add column if not exists last_main_output_ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists closure_version text,
  add column if not exists balance_snapshot jsonb,
  add column if not exists correction_of_transformation_id uuid references public.batch_transformations(id) on delete restrict,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null;

update public.batch_transformations t
set season_id = l.season_id
from public.harvest_lots l
where t.harvest_lot_id = l.id
  and t.season_id is null;

-- The warehouse is deterministic for legacy shadow rows whose node warehouse was already recorded.
update public.batch_transformation_inputs i
set warehouse_from_id = t.node_warehouse_id,
    node_warehouse_id = coalesce(i.node_warehouse_id, t.node_warehouse_id)
from public.batch_transformations t
where i.transformation_id = t.id
  and i.warehouse_from_id is null
  and t.node_warehouse_id is not null;

update public.batch_transformations
set processing_state = case
  when status = 'completed' then 'processing_closed'
  when coalesce(output_weight_total_kg, 0) > 0
       and coalesce(input_weight_total_kg, 0) > coalesce(output_weight_total_kg, 0)
    then 'processing_pending_outputs'
  else 'in_processing'
end
where processing_state is null;

alter table public.batch_transformations
  alter column processing_state set default 'in_processing',
  alter column processing_state set not null;

alter table public.batch_transformations
  drop constraint if exists batch_transformations_processing_state_v1_check;
alter table public.batch_transformations
  add constraint batch_transformations_processing_state_v1_check
  check (processing_state in ('in_processing', 'processing_pending_outputs', 'processing_closed'));

alter table public.batch_transformations
  drop constraint if exists batch_transformations_finish_signal_source_v1_check;
alter table public.batch_transformations
  add constraint batch_transformations_finish_signal_source_v1_check
  check (finish_signal_source is null or finish_signal_source in ('operator', 'supervisor', 'legacy_classifier'));

alter table public.batch_transformation_outputs
  add column if not exists output_type text,
  add column if not exists activated_at timestamptz;

update public.batch_transformation_outputs
set output_type = case
  when line_type = 'shrink_loss' then 'moisture_loss'
  when line_type = 'process_loss' then 'process_loss'
  when coalesce(batch_class, '') = 'waste' or line_type in ('waste_fraction','soil','potato_rotten','potato_soil') then 'stock_waste'
  when line_type in ('forage_fraction','potato_small') then 'byproduct'
  else 'main_product'
end
where output_type is null;

alter table public.batch_transformation_outputs
  alter column output_type set default 'main_product',
  alter column output_type set not null;
alter table public.batch_transformation_outputs
  drop constraint if exists batch_transformation_outputs_output_type_v1_check;
alter table public.batch_transformation_outputs
  add constraint batch_transformation_outputs_output_type_v1_check
  check (output_type in ('main_product','byproduct','stock_waste','moisture_loss','process_loss'));

create table if not exists public.batch_processing_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transformation_id uuid not null references public.batch_transformations(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'user',
  actor_user_id uuid references public.profiles(id) on delete set null,
  idempotency_key text not null,
  observed_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint batch_processing_events_actor_type_v1_check check (actor_type in ('user','operator','system')),
  constraint batch_processing_events_idempotency_v1_unique unique (company_id, transformation_id, event_type, idempotency_key)
);

create index if not exists idx_batch_processing_events_timeline_v1
  on public.batch_processing_events(company_id, transformation_id, observed_at, created_at);

alter table public.batch_processing_events enable row level security;
drop policy if exists batch_processing_events_read_v1 on public.batch_processing_events;
create policy batch_processing_events_read_v1 on public.batch_processing_events
  for select to authenticated
  using (company_id = public.get_user_company_id());
revoke all on table public.batch_processing_events from public, anon;
grant select on table public.batch_processing_events to authenticated;
grant all on table public.batch_processing_events to service_role;

create table if not exists public.batch_transformation_losses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transformation_id uuid not null references public.batch_transformations(id) on delete cascade,
  loss_type text not null,
  qty_kg numeric(16,3) not null check (qty_kg > 0),
  calculation_json jsonb not null default '{}'::jsonb,
  reason text,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint batch_transformation_losses_type_v1_check check (loss_type in ('moisture_loss','dust','spillage','sampling','other')),
  constraint batch_transformation_losses_approval_v1_check check (
    (loss_type = 'moisture_loss') or
    (approved_by is not null and approved_at is not null and nullif(btrim(reason),'') is not null)
  ),
  constraint batch_transformation_losses_idempotency_v1_unique unique (company_id, transformation_id, idempotency_key)
);

create index if not exists idx_batch_transformation_losses_v1
  on public.batch_transformation_losses(company_id, transformation_id, created_at);

alter table public.batch_transformation_losses enable row level security;
drop policy if exists batch_transformation_losses_read_v1 on public.batch_transformation_losses;
create policy batch_transformation_losses_read_v1 on public.batch_transformation_losses
  for select to authenticated
  using (company_id = public.get_user_company_id());
revoke all on table public.batch_transformation_losses from public, anon;
grant select on table public.batch_transformation_losses to authenticated;
grant all on table public.batch_transformation_losses to service_role;

create unique index if not exists uq_batch_transformations_active_identity_v1
  on public.batch_transformations(
    company_id,
    coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(node_warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(processing_node_id, '00000000-0000-0000-0000-000000000000'::uuid),
    transformation_type,
    coalesce(harvest_lot_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_physical_state, 'SOURCE')
  )
  where processing_state in ('in_processing','processing_pending_outputs')
    and status <> 'voided';

create unique index if not exists uq_processing_output_source_ticket_v1
  on public.batch_transformation_outputs(company_id, source_ticket_id)
  where source_ticket_id is not null;

create or replace view public.v_processing_active_allocations_v1
with (security_invoker = true)
as
select
  t.company_id,
  t.id as transformation_id,
  t.season_id,
  t.harvest_lot_id,
  coalesce(t.source_physical_state, 'SOURCE') as source_physical_state,
  i.batch_id,
  i.warehouse_from_id as warehouse_id,
  sum(i.input_weight_kg)::numeric(16,3) as allocated_kg
from public.batch_transformations t
join public.batch_transformation_inputs i on i.transformation_id = t.id and i.company_id = t.company_id
where t.processing_state in ('in_processing','processing_pending_outputs')
  and t.status <> 'voided'
group by t.company_id,t.id,t.season_id,t.harvest_lot_id,coalesce(t.source_physical_state,'SOURCE'),i.batch_id,i.warehouse_from_id;

revoke all on table public.v_processing_active_allocations_v1 from public, anon;
grant select on table public.v_processing_active_allocations_v1 to authenticated, service_role;

create or replace view public.v_effective_stock_balance_identity_v1
with (security_invoker = true)
as
select
  s.*,
  coalesce(a.allocated_kg, 0)::numeric(16,3) as processing_allocated_kg,
  greatest(s.quantity - coalesce(a.allocated_kg, 0), 0)::numeric(16,3) as effective_available_kg
from public.v_stock_balance_identity s
left join (
  select company_id, warehouse_id, batch_id, sum(allocated_kg) as allocated_kg
  from public.v_processing_active_allocations_v1
  group by company_id, warehouse_id, batch_id
) a on a.company_id = s.company_id
   and a.warehouse_id = s.warehouse_id
   and a.batch_id::text = s.batch_id::text;

revoke all on table public.v_effective_stock_balance_identity_v1 from public, anon;
grant select on table public.v_effective_stock_balance_identity_v1 to authenticated, service_role;

create or replace function public.tz297_assert_processing_actor_v1(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_allowed_roles text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_auth_profile public.profiles%rowtype;
begin
  if v_auth is null then
    raise exception 'Authenticated session is required' using errcode='42501';
  end if;
  select * into v_actor from public.profiles where id=p_actor_user_id and coalesce(status,'active')='active';
  if not found or v_actor.company_id is distinct from p_company_id or not (v_actor.role = any(p_allowed_roles)) then
    raise exception 'PROCESSING_FORBIDDEN' using errcode='42501';
  end if;
  if v_auth <> p_actor_user_id then
    select * into v_auth_profile from public.profiles where id=v_auth and coalesce(status,'active')='active';
    if not found or v_auth_profile.role <> 'global_admin' then
      raise exception 'PROCESSING_FORBIDDEN' using errcode='42501';
    end if;
  end if;
  return v_actor.role;
end;
$$;

revoke all on function public.tz297_assert_processing_actor_v1(uuid,uuid,text[]) from public, anon, authenticated;

create or replace function public.soft_finish_processing_v1(
  p_transformation_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_now timestamptz := now();
begin
  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='22023';
  end if;
  select * into v_t from public.batch_transformations where id=p_transformation_id for update;
  if not found then raise exception 'PROCESSING_NOT_FOUND' using errcode='P0002'; end if;
  perform public.tz297_assert_processing_actor_v1(v_t.company_id,p_actor_user_id,array['global_admin','company_admin','weighman']);
  if v_t.processing_state='processing_closed' then
    raise exception 'PROCESSING_ALREADY_CLOSED' using errcode='23514';
  end if;
  insert into public.batch_processing_events(company_id,transformation_id,event_type,actor_type,actor_user_id,idempotency_key,observed_at,payload)
  values(v_t.company_id,v_t.id,'operator_soft_finish','operator',p_actor_user_id,p_idempotency_key,v_now,
    jsonb_build_object('from_state',v_t.processing_state,'to_state','processing_pending_outputs'))
  on conflict(company_id,transformation_id,event_type,idempotency_key) do nothing;
  update public.batch_transformations
  set processing_state='processing_pending_outputs', finish_requested_at=coalesce(finish_requested_at,v_now),
      finish_requested_by=coalesce(finish_requested_by,p_actor_user_id), finish_signal_source=coalesce(finish_signal_source,'operator'),
      status='draft', updated_at=v_now
  where id=v_t.id;
  return jsonb_build_object('ok',true,'transformation_id',v_t.id,'processing_state','processing_pending_outputs');
end;
$$;

revoke all on function public.soft_finish_processing_v1(uuid,uuid,text) from public, anon;
grant execute on function public.soft_finish_processing_v1(uuid,uuid,text) to authenticated, service_role;

create or replace function public.mark_processing_last_main_output_v1(
  p_transformation_id uuid,
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_ticket public.tickets%rowtype;
  v_now timestamptz := now();
begin
  select * into v_t from public.batch_transformations where id=p_transformation_id for update;
  if not found then raise exception 'PROCESSING_NOT_FOUND' using errcode='P0002'; end if;
  perform public.tz297_assert_processing_actor_v1(v_t.company_id,p_actor_user_id,array['global_admin','company_admin','weighman']);
  select * into v_ticket from public.tickets where id=p_ticket_id and company_id=v_t.company_id for update;
  if not found or not v_ticket.is_finalized or v_ticket.is_voided then
    raise exception 'PROCESSING_OUTPUT_TICKET_NOT_FINALIZED' using errcode='23514';
  end if;
  update public.tickets set linked_processing_id=v_t.id, processing_last_truck=true where id=v_ticket.id;
  update public.batch_transformations set last_main_output_marked_at=v_now,last_main_output_marked_by=p_actor_user_id,
    last_main_output_ticket_id=v_ticket.id,updated_at=v_now where id=v_t.id;
  insert into public.batch_processing_events(company_id,transformation_id,event_type,actor_type,actor_user_id,idempotency_key,observed_at,payload)
  values(v_t.company_id,v_t.id,'last_main_output_marked','operator',p_actor_user_id,p_idempotency_key,v_now,jsonb_build_object('ticket_id',v_ticket.id))
  on conflict(company_id,transformation_id,event_type,idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'transformation_id',v_t.id,'ticket_id',v_ticket.id);
end;
$$;

revoke all on function public.mark_processing_last_main_output_v1(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.mark_processing_last_main_output_v1(uuid,uuid,uuid,text) to authenticated, service_role;

create or replace function public.approve_processing_loss_v1(
  p_transformation_id uuid,
  p_loss_type text,
  p_qty_kg numeric,
  p_reason text,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_loss_id uuid;
begin
  select * into v_t from public.batch_transformations where id=p_transformation_id for update;
  if not found then raise exception 'PROCESSING_NOT_FOUND' using errcode='P0002'; end if;
  perform public.tz297_assert_processing_actor_v1(v_t.company_id,p_actor_user_id,array['global_admin','company_admin','director']);
  if v_t.processing_state='processing_closed' then raise exception 'PROCESSING_ALREADY_CLOSED' using errcode='23514'; end if;
  if p_loss_type not in ('dust','spillage','sampling','other') or coalesce(p_qty_kg,0)<=0 or nullif(btrim(p_reason),'') is null then
    raise exception 'PROCESSING_LOSS_DETAILS_REQUIRED' using errcode='22023';
  end if;
  insert into public.batch_transformation_losses(company_id,transformation_id,loss_type,qty_kg,reason,approved_by,approved_at,idempotency_key)
  values(v_t.company_id,v_t.id,p_loss_type,round(p_qty_kg,3),btrim(p_reason),p_actor_user_id,now(),p_idempotency_key)
  on conflict(company_id,transformation_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning id into v_loss_id;
  insert into public.batch_processing_events(company_id,transformation_id,event_type,actor_type,actor_user_id,idempotency_key,payload)
  values(v_t.company_id,v_t.id,'process_loss_approved','user',p_actor_user_id,p_idempotency_key,
    jsonb_build_object('loss_id',v_loss_id,'loss_type',p_loss_type,'qty_kg',round(p_qty_kg,3),'reason',btrim(p_reason)))
  on conflict(company_id,transformation_id,event_type,idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'loss_id',v_loss_id);
end;
$$;

revoke all on function public.approve_processing_loss_v1(uuid,text,numeric,text,uuid,text) from public, anon;
grant execute on function public.approve_processing_loss_v1(uuid,text,numeric,text,uuid,text) to authenticated, service_role;

create or replace function public.close_processing_material_balance_v1(
  p_transformation_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_input numeric := 0;
  v_stock_output numeric := 0;
  v_process_loss numeric := 0;
  v_input_moisture numeric;
  v_output_moisture numeric;
  v_input_coverage numeric := 0;
  v_output_coverage numeric := 0;
  v_dry_matter numeric;
  v_theoretical_output numeric;
  v_moisture_loss numeric := 0;
  v_delta numeric := 0;
  v_snapshot jsonb;
  v_now timestamptz := now();
  v_input_row record;
  v_batch public.inventory_batches%rowtype;
  v_existing_out numeric;
  v_needed_out numeric;
begin
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='22023'; end if;
  select * into v_t from public.batch_transformations where id=p_transformation_id for update;
  if not found then raise exception 'PROCESSING_NOT_FOUND' using errcode='P0002'; end if;
  perform public.tz297_assert_processing_actor_v1(v_t.company_id,p_actor_user_id,array['global_admin','company_admin','director']);
  if v_t.processing_state='processing_closed' then
    return coalesce(v_t.balance_snapshot,'{}'::jsonb) || jsonb_build_object('ok',true,'idempotent_replay',true);
  end if;
  if v_t.processing_state <> 'processing_pending_outputs' then raise exception 'PROCESSING_SOFT_FINISH_REQUIRED' using errcode='23514'; end if;

  perform 1 from public.batch_transformation_inputs where transformation_id=v_t.id order by batch_id for update;
  perform 1 from public.inventory_batches b join public.batch_transformation_inputs i on i.batch_id=b.id where i.transformation_id=v_t.id order by b.id for update of b;
  perform 1 from public.batch_transformation_outputs where transformation_id=v_t.id order by id for update;
  perform 1 from public.batch_transformation_losses where transformation_id=v_t.id order by id for update;

  if exists(select 1 from public.tickets where linked_processing_id=v_t.id and not is_voided and not is_finalized) then
    raise exception 'PROCESSING_OPEN_OUTPUT_TICKETS' using errcode='23514';
  end if;

  -- Every physical output must be backed by a finalized ticket. The ticket owns
  -- the warehouse ledger movement; closure must never manufacture undocumented stock.
  if exists(
    select 1
    from public.batch_transformation_outputs o
    left join public.tickets tk
      on tk.id=o.source_ticket_id
     and tk.company_id=o.company_id
    where o.transformation_id=v_t.id
      and o.output_type in ('main_product','byproduct','stock_waste')
      and (tk.id is null or tk.is_voided or not tk.is_finalized)
  ) then
    raise exception 'PROCESSING_OUTPUT_TICKET_REQUIRED' using errcode='23514';
  end if;

  select coalesce(sum(input_weight_kg),0),
    sum(input_weight_kg*moisture_percent) filter(where moisture_percent is not null)/nullif(sum(input_weight_kg) filter(where moisture_percent is not null),0),
    coalesce(sum(input_weight_kg) filter(where moisture_percent is not null),0)
  into v_input,v_input_moisture,v_input_coverage
  from public.batch_transformation_inputs where transformation_id=v_t.id;

  select coalesce(sum(output_weight_kg) filter(where output_type in ('main_product','byproduct','stock_waste')),0),
    sum(output_weight_kg*moisture_percent) filter(where output_type in ('main_product','byproduct') and moisture_percent is not null)
      /nullif(sum(output_weight_kg) filter(where output_type in ('main_product','byproduct') and moisture_percent is not null),0),
    coalesce(sum(output_weight_kg) filter(where output_type in ('main_product','byproduct') and moisture_percent is not null),0)
  into v_stock_output,v_output_moisture,v_output_coverage
  from public.batch_transformation_outputs where transformation_id=v_t.id;

  select coalesce(sum(qty_kg),0) into v_process_loss
  from public.batch_transformation_losses
  where transformation_id=v_t.id and loss_type<>'moisture_loss' and approved_by is not null and approved_at is not null;

  if v_input<=0 then raise exception 'PROCESSING_INPUT_REQUIRED' using errcode='23514'; end if;
  if coalesce(v_t.processing_method,'') in ('MECHANICAL_DRYING','NATURAL_DRYING') or v_t.transformation_type='drying' then
    if v_input_moisture is null or v_output_moisture is null then raise exception 'PROCESSING_DRYING_MOISTURE_REQUIRED' using errcode='23514'; end if;
    if v_output_moisture>=100 then raise exception 'PROCESSING_DRYING_MOISTURE_INVALID' using errcode='23514'; end if;
    v_dry_matter := v_input*(1-v_input_moisture/100);
    v_theoretical_output := v_dry_matter/(1-v_output_moisture/100);
    v_moisture_loss := greatest(v_input-v_theoretical_output,0);
  end if;
  v_delta := round(v_input-v_stock_output-v_process_loss-v_moisture_loss,3);
  if abs(v_delta)>0.001 then
    raise exception 'PROCESSING_BALANCE_MISMATCH|%', v_delta using errcode='23514';
  end if;

  -- Existing output tickets already own their ticket ledger. Only approved non-stock loss
  -- consumes the unresolved source balance here; no ticket movement is duplicated.
  v_needed_out := round(v_process_loss,3);
  if v_needed_out>0 then
    for v_input_row in
      select i.*, coalesce((select sum(-sle.delta_qty_signed) from public.stock_ledger_entries sle
        where sle.company_id=v_t.company_id and sle.inventory_batch_id=i.batch_id and sle.warehouse_id=i.warehouse_from_id
          and sle.delta_qty_signed<0 and coalesce(sle.is_storno,false)=false
          and (sle.processing_id=v_t.id or sle.ticket_id in (
            select o.source_ticket_id from public.batch_transformation_outputs o
            where o.transformation_id=v_t.id and o.source_ticket_id is not null
          ))),0) already_out
      from public.batch_transformation_inputs i where i.transformation_id=v_t.id order by i.batch_id
    loop
      exit when v_needed_out<=0.001;
      select * into v_batch from public.inventory_batches where id=v_input_row.batch_id;
      v_existing_out := least(v_needed_out,greatest(v_input_row.input_weight_kg-v_input_row.already_out,0));
      if v_existing_out>0 then
        insert into public.stock_ledger_entries(company_id,processing_id,product_id,crop_id,variety_id,reproduction_id,
          batch_id_text,batch_class,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,reason_ref_id,
          occurred_at,created_by,inventory_batch_id,notes)
        values(v_t.company_id,v_t.id,coalesce(v_batch.product_id,v_batch.crop_id),v_batch.crop_id,v_batch.variety_id,v_batch.reproduction_id,
          v_batch.id::text,coalesce(v_batch.batch_class,'commodity'),v_input_row.warehouse_from_id,'out',v_existing_out,'kg',-v_existing_out,
          'processing_loss',v_t.id,v_now,p_actor_user_id,v_batch.id,'TZ297 approved non-stock process loss');
        v_needed_out := v_needed_out-v_existing_out;
      end if;
    end loop;
    if v_needed_out>0.001 then raise exception 'PROCESSING_SOURCE_BALANCE_CHANGED' using errcode='40001'; end if;
  end if;

  update public.inventory_batches b set
    physical_state=case when v_t.transformation_type='drying' then 'DRIED' else 'AFTER_CLEANING' end,
    status=case when b.status='pending_processing_close' then 'conditioned' else b.status end,
    updated_at=v_now
  where b.id in (select output_batch_id from public.batch_transformation_outputs where transformation_id=v_t.id and output_batch_id is not null);

  update public.batch_transformation_outputs set activated_at=coalesce(activated_at,v_now)
  where transformation_id=v_t.id and output_type in ('main_product','byproduct','stock_waste');

  v_snapshot := jsonb_build_object(
    'algorithm_version',case when v_moisture_loss>0 then 'drying_mass_balance_v1' else 'processing_mass_balance_v1' end,
    'input_kg',round(v_input,3),'stock_outputs_kg',round(v_stock_output,3),'approved_process_loss_kg',round(v_process_loss,3),
    'moisture_loss_kg',round(v_moisture_loss,3),'balance_delta_kg',v_delta,'tolerance_kg',0,
    'input_moisture_percent',round(v_input_moisture,3),'output_moisture_percent',round(v_output_moisture,3),
    'input_moisture_coverage_kg',round(v_input_coverage,3),'output_moisture_coverage_kg',round(v_output_coverage,3),
    'closed_at',v_now,'closed_by',p_actor_user_id
  );
  update public.batch_transformations set processing_state='processing_closed',status='completed',completed_at=v_now,
    completed_by=p_actor_user_id,closed_at=v_now,closed_by=p_actor_user_id,closure_version='tz297_v1',
    balance_snapshot=v_snapshot,input_weight_total_kg=v_input,output_weight_total_kg=v_stock_output,
    input_moisture_percent=v_input_moisture,output_moisture_percent=v_output_moisture,
    input_moisture_coverage_kg=v_input_coverage,output_moisture_coverage_kg=v_output_coverage,
    expected_water_loss_kg=v_moisture_loss,mass_difference_kg=v_delta,unexplained_variance_kg=v_delta,updated_at=v_now
  where id=v_t.id;
  insert into public.batch_processing_events(company_id,transformation_id,event_type,actor_type,actor_user_id,idempotency_key,observed_at,payload)
  values(v_t.company_id,v_t.id,'material_balance_closed','user',p_actor_user_id,p_idempotency_key,v_now,v_snapshot)
  on conflict(company_id,transformation_id,event_type,idempotency_key) do nothing;
  return v_snapshot || jsonb_build_object('ok',true,'idempotent_replay',false,'transformation_id',v_t.id);
end;
$$;

revoke all on function public.close_processing_material_balance_v1(uuid,uuid,text) from public, anon;
grant execute on function public.close_processing_material_balance_v1(uuid,uuid,text) to authenticated, service_role;

create or replace function public.recompute_grain_processing_shadow_v1(p_transformation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_input numeric := 0;
  v_output numeric := 0;
  v_input_moisture numeric;
  v_output_moisture numeric;
  v_input_coverage numeric := 0;
  v_output_coverage numeric := 0;
begin
  select * into v_t from public.batch_transformations where id=p_transformation_id and shadow_mode for update;
  if not found then return; end if;
  select coalesce(sum(input_weight_kg),0),
    sum(input_weight_kg*moisture_percent) filter(where moisture_percent is not null)/nullif(sum(input_weight_kg) filter(where moisture_percent is not null),0),
    coalesce(sum(input_weight_kg) filter(where moisture_percent is not null),0)
  into v_input,v_input_moisture,v_input_coverage from public.batch_transformation_inputs where transformation_id=v_t.id;
  select coalesce(sum(output_weight_kg) filter(where output_type in ('main_product','byproduct','stock_waste')),0),
    sum(output_weight_kg*moisture_percent) filter(where moisture_percent is not null)/nullif(sum(output_weight_kg) filter(where moisture_percent is not null),0),
    coalesce(sum(output_weight_kg) filter(where moisture_percent is not null),0)
  into v_output,v_output_moisture,v_output_coverage from public.batch_transformation_outputs where transformation_id=v_t.id;
  update public.batch_transformations set input_weight_total_kg=v_input,output_weight_total_kg=v_output,
    input_moisture_percent=v_input_moisture,output_moisture_percent=v_output_moisture,
    input_moisture_coverage_kg=v_input_coverage,output_moisture_coverage_kg=v_output_coverage,
    mass_difference_kg=v_input-v_output,unexplained_variance_kg=v_input-v_output,
    shadow_status=case when processing_state='processing_closed' then 'AUTO_CLOSED'
      when processing_state='processing_pending_outputs' then 'WAITING_QUALITY' else 'ACTIVE' end,
    status=case when processing_state='processing_closed' then 'completed' else 'draft' end,
    updated_at=now()
  where id=v_t.id;
end;
$$;

revoke all on function public.recompute_grain_processing_shadow_v1(uuid) from public, anon;
grant execute on function public.recompute_grain_processing_shadow_v1(uuid) to authenticated, service_role;

create or replace view public.v_processing_legacy_residue_classifier_v1
with (security_invoker = true)
as
select t.company_id,t.id as transformation_id,t.harvest_lot_id,t.node_warehouse_id,t.transformation_type,
  coalesce(t.input_weight_total_kg,0) as input_kg,coalesce(t.output_weight_total_kg,0) as output_kg,
  greatest(coalesce(t.input_weight_total_kg,0)-coalesce(t.output_weight_total_kg,0),0) as residue_kg,
  case
    when t.processing_state='processing_closed' and t.balance_snapshot is not null then 'A'
    when t.harvest_lot_id is not null and coalesce(t.input_weight_total_kg,0)>coalesce(t.output_weight_total_kg,0) and coalesce(t.output_weight_total_kg,0)>0 then 'B'
    when t.shadow_mode and t.harvest_lot_id is not null then 'C'
    else 'D'
  end as evidence_class,
  case
    when t.processing_state='processing_closed' and t.balance_snapshot is not null then 'closed_proven'
    when t.harvest_lot_id is not null and coalesce(t.input_weight_total_kg,0)>coalesce(t.output_weight_total_kg,0) and coalesce(t.output_weight_total_kg,0)>0 then 'outputs_incomplete'
    when t.shadow_mode and t.harvest_lot_id is not null then 'processing_fate_unknown'
    else 'ambiguous_no_mutation'
  end as classifier_reason
from public.batch_transformations t;

revoke all on table public.v_processing_legacy_residue_classifier_v1 from public, anon;
grant select on table public.v_processing_legacy_residue_classifier_v1 to authenticated, service_role;
