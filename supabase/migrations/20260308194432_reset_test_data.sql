/*
  # Reset Test Data
  
  1. Purpose
    - Remove all test/demo data from main operational tables
    - Preserve reference data (crops, seasons, varieties, seed_reproductions, warehouses)
  
  2. Tables to Clean
    - `operations` - All operation records
    - `crop_structure` - All crop structure records
    - `fields` - All field records
  
  3. Security
    - This is a data cleanup operation
    - Reference tables remain unchanged
*/

-- Delete operations first (has foreign keys to crop_structure and fields)
DELETE FROM operations;

-- Delete crop structure (has foreign keys to fields)
DELETE FROM crop_structure;

-- Delete fields (base table)
DELETE FROM fields;
