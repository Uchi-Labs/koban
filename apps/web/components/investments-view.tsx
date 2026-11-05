"use client";

import { ArrowDownUp, ArrowDown, ArrowUp, ChevronRight, Copy, TrendingUp } from "lucide-react";
import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import React from "react";
import { AccountFaviconBadge } from "@/components/account-favicon-badge";
import { DashboardCard } from "@/components/dashboard-card";
import { GainLossPill } from "@/components/gain-loss-pill";
import { LivelineChart } from "@/components/liveline-chart";
import { MoneyHero } from "@/components/money-hero";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeProviderCurrencyCode } from "@/lib/currency";
import { formatCurrency } from "@/lib/format";
import type { HoldingView, InvestmentsData } from "@/lib/investments";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

// Only ever mounts once a holding row is expanded, and it injects a third-party
// script tag itself -- code-split it out of the initial /investments bundle
// instead of shipping it (and its parse/eval cost) on first paint. Loading it
// eagerly was inflating the client chunk this whole page ships before it can
// hydrate, which widened the window in which the streamed page-shell and the
// hydrated tree could transiently coexist in the DOM (the 390px "duplicate
// testid" e2e flake).
const TradingViewAdvancedChart = dynamic(
  () => import("@/components/tradingview-advanced-chart").then((module) => module.TradingViewAdvancedChart),
  {
    loading: () => <Skeleton className="w-full rounded-xl" style={{ height: 420 }} />,
    ssr: false
  }
);

/** Matches the accounts-page investment group accent so this page reads as one system. */
const INVESTMENT_GROUP_ACCENT = "--chart-4";

type SortKey = "symbol" | "account" | "units" | "price" | "marketValue" | "gain" | "weight";
type SortDir = "asc" | "desc";

const HOLDINGS_COLSPAN = 9;

const unitsFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const spanYearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric" });
const spanDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
const spanDateWithYearFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

/** Deterministic, brand-leaning accent token per institution so each account reads distinct. */
const INSTITUTION_ACCENTS: Array<[RegExp, string]> = [
  [/fidelity/i, "--chart-5"],
  [/schwab/i, "--chart-1"],
  [/coinbase/i, "--chart-2"],
  [/vanguard/i, "--chart-3"],
  [/robinhood/i, "--chart-5"],
  [/bny|mellon/i, "--chart-4"]
];

function accentVar(seed: string): string {
  for (const [pattern, token] of INSTITUTION_ACCENTS) {
    if (pattern.test(seed)) {
      return token;
    }
  }
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 5;
  }
  return `--chart-${hash + 1}`;
}

function getThemeSnapshot(): "light" | "dark" {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribeThemeSnapshot(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function useAppTheme(): "light" | "dark" {
  return React.useSyncExternalStore(subscribeThemeSnapshot, getThemeSnapshot, () => "dark");
}

export function InvestmentsView({ data }: { data: InvestmentsData }) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [sortKey, setSortKey] = React.useState<SortKey>("marketValue");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const theme = useAppTheme();

  const sortedHoldings = React.useMemo(() => {
    const rows = [...data.holdings];
    rows.sort((left, right) => {
      const factor = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "symbol":
          return factor * left.symbol.localeCompare(right.symbol);
        case "account":
          return factor * left.accountName.localeCompare(right.accountName);
        case "units":
          return factor * (left.units - right.units);
        case "price":
          return factor * ((left.price ?? 0) - (right.price ?? 0));
        case "weight":
          return factor * (left.weight - right.weight);
        case "gain":
          return factor * ((left.unrealizedPnl ?? 0) - (right.unrealizedPnl ?? 0));
        case "marketValue":
        default:
          return factor * (Math.abs(left.marketValue) - Math.abs(right.marketValue));
      }
    });
    return rows;
  }, [data.holdings, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" || key === "account" ? "asc" : "desc");
    }
  }

  const change = data.change;
  const changePositive = (change?.amount ?? 0) >= 0;
  const historySpan = describeSpan(data.history);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-6 lg:px-8" data-testid="investments-page">
      <PageHeader
        className="mb-5"
        meta={
          <Badge appearance="dot" dotColor="positive" variant="synced" className="font-normal">
            {data.accounts.length.toLocaleString()} {data.accounts.length === 1 ? "account" : "accounts"}
          </Badge>
        }
        title="Investment accounts"
      />

      <InvestmentTotalsSection
        change={change}
        changePositive={changePositive}
        data={data}
        historySpan={historySpan}
      />
      <InvestmentAccountsSection accounts={data.accounts} currency={data.currency} totalMarketValue={data.totalMarketValue} />
      <NetWorthMixSection accounts={data.accounts} totalMarketValue={data.totalMarketValue} />
      <HoldingsSection
        expandedId={expandedId}
        onExpandedIdChange={setExpandedId}
        onToggleSort={toggleSort}
        sortDir={sortDir}
        sortKey={sortKey}
        sortedHoldings={sortedHoldings}
        theme={theme}
      />
    </main>
  );
}

