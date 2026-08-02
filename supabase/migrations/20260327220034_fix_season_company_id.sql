/*
  # Fix Season Company ID
  
  1. Changes
    - Update the season with NULL company_id to link to the main company
  
  2. Data Integrity
    - Ensure the season is properly linked to the company
*/

-- Update season to link to the main company
UPDATE seasons
SET company_id = '10000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

-- Verify the update
DO $$
DECLARE
  seasons_without_company INTEGER;
BEGIN
  SELECT COUNT(*) INTO seasons_without_company
  FROM seasons
  WHERE company_id IS NULL;
  
  IF seasons_without_company > 0 THEN
    RAISE EXCEPTION 'Still have % seasons without company_id', seasons_without_company;
  END IF;
  
  RAISE NOTICE 'All seasons properly linked to company';
END $$;

drop index if exists public.ux_seasons_company_year;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.seasons'::regclass
      and conname = 'seasons_user_id_year_key'
  ) then
    alter table public.seasons
      add constraint seasons_user_id_year_key unique (user_id, year);
  end if;
end $$;
