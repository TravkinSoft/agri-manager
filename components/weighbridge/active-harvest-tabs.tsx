"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { Anchor } from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
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
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
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
  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, visible.length - 1));

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-option-index="${boundedActiveIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [boundedActiveIndex, open, query]);

  const beginSearch = () => {
    if (disabled || inputRef.current?.matches(":disabled")) return;
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  };

  const choose = (option: SearchableComboboxOption) => {
    if (disabled || inputRef.current?.matches(":disabled")) return;
    onValueChange(option.value);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => {
      if (!next) {
        setOpen(false);
        setQuery("");
        setActiveIndex(0);
      }
    }}>
      <Anchor asChild>
        <div
          ref={anchorRef}
          className={`flex h-10 min-w-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-foreground focus-within:ring-2 focus-within:ring-ring ${disabled ? "opacity-50" : ""}`}
        >
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            role="combobox"
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open && !disabled}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && visible.length ? `${listId}-${boundedActiveIndex}` : undefined}
            autoComplete="off"
            disabled={disabled}
            value={open ? query : selected?.label || ""}
            placeholder={open ? searchPlaceholder : placeholder}
            className="h-full w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onFocus={beginSearch}
            onClick={() => { if (!open) beginSearch(); }}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                if (open) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  setQuery("");
                }
                return;
              }
              if (event.key === "Tab") {
                setOpen(false);
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) {
                  beginSearch();
                  return;
                }
                setActiveIndex((index) => Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (open && visible[boundedActiveIndex]) choose(visible[boundedActiveIndex]);
                else beginSearch();
              }
            }}
          />
          <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </Anchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] border-border bg-background p-1 text-foreground"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listAriaLabel}
          className="travkin-scrollbar max-h-64 overflow-y-auto overflow-x-hidden overscroll-contain"
          onWheel={(event) => event.stopPropagation()}
        >
          {visible.map((option, index) => (
            <button
              id={`${listId}-${index}`}
              data-option-index={index}
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              tabIndex={-1}
              className={`flex min-h-11 w-full items-start gap-2 rounded-sm px-3 py-2 text-left text-sm text-foreground ${index === boundedActiveIndex ? "bg-accent" : ""}`}
              onPointerMove={() => setActiveIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <Check aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${value === option.value ? "opacity-100" : "opacity-0"}`} />
              <span className="min-w-0 flex-1">
                <span className="block break-words font-medium">{option.label}</span>
                {option.description ? <span className="block break-words text-xs text-muted-foreground">{option.description}</span> : null}
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
