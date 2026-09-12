-- P0: reconcile the 12 Sep 2026 field 4-1 / Gala R2 warehouse-entry incident.
--
-- Seven physical trips (50,620 kg) were first posted to the wrong warehouse.
-- Some were entered a second time while the operator attempted a correction;
-- the correction drafts were then voided instead of replacing the originals.
-- This repair keeps every document, reverses only the confirmed duplicate/wrong
-- postings, and creates three missing Pогреб replacements through the canonical
-- ticket-correction RPC so batch/ledger/field history remain atomic.

-- The canonical harvest correction already reverses the old warehouse-local
-- batch and creates the replacement batch at v_new.warehouse_to_id. Its old
-- identity guard nevertheless required both warehouses to be equal, making a
-- destination correction impossible. Remove only that warehouse comparison;
-- product/crop/variety/reproduction identity checks and every accounting
-- postcondition remain intact.
do $p0_harvest_correction_destination_v1$
declare
  v_signature constant regprocedure :=
    'private.finalize_harvest_correction_accounting_v1(uuid,uuid,uuid,uuid)'::regprocedure;
  v_before text;
  v_after text;
begin
  select pg_catalog.pg_get_functiondef(v_signature) into v_before;
  if pg_catalog.strpos(v_before, 'v_source_batch.warehouse_id is distinct from v_new.warehouse_to_id') = 0 then
    raise exception 'P0 destination correction precondition failed: canonical guard changed';
  end if;

  v_after := pg_catalog.regexp_replace(
    v_before,
    E'if v_source_batch\\.warehouse_id is distinct from v_new\\.warehouse_to_id\\s+or v_source_batch\\.product_id',
    'if v_source_batch.product_id'
  );
  if v_after = v_before
     or pg_catalog.strpos(v_after, 'v_source_batch.warehouse_id is distinct from v_new.warehouse_to_id') <> 0
  then
    raise exception 'P0 destination correction patch did not apply exactly once';
  end if;

  execute v_after;
end
$p0_harvest_correction_destination_v1$;

comment on function private.finalize_harvest_correction_accounting_v1(uuid,uuid,uuid,uuid)
is 'Finalizes one harvest correction atomically; destination warehouse may change while crop identity and full ledger/batch/lot postconditions remain enforced.';

