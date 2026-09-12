"use client";

import { useState } from "react";
import { ChevronDown, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HARVEST_TIME_ZONE, type HarvestOverview } from "@/lib/dashboard/harvest-summary";

type PotatoDriverRow = HarvestOverview["potatoDrivers"][number];

function tonnes(valueKg: number): string {
  return `${(Number(valueKg || 0) / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} т`;
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: HARVEST_TIME_ZONE,
      });
}

function driverCountLabel(value: number): string {
  const absolute = Math.abs(Math.trunc(value));
  const word = absolute % 100 >= 11 && absolute % 100 <= 14
    ? "водителей"
    : absolute % 10 === 1
      ? "водитель"
      : absolute % 10 >= 2 && absolute % 10 <= 4
        ? "водителя"
        : "водителей";
  return `${value} ${word}`;
}

export function PotatoDriverSummary({ rows }: { rows: PotatoDriverRow[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
              <Truck className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Водители по картофелю</h2>
              <p className="text-xs text-muted-foreground">Завершённые рейсы и фактическое нетто за выбранный период</p>
            </div>
          </div>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" className="min-h-10 gap-2" aria-label={`${open ? "Скрыть" : "Показать"} статистику водителей по картофелю`}>
              {rows.length ? driverCountLabel(rows.length) : "Нет рейсов"}
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <CardContent className="border-t border-border p-0">
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-4 py-3 font-medium">Водитель</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Рейсов</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Нетто</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Средний рейс</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Последний рейс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={row.key} className="border-b border-border/70 last:border-b-0">
                        <td className="px-4 py-3 font-medium text-foreground"><span className="mr-2 text-xs tabular-nums text-muted-foreground">{index + 1}</span>{row.driverName}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">{row.tripCount}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{tonnes(row.netWeightKg)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{tonnes(row.averageNetWeightKg)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{dateTime(row.lastTripAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-5 text-sm text-muted-foreground">За выбранный период завершённых картофельных рейсов нет.</p>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
