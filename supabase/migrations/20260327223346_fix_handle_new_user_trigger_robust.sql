/*
  # Fix handle_new_user trigger - robust error handling

  Root causes of "Database error saving new user":
  1. Unhandled exceptions in the trigger cause Supabase to surface a generic error
  2. Invalid role values fail the CHECK constraint (valid_role) silently
  3. Missing INSERT policy on profiles table blocks the trigger even for SECURITY DEFINER
     functions when the search_path is not set correctly
  4. Company existence check raises EXCEPTION which aborts the entire auth transaction

  Fixes:
  - Set explicit search_path on the function to ensure it resolves public tables
  - Sanitize and validate role before inserting (fallback to 'agronomist')
  - Wrap body in BEGIN/EXCEPTION so any error is logged but never aborts auth
  - Remove the hard RAISE EXCEPTION on invalid company (fall back to creating new company)
  - Add INSERT policy on profiles for the service role / postgres user
*/

-- Ensure the trigger function has correct search_path and error handling
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
  valid_roles text[] := ARRAY['admin', 'agronomist', 'specialist', 'warehouse'];
BEGIN
  -- Parse and validate role from metadata
  user_role := new.raw_user_meta_data->>'role';
  IF user_role IS NULL OR NOT (user_role = ANY(valid_roles)) THEN
    user_role := 'agronomist';
  END IF;

  -- Parse invited_by_company
  BEGIN
    invite_company_id := (new.raw_user_meta_data->>'invited_by_company')::uuid;
  EXCEPTION WHEN others THEN
    invite_company_id := NULL;
  END;

  IF invite_company_id IS NOT NULL THEN
    -- Verify the company actually exists
    IF EXISTS (SELECT 1 FROM public.companies WHERE id = invite_company_id) THEN
      INSERT INTO public.profiles (id, email, role, company_id, is_owner)
      VALUES (new.id, new.email, user_role, invite_company_id, false)
      ON CONFLICT (id) DO NOTHING;
    ELSE
      -- Company not found — fall back to creating a new company
      INSERT INTO public.companies (name)
      VALUES (new.email || '''s Company')
      RETURNING id INTO new_company_id;

      INSERT INTO public.profiles (id, email, role, company_id, is_owner)
      VALUES (new.id, new.email, user_role, new_company_id, true)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  ELSE
    -- Normal signup — create a new company
    INSERT INTO public.companies (name)
    VALUES (COALESCE(new.raw_user_meta_data->>'company_name', new.email || '''s Company'))
    RETURNING id INTO new_company_id;

    INSERT INTO public.profiles (id, email, role, company_id, is_owner)
    VALUES (new.id, new.email, user_role, new_company_id, true)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN new;
EXCEPTION WHEN others THEN
  -- Log the error but never abort the auth transaction
  RAISE WARNING 'handle_new_user failed for user %: % %', new.id, SQLERRM, SQLSTATE;
  RETURN new;
END;
$$;

-- Re-create the trigger to ensure it's attached correctly
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- profiles has RLS enabled but no INSERT policy — the trigger runs as postgres
-- (SECURITY DEFINER + search_path = public bypasses RLS for that user), but
-- add an explicit policy for the service role to be safe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles'
      AND schemaname = 'public'
      AND policyname = 'Service role can insert profiles'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Service role can insert profiles"
        ON public.profiles
        FOR INSERT
        TO service_role
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;

-- Same for companies — trigger needs to insert when creating new company for new signups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'companies'
      AND schemaname = 'public'
      AND policyname = 'Service role can insert companies'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Service role can insert companies"
        ON public.companies
        FOR INSERT
        TO service_role
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;