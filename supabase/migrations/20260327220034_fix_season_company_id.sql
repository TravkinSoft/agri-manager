/*
  # Fix Season Company ID
  
  1. Changes
    - Update the season with NULL company_id to link to the main company
  
  2. Data Integrity
    - Ensure the season is properly linked to the company
*/

-- Update season to link to the main company
UPDATE seasons
SET company_id = '10000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

-- Verify the update
DO $$
DECLARE
  seasons_without_company INTEGER;
BEGIN
  SELECT COUNT(*) INTO seasons_without_company
  FROM seasons
  WHERE company_id IS NULL;
  
  IF seasons_without_company > 0 THEN
    RAISE EXCEPTION 'Still have % seasons without company_id', seasons_without_company;
  END IF;
  
  RAISE NOTICE 'All seasons properly linked to company';
END $$;