"use client";

import type { Account } from "@ai-finances/schema";
import { CreditCard, Landmark, TrendingUp, WalletCards } from "lucide-react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import React from "react";
import { SPRING_LAYOUT } from "@/lib/motion";
import { AccountFaviconBadge } from "@/components/account-favicon-badge";
import { NetWorthChart } from "@/components/charts";
import { MoneyHero } from "@/components/money-hero";
import { Badge } from "@/components/ui/badge";
import {
  Card as IconiqCard,
  CardContent as IconiqCardContent
} from "@/components/ui/iconiq-card";
import type { PortfolioPoint } from "@/lib/investments";
import { cn } from "@/lib/utils";

type BalanceRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

interface BalanceTrend {
  label: BalanceRange;
  points: PortfolioPoint[];
}

const rangeOrder: BalanceRange[] = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];

export function AccountBalanceHero({
  account,
  detailsControl,
  history
}: {
  account: Account;
  detailsControl?: React.ReactNode;
  history: PortfolioPoint[];
}) {
  const trends = React.useMemo(() => buildBalanceTrends(history), [history]);
  const reduce = useReducedMotion();
  const [activeRange, setActiveRange] = React.useState<BalanceRange>(() => (
    trends.find((trend) => trend.label === "1M")?.label ?? trends[0]?.label ?? "ALL"
  ));
  const activeTrend = trends.find((trend) => trend.label === activeRange) ?? trends[0];
  const change = activeTrend ? balanceChange(activeTrend.points) : null;
  const liability = account.type === "credit_card" || account.type === "loan";
  const positive = change ? (liability ? change.amount <= 0 : change.amount >= 0) : true;
  const FallbackIcon = accountIcon(account.type);

  React.useEffect(() => {
    if (!trends.some((trend) => trend.label === activeRange)) {
      setActiveRange(trends[0]?.label ?? "ALL");
    }
  }, [activeRange, trends]);

  return (
    <IconiqCard className="gap-0 rounded-2xl border-border/60 bg-card/95 py-0 shadow-[var(--ic-card-rest-shadow)]">
      <IconiqCardContent className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]">
        <div className="flex min-w-0 flex-col justify-between gap-6">
          <div className="group flex items-start gap-3">
            <AccountFaviconBadge
              accentColorVar="--chart-5"
              fallbackIcon={<FallbackIcon size={16} />}
              institutionName={account.institutionName}
            />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {account.institutionName}
              </p>
              <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight">{account.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {account.mask ? `•••• ${account.mask}` : account.type.replace("_", " ")}
              </p>
            </div>
            {detailsControl ? <div className="ml-auto shrink-0">{detailsControl}</div> : null}
          </div>

          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Current balance</p>
            <MoneyHero amount={account.currentBalance} className="mt-1 text-4xl" currency={account.currency} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {change ? (
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
                    positive ? "bg-(--positive)/12 text-(--positive)" : "bg-(--negative)/12 text-(--negative)"
                  )}
                >
                  {change.amount >= 0 ? "+" : "−"}{Math.abs(change.percent).toFixed(2)}% · {activeTrend?.label}
                </span>
              ) : null}
              <Badge variant={account.includedInNetWorth ? "synced" : "outline"}>
                {account.includedInNetWorth ? "Included in net worth" : "Excluded from net worth"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Balance history</h2>
              <p className="text-xs text-muted-foreground">Synced account snapshots</p>
            </div>
          </div>
          {activeTrend ? (
            <NetWorthChart
              className="h-44"
              label="Account balance"
              points={activeTrend.points.map((point) => ({ label: formatPointLabel(point.time, activeTrend.label), value: point.value }))}
              positive={positive}
            />
          ) : (
            <div className="grid h-44 place-items-center rounded-xl border border-dashed border-border/60 bg-muted/15 px-6 text-center text-sm text-muted-foreground">
              Balance history will appear after this account has at least two synced snapshots.
            </div>
          )}
          {trends.length > 0 ? (
            <LazyMotion features={domAnimation}>
              <div aria-label="Balance history range" className="flex items-center gap-0.5 rounded-2xl bg-muted p-[3px]">
                {rangeOrder.map((range) => {
                  const available = trends.some((trend) => trend.label === range);
                  const active = activeRange === range;
                  return (
                    <button
                      aria-pressed={active}
                      className={cn(
                        "relative min-w-10 flex-1 rounded-2xl px-1.5 py-1.5 text-xs font-medium tabular-nums transition-colors motion-reduce:transition-none",
                        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                        !available && "hidden"
                      )}
                      key={range}
                      onClick={() => setActiveRange(range)}
                      type="button"
                    >
                      {active ? (
                        <m.span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-2xl bg-background shadow-sm"
                          layoutId="balance-range-pill"
                          transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                        />
                      ) : null}
                      <span className="relative">{range}</span>
                    </button>
                  );
                })}
              </div>
            </LazyMotion>
          ) : null}
        </div>
      </IconiqCardContent>
    </IconiqCard>
  );
}

function buildBalanceTrends(source: PortfolioPoint[]): BalanceTrend[] {
  const points = [...source].sort((left, right) => left.time - right.time);
  const latest = points.at(-1)?.time;
  if (!latest || points.length < 2) return [];

  const latestDate = new Date(latest * 1000);
  const cutoffs: Record<Exclude<BalanceRange, "ALL">, number> = {
    "1W": latest - 7 * 86_400,
    "1M": latest - 30 * 86_400,
    "3M": latest - 90 * 86_400,
    YTD: Date.UTC(latestDate.getUTCFullYear(), 0, 1) / 1000,
    "1Y": latest - 365 * 86_400
  };

  return rangeOrder.flatMap((label) => {
    const rangePoints = label === "ALL" ? points : points.filter((point) => point.time >= cutoffs[label]);
    return rangePoints.length >= 2 ? [{ label, points: rangePoints }] : [];
  });
}

function balanceChange(points: PortfolioPoint[]) {
  const first = points[0]?.value;
  const last = points.at(-1)?.value;
  if (first === undefined || last === undefined) return null;
  const amount = last - first;
  return { amount, percent: first === 0 ? 0 : (amount / Math.abs(first)) * 100 };
}

function formatPointLabel(time: number, range: BalanceRange) {
  const options: Intl.DateTimeFormatOptions = range === "ALL" || range === "1Y"
    ? { month: "short", year: "2-digit" }
    : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat("en-US", options).format(new Date(time * 1000));
}

function accountIcon(type: Account["type"]) {
  if (type === "credit_card") return CreditCard;
  if (type === "investment") return TrendingUp;
  if (type === "checking" || type === "savings") return Landmark;
  return WalletCards;
}
