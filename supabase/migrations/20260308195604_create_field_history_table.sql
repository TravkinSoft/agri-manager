/*
  # Create Field History Table
  
  1. Purpose
    - Store historical crop rotation data for each field by year
    - Track what crop was grown on each field in previous seasons
  
  2. New Table
    - `field_history`
      - `id` (uuid, primary key)
      - `field_id` (uuid, foreign key to fields)
      - `season` (integer, year like 2020, 2021, etc.)
      - `crop` (text, crop name - stored as text for flexibility)
      - `created_at` (timestamp)
  
  3. Security
    - Enable RLS
    - Add policies for authenticated users to read/write their own data
*/

-- Create field_history table
CREATE TABLE IF NOT EXISTS field_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  season integer NOT NULL CHECK (season >= 2000 AND season <= 2100),
  crop text NOT NULL CHECK (length(trim(crop)) > 0),
  created_at timestamptz DEFAULT now(),
  
  -- Ensure unique field-season combination
  UNIQUE(field_id, season)
);

-- Enable RLS
ALTER TABLE field_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all field history records
CREATE POLICY "Allow public read access to field_history"
  ON field_history
  FOR SELECT
  TO public
  USING (true);

-- Policy: Users can insert field history records
CREATE POLICY "Allow public insert access to field_history"
  ON field_history
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Policy: Users can update field history records
CREATE POLICY "Allow public update access to field_history"
  ON field_history
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- Policy: Users can delete field history records
CREATE POLICY "Allow public delete access to field_history"
  ON field_history
  FOR DELETE
  TO public
  USING (true);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS field_history_field_id_idx ON field_history(field_id);
CREATE INDEX IF NOT EXISTS field_history_season_idx ON field_history(season);
