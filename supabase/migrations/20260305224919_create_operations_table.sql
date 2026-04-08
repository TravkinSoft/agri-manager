/*
  # Create Operations (Agronomic Work Log) Table

  ## Purpose
  Track all agronomic operations and work performed on fields and crops throughout the growing season.

  ## New Tables

  ### `operations`
  - `id` (uuid, primary key) - Unique identifier for each operation
  - `field_id` (uuid, required) - Reference to the field where operation was performed
  - `crop_structure_id` (uuid, optional) - Reference to specific crop structure if applicable
  - `operation_type` (text, required) - Type of operation (e.g., "Planting", "Fertilizing", "Harvesting")
  - `date` (date, required) - Date when operation was performed
  - `notes` (text, optional) - Additional notes and details about the operation
  - `created_at` (timestamptz) - Timestamp when record was created
  - `updated_at` (timestamptz) - Timestamp when record was last updated
  - `archived` (boolean, default false) - Soft delete flag
  - `user_id` (uuid, required) - Reference to the user who owns this operation

  ## Security

  1. Enable Row Level Security (RLS) on operations table
  2. Add policy for authenticated users to view their own operations
  3. Add policy for authenticated users to insert their own operations
  4. Add policy for authenticated users to update their own operations
  5. Add policy for authenticated users to delete their own operations

  ## Constraints

  - field_id must reference an existing field
  - crop_structure_id must reference an existing crop structure if provided
  - date must be provided
  - operation_type must not be empty

  ## Notes

  - Uses soft delete pattern with `archived` field
  - Indexes added for fast filtering by field, crop structure, and date
  - Each user can only access their own operations
*/

-- Create operations table
CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL REFERENCES fields(id) ON DELETE RESTRICT,
  crop_structure_id uuid REFERENCES crop_structure(id) ON DELETE SET NULL,
  operation_type text NOT NULL CHECK (length(trim(operation_type)) > 0),
  date date NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  archived boolean DEFAULT false,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_operations_user_id ON operations(user_id);
CREATE INDEX IF NOT EXISTS idx_operations_field_id ON operations(field_id);
CREATE INDEX IF NOT EXISTS idx_operations_crop_structure_id ON operations(crop_structure_id);
CREATE INDEX IF NOT EXISTS idx_operations_date ON operations(date DESC);
CREATE INDEX IF NOT EXISTS idx_operations_archived ON operations(archived);
CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations(created_at DESC);

-- Enable Row Level Security
ALTER TABLE operations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own operations
CREATE POLICY "Users can view own operations"
  ON operations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own operations
CREATE POLICY "Users can insert own operations"
  ON operations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own operations
CREATE POLICY "Users can update own operations"
  ON operations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own operations
CREATE POLICY "Users can delete own operations"
  ON operations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to update updated_at on row update
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_operations_updated_at ON operations;
CREATE TRIGGER update_operations_updated_at
  BEFORE UPDATE ON operations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
