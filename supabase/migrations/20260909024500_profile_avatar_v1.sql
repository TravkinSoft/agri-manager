begin;

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz;

comment on column public.profiles.avatar_path is
  'Private profile-media object path. Read and write access is mediated by the profile avatar API.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  false,
  1572864,
  array['image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Intentionally no authenticated storage.objects policies. Browsers use short-lived
-- signed URLs and all mutations pass through the authenticated, non-impersonated API.

commit;
