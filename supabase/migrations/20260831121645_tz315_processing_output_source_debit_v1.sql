-- TZ315 forward material math: every physical processing output child IN gets
-- an equal ticket-linked source OUT. The existing output-close RPC is unchanged;
-- a deferred constraint trigger posts the source side only after its own
-- v_out_count=0 postcondition has completed, inside the same transaction.

create unique index if not exists uq_processing_output_source_effect_v1
  on public.stock_ledger_entries(ticket_id,inventory_batch_id,warehouse_id,reason_type)
  where ticket_id is not null
    and reason_type='processing_output_source_out'
    and not coalesce(is_storno,false);

do $migration$
declare v_indexdef text;
begin
  select lower(pg_get_indexdef(i.indexrelid)) into v_indexdef
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid=i.indexrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='uq_processing_output_source_effect_v1';
  if v_indexdef is null
     or v_indexdef !~ 'create unique index uq_processing_output_source_effect_v1 on public[.]stock_ledger_entries'
     or v_indexdef !~ '[(]ticket_id, inventory_batch_id, warehouse_id, reason_type[)]'
     or v_indexdef !~ 'ticket_id is not null'
     or v_indexdef !~ 'reason_type = ''processing_output_source_out'''
     or v_indexdef !~ 'not coalesce[(]is_storno, false[)]'
  then
    raise exception 'TZ315 source debit index definition mismatch|%',coalesce(v_indexdef,'missing') using errcode='23514';
  end if;
end
$migration$;

-- No business backfill is permitted. Stop before installing the new contract
-- if physical processing output stock already exists without its source side.
do $migration$
begin
  if exists (
    select 1
    from public.batch_transformation_outputs o
    join public.batch_transformations t on t.id=o.transformation_id and t.company_id=o.company_id
    join public.tickets tk on tk.id=o.source_ticket_id and tk.company_id=o.company_id
    where t.processing_state in ('in_processing','processing_pending_outputs','processing_closed')
      and t.status<>'voided'
      and o.output_type in ('main_product','byproduct','stock_waste')
      and o.output_weight_kg>0
      and not coalesce(tk.is_voided,false)
      and tk.is_finalized and tk.status::text='finalized'
      and abs(o.output_weight_kg-coalesce((
        select sum(-sle.delta_qty_signed)
        from public.stock_ledger_entries sle
        where sle.company_id=o.company_id and sle.processing_id=o.transformation_id
          and sle.ticket_id=o.source_ticket_id and not coalesce(sle.is_storno,false)
          and sle.reason_type='processing_output_source_out'
      ),0))>0.001
  ) then
    raise exception 'TZ315_PROCESSING_SOURCE_DEBIT_PREFLIGHT_REQUIRED|existing output has no canonical source OUT' using errcode='23514';
  end if;
end
$migration$;

create or replace function private.post_processing_output_source_debit_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_t public.batch_transformations%rowtype;
  v_ticket public.tickets%rowtype;
  v_output public.batch_transformation_outputs%rowtype;
  v_input record;
  v_batch public.inventory_batches%rowtype;
  v_needed numeric(18,6);
  v_take numeric(18,6);
  v_prior_effect numeric(18,6);
  v_ticket_effect numeric(18,6);
  v_child_net numeric(18,6);
