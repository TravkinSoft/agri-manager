
-- HQ6 catalogue extension. No backfill, old-row updates or publication.
-- Apply only after actor/channel, metadata snapshot and privilege gates pass.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';
ALTER TABLE public.products ADD COLUMN catalog_publication_status text;
ALTER TABLE public.products DROP CONSTRAINT products_type_check;
ALTER TABLE public.products ADD CONSTRAINT products_type_check CHECK (type IN ('produce','seed','pesticide','fertilizer','spare_part','technical_fluid','maintenance_material'));
ALTER TABLE public.products ALTER COLUMN user_id DROP NOT NULL, ALTER COLUMN unit DROP NOT NULL, ALTER COLUMN base_uom DROP NOT NULL;
ALTER TABLE public.products ADD CONSTRAINT catalog_hq6_shape CHECK ((
 (type IN ('produce','seed','pesticide','fertilizer') AND user_id IS NOT NULL AND unit IS NOT NULL AND base_uom IS NOT NULL AND accounting_mode IN ('bulk_mass','unit_with_weight','package_count') AND catalog_publication_status IS NULL)
 OR (type IN ('spare_part','technical_fluid','maintenance_material') AND company_id IS NULL AND user_id IS NULL AND unit IS NULL AND base_uom IS NULL AND stock_unit IS NULL AND accounting_mode='catalog_only'
 AND NOT is_seed_material AND NOT is_derived_inventory AND master_product_id IS NULL AND crop_id IS NULL AND variety_id IS NULL AND seed_reproduction_id IS NULL
 AND product_type IS NULL AND category_id IS NULL AND manufacturer_id IS NULL AND fertilizer_category_id IS NULL AND formulation_id IS NULL AND mode_of_action_type_id IS NULL
 AND pack_uom IS NULL AND unit_weight_kg IS NULL AND units_per_pack IS NULL AND package_size IS NULL AND package_unit IS NULL AND default_unit IS NULL AND density_kg_per_l IS NULL
 AND catalog_publication_status IN ('draft','published','retired')
 AND (catalog_publication_status='published' OR (is_active=false AND requires_review=true AND metadata_review_required=true)))
) IS TRUE);

CREATE TABLE public.catalog_categories (
 id uuid PRIMARY KEY, code text UNIQUE NOT NULL, name_ru text NOT NULL, name_en text,
 parent_id uuid REFERENCES public.catalog_categories(id), search_aliases text[] NOT NULL DEFAULT '{}',
 editorial_revision text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retired'))
);
CREATE TABLE public.catalog_manufacturers (
 id uuid PRIMARY KEY, manufacturer_key text UNIQUE NOT NULL CHECK(manufacturer_key<>''), display_name text NOT NULL,
 verification_status text NOT NULL CHECK(verification_status='verified_primary_identity'), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retired'))
);
CREATE TABLE public.product_catalog_details (
 product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE RESTRICT,
 catalog_category_id uuid NOT NULL REFERENCES public.catalog_categories(id), catalog_manufacturer_id uuid NOT NULL REFERENCES public.catalog_manufacturers(id),
 catalog_kind text NOT NULL CHECK(catalog_kind IN ('spare_part','technical_fluid','maintenance_material')),
 identity_kind text NOT NULL CHECK(identity_kind IN ('mpn','designation')),
 mpn_exact text, designation_exact text, grade_exact text, variant_exact text,
 mpn_key text GENERATED ALWAYS AS (coalesce(mpn_exact,'')) STORED,
 designation_key text GENERATED ALWAYS AS (coalesce(designation_exact,'')) STORED,
 grade_key text GENERATED ALWAYS AS (coalesce(grade_exact,'')) STORED,
 variant_key text GENERATED ALWAYS AS (coalesce(variant_exact,'')) STORED,
 gaps jsonb NOT NULL, provenance jsonb NOT NULL,
 search_ru tsvector NOT NULL, search_simple tsvector NOT NULL,
 CHECK((identity_kind='mpn' AND coalesce(mpn_exact,'')<>'' OR identity_kind='designation' AND coalesce(designation_exact,'')<>'') IS TRUE),
 CHECK(mpn_exact IS NULL OR mpn_exact=normalize(mpn_exact,NFC)),
 CHECK(designation_exact IS NULL OR designation_exact=normalize(designation_exact,NFC)),
 CHECK(grade_exact IS NULL OR grade_exact=normalize(grade_exact,NFC)),
 CHECK(variant_exact IS NULL OR variant_exact=normalize(variant_exact,NFC))
);
CREATE UNIQUE INDEX catalog_hq6_mpn_identity ON public.product_catalog_details(catalog_manufacturer_id,mpn_key,variant_key) WHERE identity_kind='mpn';
CREATE UNIQUE INDEX catalog_hq6_designation_identity ON public.product_catalog_details(catalog_manufacturer_id,designation_key,grade_key,variant_key) WHERE identity_kind='designation';
CREATE INDEX catalog_hq6_category_idx ON public.product_catalog_details(catalog_category_id);
CREATE INDEX catalog_hq6_search_ru ON public.product_catalog_details USING gin(search_ru);
CREATE INDEX catalog_hq6_search_simple ON public.product_catalog_details USING gin(search_simple);
CREATE INDEX catalog_hq6_exact_mpn ON public.product_catalog_details(mpn_key,product_id);

