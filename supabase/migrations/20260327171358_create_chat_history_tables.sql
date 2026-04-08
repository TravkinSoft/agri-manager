/*
  # Create Chat History Tables

  1. New Tables
    - `chats`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users but nullable for demo)
      - `title` (text, chat title)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `chat_messages`
      - `id` (uuid, primary key)
      - `chat_id` (uuid, references chats)
      - `role` (text, user or assistant)
      - `content` (text, message content)
      - `metadata` (jsonb, for structured data like drafts)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policies for public access (temporary for demo)
*/

CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  title text NOT NULL DEFAULT 'New Chat',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on chats"
  ON chats FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on chats"
  ON chats FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update on chats"
  ON chats FOR UPDATE
  TO public
  USING (true);

CREATE POLICY "Allow public read on chat_messages"
  ON chat_messages FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on chat_messages"
  ON chat_messages FOR INSERT
  TO public
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
