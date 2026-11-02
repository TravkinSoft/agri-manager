-- Separate committed transaction: never use a new enum label before commit.
ALTER TYPE public.product_accounting_mode ADD VALUE IF NOT EXISTS 'catalog_only';
