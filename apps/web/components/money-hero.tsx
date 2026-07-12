"use client";

import NumberFlow from "@number-flow/react";
import React from "react";
import { RollingDigits } from "@/components/ui/rolling-digits";
import { ROLLING_DIGITS_HERO } from "@/lib/motion";
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
  currency = "USD",
  rolling = false
}: {
  amount: number;
  className?: string;
  currency?: string;
  rolling?: boolean;
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
      {rolling ? (
        <RollingDigits
          animationDelay={ROLLING_DIGITS_HERO.animationDelay}
          className="inline-flex"
          coalesceUpdates
          direction="dynamic"
          enterDamping={ROLLING_DIGITS_HERO.enterDamping}
          enterStiffness={ROLLING_DIGITS_HERO.enterStiffness}
          enterY={ROLLING_DIGITS_HERO.enterY}
          format={(value) => value.toLocaleString("en-US")}
          gap={0}
          startOnView={false}
          value={whole}
        />
      ) : (
        <NumberFlow
          aria-hidden
          className="inline"
          format={{ useGrouping: true, maximumFractionDigits: 0 }}
          value={whole}
          willChange
        />
      )}
      <span className="money-cents">
        <span aria-hidden="true">.</span>
        {rolling ? (
          <RollingDigits
            animationDelay={ROLLING_DIGITS_HERO.animationDelay}
            ariaLive={false}
            coalesceUpdates
            direction="dynamic"
            enterDamping={ROLLING_DIGITS_HERO.enterDamping}
            enterStiffness={ROLLING_DIGITS_HERO.enterStiffness}
            enterY={ROLLING_DIGITS_HERO.enterY}
            format={(value) => value.toString().padStart(2, "0")}
            gap={0}
            startOnView={false}
            value={cents}
          />
        ) : (
          <NumberFlow
            aria-hidden
            format={{ minimumIntegerDigits: 2, maximumFractionDigits: 0 }}
            value={cents}
            willChange
          />
        )}
      </span>
    </span>
  );
}
