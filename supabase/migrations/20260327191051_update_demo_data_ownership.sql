/*
  # Update Demo Data Ownership

  Updates all existing demo data to belong to the first registered agronomist user
  instead of the demo user ID.

  ## Changes
    - Updates all records in fields table
    - Updates all records in crop_structure table
    - Updates all records in operations table
    - Updates all records in warehouses table
    - Updates all records in products table
    - Updates all records in inventory_transactions table
    - Updates all records in crops table (nullable user_id)
    - Updates all records in varieties table (nullable user_id)
    - Updates all records in seed_reproductions table (nullable user_id)
  
  ## Target User
    - User ID: c1a632ee-4452-44f7-8657-0d8a879c6873
    - Email: travkin-94@list.ru
    - Role: agronomist
*/

DO $$
DECLARE
  target_user_id uuid := 'c1a632ee-4452-44f7-8657-0d8a879c6873';
  demo_user_id uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Update fields
  UPDATE fields 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update crop_structure
  UPDATE crop_structure 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update operations
  UPDATE operations 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update warehouses
  UPDATE warehouses 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update products
  UPDATE products 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update inventory_transactions
  UPDATE inventory_transactions 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update crops (nullable user_id)
  UPDATE crops 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update varieties (nullable user_id)
  UPDATE varieties 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update seed_reproductions (nullable user_id)
  UPDATE seed_reproductions 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update chats
  UPDATE chats 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;

  -- Update assistant_settings
  UPDATE assistant_settings 
  SET user_id = target_user_id 
  WHERE user_id = demo_user_id;
END $$;
