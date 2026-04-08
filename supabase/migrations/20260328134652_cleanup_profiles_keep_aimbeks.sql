/*
  # Clean up profiles - keep only aimbeks@gmail.com

  Removes all profiles and their associated auth users except for the main admin
  (aimbeks@gmail.com). This leaves the system with a single clean admin account.

  Note: Only the profiles rows are deleted here. Auth users cleanup is handled
  separately if needed.
*/

DELETE FROM profiles
WHERE email != 'aimbeks@gmail.com';
