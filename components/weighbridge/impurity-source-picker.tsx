"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

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
  placeholder = "Выберите партию урожая", optionsStatus = "ready",
}: ImpuritySourcePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Labels may outlive a refresh result; availability may not.
  const knownLabels = useRef(new Map<string, string>());
  const knownDescriptions = useRef(new Map<string, string>());
  useEffect(() => {
    const retained = new Set([...value, ...options.map((option) => option.key)]);
    knownLabels.current.forEach((_label, key) => {
      if (!retained.has(key)) {
        knownLabels.current.delete(key);
        knownDescriptions.current.delete(key);
      }
    });
    options.forEach((option) => {
      knownLabels.current.set(option.key, option.label);
      if (option.description) knownDescriptions.current.set(option.key, option.description);
      else knownDescriptions.current.delete(option.key);
    });
  }, [options, value]);
  const optionByKey = useMemo(() => new Map(options.map((option) => [option.key, option])), [options]);
  const selected = Array.from(new Set(value));
  const unavailableKeys = selected.filter((key) => !optionByKey.has(key));
  const refreshing = optionsStatus === "loading" || optionsStatus === "refreshing" || optionsStatus === "idle";
  const fieldDisabled = disabled;
  const labelFor = (key: string) => optionByKey.get(key)?.label || knownLabels.current.get(key) || "Ранее выбранная партия";
  const descriptionFor = (key: string) => optionByKey.get(key)?.description || knownDescriptions.current.get(key) || "";
  const summary = selected.length === 1
    ? [descriptionFor(selected[0]), labelFor(selected[0])].filter(Boolean).join(" · ")
    : selected.length ? `Выбрано партий: ${selected.length} — выберите одну` : "";
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const filteredOptions = useMemo(() => {
    return options.filter((option) => (
      !normalizedQuery
      || [option.label, option.description, option.groupLabel]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru")
        .includes(normalizedQuery)
    ));
  }, [options, normalizedQuery]);

  useEffect(() => {
    if (!expanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setExpanded(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [expanded]);

  const beginSearch = () => {
    if (fieldDisabled) return;
    setQuery("");
    setExpanded(true);
  };

  const close = () => {
    setExpanded(false);
    setQuery("");
  };

  const select = (option: ImpuritySourcePickerOption) => {
    if (disabled) return;
    onChange([option.key]);
    close();
  };

  return (
    <div ref={rootRef} className="relative" data-testid="impurity-source-picker">
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
        <div id={listId} role="listbox" aria-label="Выбор партии урожая" className="travkin-scrollbar absolute z-30 mt-1 max-h-80 w-full overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-lg">
            {unavailableKeys.map((key) => (
              <div key={key} className="border-b border-border bg-amber-500/10 px-3 py-2 text-sm text-foreground">
                {labelFor(key)} · {refreshing ? "проверяем остаток" : "нет в текущем списке"}
              </div>
            ))}
            {filteredOptions.map((option) => {
              const checked = selected.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  disabled={disabled}
                  className={`flex min-h-12 w-full items-start gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 ${checked ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                  onClick={() => select(option)}
                >
                  <Check className={`mt-0.5 h-4 w-4 shrink-0 text-primary ${checked ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">{option.label}</span>
                    {option.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span> : null}
                  </span>
                </button>
              );
            })}
            {!filteredOptions.length ? <p className="py-3 text-center text-sm text-muted-foreground">{refreshing ? "Загружаем партии…" : options.length ? "По вашему запросу ничего не найдено" : "На складе нет доступных партий"}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
