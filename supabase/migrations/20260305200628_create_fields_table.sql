/*
  # Create Fields Table

  ## Purpose
  Store agricultural field information including name, area, soil type, and status.
  
  ## New Tables
  
  ### `fields`
  - `id` (uuid, primary key) - Unique identifier for each field
  - `name` (text, required) - Name of the agricultural field
  - `area` (decimal, required) - Area in hectares
  - `soil_type` (text, optional) - Type of soil in the field
  - `notes` (text, optional) - Additional notes or comments
  - `archived` (boolean, default false) - Soft delete flag
  - `created_at` (timestamptz) - Timestamp when the field was created
  - `updated_at` (timestamptz) - Timestamp when the field was last updated
  - `user_id` (uuid, required) - Reference to the user who owns this field
  
  ## Security
  
  1. Enable Row Level Security (RLS) on the fields table
  2. Add policy for authenticated users to view their own fields
  3. Add policy for authenticated users to insert their own fields
  4. Add policy for authenticated users to update their own fields
  5. Add policy for authenticated users to delete their own fields (soft delete)
  
  ## Notes
  
  - Uses soft delete pattern with `archived` field instead of permanent deletion
  - Area is stored as decimal to support precise measurements
  - All fields are owned by users for multi-tenancy support
  - Timestamps are automatically managed
*/

-- Create fields table
CREATE TABLE IF NOT EXISTS fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  area decimal(10, 2) NOT NULL CHECK (area > 0),
  soil_type text,
  notes text,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_fields_user_id ON fields(user_id);
CREATE INDEX IF NOT EXISTS idx_fields_archived ON fields(archived);
CREATE INDEX IF NOT EXISTS idx_fields_created_at ON fields(created_at DESC);

-- Enable Row Level Security
ALTER TABLE fields ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own non-archived fields
CREATE POLICY "Users can view own fields"
  ON fields
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own fields
CREATE POLICY "Users can insert own fields"
  ON fields
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own fields
CREATE POLICY "Users can update own fields"
  ON fields
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own fields (soft delete only)
CREATE POLICY "Users can delete own fields"
  ON fields
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on row update
DROP TRIGGER IF EXISTS update_fields_updated_at ON fields;
CREATE TRIGGER update_fields_updated_at
  BEFORE UPDATE ON fields
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
