/*
  MVP references for assistant operation draft:
  - machines / tractors / drones
  - equipment / aggregates
  - specialists / brigadiers
*/

CREATE TABLE IF NOT EXISTS reference_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type text NOT NULL DEFAULT 'machine' CHECK (type IN ('tractor', 'machine', 'drone')),
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reference_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  category text,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reference_specialists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  role text,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reference_machines_company_id ON reference_machines(company_id);
CREATE INDEX IF NOT EXISTS idx_reference_equipment_company_id ON reference_equipment(company_id);
CREATE INDEX IF NOT EXISTS idx_reference_specialists_company_id ON reference_specialists(company_id);

ALTER TABLE reference_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_specialists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can view reference_machines" ON reference_machines;
CREATE POLICY "Company members can view reference_machines"
  ON reference_machines FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Company members can manage reference_machines" ON reference_machines;
CREATE POLICY "Company members can manage reference_machines"
  ON reference_machines FOR ALL
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Company members can view reference_equipment" ON reference_equipment;
CREATE POLICY "Company members can view reference_equipment"
  ON reference_equipment FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Company members can manage reference_equipment" ON reference_equipment;
CREATE POLICY "Company members can manage reference_equipment"
  ON reference_equipment FOR ALL
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Company members can view reference_specialists" ON reference_specialists;
CREATE POLICY "Company members can view reference_specialists"
  ON reference_specialists FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Company members can manage reference_specialists" ON reference_specialists;
CREATE POLICY "Company members can manage reference_specialists"
  ON reference_specialists FOR ALL
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS update_reference_machines_updated_at ON reference_machines;
CREATE TRIGGER update_reference_machines_updated_at
  BEFORE UPDATE ON reference_machines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reference_equipment_updated_at ON reference_equipment;
CREATE TRIGGER update_reference_equipment_updated_at
  BEFORE UPDATE ON reference_equipment
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reference_specialists_updated_at ON reference_specialists;
CREATE TRIGGER update_reference_specialists_updated_at
  BEFORE UPDATE ON reference_specialists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
