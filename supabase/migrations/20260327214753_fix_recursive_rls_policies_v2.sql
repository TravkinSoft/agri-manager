/*
  # Fix Recursive RLS Policy Issue
  
  1. Problem Identified
    - get_user_company_id() function queries profiles table
    - profiles table has RLS enabled  
    - SECURITY DEFINER should bypass RLS but the function may still cause issues
  
  2. Solution
    - Recreate get_user_company_id() with proper settings
    - Use SET search_path for security
    - Ensure SECURITY DEFINER bypasses RLS on profiles
    - Mark as STABLE for caching within a query
*/

-- Recreate the function with better configuration
CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id 
  FROM public.profiles 
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- Ensure authenticated users can execute it
GRANT EXECUTE ON FUNCTION get_user_company_id() TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION get_user_company_id() IS 'Returns company_id for authenticated user. SECURITY DEFINER bypasses RLS to prevent recursion.';