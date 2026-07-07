"use client";

import React from "react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export type FinanceStatTone = "muted" | "primary" | "positive" | "negative" | "warning";

const statToneClasses: Record<FinanceStatTone, { dot: string; value: string }> = {
  muted: { dot: "bg-muted-foreground", value: "text-foreground" },
  negative: { dot: "bg-(--negative)", value: "text-(--negative)" },
  positive: { dot: "bg-(--positive)", value: "text-(--positive)" },
  primary: { dot: "bg-primary", value: "text-primary" },
  warning: { dot: "bg-[oklch(0.8_0.14_80)]", value: "text-[oklch(0.8_0.14_80)]" }
};

export function FinanceStatStrip({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Items never shrink below their own content width (see FinanceStatItem below),
        // so on narrow viewports the strip itself scrolls horizontally instead of any
        // individual amount getting ellipsis-clipped. scroll-fade-x hints there's more.
        "scroll-fade-x flex min-w-0 divide-x divide-border overflow-x-auto rounded-2xl border border-border bg-muted/25",
        className
      )}
    >
      {children}
    </div>
  );
}

export function FinanceStatItem({
  animatedCurrency,
  animatedValue,
  className,
  label,
  tone = "muted",
  unit,
  value
}: {
  animatedCurrency?: string;
  animatedValue?: number;
  className?: string;
  label: string;
  tone?: FinanceStatTone;
  unit?: string;
  value: React.ReactNode;
}) {
  const toneClasses = statToneClasses[tone];

  return (
    <div className={cn("inline-flex flex-1 flex-col gap-2 px-3 py-2", className)}>
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", toneClasses.dot)} />
        <span className="whitespace-nowrap">{label}</span>
      </span>
      <span className={cn("flex flex-col gap-0.5 leading-none", toneClasses.value)}>
        <span className="text-lg font-medium whitespace-nowrap tabular-nums">
          {typeof animatedValue === "number" ? (
            <AnimatedNumber
              digitPopOnChange
              digitText={(nextValue) =>
                animatedCurrency ? formatCurrency(nextValue, animatedCurrency) : Math.round(nextValue).toLocaleString()
              }
              format={(nextValue) =>
                animatedCurrency ? formatCurrency(nextValue, animatedCurrency) : Math.round(nextValue).toLocaleString()
              }
              value={animatedValue}
            />
          ) : (
            value
          )}
        </span>
        {/* Unit on its own line because inline unit text can collapse long currency values. */}
        {unit ? <span className="text-[10px] font-medium text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}
