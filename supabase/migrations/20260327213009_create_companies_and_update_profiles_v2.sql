/*
  # Create Companies Table and Update Multi-Tenant Architecture
  
  1. New Tables
    - `companies` - Stores company information
      - `id` (uuid, primary key)
      - `name` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Changes to Profiles
    - Add `company_id` (uuid, foreign key to companies)
    - Add `is_owner` (boolean) - true for company creator
  
  3. Security
    - Enable RLS on companies table
    - Users can read their own company
    - Only owners can update company
*/

-- Create companies table
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Add company_id and is_owner to profiles first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_owner'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_owner boolean DEFAULT false;
  END IF;
END $$;

-- Create index for company_id lookups
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON profiles(company_id);

-- RLS Policies for companies
CREATE POLICY "Users can read their own company"
  ON companies
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Company owners can update their company"
  ON companies
  FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid() AND is_owner = true
    )
  )
  WITH CHECK (
    id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid() AND is_owner = true
    )
  );

-- Update the handle_new_user function to create company for new users
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
DECLARE
  new_company_id uuid;
  invite_company_id uuid;
BEGIN
  -- Check if user was invited (has raw_user_meta_data->>'invited_by_company')
  invite_company_id := (new.raw_user_meta_data->>'invited_by_company')::uuid;
  
  IF invite_company_id IS NOT NULL THEN
    -- User was invited, join existing company
    INSERT INTO public.profiles (id, email, role, company_id, is_owner)
    VALUES (
      new.id,
      new.email,
      COALESCE(new.raw_user_meta_data->>'role', 'agronomist'),
      invite_company_id,
      false
    );
  ELSE
    -- New signup, create new company
    INSERT INTO companies (name) 
    VALUES (COALESCE(new.raw_user_meta_data->>'company_name', new.email || '''s Company'))
    RETURNING id INTO new_company_id;
    
    -- Create profile as company owner
    INSERT INTO public.profiles (id, email, role, company_id, is_owner)
    VALUES (
      new.id,
      new.email,
      COALESCE(new.raw_user_meta_data->>'role', 'agronomist'),
      new_company_id,
      true
    );
  END IF;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;