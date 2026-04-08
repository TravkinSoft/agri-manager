/*
  # Fix recursive RLS on profiles table

  ## Problem
  The previous migration added a company-scoped SELECT policy:
    USING (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid()))

  This causes infinite recursion because evaluating the policy requires reading
  profiles, which triggers the policy again, resulting in an empty/error result.
  The profile fails to load, sidebar shows only Dashboard (no role = no pages).

  ## Fix
  1. Drop the recursive policy.
  2. Create a SECURITY DEFINER function that bypasses RLS to look up the
     current user's company_id — breaking the recursion safely.
  3. Re-create the company-scoped SELECT policy using that function.
  4. Keep the self-read policy as a simple fallback.
*/

-- Drop the recursive company-read policy
DROP POLICY IF EXISTS "Company members can read profiles in their company" ON public.profiles;

-- Create a helper function that fetches the caller's company_id WITHOUT triggering RLS
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Re-add company-scoped SELECT policy using the non-recursive helper
CREATE POLICY "Company members can read profiles in their company"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (company_id = public.get_my_company_id());
