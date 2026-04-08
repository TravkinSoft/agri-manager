/*
  # Cleanup All Test Users After Company Migration
  
  1. Data Reassignment
    - Reassign demo user's season to aimbeks@gmail.com
    - Ensure all business data is owned by the main user
  
  2. User Cleanup
    - Delete all test users from auth.users
    - Keep only aimbeks@gmail.com as the sole user and company owner
  
  3. Users to Remove
    - demo@example.com (id: 00000000-0000-0000-0000-000000000001)
    - ereke94kaisar@gmail.com (id: 5a9ae0d2-0c8e-4ead-b98d-f0165a4513a2)
    - roni._@mail.ru (id: 07d01086-d0a3-4ec8-afd6-3d6b80949528)
    - travkin-94@list.ru (id: c1a632ee-4452-44f7-8657-0d8a879c6873)
*/

-- Step 1: Reassign the demo user's season to aimbeks
UPDATE seasons
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = '00000000-0000-0000-0000-000000000001';

-- Step 2: Delete all test users from auth.users except aimbeks@gmail.com
DELETE FROM auth.users 
WHERE email != 'aimbeks@gmail.com';

-- Step 3: Clean up any orphaned profiles (safety check)
DELETE FROM public.profiles
WHERE email != 'aimbeks@gmail.com';

-- Step 4: Verify cleanup and data integrity
DO $$
DECLARE
  user_count INTEGER;
  profile_count INTEGER;
  company_count INTEGER;
  main_user_id UUID;
  main_company_id UUID;
  orphaned_fields INTEGER;
  orphaned_operations INTEGER;
  orphaned_seasons INTEGER;
BEGIN
  -- Count remaining records
  SELECT COUNT(*) INTO user_count FROM auth.users;
  SELECT COUNT(*) INTO profile_count FROM public.profiles;
  SELECT COUNT(*) INTO company_count FROM public.companies;
  
  -- Get IDs
  SELECT id INTO main_user_id FROM auth.users WHERE email = 'aimbeks@gmail.com';
  SELECT company_id INTO main_company_id FROM public.profiles WHERE email = 'aimbeks@gmail.com';
  
  -- Check for orphaned data (data not linked to existing company)
  SELECT COUNT(*) INTO orphaned_fields 
  FROM fields 
  WHERE company_id != main_company_id;
  
  SELECT COUNT(*) INTO orphaned_operations 
  FROM operations 
  WHERE company_id != main_company_id;
  
  SELECT COUNT(*) INTO orphaned_seasons 
  FROM seasons 
  WHERE company_id != main_company_id;
  
  -- Log the results
  RAISE NOTICE 'Cleanup complete:';
  RAISE NOTICE '- Auth users: %', user_count;
  RAISE NOTICE '- Profiles: %', profile_count;
  RAISE NOTICE '- Companies: %', company_count;
  RAISE NOTICE '- Main user ID: %', main_user_id;
  RAISE NOTICE '- Main company ID: %', main_company_id;
  RAISE NOTICE '- Orphaned fields: %', orphaned_fields;
  RAISE NOTICE '- Orphaned operations: %', orphaned_operations;
  RAISE NOTICE '- Orphaned seasons: %', orphaned_seasons;
  
  -- Verify we have exactly 1 user, 1 profile, and 1 company
  IF user_count != 1 OR profile_count != 1 OR company_count != 1 THEN
    RAISE EXCEPTION 'Unexpected state after cleanup: users=%, profiles=%, companies=%', 
      user_count, profile_count, company_count;
  END IF;
  
  -- Verify no orphaned data
  IF orphaned_fields > 0 OR orphaned_operations > 0 OR orphaned_seasons > 0 THEN
    RAISE EXCEPTION 'Orphaned data found: fields=%, operations=%, seasons=%', 
      orphaned_fields, orphaned_operations, orphaned_seasons;
  END IF;
  
  -- Verify the remaining user is the company owner
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE email = 'aimbeks@gmail.com' 
    AND is_owner = true
  ) THEN
    RAISE EXCEPTION 'Main user is not marked as company owner';
  END IF;
  
  RAISE NOTICE 'All verification checks passed!';
END $$;