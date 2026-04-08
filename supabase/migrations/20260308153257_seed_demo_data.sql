/*
  # Seed Demo Data for Agricultural Management System

  ## Purpose
  Populate the database with realistic demo data to test the dashboard, analytics, and all features.

  ## Data Being Created

  ### Reference Data
  1. **Crops**: Potato, Wheat, Carrot
  2. **Varieties**: 2-3 varieties per crop
  3. **Seed Reproductions**: Elite, Super Elite, First Reproduction

  ### Seasons
  - 2024
  - 2025

  ### Fields
  - 5 example fields with realistic areas and soil types

  ### Crop Structure
  - Multiple crop plantings across fields and seasons
  - Mix of planned, planted, growing, and harvested statuses

  ### Operations
  - Various agronomic operations (planting, fertilizing, spraying, harvesting)

  ### Warehouses & Inventory
  1. **Warehouse**: Main Storage Facility
  2. **Products**: Seed Potato, Fertilizer NPK, Herbicide
  3. **Transactions**: Multiple "in" and "out" transactions

  ## Notes
  - All data is inserted for the first authenticated user found in the system
  - Uses temporary function to bypass RLS for seeding
  - Does not affect existing data
  - All records are non-archived by default
*/

-- Create a temporary function to seed data that bypasses RLS
CREATE OR REPLACE FUNCTION seed_demo_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_field1_id uuid;
  v_field2_id uuid;
  v_field3_id uuid;
  v_field4_id uuid;
  v_field5_id uuid;
  v_crop_potato_id uuid;
  v_crop_wheat_id uuid;
  v_crop_carrot_id uuid;
  v_variety_potato1_id uuid;
  v_variety_potato2_id uuid;
  v_variety_wheat1_id uuid;
  v_variety_wheat2_id uuid;
  v_variety_wheat3_id uuid;
  v_variety_carrot1_id uuid;
  v_variety_carrot2_id uuid;
  v_reproduction1_id uuid;
  v_reproduction2_id uuid;
  v_reproduction3_id uuid;
  v_season2024_id uuid;
  v_season2025_id uuid;
  v_crop_structure1_id uuid;
  v_crop_structure2_id uuid;
  v_crop_structure3_id uuid;
  v_crop_structure4_id uuid;
  v_crop_structure5_id uuid;
  v_crop_structure6_id uuid;
  v_crop_structure7_id uuid;
  v_warehouse_id uuid;
  v_product_seed_id uuid;
  v_product_fertilizer_id uuid;
  v_product_herbicide_id uuid;
