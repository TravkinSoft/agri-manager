"use client";

import { Scale, Tractor, Truck } from "lucide-react";
import { SUMMARY_SECTIONS, type SummarySection } from "@/lib/dashboard/summary-sections";
import { summaryShiftLabel, type SummaryPresence, type SummaryShift } from "@/lib/dashboard/operational-summary";

const ICONS = { weighbridge: Scale, combine: Tractor, traffic: Truck };
export type SelectedSummaryShift = { shift: SummaryShift | null | undefined; healthy: boolean };
export function SummarySectionTabs({ value, onChange, presence, presenceHealthy = false, selectedShifts }: {
  value: SummarySection; onChange: (value: SummarySection) => void;
  presence?: SummaryPresence | null; presenceHealthy?: boolean; now?: number;
  selectedShifts?: Partial<Record<"weighbridge" | "combine", SelectedSummaryShift>>;
}) {
  return (
    <div role="tablist" aria-label="Разделы сводки" className="grid grid-cols-3 gap-1 border-b border-border pb-2">
      {SUMMARY_SECTIONS.map((section, index) => {
        const Icon = ICONS[section.id];
        const selected = value === section.id;
        const selectedShift = section.id === "traffic" ? undefined : selectedShifts?.[section.id];
        const shift = selectedShift ? selectedShift.shift : section.id === "traffic" ? undefined : presence?.[section.id]?.shift;
        const shiftLabel = summaryShiftLabel(shift, selectedShift ? selectedShift.healthy : presenceHealthy);
        return <button key={section.id} id={`summary-tab-${section.id}`} type="button" role="tab"
          aria-selected={selected} aria-controls={`summary-panel-${section.id}`} tabIndex={selected ? 0 : -1}
          onClick={() => onChange(section.id)}
          onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % SUMMARY_SECTIONS.length
              : event.key === "ArrowLeft" ? (index + SUMMARY_SECTIONS.length - 1) % SUMMARY_SECTIONS.length
              : event.key === "Home" ? 0 : event.key === "End" ? SUMMARY_SECTIONS.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            onChange(SUMMARY_SECTIONS[next].id);
            (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next])?.focus();
          }}
          className={`flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-lg px-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-2 sm:text-sm ${selected ? "bg-[color:var(--manor-paper-raised)] text-foreground ring-1 ring-inset ring-[color:var(--manor-brass-soft)]" : "text-muted-foreground hover:bg-card hover:text-foreground"}`}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex min-w-0 flex-col items-start gap-0.5 py-1.5 text-left">
            <span>{section.label}</span>
            {section.id !== "traffic" ? <span className={`flex items-center gap-1 text-[10px] font-medium ${shiftLabel === "Смена открыта" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${shiftLabel === "Смена открыта" ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              {shiftLabel}
            </span> : null}
          </span>
        </button>;
      })}
    </div>
  );
}
