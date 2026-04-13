/*
  Multilingual foundation:
  - profiles.preferred_language
  - optional multilingual name fields for core dictionaries/entities
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'preferred_language'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN preferred_language text NOT NULL DEFAULT 'ru'
      CHECK (preferred_language IN ('ru', 'kz', 'en'));
  END IF;
END $$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'products',
    'warehouses',
    'crops',
    'varieties',
    'seed_reproductions',
    'reference_machines',
    'reference_equipment',
    'reference_specialists'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = target_table
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = target_table AND column_name = 'name_ru'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN name_ru text', target_table);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = target_table AND column_name = 'name_kz'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN name_kz text', target_table);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = target_table AND column_name = 'name_en'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN name_en text', target_table);
      END IF;
    END IF;
  END LOOP;
END $$;

