-- TZ-239: keep quantity-only warehouse issue compatible with catalog identity.
--
-- Company catalog rows may point at a global master product while existing
-- stock ledger rows still use that master ID. Resolve the request item to the
-- master inside the same transaction before reservation and issue.

do $migration$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  if v_prepare_definition is null then
    raise exception 'Quantity-only warehouse prepare RPC is missing';
  end if;

  v_prepare_definition := replace(
    v_prepare_definition,
    'prepare_material_request_atomic_v1',
    'prepare_material_request_atomic_v2'
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    'v_product_id := coalesce(v_item.actual_product_id, v_item.product_id);',
    $replacement$v_product_id := coalesce(
      v_item.actual_product_id,
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.product_id
      ),
      v_item.product_id
    );
    update public.warehouse_issue_request_items
    set actual_product_id = v_product_id
    where id = v_item.id
      and actual_product_id is distinct from v_product_id;
    v_item.actual_product_id := v_product_id;$replacement$
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    'request_ready_quantity_v1',
    'request_ready_identity_v1'
  );
  if position('v_item.actual_product_id := v_product_id;' in v_prepare_definition) = 0 then
    raise exception 'Catalog identity assignment could not be installed';
  end if;
  execute v_prepare_definition;

  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v2(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;
  if v_issue_definition is null then
    raise exception 'Quantity-only warehouse issue RPC is missing';
  end if;
  v_issue_definition := replace(
    v_issue_definition,
    'issue_material_request_atomic_v2',
    'issue_material_request_atomic_v3'
  );
  v_issue_definition := replace(
    v_issue_definition,
    'issued_quantity_v1',
    'issued_identity_quantity_v1'
  );
  execute v_issue_definition;
end;
$migration$;

revoke all on function public.prepare_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.issue_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.prepare_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon;
grant execute on function public.prepare_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to authenticated;

revoke all on function public.issue_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.issue_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

do $postcheck$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v2(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v3(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;

  if v_prepare_definition is null or v_issue_definition is null then
    raise exception 'Identity-safe warehouse RPCs were not created';
  end if;
  if position('v_item.actual_product_id := v_product_id;' in v_prepare_definition) = 0 then
    raise exception 'Identity-safe prepare RPC is incomplete';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.prepare_material_request_atomic_v1(' ||
      'uuid,uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.issue_material_request_atomic_v2(' ||
      'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Superseded quantity RPCs remain callable by authenticated';
  end if;
end;
$postcheck$;
