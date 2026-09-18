-- P0: reconcile three physical 18 Sep 2026 harvest trips that were posted to
-- Картофеле-Хранилище while the weighbridge was receiving into
-- Хранилище (Тайынша). Every original document remains in the audit trail.
-- Canonical ticket correction reverses the old batch/ledger and creates one
-- finalized replacement at the confirmed destination.

do $p0_tainsha_wrong_destination_reconcile_v1$
declare
  v_company_id constant uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_actor_user_id constant uuid := 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'::uuid;
  v_weighman_user_id constant uuid := 'efca42f4-eda3-48dd-8522-878331c78440'::uuid;
  v_operator_person_id constant uuid := '9ab08488-6952-481b-b2c4-6c4a136f0862'::uuid;
  v_shift_id constant uuid := '3aff0ac5-cbc6-4d0f-ab80-f7788b4476d9'::uuid;
  v_wrong_warehouse_id constant uuid := '5a74da85-fd88-4aea-a899-56d61d7f1a19'::uuid;
  v_target_warehouse_id constant uuid := '93fa746b-af1e-4ee1-9a49-080a47e1f8de'::uuid;
  v_field_id constant uuid := 'a769b780-fc7f-4f1d-ac06-ab0cbcdd84c1'::uuid;
  v_crop_structure_id constant uuid := '4afa980f-1cd4-4675-aaf8-590fdebf97ec'::uuid;
  v_harvest_lot_id constant uuid := 'bd68ec0a-f26b-43db-9da0-92c397c3a0a9'::uuid;
  v_item jsonb;
  v_ticket public.tickets%rowtype;
  v_original_id uuid;
  v_replacement_id uuid;
  v_replacement_ids uuid[] := array[]::uuid[];
  v_count integer;
  v_total numeric(18,6);
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor_user_id::text, true);

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor_user_id
      and profile.role = 'global_admin'
  ) then
    raise exception 'P0 reconcile precondition failed: canonical global admin is unavailable';
  end if;

  if not exists (
    select 1
    from public.weighbridge_shifts shift_row
    where shift_row.id = v_shift_id
      and shift_row.company_id = v_company_id
      and shift_row.operator_id = v_weighman_user_id
      and shift_row.operator_person_id = v_operator_person_id
      and shift_row.status = 'open'
  ) then
    raise exception 'P0 reconcile precondition failed: weighbridge shift is not open';
  end if;

  if not exists (
    select 1 from public.warehouses warehouse
    where warehouse.id = v_wrong_warehouse_id
      and warehouse.company_id = v_company_id
  ) or not exists (
    select 1 from public.warehouses warehouse
    where warehouse.id = v_target_warehouse_id
      and warehouse.company_id = v_company_id
  ) then
    raise exception 'P0 reconcile precondition failed: warehouse identity drift';
  end if;

  for v_item in
    select value
    from jsonb_array_elements($items$[
      {"id":"f8e7d00c-3a98-40d7-8c24-3fd7b0f4f592","ticket_no":"WB-100000-20260918045506-G48T","gross":21500,"tare":10960,"net":10540},
      {"id":"4b4c5046-e2b9-4097-a1eb-78ec39394015","ticket_no":"WB-100000-20260918051023-GPZ6","gross":34140,"tare":16020,"net":18120},
      {"id":"3d17711e-9209-4d31-86d4-2ac96a5ee6bb","ticket_no":"WB-100000-20260918052254-09MN","gross":21180,"tare":10800,"net":10380}
    ]$items$::jsonb)
  loop
    v_original_id := (v_item ->> 'id')::uuid;

    select * into v_ticket
    from public.tickets ticket
    where ticket.id = v_original_id
    for update;

    if not found
       or v_ticket.company_id is distinct from v_company_id
       or v_ticket.ticket_no is distinct from (v_item ->> 'ticket_no')
       or v_ticket.op_type <> 'harvest_incoming'
       or v_ticket.status <> 'finalized'
       or not v_ticket.is_finalized
       or v_ticket.is_voided
       or v_ticket.warehouse_to_id is distinct from v_wrong_warehouse_id
       or v_ticket.field_id is distinct from v_field_id
       or v_ticket.crop_structure_allocation_id is distinct from v_crop_structure_id
       or v_ticket.harvest_lot_id is distinct from v_harvest_lot_id
       or v_ticket.shift_id is distinct from v_shift_id
       or v_ticket.created_by is distinct from v_weighman_user_id
       or v_ticket.created_by_person_id is distinct from v_operator_person_id
       or (v_ticket.created_at at time zone 'Asia/Qyzylorda')::date <> date '2026-09-18'
       or abs(v_ticket.gross_weight_kg - (v_item ->> 'gross')::numeric) > 0.001
       or abs(v_ticket.tare_weight_kg - (v_item ->> 'tare')::numeric) > 0.001
       or abs(v_ticket.net_weight_kg - (v_item ->> 'net')::numeric) > 0.001
       or abs(v_ticket.accepted_weight_kg - (v_item ->> 'net')::numeric) > 0.001
    then
      raise exception 'P0 reconcile precondition failed for ticket %', v_item ->> 'ticket_no';
    end if;

    if exists (
      select 1 from public.tickets correction
      where correction.correction_of_ticket_id = v_original_id
        and not correction.is_voided
    ) then
      raise exception 'P0 reconcile refused: active correction exists for %', v_ticket.ticket_no;
    end if;

    if private.weighbridge_ticket_has_downstream_dependencies_v1(v_original_id) then
      raise exception 'P0 reconcile refused: ticket % has downstream movement', v_ticket.ticket_no;
    end if;

    select count(*)::integer, coalesce(sum(batch.current_weight_kg), 0)
      into v_count, v_total
    from public.inventory_batches batch
    where batch.company_id = v_company_id
      and batch.source_ticket_id = v_original_id
      and batch.origin_type = 'harvest'
      and batch.warehouse_id = v_wrong_warehouse_id;
    if v_count <> 1 or abs(v_total - (v_item ->> 'net')::numeric) > 0.001 then
      raise exception 'P0 reconcile refused: source batch drift for %', v_ticket.ticket_no;
    end if;

    select count(*)::integer, coalesce(sum(ledger.delta_qty_signed), 0)
      into v_count, v_total
    from public.stock_ledger_entries ledger
    where ledger.company_id = v_company_id
      and ledger.ticket_id = v_original_id
      and ledger.warehouse_id = v_wrong_warehouse_id;
    if v_count <> 1 or abs(v_total - (v_item ->> 'net')::numeric) > 0.001 then
      raise exception 'P0 reconcile refused: source ledger drift for %', v_ticket.ticket_no;
    end if;

    v_replacement_id := public.start_weighbridge_ticket_correction_v1(
      v_original_id,
      'P0 18.09.2026: рейс ошибочно проведён в Картофеле-Хранилище; подтверждённый адресат — Хранилище (Тайынша)',
      v_operator_person_id,
      v_shift_id
    );

    update public.tickets
    set warehouse_to_id = v_target_warehouse_id,
        destination_id = v_target_warehouse_id,
        destination_kind = 'warehouse',
        updated_at = pg_catalog.now()
    where id = v_replacement_id
      and company_id = v_company_id
      and status = 'active'
      and not is_voided;
    if not found then
      raise exception 'P0 reconcile failed to update replacement ticket %', v_replacement_id;
    end if;

    update public.ticket_lines
    set warehouse_to_id = v_target_warehouse_id,
        updated_at = pg_catalog.now()
    where company_id = v_company_id
      and ticket_id = v_replacement_id;
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

    v_replacement_ids := pg_catalog.array_append(v_replacement_ids, v_replacement_id);
  end loop;

  select count(*)::integer, coalesce(sum(ticket.net_weight_kg), 0)
    into v_count, v_total
  from public.tickets ticket
  where ticket.id = any(array[
    'f8e7d00c-3a98-40d7-8c24-3fd7b0f4f592'::uuid,
    '4b4c5046-e2b9-4097-a1eb-78ec39394015'::uuid,
    '3d17711e-9209-4d31-86d4-2ac96a5ee6bb'::uuid
  ])
    and ticket.status = 'voided'
    and ticket.is_voided;
  if v_count <> 3 or abs(v_total - 39040) > 0.001 then
    raise exception 'P0 reconcile postcondition failed: original documents are not fully voided';
  end if;

  select count(*)::integer, coalesce(sum(ticket.net_weight_kg), 0)
    into v_count, v_total
  from public.tickets ticket
  where ticket.id = any(v_replacement_ids)
    and ticket.company_id = v_company_id
    and ticket.status = 'finalized'
    and ticket.is_finalized
    and not ticket.is_voided
    and ticket.warehouse_to_id = v_target_warehouse_id
    and ticket.field_id = v_field_id
    and ticket.crop_structure_allocation_id = v_crop_structure_id
    and ticket.harvest_lot_id = v_harvest_lot_id;
  if v_count <> 3 or abs(v_total - 39040) > 0.001 then
    raise exception 'P0 reconcile postcondition failed: expected 3 replacements / 39040 kg, got % / %', v_count, v_total;
  end if;

  if exists (
    select 1
    from public.stock_ledger_entries base
    where base.ticket_id = any(array[
      'f8e7d00c-3a98-40d7-8c24-3fd7b0f4f592'::uuid,
      '4b4c5046-e2b9-4097-a1eb-78ec39394015'::uuid,
      '3d17711e-9209-4d31-86d4-2ac96a5ee6bb'::uuid
    ])
      and not base.is_storno
      and not exists (
        select 1
        from public.stock_ledger_entries reversal
        where reversal.storno_of_entry_id = base.id
      )
  ) then
    raise exception 'P0 reconcile postcondition failed: unreversed wrong-warehouse ledger remains';
  end if;

  select count(*)::integer, coalesce(sum(ledger.delta_qty_signed), 0)
    into v_count, v_total
  from public.stock_ledger_entries ledger
  where ledger.ticket_id = any(v_replacement_ids)
    and ledger.warehouse_id = v_target_warehouse_id
    and ledger.direction = 'in'
    and not ledger.is_storno;
  if v_count <> 3 or abs(v_total - 39040) > 0.001 then
    raise exception 'P0 reconcile postcondition failed: replacement ledger is incomplete';
  end if;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_company_id,
    v_actor_user_id,
    'weighbridge_incident',
    'p0_tainsha_wrong_destination_20260918',
    'wrong_warehouse_reconciled',
    jsonb_build_object(
      'ticket_ids', array[
        'f8e7d00c-3a98-40d7-8c24-3fd7b0f4f592'::uuid,
        '4b4c5046-e2b9-4097-a1eb-78ec39394015'::uuid,
        '3d17711e-9209-4d31-86d4-2ac96a5ee6bb'::uuid
      ],
      'warehouse_id', v_wrong_warehouse_id,
      'net_weight_kg', 39040
    ),
    jsonb_build_object(
      'replacement_ticket_ids', v_replacement_ids,
      'warehouse_id', v_target_warehouse_id,
      'net_weight_kg', 39040
    ),
    'P0: три подтверждённых физических рейса перенесены в Хранилище (Тайынша) каноническими корректировками'
  );
end
$p0_tainsha_wrong_destination_reconcile_v1$;
