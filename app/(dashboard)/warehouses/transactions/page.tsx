"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, CircleArrowDown as ArrowDownCircle, CircleArrowUp as ArrowUpCircle } from "lucide-react";
import { InventoryTransactionFormDialog } from "@/components/warehouses/inventory-transaction-form-dialog";
import {
  getInventoryTransactions,
  createInventoryTransaction,
  updateInventoryTransaction,
  deleteInventoryTransaction,
  getWarehouses,
  getProducts,
} from "@/lib/services/warehouses";
import {
  InventoryTransactionWithDetails,
  InventoryTransactionFormData,
  Warehouse,
  Product,
} from "@/lib/types/warehouse";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";

export default function InventoryTransactionsPage() {
  const [transactions, setTransactions] = useState<InventoryTransactionWithDetails[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] =
    useState<InventoryTransactionWithDetails | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [transactionToDelete, setTransactionToDelete] =
    useState<InventoryTransactionWithDetails | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();

  const loadData = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      const [transactionsData, warehousesData, productsData] = await Promise.all([
        getInventoryTransactions(profile.company_id),
        getWarehouses(profile.company_id),
        getProducts(profile.company_id),
      ]);
      setTransactions(transactionsData);
      setWarehouses(warehousesData);
      setProducts(productsData);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (data: InventoryTransactionFormData) => {
    if (!profile?.company_id) return;

    try {
      await createInventoryTransaction(profile.company_id, data);
      setIsFormOpen(false);
      await loadData();
      toast({
        title: "Success",
        description: "Transaction added successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add transaction",
        variant: "destructive",
      });
    }
  };

  const handleUpdate = async (data: InventoryTransactionFormData) => {
    if (!editingTransaction) return;

    try {
      await updateInventoryTransaction(editingTransaction.id, data);
      setEditingTransaction(null);
      setIsFormOpen(false);
      await loadData();
      toast({
        title: "Success",
        description: "Transaction updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update transaction",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!transactionToDelete) return;

    try {
      await deleteInventoryTransaction(transactionToDelete.id);
      setDeleteDialogOpen(false);
      setTransactionToDelete(null);
      await loadData();
      toast({
        title: "Success",
        description: "Transaction deleted successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete transaction",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (transaction: InventoryTransactionWithDetails) => {
    setEditingTransaction(transaction);
    setIsFormOpen(true);
  };

  const openDeleteDialog = (transaction: InventoryTransactionWithDetails) => {
    setTransactionToDelete(transaction);
    setDeleteDialogOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingTransaction(null);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getTransactionTypeBadge = (type: string) => {
    if (type === "in") {
      return (
        <Badge className="bg-green-100 text-green-800">
          <ArrowDownCircle className="h-3 w-3 mr-1" />
          In
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-100 text-red-800">
        <ArrowUpCircle className="h-3 w-3 mr-1" />
        Out
      </Badge>
    );
  };

  const getProductTypeBadgeColor = (type: string) => {
    switch (type) {
      case "seed":
        return "bg-green-100 text-green-800";
      case "fertilizer":
        return "bg-blue-100 text-blue-800";
      case "pesticide":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventory Transactions"
        description="Track all incoming and outgoing inventory movements"
        action={{
          label: "Add Transaction",
          icon: Plus,
          onClick: () => setIsFormOpen(true),
        }}
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500 py-8">
                      No transactions recorded yet. Click "Add Transaction" to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="font-medium">
                        {formatDate(transaction.date)}
                      </TableCell>
                      <TableCell>{transaction.warehouse_name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>{transaction.product_name}</span>
                          <Badge
                            variant="secondary"
                            className={`w-fit ${getProductTypeBadgeColor(
                              transaction.product_type || ""
                            )}`}
                          >
                            {transaction.product_type}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getTransactionTypeBadge(transaction.transaction_type)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(transaction.quantity).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center ${
                            transaction.transaction_type === "in"
                              ? "text-green-700"
                              : "text-red-700"
                          }`}
                        >
                          {transaction.transaction_type === "in" ? "+" : "-"}
                          {Number(transaction.quantity).toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {transaction.notes || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(transaction)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(transaction)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <InventoryTransactionFormDialog
        open={isFormOpen}
        onOpenChange={handleFormClose}
        onSubmit={editingTransaction ? handleUpdate : handleCreate}
        defaultValues={
          editingTransaction
            ? {
                warehouse_id: editingTransaction.warehouse_id,
                product_id: editingTransaction.product_id,
                quantity: Number(editingTransaction.quantity),
                transaction_type: editingTransaction.transaction_type,
                date: editingTransaction.date,
                notes: editingTransaction.notes || "",
              }
            : undefined
        }
        isEdit={!!editingTransaction}
        warehouses={warehouses}
        products={products}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transaction</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this transaction? This action cannot be
              undone and will affect inventory calculations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
