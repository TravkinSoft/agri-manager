/*
  # Create Assistant Settings Tables

  1. New Tables
    - `assistant_settings`
      - `id` (uuid, primary key)
      - `user_id` (uuid)
      - `system_prompt` (text, custom system prompt)
      - `allow_operation_creation` (boolean)
      - `require_confirmation` (boolean)
      - `enable_recommendations` (boolean)
      - `use_warehouse_data` (boolean)
      - `use_inventory_data` (boolean)
      - `region` (text)
      - `farm_type` (text)
      - `main_crops` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `assistant_knowledge_files`
      - `id` (uuid, primary key)
      - `user_id` (uuid)
      - `filename` (text)
      - `file_type` (text)
      - `file_size` (integer)
      - `file_url` (text)
      - `extracted_text` (text)
      - `uploaded_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policies for public access (temporary for demo)
*/

CREATE TABLE IF NOT EXISTS assistant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  system_prompt text DEFAULT '',
  allow_operation_creation boolean DEFAULT true,
  require_confirmation boolean DEFAULT true,
  enable_recommendations boolean DEFAULT true,
  use_warehouse_data boolean DEFAULT true,
  use_inventory_data boolean DEFAULT true,
  region text DEFAULT '',
  farm_type text DEFAULT '',
  main_crops text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS assistant_knowledge_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  filename text NOT NULL,
  file_type text NOT NULL,
  file_size integer NOT NULL,
  file_url text NOT NULL,
  extracted_text text DEFAULT '',
  uploaded_at timestamptz DEFAULT now()
);

ALTER TABLE assistant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_knowledge_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on assistant_settings"
  ON assistant_settings FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on assistant_settings"
  ON assistant_settings FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update on assistant_settings"
  ON assistant_settings FOR UPDATE
  TO public
  USING (true);

CREATE POLICY "Allow public read on assistant_knowledge_files"
  ON assistant_knowledge_files FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on assistant_knowledge_files"
  ON assistant_knowledge_files FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public delete on assistant_knowledge_files"
  ON assistant_knowledge_files FOR DELETE
  TO public
  USING (true);

CREATE INDEX IF NOT EXISTS idx_assistant_settings_user_id ON assistant_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_assistant_knowledge_files_user_id ON assistant_knowledge_files(user_id);
