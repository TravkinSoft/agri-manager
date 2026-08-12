begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.harvest_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lot_code text not null default ('HL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  season_id uuid references public.seasons(id) on delete restrict,
  source_field_id uuid references public.fields(id) on delete restrict,
  crop_id uuid references public.crops(id) on delete restrict,
  variety_id uuid references public.varieties(id) on delete restrict,
  reproduction_id uuid references public.seed_reproductions(id) on delete restrict,
  composition_hash text,
  identity_kind text not null check (identity_kind in ('crop', 'crop_mix', 'provisional')),
  identity_key text not null,
  review_state text not null default 'confirmed' check (review_state in ('confirmed', 'requires_review')),
  review_reasons text[] not null default array[]::text[],
  resolution_locked boolean not null default false,
  status text not null default 'active' check (status in ('active', 'merged', 'archived')),
  merged_into_lot_id uuid references public.harvest_lots(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, lot_code)
);

create unique index if not exists harvest_lots_confirmed_identity_idx
  on public.harvest_lots (company_id, identity_key)
  where status = 'active' and identity_kind <> 'provisional';
create index if not exists harvest_lots_company_status_idx
  on public.harvest_lots (company_id, status, created_at desc);

create table if not exists public.harvest_lot_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  harvest_lot_id uuid not null references public.harvest_lots(id) on delete restrict,
  inventory_batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  source_ticket_id uuid references public.tickets(id) on delete restrict,
  crop_structure_id uuid references public.crop_structure(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  assignment_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_batch_id)
);

create index if not exists harvest_lot_batches_lot_idx
  on public.harvest_lot_batches (company_id, harvest_lot_id, created_at);

alter table public.harvest_lots enable row level security;
alter table public.harvest_lot_batches enable row level security;

drop policy if exists harvest_lots_company_select_v1 on public.harvest_lots;
create policy harvest_lots_company_select_v1 on public.harvest_lots
for select to authenticated
using (
  company_id = public.get_user_company_id()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'global_admin')
);

drop policy if exists harvest_lot_batches_company_select_v1 on public.harvest_lot_batches;
create policy harvest_lot_batches_company_select_v1 on public.harvest_lot_batches
for select to authenticated
using (
  company_id = public.get_user_company_id()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'global_admin')
);

revoke all on table public.harvest_lots from public, anon;
revoke all on table public.harvest_lot_batches from public, anon;
grant select on table public.harvest_lots to authenticated;
grant select on table public.harvest_lot_batches to authenticated;

drop trigger if exists trg_harvest_lots_updated_at on public.harvest_lots;
create trigger trg_harvest_lots_updated_at
before update on public.harvest_lots
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_harvest_lot_batches_updated_at on public.harvest_lot_batches;
create trigger trg_harvest_lot_batches_updated_at
before update on public.harvest_lot_batches
for each row execute function public.update_updated_at_column();

