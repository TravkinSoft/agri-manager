begin;

create or replace function public.normalize_counterparty_name_v1(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(p_value), '[^[:alnum:]]+', ' ', 'g'),
      '^(тоо|ооо|ао|ип)[[:space:]]+',
      '',
      'i'
    )
  );
$$;

create table if not exists public.global_counterparties (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  normalized_name text generated always as (public.normalize_counterparty_name_v1(legal_name)) stored,
  tax_id text not null,
  country_code text not null,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint global_counterparties_legal_name_check check (btrim(legal_name) <> ''),
  constraint global_counterparties_tax_id_check check (tax_id ~ '^[0-9]+$'),
  constraint global_counterparties_country_check check (country_code in ('KZ', 'RU')),
  constraint global_counterparties_country_tax_unique unique (country_code, tax_id)
);

create index if not exists idx_global_counterparties_search_name
  on public.global_counterparties(normalized_name);
create index if not exists idx_global_counterparties_status
  on public.global_counterparties(archived, is_active, country_code);

alter table public.counterparties
  add column if not exists global_counterparty_id uuid,
  add column if not exists bin_iin text,
  add column if not exists country_code text,
  add column if not exists contact_person text,
  add column if not exists first_used_at timestamptz,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists normalized_name text generated always as (public.normalize_counterparty_name_v1(name)) stored;

alter table public.counterparties
  drop constraint if exists counterparties_global_counterparty_id_fkey,
  add constraint counterparties_global_counterparty_id_fkey
    foreign key (global_counterparty_id)
    references public.global_counterparties(id)
    on delete restrict;

alter table public.counterparties
  drop constraint if exists counterparties_country_check,
  add constraint counterparties_country_check
    check (country_code is null or country_code in ('KZ', 'RU'));

alter table public.counterparties
  drop constraint if exists counterparties_bin_iin_check,
  add constraint counterparties_bin_iin_check
    check (bin_iin is null or bin_iin ~ '^[0-9]+$');

alter table public.counterparties
  drop constraint if exists counterparties_type_check,
  add constraint counterparties_type_check
    check (counterparty_type in ('supplier', 'buyer', 'carrier', 'service', 'both', 'other'));

drop index if exists public.counterparties_company_name_active_uidx;
create unique index if not exists counterparties_company_legacy_name_uidx
  on public.counterparties(company_id, normalized_name)
  where archived = false and bin_iin is null;
create unique index if not exists counterparties_company_global_uidx
  on public.counterparties(company_id, global_counterparty_id)
  where global_counterparty_id is not null;
create unique index if not exists counterparties_company_tax_uidx
  on public.counterparties(company_id, country_code, bin_iin)
  where country_code is not null and bin_iin is not null;
create index if not exists idx_counterparties_company_search
  on public.counterparties(company_id, normalized_name, archived, is_active);

alter table public.tickets
  drop constraint if exists tickets_supplier_id_fkey,
  add constraint tickets_supplier_id_fkey
    foreign key (supplier_id)
    references public.counterparties(id)
    on delete restrict
    not valid;

create table if not exists public.counterparty_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete cascade,
  global_counterparty_id uuid references public.global_counterparties(id) on delete restrict,
  company_counterparty_id uuid references public.counterparties(id) on delete restrict,
  action text not null,
  actor_user_id uuid references public.profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_counterparty_audit_company_created
  on public.counterparty_audit_log(company_id, created_at desc);
create index if not exists idx_counterparty_audit_global_created
  on public.counterparty_audit_log(global_counterparty_id, created_at desc);

create or replace function public.set_counterparty_updated_at_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists global_counterparties_set_updated_at_v1 on public.global_counterparties;
create trigger global_counterparties_set_updated_at_v1
before update on public.global_counterparties
for each row execute function public.set_counterparty_updated_at_v1();

drop trigger if exists counterparties_set_updated_at_v1 on public.counterparties;
create trigger counterparties_set_updated_at_v1
before update on public.counterparties
for each row execute function public.set_counterparty_updated_at_v1();

create or replace function public.audit_counterparty_change_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_action text;
  v_company_id uuid;
  v_global_id uuid;
  v_company_counterparty_id uuid;
  v_details jsonb;