begin
  if new.reason_type<>'processing_output_in'
     or new.direction<>'in'::public.ledger_direction
     or coalesce(new.is_storno,false)
     or new.ticket_id is null
     or new.processing_id is null
  then
    return new;
  end if;

  select * into v_ticket
  from public.tickets tk
  where tk.id=new.ticket_id and tk.company_id=new.company_id
  for update;
  if not found then
    raise exception 'PROCESSING_OUTPUT_SOURCE_TICKET_MISSING' using errcode='23514';
  end if;
  select round(new.delta_qty_signed+coalesce(sum(storno.delta_qty_signed),0),6)
  into v_child_net
  from public.stock_ledger_entries storno
  where storno.storno_of_entry_id=new.id;
  -- A create+void transaction leaves the already-created child IN neutralized;
  -- it must not create a late source debit at deferred-trigger time.
  if coalesce(v_ticket.is_voided,false) or v_ticket.status::text='voided' then
    if abs(v_child_net)>0.001 then
      raise exception 'PROCESSING_OUTPUT_VOID_STORNO_INCOMPLETE' using errcode='23514';
    end if;
    return new;
  end if;
  if not coalesce(v_ticket.is_finalized,false) or v_ticket.status::text<>'finalized' then
    raise exception 'PROCESSING_OUTPUT_SOURCE_TICKET_NOT_FINALIZED' using errcode='23514';
  end if;
  if abs(v_child_net-new.delta_qty_signed)>0.001 then
    raise exception 'PROCESSING_OUTPUT_CHILD_EFFECT_CHANGED' using errcode='40001';
  end if;

  select * into v_t
  from public.batch_transformations t
  where t.id=new.processing_id and t.company_id=new.company_id
  for update;
  if not found or v_t.processing_state not in ('in_processing','processing_pending_outputs') or v_t.status='voided' then
    raise exception 'PROCESSING_OUTPUT_SOURCE_CONTEXT_CHANGED' using errcode='40001';
  end if;
  if v_ticket.linked_processing_id is distinct from v_t.id
     or v_ticket.season_id is distinct from v_t.season_id
  then
    raise exception 'PROCESSING_OUTPUT_SOURCE_TICKET_CONTEXT_MISMATCH' using errcode='23514';
  end if;

  select * into v_output
  from public.batch_transformation_outputs o
  where o.company_id=new.company_id and o.transformation_id=v_t.id
    and o.source_ticket_id=new.ticket_id
    and o.output_batch_id=new.inventory_batch_id
    and o.warehouse_to_id=new.warehouse_id
    and o.output_type in ('main_product','byproduct','stock_waste')
  for update;
  if not found or abs(v_output.output_weight_kg-new.delta_qty_signed)>0.001 then
    raise exception 'PROCESSING_OUTPUT_SOURCE_DOCUMENT_MISMATCH' using errcode='23514';
  end if;

  select round(coalesce(sum(-effect.delta_qty_signed),0),6)
  into v_ticket_effect
  from public.stock_ledger_entries effect
  where effect.company_id=new.company_id and effect.processing_id=v_t.id
    and effect.ticket_id=new.ticket_id
    and (
      (not coalesce(effect.is_storno,false) and effect.reason_type='processing_output_source_out')
      or effect.storno_of_entry_id in (
        select base.id from public.stock_ledger_entries base
        where base.company_id=new.company_id and base.processing_id=v_t.id
          and base.ticket_id=new.ticket_id and base.reason_type='processing_output_source_out'
          and not coalesce(base.is_storno,false)
      )
    );
  if abs(v_ticket_effect-new.delta_qty_signed)<=0.001 then return new; end if;
  if abs(v_ticket_effect)>0.001 then
    raise exception 'PROCESSING_OUTPUT_SOURCE_IDEMPOTENCY_CONFLICT' using errcode='23514';
  end if;

  perform 1 from public.batch_transformation_inputs i
  where i.transformation_id=v_t.id order by i.batch_id,i.warehouse_from_id,i.id for update;
  perform 1 from public.inventory_batches b
  where b.id in (select i.batch_id from public.batch_transformation_inputs i where i.transformation_id=v_t.id)
  order by b.id for update;

  v_needed:=round(new.delta_qty_signed,6);
  for v_input in
    select i.batch_id,i.warehouse_from_id,sum(i.input_weight_kg)::numeric(18,6) input_weight_kg
    from public.batch_transformation_inputs i
    where i.transformation_id=v_t.id
    group by i.batch_id,i.warehouse_from_id
    order by min(i.created_at),i.batch_id,i.warehouse_from_id
  loop
    exit when v_needed<=0.001;
    select * into v_batch from public.inventory_batches b where b.id=v_input.batch_id;
    if not found
       or v_batch.company_id is distinct from v_t.company_id
       or v_batch.season_id is distinct from v_t.season_id
       or v_batch.warehouse_id is distinct from v_input.warehouse_from_id
    then
      raise exception 'PROCESSING_OUTPUT_SOURCE_BATCH_MISMATCH' using errcode='23514';
    end if;

    select round(coalesce(sum(-effect.delta_qty_signed),0),6)
    into v_prior_effect
    from public.stock_ledger_entries effect
    where effect.company_id=v_t.company_id and effect.processing_id=v_t.id
      and effect.inventory_batch_id=v_input.batch_id and effect.warehouse_id=v_input.warehouse_from_id
      and (
        (not coalesce(effect.is_storno,false) and effect.reason_type in
          ('processing_output_source_out','processing_moisture_loss','processing_loss'))
        or effect.storno_of_entry_id in (
          select base.id from public.stock_ledger_entries base
          where base.company_id=v_t.company_id and base.processing_id=v_t.id
            and base.inventory_batch_id=v_input.batch_id and base.warehouse_id=v_input.warehouse_from_id
            and base.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss')
            and not coalesce(base.is_storno,false)
        )
      );
    v_take:=least(v_needed,greatest(v_input.input_weight_kg-v_prior_effect,0));
    if v_take>0 then
      insert into public.stock_ledger_entries(
        company_id,ticket_id,processing_id,product_id,crop_id,variety_id,reproduction_id,
        batch_id,batch_id_text,batch_class,warehouse_id,direction,quantity,uom,delta_qty_signed,
        reason_type,reason_ref_id,occurred_at,created_by,inventory_batch_id,notes,mass_kg,
        unit_source,unit_contract_version
      ) values (
        v_t.company_id,new.ticket_id,v_t.id,coalesce(v_batch.product_id,v_batch.crop_id),v_batch.crop_id,
        v_batch.variety_id,v_batch.reproduction_id,v_batch.id::text,v_batch.id::text,
        coalesce(v_batch.batch_class,'commodity'),v_input.warehouse_from_id,'out',v_take,'kg',-v_take,
        'processing_output_source_out',new.ticket_id,new.occurred_at,new.created_by,v_batch.id,
        'TZ315 canonical processing output source debit',v_take,'processing.output_source',2
      );
      v_needed:=v_needed-v_take;
    end if;
  end loop;
  if v_needed>0.001 then raise exception 'PROCESSING_SOURCE_BALANCE_CHANGED' using errcode='40001'; end if;

  select round(coalesce(sum(-sle.delta_qty_signed),0),6) into v_ticket_effect
  from public.stock_ledger_entries sle
  where sle.company_id=v_t.company_id and sle.processing_id=v_t.id and sle.ticket_id=new.ticket_id
    and sle.reason_type='processing_output_source_out' and not coalesce(sle.is_storno,false);
  if abs(v_ticket_effect-new.delta_qty_signed)>0.001 then
    raise exception 'PROCESSING_OUTPUT_SOURCE_POSTCONDITION|%|%',v_ticket_effect,new.delta_qty_signed using errcode='23514';
  end if;

  for v_input in
    select distinct i.batch_id from public.batch_transformation_inputs i
    where i.transformation_id=v_t.id and i.batch_id is not null order by i.batch_id
  loop
    if exists(select 1 from public.harvest_lot_batches hlb where hlb.inventory_batch_id=v_input.batch_id) then
      perform private.reconcile_harvest_lot_batch_balance_v1(v_input.batch_id);
    else
      perform private.reconcile_warehouse_local_batch_balance_v1(v_input.batch_id);
    end if;
  end loop;
  return new;
