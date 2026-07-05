import React from "react";
import { cn } from "@/lib/utils";

/* Hero money figure: big tight digits, de-emphasized symbol and cents. */
export function MoneyHero({
  amount,
  className,
  currency = "USD"
}: {
  amount: number;
  className?: string;
  currency?: string;
}) {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const whole = Math.floor(absolute);
  const cents = Math.round((absolute - whole) * 100);
  const symbol = currency === "USD" ? "$" : `${currency} `;

  return (
    <span className={cn("money-hero text-foreground", className)} data-amount="">
      {negative ? <span className="money-symbol">−</span> : null}
      <span className="money-symbol">{symbol}</span>
      {whole.toLocaleString("en-US")}
      <span className="money-cents">.{String(cents).padStart(2, "0")}</span>
    </span>
  );
}

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
        "flex min-w-0 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-muted/25",
        className
      )}
    >
      {children}
    </div>
  );
}

export function FinanceStatItem({
  className,
  label,
  tone = "muted",
  unit,
  value
}: {
  className?: string;
  label: string;
  tone?: FinanceStatTone;
  unit?: string;
  value: React.ReactNode;
}) {
  const toneClasses = statToneClasses[tone];

  return (
    <div className={cn("inline-flex min-w-0 flex-1 flex-col gap-2 px-3 py-2", className)}>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", toneClasses.dot)} />
        <span className="truncate">{label}</span>
      </span>
      <span className={cn("flex min-w-0 flex-col gap-0.5 leading-none", toneClasses.value)}>
        <span className="truncate text-lg font-medium tabular-nums">{value}</span>
        {/* Unit on its own line — inline it squeezes the value into "$10,…" */}
        {unit ? <span className="text-[10px] font-medium text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}
