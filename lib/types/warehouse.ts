import { z } from "zod";

export interface Warehouse {
  id: string;
  name: string;
  created_at: string;
  archived: boolean;
  user_id: string;
}

export interface Product {
  id: string;
  name: string;
  type: "seed" | "fertilizer" | "pesticide";
  created_at: string;
  archived: boolean;
  user_id: string;
}

export interface InventoryTransaction {
  id: string;
  warehouse_id: string;
  product_id: string;
  quantity: number;
  transaction_type: "in" | "out";
  date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
}

export interface InventoryTransactionWithDetails extends InventoryTransaction {
  warehouse_name?: string;
  product_name?: string;
  product_type?: string;
}

export interface InventoryBalance {
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_name: string;
  product_type: string;
  quantity: number;
  last_updated: string;
}

export const warehouseSchema = z.object({
  name: z.string().min(1, "Warehouse name is required"),
});

export const productSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  type: z.enum(["seed", "fertilizer", "pesticide"], {
    required_error: "Please select a product type",
  }),
});

export const inventoryTransactionSchema = z.object({
  warehouse_id: z.string().uuid("Please select a warehouse"),
  product_id: z.string().uuid("Please select a product"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  transaction_type: z.enum(["in", "out"], {
    required_error: "Please select a transaction type",
  }),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

export type WarehouseFormData = z.infer<typeof warehouseSchema>;
export type ProductFormData = z.infer<typeof productSchema>;
export type InventoryTransactionFormData = z.infer<typeof inventoryTransactionSchema>;
