import React from "react";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Amount({
  amount,
  className,
  compact = false,
  currency = "USD"
}: {
  amount: number;
  className?: string;
  compact?: boolean;
  currency?: string;
}) {
  const positive = amount > 0;

  return (
    <span
      className={cn(
        "whitespace-nowrap font-medium tabular-nums",
        compact ? "text-lg" : "text-sm",
        positive ? "text-(--positive)" : "text-foreground",
        className
      )}
      data-compact={compact}
    >
      {positive ? "+" : ""}
      {formatCurrency(Math.abs(amount), currency)}
    </span>
  );
}
