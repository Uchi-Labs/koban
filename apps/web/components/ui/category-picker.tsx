"use client";

import type { Category } from "@ai-finances/schema";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { BanIcon, CheckIcon, PlusIcon, SearchIcon } from "lucide-react";
import { LazyMotion, domAnimation, m, useReducedMotion, type Variants } from "motion/react";
import * as React from "react";
import { NewCategoryDialog } from "@/components/new-category-dialog";
import { filterCategories } from "@/lib/rule-match";
import { SPRING_PANEL } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Opacity/scale/y only — no `filter` or `[data-slot]` CSS transitions on this
// top-layer popup (Chromium paints filtered top-layer panels inverted; see the
// note in components/ui/select.tsx). Animate via the motion render prop.
const PANEL_VARIANTS: Variants = {
  closed: { opacity: 0, scale: 0.96, y: -4 },
  open: { opacity: 1, scale: 1, y: 0 }
};

const EMPTY_MERCHANTS: string[] = [];

export interface CategoryPickerProps {
  align?: "center" | "end" | "start";
  // Enables the AI "Suggest" affordance inside the New category modal.
  aiSuggestionEnabled?: boolean;
  aiSuggestionMessage?: string;
  categories: Category[];
  children: React.ReactElement;
  contentClassName?: string;
  // Category id that "Exclude" assigns (defaults to the transfer bucket, which is
  // excluded from spending metrics). Hidden when null.
  excludeCategoryId?: string | null;
  // Set false when the trigger element (children) is not a native <button> —
  // e.g. the row pill renders a <span> to avoid a button-in-button.
  nativeButton?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (categoryId: string) => void;
  open?: boolean;
  side?: "bottom" | "left" | "right" | "top";
  uncategorizedMerchants?: string[];
  value?: string;
}

export function CategoryPicker({
  align = "start",
  aiSuggestionEnabled = false,
  aiSuggestionMessage = "No AI provider configured.",
  categories,
  children,
  contentClassName,
  excludeCategoryId = "cat_transfer",
  nativeButton = true,
  onOpenChange,
  onSelect,
  open: controlledOpen,
  side = "bottom",
  uncategorizedMerchants = EMPTY_MERCHANTS,
  value
}: CategoryPickerProps) {
  const reduce = useReducedMotion();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [createOpen, setCreateOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => filterCategories(categories, query), [categories, query]);

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      if (!next) {
        setQuery("");
        setActiveIndex(0);
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );

  React.useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered.length]);

  const commit = React.useCallback(
    (categoryId: string) => {
      onSelect(categoryId);
      setOpen(false);
    },
    [onSelect, setOpen]
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(filtered.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      const category = filtered[activeIndex];
      if (category) {
        event.preventDefault();
        commit(category.id);
      }
    }
  }

  return (
    <>
    <LazyMotion features={domAnimation}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger nativeButton={nativeButton} render={children} />
        <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          align={align}
          className="isolate z-50"
          side={side}
          sideOffset={6}
        >
          <PopoverPrimitive.Popup
            data-slot="category-picker"
            finalFocus={{ current: null }}
            initialFocus={inputRef}
            className={cn(
              "relative z-50 flex w-64 max-w-[min(20rem,calc(100vw-2rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-2xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10",
              contentClassName
            )}
            render={
              <m.div
                animate={reduce ? { opacity: 1, scale: 1, y: 0 } : "open"}
                initial={reduce ? false : "closed"}
                transition={reduce ? { duration: 0 } : SPRING_PANEL}
                variants={reduce ? undefined : PANEL_VARIANTS}
              />
            }
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-2.5 pb-2 pt-1.5">
              <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Search categories"
                className="w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search categories…"
                ref={inputRef}
                type="text"
                value={query}
              />
            </div>
            <div
              className="scroll-fade mt-1 max-h-[19rem] overflow-y-auto"
              ref={listRef}
              role="listbox"
            >
              {filtered.length === 0 ? (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">No categories found.</p>
              ) : (
                filtered.map((category, index) => {
                  const isActive = index === activeIndex;
                  const isSelected = category.id === value;

                  return (
                    <button
                      aria-selected={isSelected}
                      className={cn(
                        "relative flex min-h-7 w-full cursor-default items-center gap-2 rounded-xl py-1.5 pr-8 pl-2 text-left text-sm outline-hidden select-none",
                        isActive ? "bg-accent text-accent-foreground" : "text-foreground"
                      )}
                      data-active={isActive}
                      key={category.id}
                      onClick={() => commit(category.id)}
                      onMouseMove={() => setActiveIndex(index)}
                      role="option"
                      type="button"
                    >
                      <span aria-hidden="true" className="text-base leading-none">
                        {category.emoji ?? "🏷️"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{category.name}</span>
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      {isSelected ? (
                        <CheckIcon className="pointer-events-none absolute right-2 size-4 text-muted-foreground" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
            <div className="mt-1 flex flex-col border-t border-border/60 pt-1">
              <button
                className="flex min-h-7 w-full cursor-default items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-foreground outline-hidden transition-colors hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                type="button"
              >
                <PlusIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                <span>New category</span>
              </button>
              {excludeCategoryId ? (
                <button
                  className="flex min-h-7 w-full cursor-default items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-muted-foreground outline-hidden transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => commit(excludeCategoryId)}
                  type="button"
                >
                  <BanIcon aria-hidden="true" className="size-4" />
                  <span>Exclude</span>
                </button>
              ) : null}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </LazyMotion>
    {createOpen ? (
      <NewCategoryDialog
        aiSuggestionEnabled={aiSuggestionEnabled}
        aiSuggestionMessage={aiSuggestionMessage}
        onCreated={(categoryId) => onSelect(categoryId)}
        onOpenChange={setCreateOpen}
        open
        uncategorizedMerchants={uncategorizedMerchants}
      />
    ) : null}
    </>
  );
}
