import type { Metadata } from "next";
import type { Account, Transaction } from "@ai-finances/schema";
import { CreditCard, Landmark, WalletCards } from "lucide-react";
import { AccountsView, type AccountRow } from "@/components/accounts-view";
import type { AccountsSummaryStat } from "@/components/accounts-summary-strip";
import { getAccountNetWorthContribution, getFinanceData } from "@/lib/finance-data";
import { accountHistories, type PortfolioPoint } from "@/lib/investments";
import { buildNetWorthRangeTrends } from "@/lib/net-worth-trend";

export const metadata: Metadata = { title: "Accounts" };

function signTone(value: number): "negative" | "neutral" | "positive" {
  if (value < 0) {
    return "negative";
  }

  return value > 0 ? "positive" : "neutral";
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
    <AccountsView
      accountGroups={accountGroups}
      accountRows={accountRows}
      accountRowsByGroup={accountRowsByGroup}
      accounts={accounts}
      dashboardSummary={dashboardSummary}
      groupIdByAccountId={groupIdByAccountId}
      ledger={ledger}
      netWorthTrends={netWorthTrends}
      summaryStats={summaryStats}
    />
  );
}

const ROW_HISTORY_WINDOW_DAYS = 90;

interface AccountTransactionSummary {
  count: number;
  latest?: Transaction;
}

export function createAccountRow(
  account: Account,
  transactionSummary: AccountTransactionSummary,
  history: PortfolioPoint[]
): AccountRow {
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
