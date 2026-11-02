-- Phase 1: user-scoped catalogue search. Draft details stay Global Admin only.
CREATE FUNCTION public.catalog_hq6_search(p_query text DEFAULT '',p_limit integer DEFAULT 30,p_after_exact boolean DEFAULT NULL,p_after_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid,name text,product_type text,mpn text,designation text,manufacturer text,category text,publication_status text,is_exact boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH hits AS (
 SELECT p.id AS product_id,p.name,p.type AS product_type,d.mpn_exact AS mpn,d.designation_exact AS designation,m.display_name AS manufacturer,c.name_ru AS category,p.catalog_publication_status AS publication_status,
 (d.mpn_key=p_query OR d.designation_key=p_query) AND p_query<>'' AS is_exact
 FROM public.product_catalog_details d JOIN public.products p ON p.id=d.product_id
 JOIN public.catalog_categories c ON c.id=d.catalog_category_id
 JOIN public.catalog_manufacturers m ON m.id=d.catalog_manufacturer_id
 WHERE length(p_query)<=120 AND p.catalog_publication_status<>'retired'
 AND (p_query='' OR d.mpn_key=p_query OR d.designation_key=p_query OR d.search_ru@@plainto_tsquery('russian',p_query) OR d.search_simple@@plainto_tsquery('simple',p_query))
 ) SELECT * FROM hits h
 WHERE p_after_id IS NULL OR (p_after_exact IS NOT NULL AND (h.is_exact<p_after_exact OR (h.is_exact=p_after_exact AND h.product_id>p_after_id)))
 ORDER BY h.is_exact DESC,h.product_id LIMIT greatest(1,least(coalesce(p_limit,30),100));
$$;
REVOKE ALL ON FUNCTION public.catalog_hq6_search(text,integer,boolean,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.catalog_hq6_search(text,integer,boolean,uuid) TO authenticated;
