begin;

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.meal_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requested_by_user_id uuid not null references public.profiles(id) on delete restrict,
  brigadier_name text,
  meal_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'other')),
  field_id uuid references public.fields(id) on delete set null,
  delivery_location_text text,
  comment text,
  status text not null default 'new' check (
    status in (
      'new',
      'accepted',
      'cooking',
      'ready',
      'issued',
      'partially_returned',
      'returned',
      'cancelled'
    )
  ),
  people_count integer not null default 0 check (people_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  issued_at timestamptz,
  returned_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists idx_meal_orders_company_meal_date
  on public.meal_orders(company_id, meal_date desc);

create index if not exists idx_meal_orders_company_status
  on public.meal_orders(company_id, status);

create index if not exists idx_meal_orders_company_requested_by
  on public.meal_orders(company_id, requested_by_user_id);

drop trigger if exists trg_meal_orders_updated_at on public.meal_orders;
create trigger trg_meal_orders_updated_at
before update on public.meal_orders
for each row execute function public.set_updated_at_timestamp();

create table if not exists public.thermoses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  number text not null,
  label text,
  volume_l numeric(10, 2),
  status text not null default 'available' check (
    status in (
      'available',
      'assigned',
      'issued',
      'returned_dirty',
      'cleaning',
      'damaged',
      'lost',
      'inactive'
    )
  ),
  current_holder_name text,
  current_meal_order_id uuid references public.meal_orders(id) on delete set null,
  last_issued_at timestamptz,
  last_returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_thermoses_company_number_unique
  on public.thermoses(company_id, lower(number));

create index if not exists idx_thermoses_company_status
  on public.thermoses(company_id, status);

drop trigger if exists trg_thermoses_updated_at on public.thermoses;
create trigger trg_thermoses_updated_at
before update on public.thermoses
for each row execute function public.set_updated_at_timestamp();

create table if not exists public.meal_order_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  meal_order_id uuid not null references public.meal_orders(id) on delete cascade,
  person_name text not null,
  employee_id uuid references public.profiles(id) on delete set null,
  comment text,
  thermos_id uuid references public.thermoses(id) on delete set null,
  thermos_number text,
  issue_status text not null default 'pending' check (
    issue_status in ('pending', 'assigned', 'issued', 'returned', 'lost', 'damaged')
  ),
  issued_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meal_order_people_company_order
  on public.meal_order_people(company_id, meal_order_id);

create index if not exists idx_meal_order_people_company_status
  on public.meal_order_people(company_id, issue_status);

create index if not exists idx_meal_order_people_company_thermos
  on public.meal_order_people(company_id, thermos_id);

create unique index if not exists idx_meal_order_people_active_thermos_unique
  on public.meal_order_people(company_id, thermos_id)
  where thermos_id is not null and issue_status in ('assigned', 'issued');

drop trigger if exists trg_meal_order_people_updated_at on public.meal_order_people;
create trigger trg_meal_order_people_updated_at
before update on public.meal_order_people
for each row execute function public.set_updated_at_timestamp();

create table if not exists public.thermos_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  thermos_id uuid not null references public.thermoses(id) on delete cascade,
  meal_order_id uuid references public.meal_orders(id) on delete set null,
  meal_order_person_id uuid references public.meal_order_people(id) on delete set null,
  event_type text not null check (
    event_type in (
      'created',
      'assigned',
      'issued',
      'returned',
      'damaged',
      'lost',
      'cleaned',
      'deactivated'
    )
  ),
  actor_user_id uuid references public.profiles(id) on delete set null,
  holder_name text,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_thermos_events_company_thermos
  on public.thermos_events(company_id, thermos_id, created_at desc);

create index if not exists idx_thermos_events_company_order
  on public.thermos_events(company_id, meal_order_id, created_at desc);

alter table public.meal_orders enable row level security;
alter table public.meal_order_people enable row level security;
alter table public.thermoses enable row level security;
alter table public.thermos_events enable row level security;

drop policy if exists "Users can view company meal orders" on public.meal_orders;
create policy "Users can view company meal orders"
  on public.meal_orders for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company meal orders" on public.meal_orders;
create policy "Users can insert company meal orders"
  on public.meal_orders for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company meal orders" on public.meal_orders;
create policy "Users can update company meal orders"
  on public.meal_orders for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can delete company meal orders" on public.meal_orders;
create policy "Users can delete company meal orders"
  on public.meal_orders for delete
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company meal order people" on public.meal_order_people;
create policy "Users can view company meal order people"
  on public.meal_order_people for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company meal order people" on public.meal_order_people;
create policy "Users can insert company meal order people"
  on public.meal_order_people for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company meal order people" on public.meal_order_people;
create policy "Users can update company meal order people"
  on public.meal_order_people for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can delete company meal order people" on public.meal_order_people;
create policy "Users can delete company meal order people"
  on public.meal_order_people for delete
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company thermoses" on public.thermoses;
create policy "Users can view company thermoses"
  on public.thermoses for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company thermoses" on public.thermoses;
create policy "Users can insert company thermoses"
  on public.thermoses for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company thermoses" on public.thermoses;
create policy "Users can update company thermoses"
  on public.thermoses for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can delete company thermoses" on public.thermoses;
create policy "Users can delete company thermoses"
  on public.thermoses for delete
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company thermos events" on public.thermos_events;
create policy "Users can view company thermos events"
  on public.thermos_events for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company thermos events" on public.thermos_events;
create policy "Users can insert company thermos events"
  on public.thermos_events for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

commit;

notify pgrst, 'reload schema';
