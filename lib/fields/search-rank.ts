export function fieldSearchRank(name: string, query: string): number {
  const value = name.trim().toLocaleLowerCase("ru").replace(/^поле\s*№?\s*/u, "");
  const q = query.trim().toLocaleLowerCase("ru");
  if (!q) return 0;
  if (value === q) return 0;
  if (/^\d+$/u.test(q) && value.match(/^\d+/u)?.[0] === q) return 1;
  return value.startsWith(q) ? 2 : 3;
}
