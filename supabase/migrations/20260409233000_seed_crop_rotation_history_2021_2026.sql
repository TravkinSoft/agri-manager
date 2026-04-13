/*
  Seed realistic crop rotation history for crop-structure UI testing.

  Result:
  - 2026 is ensured as planning season and left empty.
  - 2025..2021 are filled with demo historical rotations per field.
  - Data is generated per company and uses available crop catalog.
*/

DO $$
DECLARE
  company_rec RECORD;
  season_2021 uuid;
  season_2022 uuid;
  season_2023 uuid;
  season_2024 uuid;
  season_2025 uuid;
  season_2026 uuid;
  owner_user_id uuid;
  field_rec RECORD;
  crop_ids uuid[];
  pool_len int;
  fallow_crop uuid;
  base_idx int;
  c2025 uuid;
  c2024 uuid;
  c2023 uuid;
  c2022 uuid;
  c2021 uuid;
BEGIN
  FOR company_rec IN
    SELECT DISTINCT p.company_id
    FROM public.profiles p
    WHERE p.company_id IS NOT NULL
  LOOP
    SELECT p.id
    INTO owner_user_id
    FROM public.profiles p
    WHERE p.company_id = company_rec.company_id
    ORDER BY CASE WHEN p.role = 'admin' THEN 0 ELSE 1 END, p.created_at
    LIMIT 1;

    IF owner_user_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.seasons (year, name, company_id, user_id, archived)
    VALUES (2021, '2021', company_rec.company_id, owner_user_id, false)
    ON CONFLICT (company_id, year) DO NOTHING;
    INSERT INTO public.seasons (year, name, company_id, user_id, archived)
    VALUES (2022, '2022', company_rec.company_id, owner_user_id, false)
    ON CONFLICT (company_id, year) DO NOTHING;
    INSERT INTO public.seasons (year, name, company_id, user_id, archived)
    VALUES (2023, '2023', company_rec.company_id, owner_user_id, false)
    ON CONFLICT (company_id, year) DO NOTHING;
    INSERT INTO public.seasons (year, name, company_id, user_id, archived)
    VALUES (2024, '2024', company_rec.company_id, owner_user_id, false)
    ON CONFLICT (company_id, year) DO NOTHING;
    INSERT INTO public.seasons (year, name, company_id, user_id, archived)
    VALUES (2025, '2025', company_rec.company_id, owner_user_id, false)
    ON CONFLICT (company_id, year) DO NOTHING;
    INSERT INTO public.seasons (year, name, company_id, user_id, archived)
    VALUES (2026, '2026', company_rec.company_id, owner_user_id, false)
    ON CONFLICT (company_id, year) DO NOTHING;

    SELECT id INTO season_2021 FROM public.seasons WHERE company_id = company_rec.company_id AND year = 2021 LIMIT 1;
    SELECT id INTO season_2022 FROM public.seasons WHERE company_id = company_rec.company_id AND year = 2022 LIMIT 1;
    SELECT id INTO season_2023 FROM public.seasons WHERE company_id = company_rec.company_id AND year = 2023 LIMIT 1;
    SELECT id INTO season_2024 FROM public.seasons WHERE company_id = company_rec.company_id AND year = 2024 LIMIT 1;
    SELECT id INTO season_2025 FROM public.seasons WHERE company_id = company_rec.company_id AND year = 2025 LIMIT 1;
    SELECT id INTO season_2026 FROM public.seasons WHERE company_id = company_rec.company_id AND year = 2026 LIMIT 1;

    DELETE FROM public.crop_structure
    WHERE company_id = company_rec.company_id
      AND season_id = season_2026;

    DELETE FROM public.crop_structure
    WHERE company_id = company_rec.company_id
      AND season_id IN (season_2021, season_2022, season_2023, season_2024, season_2025);

    SELECT ARRAY_AGG(c.id ORDER BY c.name)
    INTO crop_ids
    FROM public.crops c
    WHERE c.archived = false
      AND (c.company_id = company_rec.company_id OR c.company_id IS NULL);

    pool_len := COALESCE(array_length(crop_ids, 1), 0);
    IF pool_len = 0 THEN
      CONTINUE;
    END IF;

    SELECT c.id
    INTO fallow_crop
    FROM public.crops c
    WHERE c.archived = false
      AND (c.company_id = company_rec.company_id OR c.company_id IS NULL)
      AND (
        lower(c.name) LIKE '%пар%'
        OR lower(c.name) LIKE '%fallow%'
      )
    ORDER BY c.name
    LIMIT 1;

    FOR field_rec IN
      SELECT f.id, f.area
      FROM public.fields f
      WHERE f.company_id = company_rec.company_id
        AND COALESCE(f.archived, false) = false
    LOOP
      base_idx := (abs(hashtext(field_rec.id::text)) % pool_len) + 1;

      c2025 := crop_ids[base_idx];
      c2024 := crop_ids[((base_idx) % pool_len) + 1];
      c2023 := crop_ids[((base_idx + 1) % pool_len) + 1];
      c2022 := crop_ids[((base_idx + 2) % pool_len) + 1];
      c2021 := crop_ids[((base_idx + 3) % pool_len) + 1];

      IF c2024 = c2025 THEN
        c2024 := crop_ids[((base_idx + 4) % pool_len) + 1];
      END IF;

      IF fallow_crop IS NOT NULL AND (abs(hashtext(field_rec.id::text || 'fallow')) % 4 = 0) THEN
        c2022 := fallow_crop;
      END IF;

      INSERT INTO public.crop_structure (field_id, season_id, crop_id, area, status, archived, user_id, company_id)
      VALUES (field_rec.id, season_2025, c2025, field_rec.area, 'planned', false, owner_user_id, company_rec.company_id);
      INSERT INTO public.crop_structure (field_id, season_id, crop_id, area, status, archived, user_id, company_id)
      VALUES (field_rec.id, season_2024, c2024, field_rec.area, 'planned', false, owner_user_id, company_rec.company_id);
      INSERT INTO public.crop_structure (field_id, season_id, crop_id, area, status, archived, user_id, company_id)
      VALUES (field_rec.id, season_2023, c2023, field_rec.area, 'planned', false, owner_user_id, company_rec.company_id);
      INSERT INTO public.crop_structure (field_id, season_id, crop_id, area, status, archived, user_id, company_id)
      VALUES (field_rec.id, season_2022, c2022, field_rec.area, 'planned', false, owner_user_id, company_rec.company_id);
      INSERT INTO public.crop_structure (field_id, season_id, crop_id, area, status, archived, user_id, company_id)
      VALUES (field_rec.id, season_2021, c2021, field_rec.area, 'planned', false, owner_user_id, company_rec.company_id);
    END LOOP;
  END LOOP;
END $$;
