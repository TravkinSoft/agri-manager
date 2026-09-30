"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Anchor } from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type InlineSearchOption = {
  value: string;
  label: string;
  description?: string;
  status?: string;
  group?: string;
  keywords?: string[];
};

export const normalizeComboboxSearch = (value: string) => value
  .normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("ru-RU")
  .replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function InlineSearchCombobox({ value, options, onValueChange, placeholder, searchPlaceholder, emptyLabel, ariaLabel, disabled = false, mobile = false }: {
  value: string;
  options: InlineSearchOption[];
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  ariaLabel: string;
  disabled?: boolean;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const searchIndex = useMemo(() => options.map((option) => {
    const words = normalizeComboboxSearch([option.label, option.description, ...(option.keywords || [])].filter(Boolean).join(" "));
    return { option, words, compact: words.replace(/ /g, "") };
  }), [options]);
  const visible = useMemo(() => {
    const words = normalizeComboboxSearch(query).split(" ").filter(Boolean);
    return searchIndex.filter((entry) => words.every((word) => entry.words.includes(word) || entry.compact.includes(word))).map((entry) => entry.option);
  }, [searchIndex, query]);
  const activeIndex = Math.min(active, Math.max(0, visible.length - 1));

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);

  const begin = () => {
    if (disabled || input.current?.matches(":disabled")) return;
    setQuery("");
    setActive(0);
    setOpen(true);
  };
  const choose = (option: InlineSearchOption | undefined) => {
    if (!option || disabled || input.current?.matches(":disabled")) return;
    // Text is a search draft only. Only an explicit option commits an identity.
    onValueChange(option.value);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => { if (!next) setOpen(false); }}>
      <Anchor asChild>
        <div ref={anchor} className={cn("flex h-11 min-w-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-foreground focus-within:ring-2 focus-within:ring-ring", mobile && "min-h-[48px]", disabled && "opacity-50")}>
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            role="combobox"
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open && !disabled}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && visible.length ? `${listId}-${activeIndex}` : undefined}
            autoComplete="off"
            disabled={disabled}
            value={open ? query : selected?.label || ""}
            placeholder={open ? searchPlaceholder : placeholder}
            className="h-full w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
            onFocus={begin}
            onClick={() => { if (!open) begin(); }}
            onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
              if (event.key === "Tab") { setOpen(false); return; }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) { begin(); return; }
                setActive((index) => Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (open) choose(visible[activeIndex]); else begin();
              }
            }}
          />
          <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </Anchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // Editable comboboxes deliberately keep focus in the anchored input.
        // WebKit can otherwise report that focus as leaving the portalled layer
        // and close the list between typing and choosing an option.
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => { if (anchor.current?.contains(event.target as Node)) event.preventDefault(); }}
      >
        <div ref={list} id={listId} role="listbox" aria-label={ariaLabel} className="travkin-scrollbar max-h-64 overflow-y-auto">
          {!visible.length ? <p role="status" className="px-3 py-5 text-sm text-muted-foreground">{emptyLabel}</p> : visible.map((option, index) => (
            <div key={option.value}>
              {option.group && option.group !== visible[index - 1]?.group ? <div className="px-3 pb-1 pt-3 text-xs font-semibold text-muted-foreground">{option.group}</div> : null}
              <button
                id={`${listId}-${index}`}
                data-option-index={index}
                type="button"
                role="option"
                aria-selected={option.value === value}
                tabIndex={-1}
                className={cn("flex min-h-11 w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-foreground", index === activeIndex && "bg-accent")}
                onPointerMove={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <Check aria-hidden="true" className={cn("h-4 w-4 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 break-words">
                  <span className="block font-medium">{option.label}</span>
                  {option.description ? <span className="block text-xs text-muted-foreground">{option.description}</span> : null}
                </span>
                {option.status ? <span className="shrink-0 rounded-sm border border-border px-1.5 py-1 text-xs">{option.status}</span> : null}
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
