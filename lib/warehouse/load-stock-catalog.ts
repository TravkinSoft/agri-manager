/** Preserve the existing catalog scope without PostgREST's default first-page truncation.
 * The caller's JWT/RLS, active/archive rules and identity hydration stay unchanged.
 * Never return a partial catalog as a successful warehouse balance response.
 */
export async function loadWarehouseStockCatalog(
  supabase: any,
  select: string,
  companyId: string,
  referencedProductIds?: string[]
) {
  const rows: any[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from("products").select(select)
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .eq("archived", false)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (referencedProductIds) {
      const ids = referencedProductIds.join(",");
      query = query.or(`company_id.eq.${companyId},id.in.(${ids}),master_product_id.in.(${ids})`);
    }
    const result = await query;
    if (result.error) return { data: null, error: result.error };
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
