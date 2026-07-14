/*
  # Fix profiles RLS

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

  ### 2. Superseded company cleanup
  - The original migration deleted every company without an owner profile.
  - That behavior is unsafe because the retained platform company can own
    seasons, fields and profiles even when a clean Auth database has no users.
  - Preserve the RLS changes and skip the obsolete data cleanup.

  ## Security
  - Company-scoped reads prevent cross-company data leakage
  - Only admins (role = 'admin') can update other users' profiles within their company
  - Service role retains full access for the invite API
*/

-- Drop the old restrictive SELECT policy
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;

-- Allow users to read all profiles in their own company (safe — company-scoped)
DROP POLICY IF EXISTS "Company members can read profiles in their company" ON public.profiles;
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

DO $superseded_company_cleanup$
BEGIN
  RAISE NOTICE '20260328150705: superseded company cleanup skipped';
END
$superseded_company_cleanup$;
