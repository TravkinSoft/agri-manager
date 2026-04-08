/*
  # Update Crop Structure to Use Season Foreign Key

  ## Purpose
  Migrate crop_structure table from using a simple integer season field to a foreign key relationship with the seasons table.
  
  ## Changes
  
  1. Add new `season_id` column as a foreign key to seasons table
  2. Migrate existing data: create seasons for existing year values and link them
  3. Remove old `season` column
  
  ## Migration Steps
  
  1. Add season_id column (nullable initially for migration)
  2. For each distinct season year in crop_structure:
     - Create a corresponding season record
     - Update crop_structure records to reference the new season
  3. Make season_id NOT NULL
  4. Drop the old season column
  
  ## Data Safety
  
  - Uses a temporary nullable column during migration
  - Preserves all existing data by creating matching season records
  - No data loss occurs during migration
*/

-- Step 1: Add season_id column (nullable for migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'season_id'
  ) THEN
    ALTER TABLE crop_structure ADD COLUMN season_id uuid REFERENCES seasons(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Step 2: Migrate existing data
-- For each user and their distinct season years, create season records and link them
DO $$
DECLARE
  crop_record RECORD;
  season_record RECORD;
BEGIN
  -- Loop through all crop structures that have a season but no season_id
  FOR crop_record IN 
    SELECT DISTINCT user_id, season 
    FROM crop_structure 
    WHERE season_id IS NULL
  LOOP
    -- Check if season already exists for this user and year
    SELECT id INTO season_record
    FROM seasons
    WHERE user_id = crop_record.user_id 
      AND year = crop_record.season;
    
    -- If season doesn't exist, create it
    IF season_record.id IS NULL THEN
      INSERT INTO seasons (user_id, year, name)
      VALUES (
        crop_record.user_id, 
        crop_record.season,
        crop_record.season || ' Season'
      )
      RETURNING id INTO season_record;
    END IF;
    
    -- Update crop_structure records to use the season_id
    UPDATE crop_structure
    SET season_id = season_record.id
    WHERE user_id = crop_record.user_id 
      AND season = crop_record.season
      AND season_id IS NULL;
  END LOOP;
END $$;

-- Step 3: Make season_id NOT NULL (only if there are no NULL values)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM crop_structure WHERE season_id IS NULL
  ) THEN
    ALTER TABLE crop_structure ALTER COLUMN season_id SET NOT NULL;
  END IF;
END $$;

-- Step 4: Drop the old season column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'season'
  ) THEN
    ALTER TABLE crop_structure DROP COLUMN season;
  END IF;
END $$;

-- Step 5: Add index for faster season-based queries
CREATE INDEX IF NOT EXISTS idx_crop_structure_season_id ON crop_structure(season_id);
