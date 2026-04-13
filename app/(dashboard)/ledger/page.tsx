"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLedgerEntries } from "@/lib/services/ledger";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";

export default function LedgerPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState("all");

  const loadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    try {
      const data = await getLedgerEntries(profile.company_id);
      setRows(data);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить журнал проводок",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [profile?.company_id]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const text = `${row.product_name || ""} ${row.warehouse_name || ""} ${row.reason_type || ""} ${row.ticket_id || ""}`.toLowerCase();
      const matchSearch = !search || text.includes(search.toLowerCase());
      const matchDirection = direction === "all" || row.direction === direction;
      return matchSearch && matchDirection;
    });
  }, [rows, search, direction]);

  return (
    <div className="space-y-6">
      <PageHeader title="Журнал проводок" description="Единый аудит складских дельт из finalized талонов и переработки" />

      <Card>
        <CardHeader>
          <CardTitle>Фильтры</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Input placeholder="Поиск по продукту/складу/причине/талону" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger><SelectValue placeholder="Направление" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все направления</SelectItem>
              <SelectItem value="in">in</SelectItem>
              <SelectItem value="out">out</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Проводки</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-slate-500">Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-slate-500">Проводок не найдено.</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((row) => (
                <div key={row.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {row.direction === "in" ? "+" : "-"}{Number(row.quantity || 0).toFixed(3)} кг · {row.product_name}
                    </div>
                    <div className="text-xs rounded-full px-2 py-1 bg-slate-100">{row.direction}</div>
                  </div>
                  <div className="text-sm text-slate-600">
                    Склад: {row.warehouse_name} · Причина: {row.reason_type}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(row.occurred_at).toLocaleString()} · ticket: {row.ticket_id || "-"} · processing: {row.processing_id || "-"}
                  </div>
                  {row.is_storno && (
                    <div className="mt-1 text-xs text-amber-700">storno of: {row.storno_of_entry_id}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

