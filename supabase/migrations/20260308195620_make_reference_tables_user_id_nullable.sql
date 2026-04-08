/*
  # Make user_id Nullable for Reference Tables
  
  1. Purpose
    - Allow system-wide reference data (crops, seasons) without user ownership
    - Reference data should be available to all users
  
  2. Changes
    - Make user_id nullable in `crops` table
    - Make user_id nullable in `seasons` table
  
  3. Security
    - RLS policies remain unchanged
    - Public read access continues to work
*/

-- Make user_id nullable in crops table
ALTER TABLE crops ALTER COLUMN user_id DROP NOT NULL;

-- Make user_id nullable in seasons table
ALTER TABLE seasons ALTER COLUMN user_id DROP NOT NULL;
