import type { Account, Transaction } from "@ai-finances/schema";
import type React from "react";
import Link from "next/link";
import { BarChart3, ShieldAlert, TrendingUp, WalletCards } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { displayCurrencyCode } from "@/lib/currency";
import { formatCurrency } from "@/lib/format";
import { getAccountNetWorthContribution, getFinanceData } from "@/lib/finance-data";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });
const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short"
});

export default async function InvestmentsPage() {
  const { accounts, tellerLedger, transactions } = await getFinanceData();
  const investments = accounts.filter((account) => account.type === "investment");
  const investmentRows = investments.map((account) => createInvestmentRow(account, transactions));
  const investmentTotal = investmentRows.reduce((total, row) => total + row.netWorthContribution, 0);
  const investmentCurrency = displayCurrencyCode(investments.map((account) => account.currency));
  const nonInvestmentAccounts = accounts.filter((account) => account.type !== "investment");
  const nonInvestmentNetWorth = nonInvestmentAccounts
    .reduce((total, account) => total + getAccountNetWorthContribution(account), 0);
  const nonInvestmentCurrency = displayCurrencyCode(nonInvestmentAccounts.map((account) => account.currency));
  const accountMixRows = createAccountMixRows(accounts);

  return (
    <main className="flex min-h-svh flex-col" data-testid="investments-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Investments</span>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
        <section>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Teller balance view</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Investment accounts</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Balances and net-worth contribution from the current Teller account sync.
          </p>
        </section>

        <section aria-label="Investment totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<TrendingUp size={16} />} label="Investment balance" value={formatCurrency(investmentTotal, investmentCurrency)} />
          <MetricCard icon={<WalletCards size={16} />} label="Investment accounts" value={investmentRows.length.toLocaleString()} />
          <MetricCard icon={<BarChart3 size={16} />} label="Other net worth" value={formatCurrency(nonInvestmentNetWorth, nonInvestmentCurrency)} />
          <MetricCard label="Last account sync" value={formatDateTime(tellerLedger?.lastSyncedAt)} />
        </section>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Synced investment accounts</h2>
            <p className="text-sm text-muted-foreground">Balance-level account data from Teller investment accounts.</p>
          </CardHeader>
          <CardContent>
            {investmentRows.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {investmentRows.map((row) => (
                  <Link
                    className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
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
                    <RowStat label="Balance" value={formatCurrency(row.account.currentBalance)} />
                    <RowStat label="Cash-flow entries" value={row.transactionCount.toLocaleString()} />
                    <RowStat label="Latest activity" value={row.latestTransaction ? formatDate(row.latestTransaction.date) : "N/A"} />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-muted/40 p-4">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div>
                  <strong className="text-sm font-semibold">No investment accounts in current Teller data</strong>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The local database currently has {accounts.length.toLocaleString()} synced Teller accounts across cash and credit groups.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Net worth mix</h2>
            <p className="text-sm text-muted-foreground">Account groups contributing to current net worth.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-0.5">
            {accountMixRows.map((row) => (
              <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-3 rounded-xl px-3 py-2.5 text-sm" key={row.type}>
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.accountCount.toLocaleString()} account{row.accountCount === 1 ? "" : "s"}
                  </p>
                </div>
                <RowStat label="Balance" value={formatCurrency(row.balance, row.currency)} />
                <RowStat label="Net worth" value={formatCurrency(row.netWorthContribution, row.currency)} />
                <RowStat label="Share" value={row.shareLabel} />
              </div>
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

function createInvestmentRow(account: Account, transactions: Transaction[]) {
  const accountTransactions = transactions
    .filter((transaction) => transaction.accountId === account.id)
    .sort((left, right) => right.date.localeCompare(left.date));

  return {
    account,
    latestTransaction: accountTransactions[0],
    netWorthContribution: getAccountNetWorthContribution(account),
    transactionCount: accountTransactions.length
  };
}

function createAccountMixRows(accounts: Account[]) {
  const totalNetWorth = accounts.reduce((total, account) => total + getAccountNetWorthContribution(account), 0);
  const groups = [
    { label: "Cash", types: ["checking", "savings"] },
    { label: "Investments", types: ["investment"] },
    { label: "Credit cards", types: ["credit_card"] },
    { label: "Loans", types: ["loan"] }
  ];

  return groups.flatMap((group) => {
    const groupAccounts = accounts.filter((account) => group.types.includes(account.type));

    if (groupAccounts.length === 0) {
      return [];
    }

    const netWorthContribution = groupAccounts.reduce((total, account) => total + getAccountNetWorthContribution(account), 0);
    const balance = groupAccounts.reduce((total, account) => total + account.currentBalance, 0);
    const share = totalNetWorth === 0 ? 0 : Math.abs(netWorthContribution / totalNetWorth);

    return [{
      accountCount: groupAccounts.length,
      balance,
      currency: displayCurrencyCode(groupAccounts.map((account) => account.currency)),
      label: group.label,
      netWorthContribution,
      shareLabel: `${Math.round(share * 100)}%`,
      type: group.label.toLowerCase().replace(/\s+/g, "_")
    }];
  });
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
