/*
  Assistant long-term memory foundation.

  Additive only:
  - does not modify existing assistant threads/messages;
  - does not affect ERP source-of-truth tables;
  - route handlers use service role, so no client policy is required for runtime.
*/

CREATE TABLE IF NOT EXISTS public.assistant_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'company')),
  category text NOT NULL CHECK (
    category IN (
      'communication_preference',
      'workflow_preference',
      'user_identity',
      'assistant_goal',
      'explicit_note'
    )
  ),
  memory_key text NOT NULL,
  value text NOT NULL,
  confidence numeric(4, 3) NOT NULL DEFAULT 0.800 CHECK (confidence >= 0 AND confidence <= 1),
  source text NOT NULL DEFAULT 'explicit_user_message',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, scope, category, memory_key)
);

CREATE INDEX IF NOT EXISTS assistant_memories_company_user_active_idx
  ON public.assistant_memories(company_id, user_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS assistant_memories_category_idx
  ON public.assistant_memories(category, memory_key)
  WHERE active = true;

ALTER TABLE public.assistant_memories ENABLE ROW LEVEL SECURITY;

