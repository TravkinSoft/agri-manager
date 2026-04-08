/*
  # Create Seasons Table

  ## Purpose
  Store agricultural seasons (years) to organize crop planning and tracking across different growing seasons.
  
  ## New Tables
  
  ### `seasons`
  - `id` (uuid, primary key) - Unique identifier for each season
  - `year` (integer, unique, required) - The calendar year of the season (e.g., 2024, 2025)
  - `name` (text, optional) - Optional descriptive name for the season (e.g., "2024 Growing Season")
  - `start_date` (date, optional) - Optional start date of the season
  - `end_date` (date, optional) - Optional end date of the season
  - `archived` (boolean, default false) - Soft delete flag
  - `created_at` (timestamptz) - Timestamp when created
  - `updated_at` (timestamptz) - Timestamp when last updated
  - `user_id` (uuid, required) - Reference to the user who owns this season
  
  ## Security
  
  1. Enable Row Level Security (RLS) on the seasons table
  2. Add policy for authenticated users to view their own seasons
  3. Add policy for authenticated users to insert their own seasons
  4. Add policy for authenticated users to update their own seasons
  5. Add policy for authenticated users to delete their own seasons
  
  ## Constraints
  
  - Year must be unique per user
  - Year must be a valid year (between 2000 and 2100)
  
  ## Notes
  
  - Uses soft delete pattern with `archived` field
  - Year is indexed for fast lookups
  - Each user can have their own set of seasons
*/

-- Create seasons table
CREATE TABLE IF NOT EXISTS seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  name text,
  start_date date,
  end_date date,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, year)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_seasons_user_id ON seasons(user_id);
CREATE INDEX IF NOT EXISTS idx_seasons_year ON seasons(year DESC);
CREATE INDEX IF NOT EXISTS idx_seasons_archived ON seasons(archived);
CREATE INDEX IF NOT EXISTS idx_seasons_created_at ON seasons(created_at DESC);

-- Enable Row Level Security
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own seasons
CREATE POLICY "Users can view own seasons"
  ON seasons
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own seasons
CREATE POLICY "Users can insert own seasons"
  ON seasons
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own seasons
CREATE POLICY "Users can update own seasons"
  ON seasons
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own seasons
CREATE POLICY "Users can delete own seasons"
  ON seasons
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to update updated_at on row update
DROP TRIGGER IF EXISTS update_seasons_updated_at ON seasons;
CREATE TRIGGER update_seasons_updated_at
  BEFORE UPDATE ON seasons
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
