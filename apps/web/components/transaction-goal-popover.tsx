"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Check, Plus } from "lucide-react";
import { LazyMotion, domAnimation, m, useReducedMotion, type Variants } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

const PANEL_VARIANTS: Variants = {
  closed: { opacity: 0, scale: 0.96, y: -4 },
  open: { opacity: 1, scale: 1, y: 0 }
};

const PANEL_TRANSITION = {
  damping: 32,
  mass: 0.85,
  stiffness: 420,
  type: "spring"
} as const;

export interface FinancialGoal {
  emoji?: string;
  id: string;
  name: string;
  state?: string;
  target_amount_cents?: number;
}

interface GoalsApiResponse {
  data?: Array<{ emoji?: string; id: string; name: string; state?: string; target_amount_cents?: number }>;
  object?: string;
}

export interface TransactionGoalPopoverProps {
  align?: "center" | "end" | "start";
  children: React.ReactElement;
  nativeButton?: boolean;
  onAssign: (goal: FinancialGoal | null) => void;
  onOpenChange?: (open: boolean) => void;
  side?: "bottom" | "left" | "right" | "top";
  value?: string;
}

type LoadState = "error" | "idle" | "loading" | "ready";

export function TransactionGoalPopover({
  align = "end",
  children,
  nativeButton = false,
  onAssign,
  onOpenChange,
  side = "bottom",
  value
}: TransactionGoalPopoverProps) {
  const reduce = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [goals, setGoals] = React.useState<FinancialGoal[]>([]);
  const [state, setState] = React.useState<LoadState>("idle");
  const [creating, setCreating] = React.useState(false);
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

  const loadGoals = React.useCallback(async (signal: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch("/api/v1/goals", { cache: "no-store", signal });
      if (!response.ok) {
        throw new Error(`goals_unavailable_${response.status}`);
      }
      const body = (await response.json()) as GoalsApiResponse;
      setGoals((body.data ?? []).map((goal) => ({ ...goal })));
      setState("ready");
    } catch {
      if (!signal.aborted) {
        setState("error");
      }
    }
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    void loadGoals(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadGoals, open]);

  const trimmed = query.trim();
  const filtered = React.useMemo(
    () => goals.filter((goal) => goal.name.toLowerCase().includes(trimmed.toLowerCase())),
    [goals, trimmed]
  );
  const exactMatch = React.useMemo(
    () => goals.some((goal) => goal.name.toLowerCase() === trimmed.toLowerCase()),
    [goals, trimmed]
  );

  async function createGoal() {
    const name = trimmed;
    if (!name || creating) {
      inputRef.current?.focus();
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/v1/goals", {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      if (!response.ok) {
        throw new Error("create_failed");
      }
      const goal = (await response.json()) as FinancialGoal;
      setGoals((current) => [...current, goal]);
      onAssign(goal);
      setOpenState(false);
    } catch {
      setState("error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <LazyMotion features={domAnimation}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpenState}>
        <PopoverPrimitive.Trigger nativeButton={nativeButton} render={children} />
        <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner align={align} className="isolate z-50" side={side} sideOffset={6}>
          <PopoverPrimitive.Popup
            data-slot="transaction-goal-popover"
            finalFocus={{ current: null }}
            initialFocus={inputRef}
            className="relative z-50 flex w-60 max-w-[min(18rem,calc(100vw-2rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
            render={
              <m.div
                animate={reduce ? { opacity: 1, scale: 1, y: 0 } : "open"}
                initial={reduce ? false : "closed"}
                transition={reduce ? { duration: 0 } : PANEL_TRANSITION}
                variants={reduce ? undefined : PANEL_VARIANTS}
              />
            }
          >
            <div className="border-b border-border/60 px-2.5 py-2">
              <input
                aria-label="Search goals"
                className="w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && trimmed && !exactMatch) {
                    event.preventDefault();
                    void createGoal();
                  }
                }}
                placeholder="Search…"
                ref={inputRef}
                type="text"
                value={query}
              />
            </div>
            <div className="scroll-fade max-h-[16rem] overflow-y-auto p-1" role="listbox">
              {state === "loading" ? (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">Loading goals…</p>
              ) : null}
              {state === "error" ? (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">Goals syncing…</p>
              ) : null}
              {state === "ready" && goals.length === 0 && !trimmed ? (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">No goals yet.</p>
              ) : null}
              {value ? (
                <button
                  className="flex min-h-8 w-full cursor-default items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm text-muted-foreground outline-hidden transition-colors select-none hover:bg-accent hover:text-accent-foreground"
                  onClick={() => onAssign(null)}
                  type="button"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center text-base leading-none">✕</span>
                  <span className="min-w-0 flex-1 truncate">Remove from goal</span>
                </button>
              ) : null}
              {filtered.map((goal) => {
                const isSelected = goal.id === value;
                return (
                  <button
                    aria-selected={isSelected}
                    className="relative flex min-h-8 w-full cursor-default items-center gap-2.5 rounded-xl py-1.5 pr-8 pl-2 text-left text-sm outline-hidden transition-colors select-none hover:bg-accent hover:text-accent-foreground"
                    key={goal.id}
                    onClick={() => onAssign(goal)}
                    role="option"
                    type="button"
                  >
                    <span aria-hidden="true" className="text-base leading-none">
                      {goal.emoji ?? "🎯"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{goal.name}</span>
                    {isSelected ? (
                      <Check className="pointer-events-none absolute right-2 size-4 text-muted-foreground" />
                    ) : null}
                  </button>
                );
              })}
              {state !== "error" ? (
                <button
                  className={cn(
                    "flex min-h-8 w-full cursor-default items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm outline-hidden transition-colors select-none hover:bg-accent hover:text-accent-foreground",
                    trimmed && !exactMatch ? "text-foreground" : "text-muted-foreground"
                  )}
                  disabled={creating}
                  onClick={() => void createGoal()}
                  type="button"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-dashed border-border">
                    <Plus className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {trimmed && !exactMatch ? <>Add “{trimmed}”</> : "Add a new goal"}
                  </span>
                </button>
              ) : null}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </LazyMotion>
  );
}
