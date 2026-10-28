export type ScanSelection = { product_id: string; barcode: string | null };
export type ScanResult<T> =
  | { status: "found" | "repeated"; item: T }
  | { status: "unknown" | "ambiguous"; item: null };

/** A keyboard wedge submits text; it never authorizes a stock movement or a save. */
export function normalizeScan(value: string): string {
  const code = value.trim();
  if (!code || code.length > 128 || /[\u0000-\u001f\u007f]/u.test(code)) {
    throw new Error("Введите один штрихкод без служебных символов.");
  }
  return code;
}

export function resolveScan<T extends ScanSelection>(code: string, items: T[], previousProductId: string | null): ScanResult<T> {
  const exact = items.filter((item) => item.barcode === code);
  if (exact.length === 0) return { status: "unknown", item: null };
  if (exact.length !== 1) return { status: "ambiguous", item: null };
  return { status: exact[0].product_id === previousProductId ? "repeated" : "found", item: exact[0] };
}

/** Each owner creates one epoch; late responses from replaced queries are ignored. */
export class RequestEpoch {
  private revision = 0;
  next() { return ++this.revision; }
  isCurrent(revision: number) { return revision === this.revision; }
  invalidate() { this.revision++; }
}

export function shouldOpenCatalogItem(
  current: { product_id: string; revision: number } | null,
  next: { product_id: string; revision: number },
  explicitReload = false,
) {
  if (!current || current.product_id !== next.product_id) return true;
  return explicitReload && next.revision > current.revision;
}
