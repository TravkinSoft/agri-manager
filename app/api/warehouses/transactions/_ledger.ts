export async function postInventoryTransactionToLedger(supabase: any, transaction: any) {
  if (String(transaction?.status || "confirmed") !== "confirmed") return;

  // Ledger rows are accounting source-of-truth and must only be written by the
  // canonical actor-bound RPC. A missing RPC is a fail-closed schema error;
  // falling back to browser-role table INSERT would bypass that contract.
  const { error } = await supabase.rpc("post_inventory_transaction_to_ledger", {
    p_transaction_id: transaction.id,
  });

  if (error) {
    throw new Error(error.message);
  }
}
