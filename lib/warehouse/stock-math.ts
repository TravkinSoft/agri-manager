export type StockMath = {
  onHand: number;
  reserved: number;
  available: number;
  deficit: number;
};

export function signedLedgerQuantity(row: {
  direction?: unknown;
  quantity?: unknown;
  delta_qty_signed?: unknown;
}): number {
  const signed = Number(row.delta_qty_signed);
  if (Number.isFinite(signed)) return signed;
  const quantity = Math.abs(Number(row.quantity || 0));
  return String(row.direction || "").toLowerCase() === "in" ? quantity : -quantity;
}

export function calculateStockMath(onHand: unknown, reserved: unknown): StockMath {
  const physical = Number(onHand || 0);
  const activeReservations = Math.max(Number(reserved || 0), 0);
  const available = physical - activeReservations;
  return {
    onHand: physical,
    reserved: activeReservations,
    available,
    deficit: Math.max(-available, 0),
  };
}
