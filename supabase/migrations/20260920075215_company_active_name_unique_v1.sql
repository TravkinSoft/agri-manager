-- Apply after the audited archive repair. The unique index also serializes races.
create unique index companies_active_name_normalized_uq
  on public.companies (lower(btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g'))))
  where archived_at is null;