create or replace function public.ensure_harvest_lot_for_batch_v1(p_inventory_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_batch public.inventory_batches%rowtype;
  v_ticket public.tickets%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_season_id uuid;
  v_field_id uuid;
  v_identity_kind text;
  v_identity_key text;
  v_review_reasons text[] := array[]::text[];
  v_confirmed boolean := false;
begin
  select * into v_batch from public.inventory_batches
  where id = p_inventory_batch_id for update;
  if not found or v_batch.origin_type <> 'harvest' then return null; end if;

  if exists (select 1 from public.harvest_lot_batches where inventory_batch_id = v_batch.id) then
    select hl.* into v_lot
    from public.harvest_lots hl
    join public.harvest_lot_batches hlb on hlb.harvest_lot_id = hl.id
    where hlb.inventory_batch_id = v_batch.id;
    return v_lot.id;
  end if;

  select * into v_ticket from public.tickets
  where id = v_batch.source_ticket_id and company_id = v_batch.company_id;
  v_season_id := coalesce(v_batch.season_id, v_ticket.season_id);
  v_field_id := coalesce(v_batch.source_field_id, v_ticket.field_id);

  if coalesce(v_batch.is_mixed_harvest, false) then
    v_identity_kind := 'crop_mix';
    if v_season_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_season'); end if;
    if v_field_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_field'); end if;
    if nullif(v_batch.composition_hash, '') is null then v_review_reasons := array_append(v_review_reasons, 'missing_composition'); end if;
    v_confirmed := cardinality(v_review_reasons) = 0;
    v_identity_key := case when v_confirmed then
      encode(extensions.digest(concat_ws('|', 'crop_mix', v_batch.company_id, v_season_id, v_field_id, v_batch.composition_hash), 'sha256'), 'hex')
      else 'provisional:' || v_batch.id::text end;
  else
    v_identity_kind := 'crop';
    if v_season_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_season'); end if;
    if v_field_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_field'); end if;
    if v_batch.crop_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_crop'); end if;
    if v_batch.variety_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_variety'); end if;
    if v_batch.reproduction_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_reproduction'); end if;
    v_confirmed := cardinality(v_review_reasons) = 0;
    v_identity_key := case when v_confirmed then
      encode(extensions.digest(concat_ws('|', 'crop', v_batch.company_id, v_season_id, v_field_id, v_batch.crop_id, v_batch.variety_id, v_batch.reproduction_id), 'sha256'), 'hex')
      else 'provisional:' || v_batch.id::text end;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_batch.company_id::text || ':' || v_identity_key, 0));
  if v_confirmed then
    select * into v_lot from public.harvest_lots
    where company_id = v_batch.company_id and identity_key = v_identity_key
      and identity_kind <> 'provisional' and status = 'active'
    limit 1 for update;
  end if;

  if not found or not v_confirmed then
    insert into public.harvest_lots (
      company_id, season_id, source_field_id, crop_id, variety_id, reproduction_id,
      composition_hash, identity_kind, identity_key, review_state, review_reasons,
      resolution_locked
    ) values (
      v_batch.company_id, v_season_id, v_field_id, v_batch.crop_id, v_batch.variety_id,
      v_batch.reproduction_id, nullif(v_batch.composition_hash, ''),
      case when v_confirmed then v_identity_kind else 'provisional' end,
      v_identity_key,
      case when v_confirmed then 'confirmed' else 'requires_review' end,
      v_review_reasons,
      not v_confirmed
    ) returning * into v_lot;
  end if;

  insert into public.harvest_lot_batches (
    company_id, harvest_lot_id, inventory_batch_id, source_ticket_id, crop_structure_id,
    assignment_reason
  ) values (
    v_batch.company_id, v_lot.id, v_batch.id, v_batch.source_ticket_id,
    v_batch.crop_structure_id,
    case when v_confirmed then 'automatic_confirmed_identity' else 'automatic_provisional_trip' end
  ) on conflict (inventory_batch_id) do nothing;

  return v_lot.id;
end
$function$;

revoke all on function public.ensure_harvest_lot_for_batch_v1(uuid) from public, anon, authenticated;

create or replace function public.attach_harvest_batch_to_lot_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.origin_type = 'harvest' then
    perform public.ensure_harvest_lot_for_batch_v1(new.id);
  end if;
  return new;
end
$function$;

revoke all on function public.attach_harvest_batch_to_lot_v1() from public, anon, authenticated;
drop trigger if exists attach_harvest_batch_to_lot_v1 on public.inventory_batches;
create trigger attach_harvest_batch_to_lot_v1
after insert on public.inventory_batches
for each row execute function public.attach_harvest_batch_to_lot_v1();

create or replace function public.populate_harvest_inventory_batch_ledger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_batch_id uuid;
begin
  if new.inventory_batch_id is not null then return new; end if;
  if new.batch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select ib.id into v_batch_id from public.inventory_batches ib
    where ib.id = new.batch_id_text::uuid and ib.company_id = new.company_id
      and ib.origin_type = 'harvest';
  end if;
  if v_batch_id is null and new.ticket_id is not null then
    select ib.id into v_batch_id from public.inventory_batches ib
    where ib.source_ticket_id = new.ticket_id and ib.company_id = new.company_id
      and ib.origin_type = 'harvest'
    order by ib.created_at, ib.id limit 1;
  end if;
  new.inventory_batch_id := v_batch_id;
  return new;
end
$function$;

revoke all on function public.populate_harvest_inventory_batch_ledger_v1() from public, anon, authenticated;
drop trigger if exists zz_populate_harvest_inventory_batch_ledger_v1 on public.stock_ledger_entries;
create trigger zz_populate_harvest_inventory_batch_ledger_v1
before insert or update of ticket_id, batch_id_text, inventory_batch_id
on public.stock_ledger_entries
for each row execute function public.populate_harvest_inventory_batch_ledger_v1();

do $backfill$
declare
  v_id uuid;
begin
  for v_id in
    select ib.id from public.inventory_batches ib
    where ib.origin_type = 'harvest'
    order by ib.created_at, ib.id
  loop
    perform public.ensure_harvest_lot_for_batch_v1(v_id);
  end loop;
