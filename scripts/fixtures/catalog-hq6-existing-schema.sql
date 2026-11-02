-- Synthetic only. Exact existing columns/checks/policies/triggers from 2026-11-02 metadata.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC; GRANT USAGE ON SCHEMA private TO service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,role text,status text,company_id uuid);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY self ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
GRANT SELECT ON public.profiles TO authenticated;
CREATE TABLE public.global_admin_company_contexts(user_id uuid,company_id uuid);
CREATE TYPE public.product_accounting_mode AS ENUM('bulk_mass','unit_with_weight','package_count');
CREATE OR REPLACE FUNCTION private.normalize_catalog_identity_text_v1(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$

  select regexp_replace(

    trim(both ' ' from regexp_replace(

      translate(replace(lower(normalize(coalesce(value, ''), NFKC)), 'ё', 'е'), '‐‑‒–—−', '------'),

      '^["''«»“”„]+|["''«»“”„]+$', '', 'g'

    )),

    '[[:space:]]+', ' ', 'g'

  )

$function$
;;
CREATE TABLE agrochem_formulations(id uuid PRIMARY KEY);
CREATE TABLE agrochem_manufacturers(id uuid PRIMARY KEY);
CREATE TABLE agrochem_mode_of_actions(id uuid PRIMARY KEY);
CREATE TABLE companies(id uuid PRIMARY KEY);
CREATE TABLE crops(id uuid PRIMARY KEY);
CREATE TABLE fertilizer_categories(id uuid PRIMARY KEY);
CREATE TABLE global_suppliers(id uuid PRIMARY KEY);
CREATE TABLE pesticide_categories(id uuid PRIMARY KEY);
CREATE TABLE seed_reproductions(id uuid PRIMARY KEY);
CREATE TABLE varieties(id uuid PRIMARY KEY);
CREATE TABLE public.products("id" uuid NOT NULL DEFAULT gen_random_uuid(),
"name" text NOT NULL,
"type" text NOT NULL,
"created_at" timestamptz DEFAULT now(),
"archived" bool DEFAULT false,
"user_id" uuid NOT NULL,
"company_id" uuid,
"unit" text NOT NULL DEFAULT 'kg'::text,
"description" text,
"name_ru" text,
"name_kz" text,
"name_en" text,
"crop_id" uuid,
"product_form" text,
"accounting_mode" product_accounting_mode NOT NULL DEFAULT 'bulk_mass'::product_accounting_mode,
"base_uom" text NOT NULL DEFAULT 'kg'::text,
"pack_uom" text,
"unit_weight_kg" numeric,
"units_per_pack" numeric,
"is_seed_material" bool NOT NULL DEFAULT false,
"master_product_id" uuid,
"active_ingredient" text,
"pesticide_subcategories" text[] NOT NULL DEFAULT '{}'::text[],
"is_active" bool NOT NULL DEFAULT true,
"trade_name" text,
"manufacturer" text,
"formulation" text,
"package_size" numeric,
"package_unit" text,
"default_unit" text,
"notes" text,
"pesticide_category" text,
"fertilizer_type" text,
"updated_at" timestamptz DEFAULT now(),
"category" text,
"subcategory" text,
"concentration" text,
"target_pests" text,
"target_crops" text,
"application_rate" numeric,
"application_unit" text,
"application_method" text,
"registration_status_kz" text,
"source_url" text,
"composition" text,
"category_id" uuid,
"mode_of_action_type" text,
"application_rate_text" text,
"product_type" text,
"manufacturer_id" uuid,
"formulation_id" uuid,
"mode_of_action_type_id" uuid,
"normalized_name" text,
"ui_group" text,
"import_confidence" text,
"requires_review" bool NOT NULL DEFAULT false,
"operation_template" text,
"global_supplier_id" uuid,
"variety_id" uuid,
"seed_reproduction_id" uuid,
"stock_unit" text,
"default_rate_type" text,
"default_rate_unit" text,
"physical_state" text,
"metadata_source_url" text,
"metadata_confidence" text,
"metadata_review_required" bool NOT NULL DEFAULT false,
"agro_composition_raw" jsonb NOT NULL DEFAULT '[]'::jsonb,
"agro_source_urls_raw" jsonb NOT NULL DEFAULT '[]'::jsonb,
"agro_knowledge_source_version" text,
"agro_knowledge_source_checksum" text,
"glbd_import_batch_id" uuid,
"is_derived_inventory" bool NOT NULL DEFAULT false,
"derived_identity_key" text,
"fertilizer_category_id" uuid,
"application_scope" text,
"catalog_category_label" text,
"catalog_category_slug" text,
"catalog_source_version" text,
"catalog_source_checksum" text,
"catalog_source_row" int4,
"catalog_source_created" bool NOT NULL DEFAULT false,
"density_kg_per_l" numeric,
"density_unit" text,
"density_source" text,
"density_verification_status" text,
"density_verified_at" timestamptz);
CREATE TABLE public.glbd_import_batches("id" uuid NOT NULL DEFAULT gen_random_uuid(),
"source_package" text NOT NULL,
"source_file_name" text NOT NULL,
"source_version" text,
"source_sha256" text NOT NULL,
"status" text NOT NULL DEFAULT 'prepared'::text,
"expected_products" int4,
"expected_component_rows" int4,
"expected_aliases" int4,
"expected_usage_rules" int4,
"manifest" jsonb NOT NULL DEFAULT '{}'::jsonb,
"rollback_manifest" jsonb NOT NULL DEFAULT '{}'::jsonb,
"created_at" timestamptz NOT NULL DEFAULT now(),
"updated_at" timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.glbd_import_batch_rows("id" uuid NOT NULL DEFAULT gen_random_uuid(),
"import_batch_id" uuid NOT NULL,
"entity_type" text NOT NULL,
"source_record_id" text NOT NULL,
"product_id" uuid,
"status" text NOT NULL DEFAULT 'parsed'::text,
"source_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
"normalized_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
"warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
"errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
"created_at" timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.glbd_product_sources("id" uuid NOT NULL,
"product_id" uuid NOT NULL,
"source_type" text NOT NULL,
"source_url" text,
"source_title" text,
"claim_fields" text[],
"checked_on" date,
"confidence" numeric,
"verification_status" text NOT NULL,
"notes" text,
"created_at" timestamptz NOT NULL DEFAULT now(),
"updated_at" timestamptz NOT NULL DEFAULT now(),
"source_scope" text,
"source_record_id" text,
"source_name_raw" text,
"source_text_raw" text,
"original_source_text" text,
"source_metadata_raw" jsonb NOT NULL DEFAULT '{}'::jsonb,
"import_batch_id" uuid);
ALTER TABLE public.glbd_import_batch_rows ADD CONSTRAINT "glbd_import_batch_rows_pkey" PRIMARY KEY (id);
ALTER TABLE public.glbd_import_batches ADD CONSTRAINT "glbd_import_batches_pkey" PRIMARY KEY (id);
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_pkey" PRIMARY KEY (id);
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_product_pair" UNIQUE (id, product_id);
ALTER TABLE public.products ADD CONSTRAINT "products_pkey" PRIMARY KEY (id);
ALTER TABLE public.glbd_import_batch_rows ADD CONSTRAINT "glbd_import_batch_rows_import_batch_id_fkey" FOREIGN KEY (import_batch_id) REFERENCES glbd_import_batches(id) ON DELETE CASCADE;
ALTER TABLE public.glbd_import_batch_rows ADD CONSTRAINT "glbd_import_batch_rows_status_check" CHECK ((status = ANY (ARRAY['parsed'::text, 'inserted'::text, 'updated'::text, 'unchanged'::text, 'unresolved_reference'::text, 'skipped_conflict'::text, 'failed'::text])));
ALTER TABLE public.glbd_import_batches ADD CONSTRAINT "glbd_import_batches_counts_check" CHECK ((((expected_products IS NULL) OR (expected_products >= 0)) AND ((expected_component_rows IS NULL) OR (expected_component_rows >= 0)) AND ((expected_aliases IS NULL) OR (expected_aliases >= 0)) AND ((expected_usage_rules IS NULL) OR (expected_usage_rules >= 0))));
ALTER TABLE public.glbd_import_batches ADD CONSTRAINT "glbd_import_batches_status_check" CHECK ((status = ANY (ARRAY['prepared'::text, 'dry_run_pass'::text, 'applied'::text, 'failed'::text, 'rolled_back'::text])));
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_claims_check" CHECK (((claim_fields IS NULL) OR (cardinality(claim_fields) > 0)));
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_confidence_check" CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_import_batch_id_fkey" FOREIGN KEY (import_batch_id) REFERENCES glbd_import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_title_check" CHECK (((source_title IS NULL) OR (btrim(source_title) <> ''::text)));
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_type_check" CHECK ((source_type = ANY (ARRAY['official_label'::text, 'official_registry'::text, 'manufacturer_site'::text, 'official_distributor'::text, 'package_source'::text, 'other'::text])));
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_url_check" CHECK (((source_url IS NULL) OR (source_url ~ '^https://'::text)));
ALTER TABLE public.glbd_product_sources ADD CONSTRAINT "glbd_product_sources_verification_check" CHECK ((verification_status = ANY (ARRAY['verified'::text, 'conflict'::text, 'expired'::text, 'blocked'::text, 'unreviewed'::text])));
ALTER TABLE public.products ADD CONSTRAINT "products_agrochem_active_ingredient_required" CHECK (((type <> ALL (ARRAY['pesticide'::text, 'fertilizer'::text])) OR (active_ingredient IS NULL) OR (btrim(active_ingredient) <> ''::text)));
ALTER TABLE public.products ADD CONSTRAINT "products_application_scope_check_v1" CHECK (((application_scope IS NULL) OR (application_scope = ANY (ARRAY['Основное внесение'::text, 'Фертигация / листовое'::text, 'Листовое'::text, 'Листовое / фертигация'::text, 'Семена / листовое'::text, 'Почвенное'::text, 'Почвенное / фертигация'::text, 'Баковая смесь'::text]))));
ALTER TABLE public.products ADD CONSTRAINT "products_category_id_fk" FOREIGN KEY (category_id) REFERENCES pesticide_categories(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.products ADD CONSTRAINT "products_crop_id_fkey" FOREIGN KEY (crop_id) REFERENCES crops(id);
ALTER TABLE public.products ADD CONSTRAINT "products_default_rate_type_check_v1" CHECK (((default_rate_type IS NULL) OR (default_rate_type = ANY (ARRAY['per_ha'::text, 'per_1000_l_solution'::text, 'per_l_water'::text, 'per_t_seed'::text, 'per_100kg_seed'::text, 'per_1000_seeds'::text, 'manual'::text])))) NOT VALID;
ALTER TABLE public.products ADD CONSTRAINT "products_fertilizer_category_id_fkey" FOREIGN KEY (fertilizer_category_id) REFERENCES fertilizer_categories(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_fertilizer_type_check_v3" CHECK (((type <> 'fertilizer'::text) OR (fertilizer_type IS NULL) OR (fertilizer_type = ANY (ARRAY['npk'::text, 'foliar'::text, 'organic'::text, 'nitrogen'::text, 'phosphorus'::text, 'potassium'::text, 'calcium'::text, 'magnesium_sulfur'::text, 'complex_macro'::text, 'micronutrient'::text, 'phosphite_systemic'::text, 'biostimulant'::text, 'organomineral'::text, 'humic_fulvic'::text, 'microbiological'::text, 'soil_conditioner'::text]))));
ALTER TABLE public.products ADD CONSTRAINT "products_formulation_id_fk" FOREIGN KEY (formulation_id) REFERENCES agrochem_formulations(id);
ALTER TABLE public.products ADD CONSTRAINT "products_glbd_import_batch_id_fkey" FOREIGN KEY (glbd_import_batch_id) REFERENCES glbd_import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_global_supplier_id_fkey" FOREIGN KEY (global_supplier_id) REFERENCES global_suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_manufacturer_id_fk" FOREIGN KEY (manufacturer_id) REFERENCES agrochem_manufacturers(id);
ALTER TABLE public.products ADD CONSTRAINT "products_master_product_id_fkey" FOREIGN KEY (master_product_id) REFERENCES products(id);
ALTER TABLE public.products ADD CONSTRAINT "products_metadata_confidence_check_v1" CHECK (((metadata_confidence IS NULL) OR (metadata_confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))) NOT VALID;
ALTER TABLE public.products ADD CONSTRAINT "products_mode_of_action_type_id_fk" FOREIGN KEY (mode_of_action_type_id) REFERENCES agrochem_mode_of_actions(id);
ALTER TABLE public.products ADD CONSTRAINT "products_name_check" CHECK ((length(TRIM(BOTH FROM name)) > 0));
ALTER TABLE public.products ADD CONSTRAINT "products_pesticide_category_check_v2" CHECK (((type <> 'pesticide'::text) OR (pesticide_category IS NULL) OR (pesticide_category = ANY (ARRAY['herbicide'::text, 'fungicide'::text, 'insecticide'::text, 'acaricide'::text, 'insectoacaricide'::text, 'seed_treatment'::text, 'desiccant'::text, 'growth_regulator'::text, 'rodenticide'::text, 'molluscicide'::text, 'biological'::text, 'other'::text, 'adjuvant'::text, 'surfactant'::text, 'water_conditioner'::text, 'pH_regulator'::text, 'drift_reduction_agent'::text, 'anti_foam'::text]))));
ALTER TABLE public.products ADD CONSTRAINT "products_physical_state_check_v1" CHECK (((physical_state IS NULL) OR (physical_state = ANY (ARRAY['liquid'::text, 'solid'::text, 'granule'::text, 'powder'::text, 'tablet'::text, 'gel'::text, 'unknown'::text])))) NOT VALID;
ALTER TABLE public.products ADD CONSTRAINT "products_product_subcategory_check_v1" CHECK (((product_type IS NULL) OR (subcategory IS NULL) OR (product_type = ANY (ARRAY['growth_regulator'::text, 'adjuvant'::text])) OR ((product_type = 'pesticide'::text) AND (subcategory = ANY (ARRAY['herbicide'::text, 'fungicide'::text, 'insecticide'::text, 'acaricide'::text, 'desiccant'::text, 'seed_treatment'::text, 'growth_regulator'::text, 'other'::text]))) OR ((product_type = 'fertilizer'::text) AND (subcategory = ANY (ARRAY['macro'::text, 'micro'::text, 'foliar'::text, 'water_soluble'::text, 'organic'::text, 'organomineral'::text, 'biostimulant'::text, 'other'::text]))) OR ((product_type = 'additive'::text) AND (subcategory = ANY (ARRAY['adjuvant'::text, 'sticker'::text, 'pH_corrector'::text, 'antifoam'::text, 'water_conditioner'::text, 'anti_salt'::text, 'other'::text]))))) NOT VALID;
ALTER TABLE public.products ADD CONSTRAINT "products_product_type_check" CHECK (((product_type IS NULL) OR (product_type = ANY (ARRAY['pesticide'::text, 'fertilizer'::text, 'additive'::text, 'growth_regulator'::text, 'adjuvant'::text]))));
ALTER TABLE public.products ADD CONSTRAINT "products_seed_reproduction_id_fkey" FOREIGN KEY (seed_reproduction_id) REFERENCES seed_reproductions(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_stock_unit_check_v1" CHECK (((stock_unit IS NULL) OR (stock_unit = ANY (ARRAY['l'::text, 'ml'::text, 'kg'::text, 'g'::text, 'pcs'::text, 'unknown'::text])))) NOT VALID;
ALTER TABLE public.products ADD CONSTRAINT "products_type_check" CHECK ((type = ANY (ARRAY['produce'::text, 'seed'::text, 'fertilizer'::text, 'pesticide'::text])));
ALTER TABLE public.products ADD CONSTRAINT "products_unit_weight_positive" CHECK (((unit_weight_kg IS NULL) OR (unit_weight_kg > (0)::numeric)));
ALTER TABLE public.products ADD CONSTRAINT "products_units_per_pack_positive" CHECK (((units_per_pack IS NULL) OR (units_per_pack > (0)::numeric)));
ALTER TABLE public.products ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT "products_variety_id_fkey" FOREIGN KEY (variety_id) REFERENCES varieties(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX ux_glbd_import_batch_rows_source ON public.glbd_import_batch_rows USING btree (import_batch_id, entity_type, source_record_id);
CREATE INDEX ix_glbd_import_batch_rows_product ON public.glbd_import_batch_rows USING btree (product_id);
CREATE UNIQUE INDEX ux_glbd_import_batches_source ON public.glbd_import_batches USING btree (source_sha256, COALESCE(source_version, ''::text));
CREATE UNIQUE INDEX ux_glbd_product_sources_identity ON public.glbd_product_sources USING btree (product_id, lower(source_url), source_type);
CREATE INDEX ix_glbd_product_sources_product ON public.glbd_product_sources USING btree (product_id);
CREATE UNIQUE INDEX ux_glbd_product_sources_record_identity ON public.glbd_product_sources USING btree (product_id, source_type, source_record_id) WHERE (source_record_id IS NOT NULL);
CREATE INDEX ix_glbd_product_sources_import_batch ON public.glbd_product_sources USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);
CREATE INDEX idx_products_user_id ON public.products USING btree (user_id);
CREATE INDEX idx_products_type ON public.products USING btree (type);
CREATE INDEX idx_products_archived ON public.products USING btree (archived);
CREATE INDEX idx_products_created_at ON public.products USING btree (created_at DESC);
CREATE INDEX idx_products_company_id ON public.products USING btree (company_id);
CREATE INDEX idx_products_type_company_id ON public.products USING btree (type, company_id);
CREATE INDEX idx_products_company_crop ON public.products USING btree (company_id, crop_id);
CREATE INDEX idx_products_company_type_mode ON public.products USING btree (company_id, type, accounting_mode);
CREATE UNIQUE INDEX ux_products_company_name_form ON public.products USING btree (company_id, lower(name), COALESCE(lower(product_form), ''::text));
CREATE INDEX idx_products_master_product_id ON public.products USING btree (master_product_id);
CREATE UNIQUE INDEX ux_products_company_master_agrochem ON public.products USING btree (company_id, master_product_id) WHERE ((company_id IS NOT NULL) AND (type = ANY (ARRAY['pesticide'::text, 'fertilizer'::text])) AND (archived = false));
CREATE INDEX idx_products_global_type_active ON public.products USING btree (type, lower(name)) WHERE ((company_id IS NULL) AND (archived = false));
CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);
CREATE UNIQUE INDEX ux_products_global_fertilizer_name_type_active ON public.products USING btree (lower(COALESCE(trade_name, name)), COALESCE(fertilizer_type, ''::text), lower(COALESCE(composition, ''::text))) WHERE ((company_id IS NULL) AND (type = 'fertilizer'::text) AND (archived = false));
CREATE INDEX idx_products_global_agrochem_search ON public.products USING btree (type, lower(COALESCE(trade_name, name)), lower(active_ingredient), lower(COALESCE(manufacturer, ''::text))) WHERE ((company_id IS NULL) AND (archived = false) AND (type = ANY (ARRAY['pesticide'::text, 'fertilizer'::text])));
CREATE INDEX idx_products_global_agrochem_filters ON public.products USING btree (type, pesticide_category, fertilizer_type, is_active) WHERE ((company_id IS NULL) AND (archived = false) AND (type = ANY (ARRAY['pesticide'::text, 'fertilizer'::text])));
CREATE INDEX idx_products_product_type ON public.products USING btree (product_type);
CREATE INDEX idx_products_manufacturer_id ON public.products USING btree (manufacturer_id);
CREATE INDEX idx_products_formulation_id ON public.products USING btree (formulation_id);
CREATE INDEX idx_products_mode_of_action_type_id ON public.products USING btree (mode_of_action_type_id);
CREATE INDEX idx_products_global_material_classification ON public.products USING btree (product_type, subcategory, category) WHERE ((company_id IS NULL) AND (archived = false));
CREATE INDEX products_seed_identity_idx ON public.products USING btree (company_id, crop_id, variety_id, seed_reproduction_id) WHERE ((archived = false) AND ((type = 'seed'::text) OR (category = 'seed'::text) OR (is_seed_material = true)));
CREATE INDEX idx_products_global_agrochem_metadata ON public.products USING btree (product_type, stock_unit, default_rate_type, physical_state) WHERE ((company_id IS NULL) AND (archived = false));
CREATE INDEX idx_products_metadata_review_required ON public.products USING btree (metadata_review_required) WHERE ((company_id IS NULL) AND (archived = false));
CREATE INDEX idx_products_global_pesticide_trade_ai_active ON public.products USING btree (lower(COALESCE(trade_name, name)), lower(active_ingredient), COALESCE(pesticide_category, ''::text)) WHERE ((company_id IS NULL) AND (type = 'pesticide'::text) AND (archived = false));
CREATE INDEX ix_products_glbd_import_batch ON public.products USING btree (glbd_import_batch_id) WHERE (glbd_import_batch_id IS NOT NULL);
CREATE UNIQUE INDEX uq_products_company_derived_identity_v1 ON public.products USING btree (company_id, derived_identity_key) WHERE (is_derived_inventory AND (company_id IS NOT NULL) AND (derived_identity_key IS NOT NULL));
CREATE INDEX idx_products_fertilizer_category_id ON public.products USING btree (fertilizer_category_id);
CREATE INDEX idx_products_global_fertilizer_application ON public.products USING btree (application_scope) WHERE ((company_id IS NULL) AND (product_type = 'fertilizer'::text) AND (archived = false));
CREATE UNIQUE INDEX ux_products_global_fertilizer_additive_identity_v1 ON public.products USING btree (product_type, private.normalize_catalog_identity_text_v1(manufacturer), private.normalize_catalog_identity_text_v1(COALESCE(trade_name, name))) WHERE ((company_id IS NULL) AND (product_type = ANY (ARRAY['fertilizer'::text, 'additive'::text])) AND (archived = false));
CREATE TABLE public.inventory_transactions(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.warehouse_issue_request_items(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id),planned_product_id uuid REFERENCES products(id),actual_product_id uuid REFERENCES products(id));
CREATE TABLE public.ticket_lines(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.stock_ledger_entries(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.processing_documents(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.container_registry(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.program_step_products(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.treatment_program_step_products(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.inventory_batches(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.operation_materials(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.field_material_consumptions(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.warehouse_transfer_documents(id uuid PRIMARY KEY,canonical_product_id uuid REFERENCES products(id));
CREATE TABLE public.warehouse_inventory_items(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.crop_care_scheme_step_materials(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.warehouse_opening_balance_lines(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.company_seed_material_identities(id uuid PRIMARY KEY,derived_product_id uuid REFERENCES products(id));
CREATE TABLE public.company_product_links(id uuid PRIMARY KEY,global_product_id uuid REFERENCES products(id));
CREATE TABLE public.weighbridge_shared_impurity_groups(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE TABLE public.weighbridge_shared_impurity_source_batches(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id));
CREATE OR REPLACE FUNCTION public.enforce_agrochem_master_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  master_row record;
begin
  if new.type not in ('pesticide', 'fertilizer') then
    return new;
  end if;

  if new.company_id is not null then
    if new.master_product_id is null then
      raise exception 'Company agrochemical must reference global master_product_id';
    end if;

    select
      id,
      type,
      name,
      active_ingredient,
      unit,
      archived,
      company_id
    into master_row
    from public.products
    where id = new.master_product_id
      and company_id is null
      and coalesce(archived, false) = false
    limit 1;

    if not found then
      raise exception 'master_product_id must point to active global agrochemical';
    end if;

    if master_row.type <> new.type then
      raise exception 'Master product type mismatch';
    end if;

    -- синхронизация базовых полей
    new.name := master_row.name;
    new.active_ingredient := coalesce(master_row.active_ingredient, new.active_ingredient, 'unknown');
    new.unit := coalesce(master_row.unit, new.unit, case when new.type = 'pesticide' then 'l' else 'kg' end);
  end if;

  -- ВАЖНО:
  -- Разрешаем только первичную установку (old null -> new not null)
  -- Запрещаем любую последующую смену master_product_id
  if tg_op = 'UPDATE' and old.company_id is not null then
    if old.master_product_id is not null
       and old.master_product_id is distinct from new.master_product_id then
      raise exception 'Company agrochemical cannot change master_product_id';
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.is_active_global_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'global_admin'
      and p.status = 'active'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.get_user_company_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  user_company_id uuid;
  user_role text;
  context_company_id uuid;
begin
  select p.company_id, p.role
    into user_company_id, user_role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.status = 'active'
  limit 1;

  if not found then
    return null;
  end if;

  if user_role = 'global_admin' then
    select c.company_id
      into context_company_id
    from public.global_admin_company_contexts c
    where c.user_id = (select auth.uid())
    limit 1;

    if context_company_id is not null then
      return context_company_id;
    end if;
  end if;

  return user_company_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_current_user_operational_read_only_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('director', 'accountant', 'legal_operator')
  );
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_crop_mix_seed_product_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.company_id is null
     or not (new.type = 'seed' or coalesce(new.is_seed_material, false))
     or new.crop_id is null
     or new.variety_id is null
     or new.seed_reproduction_id is null
     or coalesce(new.archived, false)
     or not coalesce(new.is_active, true) then
    return new;
  end if;

  update public.operation_materials material
  set product_id = new.id,
      notes = case
        when material.notes = 'seed_stock_deficit:product_not_received' then 'crop_mix_component'
        else material.notes
      end,
      updated_at = now()
  where material.company_id = new.company_id
    and material.product_id is null
    and material.material_type = 'seed'
    and material.source_mix_component_id is not null
    and material.crop_id = new.crop_id
    and material.variety_id = new.variety_id
    and material.reproduction_id = new.seed_reproduction_id;

  update public.warehouse_issue_request_items item
  set product_id = new.id,
      planned_product_id = new.id,
      actual_product_id = new.id,
      reconciliation_status = case
        when coalesce(item.issued_quantity, 0) > 0 then item.reconciliation_status
        else 'pending'
      end
  where item.company_id = new.company_id
    and item.product_id is null
    and item.material_kind = 'seed'
    and item.source_mix_component_id is not null
    and item.crop_id = new.crop_id
    and item.variety_id = new.variety_id
    and item.reproduction_id = new.seed_reproduction_id;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_current_user_director_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and pg_catalog.lower(coalesce(p.role, '')) = 'director'
      and pg_catalog.lower(coalesce(p.status, 'active')) = 'active'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_current_user_legal_operator_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'legal_operator'
      and lower(coalesce(p.status, 'active')) = 'active'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
REVOKE ALL ON FUNCTION private.is_active_global_admin() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION private.is_active_global_admin() TO authenticated,service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.products TO authenticated,service_role;
ALTER TABLE public.glbd_import_batches ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.glbd_import_batches TO authenticated,service_role;
ALTER TABLE public.glbd_import_batch_rows ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.glbd_import_batch_rows TO authenticated,service_role;
ALTER TABLE public.glbd_product_sources ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.glbd_product_sources TO authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.inventory_transactions TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.warehouse_issue_request_items TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.ticket_lines TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.stock_ledger_entries TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.processing_documents TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.container_registry TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.program_step_products TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.treatment_program_step_products TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.inventory_batches TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.operation_materials TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.field_material_consumptions TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.warehouse_transfer_documents TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.warehouse_inventory_items TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.crop_care_scheme_step_materials TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.warehouse_opening_balance_lines TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.company_seed_material_identities TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.company_product_links TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.weighbridge_shared_impurity_groups TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.weighbridge_shared_impurity_source_batches TO authenticated;
CREATE POLICY "director_read_only_insert_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_director_v1()));
CREATE POLICY "director_read_only_update_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_director_v1())) WITH CHECK ((NOT is_current_user_director_v1()));
CREATE POLICY "director_read_only_delete_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_director_v1()));
CREATE POLICY "legal_operator_read_only_insert_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "legal_operator_read_only_update_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_legal_operator_v1())) WITH CHECK ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "legal_operator_read_only_delete_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "operational_read_only_insert_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "operational_read_only_update_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_operational_read_only_v1())) WITH CHECK ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "operational_read_only_delete_v1" ON public.glbd_import_batch_rows AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "director_read_only_insert_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_director_v1()));
CREATE POLICY "director_read_only_update_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_director_v1())) WITH CHECK ((NOT is_current_user_director_v1()));
CREATE POLICY "director_read_only_delete_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_director_v1()));
CREATE POLICY "legal_operator_read_only_insert_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "legal_operator_read_only_update_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_legal_operator_v1())) WITH CHECK ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "legal_operator_read_only_delete_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "operational_read_only_insert_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "operational_read_only_update_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_operational_read_only_v1())) WITH CHECK ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "operational_read_only_delete_v1" ON public.glbd_import_batches AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "glbd_product_sources_authenticated_read" ON public.glbd_product_sources AS PERMISSIVE FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = glbd_product_sources.product_id) AND (p.company_id IS NULL))))));
CREATE POLICY "director_read_only_insert_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_director_v1()));
CREATE POLICY "director_read_only_update_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_director_v1())) WITH CHECK ((NOT is_current_user_director_v1()));
CREATE POLICY "director_read_only_delete_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_director_v1()));
CREATE POLICY "legal_operator_read_only_insert_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "legal_operator_read_only_update_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_legal_operator_v1())) WITH CHECK ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "legal_operator_read_only_delete_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "operational_read_only_insert_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "operational_read_only_update_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_operational_read_only_v1())) WITH CHECK ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "operational_read_only_delete_v1" ON public.glbd_product_sources AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "Users can read own products" ON public.products AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id IS NULL) OR (auth.uid() = user_id)));
CREATE POLICY "Users can view company products" ON public.products AS PERMISSIVE FOR SELECT TO authenticated USING ((company_id = get_user_company_id()));
CREATE POLICY "Users can insert company products" ON public.products AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((company_id = get_user_company_id()));
CREATE POLICY "Users can update company products" ON public.products AS PERMISSIVE FOR UPDATE TO authenticated USING ((company_id = get_user_company_id())) WITH CHECK ((company_id = get_user_company_id()));
CREATE POLICY "Users can delete company products" ON public.products AS PERMISSIVE FOR DELETE TO authenticated USING ((company_id = get_user_company_id()));
CREATE POLICY "Authenticated users can read active global products" ON public.products AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id IS NULL) AND (COALESCE(is_active, true) = true) AND (COALESCE(archived, false) = false)));
CREATE POLICY "Global admins can delete global products" ON public.products AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id IS NULL) AND ( SELECT private.is_active_global_admin() AS is_active_global_admin)));
CREATE POLICY "Global admins can insert global products" ON public.products AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id IS NULL) AND ( SELECT private.is_active_global_admin() AS is_active_global_admin)));
CREATE POLICY "Global admins can update global products" ON public.products AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id IS NULL) AND ( SELECT private.is_active_global_admin() AS is_active_global_admin))) WITH CHECK (((company_id IS NULL) AND ( SELECT private.is_active_global_admin() AS is_active_global_admin)));
CREATE POLICY "director_read_only_insert_v1" ON public.products AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_director_v1()));
CREATE POLICY "director_read_only_update_v1" ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_director_v1())) WITH CHECK ((NOT is_current_user_director_v1()));
CREATE POLICY "director_read_only_delete_v1" ON public.products AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_director_v1()));
CREATE POLICY "legal_operator_read_only_insert_v1" ON public.products AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "legal_operator_read_only_update_v1" ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_legal_operator_v1())) WITH CHECK ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "legal_operator_read_only_delete_v1" ON public.products AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_legal_operator_v1()));
CREATE POLICY "operational_read_only_insert_v1" ON public.products AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "operational_read_only_update_v1" ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_current_user_operational_read_only_v1())) WITH CHECK ((NOT is_current_user_operational_read_only_v1()));
CREATE POLICY "operational_read_only_delete_v1" ON public.products AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_current_user_operational_read_only_v1()));
CREATE TRIGGER trg_glbd_import_batches_updated_at BEFORE UPDATE ON public.glbd_import_batches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_glbd_product_sources_updated_at BEFORE UPDATE ON public.glbd_product_sources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_enforce_agrochem_master_only BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION enforce_agrochem_master_only();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION ensure_updated_at_column();
CREATE TRIGGER reconcile_crop_mix_seed_product_v1 AFTER INSERT OR UPDATE OF company_id, type, is_seed_material, crop_id, variety_id, seed_reproduction_id, archived, is_active ON public.products FOR EACH ROW EXECUTE FUNCTION reconcile_crop_mix_seed_product_v1();
