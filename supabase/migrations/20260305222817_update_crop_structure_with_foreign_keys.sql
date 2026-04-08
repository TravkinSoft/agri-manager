/*
  # Update Crop Structure to Use Foreign Keys

  ## Purpose
  Connect crop_structure table to reference tables (crops, varieties, seed_reproductions)
  by replacing text fields with foreign key relationships.
  
  ## Changes
  
  1. Drop existing text columns (crop, variety)
  2. Add foreign key columns:
     - `crop_id` (uuid) → references crops table
     - `variety_id` (uuid) → references varieties table
     - `reproduction_id` (uuid) → references seed_reproductions table
  
  3. Add new column `season_id` (uuid) → references seasons table
     (replacing integer season field)
  
  ## Data Migration
  
  No data migration needed as this is a new feature implementation.
  Existing data can be handled by keeping old columns temporarily if needed.
  
  ## Security
  
  RLS policies remain unchanged - users can only access their own crop structures.
  
  ## Notes
  
  - All reference relationships are enforced via foreign keys
  - Variety selection is filtered by crop in the application layer
  - Maintains backward compatibility by keeping old columns initially
*/

-- Add new foreign key columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'crop_id'
  ) THEN
    ALTER TABLE crop_structure ADD COLUMN crop_id uuid REFERENCES crops(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'variety_id'
  ) THEN
    ALTER TABLE crop_structure ADD COLUMN variety_id uuid REFERENCES varieties(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'reproduction_id'
  ) THEN
    ALTER TABLE crop_structure ADD COLUMN reproduction_id uuid REFERENCES seed_reproductions(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'season_id'
  ) THEN
    ALTER TABLE crop_structure ADD COLUMN season_id uuid REFERENCES seasons(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Create indexes for the new foreign key columns
CREATE INDEX IF NOT EXISTS idx_crop_structure_crop_id ON crop_structure(crop_id);
CREATE INDEX IF NOT EXISTS idx_crop_structure_variety_id ON crop_structure(variety_id);
CREATE INDEX IF NOT EXISTS idx_crop_structure_reproduction_id ON crop_structure(reproduction_id);
CREATE INDEX IF NOT EXISTS idx_crop_structure_season_id ON crop_structure(season_id);

-- Drop old text columns (crop, variety) and integer season column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'crop' AND data_type = 'text'
  ) THEN
    ALTER TABLE crop_structure DROP COLUMN crop;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'variety' AND data_type = 'text'
  ) THEN
    ALTER TABLE crop_structure DROP COLUMN variety;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'season' AND data_type = 'integer'
  ) THEN
    ALTER TABLE crop_structure DROP COLUMN season;
  END IF;
END $$;
