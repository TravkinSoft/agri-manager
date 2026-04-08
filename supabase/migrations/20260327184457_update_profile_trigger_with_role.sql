/*
  # Update Profile Creation Trigger to Support Role from Signup

  1. Changes
    - Update handle_new_user function to use role from signup metadata
    - Fallback to 'agronomist' if no role specified
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'role', 'agronomist')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;