end
$function$;

revoke all on function private.post_processing_output_source_debit_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_processing_output_source_debit_v1 on public.stock_ledger_entries;
create constraint trigger trg_processing_output_source_debit_v1
after insert on public.stock_ledger_entries
deferrable initially deferred
for each row
when (
  new.reason_type='processing_output_in'
  and new.direction='in'::public.ledger_direction
  and not coalesce(new.is_storno,false)
)
execute function private.post_processing_output_source_debit_v1();

create or replace function private.processing_output_ticket_trace_valid_v2(p_output_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select
      1=(select count(*) from public.stock_ledger_entries sle
        where not coalesce(sle.is_storno,false) and sle.ticket_id=o.source_ticket_id
          and sle.processing_id=o.transformation_id and sle.inventory_batch_id=o.output_batch_id
          and sle.warehouse_id=o.warehouse_to_id and sle.direction='in'::public.ledger_direction
          and sle.reason_type='processing_output_in'
          and abs(sle.delta_qty_signed-o.output_weight_kg)<=0.001)
      and abs(o.output_weight_kg-coalesce((select sum(-sle.delta_qty_signed)
        from public.stock_ledger_entries sle
        where not coalesce(sle.is_storno,false) and sle.ticket_id=o.source_ticket_id
          and sle.processing_id=o.transformation_id and sle.direction='out'::public.ledger_direction
          and sle.reason_type='processing_output_source_out'),0))<=0.001
      and not exists(
        select 1 from public.stock_ledger_entries sle
        where not coalesce(sle.is_storno,false) and sle.ticket_id=o.source_ticket_id
          and not (
            (sle.processing_id=o.transformation_id and sle.inventory_batch_id=o.output_batch_id
              and sle.warehouse_id=o.warehouse_to_id and sle.direction='in'::public.ledger_direction
              and sle.reason_type='processing_output_in')
            or
            (sle.processing_id=o.transformation_id and sle.direction='out'::public.ledger_direction
              and sle.reason_type='processing_output_source_out'
              and exists(select 1 from public.batch_transformation_inputs i
                where i.transformation_id=o.transformation_id and i.batch_id=sle.inventory_batch_id
                  and i.warehouse_from_id=sle.warehouse_id))
          )
      )
    from public.batch_transformation_outputs o where o.id=p_output_id
  ),false)
