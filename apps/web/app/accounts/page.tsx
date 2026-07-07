import type { Account, Transaction } from "@ai-finances/schema";
import type React from "react";
import { ArrowRight, Banknote, CreditCard, Landmark, TrendingUp, WalletCards } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { NetWorthAccountsDialog } from "@/components/net-worth-accounts-dialog";
import { formatCurrency } from "@/lib/format";
import { getAccountNetWorthContribution, getFinanceData } from "@/lib/finance-data";
import { buildNetWorthToggleGroups } from "@/lib/net-worth-toggles";
import { isSpendingTransaction } from "@/lib/transaction-classification";
import { cn } from "@/lib/utils";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });
const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short"
});

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
    hoverClassName: "hover:bg-[color-mix(in_oklab,var(--chart-5)_10%,var(--muted))]",
    icon: Landmark
  },
  group_credit: {
    colorVar: "--chart-2",
    hoverClassName: "hover:bg-[color-mix(in_oklab,var(--chart-2)_10%,var(--muted))]",
    icon: CreditCard
  },
  group_investments: {
    colorVar: "--chart-4",
    hoverClassName: "hover:bg-[color-mix(in_oklab,var(--chart-4)_10%,var(--muted))]",
    icon: TrendingUp
  },
  group_other: {
    colorVar: "--chart-1",
    hoverClassName: "hover:bg-[color-mix(in_oklab,var(--chart-1)_10%,var(--muted))]",
    icon: Banknote
  }
};

const DEFAULT_GROUP_ACCENT: GroupAccent = {
  colorVar: "--chart-3",
  hoverClassName: "hover:bg-[color-mix(in_oklab,var(--chart-3)_10%,var(--muted))]",
  icon: WalletCards
};

