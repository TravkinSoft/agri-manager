import { supabase } from "@/lib/supabase/client";
import {
  Warehouse,
  Product,
  InventoryTransaction,
  InventoryTransactionWithDetails,
  InventoryBalance,
  WarehouseFormData,
  ProductFormData,
  InventoryTransactionFormData,
} from "@/lib/types/warehouse";

export async function getWarehouses(
  companyId: string,
  includeArchived = false
): Promise<Warehouse[]> {
  let query = supabase
    .from("warehouses")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as Warehouse[];
}

export async function createWarehouse(
  companyId: string,
  warehouseData: WarehouseFormData
): Promise<Warehouse> {
  const { data, error } = await supabase
    .from("warehouses")
    .insert([
      {
        ...warehouseData,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating warehouse:", error);
    throw new Error(`Failed to create warehouse: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as Warehouse;
}

export async function updateWarehouse(
  warehouseId: string,
  warehouseData: Partial<WarehouseFormData>
): Promise<Warehouse> {
  const { data, error } = await supabase
    .from("warehouses")
    .update(warehouseData)
    .eq("id", warehouseId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Warehouse;
}

export async function archiveWarehouse(warehouseId: string): Promise<void> {
  const { error } = await supabase
    .from("warehouses")
    .update({ archived: true })
    .eq("id", warehouseId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getProducts(
  companyId: string,
  includeArchived = false
): Promise<Product[]> {
  let query = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as Product[];
}

export async function createProduct(
  companyId: string,
  productData: ProductFormData
): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .insert([
      {
        ...productData,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating product:", error);
    throw new Error(`Failed to create product: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as Product;
}

export async function updateProduct(
  productId: string,
  productData: Partial<ProductFormData>
): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .update(productData)
    .eq("id", productId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Product;
}

export async function archiveProduct(productId: string): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ archived: true })
    .eq("id", productId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getInventoryTransactions(
  companyId: string
): Promise<InventoryTransactionWithDetails[]> {
  const { data, error } = await supabase
    .from("inventory_transactions")
    .select(`
      *,
      warehouses:warehouse_id (name),
      products:product_id (name, type)
    `)
    .eq("company_id", companyId)
    .order("date", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((transaction: any) => ({
    ...transaction,
    warehouse_name: transaction.warehouses?.name || "N/A",
    product_name: transaction.products?.name || "N/A",
    product_type: transaction.products?.type || "N/A",
  })) as InventoryTransactionWithDetails[];
}

export async function createInventoryTransaction(
  companyId: string,
  transactionData: InventoryTransactionFormData
): Promise<InventoryTransaction> {
  const { data, error } = await supabase
    .from("inventory_transactions")
    .insert([
      {
        ...transactionData,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating inventory transaction:", error);
    throw new Error(`Failed to create transaction: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as InventoryTransaction;
}

export async function updateInventoryTransaction(
  transactionId: string,
  transactionData: Partial<InventoryTransactionFormData>
): Promise<InventoryTransaction> {
  const { data, error } = await supabase
    .from("inventory_transactions")
    .update(transactionData)
    .eq("id", transactionId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as InventoryTransaction;
}

export async function deleteInventoryTransaction(transactionId: string): Promise<void> {
  const { error } = await supabase
    .from("inventory_transactions")
    .delete()
    .eq("id", transactionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getInventoryBalances(companyId: string): Promise<InventoryBalance[]> {
  const { data, error } = await supabase
    .from("inventory_transactions")
    .select(`
      warehouse_id,
      product_id,
      quantity,
      transaction_type,
      date,
      warehouses:warehouse_id (name),
      products:product_id (name, type)
    `)
    .eq("company_id", companyId);

  if (error) {
    throw new Error(error.message);
  }

  const balanceMap = new Map<string, InventoryBalance>();

  (data || []).forEach((transaction: any) => {
    const key = `${transaction.warehouse_id}-${transaction.product_id}`;

    if (!balanceMap.has(key)) {
      balanceMap.set(key, {
        warehouse_id: transaction.warehouse_id,
        warehouse_name: transaction.warehouses?.name || "N/A",
        product_id: transaction.product_id,
        product_name: transaction.products?.name || "N/A",
        product_type: transaction.products?.type || "N/A",
        quantity: 0,
        last_updated: transaction.date,
      });
    }

    const balance = balanceMap.get(key)!;
    const qty = parseFloat(transaction.quantity);

    if (transaction.transaction_type === "in") {
      balance.quantity += qty;
    } else {
      balance.quantity -= qty;
    }

    if (transaction.date > balance.last_updated) {
      balance.last_updated = transaction.date;
    }
  });

  return Array.from(balanceMap.values()).filter((balance) => balance.quantity !== 0);
}
