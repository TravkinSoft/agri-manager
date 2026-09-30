export const SUPABASE_QUERY_CHUNK_SIZE = 100;
export const SUPABASE_QUERY_PAGE_SIZE = 500;

export type SupabaseQueryResult<T> = { data: T[] | null; error: any };

export async function loadSupabasePages<T>(buildQuery: () => any): Promise<SupabaseQueryResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += SUPABASE_QUERY_PAGE_SIZE) {
    const result = await buildQuery().range(from, from + SUPABASE_QUERY_PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };
    const page = (result.data || []) as T[];
    rows.push(...page);
    if (page.length < SUPABASE_QUERY_PAGE_SIZE) return { data: rows, error: null };
  }
}

export async function loadSupabaseInChunks<T>(
  ids: string[],
  buildQuery: (chunk: string[]) => any,
): Promise<SupabaseQueryResult<T>> {
  const normalized = Array.from(new Set(ids.filter(Boolean)));
  if (!normalized.length) return { data: [], error: null };

  const rows: T[] = [];
  for (let index = 0; index < normalized.length; index += SUPABASE_QUERY_CHUNK_SIZE) {
    const chunk = normalized.slice(index, index + SUPABASE_QUERY_CHUNK_SIZE);
    const result = await loadSupabasePages<T>(() => buildQuery(chunk));
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data || []));
  }
  return { data: rows, error: null };
}
