"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { isImpuritySourceSelectionBlocked } from "@/lib/weighbridge/impurity-source-selection";

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

/** Every check is saved in the workspace draft; no uncommitted modal copy. */
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
  const labelFor = (key: string) => optionByKey.get(key)?.label || knownLabels.current.get(key) || "Ранее выбранная партия";
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

  const toggle = (option: ImpuritySourcePickerOption) => {
    if (disabled) return;
    if (selected.includes(option.key)) {
      onChange(selected.filter((key) => key !== option.key));
      return;
    }
    if (unavailableKeys.length || isImpuritySourceSelectionBlocked(selected, option, options)) return;
    onChange([...selected, option.key]);
  };

  return (
    <div className="space-y-2" data-testid="impurity-source-picker">
      <Button type="button" variant="outline"
        className="h-auto min-h-12 w-full touch-manipulation justify-between gap-3 px-3 py-2 text-left font-normal"
        disabled={disabled && !selected.length} aria-expanded={expanded} aria-controls={listId}
        onClick={() => setExpanded((current) => !current)}>
        <span className={`min-w-0 whitespace-normal break-words ${selected.length ? "text-foreground" : "text-muted-foreground"}`}>
          {selected.length === 1 ? labelFor(selected[0]) : selected.length ? `Выбрано партий: ${selected.length}` : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-60 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </Button>
      {unavailableKeys.length ? (
        <p role="status" className="text-xs text-amber-800">
          {refreshing ? "Обновляем остатки. Ваш выбор сохранён." : optionsStatus === "ready"
            ? "Выбранная партия сейчас недоступна. Выбор сохранён; проверьте склад или уберите эту партию из выбора."
            : "Не удалось подтвердить остатки. Ваш выбор сохранён; повторите обновление списка."}
        </p>
      ) : null}
      {expanded ? (
        <div id={listId} role="group" aria-label="Выбор участков и партий урожая" className="space-y-3 rounded-lg border bg-background p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 pl-9" placeholder="Поиск по полю, культуре, сорту" aria-label="Поиск источника примеси" />
          </div>
          <p className="text-xs text-muted-foreground">Выбор сохраняется сразу. Можно выбрать одну или несколько точных партий для одного талона примеси.</p>
          <div className="travkin-scrollbar max-h-80 space-y-3 overflow-y-auto overscroll-contain">
            {unavailableKeys.map((key) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded border border-amber-500/40 p-2 text-sm">
                <span>{labelFor(key)} · {refreshing ? "проверяем остаток" : "нет в текущем списке"}</span>
                <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(selected.filter((item) => item !== key))}>Убрать из выбора</Button>
              </div>
            ))}
            {groupedOptions.map(([group, groupOptions]) => (
              <section key={group} aria-label={group}>
                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{group}</div>
                <div className="divide-y rounded-lg border">
                  {groupOptions.map((option) => {
                    const checked = selected.includes(option.key);
                    const blocked = disabled || (!checked && (unavailableKeys.length > 0 || isImpuritySourceSelectionBlocked(selected, option, options)));
                    const checkboxId = `${listId}-${option.key}`;
                    return (
                      <div key={option.key} className={`flex min-h-12 items-center gap-3 px-3 ${blocked ? "opacity-50" : ""}`}>
                        <Checkbox id={checkboxId} checked={checked} disabled={blocked} onCheckedChange={() => toggle(option)} className="h-5 w-5" aria-label={option.label} />
                        <label htmlFor={checkboxId} className={`flex min-h-12 min-w-0 flex-1 flex-col justify-center py-2 ${blocked ? "cursor-not-allowed" : "cursor-pointer"}`}>
                          <span className="text-sm font-medium leading-snug">{option.label}</span>
                          {option.description ? <span className="mt-0.5 text-xs text-muted-foreground">{option.description}</span> : null}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {!groupedOptions.length ? <p className="py-3 text-center text-sm text-muted-foreground">{refreshing ? "Загружаем партии…" : options.length ? "По вашему запросу ничего не найдено" : "На складе нет доступных источников"}</p> : null}
          </div>
          <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={() => { setExpanded(false); setQuery(""); }}>Свернуть список{selected.length ? ` · выбрано ${selected.length}` : ""}</Button>
        </div>
      ) : null}
    </div>
  );
}