function InvestmentTotalsSection({
  change,
  changePositive,
  data,
  historySpan
}: {
  change: InvestmentsData["change"];
  changePositive: boolean;
  data: InvestmentsData;
  historySpan: string | null;
}) {
  return (
    <section aria-label="Investment totals">
      <DashboardCard title="Portfolio value" action={{ label: "Accounts", href: "/accounts" }} surface="iconiq">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <MoneyHero amount={data.totalMarketValue} currency={data.currency} />
            <div className="mt-1 text-xs text-muted-foreground">Total across investment accounts</div>
            {data.totalUnrealizedPnl !== undefined ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="text-muted-foreground">Total gain</span>
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    data.totalUnrealizedPnl >= 0 ? "text-(--positive)" : "text-(--negative)"
                  )}
                >
                  {data.totalUnrealizedPnl >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(data.totalUnrealizedPnl), data.currency)}
                  {data.totalUnrealizedPnlPercent !== undefined
                    ? ` (${data.totalUnrealizedPnl >= 0 ? "+" : "−"}${Math.abs(data.totalUnrealizedPnlPercent).toFixed(2)}%)`
                    : ""}
                </span>
                {data.costBasisCoverage.coveredMarketValue < data.totalMarketValue - 1 ? (
                  <span className="text-muted-foreground tabular-nums">
                    · on {formatCurrency(data.costBasisCoverage.coveredMarketValue, data.currency)} with cost basis
                  </span>
                ) : data.costBasisCoverage.withCostBasis < data.costBasisCoverage.total ? (
                  <span className="text-muted-foreground tabular-nums">
                    · {data.costBasisCoverage.withCostBasis} of {data.costBasisCoverage.total} holdings
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          {change ? (
            <GainLossPill className="text-sm" positive={changePositive}>
              {changePositive ? "+" : "−"}
              {formatCurrency(Math.abs(change.amount), data.currency)} ({changePositive ? "+" : ""}
              {change.percent.toFixed(2)}%)
            </GainLossPill>
          ) : (
            <Badge className="font-normal" variant="outline">
              Awaiting more snapshots
            </Badge>
          )}
        </div>

        {data.history.length >= 2 ? (
          <>
            <LivelineChart className="mt-4" height={188} points={data.history} showValue />
            {historySpan ? (
              <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground">
                <span>{historySpan}</span>
                <span className="tabular-nums">{data.history.length} snapshots</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-4 flex h-[188px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/10 text-center">
            <TrendingUp className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Not enough history yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Koban charts portfolio value from balance snapshots captured on each sync. The line fills in as more syncs
              accumulate.
            </p>
          </div>
        )}
      </DashboardCard>
    </section>
  );
}

function InvestmentAccountsSection({
  accounts,
  currency,
  totalMarketValue
}: {
  accounts: InvestmentsData["accounts"];
  currency: string;
  totalMarketValue: number;
}) {
  return (
    <section className="mt-4" aria-label="Investment accounts">
      {/* Group-header pill matches the accounts page's group-header idiom (icon badge +
          name + count, tinted with the shared investment accent, total right-aligned). */}
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg px-3 py-1.5"
        style={{ backgroundColor: `color-mix(in oklab, var(${INVESTMENT_GROUP_ACCENT}) 8%, transparent)` }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: `color-mix(in oklab, var(${INVESTMENT_GROUP_ACCENT}) 18%, transparent)`,
              color: `var(${INVESTMENT_GROUP_ACCENT})`
            }}
          >
            <TrendingUp size={13} />
          </span>
          <h2 className="truncate text-sm font-semibold">Synced investment accounts</h2>
          <span className="shrink-0 text-xs text-muted-foreground">{accounts.length.toLocaleString()} accounts</span>
        </div>
        <strong className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(totalMarketValue, currency)}</strong>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => {
          const accent = accentVar(`${account.institutionName} ${account.name}`);
          return (
            <div
              className="relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-border bg-card/95 p-4 shadow-sm ring-1 ring-foreground/5"
              key={account.id}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <AccountFaviconBadge
                    accentColorVar={accent}
                    fallbackIcon={<TrendingUp size={13} />}
                    institutionName={account.institutionName}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{account.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {account.institutionName}
                      {account.mask ? ` ····${account.mask}` : ""}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(account.balance, normalizeProviderCurrencyCode(account.currency))}
                </div>
              </div>
              <LivelineChart className="mt-1" height={44} points={account.history} sparkline emptyText="No history yet" />
              <div className="pl-1 text-2xs text-muted-foreground tabular-nums">
                {account.positions.length.toLocaleString()} holdings
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NetWorthMixSection({
  accounts,
  totalMarketValue
}: {
  accounts: InvestmentsData["accounts"];
  totalMarketValue: number;
}) {
  return (
    <section className="mt-4" aria-label="Net worth mix">
      <DashboardCard title="Net worth mix" layered={false} surface="iconiq">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => {
            const weight = totalMarketValue > 0 ? Math.abs(account.balance / totalMarketValue) * 100 : 0;
            const accent = accentVar(`${account.institutionName} ${account.name}`);

            return (
              <div className="rounded-xl border border-border bg-muted/20 px-3 py-2" key={`${account.id}-mix`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(${accent})` }} />
                    <span className="truncate text-sm font-medium">{account.name}</span>
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">{weight.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{ background: `var(${accent})`, width: `${Math.min(100, weight)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </DashboardCard>
    </section>
  );
}

function HoldingsSection({
  expandedId,
  onExpandedIdChange,
  onToggleSort,
  sortDir,
  sortKey,
  sortedHoldings,
  theme
}: {
  expandedId: string | null;
  onExpandedIdChange: (id: string | null) => void;
  onToggleSort: (key: SortKey) => void;
  sortDir: SortDir;
  sortKey: SortKey;
  sortedHoldings: HoldingView[];
  theme: "light" | "dark";
}) {
  return (
    <section className="mt-4" aria-label="Holdings">
      <DashboardCard title="Holdings" layered={false} surface="iconiq">
        {sortedHoldings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No positions synced yet. Connect a brokerage in Settings to populate holdings.
          </p>
        ) : (
          <ScrollArea orientation="horizontal" viewportClassName="scroll-fade-x overscroll-x-contain">
            <table className="w-full border-collapse text-sm lg:min-w-[760px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-8 px-2 py-2" aria-label="Expand" />
                  <SortableTh label="Symbol" active={sortKey === "symbol"} dir={sortDir} onClick={() => onToggleSort("symbol")} />
                  <th className="hidden px-3 py-2 text-left font-medium lg:table-cell">Description</th>
                  <SortableTh label="Account" active={sortKey === "account"} dir={sortDir} onClick={() => onToggleSort("account")} />
                  <SortableTh align="right" active={sortKey === "units"} className="hidden lg:table-cell" dir={sortDir} label="Units" onClick={() => onToggleSort("units")} />
                  <SortableTh align="right" active={sortKey === "price"} className="hidden lg:table-cell" dir={sortDir} label="Price" onClick={() => onToggleSort("price")} />
                  <SortableTh label="Market value" align="right" active={sortKey === "marketValue"} dir={sortDir} onClick={() => onToggleSort("marketValue")} />
                  <SortableTh align="right" active={sortKey === "gain"} className="hidden md:table-cell" dir={sortDir} label="Total G/L" onClick={() => onToggleSort("gain")} />
                  <SortableTh align="right" active={sortKey === "weight"} className="hidden md:table-cell" dir={sortDir} label="Weight" onClick={() => onToggleSort("weight")} />
                </tr>
              </thead>
              <tbody>
                {sortedHoldings.map((holding) => {
                  const expanded = expandedId === holding.id;
                  const accent = accentVar(holding.accountName || holding.symbol);
                  return (
                    <React.Fragment key={holding.id}>
                      <HoldingRow
                        accent={accent}
                        expanded={expanded}
                        holding={holding}
                        onToggle={() => onExpandedIdChange(expanded ? null : holding.id)}
                      />
                      {expanded ? <HoldingDetailRow accent={accent} holding={holding} theme={theme} /> : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </DashboardCard>
    </section>
  );
}

function HoldingRow({
  accent,
  expanded,
  holding,
  onToggle
}: {
  accent: string;
  expanded: boolean;
  holding: HoldingView;
  onToggle: () => void;
}) {
  return (
    <tr
      aria-expanded={expanded}
      className={cn(
        "cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/50",
        expanded ? "bg-accent/40" : "last:border-0"
      )}
      onClick={onToggle}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <td className="px-2 py-2.5 align-middle">
        <ChevronRight
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            expanded && "rotate-90 text-foreground"
          )}
        />
      </td>
      <td className="max-w-[110px] truncate px-3 py-2.5 font-medium text-foreground sm:max-w-none">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: `var(${accent})` }} />
          {holding.symbol || "—"}
        </span>
      </td>
      <td className="hidden max-w-[220px] truncate px-3 py-2.5 text-muted-foreground lg:table-cell">
        {holding.description}
      </td>
      <td className="max-w-[110px] truncate px-3 py-2.5 text-muted-foreground sm:max-w-[180px]">
        {holding.accountName}
      </td>
      <td className="hidden px-3 py-2.5 text-right tabular-nums text-foreground lg:table-cell">
        {unitsFormatter.format(holding.units)}
      </td>
      <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground lg:table-cell">
        {holding.price === undefined ? "—" : formatCurrency(holding.price, holding.currency)}
      </td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
        {formatCurrency(holding.marketValue, holding.currency)}
      </td>
      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
        <GainDisplay holding={holding} />
      </td>
      <td className="hidden px-3 py-2.5 text-right md:table-cell">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted lg:block">
            <span
              className="block h-full rounded-full"
              style={{ background: `var(${accent})`, width: `${Math.min(100, holding.weight)}%` }}
            />
          </span>
          <span className="tabular-nums text-muted-foreground">{holding.weight.toFixed(1)}%</span>
        </span>
      </td>
    </tr>
  );
}

function SortableTh({
  label,
  align = "left",
  active,
  dir,
  onClick,
  className
}: {
  label: string;
  align?: "left" | "right";
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2 font-medium", align === "right" ? "text-right" : "text-left", className)}>
      <button
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active && "text-foreground"
        )}
        onClick={onClick}
        type="button"
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowDownUp className="size-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function HoldingDetailRow({
  holding,
  accent,
  theme
}: {
  holding: HoldingView;
  accent: string;
  theme: "light" | "dark";
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (reduce) {
      setOpen(true);
      return;
    }
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, [reduce]);

  function copySymbol() {
    if (!holding.symbol) {
      return;
    }
    void navigator.clipboard
      .writeText(holding.symbol)
      .then(() => toast.success(`Copied ${holding.symbol}`))
      .catch(() => toast.error("Could not copy symbol"));
  }

  return (
    <tr>
      <td className="border-b border-border/60 bg-muted/10 p-0" colSpan={HOLDINGS_COLSPAN}>
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="px-3 py-4 sm:px-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      background: `color-mix(in oklab, var(${accent}) 18%, transparent)`,
                      color: `var(${accent})`
                    }}
                  >
                    <TrendingUp className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{holding.symbol || "Holding"}</div>
                    <div className="truncate text-xs text-muted-foreground">{holding.description}</div>
                  </div>
                </div>
                {holding.symbol ? (
                  <button
                    aria-label="Copy symbol"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={copySymbol}
                    type="button"
                  >
                    <Copy className="size-3.5" />
                    Copy symbol
                  </button>
                ) : null}
              </div>

              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <DetailStat label="Market value" tone="strong" value={formatCurrency(holding.marketValue, holding.currency)} />
                <DetailStat label="Units" value={unitsFormatter.format(holding.units)} />
                <DetailStat
                  label="Price"
                  value={holding.price === undefined ? "—" : formatCurrency(holding.price, holding.currency)}
                />
                <DetailStat
                  label="Avg cost"
                  value={holding.costBasis === undefined ? "—" : formatCurrency(holding.costBasis, holding.currency)}
                />
                <DetailStat
                  accent={
                    holding.unrealizedPnl === undefined
                      ? undefined
                      : holding.unrealizedPnl >= 0
                        ? "--positive"
                        : "--negative"
                  }
                  label="Total gain"
                  value={
                    holding.unrealizedPnl === undefined
                      ? "—"
                      : `${formatSignedCurrency(holding.unrealizedPnl, holding.currency)}${
                          holding.unrealizedPnlPercent === undefined
                            ? ""
                            : ` (${holding.unrealizedPnl >= 0 ? "+" : "−"}${Math.abs(holding.unrealizedPnlPercent).toFixed(1)}%)`
                        }`
                  }
                />
                <DetailStat accent={accent} label="Weight" value={`${holding.weight.toFixed(1)}%`} />
              </div>

              <div className="mb-2 text-2xs uppercase tracking-wide text-muted-foreground">Price & performance</div>
              <TradingViewAdvancedChart height={620} symbol={holding.tradingViewSymbol} theme={theme} />
              <div className="mt-2 text-xs text-muted-foreground">{holding.accountName}</div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function formatSignedCurrency(value: number, currency: string): string {
  return `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value), currency)}`;
}

/** Per-holding total (open) unrealized gain/loss, or an em dash when cost basis is unknown. */
function GainDisplay({ holding }: { holding: HoldingView }) {
  if (holding.unrealizedPnl === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }

  const positive = holding.unrealizedPnl >= 0;
  return (
    <GainLossPill positive={positive}>
      {formatSignedCurrency(holding.unrealizedPnl, holding.currency)}
      {holding.unrealizedPnlPercent !== undefined ? (
        <span className="ml-1 opacity-80">
          ({positive ? "+" : "−"}
          {Math.abs(holding.unrealizedPnlPercent).toFixed(1)}%)
        </span>
      ) : null}
    </GainLossPill>
  );
}

function DetailStat({
  label,
  value,
  tone = "default",
  accent
}: {
  label: string;
  value: string;
  tone?: "default" | "strong";
  accent?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "truncate text-sm tabular-nums",
          tone === "strong" ? "font-semibold text-foreground" : "font-medium text-foreground"
        )}
        style={accent ? { color: `var(${accent})` } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Human span of a value timeline, e.g. "Jul 6 → Jul 6" or, when the range
 * crosses a calendar year boundary, "Jul 6, 2025 → Jul 7, 2026" — the year is
 * shown on both ends whenever it isn't the same for start and end, so the
 * caption never implies a same-year range it isn't.
 */
function describeSpan(points: InvestmentsData["history"]): string | null {
  if (points.length < 2) {
    return null;
  }
  const start = points[0].time * 1000;
  const end = points[points.length - 1].time * 1000;
  const spansMultipleYears = spanYearFormatter.format(start) !== spanYearFormatter.format(end);
  const fmt = spansMultipleYears ? spanDateWithYearFormatter : spanDateFormatter;
  return `${fmt.format(start)} → ${fmt.format(end)}`;
}
