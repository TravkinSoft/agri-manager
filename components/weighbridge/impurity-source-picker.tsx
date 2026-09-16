"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isImpuritySourceSelectionBlocked,
  normalizeImpuritySourceSelection,
} from "@/lib/weighbridge/impurity-source-selection";

export type ImpuritySourcePickerOption = {
  key: string;
  label: string;
  description?: string;
  groupLabel?: string;
  supportsSharedSelection: boolean;
};
export type ImpuritySourcePickerOptionsStatus = "idle" | "loading" | "refreshing" | "ready" | "stale" | "error";
type ImpuritySourcePickerProps = {
  options: ImpuritySourcePickerOption[];
  value: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  optionsStatus?: ImpuritySourcePickerOptionsStatus;
};

/** Every selection is saved in the workspace draft; there is no modal commit step. */
export function ImpuritySourcePicker({
  options, value, onChange, disabled = false,
  placeholder = "Выберите участки или партии урожая", optionsStatus = "ready",
}: ImpuritySourcePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  // Labels may outlive a refresh result; availability may not.
  const knownLabels = useRef(new Map<string, string>());
  useEffect(() => {
    const retained = new Set([...value, ...options.map((option) => option.key)]);
    knownLabels.current.forEach((_label, key) => {
      if (!retained.has(key)) knownLabels.current.delete(key);
    });
    options.forEach((option) => knownLabels.current.set(option.key, option.label));
  }, [options, value]);
  const optionByKey = useMemo(() => new Map(options.map((option) => [option.key, option])), [options]);
  const selected = Array.from(new Set(value));
  const unavailableKeys = selected.filter((key) => !optionByKey.has(key));
  const refreshing = optionsStatus === "loading" || optionsStatus === "refreshing" || optionsStatus === "idle";
  const fieldDisabled = disabled && !selected.length;
  const labelFor = (key: string) => optionByKey.get(key)?.label || knownLabels.current.get(key) || "Ранее выбранная партия";
  const summary = selected.length === 1 ? labelFor(selected[0]) : selected.length ? `Выбрано партий: ${selected.length}` : "";
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, ImpuritySourcePickerOption[]>();
    options.forEach((option) => {
      if (normalizedQuery && ![option.label, option.description, option.groupLabel].filter(Boolean).join(" ").toLocaleLowerCase("ru").includes(normalizedQuery)) return;
      const group = option.groupLabel?.trim() || "Без поля";
      const items = groups.get(group) || [];
      items.push(option);
      groups.set(group, items);
    });
    return Array.from(groups.entries());
  }, [options, normalizedQuery]);

  const beginSearch = () => {
    if (fieldDisabled) return;
    setQuery("");
    setExpanded(true);
  };

  const close = () => {
    setExpanded(false);
    setQuery("");
  };

  const toggle = (option: ImpuritySourcePickerOption) => {
    if (disabled) return;
    if (selected.includes(option.key)) {
      onChange(selected.filter((key) => key !== option.key));
      return;
    }
    const availableSelection = normalizeImpuritySourceSelection(selected, options);
    if (isImpuritySourceSelectionBlocked(availableSelection, option, options)) return;
    // A source used by the previous ticket can disappear after the canonical
    // stock refresh. It must not disable every valid source for the next ticket.
    onChange([...availableSelection, option.key]);
  };

  return (
    <div className="space-y-2" data-testid="impurity-source-picker">
      <div className={`flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring ${fieldDisabled ? "cursor-not-allowed opacity-60" : ""}`}>
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-label="Поиск источника примеси"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          disabled={fieldDisabled}
          value={expanded ? query : summary}
          placeholder={expanded ? "Поиск по полю, культуре, сорту" : placeholder}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onFocus={beginSearch}
          onClick={() => { if (!expanded) beginSearch(); }}
          onChange={(event) => {
            setQuery(event.target.value);
            setExpanded(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          disabled={fieldDisabled}
          aria-label={expanded ? "Свернуть список" : "Открыть список"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (expanded) close();
            else beginSearch();
          }}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <div id={listId} role="group" aria-label="Выбор участков и партий урожая" className="space-y-2 pt-1">
          <div className="travkin-scrollbar max-h-80 space-y-3 overflow-y-auto overscroll-contain pr-1">
            {unavailableKeys.map((key) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm">
                <span>{labelFor(key)} · {refreshing ? "проверяем остаток" : "нет в текущем списке"}</span>
                <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(selected.filter((item) => item !== key))}>Убрать</Button>
              </div>
            ))}
            {groupedOptions.map(([group, groupOptions]) => (
              <section key={group} aria-label={group}>
                <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
                <div className="space-y-1">
                  {groupOptions.map((option) => {
                    const checked = selected.includes(option.key);
                    const blocked = disabled || (!checked && isImpuritySourceSelectionBlocked(selected, option, options));
                    return (
                      <button
                        key={option.key}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        disabled={blocked}
                        className={`flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${checked ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"} ${blocked ? "cursor-not-allowed opacity-45" : ""}`}
                        onClick={() => toggle(option)}
                      >
                        <Check className={`h-4 w-4 shrink-0 text-primary ${checked ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug">{option.label}</span>
                          {option.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {!groupedOptions.length ? <p className="py-3 text-center text-sm text-muted-foreground">{refreshing ? "Загружаем партии…" : options.length ? "По вашему запросу ничего не найдено" : "На складе нет доступных источников"}</p> : null}
          </div>
          <Button type="button" variant="ghost" className="min-h-10 w-full" onClick={close}>Готово{selected.length ? ` · выбрано ${selected.length}` : ""}</Button>
        </div>
      ) : null}
    </div>
  );
}
