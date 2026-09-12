-- P0: owner-confirmed historical identity correction for the 2026 Soraya plot
-- on field 49-2. The crop structure already says Elite, but the 63 harvest
-- receipts and their 31 impurity removals retained the original Superelite
-- snapshot. This migration changes identity only. It refuses to run if the
-- live document set, masses, lineage, or canonical harvest-lot key drift.

do $p0_field49_soraya_elite_history_v1$
declare
  v_company_id constant uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_old_reproduction_id uuid;
  v_new_reproduction_id uuid;
  v_crop_structure_id uuid;
  v_field_id uuid;
  v_season_id uuid;
  v_crop_id uuid;
  v_variety_id uuid;
  v_harvest_lot_id uuid;
  v_old_identity_key text;
  v_new_identity_key text;
  v_count integer;
  v_total_count integer;
  v_active_count integer;
  v_incoming_count integer;
  v_impurity_count integer;
  v_incoming_kg numeric(18, 6);
  v_impurity_kg numeric(18, 6);
  v_initial_kg numeric(18, 6);
  v_current_kg numeric(18, 6);
  v_line_kg numeric(18, 6);
  v_ledger_in_kg numeric(18, 6);
  v_ledger_out_kg numeric(18, 6);
  v_ticket_line_fingerprint text;
  v_batch_fingerprint text;
  v_ledger_fingerprint text;
  v_lot_fingerprint text;