$function$;

revoke all on function private.processing_output_ticket_trace_valid_v2(uuid)
  from public,anon,authenticated,service_role;

-- The output document is immutable, including after a pre-close ticket void.
-- The shadow is operational state, so only non-voided source tickets count.
create or replace function public.recompute_grain_processing_shadow_v1(p_transformation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_t public.batch_transformations%rowtype;
  v_input numeric := 0;
  v_output numeric := 0;
  v_input_moisture numeric;
  v_output_moisture numeric;
  v_input_coverage numeric := 0;
  v_output_coverage numeric := 0;
begin
  select * into v_t
  from public.batch_transformations
  where id=p_transformation_id and shadow_mode
  for update;
  if not found then return; end if;
  if v_t.status='voided' then return; end if;

  select coalesce(sum(input_weight_kg),0),
    sum(input_weight_kg*moisture_percent) filter(where moisture_percent is not null)
      /nullif(sum(input_weight_kg) filter(where moisture_percent is not null),0),
    coalesce(sum(input_weight_kg) filter(where moisture_percent is not null),0)
  into v_input,v_input_moisture,v_input_coverage
  from public.batch_transformation_inputs
  where transformation_id=v_t.id;

  select coalesce(sum(o.output_weight_kg) filter(where o.output_type in ('main_product','byproduct','stock_waste')),0),
    sum(o.output_weight_kg*o.moisture_percent) filter(where o.moisture_percent is not null)
      /nullif(sum(o.output_weight_kg) filter(where o.moisture_percent is not null),0),
    coalesce(sum(o.output_weight_kg) filter(where o.moisture_percent is not null),0)
  into v_output,v_output_moisture,v_output_coverage
  from public.batch_transformation_outputs o
  join public.tickets tk on tk.id=o.source_ticket_id and tk.company_id=o.company_id
  where o.transformation_id=v_t.id
    and not coalesce(tk.is_voided,false)
    and tk.status::text<>'voided';

  update public.batch_transformations set
    input_weight_total_kg=v_input,output_weight_total_kg=v_output,
    input_moisture_percent=v_input_moisture,output_moisture_percent=v_output_moisture,
    input_moisture_coverage_kg=v_input_coverage,output_moisture_coverage_kg=v_output_coverage,
    mass_difference_kg=v_input-v_output,unexplained_variance_kg=v_input-v_output,
    shadow_status=case when processing_state='processing_closed' then 'AUTO_CLOSED'
      when processing_state='processing_pending_outputs' then 'WAITING_QUALITY' else 'ACTIVE' end,
    status=case when processing_state='processing_closed' then 'completed' else 'draft' end,
    updated_at=now()
  where id=v_t.id;
end
$function$;

revoke all on function public.recompute_grain_processing_shadow_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.recompute_grain_processing_shadow_v1(uuid) to service_role;

-- Compatible with both the legacy void RPC and the newer canonical
-- WEIGHBRIDGE_VOID_PROCESSING_CYCLE body: recompute only after the ticket row
-- becomes voided, without rewriting either RPC.
create or replace function private.recompute_processing_shadow_after_ticket_void_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.linked_processing_id is not null
     and (coalesce(new.is_voided,false) or new.status::text='voided')
     and not (coalesce(old.is_voided,false) or old.status::text='voided')
     and exists(
       select 1 from public.batch_transformations t
       where t.id=new.linked_processing_id and t.company_id=new.company_id
     )
  then
    perform public.recompute_grain_processing_shadow_v1(new.linked_processing_id);
  end if;
  return new;
end
$function$;

revoke all on function private.recompute_processing_shadow_after_ticket_void_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_processing_output_void_shadow_v1 on public.tickets;
create trigger trg_processing_output_void_shadow_v1
after update of is_voided,status on public.tickets
for each row
when (new.linked_processing_id is not null)
execute function private.recompute_processing_shadow_after_ticket_void_v1();

-- Pending output reservations use the same active-document definition as
-- remaining/shadow math, so a voided output releases its child allocation.
create or replace view public.v_processing_active_allocations_v1
with (security_invoker = true)
as
select
  t.company_id,t.id as transformation_id,t.season_id,t.harvest_lot_id,
  coalesce(t.source_physical_state,'SOURCE') as source_physical_state,
  i.batch_id,i.warehouse_from_id as warehouse_id,
  sum(i.input_weight_kg)::numeric(16,3) as allocated_kg,
  'input'::text as allocation_kind
from public.batch_transformations t
join public.batch_transformation_inputs i
  on i.transformation_id=t.id and i.company_id=t.company_id
where t.processing_state in ('in_processing','processing_pending_outputs')
  and t.status<>'voided'
group by t.company_id,t.id,t.season_id,t.harvest_lot_id,
  coalesce(t.source_physical_state,'SOURCE'),i.batch_id,i.warehouse_from_id

union all

select
  t.company_id,t.id as transformation_id,t.season_id,t.harvest_lot_id,
  coalesce(o.physical_state,
    case when t.transformation_type='drying' then 'AFTER_DRYING' else 'AFTER_CLEANING' end
  ) as source_physical_state,
  o.output_batch_id as batch_id,o.warehouse_to_id as warehouse_id,
  sum(o.output_weight_kg)::numeric(16,3) as allocated_kg,
  'pending_output'::text as allocation_kind
from public.batch_transformations t
join public.batch_transformation_outputs o
  on o.transformation_id=t.id and o.company_id=t.company_id
join public.tickets tk
  on tk.id=o.source_ticket_id and tk.company_id=o.company_id
where t.processing_state in ('in_processing','processing_pending_outputs')
  and t.status<>'voided'
  and not coalesce(tk.is_voided,false)
  and tk.is_finalized and tk.status::text='finalized'
  and o.output_type in ('main_product','byproduct','stock_waste')
  and o.output_batch_id is not null and o.warehouse_to_id is not null
  and o.activated_at is null
group by t.company_id,t.id,t.season_id,t.harvest_lot_id,
  coalesce(o.physical_state,
    case when t.transformation_type='drying' then 'AFTER_DRYING' else 'AFTER_CLEANING' end
  ),o.output_batch_id,o.warehouse_to_id;

revoke all on table public.v_processing_active_allocations_v1 from public,anon;
grant select on table public.v_processing_active_allocations_v1 to authenticated,service_role;

-- Both remaining-before and remaining-after in the existing atomic close RPC
-- must ignore immutable output rows whose source ticket was voided.
do $migration$
declare
  v_definition text;
  v_pattern constant text := E'from\\s+public\\.batch_transformation_outputs\\s+where\\s+company_id\\s*=\\s*v_ticket\\.company_id\\s+and\\s+transformation_id\\s*=\\s*v_transformation\\.id;';
  v_new constant text := E'  from public.batch_transformation_outputs o\n  join public.tickets output_ticket\n    on output_ticket.id=o.source_ticket_id and output_ticket.company_id=o.company_id\n  where o.company_id = v_ticket.company_id\n    and o.transformation_id = v_transformation.id\n    and not coalesce(output_ticket.is_voided,false)\n    and output_ticket.status::text <> ''voided'';';
  v_count integer;
begin
  select pg_get_functiondef('public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)'::regprocedure)
  into v_definition;
  if position('output_ticket.status::text <> ''voided''' in v_definition)>0 then return; end if;
  select count(*) into v_count from regexp_matches(v_definition,v_pattern,'g');
  if v_count<>2 then
    raise exception 'TZ315 output remaining preflight failed: expected before/after immutable-output sum anchors';
  end if;
  v_definition:=regexp_replace(v_definition,v_pattern,v_new,'g');
  execute v_definition;
end
$migration$;

-- Replace only the obsolete "one total ledger row per output ticket" clause in
-- the already-released reversal RPC. The separate exact child-IN check remains.
do $migration$
declare
  v_definition text;
  v_pattern constant text := E'or\\s+1\\s*<>\\s*\\(\\s*select\\s+count\\(\\*\\)\\s+from\\s+public\\.stock_ledger_entries\\s+sle\\s+where\\s+not\\s+coalesce\\(sle\\.is_storno,\\s*false\\)\\s+and\\s+sle\\.ticket_id\\s*=\\s*o\\.source_ticket_id\\s*\\)';
  v_new constant text := '        or not private.processing_output_ticket_trace_valid_v2(o.id)';
  v_count integer;
begin
  select pg_get_functiondef('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure)
  into v_definition;
  if position('processing_output_ticket_trace_valid_v2(o.id)' in v_definition)>0 then return; end if;
  select count(*) into v_count from regexp_matches(v_definition,v_pattern,'g');
  if v_count<>1 then
    raise exception 'TZ315 source debit reversal preflight failed: expected exactly one trace anchor, got %',v_count;
  end if;
  execute regexp_replace(v_definition,v_pattern,v_new,'g');
end
$migration$;

-- Reversal must prove the immutable measured-drying document matches its
-- no-ticket physical source debit, just as it already proves approved loss.
do $migration$
declare
  v_definition text;
  v_pattern constant text := E'and\\s+sle\\.reason_type\\s*=\\s*''processing_loss''\\s+and\\s+sle\\.direction\\s*=\\s*''out''::public\\.ledger_direction\\s*\\),\\s*0\\)\\s*\\)\\s*>\\s*0\\.001\\s+then';
  v_new constant text := E'        and sle.reason_type = ''processing_loss''\n        and sle.direction = ''out''::public.ledger_direction\n    ), 0)\n  ) > 0.001\n  or abs(\n    coalesce((select sum(l.qty_kg) from public.batch_transformation_losses l\n      where l.transformation_id=v_t.id and l.loss_type=''moisture_loss''),0)\n    - coalesce((select sum(-sle.delta_qty_signed) from public.stock_ledger_entries sle\n      where sle.processing_id=v_t.id and sle.ticket_id is null\n        and not coalesce(sle.is_storno,false)\n        and sle.reason_type=''processing_moisture_loss''\n        and sle.direction=''out''::public.ledger_direction),0)\n  ) > 0.001 then';
  v_count integer;
begin
  select pg_get_functiondef('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure)
  into v_definition;
  if position('sle.reason_type=''processing_moisture_loss''' in v_definition)>0 then return; end if;
  select count(*) into v_count from regexp_matches(v_definition,v_pattern,'g');
  if v_count<>1 then
    raise exception 'TZ315 moisture-loss reversal trace preflight failed';
  end if;
  execute regexp_replace(v_definition,v_pattern,v_new,'g');
end
$migration$;

-- Generic ticket storno predates physical batch reconciliation. Add a bounded
-- post-storno pass over only the ticket's base ledger batches. This restores
-- the source and child balances immediately when an active-cycle output is
-- voided, while preserving the immutable output document.
do $migration$
declare
  v_definition text;
  v_declare_old constant text := E'  v_actor_role text;';
  v_declare_new constant text := E'  v_actor_role text;\n  v_reconcile_batch_id uuid;';
  v_anchor constant text := E'  end loop;\n\n  update public.field_material_consumptions';
  v_reconcile constant text := E'  end loop;\n\n  -- TZ315_PROCESSING_OUTPUT_VOID_RECONCILE_V1\n  for v_reconcile_batch_id in\n    select distinct sle.inventory_batch_id\n    from public.stock_ledger_entries sle\n    where sle.ticket_id=p_ticket_id\n      and not coalesce(sle.is_storno,false)\n      and sle.inventory_batch_id is not null\n    order by sle.inventory_batch_id\n  loop\n    if exists(select 1 from public.harvest_lot_batches hlb where hlb.inventory_batch_id=v_reconcile_batch_id) then\n      perform private.reconcile_harvest_lot_batch_balance_v1(v_reconcile_batch_id);\n    else\n      perform private.reconcile_warehouse_local_batch_balance_v1(v_reconcile_batch_id);\n    end if;\n  end loop;\n\n  update public.field_material_consumptions';
begin
  select pg_get_functiondef('public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure)
  into v_definition;
  if position('WEIGHBRIDGE_VOID_PROCESSING_CYCLE' in v_definition)>0 then return; end if;
  if position('TZ315_PROCESSING_OUTPUT_VOID_RECONCILE_V1' in v_definition)>0 then return; end if;
  if position(v_declare_old in v_definition)=0
     or length(v_definition)-length(replace(v_definition,v_declare_old,''))<>length(v_declare_old)
     or position(v_anchor in v_definition)=0
     or length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor)
  then
    raise exception 'TZ315 output void reconcile preflight failed: canonical anchors changed';
  end if;
  v_definition:=replace(v_definition,v_declare_old,v_declare_new);
  v_definition:=replace(v_definition,v_anchor,v_reconcile);
  execute v_definition;
end
$migration$;

-- A finalized processing output cannot be invalidated ticket-by-ticket in any
-- cycle state. Whole-cycle reversal creates all storno rows first, so its
-- document-void pass is allowed by the no-unstornoed-base condition below.
do $migration$
declare
  v_definition text;
  v_anchor constant text := E'  if v_ticket.is_voided or v_ticket.status = ''voided'' then\n    return p_ticket_id;\n  end if;';
  v_guard constant text := E'\n\n  if v_ticket.linked_processing_id is not null\n     and exists (\n       select 1 from public.batch_transformation_outputs o\n       where o.transformation_id=v_ticket.linked_processing_id\n         and o.company_id=v_ticket.company_id and o.source_ticket_id=v_ticket.id\n     )\n     and exists (\n       select 1 from public.stock_ledger_entries base\n       where base.ticket_id=v_ticket.id and not coalesce(base.is_storno,false)\n         and not exists(select 1 from public.stock_ledger_entries reversal where reversal.storno_of_entry_id=base.id)\n     )\n  then\n    raise exception ''PROCESSING_OUTPUT_CYCLE_REVERSAL_REQUIRED'' using errcode=''23514'';\n  end if;';
begin
  select pg_get_functiondef('public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure) into v_definition;
  if position('WEIGHBRIDGE_VOID_PROCESSING_CYCLE' in v_definition)>0 then return; end if;
  if position('PROCESSING_OUTPUT_CYCLE_REVERSAL_REQUIRED' in v_definition)>0 then return; end if;
  if position(v_anchor in v_definition)=0 then
    raise exception 'TZ315 source debit void guard preflight failed: expected anchor is absent';
  end if;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'TZ315 source debit void guard preflight failed: expected exactly one anchor';
  end if;
  execute replace(v_definition,v_anchor,v_anchor||v_guard);
end
$migration$;

comment on function public.void_ticket_with_storno_v2(uuid,uuid,text)
  is 'Canonical ticket storno; TZ315 blocks isolated void of any finalized processing output and requires whole-cycle reversal.';
