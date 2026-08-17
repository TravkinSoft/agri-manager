"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";
import { getFieldDisplayName } from "@/lib/fields/display";

type FieldRow = {
  id: string;
  name: string;
  display_name?: string | null;
  original_field_key?: string | null;
  technical_key?: string | null;
  area: number;
  soil_type?: string | null;
  notes?: string | null;
  archived?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  user_id?: string | null;
  company_id?: string | null;
};

type CropSummaryRow = {
  id: string;
  seasonYear: number | null;
  cropName: string;
  varietyName: string | null;
  reproductionName: string | null;
  area: number;
  status: string | null;
};

type TimelineEvent = {
  id: string;
  happenedAt: string;
  dateOnly?: boolean;
  eventType: "operation_completed" | "material_consumed" | "harvest_received";
  title: string;
  details: string;
  quantity?: number | null;
  unit?: string | null;
};

type MaterialFact = {
  material_id?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  consumed_quantity?: number | null;
  actual_rate?: number | null;
  unit?: string | null;
  request_id?: string | null;
  request_number?: string | null;
};

type RequestMaterial = {
  requestId: string;
  requestNumber: string;
  operationId: string;
  productId: string;
  quantity: number;
  unit: string;
  completedAt: string | null;
};

const cropStatusLabels: Record<string, string> = {
  planned: "Запланировано",
  active: "Активно",
  completed: "Завершено",
  archived: "Архив",
};

const unitLabels: Record<string, string> = {
  kg: "кг",
  kilogram: "кг",
  kilograms: "кг",
  l: "л",
  liter: "л",
  litre: "л",
  liters: "л",
  litres: "л",
  t: "т",
  ton: "т",
  tonne: "т",
  pcs: "шт.",
  piece: "шт.",
  pieces: "шт.",
};

function normalizeUnit(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  return unitLabels[normalized] || normalized || "ед.";
}

