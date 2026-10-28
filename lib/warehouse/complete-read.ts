type PageResult<T> = { data: T[] | null; error: any };

/** Never return a successful partial stock balance after a later page fails.
 * Callers must supply a stable, unique ordering and retain their company/JWT filters.
 */
export async function readCompleteStockRows<T = any>(
  read: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const page = await read(from, from + size - 1);
    if (page.error) return { data: null, error: page.error };
    if (!Array.isArray(page.data)) return { data: null, error: { message: "Не получена полная страница складских данных" } };
    rows.push(...page.data);
    if (page.data.length < size) return { data: rows, error: null };
  }
}
