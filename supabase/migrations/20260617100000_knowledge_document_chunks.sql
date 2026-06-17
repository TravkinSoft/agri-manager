/*
  Knowledge base document chunks.

  The source of truth remains knowledge_documents. Chunks make assistant retrieval
  precise enough to cite only relevant fragments instead of dumping whole files.
*/

create table if not exists public.knowledge_document_chunks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  knowledge_document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_knowledge_chunks_doc_index
  on public.knowledge_document_chunks(knowledge_document_id, chunk_index)
  where archived = false;

create index if not exists idx_knowledge_chunks_company_doc
  on public.knowledge_document_chunks(company_id, knowledge_document_id, archived, chunk_index);

create index if not exists idx_knowledge_chunks_content_fts
  on public.knowledge_document_chunks
  using gin (to_tsvector('simple', content));

create index if not exists idx_knowledge_chunks_metadata_gin
  on public.knowledge_document_chunks using gin (metadata);

drop trigger if exists trg_knowledge_document_chunks_updated_at on public.knowledge_document_chunks;
create trigger trg_knowledge_document_chunks_updated_at
before update on public.knowledge_document_chunks
for each row execute procedure public.kb_set_updated_at();

alter table public.knowledge_document_chunks enable row level security;

drop policy if exists "Users can view company knowledge chunks" on public.knowledge_document_chunks;
create policy "Users can view company knowledge chunks"
  on public.knowledge_document_chunks
  for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company knowledge chunks" on public.knowledge_document_chunks;
create policy "Users can insert company knowledge chunks"
  on public.knowledge_document_chunks
  for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company knowledge chunks" on public.knowledge_document_chunks;
create policy "Users can update company knowledge chunks"
  on public.knowledge_document_chunks
  for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());
