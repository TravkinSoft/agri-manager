"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { InlineSearchCombobox } from "@/components/ui/inline-search-combobox";

export type SearchableComboboxOption = {
  value: string;
  label: string;
  description?: string;
  status?: string;
  group?: string;
  keywords?: string[];
  physicalFieldSearch?: {
    name: string;
    area: number;
    fieldCode?: string | null;
  };
};

type SearchableComboboxProps = {
  value: string;
  options: SearchableComboboxOption[];
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  ariaLabel: string;
  disabled?: boolean;
  mobile?: boolean;
  inlineSearch?: boolean;
};

export function SearchableCombobox({
  value,
  options,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  ariaLabel,
  disabled = false,
  mobile = false,
  inlineSearch = false,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) || null;
  const groups = useMemo(() => {
    const map = new Map<string, SearchableComboboxOption[]>();
    options.forEach((option) => {
      const group = option.group || "";
      map.set(group, [...(map.get(group) || []), option]);
    });
    return Array.from(map.entries());
  }, [options]);

  if (inlineSearch) return <InlineSearchCombobox {...{ value, options, onValueChange, placeholder, searchPlaceholder, emptyLabel, ariaLabel, disabled, mobile }} />;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-10 w-full justify-between border-border bg-background px-3 text-left font-normal text-foreground hover:bg-background", mobile && "min-h-[48px] text-base touch-manipulation")}
        >
          <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[var(--radix-popover-trigger-width)] border-border bg-background p-0 text-foreground", mobile ? "min-w-0 max-w-[calc(100vw-2rem)]" : "min-w-[320px]")}
      >
        <Command className="bg-background text-foreground">
          <CommandInput
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onValueChange={() => {
              if (listRef.current) listRef.current.scrollTop = 0;
            }}
            className={cn("text-foreground", mobile && "min-h-[48px] text-base")}
          />
          <CommandList ref={listRef} className="max-h-60 travkin-scrollbar">
            <CommandEmpty className="py-5 text-center text-sm text-muted-foreground">{emptyLabel}</CommandEmpty>
            {groups.map(([group, groupOptions]) => (
              <CommandGroup key={group || "default"} heading={group || undefined}>
                {groupOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, option.description || "", ...(option.keywords || [])]}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    className={cn("gap-2 py-2 text-foreground data-[selected=true]:bg-muted data-[selected=true]:text-foreground", mobile && "min-h-[48px] touch-manipulation")}
                  >
                    <Check className={cn("h-4 w-4 shrink-0 text-amber-800", value === option.value ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-medium">{option.label}</span>
                        {option.status ? (
                          <span className="shrink-0 rounded border border-amber-500/50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                            {option.status}
                          </span>
                        ) : null}
                      </span>
                      {option.description ? <span className="block truncate text-xs text-muted-foreground">{option.description}</span> : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
