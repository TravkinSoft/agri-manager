"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  inventoryTransactionSchema,
  InventoryTransactionFormData,
  Warehouse,
  Product,
} from "@/lib/types/warehouse";
import { localizeUnit } from "@/lib/i18n/helpers";
import { useEffect } from "react";

interface InventoryTransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: InventoryTransactionFormData) => Promise<void>;
  defaultValues?: Partial<InventoryTransactionFormData>;
  isEdit?: boolean;
  warehouses: Warehouse[];
  products: Product[];
}

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Incoming stock / receipt",
  issue: "Outgoing stock / issue",
  transfer: "Internal transfer",
  writeoff: "Write-off / loss / disposal",
  adjustment: "Stock adjustment / correction",
};

export function InventoryTransactionFormDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  isEdit = false,
  warehouses,
  products,
}: InventoryTransactionFormDialogProps) {
  const form = useForm<InventoryTransactionFormData>({
    resolver: zodResolver(inventoryTransactionSchema),
    defaultValues: defaultValues || {
      product_id: "",
      movement_type: "receipt",
      status: "confirmed",
      source_warehouse_id: "",
      destination_warehouse_id: "",
      operation_datetime: new Date().toISOString().slice(0, 16),
      quantity: 0,
      transaction_type: "out",
      notes: "",
      responsible_user_id: "",
    },
  });

  const movementType = form.watch("movement_type");

  useEffect(() => {
    if (defaultValues) {
      form.reset({
        product_id: defaultValues.product_id || "",
        movement_type: defaultValues.movement_type || "receipt",
        status: defaultValues.status || "confirmed",
        source_warehouse_id: defaultValues.source_warehouse_id || "",
        destination_warehouse_id: defaultValues.destination_warehouse_id || "",
        operation_datetime:
          defaultValues.operation_datetime || new Date().toISOString().slice(0, 16),
        quantity: Number(defaultValues.quantity || 0),
        transaction_type: defaultValues.transaction_type || "out",
        notes: defaultValues.notes || "",
        responsible_user_id: defaultValues.responsible_user_id || "",
      });
    } else {
      form.reset({
        product_id: "",
        movement_type: "receipt",
        status: "confirmed",
        source_warehouse_id: "",
        destination_warehouse_id: "",
        operation_datetime: new Date().toISOString().slice(0, 16),
        quantity: 0,
        transaction_type: "out",
        notes: "",
        responsible_user_id: "",
      });
    }
  }, [defaultValues, form, open]);

  const showSourceWarehouse =
    movementType === "issue" || movementType === "writeoff" || movementType === "transfer" || movementType === "adjustment";
  const showDestinationWarehouse =
    movementType === "receipt" || movementType === "transfer" || movementType === "adjustment";
  const showAdjustmentDirection = movementType === "adjustment";

  const handleSubmit = async (data: InventoryTransactionFormData) => {
    await onSubmit(data);
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit warehouse operation" : "New warehouse operation"}</DialogTitle>
          <DialogDescription>
            Create stock movement for produce, seeds, fertilizers and pesticides.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="operation_datetime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date/time *</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="draft">draft</SelectItem>
                        <SelectItem value="confirmed">confirmed</SelectItem>
                        <SelectItem value="cancelled">cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="product_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {products.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} ({product.type}) {product.unit ? `- ${localizeUnit(product.unit, "ru")}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="movement_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Operation type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select operation type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {showSourceWarehouse && (
              <FormField
                control={form.control}
                name="source_warehouse_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source warehouse *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select source warehouse" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {warehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {showDestinationWarehouse && (
              <FormField
                control={form.control}
                name="destination_warehouse_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destination warehouse *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select destination warehouse" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {warehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {showAdjustmentDirection && (
              <FormField
                control={form.control}
                name="transaction_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Adjustment direction *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select direction" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="in">Increase stock</SelectItem>
                        <SelectItem value="out">Decrease stock</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min="0" placeholder="Enter quantity" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comment / reason</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Reason, document number, additional notes..."
                      className="min-h-[90px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving..." : isEdit ? "Update operation" : "Create operation"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
