/*
  Add weighman role support to invite flow and auth trigger.
  Safe migration:
  - updates profiles role CHECK constraint to include weighman
  - updates handle_new_user() valid role whitelist to include weighman
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND constraint_name = 'valid_role'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT valid_role;
  END IF;

  ALTER TABLE public.profiles
    ADD CONSTRAINT valid_role
    CHECK (role IN ('admin', 'agronomist', 'specialist', 'warehouse', 'weighman'));
END $$;

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
  valid_roles text[] := ARRAY['admin', 'agronomist', 'specialist', 'warehouse', 'weighman'];
BEGIN
  user_role := new.raw_user_meta_data->>'role';
  IF user_role IS NULL OR NOT (user_role = ANY(valid_roles)) THEN
    user_role := 'agronomist';
  END IF;

  BEGIN
    invite_company_id := (new.raw_user_meta_data->>'invited_by_company')::uuid;
  EXCEPTION WHEN others THEN
    invite_company_id := NULL;
  END;

  IF invite_company_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.companies WHERE id = invite_company_id) THEN
      INSERT INTO public.profiles (id, email, role, company_id, is_owner)
      VALUES (new.id, new.email, user_role, invite_company_id, false)
      ON CONFLICT (id) DO NOTHING;
    ELSE
      INSERT INTO public.companies (name)
      VALUES (new.email || '''s Company')
      RETURNING id INTO new_company_id;

      INSERT INTO public.profiles (id, email, role, company_id, is_owner)
      VALUES (new.id, new.email, user_role, new_company_id, true)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  ELSE
    INSERT INTO public.companies (name)
    VALUES (COALESCE(new.raw_user_meta_data->>'company_name', new.email || '''s Company'))
    RETURNING id INTO new_company_id;

    INSERT INTO public.profiles (id, email, role, company_id, is_owner)
    VALUES (new.id, new.email, user_role, new_company_id, true)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'handle_new_user failed for user %: % %', new.id, SQLERRM, SQLSTATE;
  RETURN new;
END;
$$;
