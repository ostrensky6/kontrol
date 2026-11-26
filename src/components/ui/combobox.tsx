"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type ComboOption = { value: string; label: string; hint?: string };

/**
 * Combobox com busca, pronto para forms (mantém um <input type="hidden" name>).
 * Com `creatable`, permite escolher um valor novo digitado (ex.: grupo_escolha).
 */
export function Combobox({
  id,
  name,
  options,
  defaultValue = "",
  placeholder = "Selecione…",
  searchPlaceholder = "Buscar…",
  emptyText = "Nada encontrado.",
  creatable = false,
  className,
}: {
  /** id do botão, para `<label htmlFor>`. */
  id?: string;
  name: string;
  options: ComboOption[];
  defaultValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  creatable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(defaultValue);
  const [query, setQuery] = React.useState("");

  const selected = options.find((o) => o.value === value);
  const display = selected ? selected.label : value || placeholder;

  function escolher(v: string) {
    setValue(v);
    setOpen(false);
    setQuery("");
  }

  const queryTrim = query.trim();
  const queryIsNew =
    creatable &&
    queryTrim !== "" &&
    !options.some((o) => o.label.toLowerCase() === queryTrim.toLowerCase());

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring",
              !selected && !value && "text-muted-foreground",
              className,
            )}
          >
            <span className="truncate">{display}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-56">
          <Command>
            <CommandInput
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    keywords={[o.label, o.hint ?? ""]}
                    onSelect={() => escolher(o.value)}
                  >
                    <Check
                      className={cn("h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{o.label}</span>
                    {o.hint && (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {o.hint}
                      </span>
                    )}
                  </CommandItem>
                ))}
                {queryIsNew && (
                  <CommandItem
                    value="__criar__"
                    keywords={[queryTrim]}
                    onSelect={() => escolher(queryTrim)}
                  >
                    <Check className="h-4 w-4 opacity-0" />
                    Criar “{queryTrim}”
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
