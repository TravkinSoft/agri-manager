-- TZ315: keep the legacy inventory_batches projection aligned with the
-- canonical ledger after an outgoing weighbridge ticket is finalized.
--
-- This migration intentionally performs no data backfill. Existing stale
-- projections are reconciled only by their canonical void/storno flow.

do $prerequisites$
begin
  if pg_catalog.to_regprocedure('public.finalize_weighbridge_ticket_v2(uuid,uuid)') is null then
    raise exception 'TZ315 prerequisite missing: public.finalize_weighbridge_ticket_v2(uuid,uuid)';
  end if;
  if pg_catalog.to_regprocedure('private.reconcile_warehouse_local_batch_balance_v1(uuid)') is null then
    raise exception 'TZ315 prerequisite missing: private.reconcile_warehouse_local_batch_balance_v1(uuid)';
  end if;
  if pg_catalog.to_regprocedure('private.reconcile_harvest_lot_batch_balance_v1(uuid)') is null then
    raise exception 'TZ315 prerequisite missing: private.reconcile_harvest_lot_batch_balance_v1(uuid)';
  end if;
end
$prerequisites$;

do $inject_projection_reconcile$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.finalize_weighbridge_ticket_v2(uuid,uuid)');
  v_proc pg_catalog.pg_proc%rowtype;
  v_definition text;
  v_declare_anchor constant text := E'  v_structure public.crop_structure%rowtype;\nbegin\n';
  v_declare_replacement constant text := E'  v_structure public.crop_structure%rowtype;\n  v_reconcile_batch_id uuid;\nbegin\n';
  v_finalize_anchor constant text := E'  update public.tickets\n  set\n    net_weight_kg = case when v_is_direct_supplier_document then null else v_net end,';
  v_statement constant text := E'  -- TZ315_OUTGOING_BATCH_PROJECTION_RECONCILE_V1\n  if v_ticket.direction::text = ''outgoing'' then\n    for v_reconcile_batch_id in\n      select distinct sle.inventory_batch_id\n      from public.stock_ledger_entries sle\n      where sle.company_id = v_ticket.company_id\n        and sle.ticket_id = v_ticket.id\n        and not coalesce(sle.is_storno, false)\n        and sle.inventory_batch_id is not null\n      order by sle.inventory_batch_id\n    loop\n      if exists (\n        select 1\n        from public.harvest_lot_batches hlb\n        where hlb.company_id = v_ticket.company_id\n          and hlb.inventory_batch_id = v_reconcile_batch_id\n      ) then\n        perform private.reconcile_harvest_lot_batch_balance_v1(v_reconcile_batch_id);\n      else\n        perform private.reconcile_warehouse_local_batch_balance_v1(v_reconcile_batch_id);\n      end if;\n    end loop;\n  end if;\n\n';
  v_before_owner oid;
  v_before_security boolean;
  v_before_config text[];
  v_before_acl aclitem[];
  v_position integer;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = v_oid;

  v_before_owner := v_proc.proowner;
  v_before_security := v_proc.prosecdef;
  v_before_config := v_proc.proconfig;
  v_before_acl := v_proc.proacl;
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;

  if pg_catalog.strpos(v_definition, 'TZ315_OUTGOING_BATCH_PROJECTION_RECONCILE_V1') = 0 then
    if pg_catalog.md5(v_proc.prosrc) <> 'f1cccf47f239fb9cc19001f66fd5c9bd' then
      raise exception 'TZ315 outgoing projection function drift: %', pg_catalog.md5(v_proc.prosrc)
        using errcode = '55000';
    end if;

    v_position := pg_catalog.strpos(v_definition, v_declare_anchor);
    if v_position = 0 then
      raise exception 'TZ315 outgoing projection declaration anchor missing' using errcode = '55000';
    end if;
    v_definition := pg_catalog.overlay(
      v_definition,
      v_declare_replacement,
      v_position,
      pg_catalog.length(v_declare_anchor)
    );

    v_position := pg_catalog.strpos(v_definition, v_finalize_anchor);
    if v_position = 0 then
      raise exception 'TZ315 outgoing projection finalize anchor missing' using errcode = '55000';
    end if;
    v_definition := pg_catalog.overlay(
      v_definition,
      v_statement || v_finalize_anchor,
      v_position,
      pg_catalog.length(v_finalize_anchor)
    );

    execute v_definition;
  end if;

  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = v_oid;
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;

  if pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, 'TZ315_OUTGOING_BATCH_PROJECTION_RECONCILE_V1', ''))
       <> pg_catalog.length('TZ315_OUTGOING_BATCH_PROJECTION_RECONCILE_V1')
     or pg_catalog.strpos(v_definition, 'if v_ticket.direction::text = ''outgoing''') = 0
     or pg_catalog.strpos(v_definition, 'private.reconcile_harvest_lot_batch_balance_v1(v_reconcile_batch_id)') = 0
     or pg_catalog.strpos(v_definition, 'private.reconcile_warehouse_local_batch_balance_v1(v_reconcile_batch_id)') = 0
     or v_proc.proowner is distinct from v_before_owner
     or v_proc.prosecdef is distinct from v_before_security
     or v_proc.proconfig is distinct from v_before_config
     or v_proc.proacl is distinct from v_before_acl
  then
    raise exception 'TZ315 outgoing projection postcondition failed' using errcode = '55000';
  end if;
end
$inject_projection_reconcile$;