function accentForGroup(groupId: string): GroupAccent {
  return GROUP_ACCENTS[groupId] ?? DEFAULT_GROUP_ACCENT;
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** Stable per-account tonal step within a group's hue, hashed from a seed (institution name, falling back to account id). */
function accountDotColor(colorVar: string, seed: string): string {
  // color-mix() percentages must stay <= 100 -- anything higher is invalid CSS and resolves to transparent.
  const steps = [58, 72, 86, 100];
  const mixPercent = steps[hashSeed(seed) % steps.length];
  return `color-mix(in oklab, var(${colorVar}) ${mixPercent}%, var(--background))`;
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
  const { accountGroups, accounts, dashboardSummary, tellerLedger, transactions } = await getFinanceData();
  const latestTransactionDate = getLatestTransactionDate(transactions);
  const accountRows = accounts.map((account) => createAccountRow(account, transactions, latestTransactionDate));
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

  return (
    <main className="flex min-h-svh flex-col" data-testid="accounts-page">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Accounts</span>
        <NetWorthAccountsDialog groups={buildNetWorthToggleGroups(accounts)} />
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
        <section>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Teller account ledger</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Balance by account</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            {accounts.length > 0
              ? `${accounts.length.toLocaleString()} accounts synced from Teller. Last sync ${formatDateTime(tellerLedger?.lastSyncedAt)}.`
              : "No Teller accounts have been synced into the local database yet."}
          </p>
        </section>

        <section aria-label="Account totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            icon={<WalletCards size={16} />}
            label="Net worth"
            tone={signTone(dashboardSummary.netWorth)}
            value={formatCurrency(dashboardSummary.netWorth)}
          />
          <MetricCard icon={<Landmark size={16} />} label="Assets" tone="positive" value={formatCurrency(assets)} />
          <MetricCard icon={<CreditCard size={16} />} label="Liabilities" tone="negative" value={formatCurrency(liabilities)} />
          <MetricCard label="Synced accounts" value={accounts.length.toLocaleString()} />
        </section>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Accounts</h2>
            <p className="text-sm text-muted-foreground">Balances are raw Teller account balances; net-worth contribution subtracts liabilities.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {accountGroups.map((group) => {
              const groupRows = accountRowsByGroup.get(group.id) ?? [];
              const groupContribution = groupRows.reduce((total, row) => total + row.netWorthContribution, 0);
              const groupCurrency = commonCurrency(groupRows.map((row) => row.account.currency));
              const accent = accentForGroup(group.id);
              const GroupIcon = accent.icon;

              return (
                <div className="flex flex-col gap-1" key={group.id}>
                  <div
                    className="flex items-center justify-between rounded-lg px-3 py-1"
                    style={{ backgroundColor: `color-mix(in oklab, var(${accent.colorVar}) 7%, transparent)` }}
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
                    {/* Trailing spacer mirrors each row's arrow column (gap-3 + size-4) so the
                        group subtotal right-aligns with the per-row Net-worth impact figures. */}
                    <div className="flex items-center gap-3">
                      <strong className="text-sm font-semibold tabular-nums">{formatCurrency(groupContribution, groupCurrency)}</strong>
                      <span aria-hidden="true" className="size-4 shrink-0" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {groupRows.map((row) => (
                      <Link
                        aria-label={`View transactions for ${row.account.name}`}
                        className={cn(
                          "group grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                          accent.hoverClassName
                        )}
                        href={`/transactions?account_id=${encodeURIComponent(row.account.id)}`}
                        key={row.account.id}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <span
                            aria-hidden="true"
                            className="mt-1.5 size-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: accountDotColor(accent.colorVar, row.account.institutionName || row.account.id)
                            }}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.account.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {row.account.institutionName}
                              {row.account.mask ? ` ${row.account.mask}` : ""}
                            </p>
                          </div>
                        </div>
                        <RowStat
                          label="Current"
                          tone={currentBalanceTone(row.account)}
                          value={formatCurrency(row.account.currentBalance, row.account.currency)}
                        />
                        <RowStat
                          label="Available"
                          value={row.account.availableBalance === undefined ? "N/A" : formatCurrency(row.account.availableBalance, row.account.currency)}
                        />
                        <RowStat label="30 day spend" value={formatCurrency(row.thirtyDaySpending, row.account.currency)} />
                        <RowStat
                          label="Net-worth impact"
                          tone={signTone(row.netWorthContribution)}
                          value={formatSignedCurrency(row.netWorthContribution, row.account.currency)}
                        />
                        <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
            {accounts.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">Use Settings to run Teller sync before this view has account rows.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Recent account activity</h2>
            <p className="text-sm text-muted-foreground">Latest Teller transaction per account, useful for spotting stale connections.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-0.5">
            {accountRows.map((row) => {
              const accent = accentForGroup(groupIdByAccountId.get(row.account.id) ?? "");

              return (
                <Link
                  aria-label={`View recent transactions for ${row.account.name}`}
                  className={cn(
                    "group grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                    accent.hoverClassName
                  )}
                  href={`/transactions?account_id=${encodeURIComponent(row.account.id)}`}
                  key={`${row.account.id}-activity`}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: accountDotColor(accent.colorVar, row.account.institutionName || row.account.id)
                      }}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.account.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.latestTransaction ? row.latestTransaction.merchantName : "No transactions synced"}
                      </p>
                    </div>
                  </div>
                  <RowStat label="Latest activity" value={row.latestTransaction ? formatDate(row.latestTransaction.date) : "N/A"} />
                  <RowStat label="Transaction count" value={row.transactionCount.toLocaleString()} />
                  <RowStat label="Last updated" value={formatDateTime(row.account.lastUpdatedAt)} />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  tone = "neutral",
  value
}: {
  icon?: React.ReactNode;
  label: string;
  tone?: "negative" | "neutral" | "positive";
  value: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon ? (
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 items-center justify-center rounded-md",
                tone === "negative" && "bg-(--negative)/12 text-(--negative)",
                tone === "positive" && "bg-(--positive)/12 text-(--positive)",
                tone === "neutral" && "text-muted-foreground"
              )}
            >
              {icon}
            </span>
          ) : null}
          {label}
        </span>
        <strong className={cn("text-lg font-semibold tabular-nums", toneClassName(tone))}>{value}</strong>
      </CardContent>
    </Card>
  );
}

function RowStat({
  label,
  tone = "neutral",
  value
}: {
  label: string;
  tone?: "negative" | "neutral" | "positive";
  value: string;
}) {
  return (
    <div className="min-w-0 text-right">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("truncate text-sm font-medium tabular-nums", toneClassName(tone))}>{value}</p>
    </div>
  );
}

function createAccountRow(account: Account, transactions: Transaction[], latestTransactionDate?: string) {
  const accountTransactions = transactions
    .filter((transaction) => transaction.accountId === account.id)
    .sort((left, right) => right.date.localeCompare(left.date));
  const latestTransaction = accountTransactions[0];
  const thirtyDaySpending = accountTransactions
    .filter((transaction) => isSpendingTransaction(transaction) && isWithinDays(transaction.date, latestTransactionDate, 30))
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);

  return {
    account,
    latestTransaction,
    netWorthContribution: getAccountNetWorthContribution(account),
    thirtyDaySpending: roundMoney(thirtyDaySpending),
    transactionCount: accountTransactions.length
  };
}

function getLatestTransactionDate(transactions: Transaction[]) {
  return transactions.map((transaction) => transaction.date).sort().at(-1);
}

function isWithinDays(date: string, referenceDate: string | undefined, days: number) {
  if (!referenceDate) {
    return false;
  }

  const difference = Date.parse(`${referenceDate}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`);
  return difference >= 0 && difference <= days * 86_400_000;
}

function formatSignedCurrency(amount: number, currency = "USD") {
  return `${amount < 0 ? "-" : ""}${formatCurrency(Math.abs(amount), currency)}`;
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
