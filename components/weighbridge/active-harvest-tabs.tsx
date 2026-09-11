"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SearchableComboboxOption } from "@/components/weighbridge/searchable-combobox";
import { rankHarvestPhysicalFieldSearch } from "@/lib/weighbridge/field-picker";

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
  physicalFieldSearch = false,
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
  physicalFieldSearch?: boolean;
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
    if (physicalFieldSearch) {
      return options
        .map((option, index) => ({
          option,
          index,
          rank: option.physicalFieldSearch
            ? rankHarvestPhysicalFieldSearch(option.physicalFieldSearch, deferredQuery)
            : null,
        }))
        .filter((entry): entry is typeof entry & { rank: number } => entry.rank != null)
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .map((entry) => entry.option);
    }
    return options.filter((option) => [
      option.label,
      option.description || "",
      ...(option.keywords || []),
    ].join(" ").toLocaleLowerCase("ru-RU").includes(normalizedQuery));
  }, [deferredQuery, options, physicalFieldSearch]);
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
          className="h-10 w-full justify-between border-border bg-background px-3 text-left font-normal text-foreground hover:bg-background"
        >
          <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
          <span aria-hidden="true" className="ml-2 shrink-0 text-muted-foreground">⌄</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] border-border bg-background p-0 text-foreground"
      >
        <div className="border-b border-border p-2">
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
            className="border-border bg-background text-foreground"
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
                ? "flex w-full items-start gap-2 rounded-md bg-muted px-3 py-2 text-left"
                : "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-background"}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span aria-hidden="true" className={value === option.value ? "mt-0.5 text-amber-800" : "mt-0.5 text-transparent"}>✓</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{option.label}</span>
                {option.description ? <span className="block truncate text-xs text-muted-foreground">{option.description}</span> : null}
              </span>
            </button>
          ))}
          {visible.length === 0 ? <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div> : null}
          {filtered.length > visible.length ? (
            <div className="px-3 py-2 text-center text-xs text-muted-foreground">Показаны первые {maxVisible}. Уточните поиск.</div>
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
          className="h-8 w-8 bg-primary text-primary-foreground hover:bg-primary"
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
    <section aria-label="Рабочие приёмки" className="flex h-14 min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-border bg-card px-2">
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
                ? "flex h-10 min-w-0 items-center rounded-md border border-primary bg-accent text-foreground"
                : "flex h-10 min-w-0 items-center rounded-md border border-border bg-background text-foreground hover:border-border"}
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
                  <span className={selected ? "block truncate text-[10px] leading-none text-amber-800" : "block truncate text-[10px] leading-none text-muted-foreground"}>
                    {tab.secondaryLabel}
                  </span>
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={selected ? "h-8 w-7 shrink-0 text-foreground hover:bg-muted hover:text-foreground" : "h-8 w-7 shrink-0 text-muted-foreground hover:bg-muted"}
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
          ? "h-8 w-8 shrink-0 bg-muted text-muted-foreground hover:bg-muted"
          : "h-8 w-8 shrink-0 bg-primary text-primary-foreground hover:bg-primary"}
        aria-label={atLimit ? "Максимум 4 приёмки" : "Добавить приёмку"}
        title={atLimit ? "Можно открыть не более четырёх параллельных приёмок" : "Добавить приёмку"}
        onClick={onAdd}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </section>
  );
}
