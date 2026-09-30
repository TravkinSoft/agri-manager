/** Keep decimal input independent of the browser/keyboard locale. */
export function parseHectaresInput(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // Database precision is 0.001 ha. Never silently truncate or coerce empty input to zero.
  if (!/^(?:\d+(?:[.,]\d{1,3})?|[.,]\d{1,3})$/.test(text)) return null;
  const hectares = Number(text.replace(",", "."));
  return Number.isFinite(hectares) && hectares >= 0 && hectares <= 1_000_000 ? hectares : null;
}