function formatQuantity(value: number, unit: string): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value)} ${normalizeUnit(unit)}`;
}

function safeMaterialFacts(value: unknown): MaterialFact[] {
  return Array.isArray(value) ? (value as MaterialFact[]) : [];
}

function timelineSortValue(value: string, dateOnly = false): number {
  const parsed = new Date(dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatTimelineDate(value: string, dateOnly = false): string {
  const parsed = new Date(dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(parsed);
}

export default function FieldDetailsPage() {
  const params = useParams<{ id: string }>();
  const fieldId = String(params?.id || "").trim();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [field, setField] = useState<FieldRow | null>(null);
  const [cropRows, setCropRows] = useState<CropSummaryRow[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (!profile?.company_id || !fieldId) return;
      setLoading(true);
      setError(null);
      try {
        const [
          fieldRes,
          cropStructureRes,
          operationRes,
          historyRes,
          legacyConsumptionRes,
          harvestRes,
          requestRes,
        ] = await Promise.all([
          supabase
            .from("fields")
            .select("id,name,area,soil_type,notes,archived,created_at,updated_at,user_id,company_id")
            .eq("company_id", profile.company_id)
            .eq("id", fieldId)
            .maybeSingle(),
          supabase
            .from("crop_structure")
            .select(`
              id,
              area,
              status,
              seasons:season_id(year),
              crops:crop_id(name),
              varieties:variety_id(name),
              seed_reproductions:reproduction_id(name)
            `)
            .eq("company_id", profile.company_id)
            .eq("field_id", fieldId)
            .eq("archived", false)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("operations")
            .select("id,date,completed_at,operation_type,work_status,notes")
            .eq("company_id", profile.company_id)
            .eq("field_id", fieldId)
            .eq("work_status", "completed")
            .order("date", { ascending: false })
            .limit(500),
          supabase
            .from("field_history_entries")
            .select("id,operation_id,created_at,notes,actual_completed_area_ha,material_facts,material_reconciliation_status")
            .eq("company_id", profile.company_id)
            .eq("field_id", fieldId)
            .order("created_at", { ascending: false })
            .limit(500),
          supabase
            .from("field_material_consumptions")
            .select("id,operation_id,product_id,consumed_at,operation_type,quantity,quantity_kg,uom,norm_per_ha,notes")
            .eq("company_id", profile.company_id)
            .eq("field_id", fieldId)
            .order("consumed_at", { ascending: false })
            .limit(1000),
          supabase
            .from("tickets")
            .select("id,finalized_at,net_weight_kg,op_type,status,is_finalized,warehouses:warehouse_to_id(name)")
            .eq("company_id", profile.company_id)
            .eq("field_id", fieldId)
            .eq("op_type", "harvest_incoming")
            .eq("is_finalized", true)
            .order("finalized_at", { ascending: false })
            .limit(500),
          supabase
            .from("warehouse_issue_requests")
            .select(`
              id,
              request_number,
              operation_id,
              return_closed_at,
              warehouse_request_status,
              warehouse_issue_request_items(
                id,
                product_id,
                actual_product_id,
                consumed_quantity,
                unit,
                issued_unit,
                reconciliation_status
              )
            `)
            .eq("company_id", profile.company_id)
            .eq("field_id", fieldId)
            .limit(500),
        ]);

        if (fieldRes.error) throw new Error(fieldRes.error.message);
        if (!fieldRes.data?.id) throw new Error("Поле не найдено");
        if (operationRes.error) throw new Error(operationRes.error.message);
        if (historyRes.error) throw new Error(historyRes.error.message);
        if (harvestRes.error) throw new Error(harvestRes.error.message);
        if (requestRes.error) throw new Error(requestRes.error.message);
        setField(fieldRes.data as FieldRow);

        if (!cropStructureRes.error) {
          setCropRows(
            (cropStructureRes.data || []).map((row: any) => ({
              id: String(row.id),
              seasonYear: row.seasons?.year == null ? null : Number(row.seasons.year),
              cropName: row.crops?.name || "Культура не указана",
              varietyName: row.varieties?.name || null,
              reproductionName: row.seed_reproductions?.name || null,
              area: Number(row.area || 0),
              status: row.status || null,
            }))
          );
        } else {
          setCropRows([]);
        }

        const requestMaterials: RequestMaterial[] = [];
        for (const request of requestRes.data || []) {
          for (const item of (request as any).warehouse_issue_request_items || []) {
            const productId = String(item.actual_product_id || item.product_id || "");
            if (!productId || String(item.reconciliation_status || "") !== "reconciled") continue;
            requestMaterials.push({
              requestId: String((request as any).id),
              requestNumber: String((request as any).request_number || ""),
              operationId: String((request as any).operation_id || ""),
              productId,
              quantity: Number(item.consumed_quantity || 0),
              unit: normalizeUnit(item.issued_unit || item.unit),
              completedAt: (request as any).return_closed_at || null,
            });
          }
        }

        const productIds = new Set<string>();
        for (const row of historyRes.data || []) {
          for (const fact of safeMaterialFacts((row as any).material_facts)) {
            if (fact.product_id) productIds.add(String(fact.product_id));
          }
        }
        for (const material of requestMaterials) productIds.add(material.productId);
        for (const row of legacyConsumptionRes.data || []) {
          if ((row as any).product_id) productIds.add(String((row as any).product_id));
        }

        const productNames = new Map<string, string>();
        if (productIds.size > 0) {
          const { data: products, error: productError } = await supabase
            .from("products")
            .select("id,name,trade_name")
            .in("id", Array.from(productIds));
          if (productError) throw new Error(productError.message);
          for (const product of products || []) {
            productNames.set(
              String((product as any).id),
              String((product as any).trade_name || (product as any).name || "Материал")
            );
          }
        }

        const nextEvents: TimelineEvent[] = [];
        for (const row of operationRes.data || []) {
          nextEvents.push({
            id: `op-${row.id}`,
            happenedAt: String((row as any).completed_at || row.date || ""),
            dateOnly: !(row as any).completed_at,
            eventType: "operation_completed",
            title: `Операция завершена: ${row.operation_type || "полевая работа"}`,
            details: String(row.notes || "").trim() || "Без комментария",
          });
        }

        const consumedKeys = new Set<string>();
        for (const history of historyRes.data || []) {
          const operationId = String((history as any).operation_id || "");
          const historyFacts = safeMaterialFacts((history as any).material_facts);
          for (const fact of historyFacts) {
            const productId = String(fact.product_id || "");
            if (!productId) continue;
            const requestFact = requestMaterials.find(
              (material) => material.operationId === operationId && material.productId === productId
            );
            const quantity = Number(fact.consumed_quantity ?? requestFact?.quantity ?? 0);
            const unit = normalizeUnit(fact.unit || requestFact?.unit);
            const requestNumber = String(fact.request_number || requestFact?.requestNumber || "");
            const productName =
              String(fact.product_name || "").trim() || productNames.get(productId) || "Материал";
            const key = `${operationId}:${productId}:${quantity}:${unit}`;
            consumedKeys.add(key);
            nextEvents.push({
              id: `history-${(history as any).id}-${fact.material_id || productId}`,
              happenedAt: String(requestFact?.completedAt || (history as any).created_at || ""),
              eventType: "material_consumed",
              title: `Материал израсходован: ${productName}`,
              details: [
                requestNumber ? `Заявка ${requestNumber}` : null,
                fact.actual_rate ? `Фактическая норма ${formatQuantity(Number(fact.actual_rate), unit)}/га` : null,
                (history as any).material_reconciliation_status === "reconciled" ? "Сверка закрыта" : null,
              ]
                .filter(Boolean)
                .join(" • "),
              quantity,
              unit,
            });
          }
        }

        if (!legacyConsumptionRes.error) {
          for (const row of legacyConsumptionRes.data || []) {
            const productId = String((row as any).product_id || "");
            const quantity = Number((row as any).quantity ?? (row as any).quantity_kg ?? 0);
            const unit = normalizeUnit((row as any).uom || ((row as any).quantity != null ? null : "kg"));
            const key = `${String((row as any).operation_id || "")}:${productId}:${quantity}:${unit}`;
            if (consumedKeys.has(key)) continue;
            nextEvents.push({
              id: `legacy-cons-${(row as any).id}`,
              happenedAt: String((row as any).consumed_at || ""),
              eventType: "material_consumed",
              title: `Материал израсходован: ${productNames.get(productId) || "Материал"}`,
              details: [
                String((row as any).operation_type || "Операция"),
                (row as any).norm_per_ha
                  ? `Норма ${formatQuantity(Number((row as any).norm_per_ha), unit)}/га`
                  : null,
                (row as any).notes || null,
              ]
                .filter(Boolean)
                .join(" • "),
              quantity,
              unit,
            });
          }
        }

        for (const row of harvestRes.data || []) {
          nextEvents.push({
            id: `harvest-${row.id}`,
            happenedAt: String((row as any).finalized_at || ""),
            eventType: "harvest_received",
            title: "Урожай принят",
            details: `Склад: ${(row as any)?.warehouses?.name || "не указан"}`,
            quantity: row.net_weight_kg == null ? null : Number(row.net_weight_kg),
            unit: "кг",
          });
        }

        nextEvents.sort(
          (a, b) =>
            timelineSortValue(b.happenedAt, b.dateOnly) - timelineSortValue(a.happenedAt, a.dateOnly)
        );
        setEvents(nextEvents);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить карточку поля");
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [fieldId, profile?.company_id]);

  const kpi = useMemo(() => {
    const operationDone = events.filter((item) => item.eventType === "operation_completed").length;
    const materialByUnit = new Map<string, number>();
    for (const item of events.filter((event) => event.eventType === "material_consumed")) {
      const unit = normalizeUnit(item.unit);
      materialByUnit.set(unit, (materialByUnit.get(unit) || 0) + Number(item.quantity || 0));
    }
    const harvestKg = events
      .filter((item) => item.eventType === "harvest_received" && normalizeUnit(item.unit) === "кг")
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const plannedArea = cropRows.reduce((sum, item) => sum + Number(item.area || 0), 0);
    return {
      operationDone,
      materialByUnit: Array.from(materialByUnit.entries()),
      harvestKg,
      plannedArea,
    };
  }, [events, cropRows]);

  if (loading) {
    return <div className="p-4 text-sm text-slate-500">Загрузка карточки поля...</div>;
  }

  if (error || !field) {
    return (
      <div className="space-y-3 p-4">
        <div className="text-sm text-red-600">{error || "Поле не найдено"}</div>
        <Button asChild variant="outline">
          <Link href="/fields">К списку полей</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{getFieldDisplayName(field)}</h1>
          <p className="text-sm text-slate-500">Фактическая история поля</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/fields">К списку полей</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Площадь поля</div>
            <div className="text-lg font-semibold">{formatQuantity(Number(field.area || 0), "га")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Структура посевов</div>
            <div className="text-lg font-semibold">{formatQuantity(kpi.plannedArea, "га")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Завершено операций</div>
            <div className="text-lg font-semibold">{kpi.operationDone}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Израсходовано материалов</div>
            <div className="mt-1 space-y-1 text-sm font-semibold">
              {kpi.materialByUnit.length > 0
                ? kpi.materialByUnit.map(([unit, value]) => <div key={unit}>{formatQuantity(value, unit)}</div>)
                : "Нет факта"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Принято урожая</div>
            <div className="text-lg font-semibold">{formatQuantity(kpi.harvestKg, "кг")}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Структура посевов</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cropRows.length === 0 ? (
            <div className="rounded border border-dashed p-3 text-sm text-slate-500">
              Структура посевов ещё не заполнена.
            </div>
          ) : (
            cropRows.map((row) => (
              <div key={row.id} className="rounded border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {[row.cropName, row.varietyName, row.reproductionName].filter(Boolean).join(" / ")}
                  </div>
                  <Badge variant="outline">
                    {row.seasonYear || "Без сезона"} • {cropStatusLabels[row.status || ""] || "Статус не указан"}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-slate-600">Площадь: {formatQuantity(row.area, "га")}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Хронология фактов</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <div className="rounded border border-dashed p-3 text-sm text-slate-500">
              Подтверждённых событий пока нет.
            </div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="rounded border p-3">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{event.title}</div>
                  <Badge variant="outline">{formatTimelineDate(event.happenedAt, event.dateOnly)}</Badge>
                </div>
                {event.details ? <div className="text-xs text-slate-600">{event.details}</div> : null}
                {event.quantity != null ? (
                  <div className="mt-1 text-xs font-medium text-slate-800">
                    Количество: {formatQuantity(Number(event.quantity), event.unit || "")}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
