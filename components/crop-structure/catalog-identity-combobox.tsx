"use client";

import { useState } from "react";
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

type CatalogIdentityOption = {
  id: string;
  label: string;
  searchValue: string;
  legacy?: boolean;
};

export function CatalogIdentityCombobox({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  className,
  disabled,
  onChange,
}: {
  value: string | null;
  options: CatalogIdentityOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value) || null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between px-3 font-normal", className)}
        >
          <span className={cn("min-w-0 flex-1 truncate text-left", !selected && "text-slate-500")}>
            {selected?.label || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-slate-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] border-slate-700 bg-[#101720] p-0 text-slate-100"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.label} ${option.searchValue}`}
                  onSelect={() => {
                    onChange(option.id === value ? null : option.id);
                    setOpen(false);
                  }}
                  className="text-slate-100 data-[selected=true]:bg-slate-800 data-[selected=true]:text-white"
                >
                  <Check className={cn("mr-2 h-4 w-4", option.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option.label}</span>
                  {option.legacy ? <span className="ml-auto text-xs text-amber-300">Текущее</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
