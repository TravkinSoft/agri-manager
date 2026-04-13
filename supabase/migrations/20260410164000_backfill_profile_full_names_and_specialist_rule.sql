/*
  Backfill full names for existing users and keep users list stable.
  - ensures profiles.full_name exists
  - fills missing names for specific known users
  - fallback assignment for current weighman if email changed
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN full_name text;
  END IF;
END $$;

UPDATE public.profiles
SET full_name = 'Кирилл'
WHERE lower(email) = 'aimbeks@gmail.com';

UPDATE public.profiles
SET full_name = 'Рустем'
WHERE lower(email) = 'travkin-94@list.ru';

UPDATE public.profiles
SET full_name = 'Санджар'
WHERE lower(email) = 'roni._@mail.ru';

UPDATE public.profiles
SET full_name = 'Айгуль'
WHERE lower(email) = 'victorkaretnikov@mail.ru';

UPDATE public.profiles
SET full_name = 'Айгуль'
WHERE role = 'weighman'
  AND coalesce(trim(full_name), '') = '';

UPDATE public.profiles
SET full_name = trim(split_part(email, '@', 1))
WHERE coalesce(trim(full_name), '') = ''
  AND coalesce(trim(email), '') <> '';