begin
  if tg_table_name = 'global_counterparties' then
    v_global_id := new.id;
    if tg_op = 'INSERT' then
      v_action := 'global_created';
      v_details := jsonb_build_object(
        'legal_name', new.legal_name,
        'tax_id', new.tax_id,
        'country_code', new.country_code
      );
    else
      v_action := case
        when old.archived = false and new.archived = true then 'global_archived'
        when old.archived = true and new.archived = false then 'global_restored'
        else 'global_updated'
      end;
      v_details := jsonb_build_object(
        'before', jsonb_build_object(
          'legal_name', old.legal_name,
          'tax_id', old.tax_id,
          'country_code', old.country_code,
          'is_active', old.is_active,
          'archived', old.archived
        ),
        'after', jsonb_build_object(
          'legal_name', new.legal_name,
          'tax_id', new.tax_id,
          'country_code', new.country_code,
          'is_active', new.is_active,
          'archived', new.archived
        )
      );
    end if;
  else
    v_company_id := new.company_id;
    v_global_id := new.global_counterparty_id;
    v_company_counterparty_id := new.id;
    if tg_op = 'INSERT' then
      v_action := case when new.global_counterparty_id is null
        then 'company_local_created'
        else 'company_global_linked'
      end;
      v_details := jsonb_build_object(
        'name', new.name,
        'tax_id', new.bin_iin,
        'country_code', new.country_code
      );
    else
      v_action := case
        when old.archived = false and new.archived = true then 'company_archived'
        when old.archived = true and new.archived = false then 'company_restored'
        when old.is_active = false and new.is_active = true then 'company_reactivated'
        else 'company_updated'
      end;
      v_details := jsonb_build_object(
        'before', jsonb_build_object(
          'name', old.name,
          'tax_id', old.bin_iin,
          'country_code', old.country_code,
          'is_active', old.is_active,
          'archived', old.archived
        ),
        'after', jsonb_build_object(
          'name', new.name,
          'tax_id', new.bin_iin,
          'country_code', new.country_code,
          'is_active', new.is_active,
          'archived', new.archived
        )
      );
    end if;
  end if;

  insert into public.counterparty_audit_log(
    company_id,
    global_counterparty_id,
    company_counterparty_id,
    action,
    actor_user_id,
    details
  ) values (
    v_company_id,
    v_global_id,
    v_company_counterparty_id,
    v_action,
    auth.uid(),
    v_details
  );
  return new;
end;
$$;

drop trigger if exists global_counterparties_audit_v1 on public.global_counterparties;
create trigger global_counterparties_audit_v1
after insert or update on public.global_counterparties
for each row execute function public.audit_counterparty_change_v1();

drop trigger if exists counterparties_audit_v1 on public.counterparties;
create trigger counterparties_audit_v1
after insert or update on public.counterparties
for each row execute function public.audit_counterparty_change_v1();

alter table public.global_counterparties enable row level security;
alter table public.counterparties enable row level security;
alter table public.counterparty_audit_log enable row level security;

drop policy if exists "Authenticated users can read active global counterparties" on public.global_counterparties;
drop policy if exists "Global admins can insert global counterparties" on public.global_counterparties;
drop policy if exists "Global admins can update global counterparties" on public.global_counterparties;

create policy "Authenticated users can read active global counterparties"
  on public.global_counterparties
  for select
  to authenticated
  using (
    (archived = false and is_active = true)
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and p.role = 'global_admin'
    )
  );

create policy "Global admins can insert global counterparties"
  on public.global_counterparties
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and p.role = 'global_admin'
    )
  );

create policy "Global admins can update global counterparties"
  on public.global_counterparties
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and p.role = 'global_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and p.role = 'global_admin'
    )
  );

drop policy if exists "Users can view company counterparties" on public.counterparties;
drop policy if exists "Users can insert company counterparties" on public.counterparties;
drop policy if exists "Users can update company counterparties" on public.counterparties;

create policy "Company users can view company counterparties"
  on public.counterparties
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (p.role = 'global_admin' or p.company_id = counterparties.company_id)
    )
  );

create policy "Company admins can insert company counterparties"
  on public.counterparties
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (p.role = 'company_admin' and p.company_id = counterparties.company_id)
        )
    )
  );

