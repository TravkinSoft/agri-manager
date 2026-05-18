-- Supplier receipt rebuild foundation.
-- Scope: company-level suppliers and supplier receipt metadata.
-- Safe/additive: does not drop or rewrite operational data.

begin;

create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  counterparty_type text not null default 'supplier',
  phone text,
  notes text,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint counterparties_type_check
    check (counterparty_type in ('supplier', 'buyer', 'both', 'other'))
);

alter table public.counterparties
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists name text,
  add column if not exists counterparty_type text not null default 'supplier',
  add column if not exists phone text,
  add column if not exists notes text,
  add column if not exists is_active boolean not null default true,
  add column if not exists archived boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists counterparties_company_name_active_uidx
  on public.counterparties(company_id, lower(trim(name)))
  where archived = false;

create index if not exists idx_counterparties_company_type
  on public.counterparties(company_id, counterparty_type, archived, is_active);

alter table public.tickets
  add column if not exists supplier_document_no text,
  add column if not exists receipt_mode text,
  add column if not exists supplier_receipt_kind text;

alter table public.tickets
  drop constraint if exists tickets_receipt_mode_check,
  add constraint tickets_receipt_mode_check
    check (receipt_mode is null or receipt_mode in ('weighbridge', 'direct'));

alter table public.tickets
  drop constraint if exists tickets_supplier_receipt_kind_check,
  add constraint tickets_supplier_receipt_kind_check
    check (supplier_receipt_kind is null or supplier_receipt_kind in ('generic', 'agro_identity'));

create index if not exists idx_tickets_company_supplier
  on public.tickets(company_id, supplier_id)
  where supplier_id is not null;

create index if not exists idx_tickets_company_receipt_mode
  on public.tickets(company_id, op_type, receipt_mode);

alter table public.counterparties enable row level security;

drop policy if exists "Users can view company counterparties" on public.counterparties;
drop policy if exists "Users can insert company counterparties" on public.counterparties;
drop policy if exists "Users can update company counterparties" on public.counterparties;

create policy "Users can view company counterparties"
  on public.counterparties
  for select
  to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company counterparties"
  on public.counterparties
  for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company counterparties"
  on public.counterparties
  for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

do $$
declare
  v_company_id uuid;
begin
  select id
    into v_company_id
  from public.companies
  where lower(name) like lower('%астык-stem%')
  order by created_at nulls last
  limit 1;

  if v_company_id is not null then
    insert into public.counterparties(company_id, name, counterparty_type, notes)
    values
      (v_company_id, 'ТОО "KazAgro Trade"', 'supplier', 'Тестовый поставщик для приемки материалов'),
      (v_company_id, 'ТОО "Agrohim Service"', 'supplier', 'Тестовый поставщик удобрений и СЗР'),
      (v_company_id, 'ИП "Семена Казахстана"', 'supplier', 'Тестовый поставщик семян')
    on conflict do nothing;
  end if;
end $$;

commit;
