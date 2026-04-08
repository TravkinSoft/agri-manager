/*
  # Migrate Existing Data to Company Structure
  
  1. Changes
    - Create default company for existing users
    - Update all profiles with company_id
    - Migrate all business data to use company_id
  
  2. Notes
    - Default company will be created for aimbeks@gmail.com
    - All existing data will be assigned to this company
*/

-- Create default company
INSERT INTO companies (id, name, created_at)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'AgroTech Solutions',
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Update existing profiles to link to default company
UPDATE profiles
SET company_id = '10000000-0000-0000-0000-000000000001',
    is_owner = CASE WHEN email = 'aimbeks@gmail.com' THEN true ELSE false END
WHERE company_id IS NULL;

-- Migrate fields
UPDATE fields
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = fields.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

-- Migrate crop_structure
UPDATE crop_structure
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = crop_structure.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

-- Migrate seasons
UPDATE seasons
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = seasons.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

-- Migrate operations
UPDATE operations
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = operations.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

-- Migrate warehouses
UPDATE warehouses
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = warehouses.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

-- Migrate products
UPDATE products
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = products.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

-- Migrate inventory_transactions
UPDATE inventory_transactions
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = inventory_transactions.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

-- Migrate reference data (only user-specific, keep NULL company_id for global)
UPDATE crops
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = crops.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

UPDATE varieties
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = varieties.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;

UPDATE seed_reproductions
SET company_id = (
  SELECT company_id FROM profiles WHERE profiles.id = seed_reproductions.user_id
)
WHERE company_id IS NULL AND user_id IS NOT NULL;