create policy "Company admins can update company counterparties"
  on public.counterparties
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (p.role = 'company_admin' and p.company_id = counterparties.company_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (p.role = 'company_admin' and p.company_id = counterparties.company_id)
        )
    )
  );

create policy "Admins can read counterparty audit"
  on public.counterparty_audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (p.role = 'company_admin' and p.company_id = counterparty_audit_log.company_id)
        )
    )
  );

grant select on public.global_counterparties to authenticated;
grant insert, update on public.global_counterparties to authenticated;
revoke delete, truncate, references, trigger on public.global_counterparties from authenticated, anon, public;
grant select on public.counterparties to authenticated;
grant insert, update on public.counterparties to authenticated;
revoke delete, truncate, references, trigger on public.counterparties from authenticated, anon, public;
grant select on public.counterparty_audit_log to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.counterparty_audit_log from authenticated, anon, public;

create or replace function public.import_global_counterparties_v1(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_total integer;
  v_changed integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select * into v_actor from public.profiles
  where id = auth.uid() and status = 'active';
  if not found or v_actor.role <> 'global_admin' then
    raise exception 'Global admin role is required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import rows must be a JSON array';
  end if;

  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then
    raise exception 'Import rows are empty';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(legal_name text, tax_id text, country_code text)
    where nullif(btrim(x.legal_name), '') is null
       or nullif(btrim(x.tax_id), '') is null
       or x.tax_id !~ '^[0-9]+$'
       or x.country_code not in ('KZ', 'RU')
  ) then
    raise exception 'Import contains an invalid legal name, tax ID or country code';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(legal_name text, tax_id text, country_code text)
    group by x.country_code, x.tax_id
    having count(*) > 1
  ) then
    raise exception 'Import contains duplicate country and tax ID pairs';
  end if;

  insert into public.global_counterparties(
    legal_name, tax_id, country_code, is_active, archived
  )
  select btrim(x.legal_name), btrim(x.tax_id), x.country_code, true, false
  from jsonb_to_recordset(p_rows) as x(legal_name text, tax_id text, country_code text)
  on conflict (country_code, tax_id) do update
  set legal_name = excluded.legal_name,
      is_active = true,
      archived = false
  where global_counterparties.legal_name is distinct from excluded.legal_name
     or global_counterparties.is_active is distinct from true
     or global_counterparties.archived is distinct from false;

  get diagnostics v_changed = row_count;
  return jsonb_build_object(
    'processed_rows', v_total,
    'changed_rows', v_changed,
    'idempotent_noop', v_changed = 0
  );
end;
$$;

create or replace function public.link_global_counterparty_to_company_v1(
  p_company_id uuid,
  p_global_counterparty_id uuid
)
returns public.counterparties
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_global public.global_counterparties%rowtype;
  v_company_counterparty public.counterparties%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Company admin role is required';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to company';
  end if;

  select * into v_global from public.global_counterparties
  where id = p_global_counterparty_id and archived = false and is_active = true;
  if not found then raise exception 'Global counterparty is unavailable'; end if;

  select * into v_company_counterparty
  from public.counterparties
  where company_id = p_company_id
    and (
      global_counterparty_id = v_global.id
      or (country_code = v_global.country_code and bin_iin = v_global.tax_id)
    )
  order by (global_counterparty_id = v_global.id) desc
  limit 1
  for update;

  if found then
    if v_company_counterparty.global_counterparty_id is not null
       and v_company_counterparty.global_counterparty_id <> v_global.id then
      raise exception 'Company tax identity is linked to another global counterparty';
    end if;
    update public.counterparties
    set global_counterparty_id = v_global.id,
        name = v_global.legal_name,
        counterparty_type = 'supplier',
        is_active = true,
        archived = false
    where id = v_company_counterparty.id
    returning * into v_company_counterparty;
  else
    insert into public.counterparties(
      company_id, global_counterparty_id, name, counterparty_type,
      bin_iin, country_code, is_active, archived, first_used_at, created_by
    ) values (
      p_company_id, v_global.id, v_global.legal_name, 'supplier',
      v_global.tax_id, v_global.country_code, true, false, null, v_actor.id
    ) returning * into v_company_counterparty;
  end if;
  return v_company_counterparty;
end;
$$;

