import type { Account, ProviderConnection } from "@ai-finances/schema";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChartPie,
  Landmark,
  ReceiptText,
  Repeat2,
  TrendingUp
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import { AccountBalanceHero } from "@/components/account-balance-hero";
import { AccountSyncButton } from "@/components/account-sync-button";
import { Amount } from "@/components/amount";
import { CategoryPill } from "@/components/category-pill";
import { GainLossPill } from "@/components/gain-loss-pill";
import { EmptyState } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";
import { FaviconBadge } from "@/components/ui/favicon-badge";
import {
  Card as IconiqCard,
  CardAction as IconiqCardAction,
  CardContent as IconiqCardContent,
  CardHeader as IconiqCardHeader,
  CardTitle as IconiqCardTitle
} from "@/components/ui/iconiq-card";
import type { HoldingView, PortfolioPoint } from "@/lib/investments";
import type { AccountCategorySpending } from "@/lib/account-detail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import { merchantDomain } from "@/lib/merchant-domain";
import type { getUpcomingRecurringViews, TransactionView } from "@/lib/view-models";
import { cn } from "@/lib/utils";

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  weekday: "long",
  year: "numeric"
});

export interface AccountDetailViewProps {
  account: Account;
  categorySpending: AccountCategorySpending;
  history: PortfolioPoint[];
  holdings: HoldingView[];
  providerConnection: ProviderConnection | undefined;
  recurringViews: ReturnType<typeof getUpcomingRecurringViews>;
  transactionViews: TransactionView[];
}

