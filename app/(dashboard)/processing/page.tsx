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
import { getProducts, getWarehouses } from "@/lib/services/warehouses";
import { confirmProcessingDocument, createProcessingDocument, getProcessingDocuments } from "@/lib/services/processing";

const PROCESSING_TYPES = [
  { value: "drying", label: "Сушка" },
  { value: "cleaning", label: "Очистка" },
  { value: "grading", label: "Сортировка" },
  { value: "treatment", label: "Протравка" },
  { value: "soil_separation", label: "Отделение земли" },
  { value: "washing", label: "Мойка" },
  { value: "repacking", label: "Перефасовка" },
  { value: "mixing", label: "Смешивание" },
];

export default function ProcessingPage() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [type, setType] = useState("drying");
  const [sourceWh, setSourceWh] = useState("");
  const [destWh, setDestWh] = useState("");
  const [productId, setProductId] = useState("");
  const [inputQty, setInputQty] = useState("0");
  const [outputQty, setOutputQty] = useState("0");
  const [notes, setNotes] = useState("");

  const loadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    try {
      const [docs, whs, prods] = await Promise.all([
        getProcessingDocuments(profile.company_id),
        getWarehouses(profile.company_id),
        getProducts(profile.company_id),
      ]);
      setRows(docs);
      setWarehouses(whs);
      setProducts(prods);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить переработку",
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
    if (!profile?.company_id || !profile?.id) return;
    if (!sourceWh || !productId || Number(inputQty) <= 0) {
      toast({
        title: "Ошибка",
        description: "Заполните обязательные поля",
        variant: "destructive",
      });
      return;
    }
    try {
      setSubmitting(true);
      await createProcessingDocument({
        company_id: profile.company_id,
        processing_type: type,
        status: "draft",
        source_warehouse_id: sourceWh,
        destination_warehouse_id: destWh || null,
        product_id: productId,
        input_qty_kg: Number(inputQty),
        output_qty_kg: Number(outputQty || 0),
        loss_qty_kg: Math.max(0, Number(inputQty) - Number(outputQty || 0)),
        waste_qty_kg: 0,
        created_by: profile.id,
        notes: notes || null,
      });
      toast({ title: "Успешно", description: "Документ переработки создан" });
      await loadData();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось создать документ",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (id: string) => {
    if (!profile?.id) return;
    try {
      await confirmProcessingDocument(id, profile.id);
      toast({ title: "Успешно", description: "Документ переработки подтвержден" });
      await loadData();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось подтвердить документ",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Технология / переработка" description="Сушка, очистка, протравка и другие преобразования" />

      <Card>
        <CardHeader>
          <CardTitle>Создать документ переработки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Тип переработки</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROCESSING_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Склад источник</Label>
              <Select value={sourceWh} onValueChange={setSourceWh}>
                <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((item: any) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Склад назначения</Label>
              <Select value={destWh} onValueChange={setDestWh}>
                <SelectTrigger><SelectValue placeholder="Опционально" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((item: any) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Продукт</Label>
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
              <Label>Вход (кг)</Label>
              <Input type="number" value={inputQty} onChange={(e) => setInputQty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Выход (кг)</Label>
              <Input type="number" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Примечание</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button onClick={handleCreate} disabled={submitting}>Создать</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Журнал документов переработки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="text-sm text-slate-500">Загрузка...</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-slate-500">Документов пока нет.</div>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{row.processing_type}</div>
                  <div className="text-xs rounded-full px-2 py-1 bg-slate-100">{row.status}</div>
                </div>
                <div className="text-sm text-slate-600">{row.product_name} · {row.input_qty_kg} кг → {row.output_qty_kg} кг</div>
                <div className="text-xs text-slate-500">{row.source_warehouse_name} → {row.destination_warehouse_name || row.source_warehouse_name}</div>
                {row.status === "draft" && (
                  <Button size="sm" className="mt-2" onClick={() => handleConfirm(row.id)}>
                    Подтвердить переработку
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

