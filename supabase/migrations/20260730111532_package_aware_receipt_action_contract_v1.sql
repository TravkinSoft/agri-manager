-- Keep the package-aware RPCs compatible with the canonical
-- operation_mutation_receipts_action_check contract.
do $migration$
declare
  v_signature text;
  v_definition text;
begin
  v_signature :=
    'public.prepare_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)';
  select pg_get_functiondef(to_regprocedure(v_signature))
  into v_definition;
  if v_definition is null then
    raise exception 'Package-aware prepare RPC is missing';
  end if;
  if position('request_stage_package_v1' in v_definition) > 0 then
    execute replace(
      v_definition,
      quote_literal('request_stage_package_v1'),
      quote_literal('request_stage')
    );
  end if;

  v_signature :=
    'public.issue_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)';
  select pg_get_functiondef(to_regprocedure(v_signature))
  into v_definition;
  if v_definition is null then
    raise exception 'Package-aware issue RPC is missing';
  end if;
  if position('issue_package_v1' in v_definition) > 0 then
    execute replace(
      v_definition,
      quote_literal('issue_package_v1'),
      quote_literal('issue')
    );
  end if;
end;
$migration$;

do $postcheck$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  select pg_get_functiondef(to_regprocedure(
    'public.issue_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;

  if position('request_stage_package_v1' in v_prepare_definition) > 0
     or position('issue_package_v1' in v_issue_definition) > 0 then
    raise exception 'Package-aware receipt actions were not canonicalized';
  end if;
  if position(quote_literal('request_stage') in v_prepare_definition) = 0
     or position(quote_literal('issue') in v_issue_definition) = 0 then
    raise exception 'Canonical receipt actions are missing';
  end if;
end;
$postcheck$;