ALTER TABLE public.glbd_import_batches ADD COLUMN actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 ADD COLUMN actor_context jsonb, ADD COLUMN catalog_namespace text;
CREATE UNIQUE INDEX catalog_hq6_batch_logical ON public.glbd_import_batches(source_package,source_version) WHERE catalog_namespace='HQ6-4437-v1';
ALTER TABLE public.glbd_import_batches ADD CONSTRAINT catalog_hq6_batch_context CHECK(catalog_namespace IS NULL OR (catalog_namespace='HQ6-4437-v1' AND actor_context IS NOT NULL AND source_version IS NOT NULL));
ALTER TABLE public.glbd_import_batch_rows ADD COLUMN rollback_payload jsonb, ADD COLUMN before_fingerprint text, ADD COLUMN after_fingerprint text;
CREATE TABLE public.product_evidence_claims (
 id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
 field_path text NOT NULL CHECK(field_path<>''), value_jsonb jsonb NOT NULL CHECK(value_jsonb<>'null'::jsonb), unit text, conditions_jsonb jsonb,
 source_id uuid NOT NULL, locator text NOT NULL CHECK(locator<>''), fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1), verification_status text NOT NULL CHECK(verification_status='verified'),
 checked_at timestamptz NOT NULL, import_batch_row_id uuid NOT NULL REFERENCES public.glbd_import_batch_rows(id) ON DELETE RESTRICT,
 FOREIGN KEY(source_id,product_id) REFERENCES public.glbd_product_sources(id,product_id) ON DELETE RESTRICT,
 UNIQUE(product_id,field_path,source_id,fingerprint,locator)
);
CREATE INDEX catalog_hq6_claim_source ON public.product_evidence_claims(source_id,product_id);
CREATE INDEX catalog_hq6_claim_batch ON public.product_evidence_claims(import_batch_row_id);

CREATE POLICY catalog_hq6_read ON public.products AS RESTRICTIVE FOR SELECT TO authenticated USING (
 type NOT IN ('spare_part','technical_fluid','maintenance_material') OR
 (select private.is_active_global_admin()) OR (catalog_publication_status='published' AND is_active AND NOT coalesce(archived,true) AND NOT requires_review AND NOT metadata_review_required));
CREATE POLICY catalog_hq6_insert ON public.products AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
 type NOT IN ('spare_part','technical_fluid','maintenance_material') OR ((select private.is_active_global_admin()) AND company_id IS NULL AND catalog_publication_status='draft'));
CREATE POLICY catalog_hq6_update ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated USING (
 type NOT IN ('spare_part','technical_fluid','maintenance_material') OR ((select private.is_active_global_admin()) AND company_id IS NULL AND catalog_publication_status IN ('draft','retired')))
 WITH CHECK(type NOT IN ('spare_part','technical_fluid','maintenance_material') OR ((select private.is_active_global_admin()) AND company_id IS NULL AND catalog_publication_status IN ('draft','retired')));
CREATE POLICY catalog_hq6_no_delete ON public.products AS RESTRICTIVE FOR DELETE TO authenticated USING(type NOT IN ('spare_part','technical_fluid','maintenance_material'));
CREATE POLICY catalog_hq6_sources_parent ON public.glbd_product_sources AS RESTRICTIVE FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id));

