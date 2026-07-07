import type { RecurringItem, Transaction } from "@ai-finances/schema";
import type React from "react";
import { CalendarClock, Repeat2, TrendingDown } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CategoryPill } from "@/components/category-pill";
import { formatCurrency } from "@/lib/format";
import { getFinanceData } from "@/lib/finance-data";
import { isSpendingTransaction } from "@/lib/transaction-classification";
import { getAccountName, getUpcomingRecurringViews } from "@/lib/view-models";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

// One shared column grid, applied identically to the header row and every data row, so
// every column edge lands on the same x regardless of that row's content (fixed px tracks
// only — an `auto`-sized last column would resize per row and cascade misalignment into
// every fr-based column before it).
const RECURRING_ROW_GRID = "grid grid-cols-[minmax(0,1fr)_128px_96px_116px_72px_128px] gap-3";

export default async function RecurringsPage() {
  const { accounts, categories, recurringItems, transactions } = await getFinanceData();
  const candidates = getUpcomingRecurringViews(recurringItems, categories);
  const candidateRows = candidates
    .map((candidate) => ({
      ...candidate,
      accountName: candidate.accountId ? getAccountName(candidate.accountId, accounts) : "Unknown account",
      monthlyizedAmount: monthlyize(candidate),
      observedCount: countRecurringObservations(candidate, transactions)
    }))
    .sort((left, right) => left.nextDate.localeCompare(right.nextDate) || right.monthlyizedAmount - left.monthlyizedAmount);
  const upcomingCount = candidateRows.filter((candidate) => isDueOrOverdueWithin(candidate.nextDate, 14)).length;
  const monthlyizedTotal = candidateRows.reduce((total, candidate) => total + candidate.monthlyizedAmount, 0);
  const latestTransactionDate = transactions.map((transaction) => transaction.date).sort().at(-1);

  return (
    <main className="flex min-h-svh flex-col" data-testid="recurrings-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Recurrings</span>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
        <section>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Repeated Teller merchants</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Recurring candidates</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Recurrings are inferred from posted Teller transaction cadence. They are review targets, not confirmed merchant subscriptions.
          </p>
        </section>

        <section aria-label="Recurring totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<Repeat2 size={16} />} label="Detected candidates" value={candidateRows.length.toLocaleString()} />
          <MetricCard icon={<CalendarClock size={16} />} label="Due or overdue" value={upcomingCount.toLocaleString()} />
          <MetricCard icon={<TrendingDown size={16} />} label="Monthlyized spend" value={formatCurrency(monthlyizedTotal)} />
          <MetricCard label="Latest Teller date" value={latestTransactionDate ? formatDate(latestTransactionDate) : "N/A"} />
        </section>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Detected recurring charges</h2>
            <p className="text-sm text-muted-foreground">Sorted by expected charge date, with the account and observed transaction count shown for auditability.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-0.5">
            {candidateRows.length > 0 ? (
              <div className={`${RECURRING_ROW_GRID} px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase`}>
                <span>Merchant</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Next expected</span>
                <span className="text-right">Last charged</span>
                <span className="text-right">Observed</span>
                <span>Category</span>
              </div>
            ) : null}
            {candidateRows.map((candidate) => (
              <Link
                aria-label={`View transactions for recurring candidate ${candidate.merchant}`}
                className={`${RECURRING_ROW_GRID} items-center rounded-xl px-3 py-2 text-sm transition-colors hover:bg-muted/60`}
                href={recurringTransactionHref(candidate)}
                key={candidate.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{candidate.merchant}</p>
                  <p className="truncate text-xs text-muted-foreground">{candidate.accountName}</p>
                </div>
                <div className="flex items-baseline justify-end gap-1.5 overflow-hidden">
                  <span className="truncate text-[11px] text-muted-foreground">{candidate.frequency}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatCurrency(candidate.averageAmount)}</span>
                </div>
                <div className="text-right tabular-nums">{candidate.nextDateLabel}</div>
                <div className="text-right tabular-nums">{candidate.lastChargedAt ? formatDate(candidate.lastChargedAt) : "N/A"}</div>
                <div className="text-right tabular-nums">{candidate.observedCount.toLocaleString()}</div>
                <div className="min-w-0">
                  <CategoryPill category={candidate.category} className="max-w-full" />
                </div>
              </Link>
            ))}
            {candidateRows.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">No recurring candidates found in synced Teller transactions yet.</p>
            ) : null}
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

function monthlyize(item: RecurringItem) {
  switch (item.cadence) {
    case "weekly":
      return roundMoney(item.averageAmount * 4.345);
    case "biweekly":
      return roundMoney(item.averageAmount * 2.172);
    case "monthly":
      return item.averageAmount;
    case "quarterly":
      return roundMoney(item.averageAmount / 3);
    case "annual":
      return roundMoney(item.averageAmount / 12);
  }
}

function countRecurringObservations(item: RecurringItem, transactions: Transaction[]) {
  const merchantKey = normalize(item.name);
  return transactions.filter((transaction) => (
    transaction.accountId === item.accountId &&
    isSpendingTransaction(transaction) &&
    transaction.status === "posted" &&
    normalize(transaction.merchantName) === merchantKey
  )).length;
}

function recurringTransactionHref(item: RecurringItem & { merchant: string }) {
  const params = new URLSearchParams({
    category_id: item.categoryId,
    q: item.merchant
  });

  if (item.accountId) {
    params.set("account_id", item.accountId);
  }

  return `/transactions?${params.toString()}`;
}

function isDueOrOverdueWithin(date: string, days: number) {
  const now = new Date();
  const target = new Date(`${date}T12:00:00Z`);
  const difference = target.getTime() - now.getTime();
  return difference <= days * 86_400_000;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatDate(date: string) {
  return shortDateFormatter.format(new Date(`${date}T12:00:00Z`));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
