/*
  # Add status column to profiles table

  1. Changes
    - Add `status` column to `profiles` table with default value 'pending'
    - Existing profiles (admin/owner) are set to 'active' immediately

  2. Values
    - 'pending': user created but has not logged in yet
    - 'active': user has logged in at least once
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'status'
  ) THEN
    ALTER TABLE profiles ADD COLUMN status text NOT NULL DEFAULT 'pending';
  END IF;
END $$;

-- Set existing profiles (those with a session) to active
UPDATE profiles SET status = 'active' WHERE status = 'pending';
