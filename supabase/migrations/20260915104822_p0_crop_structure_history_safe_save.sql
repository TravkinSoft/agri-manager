-- Keep historical crop-structure identities addressable from tickets, batches,
-- operations and warehouse documents. Removing a row from the current plan is
-- a soft archive; the existing v5 validator then saves the submitted active set
-- atomically in the same transaction.
create or replace function public.save_crop_structure_field_v6(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_actor_auth_user_id uuid,
  p_field_id uuid,
  p_season_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'rows must be an array with at most 100 items' using errcode = '22023';
  end if;

  update public.crop_structure as cs
  set archived = true,
      updated_at = now()
  where cs.company_id = p_company_id
    and cs.field_id = p_field_id
    and cs.season_id = p_season_id
    and coalesce(cs.archived, false) = false
    and not exists (
      select 1
      from jsonb_array_elements(p_rows) as submitted(row_payload)
      where nullif(submitted.row_payload ->> 'id', '')::uuid = cs.id
    );

  v_result := public.save_crop_structure_field_v5(
    p_company_id,
    p_actor_profile_id,
    p_actor_auth_user_id,
    p_field_id,
    p_season_id,
    p_rows
  );

  return v_result;
end;
$$;

revoke all on function public.save_crop_structure_field_v6(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_crop_structure_field_v6(uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
