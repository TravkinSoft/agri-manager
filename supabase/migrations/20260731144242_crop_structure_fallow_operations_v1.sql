-- TZ-240: represent fallow land explicitly without inventing a crop row.
ALTER TABLE public.crop_structure
  ADD COLUMN IF NOT EXISTS land_use_type text NOT NULL DEFAULT 'crop';

UPDATE public.crop_structure
SET land_use_type = 'crop'
WHERE land_use_type IS NULL;

ALTER TABLE public.crop_structure
  DROP CONSTRAINT IF EXISTS crop_structure_land_use_type_check;

ALTER TABLE public.crop_structure
  ADD CONSTRAINT crop_structure_land_use_type_check
  CHECK (land_use_type IN ('crop', 'fallow'));

ALTER TABLE public.crop_structure
  DROP CONSTRAINT IF EXISTS crop_structure_land_use_identity_check;

ALTER TABLE public.crop_structure
  ADD CONSTRAINT crop_structure_land_use_identity_check
  CHECK (
    (land_use_type = 'crop' AND crop_id IS NOT NULL)
    OR
    (
      land_use_type = 'fallow'
      AND crop_id IS NULL
      AND variety_id IS NULL
      AND reproduction_id IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_crop_structure_company_season_land_use
  ON public.crop_structure (company_id, season_id, land_use_type)
  WHERE archived = false;

COMMENT ON COLUMN public.crop_structure.land_use_type IS
  'Canonical land use: crop has crop identity; fallow has no crop, variety, or reproduction.';

-- Keep the operation target deterministic without changing the atomic create RPC.
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS target_scope text
  GENERATED ALWAYS AS (
    CASE
      WHEN crop_structure_id IS NULL THEN 'field'
      ELSE 'structure_line'
    END
  ) STORED;

COMMENT ON COLUMN public.operations.target_scope IS
  'Derived operation scope: whole field or one crop structure line.';
