import type { Account, Transaction } from "@ai-finances/schema";
import { ArrowRight, Banknote, CreditCard, Landmark, TrendingUp, WalletCards } from "lucide-react";
import Link from "next/link";
import { AccountFaviconBadge } from "@/components/account-favicon-badge";
import { AccountsNetWorthCard } from "@/components/accounts-net-worth-card";
import { AccountsSummaryStrip, type AccountsSummaryStat } from "@/components/accounts-summary-strip";
import { LivelineChart } from "@/components/liveline-chart";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NetWorthAccountsDialog } from "@/components/net-worth-accounts-dialog";
import { formatCurrency } from "@/lib/format";
import { getAccountNetWorthContribution, getFinanceData } from "@/lib/finance-data";
import { accountHistories, computePortfolioChange, type PortfolioPoint } from "@/lib/investments";
import { buildNetWorthRangeTrends } from "@/lib/net-worth-trend";
import { buildNetWorthToggleGroups } from "@/lib/net-worth-toggles";
import { cn } from "@/lib/utils";

const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short"
});
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

/*
 * Each account group (Cash / Credit cards / Investments / Other) gets a fixed hue drawn from the
 * app's existing --chart-1..5 palette (the same tokens charts.tsx / agent-answer.tsx use), so the
 * accounts page reads as part of the same visual system instead of inventing new colors. Individual
 * accounts within a group get a stable tonal variant of that hue (hashed from the institution name)
 * so rows are distinguishable without turning into a rainbow.
 */
type GroupAccent = { colorVar: string; hoverClassName: string; icon: typeof Landmark };

const GROUP_ACCENTS: Record<string, GroupAccent> = {
  group_cash: {
    colorVar: "--chart-5",
    hoverClassName: "hover:border-[color-mix(in_oklab,var(--chart-5)_22%,var(--border))]",
    icon: Landmark
  },
  group_credit: {
    colorVar: "--chart-2",
    hoverClassName: "hover:border-[color-mix(in_oklab,var(--chart-2)_22%,var(--border))]",
    icon: CreditCard
  },
  group_investments: {
    colorVar: "--chart-4",
    hoverClassName: "hover:border-[color-mix(in_oklab,var(--chart-4)_22%,var(--border))]",
    icon: TrendingUp
  },
  group_other: {
    colorVar: "--chart-1",
    hoverClassName: "hover:border-[color-mix(in_oklab,var(--chart-1)_22%,var(--border))]",
    icon: Banknote
  }
};

const DEFAULT_GROUP_ACCENT: GroupAccent = {
  colorVar: "--chart-3",
  hoverClassName: "hover:border-[color-mix(in_oklab,var(--chart-3)_22%,var(--border))]",
  icon: WalletCards
};

function accentForGroup(groupId: string): GroupAccent {
  return GROUP_ACCENTS[groupId] ?? DEFAULT_GROUP_ACCENT;
}

/** Credit cards / loans carry a balance that represents money owed; a nonzero balance reads as a negative signal regardless of stored sign, a zero balance is neutral (nothing owed). */
function currentBalanceTone(account: Account): "negative" | "neutral" | "positive" {
  if (account.type === "credit_card" || account.type === "loan") {
    return account.currentBalance === 0 ? "neutral" : "negative";
  }

  return account.currentBalance > 0 ? "positive" : "neutral";
}

function signTone(value: number): "negative" | "neutral" | "positive" {
  if (value < 0) {
    return "negative";
  }

  return value > 0 ? "positive" : "neutral";
}

function toneClassName(tone: "negative" | "neutral" | "positive") {
  if (tone === "negative") {
    return "text-(--negative)";
  }

  return tone === "positive" ? "text-(--positive)" : "";
}

