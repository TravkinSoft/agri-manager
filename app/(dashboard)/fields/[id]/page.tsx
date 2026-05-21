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
};

type TimelineEvent = {
  id: string;
  happenedAt: string;
  eventType: "operation_completed" | "material_consumed" | "harvest_received";
  title: string;
  details: string;
  quantity?: number | null;
  unit?: string | null;
};

function toIso(value: string | null | undefined): string {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  return parsed.toISOString();
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FieldDetailsPage() {
  const params = useParams<{ id: string }>();
  const fieldId = String(params?.id || "").trim();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [field, setField] = useState<FieldRow | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (!profile?.company_id || !fieldId) return;
      setLoading(true);
      setError(null);
      try {
        const [fieldRes, operationRes, consumptionRes, harvestRes] = await Promise.all([
          supabase
            .from("fields")
            .select("id,name,display_name,original_field_key,technical_key,area")
            .eq("company_id", profile.company_id)
            .eq("id", fieldId)
            .maybeSingle(),
          supabase
            .from("operations")
            .select("id,date,operation_type,work_status,notes")
            .eq("company_id", profile.company_id)
            .eq("field_id", fieldId)
            .eq("work_status", "completed")
            .order("date", { ascending: false })
            .limit(500),
          supabase
            .from("field_material_consumptions")
            .select("id,consumed_at,operation_type,quantity_kg,norm_per_ha,notes,products:product_id(name,trade_name)")
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
        ]);

        if (fieldRes.error) throw new Error(fieldRes.error.message);
        if (!fieldRes.data?.id) throw new Error("Field not found");
        setField(fieldRes.data as FieldRow);

        const nextEvents: TimelineEvent[] = [];

        if (!operationRes.error) {
          (operationRes.data || []).forEach((row: any) => {
            nextEvents.push({
              id: `op-${row.id}`,
              happenedAt: toIso(row.date),
              eventType: "operation_completed",
              title: `Operation completed: ${row.operation_type || "-"}`,
              details: String(row.notes || "").trim() || "No comment",
            });
          });
        }

        if (!consumptionRes.error) {
          (consumptionRes.data || []).forEach((row: any) => {
            const productName = row?.products?.trade_name || row?.products?.name || "Material";
            nextEvents.push({
              id: `cons-${row.id}`,
              happenedAt: toIso(row.consumed_at),
              eventType: "material_consumed",
              title: `Material consumed: ${productName}`,
              details: `${row.operation_type || "operation"}${
                row.norm_per_ha ? ` • rate ${Number(row.norm_per_ha).toFixed(3)} kg/ha` : ""
              }${row.notes ? ` • ${row.notes}` : ""}`,
              quantity: row.quantity_kg == null ? null : Number(row.quantity_kg),
              unit: "kg",
            });
          });
        }

        if (!harvestRes.error) {
          (harvestRes.data || []).forEach((row: any) => {
            nextEvents.push({
              id: `harv-${row.id}`,
              happenedAt: toIso(row.finalized_at),
              eventType: "harvest_received",
              title: "Harvest received",
              details: `Warehouse: ${row?.warehouses?.name || "-"}`,
              quantity: row.net_weight_kg == null ? null : Number(row.net_weight_kg),
              unit: "kg",
            });
          });
        }

        nextEvents.sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime());
        setEvents(nextEvents);
      } catch (e: any) {
        setError(e?.message || "Failed to load field card");
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [fieldId, profile?.company_id]);

  const kpi = useMemo(() => {
    const operationDone = events.filter((item) => item.eventType === "operation_completed").length;
    const materialTotalKg = events
      .filter((item) => item.eventType === "material_consumed")
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const harvestKg = events
      .filter((item) => item.eventType === "harvest_received")
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return { operationDone, materialTotalKg, harvestKg };
  }, [events]);

  if (loading) {
    return <div className="p-4 text-sm text-slate-500">Loading field card...</div>;
  }

  if (error || !field) {
    return (
      <div className="space-y-3 p-4">
        <div className="text-sm text-red-600">{error || "Field not found"}</div>
        <Button asChild variant="outline">
          <Link href="/fields">Back to fields</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{getFieldDisplayName(field as any)}</h1>
          <p className="text-sm text-slate-500">Operational timeline (actual facts only)</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/fields">Back to fields</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Field area</div>
            <div className="text-lg font-semibold">{Number(field.area || 0).toFixed(2)} ha</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Completed operations</div>
            <div className="text-lg font-semibold">{kpi.operationDone}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Materials consumed</div>
            <div className="text-lg font-semibold">{kpi.materialTotalKg.toFixed(2)} kg</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Harvest received</div>
            <div className="text-lg font-semibold">{kpi.harvestKg.toFixed(2)} kg</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fact timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <div className="rounded border border-dashed p-3 text-sm text-slate-500">No factual events yet.</div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="rounded border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="font-medium">{event.title}</div>
                  <Badge variant="outline">{formatDateTime(event.happenedAt)}</Badge>
                </div>
                <div className="text-xs text-slate-600">{event.details}</div>
                {event.quantity != null ? (
                  <div className="mt-1 text-xs text-slate-800">
                    Quantity: {Number(event.quantity).toFixed(2)} {event.unit || ""}
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
