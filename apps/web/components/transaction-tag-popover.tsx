"use client";

import { Check, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Popover, PopoverPopup, PopoverPortal, PopoverPositioner, PopoverTrigger } from "@/components/motion/popover";
import { cn } from "@/lib/utils";

export interface TagOption {
  color?: string;
  name: string;
}

export interface TransactionTagPopoverProps {
  align?: "center" | "end" | "start";
  children: React.ReactElement;
  nativeButton?: boolean;
  onOpenChange?: (open: boolean) => void;
  onToggle: (tag: string) => void;
  selected: string[];
  settingsHref?: string;
  side?: "bottom" | "left" | "right" | "top";
  tags: TagOption[];
}

export function TransactionTagPopover({
  align = "end",
  children,
  nativeButton = false,
  onOpenChange,
  onToggle,
  selected,
  settingsHref = "/settings",
  side = "bottom",
  tags
}: TransactionTagPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const setOpenState = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        setQuery("");
      }
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  const selectedSet = React.useMemo(() => new Set(selected.map((tag) => tag.toLowerCase())), [selected]);
  const trimmed = query.trim();
  const sortedTags = React.useMemo(
    () => [...tags].sort((left, right) => left.name.localeCompare(right.name)),
    [tags]
  );
  const filtered = React.useMemo(
    () => sortedTags.filter((tag) => tag.name.toLowerCase().includes(trimmed.toLowerCase())),
    [sortedTags, trimmed]
  );
  const exactMatch = React.useMemo(
    () => tags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase()),
    [tags, trimmed]
  );

  return (
      <Popover open={open} onOpenChange={setOpenState}>
        <PopoverTrigger nativeButton={nativeButton} render={children} />
        <PopoverPortal>
        <PopoverPositioner align={align} className="isolate z-50" side={side} sideOffset={6}>
          <PopoverPopup
            data-slot="transaction-tag-popover"
            finalFocus={{ current: null }}
            initialFocus={inputRef}
            className="relative z-50 flex w-60 max-w-[min(18rem,calc(100vw-2rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
          >
            <div className="border-b border-border/60 px-2.5 py-2">
              <input
                aria-label="Add tags"
                className="w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Add tags…"
                ref={inputRef}
                type="text"
                value={query}
              />
            </div>
            <div className="scroll-fade max-h-[16rem] overflow-y-auto p-1" role="listbox">
              {filtered.length === 0 && !trimmed ? (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">No tags yet.</p>
              ) : null}
              {filtered.map((tag) => {
                const isSelected = selectedSet.has(tag.name.toLowerCase());
                return (
                  <button
                    aria-selected={isSelected}
                    className="flex min-h-8 w-full cursor-default items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm outline-hidden transition-colors select-none hover:bg-accent hover:text-accent-foreground"
                    key={tag.name}
                    onClick={() => onToggle(tag.name)}
                    role="option"
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                        isSelected ? "border-transparent bg-primary text-primary-foreground" : "border-border"
                      )}
                    >
                      {isSelected ? <Check className="size-3" /> : null}
                    </span>
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color ?? "var(--muted-foreground)" }}
                    />
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  </button>
                );
              })}
              {trimmed && !exactMatch ? (
                <button
                  className="flex min-h-8 w-full cursor-default items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm text-muted-foreground outline-hidden transition-colors select-none hover:bg-accent hover:text-accent-foreground"
                  onClick={() => onToggle(trimmed)}
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-dashed border-border">
                    <Plus className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Create <span className="text-foreground">“{trimmed}”</span>
                  </span>
                </button>
              ) : null}
            </div>
            <Link
              className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              href={settingsHref}
            >
              <SlidersHorizontal className="size-3.5" />
              View tag settings
            </Link>
          </PopoverPopup>
        </PopoverPositioner>
        </PopoverPortal>
      </Popover>
  );
}
