-- TZ-239: canonicalize a preselected company product before stock allocation.
--
-- A request item can already contain its company catalog product in
-- actual_product_id. Existing stock may use that row's global master product.
-- Resolve both actual_product_id and product_id to the master atomically.

do $migration$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v2(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  if v_prepare_definition is null then
    raise exception 'Identity-aware warehouse prepare RPC is missing';
  end if;

  v_prepare_definition := replace(
    v_prepare_definition,
    'prepare_material_request_atomic_v2',
    'prepare_material_request_atomic_v3'
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    $old$v_product_id := coalesce(
      v_item.actual_product_id,
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.product_id
      ),
      v_item.product_id
    );$old$,
    $new$v_product_id := coalesce(
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.actual_product_id
      ),
      v_item.actual_product_id,
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.product_id
      ),
      v_item.product_id
    );$new$
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    'request_ready_identity_v1',
    'request_ready_actual_identity_v2'
  );
  if position(
    'p.id = v_item.actual_product_id' in v_prepare_definition
  ) = 0 then
    raise exception 'Actual product identity resolution could not be installed';
  end if;
  execute v_prepare_definition;

  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v3(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;
  if v_issue_definition is null then
    raise exception 'Identity-aware warehouse issue RPC is missing';
  end if;
  v_issue_definition := replace(
    v_issue_definition,
    'issue_material_request_atomic_v3',
    'issue_material_request_atomic_v4'
  );
  v_issue_definition := replace(
    v_issue_definition,
    'issued_identity_quantity_v1',
    'issued_actual_identity_quantity_v2'
  );
  execute v_issue_definition;
end;
$migration$;

revoke all on function public.prepare_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.issue_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.prepare_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon;
grant execute on function public.prepare_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to authenticated;

revoke all on function public.issue_material_request_atomic_v4(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.issue_material_request_atomic_v4(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

do $postcheck$
declare
  v_prepare_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v3(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;

  if v_prepare_definition is null or position(
    'p.id = v_item.actual_product_id' in v_prepare_definition
  ) = 0 then
    raise exception 'Actual product identity-safe prepare RPC is incomplete';
  end if;
  if to_regprocedure(
    'public.issue_material_request_atomic_v4(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ) is null then
    raise exception 'Actual product identity-safe issue RPC is missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.prepare_material_request_atomic_v2(' ||
      'uuid,uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.issue_material_request_atomic_v3(' ||
      'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Superseded identity RPCs remain callable';
  end if;
end;
$postcheck$;
