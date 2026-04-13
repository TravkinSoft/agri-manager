/*
  Add full_name support for invited users and assistant matching.
  Safe migration:
  - adds profiles.full_name when missing
  - backfills empty values from email local-part
  - updates handle_new_user() to persist full_name from auth metadata
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN full_name text;
  END IF;
END $$;

UPDATE public.profiles
SET full_name = trim(split_part(email, '@', 1))
WHERE coalesce(trim(full_name), '') = ''
  AND coalesce(trim(email), '') <> '';

CREATE INDEX IF NOT EXISTS idx_profiles_company_full_name
  ON public.profiles (company_id, full_name);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_company_id uuid;
  invite_company_id uuid;
  user_role text;
  user_full_name text;
  valid_roles text[] := ARRAY['admin', 'agronomist', 'specialist', 'warehouse', 'weighman'];
BEGIN
  user_role := new.raw_user_meta_data->>'role';
  IF user_role IS NULL OR NOT (user_role = ANY(valid_roles)) THEN
    user_role := 'agronomist';
  END IF;

  user_full_name := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g'), '');

  BEGIN
    invite_company_id := (new.raw_user_meta_data->>'invited_by_company')::uuid;
  EXCEPTION WHEN others THEN
    invite_company_id := NULL;
  END;

  IF invite_company_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.companies WHERE id = invite_company_id) THEN
      INSERT INTO public.profiles (id, full_name, email, role, company_id, is_owner)
      VALUES (new.id, user_full_name, new.email, user_role, invite_company_id, false)
      ON CONFLICT (id) DO NOTHING;
    ELSE
      INSERT INTO public.companies (name)
      VALUES (new.email || '''s Company')
      RETURNING id INTO new_company_id;

      INSERT INTO public.profiles (id, full_name, email, role, company_id, is_owner)
      VALUES (new.id, user_full_name, new.email, user_role, new_company_id, true)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  ELSE
    INSERT INTO public.companies (name)
    VALUES (COALESCE(new.raw_user_meta_data->>'company_name', new.email || '''s Company'))
    RETURNING id INTO new_company_id;

    INSERT INTO public.profiles (id, full_name, email, role, company_id, is_owner)
    VALUES (new.id, user_full_name, new.email, user_role, new_company_id, true)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'handle_new_user failed for user %: % %', new.id, SQLERRM, SQLSTATE;
  RETURN new;
END;
$$;