do $p0_field_4_1_wrong_warehouse_reconcile_v1$
declare
  v_company_id constant uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_actor_user_id constant uuid := 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'::uuid;
  v_weighman_user_id constant uuid := 'efca42f4-eda3-48dd-8522-878331c78440'::uuid;
  v_operator_person_id constant uuid := '584837f4-2606-4177-9b10-2cffb1d7025b'::uuid;
  v_shift_id constant uuid := '3f29e7a3-740f-4476-96cb-01cfb2d5f8f2'::uuid;
  v_mill_id constant uuid := '762f61ee-26c4-4b6b-b02b-ea0c23b00895'::uuid;
  v_potato_store_id constant uuid := '5a74da85-fd88-4aea-a899-56d61d7f1a19'::uuid;
  v_cellar_id constant uuid := '1b72eb99-85a1-4a73-8864-e4284899bc35'::uuid;
  v_field_id constant uuid := 'dca2e571-0c2a-48cd-bc06-d3f1c5f215ce'::uuid;
  v_crop_structure_id constant uuid := '877230d5-b71c-4790-aef7-54f181af3c6d'::uuid;
  v_harvest_lot_id constant uuid := '60aa590b-06bd-4bf6-aae6-bb942b4b9568'::uuid;
  v_item jsonb;
  v_ticket public.tickets%rowtype;
  v_replacement_id uuid;
  v_count integer;
  v_total numeric(18,6);
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor_user_id::text, true);

  if not exists (
    select 1 from public.weighbridge_shifts s
    where s.id = v_shift_id
      and s.company_id = v_company_id
      and s.operator_id = v_weighman_user_id
      and s.operator_person_id = v_operator_person_id
      and s.status = 'open'
  ) then
    raise exception 'P0 reconcile precondition failed: operator shift is not open';
  end if;

  -- Every row is pinned by ticket id, destination, weight and harvest identity.
  for v_item in
    select value from jsonb_array_elements($items$[
      {"id":"5e9aa1f7-45b7-46f0-aa38-4fb1c497ea15","warehouse":"5a74da85-fd88-4aea-a899-56d61d7f1a19","kg":6120},
      {"id":"26c8f8ef-489f-4353-9f91-d2aa5a888042","warehouse":"5a74da85-fd88-4aea-a899-56d61d7f1a19","kg":4660},
      {"id":"6e259859-1acc-4c23-9439-2927a60ffa49","warehouse":"5a74da85-fd88-4aea-a899-56d61d7f1a19","kg":10540},
      {"id":"ed728dee-470f-4b62-a233-26ed069f2f3c","warehouse":"762f61ee-26c4-4b6b-b02b-ea0c23b00895","kg":6180},
      {"id":"bcd2c990-e2ab-4032-b8c8-3ff9b7677943","warehouse":"762f61ee-26c4-4b6b-b02b-ea0c23b00895","kg":10700},
      {"id":"d23e8f2b-c4f6-4642-91a0-2043f255bd40","warehouse":"762f61ee-26c4-4b6b-b02b-ea0c23b00895","kg":6220},
      {"id":"6ab94212-303c-4b56-9f89-08d46f6059eb","warehouse":"5a74da85-fd88-4aea-a899-56d61d7f1a19","kg":6180},
      {"id":"6a7965b0-cc30-4a7b-9f53-b27406681ece","warehouse":"5a74da85-fd88-4aea-a899-56d61d7f1a19","kg":10700},
      {"id":"b0469a54-fd05-4fa7-b1ad-cc0f0d66b3aa","warehouse":"5a74da85-fd88-4aea-a899-56d61d7f1a19","kg":6220},
      {"id":"ec428a7e-8b63-4af4-8820-78def35a5b9c","warehouse":"5a74da85-fd88-4aea-a899-56d61d7f1a19","kg":6200}
    ]$items$::jsonb)
  loop
    select * into v_ticket
    from public.tickets t
    where t.id = (v_item->>'id')::uuid
    for update;

    if not found
       or v_ticket.company_id is distinct from v_company_id
       or v_ticket.op_type <> 'harvest_incoming'
       or v_ticket.status <> 'finalized'
       or not v_ticket.is_finalized
       or v_ticket.is_voided
       or v_ticket.warehouse_to_id is distinct from (v_item->>'warehouse')::uuid
       or v_ticket.field_id is distinct from v_field_id
       or v_ticket.crop_structure_allocation_id is distinct from v_crop_structure_id
       or v_ticket.harvest_lot_id is distinct from v_harvest_lot_id
       or abs(v_ticket.net_weight_kg - (v_item->>'kg')::numeric) > 0.001
    then
      raise exception 'P0 reconcile precondition failed for ticket %', v_item->>'id';
    end if;

    if private.weighbridge_ticket_has_downstream_dependencies_v1(v_ticket.id) then
      raise exception 'P0 reconcile refused: ticket % has downstream movement', v_ticket.ticket_no;
    end if;
  end loop;

  -- Four trips already have a verified final posting in Pогреб.
  for v_item in
    select value from jsonb_array_elements($pairs$[
      {"wrong":"5e9aa1f7-45b7-46f0-aa38-4fb1c497ea15","right":"3d50e5d8-fa3f-4e06-966c-e46832545f2f"},
      {"wrong":"26c8f8ef-489f-4353-9f91-d2aa5a888042","right":"1e4c9081-a563-455c-8b0c-1835f49d0885"},
      {"wrong":"6e259859-1acc-4c23-9439-2927a60ffa49","right":"141b9672-49f7-47e8-8f49-6f9878a75508"},
      {"wrong":"6ab94212-303c-4b56-9f89-08d46f6059eb","right":"49f850ab-30f5-4e30-964f-a39bde499121"}
    ]$pairs$::jsonb)
  loop
    if not exists (
      select 1
      from public.tickets wrong_ticket
      join public.tickets right_ticket on right_ticket.id = (v_item->>'right')::uuid
      where wrong_ticket.id = (v_item->>'wrong')::uuid
        and right_ticket.company_id = wrong_ticket.company_id
        and right_ticket.status = 'finalized'
        and right_ticket.is_finalized
        and not right_ticket.is_voided
        and right_ticket.warehouse_to_id = v_cellar_id
        and right_ticket.vehicle_id is not distinct from wrong_ticket.vehicle_id
        and right_ticket.driver_id is not distinct from wrong_ticket.driver_id
        and right_ticket.field_id is not distinct from wrong_ticket.field_id
        and right_ticket.crop_structure_allocation_id is not distinct from wrong_ticket.crop_structure_allocation_id
        and right_ticket.harvest_lot_id is not distinct from wrong_ticket.harvest_lot_id
        and abs(right_ticket.net_weight_kg - wrong_ticket.net_weight_kg) <= 0.001
    ) then
      raise exception 'P0 reconcile precondition failed: verified Pогреб pair missing for %', v_item->>'wrong';
    end if;
  end loop;

  -- Three first attempts in Мельница are exact duplicates of later potato-store rows.
  for v_item in
    select value from jsonb_array_elements($duplicates$[
      {"first":"ed728dee-470f-4b62-a233-26ed069f2f3c","second":"6ab94212-303c-4b56-9f89-08d46f6059eb"},
      {"first":"bcd2c990-e2ab-4032-b8c8-3ff9b7677943","second":"6a7965b0-cc30-4a7b-9f53-b27406681ece"},
      {"first":"d23e8f2b-c4f6-4642-91a0-2043f255bd40","second":"b0469a54-fd05-4fa7-b1ad-cc0f0d66b3aa"}
    ]$duplicates$::jsonb)
  loop
    if not exists (
      select 1
      from public.tickets first_ticket
      join public.tickets second_ticket on second_ticket.id = (v_item->>'second')::uuid
      where first_ticket.id = (v_item->>'first')::uuid
        and first_ticket.warehouse_to_id = v_mill_id
        and second_ticket.warehouse_to_id = v_potato_store_id
        and first_ticket.vehicle_id is not distinct from second_ticket.vehicle_id
        and first_ticket.driver_id is not distinct from second_ticket.driver_id
        and first_ticket.field_id is not distinct from second_ticket.field_id
        and first_ticket.crop_structure_allocation_id is not distinct from second_ticket.crop_structure_allocation_id
        and first_ticket.harvest_lot_id is not distinct from second_ticket.harvest_lot_id
        and abs(first_ticket.gross_weight_kg - second_ticket.gross_weight_kg) <= 0.001
        and abs(first_ticket.tare_weight_kg - second_ticket.tare_weight_kg) <= 0.001
        and abs(first_ticket.net_weight_kg - second_ticket.net_weight_kg) <= 0.001
    ) then
      raise exception 'P0 reconcile precondition failed: duplicate pair drift for %', v_item->>'first';
    end if;
  end loop;

  -- Reverse the seven rows whose correct Pогреб document already exists, or
  -- which are the earlier duplicate at Мельница. The canonical RPC preserves
  -- documents and inserts one storno per unreversed ledger entry.
  foreach v_replacement_id in array array[
    '5e9aa1f7-45b7-46f0-aa38-4fb1c497ea15'::uuid,
    '26c8f8ef-489f-4353-9f91-d2aa5a888042'::uuid,
    '6e259859-1acc-4c23-9439-2927a60ffa49'::uuid,
    'ed728dee-470f-4b62-a233-26ed069f2f3c'::uuid,
    'bcd2c990-e2ab-4032-b8c8-3ff9b7677943'::uuid,
    'd23e8f2b-c4f6-4642-91a0-2043f255bd40'::uuid,
    '6ab94212-303c-4b56-9f89-08d46f6059eb'::uuid
  ] loop
    perform public.void_finalized_weighbridge_ticket_for_session_v1(
      v_replacement_id,
      'P0: ошибочный склад; подтвержден правильный приход в Погреб'
    );
  end loop;

  -- The remaining three trips have no Pогреб posting. Create and finalize a
  -- canonical replacement, changing only the destination warehouse.
  foreach v_replacement_id in array array[
    '6a7965b0-cc30-4a7b-9f53-b27406681ece'::uuid,
    'b0469a54-fd05-4fa7-b1ad-cc0f0d66b3aa'::uuid,
    'ec428a7e-8b63-4af4-8820-78def35a5b9c'::uuid
  ] loop
    if exists (
      select 1 from public.tickets c
      where c.correction_of_ticket_id = v_replacement_id
        and not c.is_voided
    ) then
      raise exception 'P0 reconcile refused: active correction appeared for %', v_replacement_id;
    end if;

    v_replacement_id := public.start_weighbridge_ticket_correction_v1(
      v_replacement_id,
      'P0: приход ошибочно указан в Картофеле-Хранилище; правильный склад Погреб',
      v_operator_person_id,
      v_shift_id
    );

    update public.tickets
    set warehouse_to_id = v_cellar_id,
        destination_id = v_cellar_id,
        destination_kind = 'warehouse',
        updated_at = pg_catalog.now()
    where id = v_replacement_id
      and status = 'active'
      and not is_voided;
    if not found then
      raise exception 'P0 reconcile failed to update replacement ticket %', v_replacement_id;
    end if;

    update public.ticket_lines
    set warehouse_to_id = v_cellar_id,
        updated_at = pg_catalog.now()
    where ticket_id = v_replacement_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'P0 reconcile expected one replacement line for %, got %', v_replacement_id, v_count;
    end if;

    if public.finalize_weighbridge_ticket_correction_v1(
      v_replacement_id,
      v_operator_person_id,
      v_shift_id
    ) is distinct from v_replacement_id then
      raise exception 'P0 reconcile finalizer returned unexpected replacement id';
    end if;
  end loop;

  select count(*)::integer into v_count
  from public.tickets t
  where t.id = any(array[
    '5e9aa1f7-45b7-46f0-aa38-4fb1c497ea15'::uuid,
    '26c8f8ef-489f-4353-9f91-d2aa5a888042'::uuid,
    '6e259859-1acc-4c23-9439-2927a60ffa49'::uuid,
    'ed728dee-470f-4b62-a233-26ed069f2f3c'::uuid,
    'bcd2c990-e2ab-4032-b8c8-3ff9b7677943'::uuid,
    'd23e8f2b-c4f6-4642-91a0-2043f255bd40'::uuid,
    '6ab94212-303c-4b56-9f89-08d46f6059eb'::uuid,
    '6a7965b0-cc30-4a7b-9f53-b27406681ece'::uuid,
    'b0469a54-fd05-4fa7-b1ad-cc0f0d66b3aa'::uuid,
    'ec428a7e-8b63-4af4-8820-78def35a5b9c'::uuid
  ])
    and t.status = 'voided'
    and t.is_voided;
  if v_count <> 10 then
    raise exception 'P0 reconcile postcondition failed: only % of 10 wrong tickets are voided', v_count;
  end if;

  if exists (
    select 1
    from public.stock_ledger_entries base
    where base.ticket_id = any(array[
      '5e9aa1f7-45b7-46f0-aa38-4fb1c497ea15'::uuid,
      '26c8f8ef-489f-4353-9f91-d2aa5a888042'::uuid,
      '6e259859-1acc-4c23-9439-2927a60ffa49'::uuid,
      'ed728dee-470f-4b62-a233-26ed069f2f3c'::uuid,
      'bcd2c990-e2ab-4032-b8c8-3ff9b7677943'::uuid,
      'd23e8f2b-c4f6-4642-91a0-2043f255bd40'::uuid,
      '6ab94212-303c-4b56-9f89-08d46f6059eb'::uuid,
      '6a7965b0-cc30-4a7b-9f53-b27406681ece'::uuid,
      'b0469a54-fd05-4fa7-b1ad-cc0f0d66b3aa'::uuid,
      'ec428a7e-8b63-4af4-8820-78def35a5b9c'::uuid
    ])
      and not base.is_storno
      and not exists (
        select 1 from public.stock_ledger_entries reversal
        where reversal.storno_of_entry_id = base.id
      )
  ) then
    raise exception 'P0 reconcile postcondition failed: unreversed wrong ledger entry remains';
  end if;

  select count(*)::integer, coalesce(sum(t.net_weight_kg), 0)
    into v_count, v_total
  from public.tickets t
  where t.company_id = v_company_id
    and t.field_id = v_field_id
    and t.crop_structure_allocation_id = v_crop_structure_id
    and t.harvest_lot_id = v_harvest_lot_id
    and t.warehouse_to_id = v_cellar_id
    and t.status = 'finalized'
    and t.is_finalized
    and not t.is_voided
    and (
      t.id = any(array[
        '3d50e5d8-fa3f-4e06-966c-e46832545f2f'::uuid,
        '1e4c9081-a563-455c-8b0c-1835f49d0885'::uuid,
        '141b9672-49f7-47e8-8f49-6f9878a75508'::uuid,
        '49f850ab-30f5-4e30-964f-a39bde499121'::uuid
      ])
      or t.correction_of_ticket_id = any(array[
        '6a7965b0-cc30-4a7b-9f53-b27406681ece'::uuid,
        'b0469a54-fd05-4fa7-b1ad-cc0f0d66b3aa'::uuid,
        'ec428a7e-8b63-4af4-8820-78def35a5b9c'::uuid
      ])
    );
  if v_count <> 7 or abs(v_total - 50620) > 0.001 then
    raise exception 'P0 reconcile postcondition failed: Pогреб has % repaired trips / % kg', v_count, v_total;
  end if;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_company_id,
    v_actor_user_id,
    'weighbridge_incident',
    'p0_field_4_1_wrong_warehouse_20260912',
    'wrong_warehouse_reconciled',
    jsonb_build_object('wrong_ticket_count', 10, 'duplicate_or_wrong_posted_kg', 73720),
    jsonb_build_object('physical_trip_count', 7, 'correct_warehouse', 'Погреб', 'physical_kg', 50620),
    'P0: исправлены ошибочные склады и несработавшие попытки исправления весовщика'
  );
end
$p0_field_4_1_wrong_warehouse_reconcile_v1$;
