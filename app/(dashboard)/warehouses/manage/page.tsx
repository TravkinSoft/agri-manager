"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Plus, Pencil, Archive, Warehouse as WarehouseIcon, Package } from "lucide-react";
import {
  getWarehouses,
  getProducts,
  createWarehouse,
  createProduct,
  updateWarehouse,
  updateProduct,
  archiveWarehouse,
  archiveProduct,
} from "@/lib/services/warehouses";
import {
  Warehouse,
  Product,
  WarehouseFormData,
  ProductFormData,
  warehouseSchema,
  productSchema,
} from "@/lib/types/warehouse";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/contexts/auth-context";

export default function ManageWarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [warehouseDialogOpen, setWarehouseDialogOpen] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();

  const warehouseForm = useForm<WarehouseFormData>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: { name: "" },
  });

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: "", type: "seed" },
  });

  const loadData = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      const [warehousesData, productsData] = await Promise.all([
        getWarehouses(profile.company_id),
        getProducts(profile.company_id),
      ]);
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

  const handleWarehouseSubmit = async (data: WarehouseFormData) => {
    if (!profile?.company_id) return;

    try {
      if (editingWarehouse) {
        await updateWarehouse(editingWarehouse.id, data);
        toast({ title: "Success", description: "Warehouse updated successfully" });
      } else {
        await createWarehouse(profile.company_id, data);
        toast({ title: "Success", description: "Warehouse created successfully" });
      }
      setWarehouseDialogOpen(false);
      setEditingWarehouse(null);
      warehouseForm.reset();
      await loadData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save warehouse",
        variant: "destructive",
      });
    }
  };

  const handleProductSubmit = async (data: ProductFormData) => {
    if (!profile?.company_id) return;

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, data);
        toast({ title: "Success", description: "Product updated successfully" });
      } else {
        await createProduct(profile.company_id, data);
        toast({ title: "Success", description: "Product created successfully" });
      }
      setProductDialogOpen(false);
      setEditingProduct(null);
      productForm.reset();
      await loadData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save product",
        variant: "destructive",
      });
    }
  };

  const handleArchiveWarehouse = async (warehouseId: string) => {
    try {
      await archiveWarehouse(warehouseId);
      toast({ title: "Success", description: "Warehouse archived successfully" });
      await loadData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to archive warehouse",
        variant: "destructive",
      });
    }
  };

  const handleArchiveProduct = async (productId: string) => {
    try {
      await archiveProduct(productId);
      toast({ title: "Success", description: "Product archived successfully" });
      await loadData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to archive product",
        variant: "destructive",
      });
    }
  };

  const openWarehouseEdit = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse);
    warehouseForm.reset({ name: warehouse.name });
    setWarehouseDialogOpen(true);
  };

  const openProductEdit = (product: Product) => {
    setEditingProduct(product);
    productForm.reset({ name: product.name, type: product.type });
    setProductDialogOpen(true);
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
    <div className="space-y-6">
      <PageHeader
        title="Manage Warehouses & Products"
        description="Create and manage warehouses and products for inventory tracking"
      />

      <Tabs defaultValue="warehouses" className="space-y-4">
        <TabsList>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
        </TabsList>

        <TabsContent value="warehouses">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <WarehouseIcon className="h-5 w-5" />
                Warehouses
              </CardTitle>
              <Button onClick={() => setWarehouseDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Warehouse
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-500">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : warehouses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-500 py-8">
                        No warehouses yet. Click "Add Warehouse" to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    warehouses.map((warehouse) => (
                      <TableRow key={warehouse.id}>
                        <TableCell className="font-medium">{warehouse.name}</TableCell>
                        <TableCell>
                          {new Date(warehouse.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openWarehouseEdit(warehouse)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleArchiveWarehouse(warehouse.id)}
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Products
              </CardTitle>
              <Button onClick={() => setProductDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Product
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                        No products yet. Click "Add Product" to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={getProductTypeBadgeColor(product.type)}
                          >
                            {product.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(product.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openProductEdit(product)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleArchiveProduct(product.id)}
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={warehouseDialogOpen} onOpenChange={setWarehouseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingWarehouse ? "Edit Warehouse" : "Add Warehouse"}
            </DialogTitle>
            <DialogDescription>
              {editingWarehouse
                ? "Update warehouse details below."
                : "Create a new warehouse for inventory management."}
            </DialogDescription>
          </DialogHeader>
          <Form {...warehouseForm}>
            <form onSubmit={warehouseForm.handleSubmit(handleWarehouseSubmit)}>
              <FormField
                control={warehouseForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warehouse Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Main Storage" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setWarehouseDialogOpen(false);
                    setEditingWarehouse(null);
                    warehouseForm.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={warehouseForm.formState.isSubmitting}>
                  {warehouseForm.formState.isSubmitting
                    ? "Saving..."
                    : editingWarehouse
                    ? "Update"
                    : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit Product" : "Add Product"}</DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Update product details below."
                : "Create a new product for inventory tracking."}
            </DialogDescription>
          </DialogHeader>
          <Form {...productForm}>
            <form
              onSubmit={productForm.handleSubmit(handleProductSubmit)}
              className="space-y-4"
            >
              <FormField
                control={productForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Corn Seeds" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="seed">Seed</SelectItem>
                        <SelectItem value="fertilizer">Fertilizer</SelectItem>
                        <SelectItem value="pesticide">Pesticide</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setProductDialogOpen(false);
                    setEditingProduct(null);
                    productForm.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={productForm.formState.isSubmitting}>
                  {productForm.formState.isSubmitting
                    ? "Saving..."
                    : editingProduct
                    ? "Update"
                    : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
