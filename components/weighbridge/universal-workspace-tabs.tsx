"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  Filter,
  PackageCheck,
  PackagePlus,
  Plus,
  Sprout,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  UNIVERSAL_WORKSPACE_MAX_TABS,
  type UniversalWorkspaceOperationType,
} from "@/lib/weighbridge/universal-workspaces";

export type UniversalWorkspaceTab = {
  id: string;
  operationType: UniversalWorkspaceOperationType;
  primaryLabel: string;
  secondaryLabel: string;
  fullLabel: string;
  openTicketCount?: number;
  dirty?: boolean;
};

const WORKSPACE_MENU: Array<{
  type: UniversalWorkspaceOperationType;
  label: string;
  icon: typeof Sprout;
}> = [
  { type: "harvest_incoming", label: "Урожай с поля", icon: Sprout },
  { type: "supplier_receipt", label: "От контрагента", icon: PackagePlus },
  { type: "issue_to_field", label: "Выдача в поле", icon: Truck },
  { type: "transfer_between_warehouses", label: "Перемещение", icon: ArrowLeftRight },
  { type: "shipment_outbound", label: "Отгрузка", icon: PackageCheck },
  { type: "disposal_writeoff", label: "Списание", icon: Trash2 },
  { type: "impurity_removal", label: "Примеси", icon: Filter },
];

const operationIcon = (type: UniversalWorkspaceOperationType) =>
  WORKSPACE_MENU.find((item) => item.type === type)?.icon || Sprout;

export function UniversalWorkspaceTabs({
  tabs,
  selectedId,
  disabled = false,
  onSelect,
  onAdd,
  onRemove,
  onLimit,
}: {
  tabs: UniversalWorkspaceTab[];
  selectedId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onAdd: (type: UniversalWorkspaceOperationType) => void;
  onRemove: (id: string) => void;
  onLimit: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const atLimit = tabs.length >= UNIVERSAL_WORKSPACE_MAX_TABS;

  return (
    <section aria-label="Рабочие вкладки Весовой" aria-busy={disabled} className={`flex min-w-0 items-start gap-1.5 border-b border-slate-800/80 pb-2 ${disabled ? "opacity-60" : ""}`}>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 overflow-hidden md:grid-cols-3 xl:grid-cols-6">
        {tabs.map((tab) => {
          const selected = selectedId === tab.id;
          const Icon = operationIcon(tab.operationType);
          return (
            <div
              key={tab.id}
              className={selected
                ? "flex h-11 min-w-0 items-center rounded-md border border-slate-600 bg-slate-800/90 text-slate-50 shadow-[inset_3px_0_0_rgba(250,204,21,0.9)]"
                : "flex h-11 min-w-0 items-center rounded-md border border-transparent bg-slate-950/45 text-slate-200 hover:border-slate-700 hover:bg-slate-900"}
              title={tab.fullLabel}
            >
              <button
                type="button"
                disabled={disabled}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left"
                onClick={() => onSelect(tab.id)}
                aria-pressed={selected}
                aria-label={tab.fullLabel}
              >
                <Icon className={selected ? "h-3.5 w-3.5 shrink-0 text-yellow-300" : "h-3.5 w-3.5 shrink-0 text-slate-500"} />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block truncate text-xs font-semibold leading-none">{tab.primaryLabel}</span>
                  <span className={selected ? "block truncate text-[10px] leading-none text-slate-300" : "block truncate text-[10px] leading-none text-slate-400"}>
                    {tab.secondaryLabel}
                  </span>
                </span>
                {tab.dirty ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" title="Есть несохранённые данные" aria-label="Есть несохранённые данные" /> : null}
                {Number(tab.openTicketCount || 0) > 0 ? (
                  <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full border border-amber-400/50 bg-amber-400/10 px-1 text-[9px] font-bold text-amber-200">
                    {tab.openTicketCount}
                  </span>
                ) : null}
              </button>
              <Button
                type="button"
                disabled={disabled}
                variant="ghost"
                size="icon"
                className="h-8 w-7 shrink-0 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label={`Закрыть вкладку: ${tab.fullLabel}`}
                title="Закрыть вкладку"
                onClick={() => onRemove(tab.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
      <Popover open={disabled ? false : menuOpen} onOpenChange={(next) => {
        if (disabled) return;
        if (next && atLimit) {
          onLimit();
          setMenuOpen(false);
          return;
        }
        setMenuOpen(next);
      }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            disabled={disabled}
            size="icon"
            className="h-9 w-9 shrink-0 bg-yellow-400 text-slate-950 hover:bg-yellow-300"
            aria-label="Добавить вкладку"
            title="Добавить вкладку"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 border-slate-700 bg-slate-950 p-1 text-slate-100">
          {WORKSPACE_MENU.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.type}
                type="button"
                disabled={disabled}
                className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-slate-800"
                onClick={() => {
                  onAdd(item.type);
                  setMenuOpen(false);
                }}
              >
                <Icon className="h-4 w-4 text-yellow-300" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    </section>
  );
}
