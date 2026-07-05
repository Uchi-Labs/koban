import type { Transaction } from "@ai-finances/schema";
import { isSpendingTransaction } from "@/lib/transaction-classification";

export type MonthlySpendingProjectionConfidence = "early" | "blended" | "pace";

export interface MonthlySpendingProjection {
  amount: number;
  confidence: MonthlySpendingProjectionConfidence;
  dayOfMonth: number;
  daysInMonth: number;
  paceProjection: number;
  paceWeight: number;
  trailingAverage: number;
}

export function createMonthlySpendingProjection({
  latestDate,
  monthlySpending,
  transactions
}: {
  latestDate: string;
  monthlySpending: number;
  transactions: Transaction[];
}): MonthlySpendingProjection {
  if (monthlySpending <= 0) {
    return {
      amount: 0,
      confidence: "early",
      dayOfMonth: 1,
      daysInMonth: 30,
      paceProjection: 0,
      paceWeight: 0,
      trailingAverage: 0
    };
  }

  const parsed = new Date(`${latestDate}T12:00:00Z`);
  const dayOfMonth = Math.max(1, parsed.getUTCDate());
  const daysInMonth = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
  const paceProjection = roundMoney((monthlySpending / dayOfMonth) * daysInMonth);
  const trailingAverage = getTrailingAverageMonthlySpending(transactions, latestDate) ?? monthlySpending;
  const paceWeight = dayOfMonth >= daysInMonth ? 1 : clamp(dayOfMonth / daysInMonth, 0.18, 0.88);
  const blendedProjection = paceProjection * paceWeight + trailingAverage * (1 - paceWeight);

  return {
    amount: roundMoney(Math.max(monthlySpending, blendedProjection)),
    confidence: getProjectionConfidence(dayOfMonth),
    dayOfMonth,
    daysInMonth,
    paceProjection,
    paceWeight,
    trailingAverage: roundMoney(trailingAverage)
  };
}

function getTrailingAverageMonthlySpending(transactions: Transaction[], latestDate: string) {
  const latestMonth = latestDate.slice(0, 7);
  const monthTotals = getPreviousMonthKeys(latestMonth, 3)
    .map((month) => getMonthSpending(transactions, month))
    .filter((amount) => amount > 0);

  if (monthTotals.length === 0) {
    return undefined;
  }

  return roundMoney(monthTotals.reduce((total, amount) => total + amount, 0) / monthTotals.length);
}

function getMonthSpending(transactions: Transaction[], month: string) {
  return roundMoney(
    transactions
      .filter((transaction) => transaction.date.startsWith(month) && isSpendingTransaction(transaction))
      .reduce((total, transaction) => total + Math.abs(transaction.amount), 0)
  );
}

function getPreviousMonthKeys(latestMonth: string, count: number) {
  return Array.from({ length: count }, (_, index) => addMonths(latestMonth, -(index + 1)));
}

function addMonths(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function getProjectionConfidence(dayOfMonth: number): MonthlySpendingProjectionConfidence {
  if (dayOfMonth < 10) {
    return "early";
  }

  if (dayOfMonth < 21) {
    return "blended";
  }

  return "pace";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
