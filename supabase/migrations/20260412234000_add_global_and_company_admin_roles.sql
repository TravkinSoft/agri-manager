/*
  Two-level administration model:
  - global_admin (platform level)
  - company_admin (company level)

  Includes:
  - role migration for existing profiles
  - profiles role CHECK update
  - handle_new_user trigger role normalization
  - products RLS updates for global master visibility/management
*/

-- 1) Assign global admin and migrate legacy admin role
UPDATE public.profiles
SET role = 'global_admin'
WHERE lower(email) = 'aimbeks@gmail.com';

UPDATE public.profiles
SET role = 'company_admin'
WHERE role = 'admin'
  AND lower(email) <> 'aimbeks@gmail.com';

-- 2) Update roles constraint
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
    CHECK (role IN ('global_admin', 'company_admin', 'agronomist', 'specialist', 'warehouse', 'weighman'));
END $$;

-- 3) Update auth trigger for invite metadata and role normalization
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
  valid_roles text[] := ARRAY['global_admin', 'company_admin', 'agronomist', 'specialist', 'warehouse', 'weighman'];
BEGIN
  user_role := lower(coalesce(new.raw_user_meta_data->>'role', ''));
  IF user_role = 'admin' THEN
    user_role := 'company_admin';
  END IF;
  IF user_role IS NULL OR user_role = '' OR NOT (user_role = ANY(valid_roles)) THEN
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

-- 4) Products RLS: global catalog readable by all authenticated users
DROP POLICY IF EXISTS "Users can view company products" ON public.products;
CREATE POLICY "Users can view company and global products"
  ON public.products FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_user_company_id()
    OR company_id IS NULL
  );

-- 5) Products RLS: only global_admin can create/update/delete global rows
DROP POLICY IF EXISTS "Global admin can manage global products" ON public.products;
CREATE POLICY "Global admin can manage global products"
  ON public.products
  FOR ALL
  TO authenticated
  USING (
    company_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'global_admin'
        AND coalesce(p.status, 'active') = 'active'
    )
  )
  WITH CHECK (
    company_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'global_admin'
        AND coalesce(p.status, 'active') = 'active'
    )
  );

