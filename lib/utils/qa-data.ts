export function hasQaDataMarker(value: unknown): boolean {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  return /qa[_\s-]*test(?:[_\s-]*\d{4})?/i.test(text) || text.includes("qa_test") || text.includes("qacodex");
}

export function rowHasQaDataMarker(row: Record<string, unknown>, keys?: string[]): boolean {
  const values = keys?.length ? keys.map((key) => row[key]) : Object.values(row);
  return values.some(hasQaDataMarker);
}

export function filterProductionRows<T extends Record<string, unknown>>(rows: T[], keys?: string[]): T[] {
  return rows.filter((row) => !rowHasQaDataMarker(row, keys));
}
