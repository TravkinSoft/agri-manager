"use client";

import { CalendarDays, MapPin, PackageOpen, Scale, Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HarvestBatchSummary } from "@/lib/types/weighbridge";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: HarvestBatchSummary | null;
};

const kg = (value: number) =>
  `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;

const rate = (value: number | null) =>
  value == null ? "Не рассчитана" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т/га`;

function formatDate(value?: string | null): string {
  if (!value) return "Не указано";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Не указано" : date.toLocaleString("ru-RU");
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "warn" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-slate-100";
  return (
    <div className="min-w-0 border-l border-slate-800 pl-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export function HarvestBatchDialog({ open, onOpenChange, batch }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(960px,calc(100vw-32px))] sm:max-w-[960px] sm:rounded-lg">
        {batch ? (
          <>
            <DialogHeader className="shrink-0 border-b border-slate-800 px-5 py-4 text-left">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <PackageOpen className="h-5 w-5 shrink-0 text-emerald-400" />
                    <span className="truncate">{batch.cropName} / {batch.varietyName}</span>
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {batch.batchCode} · {batch.warehouseName}
                  </DialogDescription>
                </div>
                <Badge variant="outline" className="shrink-0">Только просмотр</Badge>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="flex gap-3 border-b border-slate-800 pb-3 sm:border-b-0">
                  <Wheat className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                  <div>
                    <div className="text-xs text-slate-500">Культура, сорт, репродукция</div>
                    <div className="mt-1 font-medium">{batch.cropName} / {batch.varietyName} / {batch.reproductionName}</div>
                  </div>
                </div>
                <div className="flex gap-3 border-b border-slate-800 pb-3 sm:border-b-0">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                  <div>
                    <div className="text-xs text-slate-500">Поле и участок структуры</div>
                    <div className="mt-1 font-medium">{batch.cropStructureLabel}</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                  <div>
                    <div className="text-xs text-slate-500">Сезон и период поступления</div>
                    <div className="mt-1 font-medium">{batch.seasonLabel}</div>
                    <div className="mt-1 text-xs text-slate-400">{formatDate(batch.firstReceivedAt)} — {formatDate(batch.lastReceivedAt)}</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Scale className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                  <div>
                    <div className="text-xs text-slate-500">Исходная операция</div>
                    <div className="mt-1 font-medium">{batch.operationName}</div>
                    <div className="mt-1 text-xs text-slate-400">{batch.warehouseName}</div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-base font-semibold">Масса и урожайность</h3>
                <div className="grid gap-4 border-y border-slate-800 py-4 sm:grid-cols-3">
                  <Metric label="Поступило с поля" value={kg(batch.receivedKg)} />
                  <Metric label="Вывезено примесей" value={kg(batch.removedKg)} tone="warn" />
                  <Metric label="Чистая масса" value={kg(batch.cleanMassKg)} tone="good" />
                  <Metric label="Примеси" value={`${batch.impurityPercent.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}%`} />
                  <Metric label="Валовая урожайность" value={rate(batch.grossYieldTPerHa)} />
                  <Metric label="Чистая урожайность" value={rate(batch.cleanYieldTPerHa)} tone="good" />
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-base font-semibold">Связанные весовые талоны</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="py-2">Талон</th>
                        <th>Операция</th>
                        <th>Дата</th>
                        <th className="text-right">Масса</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.tickets.map((ticket) => (
                        <tr key={ticket.id} className="border-t border-slate-800">
                          <td className="py-2 font-medium">{ticket.ticketNo}</td>
                          <td>{ticket.operation === "harvest_incoming" ? "Поступление с поля" : "Вывоз примесей"}</td>
                          <td>{formatDate(ticket.occurredAt)}</td>
                          <td className="text-right">{kg(ticket.netWeightKg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-base font-semibold">Движения партии</h3>
                <div className="space-y-1">
                  {batch.movements.map((movement) => (
                    <div key={movement.id} className="grid gap-1 border-t border-slate-800 py-2 text-sm sm:grid-cols-[180px_1fr_160px]">
                      <span className="text-slate-500">{formatDate(movement.occurredAt)}</span>
                      <span>{movement.label} · {movement.ticketNo}</span>
                      <span className={`sm:text-right ${movement.direction === "in" ? "text-emerald-300" : "text-amber-300"}`}>
                        {movement.direction === "in" ? "+" : "−"}{kg(movement.quantityKg)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