export default async function AccountsPage() {
  const { accountGroups, accounts, dashboardSummary, ledger, transactions } = await getFinanceData();
  const balanceSnapshots = ledger?.balanceSnapshots ?? [];
  const transactionSummaryByAccountId = summarizeTransactionsByAccountId(transactions);
  const historyByAccountId = accountHistories(balanceSnapshots);
  const accountRows = accounts.map((account) => createAccountRow(
    account,
    transactionSummaryByAccountId.get(account.id) ?? { count: 0 },
    historyByAccountId.get(account.id) ?? []
  ));
  const accountRowsByGroup = new Map(accountGroups.map((group) => [
    group.id,
    accountRows.filter((row) => group.accountIds.includes(row.account.id))
  ]));
  const groupIdByAccountId = new Map(
    accountGroups.flatMap((group) => group.accountIds.map((accountId) => [accountId, group.id] as const))
  );
  const assets = accountRows
    .filter((row) => row.netWorthContribution > 0)
    .reduce((total, row) => total + row.netWorthContribution, 0);
  const liabilities = accountRows
    .filter((row) => row.netWorthContribution < 0)
    .reduce((total, row) => total + Math.abs(row.netWorthContribution), 0);
  const netWorthTrends = buildNetWorthRangeTrends(dashboardSummary.netWorth, transactions);

  const summaryStats: AccountsSummaryStat[] = [
    {
      currency: "USD",
      icon: <WalletCards size={14} />,
      label: "Net worth",
      tone: signTone(dashboardSummary.netWorth),
      value: dashboardSummary.netWorth
    },
    { currency: "USD", icon: <Landmark size={14} />, label: "Assets", tone: "positive", value: assets },
    { currency: "USD", icon: <CreditCard size={14} />, label: "Liabilities", tone: "negative", value: liabilities },
    { label: "Synced accounts", value: accounts.length }
  ];

  return (
    <main className="@container/page flex min-h-svh flex-col" data-testid="accounts-page">
      <header className="flex items-center justify-between gap-3 h-14 shrink-0 border-b border-border px-6">
        <span className="text-[13px] font-semibold tracking-tight">Accounts</span>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
        <section>
          <h1 className="app-page-title">Balance by account</h1>
          <p className="app-page-description mt-1.5">
            {accounts.length > 0
              ? `${accounts.length.toLocaleString()} synced accounts · last sync ${formatDateTime(ledger?.lastSyncedAt)}`
              : "No accounts have been synced into the local database yet."}
          </p>
        </section>

        <div className="flex flex-col gap-6 @5xl/page:grid @5xl/page:grid-cols-[minmax(0,1.6fr)_minmax(24rem,0.9fr)] @5xl/page:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            <AccountsNetWorthCard
              currency={dashboardSummary.currency}
              currentNetWorth={dashboardSummary.netWorth}
              settingsSlot={<NetWorthAccountsDialog groups={buildNetWorthToggleGroups(accounts)} />}
              trends={netWorthTrends}
            />

            <AccountsSummaryStrip stats={summaryStats} />

            <Card>
              <CardHeader>
                <h2 className="text-base font-medium">Accounts</h2>
                <p className="text-sm text-muted-foreground">Balances reflect the latest synced provider values; net-worth contribution subtracts liabilities.</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {accountGroups.map((group) => {
                  const groupRows = accountRowsByGroup.get(group.id) ?? [];
                  const groupContribution = groupRows.reduce((total, row) => total + row.netWorthContribution, 0);
                  const groupCurrency = commonCurrency(groupRows.map((row) => row.account.currency));
                  const accent = accentForGroup(group.id);
                  const GroupIcon = accent.icon;

                  return (
                    <div className="flex flex-col gap-1.5" key={group.id}>
                      <div
                        className="flex items-center justify-between rounded-lg px-3 py-1.5"
                        style={{ backgroundColor: `color-mix(in oklab, var(${accent.colorVar}) 8%, transparent)` }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="flex size-6 shrink-0 items-center justify-center rounded-full"
                            style={{
                              backgroundColor: `color-mix(in oklab, var(${accent.colorVar}) 18%, transparent)`,
                              color: `var(${accent.colorVar})`
                            }}
                          >
                            <GroupIcon size={13} />
                          </span>
                          <h3 className="text-sm font-semibold">{group.name}</h3>
                          <span className="text-xs text-muted-foreground">{groupRows.length.toLocaleString()} accounts</span>
                        </div>
                        <strong className="text-sm font-semibold tabular-nums">{formatCurrency(groupContribution, groupCurrency)}</strong>
                      </div>
                      <div className="flex flex-col gap-1">
                        {groupRows.map((row) => {
                          const change = computePortfolioChange(row.history);
                          const changePositive = change !== null && change.amount >= 0;

                          return (
                            <div
                              className={cn(
                                "group relative flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm transition-[background-color,border-color] duration-250 ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
                                "hover:border-border/60 hover:bg-card",
                                accent.hoverClassName
                              )}
                              key={row.account.id}
                            >
                              {/* Stretched-link overlay keeps the whole row clickable. */}
                              <Link
                                aria-label={`Open account page for ${row.account.name}`}
                                className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                                href={`/accounts/${encodeURIComponent(row.account.id)}`}
                              />
                              <AccountFaviconBadge
                                accentColorVar={accent.colorVar}
                                fallbackIcon={<accent.icon size={13} />}
                                institutionName={row.account.institutionName}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{row.account.name}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {row.account.institutionName}
                                  {row.account.mask ? ` ····${row.account.mask}` : ""}
                                </p>
                              </div>
                              {row.history.length >= 2 ? (
                                <div className="pointer-events-none hidden w-20 shrink-0 sm:block">
                                  <LivelineChart height={28} points={row.history} sparkline />
                                </div>
                              ) : null}
                              {change !== null ? (
                                <span
                                  className={cn(
                                    "hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums sm:inline-flex",
                                    changePositive ? "bg-(--positive)/10 text-(--positive)" : "bg-destructive/10 text-destructive"
                                  )}
                                >
                                  {changePositive ? "+" : ""}
                                  {change.percent.toFixed(2)}%
                                </span>
                              ) : null}
                              <span
                                className={cn("min-w-[6rem] shrink-0 text-right font-medium tabular-nums", toneClassName(currentBalanceTone(row.account)))}
                              >
                                {formatCurrency(row.account.currentBalance, row.account.currency)}
                              </span>
                              <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {accounts.length === 0 ? (
                  <p className="px-1 text-sm text-muted-foreground">Use Settings to sync an account before this view has account rows.</p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="@5xl/page:sticky @5xl/page:top-6">
            <CardHeader>
              <h2 className="text-base font-medium">Recent account activity</h2>
              <p className="text-sm text-muted-foreground">Latest synced transaction per account, useful for spotting stale connections.</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5">
              <ScrollArea
                className="@5xl/page:max-h-[78vh]"
                viewportClassName="scroll-fade-y h-fit @5xl/page:max-h-[78vh]"
              >
                <div className="flex flex-col gap-0.5">
                  {accountRows.map((row) => {
                    const accent = accentForGroup(groupIdByAccountId.get(row.account.id) ?? "");

                    return (
                      <Link
                        aria-label={`View transactions for ${row.account.name}`}
                        className="group grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none @5xl/page:grid-cols-[minmax(0,1.3fr)_auto]"
                        href={`/transactions?account_id=${encodeURIComponent(row.account.id)}`}
                        key={`${row.account.id}-activity`}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <span
                            aria-hidden="true"
                            className="mt-1.5 size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: `var(${accent.colorVar})` }}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.account.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {row.latestTransaction ? row.latestTransaction.merchantName : "No transactions synced"}
                            </p>
                          </div>
                        </div>
                        <div className="contents @5xl/page:hidden">
                          <RowStat label="Latest activity" value={row.latestTransaction ? formatDate(row.latestTransaction.date) : "N/A"} />
                          <RowStat label="Transaction count" value={row.transactionCount.toLocaleString()} />
                          <RowStat label="Last updated" value={formatDateTime(row.account.lastUpdatedAt)} />
                        </div>
                        <div className="hidden min-w-max flex-col items-end gap-0.5 text-xs @5xl/page:flex">
                          <p className="whitespace-nowrap text-muted-foreground">
                            <span className="font-medium text-foreground tabular-nums">
                              {row.latestTransaction ? formatDate(row.latestTransaction.date) : "N/A"}
                            </span>
                            {` · ${row.transactionCount.toLocaleString()} transactions`}
                          </p>
                          <p className="whitespace-nowrap text-muted-foreground">
                            Last updated <span className="font-medium text-foreground tabular-nums">{formatDateTime(row.account.lastUpdatedAt)}</span>
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function RowStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-right">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

const ROW_HISTORY_WINDOW_DAYS = 90;

interface AccountTransactionSummary {
  count: number;
  latest?: Transaction;
}

function createAccountRow(
  account: Account,
  transactionSummary: AccountTransactionSummary,
  history: PortfolioPoint[]
) {
  const latestTransaction = transactionSummary.latest;

  return {
    account,
    // Row sparkline/delta are a recent-trend glance, not the full multi-year
    // history -- an account's whole lifetime first-to-last delta (e.g. a credit
    // card opened at $0, now carrying a balance) reads as a meaningless four-digit
    // percentage. Bounding to the trailing window keeps it honest and legible.
    history: recentHistory(history, ROW_HISTORY_WINDOW_DAYS),
    latestTransaction,
    netWorthContribution: getAccountNetWorthContribution(account),
    transactionCount: transactionSummary.count
  };
}

/**
 * A row shows only its newest transaction and how many it has. The previous
 * version bucketed every transaction per account and sorted each bucket by date
 * just to read element 0, which is an O(n log n) sort per account whose result
 * was discarded. A single pass tracking the running max gives the same row.
 */
function summarizeTransactionsByAccountId(transactions: Transaction[]): Map<string, AccountTransactionSummary> {
  const summaryByAccountId = new Map<string, AccountTransactionSummary>();
  for (const transaction of transactions) {
    const summary = summaryByAccountId.get(transaction.accountId);
    if (!summary) {
      summaryByAccountId.set(transaction.accountId, { count: 1, latest: transaction });
      continue;
    }
    summary.count += 1;
    // Strictly greater keeps the first transaction seen at the newest date,
    // matching what a stable descending sort put at index 0.
    if (summary.latest === undefined || transaction.date > summary.latest.date) {
      summary.latest = transaction;
    }
  }
  return summaryByAccountId;
}

function recentHistory(history: PortfolioPoint[], days: number): PortfolioPoint[] {
  const latestPoint = history.at(-1);
  if (!latestPoint) {
    return history;
  }

  const cutoff = latestPoint.time - days * 86_400;
  return history.filter((point) => point.time >= cutoff);
}

function commonCurrency(currencies: string[]) {
  const uniqueCurrencies = [...new Set(currencies)];
  return uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : "USD";
}

function formatDate(date: string) {
  return shortDateFormatter.format(new Date(`${date}T12:00:00Z`));
}

function formatDateTime(date?: string) {
  if (!date) {
    return "unavailable";
  }

  return shortDateTimeFormatter.format(new Date(date));
}
