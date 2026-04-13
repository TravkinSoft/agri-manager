/*
  # Global Knowledge Base Foundation

  Creates scoped knowledge base tables:
  - knowledge_bases (global/project/assistant scopes)
  - knowledge_documents (documents attached to a knowledge base)

  Keeps architecture ready for future project-level and assistant-level KBs,
  while enabling one default global KB per company now.
*/

create table if not exists public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  scope_type text not null check (scope_type in ('global', 'project', 'assistant')),
  scope_project_id uuid null references public.chat_projects(id) on delete cascade,
  scope_assistant_id uuid null,
  is_default boolean not null default false,
  archived boolean not null default false,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  filename text not null,
  file_type text not null,
  file_size bigint not null default 0,
  file_url text null,
  extracted_text text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'ready' check (status in ('ready', 'uploaded', 'failed')),
  archived boolean not null default false,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_knowledge_bases_company_global_default
  on public.knowledge_bases(company_id)
  where scope_type = 'global' and is_default = true and archived = false;

create index if not exists idx_knowledge_bases_company_scope
  on public.knowledge_bases(company_id, scope_type, archived);

create index if not exists idx_knowledge_documents_company_base
  on public.knowledge_documents(company_id, knowledge_base_id, archived, created_at desc);

create index if not exists idx_knowledge_documents_metadata_gin
  on public.knowledge_documents using gin (metadata);

create or replace function public.kb_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_knowledge_bases_updated_at on public.knowledge_bases;
create trigger trg_knowledge_bases_updated_at
before update on public.knowledge_bases
for each row execute procedure public.kb_set_updated_at();

drop trigger if exists trg_knowledge_documents_updated_at on public.knowledge_documents;
create trigger trg_knowledge_documents_updated_at
before update on public.knowledge_documents
for each row execute procedure public.kb_set_updated_at();

insert into public.knowledge_bases (company_id, name, scope_type, is_default)
select c.id, 'Global Knowledge Base', 'global', true
from public.companies c
where not exists (
  select 1
  from public.knowledge_bases kb
  where kb.company_id = c.id
    and kb.scope_type = 'global'
    and kb.archived = false
);

alter table public.knowledge_bases enable row level security;
alter table public.knowledge_documents enable row level security;

drop policy if exists "Users can view company knowledge bases" on public.knowledge_bases;
create policy "Users can view company knowledge bases"
  on public.knowledge_bases
  for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company knowledge bases" on public.knowledge_bases;
create policy "Users can insert company knowledge bases"
  on public.knowledge_bases
  for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company knowledge bases" on public.knowledge_bases;
create policy "Users can update company knowledge bases"
  on public.knowledge_bases
  for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can view company knowledge documents" on public.knowledge_documents;
create policy "Users can view company knowledge documents"
  on public.knowledge_documents
  for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company knowledge documents" on public.knowledge_documents;
create policy "Users can insert company knowledge documents"
  on public.knowledge_documents
  for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company knowledge documents" on public.knowledge_documents;
create policy "Users can update company knowledge documents"
  on public.knowledge_documents
  for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

