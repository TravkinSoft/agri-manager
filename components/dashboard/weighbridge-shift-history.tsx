"use client";

import { useState } from "react";
import { ChevronDown, Scale } from "lucide-react";
import { WeighbridgeShiftReportView } from "@/components/weighbridge/shift-report";
import type { HarvestOverview } from "@/lib/dashboard/harvest-summary";
import { isWeighbridgeShiftReport } from "@/lib/weighbridge/shift-report";

type Shift = NonNullable<HarvestOverview["weighbridgeShifts"]>[number];

function tonnes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Итог уточняется";
  return `${(value / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
}

function shiftDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    timeZone: "Asia/Qyzylorda",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shiftResult(shift: Shift): string {
  if (isWeighbridgeShiftReport(shift.summary_json)) return tonnes(shift.summary_json.potatoPeriodResultKg);
  if (shift.summary_json?.version === "weighbridge_shift_snapshot_v1") {
    return tonnes(shift.summary_json.potatoPeriodResultKg ?? shift.summary_json.potatoCleanKg);
  }
  return shift.status === "open" ? "Идёт сейчас" : "Без сохранённого отчёта";
}

export function WeighbridgeShiftHistory({ shifts }: { shifts: Shift[] }) {
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const selectedShift = shifts.find((shift) => shift.id === selectedShiftId)
    || shifts.find((shift) => isWeighbridgeShiftReport(shift.summary_json))
    || shifts[0];
  const currentShift = shifts[0];
  const savedReports = shifts.filter((shift) => isWeighbridgeShiftReport(shift.summary_json)).length;
  if (!selectedShift || !currentShift) return null;

  return (
    <details className="group border-y border-border" aria-label="Сводка смен весовой">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 py-2 marker:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--manor-paper-raised)] text-[color:var(--manor-brass-soft)]">
          <Scale className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-foreground">Сводка весовой</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {currentShift.status === "open" ? `Смена открыта · ${shiftDate(currentShift.opened_at)}` : `Последняя смена · ${shiftDate(currentShift.opened_at)}`} · {shiftResult(currentShift)}
          </span>
        </span>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">{savedReports} {savedReports === 1 ? "отчёт" : "отчёта"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>

      <div className="border-t border-border pb-3">
        <div className="travkin-scrollbar flex gap-1.5 overflow-x-auto py-2" role="tablist" aria-label="Смены весовой">
          {shifts.map((shift) => {
            const selected = shift.id === selectedShift.id;
            return (
              <button
                key={shift.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSelectedShiftId(shift.id)}
                className={`min-w-[150px] shrink-0 rounded-lg px-3 py-2 text-left transition-colors ${selected ? "bg-[color:var(--manor-paper-raised)] text-foreground" : "text-muted-foreground hover:bg-card/60 hover:text-foreground"}`}
              >
                <span className="block text-[10px] font-medium">{shift.status === "open" ? "Сейчас" : shiftDate(shift.opened_at)}</span>
                <span className="mt-1 block truncate text-xs font-semibold tabular-nums">{shiftResult(shift)}</span>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" aria-label={`Смена ${shiftDate(selectedShift.opened_at)}`}>
          {isWeighbridgeShiftReport(selectedShift.summary_json) ? (
            <WeighbridgeShiftReportView report={selectedShift.summary_json} variant="dashboard" />
          ) : selectedShift.summary_json?.version === "weighbridge_shift_snapshot_v1" ? (
            <div className="grid gap-2 border-t border-border py-3 text-xs sm:grid-cols-3">
              <div><span className="text-muted-foreground">Итог смены</span><strong className="mt-1 block text-lg tabular-nums">{shiftResult(selectedShift)}</strong></div>
              <div><span className="text-muted-foreground">Принято</span><strong className="mt-1 block text-lg tabular-nums">{tonnes(selectedShift.summary_json.potatoNetKg)}</strong></div>
              <div><span className="text-muted-foreground">Закрыто талонов</span><strong className="mt-1 block text-lg tabular-nums">{selectedShift.summary_json.closedTicketCount ?? 0}</strong></div>
            </div>
          ) : (
            <p className="border-t border-border py-3 text-xs text-muted-foreground">
              {selectedShift.status === "open" ? "Итог появится здесь после закрытия смены весовщиком." : "Эта смена закрыта без сохранённого отчёта."}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
