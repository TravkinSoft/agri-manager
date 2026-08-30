"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SearchableComboboxOption } from "@/components/weighbridge/searchable-combobox";

export type HarvestIntakeTab = {
  id: string;
  ordinal: number;
  primaryLabel: string;
  secondaryLabel: string;
  fullLabel: string;
};

type HarvestIntakeTabsProps = {
  tabs: HarvestIntakeTab[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
};

const DEFAULT_MAX_VISIBLE_OPTIONS = 120;

export function HarvestAllocationPicker({
  value,
  options,
  onValueChange,
  disabled = false,
  placeholder = "Выберите поле или участок",
  searchPlaceholder = "Поле, культура, сорт или репродукция",
  emptyLabel = "Участок не найден",
  ariaLabel = "Поле или участок",
  listAriaLabel = "Участки активного сезона",
  maxVisible = DEFAULT_MAX_VISIBLE_OPTIONS,
}: {
  value: string;
  options: SearchableComboboxOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  ariaLabel?: string;
  listAriaLabel?: string;
  maxVisible?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const selected = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value]
  );
  const filtered = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("ru-RU");
    if (!normalizedQuery) return options;
    return options.filter((option) => [
      option.label,
      option.description || "",
      ...(option.keywords || []),
    ].join(" ").toLocaleLowerCase("ru-RU").includes(normalizedQuery));
  }, [deferredQuery, options]);
  const visible = filtered.slice(0, maxVisible);

  const choose = (option: SearchableComboboxOption) => {
    onValueChange(option.value);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) {
        setQuery("");
        setActiveIndex(0);
      }
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className="h-10 w-full justify-between border-slate-700 bg-slate-950 px-3 text-left font-normal text-slate-100 hover:bg-slate-900"
        >
          <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
          <span aria-hidden="true" className="ml-2 shrink-0 text-slate-500">⌄</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] border-slate-700 bg-slate-950 p-0 text-slate-100"
      >
        <div className="border-b border-slate-800 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(0, visible.length - 1)));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
                return;
              }
              if (event.key === "Enter" && visible[activeIndex]) {
                event.preventDefault();
                choose(visible[activeIndex]);
              }
            }}
            placeholder={searchPlaceholder}
            aria-label={`Поиск: ${ariaLabel.toLocaleLowerCase("ru-RU")}`}
            className="border-slate-700 bg-slate-900 text-slate-100"
          />
        </div>
        <div
          role="listbox"
          aria-label={listAriaLabel}
          className="max-h-64 overflow-y-auto overflow-x-hidden overscroll-contain p-1 travkin-scrollbar"
          onWheel={(event) => event.stopPropagation()}
        >
          {visible.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={index === activeIndex
                ? "flex w-full items-start gap-2 rounded-md bg-slate-800 px-3 py-2 text-left"
                : "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-slate-900"}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span aria-hidden="true" className={value === option.value ? "mt-0.5 text-yellow-400" : "mt-0.5 text-transparent"}>✓</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-100">{option.label}</span>
                {option.description ? <span className="block truncate text-xs text-slate-400">{option.description}</span> : null}
              </span>
            </button>
          ))}
          {visible.length === 0 ? <div className="px-3 py-6 text-center text-sm text-slate-500">{emptyLabel}</div> : null}
          {filtered.length > visible.length ? (
            <div className="px-3 py-2 text-center text-xs text-slate-500">Показаны первые {maxVisible}. Уточните поиск.</div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function HarvestIntakeTabs({ tabs, selectedId, onSelect, onAdd, onRemove }: HarvestIntakeTabsProps) {
  const showTabs = tabs.length > 1;
  const atLimit = tabs.length >= 4;

  if (!showTabs) {
    return (
      <div className="flex h-9 justify-end">
        <Button
          type="button"
          size="icon"
          className="h-8 w-8 bg-yellow-400 text-slate-950 hover:bg-yellow-300"
          aria-label="Добавить приёмку"
          title="Добавить приёмку"
          onClick={onAdd}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="Рабочие приёмки" className="flex h-14 min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-slate-800 bg-[#0b1220]/92 px-2">
      <div
        className="grid min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-1"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const selected = selectedId === tab.id;
          return (
            <div
              key={tab.id}
              className={selected
                ? "flex h-10 min-w-0 items-center rounded-md border border-yellow-400/70 bg-yellow-400/10 text-slate-50"
                : "flex h-10 min-w-0 items-center rounded-md border border-slate-700 bg-slate-950/75 text-slate-100 hover:border-slate-600"}
              title={tab.fullLabel}
            >
              <button
                type="button"
                className="flex h-full min-w-0 flex-1 items-center px-2 text-left"
                onClick={() => onSelect(tab.id)}
                aria-pressed={selected}
                aria-label={`Приёмка ${tab.ordinal}: ${tab.fullLabel}`}
              >
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block truncate text-xs font-bold leading-none">{tab.primaryLabel}</span>
                  <span className={selected ? "block truncate text-[10px] leading-none text-yellow-100/75" : "block truncate text-[10px] leading-none text-slate-400"}>
                    {tab.secondaryLabel}
                  </span>
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={selected ? "h-8 w-7 shrink-0 text-yellow-100/70 hover:bg-yellow-400/10 hover:text-yellow-100" : "h-8 w-7 shrink-0 text-slate-400 hover:bg-slate-800"}
                aria-label={`Закрыть Приёмку ${tab.ordinal}`}
                title={`Закрыть Приёмку ${tab.ordinal}`}
                onClick={() => onRemove(tab.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        size="icon"
        className={atLimit
          ? "h-8 w-8 shrink-0 bg-slate-800 text-slate-500 hover:bg-slate-800"
          : "h-8 w-8 shrink-0 bg-yellow-400 text-slate-950 hover:bg-yellow-300"}
        aria-label={atLimit ? "Максимум 4 приёмки" : "Добавить приёмку"}
        title={atLimit ? "Можно открыть не более четырёх параллельных приёмок" : "Добавить приёмку"}
        onClick={onAdd}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </section>
  );
}
