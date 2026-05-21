begin;

create or replace function public.issue_warehouse_request_v2(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_source_warehouse_id uuid,
  p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.warehouse_issue_requests%rowtype;
  v_auth_uid uuid;
  v_actor_profile_id uuid;
  v_actor_company_id uuid;
  v_actor_role text;
  v_actor_status text;
  v_has_user_id_column boolean := false;
  v_now timestamptz := now();
  v_item record;
  v_balance numeric;
  v_issue_qty numeric;
  v_total_required numeric := 0;
  v_total_issued numeric := 0;
  v_status text := 'partially_issued';
begin
  v_auth_uid := auth.uid();
  if v_auth_uid is null then
    raise exception 'Unauthorized actor';
  end if;

  select *
    into v_request
  from public.warehouse_issue_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Warehouse issue request not found';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'user_id'
  ) into v_has_user_id_column;

  if v_has_user_id_column then
    execute $sql$
      select p.id, p.company_id, p.role, p.status
      from public.profiles p
      where (p.id = $1 or p.user_id = $1 or p.id = $2 or p.user_id = $2)
        and (p.id = $2 or p.user_id = $2)
      order by
        case
          when p.id = $1 then 0
          when p.user_id = $1 then 1
          when p.id = $2 then 2
          else 3
        end
      limit 1
    $sql$
    into v_actor_profile_id, v_actor_company_id, v_actor_role, v_actor_status
    using p_actor_user_id, v_auth_uid;
  else
    select p.id, p.company_id, p.role, p.status
      into v_actor_profile_id, v_actor_company_id, v_actor_role, v_actor_status
    from public.profiles p
    where (p.id = p_actor_user_id or p.id = v_auth_uid)
      and p.id = v_auth_uid
    order by case when p.id = p_actor_user_id then 0 else 1 end
    limit 1;
  end if;

  if v_actor_profile_id is null then
    raise exception 'Unauthorized actor';
  end if;

  if v_actor_company_id <> v_request.company_id then
    raise exception 'Company mismatch for issue request';
  end if;

  if coalesce(v_actor_role, '') not in ('warehouse', 'warehouse_operator')
     or coalesce(v_actor_status, '') <> 'active' then
    raise exception 'Only active warehouse operator can issue this request';
  end if;

  if v_request.status = 'received_confirmed' then
    return jsonb_build_object('success', true, 'already_confirmed', true, 'request_id', v_request.id);
  end if;

  if v_request.status = 'cancelled' then
    raise exception 'Request is cancelled';
  end if;

  if v_request.status not in ('active', 'preparing', 'ready', 'partially_issued', 'issued_by_warehouse') then
    raise exception 'Request must be active/preparing/ready before issuing';
  end if;

  perform 1
  from public.warehouses w
  where w.id = p_source_warehouse_id
    and w.company_id = v_request.company_id
    and coalesce(w.archived, false) = false;

  if not found then
    raise exception 'Source warehouse not found in current company';
  end if;

  for v_item in
    select i.*
    from public.warehouse_issue_request_items i
    where i.request_id = v_request.id
    order by i.created_at asc
  loop
    v_issue_qty := null;

    if p_items is not null then
      select nullif(elem->>'issued_quantity', '')::numeric
      into v_issue_qty
      from jsonb_array_elements(p_items) elem
      where (elem->>'item_id')::uuid = v_item.id
      limit 1;
    end if;

    if v_issue_qty is null then
      v_issue_qty := greatest(coalesce(v_item.planned_quantity, v_item.required_quantity, 0) - coalesce(v_item.issued_quantity, 0), 0);
    end if;

    if v_issue_qty < 0 then
      raise exception 'Issued quantity must be >= 0';
    end if;

    if v_issue_qty = 0 then
      continue;
    end if;

    if v_issue_qty > greatest(coalesce(v_item.planned_quantity, v_item.required_quantity, 0) - coalesce(v_item.issued_quantity, 0), 0) then
      raise exception 'Issued quantity exceeds planned remainder for item %', v_item.id;
    end if;

    v_balance := public.get_warehouse_product_balance(
      v_request.company_id,
      p_source_warehouse_id,
      v_item.product_id
    );

    if v_balance < v_issue_qty then
      raise exception 'Insufficient stock for product %. Available: %, required: %',
        v_item.product_id, v_balance, v_issue_qty;
    end if;
  end loop;

  for v_item in
    select i.*
    from public.warehouse_issue_request_items i
    where i.request_id = v_request.id
    order by i.created_at asc
  loop
    v_issue_qty := null;

    if p_items is not null then
      select nullif(elem->>'issued_quantity', '')::numeric
      into v_issue_qty
      from jsonb_array_elements(p_items) elem
      where (elem->>'item_id')::uuid = v_item.id
      limit 1;
    end if;

    if v_issue_qty is null then
      v_issue_qty := greatest(coalesce(v_item.planned_quantity, v_item.required_quantity, 0) - coalesce(v_item.issued_quantity, 0), 0);
    end if;

    if v_issue_qty <= 0 then
      continue;
    end if;

    insert into public.inventory_transactions (
      warehouse_id,
      source_warehouse_id,
      destination_warehouse_id,
      product_id,
      quantity,
      transaction_type,
      movement_type,
      status,
      operation_datetime,
      date,
      notes,
      responsible_user_id,
      confirmed_at,
      user_id,
      company_id,
      warehouse_issue_request_id,
      warehouse_issue_request_item_id,
      operation_id,
      field_id
    ) values (
      p_source_warehouse_id,
      p_source_warehouse_id,
      null,
      v_item.product_id,
      v_issue_qty,
      'out',
      'issue',
      'draft',
      v_now,
      v_now::date,
      format(
        'Issued by warehouse, pending specialist confirmation. Request %s, operation %s',
        v_request.request_number,
        v_request.operation_id
      ),
      coalesce(v_request.assigned_specialist_id, v_request.recipient_user_id),
      null,
      v_actor_profile_id,
      v_request.company_id,
      v_request.id,
      v_item.id,
      v_request.operation_id,
      v_request.field_id
    );

    update public.warehouse_issue_request_items
    set
      issued_quantity = coalesce(issued_quantity, 0) + v_issue_qty,
      batch_id = coalesce(batch_id, (
        select (elem->>'batch_id')::uuid
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) elem
        where (elem->>'item_id')::uuid = v_item.id
          and nullif(elem->>'batch_id', '') is not null
        limit 1
      ))
    where id = v_item.id;
  end loop;

  select
    coalesce(sum(coalesce(planned_quantity, required_quantity)), 0),
    coalesce(sum(coalesce(issued_quantity, 0)), 0)
    into v_total_required, v_total_issued
  from public.warehouse_issue_request_items
  where request_id = v_request.id;

  if v_total_required > 0 and v_total_issued >= v_total_required then
    v_status := 'issued_by_warehouse';
  end if;

  update public.warehouse_issue_requests
  set
    status = v_status,
    source_warehouse_id = p_source_warehouse_id,
    issued_at = coalesce(issued_at, v_now),
    issued_by_user_id = v_actor_profile_id,
    updated_at = v_now
  where id = v_request.id;

  return jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'status', v_status,
    'issued_at', v_now,
    'total_required', v_total_required,
    'total_issued', v_total_issued
  );