BEGIN
  -- Get the first authenticated user (or use a specific user_id if needed)
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  
  -- If no user exists, exit (cannot seed without a user due to RLS)
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No users found. Cannot seed data without an authenticated user.';
    RETURN;
  END IF;

  RAISE NOTICE 'Seeding data for user: %', v_user_id;

  -- Insert Fields
  INSERT INTO fields (name, area, soil_type, notes, user_id, archived)
  VALUES 
    ('North Field', 45.50, 'Clay loam', 'Primary production field with good drainage', v_user_id, false),
    ('South Field', 32.75, 'Sandy loam', 'Well-suited for root vegetables', v_user_id, false),
    ('East Field', 28.00, 'Silty clay', 'Requires careful moisture management', v_user_id, false),
    ('West Field', 51.20, 'Loam', 'Most fertile field with optimal conditions', v_user_id, false),
    ('River Field', 19.80, 'Sandy', 'Near river, good for irrigation', v_user_id, false)
  RETURNING id INTO v_field1_id;

  -- Get field IDs
  SELECT id INTO v_field2_id FROM fields WHERE name = 'South Field' AND user_id = v_user_id;
  SELECT id INTO v_field3_id FROM fields WHERE name = 'East Field' AND user_id = v_user_id;
  SELECT id INTO v_field4_id FROM fields WHERE name = 'West Field' AND user_id = v_user_id;
  SELECT id INTO v_field5_id FROM fields WHERE name = 'River Field' AND user_id = v_user_id;

  -- Insert Seasons
  INSERT INTO seasons (year, name, start_date, end_date, user_id, archived)
  VALUES 
    (2024, '2024 Growing Season', '2024-03-01', '2024-11-30', v_user_id, false),
    (2025, '2025 Growing Season', '2025-03-01', '2025-11-30', v_user_id, false)
  RETURNING id INTO v_season2024_id;

  SELECT id INTO v_season2025_id FROM seasons WHERE year = 2025 AND user_id = v_user_id;

  -- Insert Crops
  INSERT INTO crops (name, user_id, archived)
  VALUES 
    ('Potato', v_user_id, false),
    ('Wheat', v_user_id, false),
    ('Carrot', v_user_id, false)
  RETURNING id INTO v_crop_potato_id;

  SELECT id INTO v_crop_wheat_id FROM crops WHERE name = 'Wheat' AND user_id = v_user_id;
  SELECT id INTO v_crop_carrot_id FROM crops WHERE name = 'Carrot' AND user_id = v_user_id;

  -- Insert Varieties
  INSERT INTO varieties (crop_id, name, user_id, archived)
  VALUES 
    (v_crop_potato_id, 'Russet Burbank', v_user_id, false),
    (v_crop_potato_id, 'Yukon Gold', v_user_id, false),
    (v_crop_wheat_id, 'Hard Red Winter', v_user_id, false),
    (v_crop_wheat_id, 'Soft White Spring', v_user_id, false),
    (v_crop_wheat_id, 'Durum', v_user_id, false),
    (v_crop_carrot_id, 'Nantes', v_user_id, false),
    (v_crop_carrot_id, 'Imperator', v_user_id, false)
  RETURNING id INTO v_variety_potato1_id;

  SELECT id INTO v_variety_potato2_id FROM varieties WHERE name = 'Yukon Gold' AND user_id = v_user_id;
  SELECT id INTO v_variety_wheat1_id FROM varieties WHERE name = 'Hard Red Winter' AND user_id = v_user_id;
  SELECT id INTO v_variety_wheat2_id FROM varieties WHERE name = 'Soft White Spring' AND user_id = v_user_id;
  SELECT id INTO v_variety_wheat3_id FROM varieties WHERE name = 'Durum' AND user_id = v_user_id;
  SELECT id INTO v_variety_carrot1_id FROM varieties WHERE name = 'Nantes' AND user_id = v_user_id;
  SELECT id INTO v_variety_carrot2_id FROM varieties WHERE name = 'Imperator' AND user_id = v_user_id;

  -- Insert Seed Reproductions
  INSERT INTO seed_reproductions (name, user_id, archived)
  VALUES 
    ('Elite', v_user_id, false),
    ('Super Elite', v_user_id, false),
    ('First Reproduction', v_user_id, false)
  RETURNING id INTO v_reproduction1_id;

  SELECT id INTO v_reproduction2_id FROM seed_reproductions WHERE name = 'Super Elite' AND user_id = v_user_id;
  SELECT id INTO v_reproduction3_id FROM seed_reproductions WHERE name = 'First Reproduction' AND user_id = v_user_id;

  -- Insert Crop Structure for 2024
  INSERT INTO crop_structure (field_id, season, crop, variety, area, seeding_rate, expected_yield, status, notes, user_id, archived)
  VALUES 
    (v_field1_id, 2024, 'Potato', 'Russet Burbank', 45.50, 2500.00, 35.00, 'harvested', 'Excellent yield achieved', v_user_id, false),
    (v_field2_id, 2024, 'Carrot', 'Nantes', 32.75, 4.50, 45.00, 'harvested', 'Good quality carrots', v_user_id, false),
    (v_field3_id, 2024, 'Wheat', 'Hard Red Winter', 28.00, 180.00, 5.50, 'harvested', 'Average yield due to weather', v_user_id, false),
    (v_field4_id, 2024, 'Wheat', 'Durum', 51.20, 170.00, 6.00, 'harvested', 'Premium quality wheat', v_user_id, false)
  RETURNING id INTO v_crop_structure1_id;

  SELECT id INTO v_crop_structure2_id FROM crop_structure WHERE field_id = v_field2_id AND season = 2024 AND user_id = v_user_id;
  SELECT id INTO v_crop_structure3_id FROM crop_structure WHERE field_id = v_field3_id AND season = 2024 AND user_id = v_user_id;
  SELECT id INTO v_crop_structure4_id FROM crop_structure WHERE field_id = v_field4_id AND season = 2024 AND user_id = v_user_id;

  -- Insert Crop Structure for 2025 (Active season)
  INSERT INTO crop_structure (field_id, season, crop, variety, area, seeding_rate, expected_yield, status, notes, user_id, archived)
  VALUES 
    (v_field1_id, 2025, 'Wheat', 'Soft White Spring', 45.50, 175.00, 5.80, 'growing', 'Early growth stage looks promising', v_user_id, false),
    (v_field2_id, 2025, 'Potato', 'Yukon Gold', 32.75, 2400.00, 32.00, 'planted', 'Recently planted', v_user_id, false),
    (v_field5_id, 2025, 'Carrot', 'Imperator', 19.80, 4.00, 42.00, 'planned', 'Planting scheduled for next week', v_user_id, false)
  RETURNING id INTO v_crop_structure5_id;

  SELECT id INTO v_crop_structure6_id FROM crop_structure WHERE field_id = v_field2_id AND season = 2025 AND user_id = v_user_id;
  SELECT id INTO v_crop_structure7_id FROM crop_structure WHERE field_id = v_field5_id AND season = 2025 AND user_id = v_user_id;

  -- Insert Operations for 2024 (Historical)
  INSERT INTO operations (field_id, crop_structure_id, operation_type, date, notes, user_id, archived)
  VALUES 
    (v_field1_id, v_crop_structure1_id, 'Planting', '2024-04-15', 'Planted with precision planter', v_user_id, false),
    (v_field1_id, v_crop_structure1_id, 'Fertilizing', '2024-05-20', 'Applied NPK 15-15-15 at 300 kg/ha', v_user_id, false),
    (v_field1_id, v_crop_structure1_id, 'Spraying', '2024-06-10', 'Herbicide application for weed control', v_user_id, false),
    (v_field1_id, v_crop_structure1_id, 'Harvesting', '2024-09-25', 'Harvest completed, yield met expectations', v_user_id, false),
    (v_field2_id, v_crop_structure2_id, 'Planting', '2024-04-20', 'Direct seeding', v_user_id, false),
    (v_field2_id, v_crop_structure2_id, 'Irrigation', '2024-06-15', 'First irrigation cycle', v_user_id, false),
    (v_field2_id, v_crop_structure2_id, 'Harvesting', '2024-08-30', 'Good quality carrots harvested', v_user_id, false),
    (v_field3_id, v_crop_structure3_id, 'Planting', '2024-03-25', 'Winter wheat seeding', v_user_id, false),
    (v_field3_id, v_crop_structure3_id, 'Fertilizing', '2024-05-10', 'Top dressing with urea', v_user_id, false),
    (v_field3_id, v_crop_structure3_id, 'Harvesting', '2024-07-20', 'Harvest completed', v_user_id, false);

  -- Insert Operations for 2025 (Recent/Current)
  INSERT INTO operations (field_id, crop_structure_id, operation_type, date, notes, user_id, archived)
  VALUES 
    (v_field1_id, v_crop_structure5_id, 'Soil Preparation', '2025-03-01', 'Plowing and harrowing completed', v_user_id, false),
    (v_field1_id, v_crop_structure5_id, 'Planting', '2025-03-15', 'Spring wheat seeded at optimal depth', v_user_id, false),
    (v_field1_id, v_crop_structure5_id, 'Fertilizing', '2025-04-10', 'Starter fertilizer applied', v_user_id, false),
    (v_field2_id, v_crop_structure6_id, 'Soil Preparation', '2025-03-05', 'Field prepared for planting', v_user_id, false),
    (v_field2_id, v_crop_structure6_id, 'Planting', '2025-03-20', 'Potato planting completed', v_user_id, false);

  -- Insert Warehouse
  INSERT INTO warehouses (name, user_id, archived)
  VALUES ('Main Storage Facility', v_user_id, false)
  RETURNING id INTO v_warehouse_id;

  -- Insert Products
  INSERT INTO products (name, type, user_id, archived)
  VALUES 
    ('Seed Potato - Russet Burbank', 'seed', v_user_id, false),
    ('Fertilizer NPK 15-15-15', 'fertilizer', v_user_id, false),
    ('Herbicide Glyphosate 360', 'pesticide', v_user_id, false)
  RETURNING id INTO v_product_seed_id;

  SELECT id INTO v_product_fertilizer_id FROM products WHERE name = 'Fertilizer NPK 15-15-15' AND user_id = v_user_id;
  SELECT id INTO v_product_herbicide_id FROM products WHERE name = 'Herbicide Glyphosate 360' AND user_id = v_user_id;

  -- Insert Inventory Transactions
  INSERT INTO inventory_transactions (warehouse_id, product_id, quantity, transaction_type, date, notes, user_id)
  VALUES 
    -- Seed Potato transactions
    (v_warehouse_id, v_product_seed_id, 5000.00, 'in', '2024-02-15', 'Initial stock purchase for spring planting', v_user_id),
    (v_warehouse_id, v_product_seed_id, 3000.00, 'out', '2024-03-20', 'Used for field planting', v_user_id),
    (v_warehouse_id, v_product_seed_id, 2500.00, 'in', '2025-01-10', 'New batch for 2025 season', v_user_id),
    (v_warehouse_id, v_product_seed_id, 1200.00, 'out', '2025-03-20', 'Used for 2025 potato planting', v_user_id),
    
    -- Fertilizer transactions
    (v_warehouse_id, v_product_fertilizer_id, 15000.00, 'in', '2024-03-01', 'Bulk fertilizer purchase', v_user_id),
    (v_warehouse_id, v_product_fertilizer_id, 8500.00, 'out', '2024-05-15', 'Applied to spring crops', v_user_id),
    (v_warehouse_id, v_product_fertilizer_id, 10000.00, 'in', '2025-02-20', 'Restocked for new season', v_user_id),
    (v_warehouse_id, v_product_fertilizer_id, 3200.00, 'out', '2025-04-10', 'Applied to wheat fields', v_user_id),
    
    -- Herbicide transactions
    (v_warehouse_id, v_product_herbicide_id, 500.00, 'in', '2024-04-01', 'Herbicide stock for season', v_user_id),
    (v_warehouse_id, v_product_herbicide_id, 250.00, 'out', '2024-06-10', 'Weed control application', v_user_id),
    (v_warehouse_id, v_product_herbicide_id, 400.00, 'in', '2025-03-15', 'New supply for 2025', v_user_id),
    (v_warehouse_id, v_product_herbicide_id, 150.00, 'out', '2025-04-05', 'Pre-emergent application', v_user_id);

  RAISE NOTICE 'Demo data seeded successfully!';
  RAISE NOTICE 'Created: 5 fields, 3 crops, 7 varieties, 3 reproductions, 2 seasons';
  RAISE NOTICE 'Created: 7 crop structures, 15 operations, 1 warehouse, 3 products, 12 inventory transactions';
END;
$$;

-- Execute the seeding function
SELECT seed_demo_data();

-- Drop the temporary function
DROP FUNCTION IF EXISTS seed_demo_data();