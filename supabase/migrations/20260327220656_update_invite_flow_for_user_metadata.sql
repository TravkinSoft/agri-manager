/*
  # Update Profile Creation Trigger for Invite Flow
  
  1. Changes
    - Update handle_new_user function to properly handle invited users
    - Ensure invited users get company_id from raw_user_meta_data
    - Ensure invited users get assigned role from raw_user_meta_data
    - Prevent invited users from creating new companies
  
  2. Security
    - Invited users are automatically linked to inviter's company
    - Invited users cannot bypass company assignment
*/

-- Drop and recreate the function with better invite handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  new_company_id uuid;
  invite_company_id uuid;
  user_role text;
BEGIN
  -- Check if user was invited (has raw_user_meta_data->>'invited_by_company')
  invite_company_id := (new.raw_user_meta_data->>'invited_by_company')::uuid;
  user_role := COALESCE(new.raw_user_meta_data->>'role', 'agronomist');
  
  IF invite_company_id IS NOT NULL THEN
    -- User was invited, join existing company
    -- Verify the company exists
    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = invite_company_id) THEN
      RAISE EXCEPTION 'Invalid company ID in invitation';
    END IF;
    
    -- Create profile linked to the inviting company
    INSERT INTO public.profiles (id, email, role, company_id, is_owner)
    VALUES (
      new.id,
      new.email,
      user_role,
      invite_company_id,
      false
    );
    
    RAISE NOTICE 'Created invited user profile: email=%, role=%, company_id=%', 
      new.email, user_role, invite_company_id;
  ELSE
    -- New signup (not invited), create new company
    INSERT INTO companies (name) 
    VALUES (COALESCE(new.raw_user_meta_data->>'company_name', new.email || '''s Company'))
    RETURNING id INTO new_company_id;
    
    -- Create profile as company owner
    INSERT INTO public.profiles (id, email, role, company_id, is_owner)
    VALUES (
      new.id,
      new.email,
      user_role,
      new_company_id,
      true
    );
    
    RAISE NOTICE 'Created new company owner profile: email=%, role=%, company_id=%', 
      new.email, user_role, new_company_id;
  END IF;
  
  RETURN new;
END;
$function$;

-- Ensure the trigger is properly set up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();