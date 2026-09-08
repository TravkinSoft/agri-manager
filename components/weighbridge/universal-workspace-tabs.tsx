"use client";

import { useEffect, useRef, useState } from "react";
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
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const atLimit = tabs.length >= UNIVERSAL_WORKSPACE_MAX_TABS;

  useEffect(() => {
    const selected = tabButtonRefs.current.get(selectedId);
    if (!selected) return;
    selected.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [selectedId, tabs.length]);

  const moveKeyboardFocus = (currentId: string, key: string) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key) || tabs.length === 0) return false;
    const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === currentId));
    const nextIndex = key === "Home"
      ? 0
      : key === "End"
        ? tabs.length - 1
        : key === "ArrowLeft"
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return false;
    onSelect(next.id);
    tabButtonRefs.current.get(next.id)?.focus();
    return true;
  };

  return (
    <section aria-label="Рабочие вкладки Весовой" aria-busy={disabled} className={`flex min-w-0 items-center gap-1.5 rounded-lg bg-slate-950/40 p-1.5 ${disabled ? "opacity-60" : ""}`}>
      <div role="tablist" aria-label="Открытые задачи Весовой" className="travkin-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden">
        {tabs.map((tab) => {
          const selected = selectedId === tab.id;
          const Icon = operationIcon(tab.operationType);
          return (
            <div
              key={tab.id}
              className={selected
                ? "flex h-11 min-w-[11rem] max-w-[18rem] shrink-0 items-center rounded-md bg-slate-800/90 text-slate-50 shadow-[inset_0_-2px_0_rgba(250,204,21,0.9)] transition-colors duration-150 motion-reduce:transition-none"
                : "flex h-11 min-w-[11rem] max-w-[18rem] shrink-0 items-center rounded-md bg-transparent text-slate-300 transition-colors duration-150 hover:bg-slate-900/90 hover:text-slate-50 motion-reduce:transition-none"}
              title={tab.fullLabel}
            >
              <button
                type="button"
                role="tab"
                id={`weighbridge-workspace-tab-${tab.id}`}
                aria-controls="weighbridge-workspace-panel"
                disabled={disabled}
                tabIndex={selected ? 0 : -1}
                ref={(node) => {
                  if (node) tabButtonRefs.current.set(tab.id, node);
                  else tabButtonRefs.current.delete(tab.id);
                }}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left"
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => {
                  if (moveKeyboardFocus(tab.id, event.key)) event.preventDefault();
                }}
                aria-selected={selected}
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
                className="h-8 w-7 shrink-0 text-slate-500 hover:bg-slate-700/70 hover:text-slate-100"
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
            className="h-9 w-9 shrink-0 bg-yellow-400 text-slate-950 shadow-none hover:bg-yellow-300"
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
