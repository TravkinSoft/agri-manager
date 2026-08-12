begin;

create temporary table tz263_harvest_lot_identity_map on commit drop as
with resolved as (
  select
    hl.id as lot_id,
    hl.company_id,
    case
      when hl.identity_kind = 'crop' then
        encode(extensions.digest(concat_ws('|', 'crop', hl.company_id, hl.season_id, hl.crop_id, hl.variety_id, hl.reproduction_id), 'sha256'), 'hex')
      when hl.identity_kind = 'crop_mix' then
        encode(extensions.digest(concat_ws('|', 'crop_mix', hl.company_id, hl.season_id, hl.composition_hash), 'sha256'), 'hex')
      else null
    end as canonical_key,
    hl.created_at
  from public.harvest_lots hl
  where hl.status = 'active'
    and hl.review_state = 'confirmed'
    and (
      (hl.identity_kind = 'crop'
        and hl.season_id is not null
        and hl.crop_id is not null
        and hl.variety_id is not null
        and hl.reproduction_id is not null)
      or
      (hl.identity_kind = 'crop_mix'
        and hl.season_id is not null
        and nullif(hl.composition_hash, '') is not null)
    )
), ranked as (
  select
    lot_id,
    company_id,
    canonical_key,
    first_value(lot_id) over (
      partition by company_id, canonical_key
      order by created_at, lot_id
    ) as canonical_lot_id
  from resolved
)
select * from ranked;

update public.harvest_lot_batches hlb
set harvest_lot_id = map.canonical_lot_id,
    assignment_reason = case
      when hlb.assignment_reason is null or hlb.assignment_reason like 'automatic_confirmed_identity%'
        then 'field_independent_identity_v2_reconciled'
      else hlb.assignment_reason
    end,
    updated_at = now()
from tz263_harvest_lot_identity_map map
where hlb.harvest_lot_id = map.lot_id
  and map.lot_id <> map.canonical_lot_id;

update public.harvest_lots hl
set status = 'merged',
    merged_into_lot_id = map.canonical_lot_id,
    updated_at = now()
from tz263_harvest_lot_identity_map map
where hl.id = map.lot_id
  and map.lot_id <> map.canonical_lot_id
  and hl.status = 'active';

update public.harvest_lots hl
set identity_key = map.canonical_key,
    source_field_id = null,
    updated_at = now()
from (
  select distinct canonical_lot_id, canonical_key
  from tz263_harvest_lot_identity_map
) map
where hl.id = map.canonical_lot_id
  and hl.status = 'active';

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
    if nullif(v_batch.composition_hash, '') is null then v_review_reasons := array_append(v_review_reasons, 'missing_composition'); end if;
    v_confirmed := cardinality(v_review_reasons) = 0;
    v_identity_key := case when v_confirmed then
      encode(extensions.digest(concat_ws('|', 'crop_mix', v_batch.company_id, v_season_id, v_batch.composition_hash), 'sha256'), 'hex')
      else 'provisional:' || v_batch.id::text end;
  else
    v_identity_kind := 'crop';
    if v_season_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_season'); end if;
    if v_batch.crop_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_crop'); end if;
    if v_batch.variety_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_variety'); end if;
    if v_batch.reproduction_id is null then v_review_reasons := array_append(v_review_reasons, 'missing_reproduction'); end if;
    v_confirmed := cardinality(v_review_reasons) = 0;
    v_identity_key := case when v_confirmed then
      encode(extensions.digest(concat_ws('|', 'crop', v_batch.company_id, v_season_id, v_batch.crop_id, v_batch.variety_id, v_batch.reproduction_id), 'sha256'), 'hex')
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
      v_batch.company_id, v_season_id, case when v_confirmed then null else v_field_id end,
      v_batch.crop_id, v_batch.variety_id, v_batch.reproduction_id,
      nullif(v_batch.composition_hash, ''),
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
    case when v_confirmed then 'automatic_confirmed_identity_v2' else 'automatic_provisional_trip' end
  ) on conflict (inventory_batch_id) do nothing;

  return v_lot.id;
end
$function$;

revoke all on function public.ensure_harvest_lot_for_batch_v1(uuid) from public, anon, authenticated;

comment on column public.harvest_lots.source_field_id is
  'Legacy single-field hint. Confirmed aggregate lot identity never includes a field; provenance is stored per technical batch and ticket.';

commit;
