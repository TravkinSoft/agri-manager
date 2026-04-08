/*
  # Create Crop Structure Table

  ## Purpose
  Store crop planting plans per field and season, including crop varieties, areas, seeding rates, and expected yields.
  
  ## New Tables
  
  ### `crop_structure`
  - `id` (uuid, primary key) - Unique identifier for each crop structure entry
  - `field_id` (uuid, required) - Reference to the field where the crop will be planted
  - `season` (integer, required) - Planting season year (e.g., 2024, 2025)
  - `crop` (text, required) - Name of the crop (e.g., Wheat, Corn, Soybeans)
  - `variety` (text, optional) - Specific variety of the crop
  - `area` (decimal, required) - Area to be planted in hectares
  - `seeding_rate` (decimal, optional) - Seeding rate in kg/ha
  - `expected_yield` (decimal, optional) - Expected yield in tons/ha
  - `status` (text, default 'planned') - Status of the crop (planned, planted, growing, harvested)
  - `notes` (text, optional) - Additional notes
  - `archived` (boolean, default false) - Soft delete flag
  - `created_at` (timestamptz) - Timestamp when created
  - `updated_at` (timestamptz) - Timestamp when last updated
  - `user_id` (uuid, required) - Reference to the user who owns this entry
  
  ## Security
  
  1. Enable Row Level Security (RLS) on the crop_structure table
  2. Add policy for authenticated users to view their own crop structures
  3. Add policy for authenticated users to insert their own crop structures
  4. Add policy for authenticated users to update their own crop structures
  5. Add policy for authenticated users to delete their own crop structures
  
  ## Constraints
  
  - Area must be positive
  - Season must be a valid year (between 2000 and 2100)
  - Area cannot exceed the field's total area (enforced via trigger)
  
  ## Notes
  
  - Uses soft delete pattern with `archived` field
  - Foreign key relationship with fields table
  - Validates area against field size
  - Status field for tracking crop lifecycle
*/

-- Create crop_structure table
CREATE TABLE IF NOT EXISTS crop_structure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  season integer NOT NULL CHECK (season >= 2000 AND season <= 2100),
  crop text NOT NULL,
  variety text,
  area decimal(10, 2) NOT NULL CHECK (area > 0),
  seeding_rate decimal(10, 2) CHECK (seeding_rate > 0),
  expected_yield decimal(10, 2) CHECK (expected_yield > 0),
  status text DEFAULT 'planned' CHECK (status IN ('planned', 'planted', 'growing', 'harvested')),
  notes text,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_crop_structure_field_id ON crop_structure(field_id);
CREATE INDEX IF NOT EXISTS idx_crop_structure_user_id ON crop_structure(user_id);
CREATE INDEX IF NOT EXISTS idx_crop_structure_season ON crop_structure(season);
CREATE INDEX IF NOT EXISTS idx_crop_structure_archived ON crop_structure(archived);
CREATE INDEX IF NOT EXISTS idx_crop_structure_created_at ON crop_structure(created_at DESC);

-- Enable Row Level Security
ALTER TABLE crop_structure ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own crop structures
CREATE POLICY "Users can view own crop structures"
  ON crop_structure
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own crop structures
CREATE POLICY "Users can insert own crop structures"
  ON crop_structure
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own crop structures
CREATE POLICY "Users can update own crop structures"
  ON crop_structure
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own crop structures
CREATE POLICY "Users can delete own crop structures"
  ON crop_structure
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to update updated_at on row update
DROP TRIGGER IF EXISTS update_crop_structure_updated_at ON crop_structure;
CREATE TRIGGER update_crop_structure_updated_at
  BEFORE UPDATE ON crop_structure
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to validate area does not exceed field size
CREATE OR REPLACE FUNCTION validate_crop_structure_area()
RETURNS TRIGGER AS $$
DECLARE
  field_area decimal(10, 2);
BEGIN
  SELECT area INTO field_area
  FROM fields
  WHERE id = NEW.field_id;
  
  IF NEW.area > field_area THEN
    RAISE EXCEPTION 'Crop area (% ha) cannot exceed field area (% ha)', NEW.area, field_area;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate area before insert or update
DROP TRIGGER IF EXISTS validate_crop_structure_area_trigger ON crop_structure;
CREATE TRIGGER validate_crop_structure_area_trigger
  BEFORE INSERT OR UPDATE ON crop_structure
  FOR EACH ROW
  EXECUTE FUNCTION validate_crop_structure_area();
