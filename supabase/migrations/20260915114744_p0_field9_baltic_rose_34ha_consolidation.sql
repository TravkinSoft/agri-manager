-- P0: owner-confirmed production consolidation of the two remaining 2026 Baltic Rose
-- fourth-reproduction rows on physical field 9 into one 34 ha crop-structure
-- row. A third 11 ha planning row was deleted before this correction and had
-- no retained references. Soraya is explicitly out of scope.
--
-- This migration changes only crop-structure linkage and active planning area.
-- Ticket weights, inventory weights, ledger entries, lot identity and impurity
-- amounts must remain unchanged. It aborts on any drift from the audited graph.

do $p0_field9_baltic_rose_34ha_consolidation$
declare
  v_company_id constant uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_field_id uuid;
  v_season_id uuid;
  v_crop_id uuid;
  v_variety_id uuid;
  v_reproduction_id uuid;
  v_keep_id uuid;
  v_merge_id uuid;
  v_harvest_lot_id uuid;
  v_count integer;
  v_ticket_count integer;
  v_ticket_gross numeric(18, 3);
  v_ticket_tare numeric(18, 3);
  v_ticket_net numeric(18, 3);
  v_ticket_accepted numeric(18, 3);
  v_batch_count integer;
  v_batch_initial numeric(18, 3);
  v_batch_current numeric(18, 3);
  v_soraya_count integer;
  v_soraya_ticket_count integer;
  v_soraya_accepted numeric(18, 3);
