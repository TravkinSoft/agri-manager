/*
  # Add Demo Products and Warehouses

  1. Products - Add pesticides and fertilizers
  2. Warehouses - Create specialized storage
  3. Inventory - Add initial stock
*/

-- Add Pesticides
INSERT INTO products (user_id, name, type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Glyphosate 480', 'pesticide'),
  ('00000000-0000-0000-0000-000000000001', '2,4-D Amine', 'pesticide'),
  ('00000000-0000-0000-0000-000000000001', 'Dicamba', 'pesticide'),
  ('00000000-0000-0000-0000-000000000001', 'Metribuzin', 'pesticide'),
  ('00000000-0000-0000-0000-000000000001', 'Acetochlor', 'pesticide'),
  ('00000000-0000-0000-0000-000000000001', 'Chlorpyrifos', 'pesticide'),
  ('00000000-0000-0000-0000-000000000001', 'Mancozeb', 'pesticide'),
  ('00000000-0000-0000-0000-000000000001', 'Azoxystrobin', 'pesticide')
ON CONFLICT DO NOTHING;

-- Add Fertilizers
INSERT INTO products (user_id, name, type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Ammonium Nitrate', 'fertilizer'),
  ('00000000-0000-0000-0000-000000000001', 'Urea 46%', 'fertilizer'),
  ('00000000-0000-0000-0000-000000000001', 'Ammophos 12-52', 'fertilizer'),
  ('00000000-0000-0000-0000-000000000001', 'UAN-32', 'fertilizer'),
  ('00000000-0000-0000-0000-000000000001', 'Ammonium Sulfate', 'fertilizer'),
  ('00000000-0000-0000-0000-000000000001', 'Potassium Chloride', 'fertilizer')
ON CONFLICT DO NOTHING;

-- Create Specialized Warehouses
INSERT INTO warehouses (user_id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Grain Warehouse #1'),
  ('00000000-0000-0000-0000-000000000001', 'Potato Storage Facility'),
  ('00000000-0000-0000-0000-000000000001', 'Seed Warehouse'),
  ('00000000-0000-0000-0000-000000000001', 'Pesticide Storage'),
  ('00000000-0000-0000-0000-000000000001', 'Fertilizer Warehouse')
ON CONFLICT DO NOTHING;

-- Add inventory stock
DO $$
DECLARE
  pesticide_wh uuid;
  fertilizer_wh uuid;
  gly360 uuid;
  gly480 uuid;
  dic uuid;
  met uuid;
  ure uuid;
  amm uuid;
  nit uuid;
BEGIN
  SELECT id INTO pesticide_wh FROM warehouses WHERE name = 'Pesticide Storage' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
  SELECT id INTO fertilizer_wh FROM warehouses WHERE name = 'Fertilizer Warehouse' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
  SELECT id INTO gly360 FROM products WHERE name = 'Herbicide Glyphosate 360' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
  SELECT id INTO gly480 FROM products WHERE name = 'Glyphosate 480' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
  SELECT id INTO dic FROM products WHERE name = 'Dicamba' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
  SELECT id INTO met FROM products WHERE name = 'Metribuzin' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
  SELECT id INTO ure FROM products WHERE name = 'Urea 46%' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
  SELECT id INTO amm FROM products WHERE name = 'Ammophos 12-52' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
  SELECT id INTO nit FROM products WHERE name = 'Ammonium Nitrate' AND user_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;

  IF pesticide_wh IS NOT NULL THEN
    IF gly360 IS NOT NULL THEN
      INSERT INTO inventory_transactions (user_id, warehouse_id, product_id, transaction_type, quantity, date, notes)
      VALUES ('00000000-0000-0000-0000-000000000001', pesticide_wh, gly360, 'in', 500, '2026-03-01', 'Initial stock - 500 liters') ON CONFLICT DO NOTHING;
    END IF;
    IF gly480 IS NOT NULL THEN
      INSERT INTO inventory_transactions (user_id, warehouse_id, product_id, transaction_type, quantity, date, notes)
      VALUES ('00000000-0000-0000-0000-000000000001', pesticide_wh, gly480, 'in', 300, '2026-03-01', 'Initial stock - 300 liters') ON CONFLICT DO NOTHING;
    END IF;
    IF dic IS NOT NULL THEN
      INSERT INTO inventory_transactions (user_id, warehouse_id, product_id, transaction_type, quantity, date, notes)
      VALUES ('00000000-0000-0000-0000-000000000001', pesticide_wh, dic, 'in', 200, '2026-03-05', 'Seasonal stock - 200 liters') ON CONFLICT DO NOTHING;
    END IF;
    IF met IS NOT NULL THEN
      INSERT INTO inventory_transactions (user_id, warehouse_id, product_id, transaction_type, quantity, date, notes)
      VALUES ('00000000-0000-0000-0000-000000000001', pesticide_wh, met, 'in', 150, '2026-03-10', 'Seasonal stock - 150 kg') ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF fertilizer_wh IS NOT NULL THEN
    IF ure IS NOT NULL THEN
      INSERT INTO inventory_transactions (user_id, warehouse_id, product_id, transaction_type, quantity, date, notes)
      VALUES ('00000000-0000-0000-0000-000000000001', fertilizer_wh, ure, 'in', 5000, '2026-02-15', 'Bulk purchase - 5000 kg') ON CONFLICT DO NOTHING;
    END IF;
    IF amm IS NOT NULL THEN
      INSERT INTO inventory_transactions (user_id, warehouse_id, product_id, transaction_type, quantity, date, notes)
      VALUES ('00000000-0000-0000-0000-000000000001', fertilizer_wh, amm, 'in', 3000, '2026-02-20', 'Pre-season stock - 3000 kg') ON CONFLICT DO NOTHING;
    END IF;
    IF nit IS NOT NULL THEN
      INSERT INTO inventory_transactions (user_id, warehouse_id, product_id, transaction_type, quantity, date, notes)
      VALUES ('00000000-0000-0000-0000-000000000001', fertilizer_wh, nit, 'in', 4000, '2026-03-01', 'Spring fertilization - 4000 kg') ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;
