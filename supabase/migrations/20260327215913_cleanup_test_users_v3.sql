/*
  # Canonical legacy test-user cleanup

  This migration used to delete every Auth user and profile except one fixed
  email address. That behavior is unsafe for a clean database and for the
  current multi-company system.

  Preserve only the narrow historical intent:
  - run only when the original owner identity exists exactly as expected;
  - reassign the original anonymous demo season to that owner;
  - delete only the four explicitly listed legacy demo identities;
  - leave every other user, profile, company, and business row untouched.
*/

do $legacy_test_user_cleanup$
declare
  v_owner_id constant uuid := 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca';
  v_owner_email constant text := 'aimbeks@gmail.com';
begin
  if not exists (
    select 1
    from auth.users
    where id = v_owner_id
      and lower(email) = v_owner_email
  ) then
    raise notice '20260327215913: legacy cleanup skipped because the original owner is absent';
    return;
  end if;

  update public.seasons
  set user_id = v_owner_id
  where user_id = '00000000-0000-0000-0000-000000000001'::uuid;

  delete from public.profiles as profile
  using (
    values
      ('00000000-0000-0000-0000-000000000001'::uuid, 'demo@example.com'),
      ('5a9ae0d2-0c8e-4ead-b98d-f0165a4513a2'::uuid, 'ereke94kaisar@gmail.com'),
      ('07d01086-d0a3-4ec8-afd6-3d6b80949528'::uuid, 'roni._@mail.ru'),
      ('c1a632ee-4452-44f7-8657-0d8a879c6873'::uuid, 'travkin-94@list.ru')
  ) as legacy_user(id, email)
  where profile.id = legacy_user.id
    and lower(profile.email) = legacy_user.email;

  delete from auth.users as auth_user
  using (
    values
      ('00000000-0000-0000-0000-000000000001'::uuid, 'demo@example.com'),
      ('5a9ae0d2-0c8e-4ead-b98d-f0165a4513a2'::uuid, 'ereke94kaisar@gmail.com'),
      ('07d01086-d0a3-4ec8-afd6-3d6b80949528'::uuid, 'roni._@mail.ru'),
      ('c1a632ee-4452-44f7-8657-0d8a879c6873'::uuid, 'travkin-94@list.ru')
  ) as legacy_user(id, email)
  where auth_user.id = legacy_user.id
    and lower(auth_user.email) = legacy_user.email;
end
$legacy_test_user_cleanup$;