end
$backfill$;

create or replace function public.reassign_harvest_batch_lot_v1(
  p_inventory_batch_id uuid,
  p_destination_lot_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_link public.harvest_lot_batches%rowtype;
  v_destination public.harvest_lots%rowtype;
  v_source_lot_id uuid;
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','director') then
    raise exception 'Harvest lot reassignment is not allowed' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Reassignment reason is required' using errcode = '22023';
  end if;
  select * into v_link from public.harvest_lot_batches
  where inventory_batch_id = p_inventory_batch_id for update;
  if not found then raise exception 'Harvest trip batch is not assigned' using errcode = '23503'; end if;
  select * into v_destination from public.harvest_lots
  where id = p_destination_lot_id and company_id = v_link.company_id and status = 'active'
  for update;
  if not found then raise exception 'Destination harvest lot is unavailable' using errcode = '23503'; end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from v_link.company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  v_source_lot_id := v_link.harvest_lot_id;
  if v_source_lot_id = v_destination.id then
    return jsonb_build_object('ok', true, 'changed', false, 'lot_id', v_destination.id);
  end if;

  update public.harvest_lot_batches
  set harvest_lot_id = v_destination.id,
      assigned_by = v_actor.id,
      assignment_reason = btrim(p_reason),
      updated_at = now()
  where id = v_link.id;

  if not exists (select 1 from public.harvest_lot_batches where harvest_lot_id = v_source_lot_id) then
    update public.harvest_lots
    set status = 'merged', merged_into_lot_id = v_destination.id, updated_at = now()
    where id = v_source_lot_id and status = 'active';
  end if;

  insert into public.audit_log (company_id, who, entity_type, entity_id, action, new_values)
  values (
    v_link.company_id, v_actor.id, 'harvest_lot_assignment', v_link.id,
    'controlled_reassignment',
    jsonb_build_object('inventory_batch_id', p_inventory_batch_id, 'from_lot_id', v_source_lot_id,
      'to_lot_id', v_destination.id, 'reason', btrim(p_reason))
  );
  return jsonb_build_object('ok', true, 'changed', true, 'lot_id', v_destination.id);
end
$function$;

revoke all on function public.reassign_harvest_batch_lot_v1(uuid, uuid, text) from public, anon;
grant execute on function public.reassign_harvest_batch_lot_v1(uuid, uuid, text) to authenticated;

create or replace view public.v_harvest_lot_stock_v1
with (security_invoker = true)
as
with resolved_ledger as (
  select
    sle.company_id,
    resolved.inventory_batch_id,
    sle.warehouse_id,
    sle.delta_qty_signed
  from public.stock_ledger_entries sle
  join lateral (
    select ib.id as inventory_batch_id
    from public.inventory_batches ib
    where ib.company_id = sle.company_id
      and ib.origin_type = 'harvest'
      and (
        ib.id = sle.inventory_batch_id
        or (
          sle.inventory_batch_id is null
          and ib.id = case
            when sle.batch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then sle.batch_id_text::uuid
            else null
          end
        )
        or (
          sle.inventory_batch_id is null
          and sle.ticket_id is not null
          and ib.source_ticket_id = sle.ticket_id
        )
      )
    order by
      case
        when ib.id = sle.inventory_batch_id then 0
        when ib.id = case
          when sle.batch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then sle.batch_id_text::uuid
          else null
        end then 1
        else 2
      end,
      ib.created_at,
      ib.id
    limit 1
  ) resolved on true
),
ledger_by_batch as (
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
  count(distinct hlb.inventory_batch_id)::integer as trip_count,
  coalesce(sum(lbs.current_weight_kg), 0)::numeric(18,3) as current_weight_kg
from public.harvest_lots hl
join public.harvest_lot_batches hlb on hlb.harvest_lot_id = hl.id
left join ledger_by_batch lbs
  on lbs.company_id = hlb.company_id and lbs.inventory_batch_id = hlb.inventory_batch_id
where hl.status = 'active'
group by hl.company_id, hl.id, lbs.warehouse_id;

revoke all on table public.v_harvest_lot_stock_v1 from public, anon;
grant select on table public.v_harvest_lot_stock_v1 to authenticated;

comment on table public.harvest_lots is
  'User-facing aggregate harvest lots. Trip inventory_batches remain immutable technical identities.';
comment on column public.harvest_lots.resolution_locked is
  'When true, identity clarification never auto-merges this lot; use controlled reassignment.';

commit;
