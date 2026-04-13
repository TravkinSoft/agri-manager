"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { getProducts } from "@/lib/services/warehouses";
import { createContainerRecord, getContainerRegistry, updateContainerStatus } from "@/lib/services/containers";

const STATUSES = ["in_stock", "issued", "awaiting_return", "returned", "to_disposal", "disposed"];

export default function ContainersPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [productId, setProductId] = useState("");
  const [containerType, setContainerType] = useState("canister");
  const [quantity, setQuantity] = useState("0");
  const [status, setStatus] = useState("in_stock");
  const [notes, setNotes] = useState("");

  const loadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    try {
      const [containers, prods] = await Promise.all([
        getContainerRegistry(profile.company_id),
        getProducts(profile.company_id),
      ]);
      setRows(containers);
      setProducts(prods);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить реестр тары",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [profile?.company_id]);

  const handleCreate = async () => {
    if (!profile?.company_id) return;
    if (Number(quantity) <= 0) {
      toast({ title: "Ошибка", description: "Количество должно быть > 0", variant: "destructive" });
      return;
    }
    try {
      await createContainerRecord({
        company_id: profile.company_id,
        product_id: productId || null,
        container_type: containerType,
        container_status: status,
        quantity: Number(quantity),
        notes: notes || null,
      });
      toast({ title: "Успешно", description: "Запись в реестр тары добавлена" });
      await loadData();
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать запись", variant: "destructive" });
    }
  };

  const handleStatus = async (id: string, nextStatus: string) => {
    try {
      const patch: Record<string, unknown> = {
        container_status: nextStatus,
      };
      if (nextStatus === "returned") patch.returned_at = new Date().toISOString();
      if (nextStatus === "disposed") patch.disposed_at = new Date().toISOString();
      await updateContainerStatus(id, patch);
      await loadData();
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось обновить статус", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Тара" description="Выданная, возвращенная и утилизируемая тара" />

      <Card>
        <CardHeader>
          <CardTitle>Добавить движение тары</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Продукт (опционально)</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Выберите продукт" /></SelectTrigger>
                <SelectContent>
                  {products.map((item: any) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Тип тары</Label>
              <Input value={containerType} onChange={(e) => setContainerType(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Количество</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Статус</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Примечание</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <Button onClick={handleCreate}>Добавить</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Реестр тары</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-slate-500">Загрузка...</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-slate-500">Записей пока нет.</div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{row.container_type}</div>
                    <div className="text-xs rounded-full px-2 py-1 bg-slate-100">{row.container_status}</div>
                  </div>
                  <div className="text-sm text-slate-600">{row.product_name || "Без привязки к продукту"} · {row.quantity}</div>
                  <div className="flex flex-wrap gap-2">
                    {STATUSES.map((item) => (
                      <Button key={item} variant="outline" size="sm" onClick={() => handleStatus(row.id, item)} disabled={row.container_status === item}>
                        {item}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

