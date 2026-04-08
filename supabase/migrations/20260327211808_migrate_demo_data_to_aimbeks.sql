/*
  # Migrate Demo Data to aimbeks@gmail.com
  
  1. Changes
    - Transfer all fields from travkin-94@list.ru to aimbeks@gmail.com
    - Transfer all crop_structure records
    - Transfer all operations
    - Transfer all warehouses
    - Transfer all products
    - Transfer all inventory_transactions
  
  2. Notes
    - Data is being migrated, not copied
    - Original user (travkin-94@list.ru) will have no data after this migration
    - Target user: cb27c2ac-2312-4cb9-b819-372d1cf5e2ca (aimbeks@gmail.com)
    - Source user: c1a632ee-4452-44f7-8657-0d8a879c6873 (travkin-94@list.ru)
*/

-- Migrate fields
UPDATE fields
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

-- Migrate crop_structure
UPDATE crop_structure
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

-- Migrate operations
UPDATE operations
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

-- Migrate warehouses
UPDATE warehouses
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

-- Migrate products
UPDATE products
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

-- Migrate inventory_transactions
UPDATE inventory_transactions
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

-- Migrate reference data (crops, varieties, seed_reproductions)
-- Only migrate user-specific references, keep NULL (global) ones as is
UPDATE crops
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

UPDATE varieties
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

UPDATE seed_reproductions
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';

-- Migrate seasons (if user-specific)
UPDATE seasons
SET user_id = 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
WHERE user_id = 'c1a632ee-4452-44f7-8657-0d8a879c6873';