-- Integrity invariant: deferred so product/details may be inserted in one transaction.
CREATE FUNCTION private.catalog_hq6_integrity() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE pid uuid; p public.products; d public.product_catalog_details;
BEGIN
 IF TG_TABLE_NAME='products' THEN pid:=coalesce(NEW.id,OLD.id); ELSE pid:=coalesce(NEW.product_id,OLD.product_id); END IF;
 SELECT * INTO p FROM public.products WHERE id=pid;
 SELECT * INTO d FROM public.product_catalog_details WHERE product_id=pid;
 IF p.type IN ('spare_part','technical_fluid','maintenance_material') AND (d.product_id IS NULL OR d.catalog_kind IS DISTINCT FROM p.type OR p.company_id IS NOT NULL) THEN RAISE EXCEPTION 'catalog_details_integrity'; END IF;
 IF d.product_id IS NOT NULL AND (p.id IS NULL OR p.type NOT IN ('spare_part','technical_fluid','maintenance_material') OR p.type IS DISTINCT FROM d.catalog_kind) THEN RAISE EXCEPTION 'catalog_parent_integrity'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.catalog_hq6_integrity() FROM PUBLIC,anon,authenticated;
CREATE CONSTRAINT TRIGGER catalog_hq6_product_integrity AFTER INSERT OR UPDATE ON public.products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_integrity();
CREATE CONSTRAINT TRIGGER catalog_hq6_detail_integrity AFTER INSERT OR UPDATE OR DELETE ON public.product_catalog_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_integrity();

-- Internal referential guard must see a hidden draft even when caller RLS hides it.
-- Not an RPC: no EXECUTE grants. It only rejects new catalogue business links.
CREATE FUNCTION private.catalog_hq6_no_business_reference() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid;
BEGIN
 pid:=nullif(to_jsonb(NEW)->>TG_ARGV[0],'')::uuid;
 IF EXISTS(SELECT 1 FROM public.products WHERE id=pid AND type IN ('spare_part','technical_fluid','maintenance_material')) THEN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'catalog_only_not_business_product'; END IF;
  RAISE EXCEPTION 'catalog_only_not_business_product';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.catalog_hq6_no_business_reference() FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_categories FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.catalog_categories TO authenticated;
CREATE POLICY catalog_hq6_admin_read ON public.catalog_categories FOR SELECT TO authenticated USING ((select private.is_active_global_admin()) AND true);
CREATE POLICY catalog_hq6_admin_insert ON public.catalog_categories FOR INSERT TO authenticated WITH CHECK ((select private.is_active_global_admin()) AND true);
CREATE POLICY catalog_hq6_admin_update ON public.catalog_categories FOR UPDATE TO authenticated USING ((select private.is_active_global_admin()) AND true) WITH CHECK ((select private.is_active_global_admin()) AND true);

ALTER TABLE public.catalog_manufacturers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_manufacturers FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.catalog_manufacturers TO authenticated;
CREATE POLICY catalog_hq6_admin_read ON public.catalog_manufacturers FOR SELECT TO authenticated USING ((select private.is_active_global_admin()) AND true);
CREATE POLICY catalog_hq6_admin_insert ON public.catalog_manufacturers FOR INSERT TO authenticated WITH CHECK ((select private.is_active_global_admin()) AND true);
CREATE POLICY catalog_hq6_admin_update ON public.catalog_manufacturers FOR UPDATE TO authenticated USING ((select private.is_active_global_admin()) AND true) WITH CHECK ((select private.is_active_global_admin()) AND true);

ALTER TABLE public.product_catalog_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_catalog_details FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.product_catalog_details TO authenticated;
CREATE POLICY catalog_hq6_admin_read ON public.product_catalog_details FOR SELECT TO authenticated USING ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id));
CREATE POLICY catalog_hq6_admin_insert ON public.product_catalog_details FOR INSERT TO authenticated WITH CHECK ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id));
CREATE POLICY catalog_hq6_admin_update ON public.product_catalog_details FOR UPDATE TO authenticated USING ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id)) WITH CHECK ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id));

ALTER TABLE public.product_evidence_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_evidence_claims FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.product_evidence_claims TO authenticated;
CREATE POLICY catalog_hq6_admin_read ON public.product_evidence_claims FOR SELECT TO authenticated USING ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id));
CREATE POLICY catalog_hq6_admin_insert ON public.product_evidence_claims FOR INSERT TO authenticated WITH CHECK ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id));
CREATE POLICY catalog_hq6_admin_update ON public.product_evidence_claims FOR UPDATE TO authenticated USING ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id)) WITH CHECK ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id));
CREATE POLICY catalog_hq6_admin_journal ON public.glbd_import_batches FOR ALL TO authenticated USING ((select private.is_active_global_admin()) AND catalog_namespace='HQ6-4437-v1') WITH CHECK ((select private.is_active_global_admin()) AND catalog_namespace='HQ6-4437-v1');
CREATE POLICY catalog_hq6_admin_journal ON public.glbd_import_batch_rows FOR ALL TO authenticated USING ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.glbd_import_batches b WHERE b.id=import_batch_id AND b.catalog_namespace='HQ6-4437-v1')) WITH CHECK ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.glbd_import_batches b WHERE b.id=import_batch_id AND b.catalog_namespace='HQ6-4437-v1'));

