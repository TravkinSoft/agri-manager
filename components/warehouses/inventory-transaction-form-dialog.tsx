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
  allowedMovementTypes?: Array<InventoryTransactionFormData["movement_type"]>;
}

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Приход",
  issue: "Выдача",
  transfer: "Перемещение между складами",
  writeoff: "Списание / потери",
  adjustment: "Ревизия / корректировка",
};

export function InventoryTransactionFormDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  isEdit = false,
  warehouses,
  products,
  allowedMovementTypes = ["receipt", "issue", "transfer", "writeoff", "adjustment"],
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
          <DialogTitle>{isEdit ? "Изменить складское движение" : "Новое складское движение"}</DialogTitle>
          <DialogDescription>
            Перемещение или traceable-корректировка агрохимических остатков.
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
                    <FormLabel>Дата и время *</FormLabel>
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
                    <FormLabel>Статус *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="draft">Черновик</SelectItem>
                        <SelectItem value="confirmed">Проведено</SelectItem>
                        <SelectItem value="cancelled">Отменено</SelectItem>
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
                    <FormLabel>Материал *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите материал" />
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
                    <FormLabel>Тип движения *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите тип" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(MOVEMENT_LABELS).filter(([value]) => allowedMovementTypes.includes(value as InventoryTransactionFormData["movement_type"])).map(([value, label]) => (
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
                    <FormLabel>Склад-источник *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите склад" />
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
                    <FormLabel>Склад назначения *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите склад" />
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
                    <FormLabel>Направление корректировки *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите направление" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="in">Увеличить остаток</SelectItem>
                        <SelectItem value="out">Уменьшить остаток</SelectItem>
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
                  <FormLabel>Количество *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min="0" placeholder="Введите количество" {...field} />
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
                  <FormLabel>Основание / комментарий</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Причина, документ или пояснение..."
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
                Отмена
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Сохранение..." : isEdit ? "Сохранить" : "Провести"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
