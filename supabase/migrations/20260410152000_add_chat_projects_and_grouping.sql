/*
  Chat projects and grouping for assistant:
  - add chat_projects table
  - add chats.project_id relation
  - backfill existing chats into a default project per user/company
*/

CREATE TABLE IF NOT EXISTS public.chat_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) > 0),
  color text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_projects_company_user
  ON public.chat_projects (company_id, user_id, archived, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chats'
      AND column_name = 'project_id'
  ) THEN
    ALTER TABLE public.chats
      ADD COLUMN project_id uuid REFERENCES public.chat_projects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chats_project_id
  ON public.chats (project_id, updated_at DESC);

DO $$
DECLARE
  rec record;
  default_project_id uuid;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.company_id, c.user_id
    FROM public.chats c
    WHERE c.company_id IS NOT NULL
      AND c.user_id IS NOT NULL
  LOOP
    SELECT id
    INTO default_project_id
    FROM public.chat_projects
    WHERE company_id = rec.company_id
      AND user_id = rec.user_id
      AND archived = false
    ORDER BY created_at ASC
    LIMIT 1;

    IF default_project_id IS NULL THEN
      INSERT INTO public.chat_projects (company_id, user_id, name)
      VALUES (rec.company_id, rec.user_id, 'Общие консультации')
      RETURNING id INTO default_project_id;
    END IF;

    UPDATE public.chats
    SET project_id = default_project_id
    WHERE company_id = rec.company_id
      AND user_id = rec.user_id
      AND project_id IS NULL;
  END LOOP;
END $$;

ALTER TABLE public.chat_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can read own projects" ON public.chat_projects;
CREATE POLICY "Company members can read own projects"
  ON public.chat_projects
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Company members can insert own projects" ON public.chat_projects;
CREATE POLICY "Company members can insert own projects"
  ON public.chat_projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Company members can update own projects" ON public.chat_projects;
CREATE POLICY "Company members can update own projects"
  ON public.chat_projects
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Company members can delete own projects" ON public.chat_projects;
CREATE POLICY "Company members can delete own projects"
  ON public.chat_projects
  FOR DELETE
  TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND user_id = auth.uid()
  );