CREATE POLICY catalog_hq6_sources_write ON public.glbd_product_sources FOR ALL TO authenticated USING ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id AND p.type IN ('spare_part','technical_fluid','maintenance_material') AND p.catalog_publication_status IN ('draft','retired'))) WITH CHECK ((select private.is_active_global_admin()) AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id AND p.type IN ('spare_part','technical_fluid','maintenance_material') AND p.catalog_publication_status IN ('draft','retired')));
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.inventory_transactions FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.warehouse_issue_request_items FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.ticket_lines FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.stock_ledger_entries FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.processing_documents FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.container_registry FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_master_product_id BEFORE INSERT OR UPDATE OF master_product_id ON public.products FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('master_product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.program_step_products FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.treatment_program_step_products FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.inventory_batches FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.operation_materials FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.field_material_consumptions FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_canonical_product_id BEFORE INSERT OR UPDATE OF canonical_product_id ON public.warehouse_transfer_documents FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('canonical_product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.warehouse_inventory_items FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.crop_care_scheme_step_materials FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.warehouse_opening_balance_lines FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_planned_product_id BEFORE INSERT OR UPDATE OF planned_product_id ON public.warehouse_issue_request_items FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('planned_product_id');
CREATE TRIGGER catalog_hq6_guard_actual_product_id BEFORE INSERT OR UPDATE OF actual_product_id ON public.warehouse_issue_request_items FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('actual_product_id');
CREATE TRIGGER catalog_hq6_guard_derived_product_id BEFORE INSERT OR UPDATE OF derived_product_id ON public.company_seed_material_identities FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('derived_product_id');
CREATE TRIGGER catalog_hq6_guard_global_product_id BEFORE INSERT OR UPDATE OF global_product_id ON public.company_product_links FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('global_product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.weighbridge_shared_impurity_groups FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');
CREATE TRIGGER catalog_hq6_guard_product_id BEFORE INSERT OR UPDATE OF product_id ON public.weighbridge_shared_impurity_source_batches FOR EACH ROW EXECUTE FUNCTION private.catalog_hq6_no_business_reference('product_id');

CREATE FUNCTION public.catalog_hq6_fingerprint(pid uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
 'product',(SELECT to_jsonb(p) FROM public.products p WHERE p.id=pid),
 'details',(SELECT to_jsonb(d) FROM public.product_catalog_details d WHERE d.product_id=pid),
 'sources',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.glbd_product_sources s WHERE s.product_id=pid),
 'claims',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.product_evidence_claims c WHERE c.product_id=pid)
 )::text,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION public.catalog_hq6_fingerprint(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.catalog_hq6_fingerprint(uuid) TO authenticated;

CREATE FUNCTION public.catalog_hq6_import_part(p_package text,p_version text,p_digest text,p_payload text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='30s' SET lock_timeout='3s' AS $$
DECLARE b public.glbd_import_batches; r jsonb; s jsonb; a jsonb; pid uuid; rid uuid; payload jsonb; n integer:=0; claim_count integer:=0; actual text; search_text text;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='global_admin' AND status='active') THEN RAISE EXCEPTION 'active_global_admin_required' USING ERRCODE='42501'; END IF;
 IF p_package !~ '^TF_PARTS_HQ6_4437/part-[0-9]{3}$' OR p_version<>'2' OR p_digest !~ '^[0-9a-f]{64}$' OR octet_length(p_payload)>900000 THEN RAISE EXCEPTION 'invalid_package'; END IF;
 IF encode(sha256(convert_to(p_payload,'UTF8')),'hex')<>p_digest THEN RAISE EXCEPTION 'payload_digest_mismatch'; END IF;
 payload:=p_payload::jsonb;
 IF jsonb_typeof(payload->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'records') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_records'; END IF;
 SELECT coalesce(sum(jsonb_array_length(x->'claims')),0) INTO claim_count FROM jsonb_array_elements(payload->'records') x;
 IF claim_count>10000 THEN RAISE EXCEPTION 'claim_limit'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_package||':'||p_version,0));
 SELECT * INTO b FROM public.glbd_import_batches WHERE source_package=p_package AND source_version=p_version FOR UPDATE;
 IF b.id IS NOT NULL THEN
  IF b.catalog_namespace IS DISTINCT FROM 'HQ6-4437-v1' OR b.source_sha256<>p_digest THEN RAISE EXCEPTION 'logical_version_digest_conflict'; END IF;
  IF b.status<>'applied' THEN RAISE EXCEPTION 'batch_not_applied_manual_review'; END IF;
  IF EXISTS(SELECT 1 FROM public.glbd_import_batch_rows x WHERE x.import_batch_id=b.id AND x.after_fingerprint IS DISTINCT FROM public.catalog_hq6_fingerprint(x.product_id)) THEN RAISE EXCEPTION 'post_import_edit_conflict'; END IF;
  RETURN jsonb_build_object('status','unchanged','batch_id',b.id,'inserted',0,'products',b.expected_products);
 END IF;
 INSERT INTO public.glbd_import_batches(source_package,source_file_name,source_version,source_sha256,status,expected_products,manifest,actor_user_id,actor_context,catalog_namespace)
 VALUES(p_package,'accepted-part.json',p_version,p_digest,'prepared',jsonb_array_length(payload->'records'),jsonb_build_object('claims',claim_count,'contract','HQ6-4437-v1'),auth.uid(),jsonb_build_object('channel','authenticated_rpc','role','global_admin','at',clock_timestamp()),'HQ6-4437-v1') RETURNING * INTO b;
 FOR r IN SELECT value FROM jsonb_array_elements(payload->'records') LOOP
  pid:=(r->>'id')::uuid;
  IF r->>'type' NOT IN ('spare_part','technical_fluid','maintenance_material') OR coalesce(r->>'name','')='' OR coalesce(r->>'research_id','')='' THEN RAISE EXCEPTION 'invalid_catalog_record'; END IF;
  IF EXISTS(SELECT 1 FROM public.products WHERE id=pid) THEN RAISE EXCEPTION 'target_id_exists_requires_review'; END IF;
  INSERT INTO public.catalog_categories(id,code,name_ru,search_aliases,editorial_revision)
  VALUES((r#>>'{category,id}')::uuid,r#>>'{category,code}',r#>>'{category,name_ru}',ARRAY(SELECT jsonb_array_elements_text(r#>'{category,aliases}')),r#>>'{category,revision}') ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.catalog_categories WHERE id=(r#>>'{category,id}')::uuid AND code=r#>>'{category,code}' AND name_ru=r#>>'{category,name_ru}' AND search_aliases=ARRAY(SELECT jsonb_array_elements_text(r#>'{category,aliases}')) AND editorial_revision=r#>>'{category,revision}') THEN RAISE EXCEPTION 'category_definition_conflict'; END IF;
  INSERT INTO public.catalog_manufacturers(id,manufacturer_key,display_name,verification_status)
  VALUES((r#>>'{manufacturer,id}')::uuid,r#>>'{manufacturer,key}',r#>>'{manufacturer,name}','verified_primary_identity') ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.catalog_manufacturers WHERE id=(r#>>'{manufacturer,id}')::uuid AND manufacturer_key=r#>>'{manufacturer,key}' AND display_name=r#>>'{manufacturer,name}') THEN RAISE EXCEPTION 'manufacturer_definition_conflict'; END IF;
  INSERT INTO public.products(id,name,name_ru,type,company_id,user_id,unit,base_uom,stock_unit,accounting_mode,is_active,archived,requires_review,metadata_review_required,is_seed_material,is_derived_inventory,catalog_publication_status,glbd_import_batch_id)
  VALUES(pid,r->>'name',r->>'name',r->>'type',NULL,NULL,NULL,NULL,NULL,'catalog_only',false,false,true,true,false,false,'draft',b.id);
  search_text:=concat_ws(' ',r->>'name',r#>>'{manufacturer,name}',r#>>'{identity,mpn}',r#>>'{identity,designation}',r#>>'{identity,grade}',r#>>'{category,name_ru}',array_to_string(ARRAY(SELECT jsonb_array_elements_text(r#>'{category,aliases}')),' '));
  INSERT INTO public.product_catalog_details(product_id,catalog_category_id,catalog_manufacturer_id,catalog_kind,identity_kind,mpn_exact,designation_exact,grade_exact,variant_exact,gaps,provenance,search_ru,search_simple)
  VALUES(pid,(r#>>'{category,id}')::uuid,(r#>>'{manufacturer,id}')::uuid,r->>'type',r#>>'{identity,kind}',r#>>'{identity,mpn}',r#>>'{identity,designation}',r#>>'{identity,grade}',r#>>'{identity,variant}',r->'gaps',r->'provenance',to_tsvector('russian',search_text),to_tsvector('simple',search_text));
  INSERT INTO public.glbd_import_batch_rows(import_batch_id,entity_type,source_record_id,product_id,status,source_payload,normalized_payload,rollback_payload)
  VALUES(b.id,'product',r->>'research_id',pid,'inserted',r,jsonb_build_object('product_id',pid,'type',r->>'type'),jsonb_build_object('action','retire_only','created_product_id',pid)) RETURNING id INTO rid;
  FOR s IN SELECT value FROM jsonb_array_elements(r->'sources') LOOP
   INSERT INTO public.glbd_product_sources(id,product_id,source_type,source_url,source_title,checked_on,verification_status,source_metadata_raw,import_batch_id)
   VALUES((s->>'id')::uuid,pid,'manufacturer_site',s->>'url',s->>'title',(s->>'checked_at')::timestamptz::date,'verified',jsonb_build_object('source',s->'metadata','checked_at',s->>'checked_at','fingerprint',s->>'fingerprint'),b.id);
  END LOOP;
  FOR a IN SELECT value FROM jsonb_array_elements(r->'claims') LOOP
   INSERT INTO public.product_evidence_claims(id,product_id,field_path,value_jsonb,unit,conditions_jsonb,source_id,locator,fingerprint,verification_status,checked_at,import_batch_row_id)
   VALUES((a->>'id')::uuid,pid,a->>'field_path',a->'value',a->>'unit',a->'conditions',(a->>'source_id')::uuid,a->>'locator',a->>'fingerprint','verified',(a->>'checked_at')::timestamptz,rid);
  END LOOP;
  actual:=public.catalog_hq6_fingerprint(pid);
  UPDATE public.glbd_import_batch_rows SET after_fingerprint=actual WHERE id=rid;
  n:=n+1;
 END LOOP;
 SET CONSTRAINTS ALL IMMEDIATE;
 UPDATE public.glbd_import_batches SET status='applied' WHERE id=b.id;
 RETURN jsonb_build_object('status','applied','batch_id',b.id,'inserted',n,'claims',claim_count);
END $$;
REVOKE ALL ON FUNCTION public.catalog_hq6_import_part(text,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.catalog_hq6_import_part(text,text,text,text) TO authenticated;

CREATE FUNCTION public.catalog_hq6_retire_batch(p_batch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='3s' SET statement_timeout='30s' AS $$
DECLARE b public.glbd_import_batches; r record; n integer:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='global_admin' AND status='active') THEN RAISE EXCEPTION 'active_global_admin_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.glbd_import_batches WHERE id=p_batch AND catalog_namespace='HQ6-4437-v1' FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'batch_not_found'; END IF;
 IF b.status='rolled_back' THEN RETURN jsonb_build_object('status','unchanged','retired',0); END IF;
 IF b.status<>'applied' THEN RAISE EXCEPTION 'batch_state_conflict'; END IF;
 FOR r IN SELECT * FROM public.glbd_import_batch_rows WHERE import_batch_id=b.id ORDER BY id DESC LOOP
  PERFORM 1 FROM public.products WHERE id=r.product_id FOR UPDATE;
  IF r.after_fingerprint IS DISTINCT FROM public.catalog_hq6_fingerprint(r.product_id) THEN RAISE EXCEPTION 'rollback_edit_conflict'; END IF;
  UPDATE public.products SET catalog_publication_status='retired',is_active=false WHERE id=r.product_id AND catalog_publication_status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'rollback_state_conflict'; END IF;
  UPDATE public.glbd_import_batch_rows SET after_fingerprint=public.catalog_hq6_fingerprint(r.product_id),rollback_payload=rollback_payload||jsonb_build_object('retired_at',clock_timestamp()) WHERE id=r.id;
  n:=n+1;
 END LOOP;
 UPDATE public.glbd_import_batches SET status='rolled_back' WHERE id=b.id;
 RETURN jsonb_build_object('status','rolled_back','retired',n);
END $$;
REVOKE ALL ON FUNCTION public.catalog_hq6_retire_batch(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.catalog_hq6_retire_batch(uuid) TO authenticated;
