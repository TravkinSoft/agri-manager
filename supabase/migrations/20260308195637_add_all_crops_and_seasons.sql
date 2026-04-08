/*
  # Add All Crops and Seasons for Farm Data
  
  1. New Crops
    - Barley, Oats, Peas, Rapeseed, Sunflower, Flax, Corn
    - And any other crops from the Excel file
  
  2. New Seasons
    - 2020, 2021, 2022, 2023 (2024 and 2025 should already exist)
  
  3. Notes
    - Uses INSERT ... ON CONFLICT to avoid duplicates
    - user_id is NULL for system-wide reference data
*/

-- Add all crops (skip if already exists)
INSERT INTO crops (name, user_id) VALUES
  ('Wheat', NULL),
  ('Barley', NULL),
  ('Oats', NULL),
  ('Peas', NULL),
  ('Potato', NULL),
  ('Carrot', NULL),
  ('Rapeseed', NULL),
  ('Sunflower', NULL),
  ('Flax', NULL),
  ('Corn', NULL)
ON CONFLICT DO NOTHING;

-- Add all seasons (skip if already exists)
INSERT INTO seasons (year, name, start_date, end_date, user_id) VALUES
  (2020, '2020 Growing Season', '2020-03-01', '2020-11-30', NULL),
  (2021, '2021 Growing Season', '2021-03-01', '2021-11-30', NULL),
  (2022, '2022 Growing Season', '2022-03-01', '2022-11-30', NULL),
  (2023, '2023 Growing Season', '2023-03-01', '2023-11-30', NULL),
  (2024, '2024 Growing Season', '2024-03-01', '2024-11-30', NULL),
  (2025, '2025 Growing Season', '2025-03-01', '2025-11-30', NULL)
ON CONFLICT DO NOTHING;
