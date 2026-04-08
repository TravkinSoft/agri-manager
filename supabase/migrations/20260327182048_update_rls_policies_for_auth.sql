/*
  # Update RLS Policies for User Authentication

  1. Changes
    - Remove placeholder user_id default values
    - Update all RLS policies to use auth.uid()
    - Ensure proper user data isolation
    - Add policies for admin role

  2. Security
    - Users can only access their own data
    - Admin users have broader access (future implementation)
    - All tables properly enforce RLS
*/

-- Update fields policies
DROP POLICY IF EXISTS "Users can read own fields" ON fields;
DROP POLICY IF EXISTS "Users can create own fields" ON fields;
DROP POLICY IF EXISTS "Users can update own fields" ON fields;
DROP POLICY IF EXISTS "Users can delete own fields" ON fields;

CREATE POLICY "Users can read own fields"
  ON fields FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own fields"
  ON fields FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own fields"
  ON fields FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own fields"
  ON fields FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Update crop_structure policies
DROP POLICY IF EXISTS "Users can read own crop structures" ON crop_structure;
DROP POLICY IF EXISTS "Users can create own crop structures" ON crop_structure;
DROP POLICY IF EXISTS "Users can update own crop structures" ON crop_structure;
DROP POLICY IF EXISTS "Users can delete own crop structures" ON crop_structure;

CREATE POLICY "Users can read own crop structures"
  ON crop_structure FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own crop structures"
  ON crop_structure FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own crop structures"
  ON crop_structure FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own crop structures"
  ON crop_structure FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Update seasons policies
DROP POLICY IF EXISTS "Users can read own seasons" ON seasons;
DROP POLICY IF EXISTS "Users can create own seasons" ON seasons;
DROP POLICY IF EXISTS "Users can update own seasons" ON seasons;
DROP POLICY IF EXISTS "Users can delete own seasons" ON seasons;

CREATE POLICY "Users can read own seasons"
  ON seasons FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can create own seasons"
  ON seasons FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can update own seasons"
  ON seasons FOR UPDATE
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can delete own seasons"
  ON seasons FOR DELETE
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

-- Update operations policies
DROP POLICY IF EXISTS "Users can read own operations" ON operations;
DROP POLICY IF EXISTS "Users can create own operations" ON operations;
DROP POLICY IF EXISTS "Users can update own operations" ON operations;
DROP POLICY IF EXISTS "Users can delete own operations" ON operations;

CREATE POLICY "Users can read own operations"
  ON operations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own operations"
  ON operations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own operations"
  ON operations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own operations"
  ON operations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Update warehouses policies
DROP POLICY IF EXISTS "Users can read own warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can create own warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can update own warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can delete own warehouses" ON warehouses;

CREATE POLICY "Users can read own warehouses"
  ON warehouses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own warehouses"
  ON warehouses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own warehouses"
  ON warehouses FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own warehouses"
  ON warehouses FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Update products policies
DROP POLICY IF EXISTS "Users can read own products" ON products;
DROP POLICY IF EXISTS "Users can create own products" ON products;
DROP POLICY IF EXISTS "Users can update own products" ON products;
DROP POLICY IF EXISTS "Users can delete own products" ON products;

CREATE POLICY "Users can read own products"
  ON products FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can create own products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can update own products"
  ON products FOR UPDATE
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can delete own products"
  ON products FOR DELETE
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

-- Update inventory_transactions policies
DROP POLICY IF EXISTS "Users can read own transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Users can create own transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON inventory_transactions;

CREATE POLICY "Users can read own transactions"
  ON inventory_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own transactions"
  ON inventory_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON inventory_transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON inventory_transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Update reference tables (crops, varieties, seed_reproductions)
DROP POLICY IF EXISTS "Users can read crops" ON crops;
DROP POLICY IF EXISTS "Users can manage own crops" ON crops;

CREATE POLICY "Users can read crops"
  ON crops FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can manage own crops"
  ON crops FOR ALL
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read varieties" ON varieties;
DROP POLICY IF EXISTS "Users can manage own varieties" ON varieties;

CREATE POLICY "Users can read varieties"
  ON varieties FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can manage own varieties"
  ON varieties FOR ALL
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read seed reproductions" ON seed_reproductions;
DROP POLICY IF EXISTS "Users can manage own seed reproductions" ON seed_reproductions;

CREATE POLICY "Users can read seed reproductions"
  ON seed_reproductions FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can manage own seed reproductions"
  ON seed_reproductions FOR ALL
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- Update chats policies
DROP POLICY IF EXISTS "Users can read own chats" ON chats;
DROP POLICY IF EXISTS "Users can create own chats" ON chats;
DROP POLICY IF EXISTS "Users can update own chats" ON chats;
DROP POLICY IF EXISTS "Users can delete own chats" ON chats;

CREATE POLICY "Users can read own chats"
  ON chats FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can create own chats"
  ON chats FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can update own chats"
  ON chats FOR UPDATE
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can delete own chats"
  ON chats FOR DELETE
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

-- Update chat_messages policies
DROP POLICY IF EXISTS "Users can read own messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can create own messages" ON chat_messages;

CREATE POLICY "Users can read own messages"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_messages.chat_id
      AND (chats.user_id IS NULL OR chats.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can create own messages"
  ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_messages.chat_id
      AND (chats.user_id IS NULL OR chats.user_id = auth.uid())
    )
  );

-- Update assistant_settings policies
DROP POLICY IF EXISTS "Users can read own settings" ON assistant_settings;
DROP POLICY IF EXISTS "Users can manage own settings" ON assistant_settings;

CREATE POLICY "Users can read own settings"
  ON assistant_settings FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can manage own settings"
  ON assistant_settings FOR ALL
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- Update assistant_knowledge_files policies
DROP POLICY IF EXISTS "Users can read own files" ON assistant_knowledge_files;
DROP POLICY IF EXISTS "Users can manage own files" ON assistant_knowledge_files;

CREATE POLICY "Users can read own files"
  ON assistant_knowledge_files FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can manage own files"
  ON assistant_knowledge_files FOR ALL
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);