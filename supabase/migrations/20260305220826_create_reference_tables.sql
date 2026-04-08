/*
  # Create Reference Tables for Admin Dictionaries

  ## Purpose
  Store reference data (admin dictionaries) for crops, varieties, and seed reproductions
  to standardize and manage agricultural nomenclature across the system.
  
  ## New Tables
  
  ### `crops`
  - `id` (uuid, primary key) - Unique identifier for each crop
  - `name` (text, required) - Name of the crop (e.g., "Wheat", "Corn", "Barley")
  - `archived` (boolean, default false) - Soft delete flag
  - `created_at` (timestamptz) - Timestamp when created
  - `updated_at` (timestamptz) - Timestamp when last updated
  - `user_id` (uuid, required) - Reference to the user who owns this crop
  
  ### `varieties`
  - `id` (uuid, primary key) - Unique identifier for each variety
  - `crop_id` (uuid, required) - Foreign key to crops table
  - `name` (text, required) - Name of the variety (e.g., "Winter Wheat", "Sweet Corn")
  - `archived` (boolean, default false) - Soft delete flag
  - `created_at` (timestamptz) - Timestamp when created
  - `updated_at` (timestamptz) - Timestamp when last updated
  - `user_id` (uuid, required) - Reference to the user who owns this variety
  
  ### `seed_reproductions`
  - `id` (uuid, primary key) - Unique identifier for each reproduction type
  - `name` (text, required) - Name of the reproduction (e.g., "Elite", "First Generation", "Second Generation")
  - `archived` (boolean, default false) - Soft delete flag
  - `created_at` (timestamptz) - Timestamp when created
  - `updated_at` (timestamptz) - Timestamp when last updated
  - `user_id` (uuid, required) - Reference to the user who owns this reproduction
  
  ## Security
  
  1. Enable Row Level Security (RLS) on all tables
  2. Add policies for authenticated users to manage their own reference data
  3. Each user has their own set of reference data
  
  ## Constraints
  
  - Crop names must be unique per user
  - Variety names must be unique per crop and user
  - Reproduction names must be unique per user
  - Varieties are deleted when their parent crop is deleted (CASCADE)
  
  ## Notes
  
  - Uses soft delete pattern with `archived` field
  - All tables have indexes for fast lookups
  - Each user maintains their own reference dictionaries
*/

-- Create crops table
CREATE TABLE IF NOT EXISTS crops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);

-- Create varieties table
CREATE TABLE IF NOT EXISTS varieties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_id uuid NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
  name text NOT NULL,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, crop_id, name)
);

-- Create seed_reproductions table
CREATE TABLE IF NOT EXISTS seed_reproductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_crops_user_id ON crops(user_id);
CREATE INDEX IF NOT EXISTS idx_crops_archived ON crops(archived);
CREATE INDEX IF NOT EXISTS idx_crops_created_at ON crops(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_varieties_user_id ON varieties(user_id);
CREATE INDEX IF NOT EXISTS idx_varieties_crop_id ON varieties(crop_id);
CREATE INDEX IF NOT EXISTS idx_varieties_archived ON varieties(archived);
CREATE INDEX IF NOT EXISTS idx_varieties_created_at ON varieties(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seed_reproductions_user_id ON seed_reproductions(user_id);
CREATE INDEX IF NOT EXISTS idx_seed_reproductions_archived ON seed_reproductions(archived);
CREATE INDEX IF NOT EXISTS idx_seed_reproductions_created_at ON seed_reproductions(created_at DESC);

-- Enable Row Level Security
ALTER TABLE crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE varieties ENABLE ROW LEVEL SECURITY;
ALTER TABLE seed_reproductions ENABLE ROW LEVEL SECURITY;

-- Policies for crops table
CREATE POLICY "Users can view own crops"
  ON crops
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own crops"
  ON crops
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own crops"
  ON crops
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own crops"
  ON crops
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Policies for varieties table
CREATE POLICY "Users can view own varieties"
  ON varieties
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own varieties"
  ON varieties
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own varieties"
  ON varieties
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own varieties"
  ON varieties
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Policies for seed_reproductions table
CREATE POLICY "Users can view own seed reproductions"
  ON seed_reproductions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own seed reproductions"
  ON seed_reproductions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own seed reproductions"
  ON seed_reproductions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own seed reproductions"
  ON seed_reproductions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Triggers to update updated_at on row update
DROP TRIGGER IF EXISTS update_crops_updated_at ON crops;
CREATE TRIGGER update_crops_updated_at
  BEFORE UPDATE ON crops
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_varieties_updated_at ON varieties;
CREATE TRIGGER update_varieties_updated_at
  BEFORE UPDATE ON varieties
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_seed_reproductions_updated_at ON seed_reproductions;
CREATE TRIGGER update_seed_reproductions_updated_at
  BEFORE UPDATE ON seed_reproductions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
