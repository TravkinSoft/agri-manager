/*
  # Add company_id to chats table and fix chat RLS

  ## Problem
  The chats table only had user_id. The chat service was calling:
    getChats(profile.id) → queried by company_id (column didn't exist → empty)
    createChat(profile.id, ...) → inserted with company_id (column didn't exist → error/null)

  Result: chats were never saved or loaded, chat history was lost on every reload.

  ## Fix
  1. Add company_id column to chats table
  2. Update RLS policies to allow company-scoped access
  3. Keep user_id for ownership tracking
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chats' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE public.chats ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS chats_company_id_idx ON public.chats(company_id);

DROP POLICY IF EXISTS "Company members can read company chats" ON public.chats;
CREATE POLICY "Company members can read company chats"
  ON public.chats
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_my_company_id()
    OR (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Company members can insert company chats" ON public.chats;
CREATE POLICY "Company members can insert company chats"
  ON public.chats
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
  );
