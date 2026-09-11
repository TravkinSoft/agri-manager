"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type ImpuritySourcePickerOption = {
  key: string;
  label: string;
  description?: string;
  groupLabel?: string;
  supportsSharedSelection: boolean;
};

type ImpuritySourcePickerProps = {
  options: ImpuritySourcePickerOption[];
  value: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function ImpuritySourcePicker({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "Выберите участки или партии урожая",
}: ImpuritySourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftValue, setDraftValue] = useState<string[]>(value);
  const optionByKey = useMemo(
    () => new Map(options.map((option) => [option.key, option])),
    [options]
  );
  const selectedOptions = useMemo(
    () => value.map((key) => optionByKey.get(key)).filter((option): option is ImpuritySourcePickerOption => Boolean(option)),
    [optionByKey, value]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) => [option.label, option.description, option.groupLabel]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("ru")
      .includes(normalizedQuery));
  }, [normalizedQuery, options]);
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, ImpuritySourcePickerOption[]>();
    filteredOptions.forEach((option) => {
      const group = option.groupLabel?.trim() || "Без поля";
      groups.set(group, [...(groups.get(group) || []), option]);
    });
    return Array.from(groups.entries());
  }, [filteredOptions]);
  const draftOptions = useMemo(
    () => draftValue.map((key) => optionByKey.get(key)).filter((option): option is ImpuritySourcePickerOption => Boolean(option)),
    [draftValue, optionByKey]
  );
  const selectedContainsLegacyFallback = draftOptions.some((option) => !option.supportsSharedSelection);
  const hasIncompleteSharedSelection = draftOptions.length === 1 && draftOptions[0].supportsSharedSelection;

  const toggle = (option: ImpuritySourcePickerOption) => {
    if (draftValue.includes(option.key)) {
      setDraftValue(draftValue.filter((key) => key !== option.key));
      return;
    }
    if (draftValue.length > 0 && (!option.supportsSharedSelection || selectedContainsLegacyFallback)) return;
    setDraftValue([...draftValue, option.key]);
  };

  const triggerLabel = selectedOptions.length === 0
    ? placeholder
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `Выбрано источников: ${selectedOptions.length}`;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-12 w-full touch-manipulation justify-between gap-3 px-3 py-2 text-left font-normal"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setDraftValue(value);
          setOpen(true);
        }}
      >
        <span className={selectedOptions.length ? "min-w-0 truncate text-foreground" : "min-w-0 truncate text-muted-foreground"}>
          {triggerLabel}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
      </Button>

      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setDraftValue(value);
          else setQuery("");
        }}
      >
        <SheetContent side="bottom" showClose={false} className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:left-1/2 sm:right-auto sm:w-[calc(100vw-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:p-0">
          <Button
            type="button"
            variant="ghost"
            className="absolute right-2 top-2 z-10 h-12 w-12 touch-manipulation p-0"
            aria-label="Закрыть выбор участков"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
          <SheetHeader className="border-b px-4 pb-4 pt-5 pr-12 text-left sm:px-6">
            <SheetTitle>Участки / партии урожая</SheetTitle>
            <SheetDescription>
              Для одного источника выберите всю партию. Точные участки можно объединить в один физический талон набором от двух.
            </SheetDescription>
          </SheetHeader>

          <div className="border-b px-4 py-3 sm:px-6">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-12 pl-9 text-base"
                placeholder="Поиск по полю, культуре, сорту"
                aria-label="Поиск источника примеси"
              />
            </div>
          </div>

          <div className="travkin-scrollbar min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
            {options.length ? (
              <p className="mb-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                «Вся партия» — одиночный режим. Точные участки выбираются только совместно, минимум два.
              </p>
            ) : null}
            {groupedOptions.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {options.length ? "По вашему запросу ничего не найдено" : "На складе нет доступных источников"}
              </div>
            ) : groupedOptions.map(([group, groupOptions]: [string, ImpuritySourcePickerOption[]]) => (
              <section key={group} className="mb-4 last:mb-0" aria-label={group}>
                <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
                <div className="divide-y rounded-lg border bg-background">
                  {groupOptions.map((option) => {
                    const checked = draftValue.includes(option.key);
                    const selectionBlocked = !checked
                      && draftValue.length > 0
                      && (!option.supportsSharedSelection || selectedContainsLegacyFallback);
                    const checkboxId = `impurity-source-${option.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                    return (
                      <div key={option.key} className={`flex min-h-12 touch-manipulation items-center gap-3 px-3 ${selectionBlocked ? "opacity-50" : ""}`}>
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          disabled={selectionBlocked}
                          onCheckedChange={() => toggle(option)}
                          className="h-5 w-5"
                          aria-label={option.label}
                        />
                        <label
                          htmlFor={checkboxId}
                          className={`flex min-h-12 min-w-0 flex-1 flex-col justify-center py-2 ${selectionBlocked ? "cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <span className="text-sm font-medium leading-snug text-foreground">{option.label}</span>
                          {option.description ? <span className="mt-0.5 text-xs text-muted-foreground">{option.description}</span> : null}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="border-t bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
            {hasIncompleteSharedSelection ? (
              <p className="mb-2 text-sm font-medium text-amber-900" role="alert">
                Для одного источника выберите партию целиком или добавьте второй участок
              </p>
            ) : null}
            <Button
              type="button"
              className="min-h-12 w-full touch-manipulation"
              disabled={hasIncompleteSharedSelection}
              onClick={() => {
                onChange(draftValue);
                setOpen(false);
              }}
            >
              {draftValue.length ? `Выбрано ${draftValue.length} · Готово` : "Готово"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