create or replace function public.create_local_counterparty_v1(
  p_company_id uuid,
  p_legal_name text,
  p_tax_id text,
  p_country_code text
)
returns public.counterparties
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_row public.counterparties%rowtype;
  v_normalized_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Company admin role is required';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to company';
  end if;
  if nullif(btrim(p_legal_name), '') is null
     or p_tax_id !~ '^[0-9]+$'
     or p_country_code not in ('KZ', 'RU') then
    raise exception 'Legal name, tax ID and country are required';
  end if;
  v_normalized_name := public.normalize_counterparty_name_v1(p_legal_name);

  if exists (
    select 1 from public.global_counterparties
    where country_code = p_country_code and tax_id = p_tax_id
  ) then
    raise exception 'Counterparty already exists in the global catalog';
  end if;
  if exists (
    select 1 from public.global_counterparties
    where normalized_name = v_normalized_name
  ) then
    raise exception 'A similarly named global counterparty exists; verify it before creating a local record';
  end if;
  if exists (
    select 1 from public.counterparties
    where company_id = p_company_id
      and (
        (country_code = p_country_code and bin_iin = p_tax_id)
        or normalized_name = v_normalized_name
      )
  ) then
    raise exception 'Counterparty already exists in the company catalog';
  end if;

  insert into public.counterparties(
    company_id, name, counterparty_type, bin_iin, country_code,
    is_active, archived, first_used_at, created_by
  ) values (
    p_company_id, btrim(p_legal_name), 'supplier', btrim(p_tax_id), p_country_code,
    true, false, null, v_actor.id
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.create_warehouse_receipt_atomic_v2(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_received_at timestamptz,
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
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_warehouse public.warehouses%rowtype;
  v_ticket public.tickets%rowtype;
  v_supplier public.counterparties%rowtype;
  v_global_supplier public.global_counterparties%rowtype;
  v_line jsonb;
  v_product public.products%rowtype;
  v_quantity numeric;
  v_uom text;
  v_category text;
  v_payload jsonb;
  v_fingerprint text;
  v_ticket_no text;
  v_link_action text := 'existing_company_counterparty';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found then raise exception 'Active actor profile not found'; end if;
  if v_actor.role not in ('global_admin', 'company_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Actor role is not allowed to create warehouse receipts';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to receipt company';
  end if;
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if p_supplier_company_counterparty_id is null and p_supplier_global_counterparty_id is null then
    raise exception 'Supplier ID is required';
  end if;
  if p_received_at is null then raise exception 'Receipt date is required'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one receipt line is required';
  end if;

  select * into v_warehouse from public.warehouses
  where id = p_warehouse_id
    and company_id = p_company_id
    and coalesce(archived, false) = false
    and coalesce(is_archived, false) = false;
  if not found then raise exception 'Destination warehouse not found in receipt company'; end if;
  if v_actor.role in ('warehouse', 'warehouse_operator')
     and coalesce(v_warehouse.warehouse_type, '') not in (
       'agrochemical', 'pesticide', 'fertilizer', 'additive', 'universal'
     ) then
    raise exception 'Warehousekeeper can receive only into an agrochemical warehouse';
  end if;

  if p_supplier_global_counterparty_id is not null then
    select * into v_global_supplier from public.global_counterparties
    where id = p_supplier_global_counterparty_id
      and archived = false and is_active = true;
    if not found then raise exception 'Global supplier is unavailable'; end if;
  end if;
  if p_supplier_company_counterparty_id is not null then
    select * into v_supplier from public.counterparties
    where id = p_supplier_company_counterparty_id
      and company_id = p_company_id;
    if not found then raise exception 'Company supplier was not found'; end if;
    if v_supplier.archived or not v_supplier.is_active then
      raise exception 'Company supplier is archived';
    end if;
    if p_supplier_global_counterparty_id is not null
       and v_supplier.global_counterparty_id is distinct from p_supplier_global_counterparty_id then
      raise exception 'Supplier IDs do not identify the same counterparty';
    end if;
  end if;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'warehouse_id', p_warehouse_id,
    'received_at', p_received_at,
    'supplier_company_counterparty_id', p_supplier_company_counterparty_id,
    'supplier_global_counterparty_id', p_supplier_global_counterparty_id,
    'document_no', nullif(btrim(coalesce(p_document_no, '')), ''),
    'notes', nullif(btrim(coalesce(p_notes, '')), ''),
    'lines', p_lines
  );
  v_fingerprint := md5(v_payload::text);

  select * into v_ticket from public.tickets
  where id = p_idempotency_key and company_id = p_company_id;
  if found then
    if coalesce(v_ticket.audit_json ->> 'receipt_fingerprint', '') <> v_fingerprint then
      raise exception 'Idempotency key was already used with another receipt payload';
    end if;
    return jsonb_build_object(
      'receipt_id', v_ticket.id,
      'receipt_no', v_ticket.ticket_no,
      'status', v_ticket.status,
      'supplier_id', v_ticket.supplier_id,
      'idempotent_replay', true
    );
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if coalesce(v_line ->> 'product_id', '') = '' then
      raise exception 'Receipt line product_id is required';
    end if;
    v_quantity := nullif(v_line ->> 'quantity', '')::numeric;
    if coalesce(v_quantity, 0) <= 0 then
      raise exception 'Receipt line quantity must be greater than zero';
    end if;
    select * into v_product from public.products
    where id = (v_line ->> 'product_id')::uuid
      and (company_id = p_company_id or company_id is null)
      and coalesce(archived, false) = false
      and coalesce(is_active, true) = true;
    if not found then raise exception 'Receipt material is unavailable for this company'; end if;
    v_category := lower(coalesce(v_product.product_type, v_product.type, v_product.category, ''));
    if v_category not in ('pesticide', 'fertilizer', 'additive') then
      raise exception 'Only pesticides, fertilizers and additives are allowed in warehouse receipts';
    end if;
    v_uom := lower(btrim(coalesce(v_line ->> 'uom', v_product.base_uom, v_product.unit, '')));
    if v_uom not in ('kg', 'l', 'pcs') then
      raise exception 'Receipt line has unsupported stock unit';
    end if;
    if v_uom <> lower(btrim(coalesce(v_product.base_uom, v_product.unit, ''))) then
      raise exception 'Receipt unit must match the material stock unit';
    end if;
  end loop;

  if p_supplier_global_counterparty_id is not null then
    select * into v_supplier from public.counterparties
    where company_id = p_company_id
      and (
        global_counterparty_id = v_global_supplier.id
        or (country_code = v_global_supplier.country_code and bin_iin = v_global_supplier.tax_id)
      )
    order by (global_counterparty_id = v_global_supplier.id) desc
    limit 1
    for update;
    if found then
      if v_supplier.global_counterparty_id is not null
         and v_supplier.global_counterparty_id <> v_global_supplier.id then
        raise exception 'Company tax identity is linked to another global counterparty';
      end if;
      if v_supplier.archived or not v_supplier.is_active then
        v_link_action := 'company_counterparty_reactivated';
      end if;
      update public.counterparties
      set global_counterparty_id = v_global_supplier.id,
          name = v_global_supplier.legal_name,
          bin_iin = v_global_supplier.tax_id,
          country_code = v_global_supplier.country_code,
          counterparty_type = 'supplier',
          is_active = true,
          archived = false,
          first_used_at = coalesce(first_used_at, p_received_at)
      where id = v_supplier.id
      returning * into v_supplier;
    else
      v_link_action := 'company_counterparty_created';
      insert into public.counterparties(
        company_id, global_counterparty_id, name, counterparty_type,
        bin_iin, country_code, is_active, archived, first_used_at, created_by
      ) values (
        p_company_id, v_global_supplier.id, v_global_supplier.legal_name, 'supplier',
        v_global_supplier.tax_id, v_global_supplier.country_code,
        true, false, p_received_at, v_actor.id
      ) returning * into v_supplier;
    end if;
  end if;

  v_ticket_no := 'WR-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));
  insert into public.tickets (
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, supplier_id, destination_kind, destination_id,
    warehouse_to_id, responsible_user_id, created_by, weigh_method,
    receipt_mode, supplier_receipt_kind, supplier_document_no,
    manual_correction_reason, notes, audit_json, created_at, updated_at
  ) values (
    p_idempotency_key, p_company_id, v_ticket_no, 'receipt', 'supplier_receipt',
    'ready_to_close', 'incoming', 'supplier', v_supplier.name, v_supplier.id,
    'warehouse', p_warehouse_id::text, p_warehouse_id, v_actor.id, v_actor.id,
    'manual_override_with_reason', 'direct', 'generic',
    nullif(btrim(coalesce(p_document_no, '')), ''), 'Warehouse receipt document',
    nullif(btrim(coalesce(p_notes, '')), ''),
    jsonb_build_object(
      'source', 'warehousekeeper_receipt_v2',
      'receipt_fingerprint', v_fingerprint,
      'receipt_payload', v_payload,
      'supplier_company_counterparty_id', v_supplier.id,
      'supplier_global_counterparty_id', v_supplier.global_counterparty_id,
      'company_link_action', v_link_action
    ),
    p_received_at, now()
  ) returning * into v_ticket;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_uom := lower(btrim(coalesce(v_line ->> 'uom', v_product.base_uom, v_product.unit)));
    insert into public.ticket_lines (
      ticket_id, company_id, product_id, product_type, product_name_snapshot,
      uom, quantity, warehouse_to_id, lot_id, batch_class, line_type,
      quality_json, mass_kg, unit_source, unit_contract_version, notes
    ) values (
      v_ticket.id, p_company_id, v_product.id,
      coalesce(v_product.product_type, v_product.type, v_product.category),
      coalesce(nullif(v_product.trade_name, ''), v_product.name),
      v_uom, v_quantity, p_warehouse_id,
      nullif(btrim(coalesce(v_line ->> 'lot_number', '')), ''),
      'material', 'material',
      jsonb_strip_nulls(jsonb_build_object(
        'manufactured_at', nullif(v_line ->> 'manufactured_at', ''),
        'expires_at', nullif(v_line ->> 'expires_at', ''),
        'package_count', nullif(v_line ->> 'package_count', '')::numeric,
        'package_size', nullif(v_line ->> 'package_size', '')::numeric
      )),
      case when v_uom = 'kg' then v_quantity else null end,
      'warehouse_receipt:' || v_ticket.id::text, 2,
      nullif(btrim(coalesce(v_line ->> 'notes', '')), '')
    );
  end loop;

  perform public.finalize_weighbridge_ticket_v2(v_ticket.id, v_actor.id);
  update public.stock_ledger_entries set occurred_at = p_received_at
  where ticket_id = v_ticket.id;

  select * into v_ticket from public.tickets where id = v_ticket.id;
  return jsonb_build_object(
    'receipt_id', v_ticket.id,
    'receipt_no', v_ticket.ticket_no,
    'status', v_ticket.status,
    'supplier_id', v_ticket.supplier_id,
    'supplier_global_counterparty_id', v_supplier.global_counterparty_id,
    'company_link_action', v_link_action,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.import_global_counterparties_v1(jsonb) from public, anon;
grant execute on function public.import_global_counterparties_v1(jsonb) to authenticated;
revoke all on function public.link_global_counterparty_to_company_v1(uuid, uuid) from public, anon;
grant execute on function public.link_global_counterparty_to_company_v1(uuid, uuid) to authenticated;
revoke all on function public.create_local_counterparty_v1(uuid, text, text, text) from public, anon;
grant execute on function public.create_local_counterparty_v1(uuid, text, text, text) to authenticated;
revoke all on function public.create_warehouse_receipt_atomic_v2(
  uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.create_warehouse_receipt_atomic_v2(
  uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
) to authenticated;

revoke all on function public.audit_counterparty_change_v1() from public, anon, authenticated;
revoke all on function public.set_counterparty_updated_at_v1() from public, anon, authenticated;

comment on table public.global_counterparties is
  'Global legal counterparty identities. Country and tax ID are the canonical unique key.';
comment on column public.counterparties.global_counterparty_id is
  'Optional link to the canonical global identity; local-only counterparties keep this null.';
comment on column public.tickets.source_id is
  'Legacy-readable supplier name snapshot. New supplier receipts also set tickets.supplier_id.';
comment on function public.create_warehouse_receipt_atomic_v2(
  uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
) is
  'Creates or reactivates the company supplier link and finalizes a supplier receipt atomically.';

commit;

notify pgrst, 'reload schema';
