import type { Account, Transaction } from "@ai-finances/schema";
import type React from "react";
import { ArrowRight, CreditCard, Landmark, WalletCards } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { getAccountNetWorthContribution, getFinanceData } from "@/lib/finance-data";
import { isSpendingTransaction } from "@/lib/transaction-classification";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });
const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short"
});

export default async function AccountsPage() {
  const { accountGroups, accounts, dashboardSummary, tellerLedger, transactions } = await getFinanceData();
  const latestTransactionDate = getLatestTransactionDate(transactions);
  const accountRows = accounts.map((account) => createAccountRow(account, transactions, latestTransactionDate));
  const accountRowsByGroup = new Map(accountGroups.map((group) => [
    group.id,
    accountRows.filter((row) => group.accountIds.includes(row.account.id))
  ]));
  const assets = accountRows
    .filter((row) => row.netWorthContribution > 0)
    .reduce((total, row) => total + row.netWorthContribution, 0);
  const liabilities = accountRows
    .filter((row) => row.netWorthContribution < 0)
    .reduce((total, row) => total + Math.abs(row.netWorthContribution), 0);

  return (
    <main className="flex min-h-svh flex-col" data-testid="accounts-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Accounts</span>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
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
          <MetricCard icon={<WalletCards size={16} />} label="Net worth" value={formatCurrency(dashboardSummary.netWorth)} />
          <MetricCard icon={<Landmark size={16} />} label="Assets" value={formatCurrency(assets)} />
          <MetricCard icon={<CreditCard size={16} />} label="Liabilities" value={formatCurrency(liabilities)} />
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

              return (
                <div className="flex flex-col gap-1" key={group.id}>
                  <div className="flex items-center justify-between px-1 pb-1">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold">{group.name}</h3>
                      <span className="text-xs text-muted-foreground">{groupRows.length.toLocaleString()} accounts</span>
                    </div>
                    <strong className="text-sm font-semibold tabular-nums">{formatCurrency(groupContribution, groupCurrency)}</strong>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {groupRows.map((row) => (
                      <Link
                        aria-label={`View transactions for ${row.account.name}`}
                        className="group grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
                        href={`/transactions?account_id=${encodeURIComponent(row.account.id)}`}
                        key={row.account.id}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.account.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {row.account.institutionName}
                            {row.account.mask ? ` ${row.account.mask}` : ""}
                          </p>
                        </div>
                        <RowStat label="Current" value={formatCurrency(row.account.currentBalance, row.account.currency)} />
                        <RowStat
                          label="Available"
                          value={row.account.availableBalance === undefined ? "N/A" : formatCurrency(row.account.availableBalance, row.account.currency)}
                        />
                        <RowStat label="30 day spend" value={formatCurrency(row.thirtyDaySpending, row.account.currency)} />
                        <RowStat label="Net-worth impact" value={formatSignedCurrency(row.netWorthContribution, row.account.currency)} />
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
            {accountRows.map((row) => (
              <Link
                aria-label={`View recent transactions for ${row.account.name}`}
                className="group grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                href={`/transactions?account_id=${encodeURIComponent(row.account.id)}`}
                key={`${row.account.id}-activity`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.account.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.latestTransaction ? row.latestTransaction.merchantName : "No transactions synced"}
                  </p>
                </div>
                <RowStat label="Latest activity" value={row.latestTransaction ? formatDate(row.latestTransaction.date) : "N/A"} />
                <RowStat label="Transaction count" value={row.transactionCount.toLocaleString()} />
                <RowStat label="Last updated" value={formatDateTime(row.account.lastUpdatedAt)} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </span>
        <strong className="text-lg font-semibold tabular-nums">{value}</strong>
      </CardContent>
    </Card>
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