begin
  -- Keep the correction atomic and short. These locks also prevent a new
  -- weighbridge row from appearing between the preconditions and remap.
  lock table public.crop_structure,
             public.tickets,
             public.field_history_entries,
             public.harvest_lot_batches,
             public.inventory_batches,
             public.operations,
             public.weighbridge_active_harvests,
             public.weighbridge_shared_impurity_members,
             public.weighbridge_shared_impurity_source_batches
    in share row exclusive mode;

  select count(*),
         (array_agg(cs.field_id order by cs.field_id))[1],
         (array_agg(cs.season_id order by cs.field_id))[1],
         (array_agg(cs.crop_id order by cs.field_id))[1],
         (array_agg(cs.variety_id order by cs.field_id))[1],
         (array_agg(cs.reproduction_id order by cs.field_id))[1]
    into v_count, v_field_id, v_season_id, v_crop_id, v_variety_id, v_reproduction_id
  from public.crop_structure cs
  join public.fields f
    on f.id = cs.field_id
   and f.company_id = cs.company_id
  join public.seasons s
    on s.id = cs.season_id
   and s.company_id = cs.company_id
  join public.crops c on c.id = cs.crop_id
  join public.varieties v
    on v.id = cs.variety_id
   and v.crop_id = cs.crop_id
  join public.seed_reproductions sr on sr.id = cs.reproduction_id
  where cs.company_id = v_company_id
    and f.name = '9'
    and f.area = 116
    and coalesce(f.archived, false) = false
    and s.year = 2026
    and coalesce(c.name_ru, c.name) = 'Картофель'
    and coalesce(v.name_ru, v.name) = 'Baltic Rose'
    and coalesce(sr.name_ru, sr.name) = 'Четвёртая репродукция'
    and cs.land_use_type = 'crop'
    and coalesce(cs.archived, false) = false;
  if v_count <> 2 then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|expected_2_active_rows|found_%', v_count;
  end if;

  select (array_agg(cs.id order by cs.created_at, cs.id))[1],
         (array_agg(cs.id order by cs.created_at desc, cs.id desc))[1]
    into v_keep_id, v_merge_id
  from public.crop_structure cs
  where cs.company_id = v_company_id
    and cs.field_id = v_field_id
    and cs.season_id = v_season_id
    and cs.crop_id = v_crop_id
    and cs.variety_id = v_variety_id
    and cs.reproduction_id = v_reproduction_id
    and cs.land_use_type = 'crop'
    and coalesce(cs.archived, false) = false;

  if v_keep_id is null or v_merge_id is null or v_keep_id = v_merge_id then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|canonical_rows_unresolved';
  end if;
  if not exists (
    select 1
    from public.crop_structure cs
    where cs.id = v_keep_id and cs.area = 11
  ) or not exists (
    select 1
    from public.crop_structure cs
    where cs.id = v_merge_id and cs.area = 12
  ) then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|expected_areas_11_and_12';
  end if;

  -- Soraya is a hard exclusion. Capture its exact live fingerprint and assert
  -- it again after the Baltic Rose-only correction.
  select count(*)
    into v_soraya_count
  from public.crop_structure cs
  join public.varieties v on v.id = cs.variety_id
  join public.seed_reproductions sr on sr.id = cs.reproduction_id
  where cs.company_id = v_company_id
    and cs.field_id = v_field_id
    and cs.season_id = v_season_id
    and coalesce(v.name_ru, v.name) = 'Сорая'
    and coalesce(sr.name_ru, sr.name) = '1 репродукция'
    and cs.area = 11
    and coalesce(cs.archived, false) = false;
  if v_soraya_count <> 1 then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|soraya_guard_count_%', v_soraya_count;
  end if;

  select count(*), coalesce(sum(t.accepted_weight_kg) filter (where not coalesce(t.is_voided, false)), 0)
    into v_soraya_ticket_count, v_soraya_accepted
  from public.tickets t
  join public.crop_structure cs on cs.id = t.crop_structure_allocation_id
  join public.varieties v on v.id = cs.variety_id
  where cs.company_id = v_company_id
    and cs.field_id = v_field_id
    and cs.season_id = v_season_id
    and coalesce(v.name_ru, v.name) = 'Сорая';
  if v_soraya_ticket_count <> 81 or abs(v_soraya_accepted - 814350) > 0.001 then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|soraya_guard_drift|tickets_%|accepted_%',
      v_soraya_ticket_count, v_soraya_accepted;
  end if;

  if exists (
    select 1 from public.tickets t
    where t.crop_structure_allocation_id in (v_keep_id, v_merge_id)
      and not (t.op_type = 'harvest_incoming' and t.status = 'finalized' and t.is_finalized and not t.is_voided)
  ) then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|unexpected_ticket_state_or_type';
  end if;

  select count(*),
         coalesce(sum(t.gross_weight_kg), 0),
         coalesce(sum(t.tare_weight_kg), 0),
         coalesce(sum(t.net_weight_kg), 0),
         coalesce(sum(t.accepted_weight_kg), 0)
    into v_ticket_count, v_ticket_gross, v_ticket_tare, v_ticket_net, v_ticket_accepted
  from public.tickets t
  where t.company_id = v_company_id
    and t.crop_structure_allocation_id in (v_keep_id, v_merge_id);
  if v_ticket_count <> 123
     or abs(v_ticket_gross - 2610220) > 0.001
     or abs(v_ticket_tare - 1316080) > 0.001
     or abs(v_ticket_net - 1294140) > 0.001
     or abs(v_ticket_accepted - 1294140) > 0.001
  then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|ticket_fingerprint_drift|count_%|gross_%|tare_%|net_%|accepted_%',
      v_ticket_count, v_ticket_gross, v_ticket_tare, v_ticket_net, v_ticket_accepted;
  end if;

  select count(*),
         coalesce(sum(ib.initial_weight_kg), 0),
         coalesce(sum(ib.current_weight_kg), 0)
    into v_batch_count, v_batch_initial, v_batch_current
  from public.inventory_batches ib
  where ib.company_id = v_company_id
    and ib.crop_structure_id in (v_keep_id, v_merge_id);
  if v_batch_count <> 123
     or abs(v_batch_initial - 1294140) > 0.001
     or abs(v_batch_current - 1258680) > 0.001
  then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|batch_fingerprint_drift|count_%|initial_%|current_%',
      v_batch_count, v_batch_initial, v_batch_current;
  end if;

  select count(distinct hlb.harvest_lot_id), min(hlb.harvest_lot_id::text)::uuid
    into v_count, v_harvest_lot_id
  from public.harvest_lot_batches hlb
  where hlb.company_id = v_company_id
    and hlb.crop_structure_id in (v_keep_id, v_merge_id);
  if v_count <> 1 then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|expected_one_existing_harvest_lot|found_%', v_count;
  end if;
  if exists (
    select 1 from public.weighbridge_active_harvests ah
    where ah.crop_structure_id in (v_keep_id, v_merge_id)
  ) then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_REFUSED|active_harvest_exists';
  end if;

  -- Repoint every operational source edge. No weights or accounting values are
  -- changed. The two Baltic rows already belong to the same physical lot.
  update public.tickets
  set crop_structure_allocation_id = v_keep_id
  where company_id = v_company_id
    and crop_structure_allocation_id = v_merge_id;

  update public.field_history_entries
  set crop_structure_id = v_keep_id,
      updated_at = pg_catalog.now()
  where company_id = v_company_id
    and crop_structure_id = v_merge_id;

  update public.harvest_lot_batches
  set crop_structure_id = v_keep_id,
      updated_at = pg_catalog.now()
  where company_id = v_company_id
    and crop_structure_id = v_merge_id;

  update public.inventory_batches
  set crop_structure_id = v_keep_id,
      updated_at = pg_catalog.now()
  where company_id = v_company_id
    and crop_structure_id = v_merge_id;

  update public.operations
  set crop_structure_id = v_keep_id,
      updated_at = pg_catalog.now()
  where company_id = v_company_id
    and crop_structure_id = v_merge_id;

  update public.weighbridge_active_harvests
  set crop_structure_id = v_keep_id,
      updated_at = pg_catalog.now()
  where company_id = v_company_id
    and crop_structure_id = v_merge_id;

  update public.weighbridge_shared_impurity_members
  set crop_structure_id = v_keep_id,
      updated_at = pg_catalog.now()
  where company_id = v_company_id
    and crop_structure_id = v_merge_id;

  update public.weighbridge_shared_impurity_source_batches
  set crop_structure_id = v_keep_id,
      updated_at = pg_catalog.now()
  where company_id = v_company_id
    and crop_structure_id = v_merge_id;

  update public.crop_structure
  set area = 34,
      updated_at = pg_catalog.now()
  where id = v_keep_id;

  update public.crop_structure
  set archived = true,
      notes = concat_ws(E'\n', nullif(notes, ''),
        'Объединено в участок Baltic Rose 34 га; исходные талоны и складские связи перенесены без изменения массы.'),
      updated_at = pg_catalog.now()
  where id = v_merge_id;

  -- Postconditions: exactly one active 34 ha source drives both normal harvest
  -- intake and the impurity source picker.
  select count(*)
    into v_count
  from public.crop_structure cs
  where cs.company_id = v_company_id
    and cs.field_id = v_field_id
    and cs.season_id = v_season_id
    and cs.crop_id = v_crop_id
    and cs.variety_id = v_variety_id
    and cs.reproduction_id = v_reproduction_id
    and cs.area = 34
    and coalesce(cs.archived, false) = false;
  if v_count <> 1 then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_FAILED|active_34ha_count_%', v_count;
  end if;

  if exists (
    select 1 from public.tickets where crop_structure_allocation_id = v_merge_id
  ) or exists (
    select 1 from public.field_history_entries where crop_structure_id = v_merge_id
  ) or exists (
    select 1 from public.harvest_lot_batches where crop_structure_id = v_merge_id
  ) or exists (
    select 1 from public.inventory_batches where crop_structure_id = v_merge_id
  ) or exists (
    select 1 from public.weighbridge_active_harvests where crop_structure_id = v_merge_id
  ) or exists (
    select 1 from public.weighbridge_shared_impurity_members where crop_structure_id = v_merge_id
  ) or exists (
    select 1 from public.weighbridge_shared_impurity_source_batches where crop_structure_id = v_merge_id
  ) then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_FAILED|stale_operational_reference';
  end if;

  select count(*),
         coalesce(sum(t.gross_weight_kg), 0),
         coalesce(sum(t.tare_weight_kg), 0),
         coalesce(sum(t.net_weight_kg), 0),
         coalesce(sum(t.accepted_weight_kg), 0)
    into v_count, v_ticket_gross, v_ticket_tare, v_ticket_net, v_ticket_accepted
  from public.tickets t
  where t.company_id = v_company_id
    and t.crop_structure_allocation_id = v_keep_id;
  if v_count <> v_ticket_count
     or abs(v_ticket_gross - 2610220) > 0.001
     or abs(v_ticket_tare - 1316080) > 0.001
     or abs(v_ticket_net - 1294140) > 0.001
     or abs(v_ticket_accepted - 1294140) > 0.001
  then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_FAILED|ticket_mass_changed';
  end if;

  select count(*),
         coalesce(sum(ib.initial_weight_kg), 0),
         coalesce(sum(ib.current_weight_kg), 0)
    into v_count, v_batch_initial, v_batch_current
  from public.inventory_batches ib
  where ib.company_id = v_company_id
    and ib.crop_structure_id = v_keep_id;
  if v_count <> v_batch_count
     or abs(v_batch_initial - 1294140) > 0.001
     or abs(v_batch_current - 1258680) > 0.001
  then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_FAILED|inventory_mass_changed';
  end if;

  select count(*), coalesce(sum(t.accepted_weight_kg) filter (where not coalesce(t.is_voided, false)), 0)
    into v_count, v_ticket_accepted
  from public.tickets t
  join public.crop_structure cs on cs.id = t.crop_structure_allocation_id
  join public.varieties v on v.id = cs.variety_id
  where cs.company_id = v_company_id
    and cs.field_id = v_field_id
    and cs.season_id = v_season_id
    and coalesce(v.name_ru, v.name) = 'Сорая';
  if v_count <> v_soraya_ticket_count or abs(v_ticket_accepted - v_soraya_accepted) > 0.001 then
    raise exception 'FIELD9_BALTIC_CONSOLIDATION_FAILED|soraya_changed';
  end if;

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_company_id,
    null,
    'crop_structure_consolidation',
    v_keep_id::text,
    'field9_baltic_rose_34ha_v1',
    jsonb_build_object(
      'field', '9',
      'season', 2026,
      'active_rows', 2,
      'areas_ha', jsonb_build_array(11, 12),
      'canonical_crop_structure_id', v_keep_id,
      'merged_crop_structure_id', v_merge_id,
      'harvest_lot_id', v_harvest_lot_id,
      'tickets', v_ticket_count,
      'accepted_kg', 1294140,
      'current_stock_kg', 1258680
    ),
    jsonb_build_object(
      'field', '9',
      'season', 2026,
      'active_rows', 1,
      'area_ha', 34,
      'canonical_crop_structure_id', v_keep_id,
      'archived_crop_structure_id', v_merge_id,
      'harvest_lot_id', v_harvest_lot_id,
      'tickets', v_ticket_count,
      'accepted_kg', 1294140,
      'current_stock_kg', 1258680
    ),
    'Владелец подтвердил: только два оставшихся участка поля 9 Baltic Rose, четвёртая репродукция, объединены в один участок 34 га. Сорая не изменялась. Все массы и складские движения сохранены.'
  );
end
$p0_field9_baltic_rose_34ha_consolidation$;
