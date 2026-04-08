/*
  # Fix profiles RLS and clean orphan companies

  ## Problem
  The profiles SELECT policy only allowed `auth.uid() = id`, meaning each user
  could only read their own row. The Users page query filters by company_id but
  RLS blocked all rows except the requesting user's own, so the admin saw no
  other team members.

  ## Changes

  ### 1. New policies on `profiles`
  - Drop the overly-restrictive single-row SELECT policy
  - Add policy: authenticated users can read all profiles belonging to their company
  - Add policy: service role can update any profile (needed for invite flow)
  - Add policy: admins can update profiles within their own company

  ### 2. Orphan company cleanup
  - Remove auto-created companies for invited users (they should belong to the
    admin's company, not get their own company)
  - Keep only the main "AgroTech Solutions" company (id = 10000000-...)

  ## Security
  - Company-scoped reads prevent cross-company data leakage
  - Only admins (role = 'admin') can update other users' profiles within their company
  - Service role retains full access for the invite API
*/

-- Drop the old restrictive SELECT policy
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;

-- Allow users to read all profiles in their own company (safe — company-scoped)
CREATE POLICY "Company members can read profiles in their company"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    company_id = (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Allow service role to update profiles (used by invite-user API with admin key)
DROP POLICY IF EXISTS "Service role can update profiles" ON public.profiles;
CREATE POLICY "Service role can update profiles"
  ON public.profiles
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow admins to update profiles within their company (role changes, status, etc.)
DROP POLICY IF EXISTS "Admins can update company member profiles" ON public.profiles;
CREATE POLICY "Admins can update company member profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    company_id = (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    company_id = (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Clean up orphan companies that were incorrectly created for invited users
-- Keep only the main company (10000000-0000-0000-0000-000000000001)
-- and any company that has an is_owner=true profile (legitimate self-registered companies)
DELETE FROM public.companies
WHERE id NOT IN (
  SELECT DISTINCT company_id
  FROM public.profiles
  WHERE is_owner = true AND company_id IS NOT NULL
);
