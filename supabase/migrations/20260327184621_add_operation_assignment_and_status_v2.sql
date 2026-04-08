/*
  # Add Operation Assignment and Status System

  1. Changes
    - Add status field to operations table (planned, accepted, in_progress, completed)
    - Add assigned_to field to operations table
    - Add tracking timestamps (accepted_at, started_at, completed_at)

  2. Security
    - Update RLS policies to allow specialists to view assigned operations
*/

-- Add new columns to operations table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'status'
  ) THEN
    ALTER TABLE operations ADD COLUMN status text DEFAULT 'planned' CHECK (status IN ('planned', 'accepted', 'in_progress', 'completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'assigned_to'
  ) THEN
    ALTER TABLE operations ADD COLUMN assigned_to uuid REFERENCES profiles(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'accepted_at'
  ) THEN
    ALTER TABLE operations ADD COLUMN accepted_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'started_at'
  ) THEN
    ALTER TABLE operations ADD COLUMN started_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE operations ADD COLUMN completed_at timestamptz;
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS operations_assigned_to_idx ON operations(assigned_to);
CREATE INDEX IF NOT EXISTS operations_status_idx ON operations(status);

-- Update RLS policies to allow specialists to view assigned operations
DROP POLICY IF EXISTS "Users can read own operations" ON operations;

CREATE POLICY "Users can read own operations"
  ON operations FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR 
    auth.uid() = assigned_to
  );

-- Allow specialists to update operations they are assigned to
DROP POLICY IF EXISTS "Users can update own operations" ON operations;

CREATE POLICY "Users can update own operations"
  ON operations FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id OR 
    auth.uid() = assigned_to
  )
  WITH CHECK (
    auth.uid() = user_id OR 
    auth.uid() = assigned_to
  );