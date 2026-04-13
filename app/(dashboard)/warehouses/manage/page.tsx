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
import { useLanguage } from "@/lib/contexts/language-context";

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
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

  const warehouseForm = useForm<WarehouseFormData>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: { name: "" },
  });

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: "", type: "seed", unit: "kg", description: "" },
  });

  const loadData = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      const [warehousesData, productsData] = await Promise.all([
        getWarehouses(profile.company_id, false, language),
        getProducts(profile.company_id, false, language),
      ]);
      setWarehouses(warehousesData);
      setProducts(productsData);
    } catch (error) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: t("Не удалось загрузить данные", "Деректерді жүктеу мүмкін болмады", "Failed to load data"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [language]);

  const handleWarehouseSubmit = async (data: WarehouseFormData) => {
    if (!profile?.company_id) return;

    try {
      if (editingWarehouse) {
        await updateWarehouse(editingWarehouse.id, data);
        toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Склад обновлен", "Қойма жаңартылды", "Warehouse updated successfully") });
      } else {
        await createWarehouse(profile.company_id, data);
        toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Склад создан", "Қойма құрылды", "Warehouse created successfully") });
      }
      setWarehouseDialogOpen(false);
      setEditingWarehouse(null);
      warehouseForm.reset();
      await loadData();
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось сохранить склад", "Қойманы сақтау мүмкін болмады", "Failed to save warehouse"),
        variant: "destructive",
      });
    }
  };

  const handleProductSubmit = async (data: ProductFormData) => {
    if (!profile?.company_id) return;

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, data);
        toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Продукт обновлен", "Өнім жаңартылды", "Product updated successfully") });
      } else {
        await createProduct(profile.company_id, data);
        toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Продукт создан", "Өнім құрылды", "Product created successfully") });
      }
      setProductDialogOpen(false);
      setEditingProduct(null);
      productForm.reset();
      await loadData();
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось сохранить продукт", "Өнімді сақтау мүмкін болмады", "Failed to save product"),
        variant: "destructive",
      });
    }
  };

  const handleArchiveWarehouse = async (warehouseId: string) => {
    try {
      await archiveWarehouse(warehouseId);
      toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Склад архивирован", "Қойма мұрағатталды", "Warehouse archived successfully") });
      await loadData();
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось архивировать склад", "Қойманы мұрағаттау мүмкін болмады", "Failed to archive warehouse"),
        variant: "destructive",
      });
    }
  };

  const handleArchiveProduct = async (productId: string) => {
    try {
      await archiveProduct(productId);
      toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Продукт архивирован", "Өнім мұрағатталды", "Product archived successfully") });
      await loadData();
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось архивировать продукт", "Өнімді мұрағаттау мүмкін болмады", "Failed to archive product"),
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
    productForm.reset({
      name: product.name,
      type: product.type,
      unit: product.unit || "kg",
      description: product.description || "",
    });
    setProductDialogOpen(true);
  };

  const getProductTypeBadgeColor = (type: string) => {
    switch (type) {
      case "produce":
        return "bg-purple-100 text-purple-800";
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
        title={t("Управление складами и продуктами", "Қоймалар мен өнімдерді басқару", "Manage Warehouses & Products")}
        description={t("Создание и управление складами и продуктами для учета остатков", "Қалдық есебі үшін қоймалар мен өнімдерді құру және басқару", "Create and manage warehouses and products for inventory tracking")}
      />

      <Tabs defaultValue="warehouses" className="space-y-4">
        <TabsList>
          <TabsTrigger value="warehouses">{t("Склады", "Қоймалар", "Warehouses")}</TabsTrigger>
          <TabsTrigger value="products">{t("Продукты", "Өнімдер", "Products")}</TabsTrigger>
        </TabsList>

        <TabsContent value="warehouses">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <WarehouseIcon className="h-5 w-5" />
                {t("Склады", "Қоймалар", "Warehouses")}
              </CardTitle>
              <Button onClick={() => setWarehouseDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("Добавить склад", "Қойма қосу", "Add Warehouse")}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Название", "Атауы", "Name")}</TableHead>
                    <TableHead>{t("Создан", "Құрылған", "Created")}</TableHead>
                    <TableHead className="text-right">{t("Действия", "Әрекеттер", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-500">
                        {t("Загрузка...", "Жүктелуде...", "Loading...")}
                      </TableCell>
                    </TableRow>
                  ) : warehouses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-500 py-8">
                        {t("Склады еще не добавлены.", "Қоймалар әлі қосылмаған.", "No warehouses yet.")}
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
                {t("Продукты", "Өнімдер", "Products")}
              </CardTitle>
              <Button onClick={() => setProductDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("Добавить продукт", "Өнім қосу", "Add Product")}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Название", "Атауы", "Name")}</TableHead>
                    <TableHead>{t("Тип", "Түрі", "Type")}</TableHead>
                    <TableHead>{t("Создан", "Құрылған", "Created")}</TableHead>
                    <TableHead className="text-right">{t("Действия", "Әрекеттер", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        {t("Загрузка...", "Жүктелуде...", "Loading...")}
                      </TableCell>
                    </TableRow>
                  ) : products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                        {t("Продукты еще не добавлены.", "Өнімдер әлі қосылмаған.", "No products yet.")}
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
              {editingWarehouse ? t("Редактировать склад", "Қойманы өңдеу", "Edit Warehouse") : t("Добавить склад", "Қойма қосу", "Add Warehouse")}
            </DialogTitle>
            <DialogDescription>
              {editingWarehouse
                ? t("Обновите данные склада.", "Қойма деректерін жаңартыңыз.", "Update warehouse details below.")
                : t("Создайте новый склад для учета остатков.", "Қалдық есебі үшін жаңа қойма құрыңыз.", "Create a new warehouse for inventory management.")}
            </DialogDescription>
          </DialogHeader>
          <Form {...warehouseForm}>
            <form onSubmit={warehouseForm.handleSubmit(handleWarehouseSubmit)}>
              <FormField
                control={warehouseForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Название склада *", "Қойма атауы *", "Warehouse Name *")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("например, Основной склад", "мысалы, Негізгі қойма", "e.g., Main Storage")} {...field} />
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
                  {t("Отмена", "Болдырмау", "Cancel")}
                </Button>
                <Button type="submit" disabled={warehouseForm.formState.isSubmitting}>
                  {warehouseForm.formState.isSubmitting
                    ? t("Сохранение...", "Сақталуда...", "Saving...")
                    : editingWarehouse
                    ? t("Обновить", "Жаңарту", "Update")
                    : t("Создать", "Құру", "Create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? t("Редактировать продукт", "Өнімді өңдеу", "Edit Product") : t("Добавить продукт", "Өнім қосу", "Add Product")}</DialogTitle>
            <DialogDescription>
              {editingProduct
                ? t("Обновите данные продукта.", "Өнім деректерін жаңартыңыз.", "Update product details below.")
                : t("Создайте новый продукт для складского учета.", "Қойма есебі үшін жаңа өнім құрыңыз.", "Create a new product for inventory tracking.")}
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
                    <FormLabel>{t("Название продукта *", "Өнім атауы *", "Product Name *")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("например, Семена кукурузы", "мысалы, Жүгері тұқымы", "e.g., Corn Seeds")} {...field} />
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
                    <FormLabel>{t("Тип продукта *", "Өнім түрі *", "Product Type *")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("Выберите тип", "Түрін таңдаңыз", "Select type")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="produce">{t("Продукция", "Өнім", "Produce")}</SelectItem>
                        <SelectItem value="seed">{t("Семена", "Тұқым", "Seed")}</SelectItem>
                        <SelectItem value="fertilizer">{t("Удобрения", "Тыңайтқыш", "Fertilizer")}</SelectItem>
                        <SelectItem value="pesticide">{t("Пестициды", "Пестицид", "Pesticide")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit *</FormLabel>
                    <FormControl>
                      <Input placeholder="kg, l, t, pcs" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Описание", "Сипаттама", "Description")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("Необязательное описание", "Қосымша сипаттама", "Optional description")} {...field} />
                    </FormControl>
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
                  {t("Отмена", "Болдырмау", "Cancel")}
                </Button>
                <Button type="submit" disabled={productForm.formState.isSubmitting}>
                  {productForm.formState.isSubmitting
                    ? t("Сохранение...", "Сақталуда...", "Saving...")
                    : editingProduct
                    ? t("Обновить", "Жаңарту", "Update")
                    : t("Создать", "Құру", "Create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
