/*
  Global admin company context switching without mutating profiles.company_id
*/

create table if not exists public.global_admin_company_contexts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_global_admin_company_contexts_company_id
  on public.global_admin_company_contexts(company_id);

alter table public.global_admin_company_contexts enable row level security;

drop policy if exists "Users can view own global admin context" on public.global_admin_company_contexts;
create policy "Users can view own global admin context"
  on public.global_admin_company_contexts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can manage own global admin context" on public.global_admin_company_contexts;
create policy "Users can manage own global admin context"
  on public.global_admin_company_contexts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop function if exists public.get_profile_company_id(uuid);
create or replace function public.get_profile_company_id(target_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.company_id
  from public.profiles p
  where p.id = target_user_id
  limit 1;
$$;

grant execute on function public.get_profile_company_id(uuid) to authenticated;

create or replace function public.get_user_company_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  user_company_id uuid;
  user_role text;
  context_company_id uuid;
begin
  select p.company_id, p.role
  into user_company_id, user_role
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  if user_role = 'global_admin' then
    select c.company_id
    into context_company_id
    from public.global_admin_company_contexts c
    where c.user_id = auth.uid()
    limit 1;

    if context_company_id is not null then
      return context_company_id;
    end if;
  end if;

  return user_company_id;
end;
$$;

grant execute on function public.get_user_company_id() to authenticated;
