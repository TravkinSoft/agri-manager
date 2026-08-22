-- TZ297 V2: keep both processing inputs and not-yet-activated physical outputs
-- outside ordinary stock pickers until material balance closure.

create or replace function public.set_processing_output_type_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.output_type := case
    when new.line_type = 'shrink_loss' then 'moisture_loss'
    when new.line_type = 'process_loss' then 'process_loss'
    when coalesce(new.batch_class, '') = 'waste'
      or new.line_type in ('waste_fraction','soil','potato_rotten','potato_soil') then 'stock_waste'
    when new.line_type in ('forage_fraction','potato_small') then 'byproduct'
    else 'main_product'
  end;
  return new;
end;
$$;

drop trigger if exists trg_set_processing_output_type_v1 on public.batch_transformation_outputs;
create trigger trg_set_processing_output_type_v1
before insert or update of line_type, batch_class
on public.batch_transformation_outputs
for each row execute function public.set_processing_output_type_v1();

revoke all on function public.set_processing_output_type_v1() from public, anon, authenticated;

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
  sum(i.input_weight_kg)::numeric(16,3) as allocated_kg,
  'input'::text as allocation_kind
from public.batch_transformations t
join public.batch_transformation_inputs i
  on i.transformation_id = t.id
 and i.company_id = t.company_id
where t.processing_state in ('in_processing','processing_pending_outputs')
  and t.status <> 'voided'
group by t.company_id,t.id,t.season_id,t.harvest_lot_id,
  coalesce(t.source_physical_state,'SOURCE'),i.batch_id,i.warehouse_from_id

union all

select
  t.company_id,
  t.id as transformation_id,
  t.season_id,
  t.harvest_lot_id,
  coalesce(o.physical_state,
    case when t.transformation_type='drying' then 'AFTER_DRYING' else 'AFTER_CLEANING' end
  ) as source_physical_state,
  o.output_batch_id as batch_id,
  o.warehouse_to_id as warehouse_id,
  sum(o.output_weight_kg)::numeric(16,3) as allocated_kg,
  'pending_output'::text as allocation_kind
from public.batch_transformations t
join public.batch_transformation_outputs o
  on o.transformation_id = t.id
 and o.company_id = t.company_id
where t.processing_state in ('in_processing','processing_pending_outputs')
  and t.status <> 'voided'
  and o.output_type in ('main_product','byproduct','stock_waste')
  and o.output_batch_id is not null
  and o.warehouse_to_id is not null
  and o.activated_at is null
group by t.company_id,t.id,t.season_id,t.harvest_lot_id,
  coalesce(o.physical_state,
    case when t.transformation_type='drying' then 'AFTER_DRYING' else 'AFTER_CLEANING' end
  ),o.output_batch_id,o.warehouse_to_id;

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
