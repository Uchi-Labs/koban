"use client";

import React from "react";
import { RollingDigits } from "@/components/ui/rolling-digits";
import { Card as IconiqCard, CardContent as IconiqCardContent } from "@/components/ui/iconiq-card";
import { ROLLING_DIGITS_HERO } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface AccountsSummaryStat {
  currency?: string;
  /** Pre-rendered icon element (e.g. `<WalletCards size={14} />`) -- a bare component
   * reference can't cross the Server -> Client boundary, only rendered elements can. */
  icon?: React.ReactNode;
  label: string;
  tone?: "negative" | "neutral" | "positive";
  value: number;
}

/**
 * Net worth / Assets / Liabilities / Synced accounts tiles. Each rolling digit
 * renders its real value immediately on mount (startOnView=false, same as
 * MoneyHero) -- no count-up-from-zero flash -- and only rolls on subsequent
 * value changes (e.g. a live resync while the page is open).
 */
export function AccountsSummaryStrip({ stats }: { stats: AccountsSummaryStat[] }) {
  return (
    <section aria-label="Account totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((stat) => (
        <StatTile key={stat.label} stat={stat} />
      ))}
    </section>
  );
}

const toneClassName: Record<NonNullable<AccountsSummaryStat["tone"]>, string> = {
  negative: "text-(--negative)",
  neutral: "text-foreground",
  positive: "text-(--positive)"
};

function StatTile({ stat }: { stat: AccountsSummaryStat }) {
  const tone = stat.tone ?? "neutral";
  const negative = stat.value < 0;

  return (
    <IconiqCard className="gap-1.5 rounded-xl border-border/60 bg-card/95 py-3.5 shadow-[var(--ic-card-rest-shadow)]">
      <IconiqCardContent className="flex flex-col gap-1.5 px-4">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {stat.icon ? (
            <span aria-hidden="true" className={cn("flex size-5 items-center justify-center rounded-md", toneClassName[tone])}>
              {stat.icon}
            </span>
          ) : null}
          {stat.label}
        </span>
        <span className={cn("text-lg font-semibold tabular-nums", toneClassName[tone])}>
          {negative ? "−" : ""}
          {stat.currency ? "$" : ""}
          <RollingDigits
            animationDelay={ROLLING_DIGITS_HERO.animationDelay}
            coalesceUpdates
            direction="dynamic"
            enterDamping={ROLLING_DIGITS_HERO.enterDamping}
            enterStiffness={ROLLING_DIGITS_HERO.enterStiffness}
            enterY={ROLLING_DIGITS_HERO.enterY}
            format={(value) => Math.round(Math.abs(value)).toLocaleString("en-US")}
            gap={0}
            startOnView={false}
            value={stat.value}
          />
        </span>
      </IconiqCardContent>
    </IconiqCard>
  );
}
