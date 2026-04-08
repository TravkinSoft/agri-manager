/*
  Phase 1 specialist workflow fields for operations
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'responsible_user_id'
  ) THEN
    ALTER TABLE operations ADD COLUMN responsible_user_id uuid REFERENCES profiles(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'work_status'
  ) THEN
    ALTER TABLE operations ADD COLUMN work_status text NOT NULL DEFAULT 'active'
      CHECK (work_status IN ('active', 'in_progress', 'completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'accepted_at'
  ) THEN
    ALTER TABLE operations ADD COLUMN accepted_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE operations ADD COLUMN completed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'specialist_comment'
  ) THEN
    ALTER TABLE operations ADD COLUMN specialist_comment text;
  END IF;
END $$;

DO $$
DECLARE
  has_assigned_to boolean;
  has_status boolean;
  has_started_at boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'assigned_to'
  ) INTO has_assigned_to;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'status'
  ) INTO has_status;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'started_at'
  ) INTO has_started_at;

  IF has_assigned_to THEN
    EXECUTE 'UPDATE operations SET responsible_user_id = COALESCE(responsible_user_id, assigned_to)';
  END IF;

  IF has_status THEN
    EXECUTE '
      UPDATE operations
      SET work_status = CASE
        WHEN status = ''completed'' THEN ''completed''
        WHEN status IN (''in_progress'', ''accepted'') THEN ''in_progress''
        ELSE COALESCE(work_status, ''active'')
      END
    ';

    EXECUTE '
      UPDATE operations
      SET completed_at = COALESCE(completed_at, CASE WHEN status = ''completed'' THEN NOW() ELSE NULL END)
    ';
  END IF;

  IF has_started_at THEN
    EXECUTE 'UPDATE operations SET accepted_at = COALESCE(accepted_at, started_at)';
  END IF;

  UPDATE operations
  SET work_status = COALESCE(work_status, 'active');
END $$;

CREATE INDEX IF NOT EXISTS idx_operations_responsible_user_id ON operations(responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_operations_work_status ON operations(work_status);
