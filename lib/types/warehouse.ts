import { z } from "zod";

export type ProductCategory = "produce" | "seed" | "fertilizer" | "pesticide";
export type ProductAccountingMode = "bulk_mass" | "unit_with_weight" | "package_count";
export type MovementType = "receipt" | "issue" | "transfer" | "writeoff" | "adjustment";
export type InventoryStatus = "draft" | "confirmed" | "cancelled";
export type TransactionDirection = "in" | "out";

export interface Warehouse {
  id: string;
  name: string;
  warehouse_type?: string | null;
  storage_capacity_kg?: number | null;
  created_at: string;
  archived: boolean;
  user_id: string;
  company_id?: string | null;
}

export interface Product {
  id: string;
  name: string;
  type: ProductCategory;
  crop_id?: string | null;
  product_form?: string | null;
  accounting_mode?: ProductAccountingMode | null;
  base_uom?: string | null;
  pack_uom?: string | null;
  unit_weight_kg?: number | null;
  units_per_pack?: number | null;
  unit?: string | null;
  description?: string | null;
  created_at: string;
  archived: boolean;
  user_id: string;
  company_id?: string | null;
}

export interface InventoryTransaction {
  id: string;
  warehouse_id: string;
  product_id: string;
  quantity: number;
  transaction_type: TransactionDirection;
  movement_type?: MovementType | null;
  status?: InventoryStatus | null;
  source_warehouse_id?: string | null;
  destination_warehouse_id?: string | null;
  operation_datetime?: string | null;
  date: string;
  notes: string | null;
  responsible_user_id?: string | null;
  confirmed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id?: string | null;
}

export interface InventoryTransactionWithDetails extends InventoryTransaction {
  warehouse_name?: string;
  source_warehouse_name?: string;
  destination_warehouse_name?: string;
  product_name?: string;
  product_type?: ProductCategory | string;
  product_unit?: string;
  created_by_email?: string;
}

export interface InventoryBalance {
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_name: string;
  product_type: ProductCategory | string;
  unit: string;
  quantity: number;
  last_updated: string;
}

export const warehouseSchema = z.object({
  name: z.string().min(1, "Warehouse name is required"),
});

export const productSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  type: z.enum(["produce", "seed", "fertilizer", "pesticide"], {
    required_error: "Please select a product category",
  }),
  crop_id: z.string().uuid().optional().or(z.literal("")),
  product_form: z.string().optional(),
  accounting_mode: z.enum(["bulk_mass", "unit_with_weight", "package_count"]).default("bulk_mass"),
  base_uom: z.string().min(1, "Base unit is required").default("kg"),
  pack_uom: z.string().optional(),
  unit_weight_kg: z.coerce.number().positive().optional(),
  units_per_pack: z.coerce.number().positive().optional(),
  unit: z.string().min(1, "Unit is required").default("kg"),
  description: z.string().optional(),
});

export const inventoryTransactionSchema = z
  .object({
    product_id: z.string().uuid("Please select an item"),
    movement_type: z.enum(["receipt", "issue", "transfer", "writeoff", "adjustment"], {
      required_error: "Please select an operation type",
    }),
    status: z.enum(["draft", "confirmed", "cancelled"], {
      required_error: "Please select status",
    }),
    source_warehouse_id: z.string().uuid().optional().or(z.literal("")),
    destination_warehouse_id: z.string().uuid().optional().or(z.literal("")),
    operation_datetime: z.string().min(1, "Date and time are required"),
    quantity: z.coerce.number().positive("Quantity must be greater than 0"),
    transaction_type: z.enum(["in", "out"]).default("out"),
    notes: z.string().optional(),
    responsible_user_id: z.string().uuid().optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    const needsSource =
      value.movement_type === "issue" ||
      value.movement_type === "writeoff" ||
      value.movement_type === "transfer" ||
      (value.movement_type === "adjustment" && value.transaction_type === "out");
    const needsDestination =
      value.movement_type === "receipt" ||
      value.movement_type === "transfer" ||
      (value.movement_type === "adjustment" && value.transaction_type === "in");

    if (needsSource && !value.source_warehouse_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source warehouse is required",
        path: ["source_warehouse_id"],
      });
    }

    if (needsDestination && !value.destination_warehouse_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Destination warehouse is required",
        path: ["destination_warehouse_id"],
      });
    }

    if (
      value.movement_type === "transfer" &&
      value.source_warehouse_id &&
      value.destination_warehouse_id &&
      value.source_warehouse_id === value.destination_warehouse_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source and destination warehouses must be different",
        path: ["destination_warehouse_id"],
      });
    }
  });

export type WarehouseFormData = z.infer<typeof warehouseSchema>;
export type ProductFormData = z.infer<typeof productSchema>;
export type InventoryTransactionFormData = z.infer<typeof inventoryTransactionSchema>;
