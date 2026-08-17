"use client";

import { useMemo, useState } from "react";
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

export type SearchableComboboxOption = {
  value: string;
  label: string;
  description?: string;
  status?: string;
  group?: string;
  keywords?: string[];
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
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) || null;
  const groups = useMemo(() => {
    const map = new Map<string, SearchableComboboxOption[]>();
    options.forEach((option) => {
      const group = option.group || "";
      map.set(group, [...(map.get(group) || []), option]);
    });
    return Array.from(map.entries());
  }, [options]);

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
          className="h-10 w-full justify-between border-slate-700 bg-slate-950 px-3 text-left font-normal text-slate-100 hover:bg-slate-900"
        >
          <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-slate-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] border-slate-700 bg-slate-950 p-0 text-slate-100"
      >
        <Command className="bg-slate-950 text-slate-100">
          <CommandInput placeholder={searchPlaceholder} className="text-slate-100" />
          <CommandList className="max-h-60 travkin-scrollbar">
            <CommandEmpty className="py-5 text-center text-sm text-slate-500">{emptyLabel}</CommandEmpty>
            {groups.map(([group, groupOptions]) => (
              <CommandGroup key={group || "default"} heading={group || undefined}>
                {groupOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.description || ""}`}
                    keywords={option.keywords}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    className="gap-2 py-2 text-slate-100 data-[selected=true]:bg-slate-800 data-[selected=true]:text-white"
                  >
                    <Check className={cn("h-4 w-4 shrink-0 text-yellow-400", value === option.value ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-medium">{option.label}</span>
                        {option.status ? (
                          <span className="shrink-0 rounded border border-amber-500/50 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                            {option.status}
                          </span>
                        ) : null}
                      </span>
                      {option.description ? <span className="block truncate text-xs text-slate-400">{option.description}</span> : null}
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
