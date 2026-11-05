import type { Metadata } from "next";
import type { RecurringItem, Transaction } from "@ai-finances/schema";
import type { CalendarRecurring, RecurringDonutSegment } from "@/components/recurring-calendar";
import { RecurringsView } from "@/components/recurrings-view";
import { getFinanceData } from "@/lib/finance-data";
import { merchantBrandColor } from "@/lib/merchant-domain";
import { isSpendingTransaction } from "@/lib/transaction-classification";
import { getAccountName, getUpcomingRecurringViews } from "@/lib/view-models";

export const metadata: Metadata = { title: "Recurrings" };

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

export default async function RecurringsPage() {
  const { accounts, categories, recurringItems, transactions } = await getFinanceData();
  const candidates = getUpcomingRecurringViews(recurringItems, categories);
  const candidateRows = candidates
    .map((candidate) => ({
      ...candidate,
      accountName: candidate.accountId ? getAccountName(candidate.accountId, accounts) : "Unknown account",
      accentColor: merchantBrandColor(candidate.merchant) ?? candidate.category.color,
      href: recurringTransactionHref(candidate),
      lastChargedLabel: candidate.lastChargedAt ? formatDate(candidate.lastChargedAt) : "N/A",
      monthlyizedAmount: monthlyize(candidate),
      observedCount: countRecurringObservations(candidate, transactions)
    }))
    .sort((left, right) => left.nextDate.localeCompare(right.nextDate) || right.monthlyizedAmount - left.monthlyizedAmount);
  const upcomingCount = candidateRows.filter((candidate) => isDueOrOverdueWithin(candidate.nextDate, 14)).length;
  const monthlyizedTotal = candidateRows.reduce((total, candidate) => total + candidate.monthlyizedAmount, 0);

  const now = new Date().toISOString();
  const calendarItems: CalendarRecurring[] = candidateRows.map((candidate) => ({
    amount: candidate.averageAmount,
    cadence: candidate.cadence,
    color: candidate.accentColor,
    currency: candidate.currency,
    frequencyLabel: candidate.frequency,
    href: candidate.href,
    id: candidate.id,
    name: candidate.merchant,
    nextDate: candidate.nextDate
  }));

  const segmentByCategory = new Map<string, RecurringDonutSegment>();
  for (const candidate of candidateRows) {
    const segment = segmentByCategory.get(candidate.category.id) ?? {
      color: candidate.category.color,
      id: candidate.category.id,
      monthly: 0,
      name: candidate.category.name
    };
    segment.monthly = roundMoney(segment.monthly + candidate.monthlyizedAmount);
    segmentByCategory.set(candidate.category.id, segment);
  }
  const donutSegments = Array.from(segmentByCategory.values()).sort((left, right) => right.monthly - left.monthly);

  return (
    <RecurringsView
      calendarItems={calendarItems}
      candidateRows={candidateRows}
      donutSegments={donutSegments}
      monthlyizedTotal={monthlyizedTotal}
      now={now}
      upcomingCount={upcomingCount}
    />
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