end;
$$;

create or replace function public.confirm_warehouse_request_receipt(
  p_request_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.warehouse_issue_requests%rowtype;
  v_auth_uid uuid;
  v_actor_profile_id uuid;
  v_actor_company_id uuid;
  v_actor_status text;
  v_has_user_id_column boolean := false;
  v_now timestamptz := now();
  v_item record;
  v_balance numeric;
begin
  v_auth_uid := auth.uid();
  if v_auth_uid is null then
    raise exception 'Unauthorized actor';
  end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Warehouse issue request not found';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'user_id'
  ) into v_has_user_id_column;

  if v_has_user_id_column then
    execute $sql$
      select p.id, p.company_id, p.status
      from public.profiles p
      where (p.id = $1 or p.user_id = $1 or p.id = $2 or p.user_id = $2)
        and (p.id = $2 or p.user_id = $2)
      order by
        case
          when p.id = $1 then 0
          when p.user_id = $1 then 1
          when p.id = $2 then 2
          else 3
        end
      limit 1
    $sql$
    into v_actor_profile_id, v_actor_company_id, v_actor_status
    using p_actor_user_id, v_auth_uid;
  else
    select p.id, p.company_id, p.status
      into v_actor_profile_id, v_actor_company_id, v_actor_status
    from public.profiles p
    where (p.id = p_actor_user_id or p.id = v_auth_uid)
      and p.id = v_auth_uid
    order by case when p.id = p_actor_user_id then 0 else 1 end
    limit 1;
  end if;

  if v_actor_profile_id is null then
    raise exception 'Unauthorized actor';
  end if;

  if v_actor_company_id <> v_request.company_id then
    raise exception 'Company mismatch for request';
  end if;

  if coalesce(v_actor_status, '') <> 'active' then
    raise exception 'Only active recipient can confirm receipt';
  end if;

  if coalesce(v_request.assigned_specialist_id, v_request.recipient_user_id) <> v_actor_profile_id then
    raise exception 'Only assigned specialist can confirm receipt';
  end if;

  if v_request.status = 'received_confirmed' then
    return jsonb_build_object('success', true, 'already_confirmed', true, 'request_id', v_request.id);
  end if;

  if v_request.status not in ('issued_by_warehouse', 'partially_issued') then
    raise exception 'Request must be issued by warehouse before specialist confirmation';
  end if;

  if v_request.source_warehouse_id is null then
    raise exception 'Source warehouse is not set for request';
  end if;

  for v_item in
    select product_id, coalesce(sum(quantity), 0)::numeric as qty
    from public.inventory_transactions
    where warehouse_issue_request_id = v_request.id
      and company_id = v_request.company_id
      and status = 'draft'
    group by product_id
  loop
    v_balance := public.get_warehouse_product_balance(
      v_request.company_id,
      v_request.source_warehouse_id,
      v_item.product_id
    );

    if v_balance < v_item.qty then
      raise exception 'Insufficient stock at specialist confirmation for product %. Available: %, required: %',
        v_item.product_id, v_balance, v_item.qty;
    end if;
  end loop;

  update public.inventory_transactions
  set
    status = 'confirmed',
    confirmed_at = v_now
  where warehouse_issue_request_id = v_request.id
    and company_id = v_request.company_id
    and status = 'draft';

  update public.warehouse_issue_requests
  set
    status = 'received_confirmed',
    received_confirmed_at = v_now,
    specialist_confirmed_at = v_now,
    received_confirmed_by_user_id = v_actor_profile_id,
    specialist_confirmed_by_user_id = v_actor_profile_id,
    updated_at = v_now
  where id = v_request.id;

  return jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'status', 'received_confirmed',
    'received_confirmed_at', v_now
  );
end;
$$;

commit;

notify pgrst, 'reload schema';
