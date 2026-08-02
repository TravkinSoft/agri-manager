-- TZ-239: expose quantity-only warehouse preparation and issue RPCs.
--
-- Legacy package columns and RPCs remain in place for rollback compatibility,
-- but authenticated callers can only execute the quantity-only entrypoints.

do $migration$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  if v_prepare_definition is null then
    raise exception 'Legacy warehouse prepare RPC is missing';
  end if;
  if position(
    'Prepared quantity cannot be lower than the operation plan'
    in v_prepare_definition
  ) = 0 then
    raise exception 'Expected lower-plan guard was not found in warehouse prepare RPC';
  end if;

  v_prepare_definition := replace(
    v_prepare_definition,
    'prepare_package_aware_material_request_atomic_v1',
    'prepare_material_request_atomic_v1'
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    'v_issue_mode := v_allocation ->> ''issue_mode'';',
    'v_issue_mode := ''measured'';'
  );
  v_prepare_definition := regexp_replace(
    v_prepare_definition,
    E'\\s*if v_prepared \\+ 0\\.000001\\s*' ||
      E'< coalesce\\(v_item\\.planned_quantity, v_item\\.required_quantity, 0\\) then\\s*' ||
      E'raise exception ''Prepared quantity cannot be lower than the operation plan''\\s*' ||
      E'using errcode = ''23514'';\\s*end if;',
    E'\n',
    'n'
  );
  if position(
    'Prepared quantity cannot be lower than the operation plan'
    in v_prepare_definition
  ) > 0 then
    raise exception 'Lower-plan guard could not be removed from warehouse prepare RPC';
  end if;
  v_prepare_definition := replace(
    v_prepare_definition,
    'request_ready_package_aware_v1',
    'request_ready_quantity_v1'
  );
  execute v_prepare_definition;

  select pg_get_functiondef(to_regprocedure(
    'public.issue_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;
  if v_issue_definition is null then
    raise exception 'Legacy warehouse issue RPC is missing';
  end if;
  v_issue_definition := replace(
    v_issue_definition,
    'issue_package_aware_material_request_atomic_v1',
    'issue_material_request_atomic_v2'
  );
  v_issue_definition := replace(
    v_issue_definition,
    'issued_package_aware_v1',
    'issued_quantity_v1'
  );
  execute v_issue_definition;
end;
$migration$;

revoke all on function public.prepare_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.issue_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.prepare_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon;
grant execute on function public.prepare_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to authenticated;

revoke all on function public.issue_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.issue_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

do $postcheck$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v2(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;

  if v_prepare_definition is null or v_issue_definition is null then
    raise exception 'Quantity-only warehouse RPCs were not created';
  end if;
  if position('v_issue_mode := v_allocation ->> ''issue_mode'';' in v_prepare_definition) > 0
     or position('Prepared quantity cannot be lower than the operation plan' in v_prepare_definition) > 0 then
    raise exception 'Quantity-only prepare RPC still depends on package mode or plan floor';
  end if;
  if position('v_issue_mode := ''measured'';' in v_prepare_definition) = 0 then
    raise exception 'Legacy allocation compatibility mode is missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.prepare_package_aware_material_request_atomic_v1(' ||
      'uuid,uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.issue_package_aware_material_request_atomic_v1(' ||
      'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Legacy package-aware RPC remains callable by authenticated';
  end if;
end;
$postcheck$;
