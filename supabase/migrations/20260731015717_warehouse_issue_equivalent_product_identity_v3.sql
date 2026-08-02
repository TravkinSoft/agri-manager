-- TZ-239: treat a company product and its global master as one identity.
--
-- The substitution guard remains active for genuinely different products.
-- This migration only creates a new callable issue RPC version.

do $migration$
declare
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v4(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;
  if v_issue_definition is null then
    raise exception 'Actual identity-aware warehouse issue RPC is missing';
  end if;

  v_issue_definition := replace(
    v_issue_definition,
    'issue_material_request_atomic_v4',
    'issue_material_request_atomic_v5'
  );
  v_issue_definition := replace(
    v_issue_definition,
    $anchor$    v_issue_quantity := coalesce((v_item_input ->> 'issued_quantity')::numeric, 0);$anchor$,
    $equivalent$    if coalesce(
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.planned_product_id
      ),
      v_item.planned_product_id
    ) is distinct from coalesce(
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.actual_product_id
      ),
      v_item.actual_product_id
    ) and coalesce(v_item.substitution_status, 'none') <> 'approved' then
      raise exception 'Material substitution must be approved before issue'
        using errcode = '23514';
    end if;
    v_issue_quantity := coalesce((v_item_input ->> 'issued_quantity')::numeric, 0);$equivalent$
  );
  v_issue_definition := replace(
    v_issue_definition,
    'issued_actual_identity_quantity_v2',
    'issued_equivalent_identity_quantity_v3'
  );
  if position('p.id = v_item.planned_product_id' in v_issue_definition) = 0
     or position('substitution_status' in v_issue_definition) = 0 then
    raise exception 'Equivalent product identity guard could not be installed';
  end if;
  execute v_issue_definition;
end;
$migration$;

revoke all on function public.issue_material_request_atomic_v4(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.issue_material_request_atomic_v5(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.issue_material_request_atomic_v5(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

do $postcheck$
declare
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v5(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;

  if v_issue_definition is null or position(
    'p.id = v_item.planned_product_id' in v_issue_definition
  ) = 0 then
    raise exception 'Equivalent product identity-safe issue RPC is incomplete';
  end if;
  if position('substitution_status' in v_issue_definition) = 0 then
    raise exception 'Material substitution guard was removed';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.issue_material_request_atomic_v4(' ||
      'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Superseded issue RPC remains callable';
  end if;
end;
$postcheck$;
