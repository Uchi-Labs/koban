import type { Account, AccountGroup, DashboardSummary, Transaction } from "@ai-finances/schema";
import { ArrowRight, Banknote, CreditCard, Landmark, TrendingUp, WalletCards } from "lucide-react";
import Link from "next/link";
import { AccountFaviconBadge } from "@/components/account-favicon-badge";
import { AccountsNetWorthCard } from "@/components/accounts-net-worth-card";
import { AccountsSummaryStrip, type AccountsSummaryStat } from "@/components/accounts-summary-strip";
import type { NetWorthRangeTrend } from "@/components/dashboard-net-worth-card";
import { LivelineChart } from "@/components/liveline-chart";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NetWorthAccountsDialog } from "@/components/net-worth-accounts-dialog";
import { formatCurrency } from "@/lib/format";
import type { getAccountNetWorthContribution } from "@/lib/finance-data";
import type { PortfolioPoint } from "@/lib/investments";
import type { Ledger } from "@/lib/finance-data";
import { computePortfolioChange } from "@/lib/investments";
import { buildNetWorthToggleGroups } from "@/lib/net-worth-toggles";
import { cn } from "@/lib/utils";
import { PageHeader, pageFrameClassName } from "@/components/page-header";

/**
 * One row of the accounts list. Declared here, not in the page, because it is
 * this view's contract: the page builds rows to satisfy the view, rather than
 * the view reaching back into the page for a type. The previous direction made
 * the component import from `app/accounts/page`, which is a dependency cycle
 * and defeats the point of the seam — a different page could no longer render
 * this view without dragging the original page in with it.
 */
export interface AccountRow {
  account: Account;
  history: PortfolioPoint[];
  latestTransaction: Transaction | undefined;
  netWorthContribution: ReturnType<typeof getAccountNetWorthContribution>;
  transactionCount: number;
}

export interface AccountsViewProps {
  accountGroups: AccountGroup[];
  accountRows: AccountRow[];
  accountRowsByGroup: Map<string, AccountRow[]>;
  accounts: Account[];
  dashboardSummary: DashboardSummary;
  groupIdByAccountId: Map<string, string>;
  ledger?: Ledger;
  netWorthTrends: NetWorthRangeTrend[];
  summaryStats: AccountsSummaryStat[];
}

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

function toneClassName(tone: "negative" | "neutral" | "positive") {
  if (tone === "negative") {
    return "text-(--negative)";
  }

  return tone === "positive" ? "text-(--positive)" : "";
}

export function AccountsView({
  accountGroups,
  accountRows,
  accountRowsByGroup,
  accounts,
  dashboardSummary,
  groupIdByAccountId,
  ledger,
  netWorthTrends,
  summaryStats
}: AccountsViewProps) {
  return (
    <main className="@container/page w-full" data-testid="accounts-page">
      <div className={pageFrameClassName}>
        <PageHeader
          description={
            accounts.length > 0
              ? `${accounts.length.toLocaleString()} synced accounts · last sync ${formatDateTime(ledger?.lastSyncedAt)}`
              : "No accounts have synced yet. Connect a bank in Settings to see balances here."
          }
          title="Balance by account"
        />

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
                                    "hidden shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium tabular-nums sm:inline-flex",
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
      <p className="truncate text-2xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
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
