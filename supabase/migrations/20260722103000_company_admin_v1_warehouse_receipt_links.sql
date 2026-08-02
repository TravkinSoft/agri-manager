begin;

create or replace function public.create_warehouse_receipt_atomic_v4(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_supplier_company_counterparty_id uuid,
  p_supplier_global_counterparty_id uuid,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_result jsonb;
  v_line jsonb;
  v_master public.products%rowtype;
  v_company_product public.products%rowtype;
  v_actions jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid() and status = 'active';

  if not found or v_actor.role not in ('global_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Warehousekeeper role is required';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to receipt company';
  end if;

  v_result := public.create_warehouse_receipt_atomic_v3(
    p_company_id,
    p_warehouse_id,
    p_supplier_company_counterparty_id,
    p_supplier_global_counterparty_id,
    p_document_no,
    p_notes,
    p_lines,
    p_idempotency_key
  );

  for v_line in
    select distinct on (value ->> 'product_id') value
    from jsonb_array_elements(p_lines)
    where coalesce(value ->> 'product_id', '') <> ''
  loop
    select * into v_master
    from public.products
    where id = (v_line ->> 'product_id')::uuid
      and company_id is null
      and coalesce(product_type, type, category, '') in ('pesticide', 'fertilizer', 'additive')
      and coalesce(archived, false) = false
      and coalesce(is_active, true) = true;

    if not found then
      continue;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_company_id::text || ':' || v_master.id::text, 0)
    );

    select * into v_company_product
    from public.products
    where company_id = p_company_id
      and (
        master_product_id = v_master.id
        or (
          master_product_id is null
          and lower(name) = lower(v_master.name)
          and coalesce(lower(product_form), '') = coalesce(lower(v_master.product_form), '')
        )
      )
    order by (master_product_id = v_master.id) desc, created_at asc
    limit 1
    for update;

    if found then
      if v_company_product.master_product_id is not null
         and v_company_product.master_product_id <> v_master.id then
        raise exception 'Company product identity conflicts with another global product';
      end if;

      if v_company_product.master_product_id = v_master.id
         and coalesce(v_company_product.archived, false) = false
         and coalesce(v_company_product.is_active, true) = true then
        v_actions := v_actions || jsonb_build_array(jsonb_build_object(
          'master_product_id', v_master.id,
          'company_product_id', v_company_product.id,
          'action', 'existing'
        ));
      else
        update public.products
        set master_product_id = v_master.id,
            archived = false,
            is_active = true,
            updated_at = now()
        where id = v_company_product.id
        returning * into v_company_product;

        v_actions := v_actions || jsonb_build_array(jsonb_build_object(
          'master_product_id', v_master.id,
          'company_product_id', v_company_product.id,
          'action', 'reactivated'
        ));
      end if;
    else
      insert into public.products (
        name, type, company_id, user_id, unit, description,
        name_ru, name_kz, name_en, crop_id, product_form,
        accounting_mode, base_uom, pack_uom, unit_weight_kg, units_per_pack,
        is_seed_material, master_product_id, active_ingredient,
        pesticide_subcategories, is_active, trade_name, manufacturer,
        formulation, package_size, package_unit, default_unit, notes,
        pesticide_category, fertilizer_type, category, subcategory,
        concentration, composition, category_id, product_type,
        mode_of_action_type, manufacturer_id, formulation_id,
        mode_of_action_type_id, application_rate_text, normalized_name,
        ui_group, stock_unit, default_rate_type, default_rate_unit,
        physical_state, archived
      ) values (
        v_master.name, v_master.type, p_company_id, v_actor.id, v_master.unit, v_master.description,
        v_master.name_ru, v_master.name_kz, v_master.name_en, v_master.crop_id, v_master.product_form,
        v_master.accounting_mode, v_master.base_uom, v_master.pack_uom, v_master.unit_weight_kg, v_master.units_per_pack,
        v_master.is_seed_material, v_master.id, v_master.active_ingredient,
        v_master.pesticide_subcategories, true, v_master.trade_name, v_master.manufacturer,
        v_master.formulation, v_master.package_size, v_master.package_unit, v_master.default_unit, v_master.notes,
        v_master.pesticide_category, v_master.fertilizer_type, v_master.category, v_master.subcategory,
        v_master.concentration, v_master.composition, v_master.category_id, v_master.product_type,
        v_master.mode_of_action_type, v_master.manufacturer_id, v_master.formulation_id,
        v_master.mode_of_action_type_id, v_master.application_rate_text, v_master.normalized_name,
        v_master.ui_group, v_master.stock_unit, v_master.default_rate_type, v_master.default_rate_unit,
        v_master.physical_state, false
      ) returning * into v_company_product;

      v_actions := v_actions || jsonb_build_array(jsonb_build_object(
        'master_product_id', v_master.id,
        'company_product_id', v_company_product.id,
        'action', 'created'
      ));
    end if;
  end loop;

  update public.tickets
  set audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'company_product_links', v_actions
      ),
      updated_at = now()
  where id = p_idempotency_key and company_id = p_company_id;

  return v_result || jsonb_build_object('company_product_links', v_actions);
end;
$$;

revoke all on function public.create_warehouse_receipt_atomic_v2(
  uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
) from authenticated;
revoke all on function public.create_warehouse_receipt_atomic_v3(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) from authenticated;
revoke all on function public.create_warehouse_receipt_atomic_v4(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.create_warehouse_receipt_atomic_v4(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) to authenticated;

comment on function public.create_warehouse_receipt_atomic_v4(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) is
  'Warehousekeeper-only atomic supplier receipt. Finalization and company agrochemical product linkage share one transaction.';

commit;

notify pgrst, 'reload schema';