begin
  -- Stop weighbridge writers only for the short atomic correction window.
  lock table public.ticket_lines,
             public.inventory_batches,
             public.stock_ledger_entries,
             public.harvest_lots,
             public.harvest_lot_batches
    in share row exclusive mode;

  select count(*), (array_agg(sr.id order by sr.id))[1]
    into v_count, v_old_reproduction_id
  from public.seed_reproductions sr
  where sr.code = 'SE'
    and coalesce(sr.name_ru, sr.name) = 'Суперэлита'
    and coalesce(sr.archived, false) = false;
  if v_count <> 1 then
    raise exception 'P0 Soraya correction refused: expected one active SE reproduction, found %', v_count;
  end if;

  select count(*), (array_agg(sr.id order by sr.id))[1]
    into v_count, v_new_reproduction_id
  from public.seed_reproductions sr
  where sr.code = 'E'
    and coalesce(sr.name_ru, sr.name) = 'Элита'
    and coalesce(sr.archived, false) = false;
  if v_count <> 1 then
    raise exception 'P0 Soraya correction refused: expected one active E reproduction, found %', v_count;
  end if;

  select count(*),
         (array_agg(cs.id order by cs.id))[1],
         (array_agg(cs.field_id order by cs.id))[1],
         (array_agg(cs.season_id order by cs.id))[1],
         (array_agg(cs.crop_id order by cs.id))[1],
         (array_agg(cs.variety_id order by cs.id))[1]
    into v_count, v_crop_structure_id, v_field_id, v_season_id, v_crop_id, v_variety_id
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
  where cs.company_id = v_company_id
    and f.name = '49-2'
    and s.year = 2026
    and coalesce(c.name_ru, c.name) = 'Картофель'
    and coalesce(v.name_ru, v.name) = 'Сорая'
    and cs.area = 10
    and cs.reproduction_id = v_new_reproduction_id
    and cs.land_use_type = 'crop'
    and coalesce(cs.archived, false) = false;
  if v_count <> 1 then
    raise exception 'P0 Soraya correction refused: expected one current Elite structure row, found %', v_count;
  end if;

  perform 1
  from public.crop_structure cs
  where cs.id = v_crop_structure_id
  for update;

  select count(distinct hl.id), (array_agg(distinct hl.id))[1]
    into v_count, v_harvest_lot_id
  from public.harvest_lots hl
  join public.harvest_lot_batches hlb
    on hlb.harvest_lot_id = hl.id
   and hlb.company_id = hl.company_id
  where hl.company_id = v_company_id
    and hlb.crop_structure_id = v_crop_structure_id
    and hl.season_id = v_season_id
    and hl.crop_id = v_crop_id
    and hl.variety_id = v_variety_id
    and hl.reproduction_id = v_old_reproduction_id
    and hl.identity_kind = 'crop'
    and hl.status = 'active';
  if v_count <> 1 then
    raise exception 'P0 Soraya correction refused: expected one active historical SE lot, found %', v_count;
  end if;

  v_old_identity_key := encode(
    extensions.digest(
      concat_ws('|', 'crop', v_company_id, v_season_id, v_crop_id, v_variety_id, v_old_reproduction_id),
      'sha256'
    ),
    'hex'
  );
  v_new_identity_key := encode(
    extensions.digest(
      concat_ws('|', 'crop', v_company_id, v_season_id, v_crop_id, v_variety_id, v_new_reproduction_id),
      'sha256'
    ),
    'hex'
  );

  if not exists (
    select 1
    from public.harvest_lots hl
    where hl.id = v_harvest_lot_id
      and hl.identity_key = v_old_identity_key
      and hl.review_state = 'confirmed'
      and not hl.resolution_locked
  ) then
    raise exception 'P0 Soraya correction refused: historical lot identity or review state drifted';
  end if;
  if exists (
    select 1
    from public.harvest_lots hl
    where hl.company_id = v_company_id
      and hl.identity_key = v_new_identity_key
      and hl.status = 'active'
      and hl.id <> v_harvest_lot_id
  ) then
    raise exception 'P0 Soraya correction refused: an active Elite lot already exists';
  end if;

  with target_tickets as (
    select t.*
    from public.tickets t
    where t.company_id = v_company_id
      and (
        t.crop_structure_allocation_id = v_crop_structure_id
        or t.harvest_lot_id = v_harvest_lot_id
      )
  )
  select count(*),
         count(*) filter (where status = 'finalized' and is_finalized and not is_voided),
         count(*) filter (where op_type = 'harvest_incoming'),
         count(*) filter (where op_type = 'weighbridge_impurities'),
         coalesce(sum(net_weight_kg) filter (where op_type = 'harvest_incoming'), 0),
         coalesce(sum(net_weight_kg) filter (where op_type = 'weighbridge_impurities'), 0)
    into v_total_count, v_active_count, v_incoming_count, v_impurity_count,
         v_incoming_kg, v_impurity_kg
  from target_tickets;
  if v_total_count <> 94
     or v_active_count <> 94
     or v_incoming_count <> 63
     or v_impurity_count <> 31
     or abs(v_incoming_kg - 636470) > 0.001
     or abs(v_impurity_kg - 207660) > 0.001
  then
    raise exception 'P0 Soraya correction refused: ticket fingerprint drifted (% total, % active, % incoming/% kg, % impurity/% kg)',
      v_total_count, v_active_count, v_incoming_count, v_incoming_kg, v_impurity_count, v_impurity_kg;
  end if;

  with target_tickets as (
    select t.id
    from public.tickets t
    where t.company_id = v_company_id
      and (t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id)
  ), target_lines as (
    select tl.*
    from public.ticket_lines tl
    where tl.ticket_id in (select id from target_tickets)
  )
  select count(*),
         count(*) filter (
           where reproduction_id = v_old_reproduction_id
             and reproduction_name_snapshot = 'Суперэлита'
         ),
         coalesce(sum(quantity), 0),
         md5(string_agg(
           (to_jsonb(target_lines) - 'reproduction_id' - 'reproduction_name_snapshot' - 'updated_at')::text,
           '' order by id
         ))
    into v_total_count, v_count, v_line_kg, v_ticket_line_fingerprint
  from target_lines;
  if v_total_count <> 114 or v_count <> 114 or abs(v_line_kg - 844130) > 0.001 then
    raise exception 'P0 Soraya correction refused: line fingerprint drifted (% total, % exact SE, % kg)',
      v_total_count, v_count, v_line_kg;
  end if;

  with target_batches as (
    select b.*
    from public.inventory_batches b
    join public.harvest_lot_batches hlb
      on hlb.inventory_batch_id = b.id
     and hlb.company_id = b.company_id
    where hlb.harvest_lot_id = v_harvest_lot_id
      and hlb.crop_structure_id = v_crop_structure_id
  )
  select count(*),
         count(*) filter (where reproduction_id = v_old_reproduction_id),
         coalesce(sum(initial_weight_kg), 0),
         coalesce(sum(current_weight_kg), 0),
         md5(string_agg(
           (to_jsonb(target_batches) - 'reproduction_id' - 'updated_at')::text,
           '' order by id
         ))
    into v_total_count, v_count, v_initial_kg, v_current_kg, v_batch_fingerprint
  from target_batches;
  if v_total_count <> 63
     or v_count <> 63
     or abs(v_initial_kg - 636470) > 0.001
     or abs(v_current_kg - 428810) > 0.001
  then
    raise exception 'P0 Soraya correction refused: batch fingerprint drifted (% total, % SE, % initial, % current)',
      v_total_count, v_count, v_initial_kg, v_current_kg;
  end if;
  if exists (
    select 1
    from public.inventory_batches child
    where child.parent_batch_id in (
      select hlb.inventory_batch_id
      from public.harvest_lot_batches hlb
      where hlb.harvest_lot_id = v_harvest_lot_id
        and hlb.crop_structure_id = v_crop_structure_id
    )
  ) then
    raise exception 'P0 Soraya correction refused: an unreviewed child batch exists';
  end if;

  with target_tickets as (
    select t.id
    from public.tickets t
    where t.company_id = v_company_id
      and (t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id)
  ), target_batches as (
    select hlb.inventory_batch_id id
    from public.harvest_lot_batches hlb
    where hlb.harvest_lot_id = v_harvest_lot_id
      and hlb.crop_structure_id = v_crop_structure_id
  ), target_ledger as (
    select le.*
    from public.stock_ledger_entries le
    where le.company_id = v_company_id
      and (le.ticket_id in (select id from target_tickets) or le.inventory_batch_id in (select id from target_batches))
  )
  select count(*),
         count(*) filter (where reproduction_id = v_old_reproduction_id),
         coalesce(sum(quantity) filter (where direction = 'in'), 0),
         coalesce(sum(quantity) filter (where direction = 'out'), 0),
         md5(string_agg(
           (to_jsonb(target_ledger) - 'reproduction_id' - 'updated_at')::text,
           '' order by id
         ))
    into v_total_count, v_count, v_ledger_in_kg, v_ledger_out_kg, v_ledger_fingerprint
  from target_ledger;
  if v_total_count <> 114
     or v_count <> 114
     or abs(v_ledger_in_kg - 636470) > 0.001
     or abs(v_ledger_out_kg - 207660) > 0.001
     or abs((v_ledger_in_kg - v_ledger_out_kg) - 428810) > 0.001
  then
    raise exception 'P0 Soraya correction refused: ledger fingerprint drifted (% total, % SE, % in, % out)',
      v_total_count, v_count, v_ledger_in_kg, v_ledger_out_kg;
  end if;

  select md5((to_jsonb(hl) - 'reproduction_id' - 'identity_key' - 'updated_at')::text)
    into v_lot_fingerprint
  from public.harvest_lots hl
  where hl.id = v_harvest_lot_id;

  -- The audited live graph has no other reproduction-bearing descendants.
  -- Abort instead of silently widening scope if one appears before deploy.
  if exists (
    select 1 from public.operations o
    where o.crop_structure_id = v_crop_structure_id
  ) or exists (
    select 1 from public.field_material_consumptions fmc
    where fmc.crop_structure_row_id = v_crop_structure_id
       or fmc.ticket_id in (
         select t.id from public.tickets t
         where t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id
       )
  ) or exists (
    select 1 from public.crop_care_scheme_fields ccsf
    where ccsf.crop_structure_id = v_crop_structure_id
  ) or exists (
    select 1 from public.crop_structure_mix_components csmc
    where csmc.crop_structure_id = v_crop_structure_id
  ) or exists (
    select 1 from public.field_cadastre_links fcl
    where fcl.field_id = v_field_id and fcl.season_id = v_season_id
  ) or exists (
    select 1
    from public.warehouse_issue_request_items wiri
    where wiri.batch_id in (
      select hlb.inventory_batch_id from public.harvest_lot_batches hlb
      where hlb.harvest_lot_id = v_harvest_lot_id and hlb.crop_structure_id = v_crop_structure_id
    )
  ) or exists (
    select 1
    from public.warehouse_opening_balance_lines wob
    where wob.harvest_lot_id = v_harvest_lot_id
       or wob.inventory_batch_id in (
         select hlb.inventory_batch_id from public.harvest_lot_batches hlb
         where hlb.harvest_lot_id = v_harvest_lot_id and hlb.crop_structure_id = v_crop_structure_id
       )
  ) or exists (
    select 1 from public.weighbridge_shared_impurity_members m
    where m.crop_structure_id = v_crop_structure_id
  ) then
    raise exception 'P0 Soraya correction refused: an unreviewed reproduction-bearing descendant appeared';
  end if;

  with target_tickets as (
    select t.id
    from public.tickets t
    where t.company_id = v_company_id
      and (t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id)
  )
  update public.ticket_lines tl
  set reproduction_id = v_new_reproduction_id,
      reproduction_name_snapshot = 'Элита',
      updated_at = pg_catalog.now()
  where tl.ticket_id in (select id from target_tickets)
    and tl.reproduction_id = v_old_reproduction_id
    and tl.reproduction_name_snapshot = 'Суперэлита';
  get diagnostics v_count = row_count;
  if v_count <> 114 then
    raise exception 'P0 Soraya correction failed: updated % of 114 ticket lines', v_count;
  end if;

  update public.inventory_batches b
  set reproduction_id = v_new_reproduction_id,
      updated_at = pg_catalog.now()
  where b.id in (
    select hlb.inventory_batch_id
    from public.harvest_lot_batches hlb
    where hlb.harvest_lot_id = v_harvest_lot_id
      and hlb.crop_structure_id = v_crop_structure_id
  )
    and b.reproduction_id = v_old_reproduction_id;
  get diagnostics v_count = row_count;
  if v_count <> 63 then
    raise exception 'P0 Soraya correction failed: updated % of 63 inventory batches', v_count;
  end if;

  with target_tickets as (
    select t.id
    from public.tickets t
    where t.company_id = v_company_id
      and (t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id)
  ), target_batches as (
    select hlb.inventory_batch_id id
    from public.harvest_lot_batches hlb
    where hlb.harvest_lot_id = v_harvest_lot_id
      and hlb.crop_structure_id = v_crop_structure_id
  )
  update public.stock_ledger_entries le
  set reproduction_id = v_new_reproduction_id
  where le.company_id = v_company_id
    and (le.ticket_id in (select id from target_tickets) or le.inventory_batch_id in (select id from target_batches))
    and le.reproduction_id = v_old_reproduction_id;
  get diagnostics v_count = row_count;
  if v_count <> 114 then
    raise exception 'P0 Soraya correction failed: updated % of 114 ledger entries', v_count;
  end if;

  update public.harvest_lots hl
  set reproduction_id = v_new_reproduction_id,
      identity_key = v_new_identity_key,
      updated_at = pg_catalog.now()
  where hl.id = v_harvest_lot_id
    and hl.reproduction_id = v_old_reproduction_id
    and hl.identity_key = v_old_identity_key;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'P0 Soraya correction failed: harvest lot update count was %', v_count;
  end if;

  -- Identity changed, but all physical/accounting facts must be byte-for-byte
  -- identical after excluding only the corrected columns and timestamps.
  with target_tickets as (
    select t.id
    from public.tickets t
    where t.company_id = v_company_id
      and (t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id)
  ), target_lines as (
    select tl.* from public.ticket_lines tl where tl.ticket_id in (select id from target_tickets)
  )
  select count(*) filter (
           where reproduction_id = v_new_reproduction_id and reproduction_name_snapshot = 'Элита'
         ),
         coalesce(sum(quantity), 0),
         md5(string_agg(
           (to_jsonb(target_lines) - 'reproduction_id' - 'reproduction_name_snapshot' - 'updated_at')::text,
           '' order by id
         ))
    into v_count, v_line_kg, v_new_identity_key
  from target_lines;
  if v_count <> 114
     or abs(v_line_kg - 844130) > 0.001
     or v_new_identity_key is distinct from v_ticket_line_fingerprint
  then
    raise exception 'P0 Soraya correction postcondition failed for ticket lines';
  end if;

  with target_batches as (
    select b.*
    from public.inventory_batches b
    join public.harvest_lot_batches hlb on hlb.inventory_batch_id = b.id
    where hlb.harvest_lot_id = v_harvest_lot_id
      and hlb.crop_structure_id = v_crop_structure_id
  )
  select count(*) filter (where reproduction_id = v_new_reproduction_id),
         coalesce(sum(initial_weight_kg), 0),
         coalesce(sum(current_weight_kg), 0),
         md5(string_agg(
           (to_jsonb(target_batches) - 'reproduction_id' - 'updated_at')::text,
           '' order by id
         ))
    into v_count, v_initial_kg, v_current_kg, v_new_identity_key
  from target_batches;
  if v_count <> 63
     or abs(v_initial_kg - 636470) > 0.001
     or abs(v_current_kg - 428810) > 0.001
     or v_new_identity_key is distinct from v_batch_fingerprint
  then
    raise exception 'P0 Soraya correction postcondition failed for inventory batches';
  end if;

  with target_tickets as (
    select t.id
    from public.tickets t
    where t.company_id = v_company_id
      and (t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id)
  ), target_batches as (
    select hlb.inventory_batch_id id
    from public.harvest_lot_batches hlb
    where hlb.harvest_lot_id = v_harvest_lot_id
      and hlb.crop_structure_id = v_crop_structure_id
  ), target_ledger as (
    select le.*
    from public.stock_ledger_entries le
    where le.company_id = v_company_id
      and (le.ticket_id in (select id from target_tickets) or le.inventory_batch_id in (select id from target_batches))
  )
  select count(*) filter (where reproduction_id = v_new_reproduction_id),
         coalesce(sum(quantity) filter (where direction = 'in'), 0),
         coalesce(sum(quantity) filter (where direction = 'out'), 0),
         md5(string_agg(
           (to_jsonb(target_ledger) - 'reproduction_id' - 'updated_at')::text,
           '' order by id
         ))
    into v_count, v_ledger_in_kg, v_ledger_out_kg, v_new_identity_key
  from target_ledger;
  if v_count <> 114
     or abs(v_ledger_in_kg - 636470) > 0.001
     or abs(v_ledger_out_kg - 207660) > 0.001
     or abs((v_ledger_in_kg - v_ledger_out_kg) - 428810) > 0.001
     or v_new_identity_key is distinct from v_ledger_fingerprint
  then
    raise exception 'P0 Soraya correction postcondition failed for ledger';
  end if;

  v_new_identity_key := encode(
    extensions.digest(
      concat_ws('|', 'crop', v_company_id, v_season_id, v_crop_id, v_variety_id, v_new_reproduction_id),
      'sha256'
    ),
    'hex'
  );
  if not exists (
    select 1 from public.harvest_lots hl
    where hl.id = v_harvest_lot_id
      and hl.reproduction_id = v_new_reproduction_id
      and hl.identity_key = v_new_identity_key
      and md5((to_jsonb(hl) - 'reproduction_id' - 'identity_key' - 'updated_at')::text) = v_lot_fingerprint
  ) then
    raise exception 'P0 Soraya correction postcondition failed for harvest lot';
  end if;

  if exists (
    select 1 from public.ticket_lines tl
    where tl.reproduction_id = v_old_reproduction_id
      and tl.ticket_id in (
        select t.id from public.tickets t
        where t.company_id = v_company_id
          and (t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id)
      )
  ) or exists (
    select 1 from public.inventory_batches b
    where b.reproduction_id = v_old_reproduction_id
      and b.id in (
        select hlb.inventory_batch_id from public.harvest_lot_batches hlb
        where hlb.harvest_lot_id = v_harvest_lot_id and hlb.crop_structure_id = v_crop_structure_id
      )
  ) or exists (
    select 1 from public.stock_ledger_entries le
    where le.reproduction_id = v_old_reproduction_id
      and (
        le.ticket_id in (
          select t.id from public.tickets t
          where t.company_id = v_company_id
            and (t.crop_structure_allocation_id = v_crop_structure_id or t.harvest_lot_id = v_harvest_lot_id)
        )
        or le.inventory_batch_id in (
          select hlb.inventory_batch_id from public.harvest_lot_batches hlb
          where hlb.harvest_lot_id = v_harvest_lot_id and hlb.crop_structure_id = v_crop_structure_id
        )
      )
  ) then
    raise exception 'P0 Soraya correction postcondition failed: stale SE identity remains';
  end if;

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_company_id,
    null,
    'crop_structure_reproduction_correction',
    v_crop_structure_id::text,
    'field49_soraya_superelite_to_elite_v1',
    jsonb_build_object(
      'field', '49-2',
      'season', 2026,
      'crop', 'Картофель',
      'variety', 'Сорая',
      'reproduction_id', v_old_reproduction_id,
      'reproduction', 'Суперэлита',
      'harvest_lot_id', v_harvest_lot_id,
      'identity_key', v_old_identity_key,
      'harvest_tickets', 63,
      'impurity_tickets', 31,
      'ticket_lines', 114,
      'inventory_batches', 63,
      'ledger_entries', 114,
      'received_kg', 636470,
      'impurity_kg', 207660,
      'balance_kg', 428810
    ),
    jsonb_build_object(
      'field', '49-2',
      'season', 2026,
      'crop', 'Картофель',
      'variety', 'Сорая',
      'reproduction_id', v_new_reproduction_id,
      'reproduction', 'Элита',
      'harvest_lot_id', v_harvest_lot_id,
      'identity_key', v_new_identity_key,
      'harvest_tickets', 63,
      'impurity_tickets', 31,
      'ticket_lines', 114,
      'inventory_batches', 63,
      'ledger_entries', 114,
      'received_kg', 636470,
      'impurity_kg', 207660,
      'balance_kg', 428810
    ),
    'P0: владелец подтвердил, что участок 49-2 Картофель/Сорая фактически является Элитой; исправлена только идентичность репродукции, физическая масса и проводки сохранены'
  );
end
$p0_field49_soraya_elite_history_v1$;
