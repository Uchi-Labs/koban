"use client";

import NumberFlow from "@number-flow/react";
import React from "react";
import { cn } from "@/lib/utils";

export { FinanceStatItem, FinanceStatStrip, type FinanceStatTone } from "@/components/finance-stat";

/*
 * Hero money figure: big tight digits, de-emphasized symbol and cents.
 * NumberFlow animates the dollars and cents independently; it renders the
 * final value immediately on mount (no first-paint flash) and respects
 * prefers-reduced-motion by default.
 */
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
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const whole = Math.floor(absolute);
  const cents = Math.round((absolute - whole) * 100);

  return (
    <span className={cn("money-hero text-foreground", className)} data-amount="">
      {negative ? <span className="money-symbol">−</span> : null}
      <span className="money-symbol">{symbol}</span>
      <NumberFlow
        aria-hidden
        className="inline"
        format={{ useGrouping: true, maximumFractionDigits: 0 }}
        value={whole}
        willChange
      />
      <span className="money-cents">
        <NumberFlow
          aria-hidden
          format={{ minimumIntegerDigits: 2, maximumFractionDigits: 0 }}
          prefix="."
          value={cents}
          willChange
        />
      </span>
    </span>
  );
}
