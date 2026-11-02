-- READ ONLY. Run under a real active Global Admin session or an explicitly identified admin audit channel.
-- Successful admin audit is NOT a substitute for ordinary-user E2E.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT count(*) AS batches, count(*) FILTER(WHERE status='applied') AS applied,
 sum(expected_products) AS expected_products FROM public.glbd_import_batches WHERE catalog_namespace='HQ6-4437-v1';
-- Expected: 61 / 61 / 4437.
SELECT count(*) AS journal_rows, count(*) FILTER(WHERE after_fingerprint IS DISTINCT FROM public.catalog_hq6_fingerprint(product_id)) AS drift
FROM public.glbd_import_batch_rows WHERE import_batch_id IN(SELECT id FROM public.glbd_import_batches WHERE catalog_namespace='HQ6-4437-v1');
-- Expected: 4437 / 0; fingerprint call requires existing actor visibility.
SELECT count(*) AS products,count(*) FILTER(WHERE catalog_publication_status<>'draft' OR is_active OR NOT requires_review OR NOT metadata_review_required OR company_id IS NOT NULL OR user_id IS NOT NULL OR unit IS NOT NULL OR base_uom IS NOT NULL OR stock_unit IS NOT NULL) AS invalid
FROM public.products WHERE type IN ('spare_part','technical_fluid','maintenance_material');
-- Expected: 4437 / 0. Also compare all exact ID checksums below.
SELECT count(*) AS products_count, md5(string_agg(id::text,',' ORDER BY id::text))='a24055f722d07e1638cf5363ad1063ef' AS exact_id_set_matches FROM public.products WHERE type IN ('spare_part','technical_fluid','maintenance_material');
SELECT count(*) AS sources_count, md5(string_agg(id::text,',' ORDER BY id::text))='26f6324a65d1dfa1dd0177aa1f3955a8' AS exact_id_set_matches FROM public.glbd_product_sources WHERE import_batch_id IN (SELECT id FROM public.glbd_import_batches WHERE catalog_namespace='HQ6-4437-v1');
SELECT count(*) AS claims_count, md5(string_agg(id::text,',' ORDER BY id::text))='39e5f35e3dda7aa89e63cd0a2b1efdea' AS exact_id_set_matches FROM public.product_evidence_claims WHERE import_batch_row_id IN (SELECT r.id FROM public.glbd_import_batch_rows r JOIN public.glbd_import_batches b ON b.id=r.import_batch_id WHERE b.catalog_namespace='HQ6-4437-v1');
SELECT count(*) AS missing_details FROM public.products p LEFT JOIN public.product_catalog_details d ON d.product_id=p.id WHERE p.type IN ('spare_part','technical_fluid','maintenance_material') AND d.product_id IS NULL;
-- Refresh/store the legacy fingerprint immediately BEFORE release; compare after excluding the added nullable column.
SELECT count(*), md5(string_agg((to_jsonb(p)-'catalog_publication_status')::text,'' ORDER BY id)) AS legacy_fingerprint FROM public.products p WHERE type IN ('produce','seed','fertilizer','pesticide');
COMMIT;