export function AccountDetailView({
  account,
  categorySpending,
  history,
  holdings,
  providerConnection,
  recurringViews,
  transactionViews
}: AccountDetailViewProps) {
  return (
    <main className="flex min-h-svh flex-col" data-testid="account-detail-page">
      <header className="flex items-center justify-between gap-3 h-14 shrink-0 border-b border-border px-6">
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "-ml-2 rounded-full text-muted-foreground")}
          href="/accounts"
        >
          <ArrowLeft className="size-3.5" />
          Accounts
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-xs text-muted-foreground">{account.institutionName}</span>
          {providerConnection ? <AccountSyncButton provider={providerConnection.provider} /> : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-5 p-4 sm:p-6">
        <AccountBalanceHero
          account={account}
          history={history}
        />

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.8fr)]">
          <SectionCard
            action={{ href: `/transactions?account_id=${encodeURIComponent(account.id)}`, label: "View in Transactions" }}
            description="Latest activity, grouped by posted date"
            icon={<ReceiptText className="size-4" />}
            title="Transactions"
          >
            {transactionViews.length > 0 ? (
              // One grid for the WHOLE list (all date groups) so pills and
              // amounts share the same columns end-to-end. Each date header and
              // each row spans all three columns; the rows re-use the tracks via
              // subgrid, so nothing drifts between groups.
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3">
                {groupTransactions(transactionViews.slice(0, 18)).map(([date, rows], groupIndex) => (
                  <section className="contents" key={date}>
                    <h3
                      className={cn(
                        "col-span-3 pb-1.5 pt-2.5 text-2xs font-medium tracking-wide text-muted-foreground uppercase",
                        groupIndex > 0 && "mt-1 border-t border-border/35"
                      )}
                    >
                      {fullDateFormatter.format(new Date(`${date}T12:00:00Z`))}
                    </h3>
                    {rows.map((transaction) => (
                      <Link
                        className="col-span-3 grid grid-cols-subgrid items-center gap-x-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
                        href={`/transactions?account_id=${encodeURIComponent(account.id)}&q=${encodeURIComponent(transaction.merchant)}`}
                        key={transaction.id}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{transaction.merchant}</span>
                          <span className="block truncate text-xs text-muted-foreground">{transaction.description}</span>
                        </span>
                        <CategoryPill category={transaction.category} className="hidden max-w-36 justify-self-start sm:inline-flex" />
                        <Amount amount={transaction.amount} className="justify-self-end" currency={transaction.currency} />
                      </Link>
                    ))}
                  </section>
                ))}
              </div>
            ) : (
              <EmptyState
                actions={
                  <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/transactions?account_id=${encodeURIComponent(account.id)}`}>
                    View transactions
                  </Link>
                }
                description="No synced transactions belong to this account yet."
                icon={<ReceiptText className="size-5" />}
                size="sm"
                title="No account activity"
              />
            )}
          </SectionCard>

          <SectionCard
            description={categorySpending.periodLabel}
            icon={<ChartPie className="size-4" />}
            title="Categories"
          >
            {categorySpending.rows.length > 0 ? (
              <div className="grid gap-3 py-1">
                {categorySpending.rows.map((row) => (
                  <div className="grid gap-1.5" key={row.category.id}>
                    <div className="flex items-center justify-between gap-3">
                      <CategoryPill category={row.category} className="max-w-full" />
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatCurrency(row.amount, account.currency)}
                      </span>
                    </div>
                    <div
                      className="h-1.5 overflow-hidden rounded-full"
                      style={{ backgroundColor: `color-mix(in oklab, ${row.category.color} 14%, transparent)` }}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{ backgroundColor: row.category.color, width: `${row.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                actions={
                  <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/transactions?account_id=${encodeURIComponent(account.id)}`}>
                    Browse account activity
                  </Link>
                }
                description="Spending categories will appear after this account has posted outflows."
                icon={<ChartPie className="size-5" />}
                size="sm"
                title="No categorized spending"
              />
            )}
          </SectionCard>
        </div>

        <SectionCard
          description="Recurring charges detected from this account's posted history"
          icon={<Repeat2 className="size-4" />}
          title="Recurrings"
        >
          {recurringViews.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {recurringViews.map((item) => {
                const domain = merchantDomain(item.merchant);
                return (
                  <Link
                    className="flex items-center gap-3 rounded-xl border border-border/45 bg-background/35 px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
                    href={`/transactions?account_id=${encodeURIComponent(account.id)}&category_id=${encodeURIComponent(item.categoryId)}&q=${encodeURIComponent(item.merchant)}`}
                    key={item.id}
                  >
                    {domain ? (
                      <FaviconBadge size="sm" website={domain} />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex size-6 shrink-0 items-center justify-center rounded-full text-3xs font-semibold"
                        style={{
                          backgroundColor: `color-mix(in oklab, ${item.category.color} 16%, transparent)`,
                          color: item.category.color
                        }}
                      >
                        {item.merchant.charAt(0).toUpperCase() || "?"}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.merchant}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.frequency} · next {item.nextDateLabel}
                      </span>
                    </span>
                    <CategoryPill category={item.category} className="hidden max-w-32 sm:inline-flex" />
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {formatCurrency(item.averageAmount, item.currency)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              actions={
                <Link className={buttonVariants({ size: "sm", variant: "outline" })} href="/recurrings">
                  View recurrings
                </Link>
              }
              description="No recurring pattern has enough evidence on this account yet."
              icon={<CalendarClock className="size-5" />}
              size="sm"
              title="No recurring charges detected"
            />
          )}
        </SectionCard>

        {account.type === "investment" ? <InvestmentsSection holdings={holdings} /> : null}

        <IconiqCard className="gap-0 rounded-xl border-border/55 bg-muted/15 py-0">
          <IconiqCardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Landmark className="size-4" />
              Last synced {formatDateTime(account.lastUpdatedAt)}
            </span>
            <Link className="inline-flex items-center gap-1 font-medium hover:text-primary" href="/accounts">
              All accounts <ArrowRight className="size-3.5" />
            </Link>
          </IconiqCardContent>
        </IconiqCard>
      </div>
    </main>
  );
}

function SectionCard({
  action,
  children,
  description,
  icon,
  title
}: {
  action?: { href: string; label: string };
  children: React.ReactNode;
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <IconiqCard className="gap-0 rounded-xl border-border/60 bg-card/95 py-0 shadow-[var(--ic-card-rest-shadow)]">
      <IconiqCardHeader className="grid grid-cols-[1fr_auto] items-start gap-3 border-b border-border/35 px-5 py-4">
        <div>
          <IconiqCardTitle as="h2" className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{icon}</span>{title}
          </IconiqCardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {action ? (
          <IconiqCardAction>
            <Link className="inline-flex items-center gap-1 rounded-full border border-border/50 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground" href={action.href}>
              {action.label}<ArrowRight className="size-3" />
            </Link>
          </IconiqCardAction>
        ) : null}
      </IconiqCardHeader>
      <IconiqCardContent className="px-5 py-4">{children}</IconiqCardContent>
    </IconiqCard>
  );
}

function InvestmentsSection({ holdings }: { holdings: HoldingView[] }) {
  return (
    <SectionCard description="Positions reported for this investment account" icon={<TrendingUp className="size-4" />} title="Investments">
      {holdings.length > 0 ? (
        <ScrollArea orientation="horizontal" viewportClassName="scroll-fade-x overscroll-x-contain">
          <table className="w-full min-w-[680px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                <th className="border-b border-border/35 px-2 pb-2">Position</th>
                <th className="border-b border-border/35 px-2 pb-2 text-right">Units</th>
                <th className="border-b border-border/35 px-2 pb-2 text-right">Price</th>
                <th className="border-b border-border/35 px-2 pb-2 text-right">Value</th>
                <th className="border-b border-border/35 px-2 pb-2 text-right">Total gain</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.id}>
                  <td className="border-b border-border/25 px-2 py-3 last:border-b-0">
                    <span className="block font-semibold">{holding.symbol}</span>
                    <span className="block max-w-72 truncate text-xs text-muted-foreground">{holding.description}</span>
                  </td>
                  <td className="border-b border-border/25 px-2 py-3 text-right tabular-nums">{formatUnits(holding.units)}</td>
                  <td className="border-b border-border/25 px-2 py-3 text-right tabular-nums">{holding.price === undefined ? "—" : formatCurrency(holding.price, holding.currency)}</td>
                  <td className="border-b border-border/25 px-2 py-3 text-right font-medium tabular-nums">{formatCurrency(holding.marketValue, holding.currency)}</td>
                  <td className="border-b border-border/25 px-2 py-3 text-right">
                    <HoldingGainLoss holding={holding} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      ) : (
        <EmptyState
          actions={
            <Link className={buttonVariants({ size: "sm", variant: "outline" })} href="/investments">
              View investments
            </Link>
          }
          description="This investment account has a synced balance but no position-level rows."
          icon={<TrendingUp className="size-5" />}
          size="sm"
          title="No positions reported"
        />
      )}
    </SectionCard>
  );
}

function HoldingGainLoss({ holding }: { holding: HoldingView }) {
  if (holding.unrealizedPnl === undefined) return <span className="text-muted-foreground">—</span>;
  const positive = holding.unrealizedPnl >= 0;
  return (
    <GainLossPill positive={positive}>
      {positive ? "+" : "−"}{formatCurrency(Math.abs(holding.unrealizedPnl), holding.currency)}
      {holding.unrealizedPnlPercent === undefined ? null : ` (${positive ? "+" : "−"}${Math.abs(holding.unrealizedPnlPercent).toFixed(1)}%)`}
    </GainLossPill>
  );
}

function groupTransactions<T extends { date: string }>(transactions: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const transaction of transactions) groups.set(transaction.date, [...(groups.get(transaction.date) ?? []), transaction]);
  return [...groups.entries()];
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }).format(new Date(value));
}

function formatUnits(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}
