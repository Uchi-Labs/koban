import { Upload, WalletCards } from "lucide-react";
import Link from "next/link";
import { CategoryPill } from "@/components/category-pill";
import { MiniLineChart } from "@/components/charts";
import { DashboardNetWorthCard, type NetWorthRange } from "@/components/dashboard-net-worth-card";
import { DashboardReviewCard } from "@/components/dashboard-review-card";
import { DashboardCard } from "@/components/dashboard-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/card";
import { FinanceStatItem, FinanceStatStrip, MoneyHero, type FinanceStatTone } from "@/components/money-hero";
import { createMonthlySpendingProjection } from "@/lib/finance-projection";
import { getFinanceData, type FinanceData } from "@/lib/finance-data";
import { formatCurrency } from "@/lib/format";
import { isReviewActionableTransaction, isSpendingTransaction } from "@/lib/transaction-classification";
import { getTransactionViews, getUpcomingRecurringViews } from "@/lib/view-models";

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
const dateLabelFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

export default async function DashboardPage() {
  const {
    accountGroups,
    accounts,
    categories,
    dashboardSummary,
    recurringItems,
    source,
    transactions
  } = await getFinanceData();
  const reviewRows = getTransactionViews(transactions, { accounts, categories })
    .filter(isReviewActionableTransaction)
    .slice(0, 10);
  const recurringViews = getUpcomingRecurringViews(recurringItems, categories);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const monthlyBudget = categories.reduce((total, category) => total + (category.budgetAmount ?? 0), 0);
  const monthlySpending = Math.abs(dashboardSummary.monthlySpending);
  const monthlyBudgetDelta = monthlySpending - monthlyBudget;
  const latestTransactionDate = getLatestTransactionDate(transactions);
  const monthlySpendingProjection = createMonthlySpendingProjection({
    latestDate: latestTransactionDate,
    monthlySpending,
    transactions
  });
  const projectedMonthlySpending = monthlySpendingProjection.amount;
  const spendingTrend = createMonthlySpendingTrend(transactions);
  const netWorthTrends = createNetWorthRangeTrends(dashboardSummary.netWorth, transactions);
  const reviewSectionLabel = reviewRows[0]?.dateLabel ?? "Latest";
  const investmentBalance = accountGroups.find((group) => group.id === "group_investments")?.totalBalance ?? 0;

  const overBudget = monthlyBudgetDelta >= 0;
  const projectionIsEarly = monthlySpendingProjection.confidence === "early";
  const projectedOverBudget = !projectionIsEarly && projectedMonthlySpending > monthlyBudget && monthlyBudget > 0;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 lg:px-8" data-testid="dashboard-page">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Dashboard</h1>
        {source === "teller" ? (
          <Badge appearance="dot" dotColor="positive" variant="synced" className="font-normal">
            Synced Teller data
          </Badge>
        ) : null}
      </div>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Dashboard overview">
        <DashboardCard title="Monthly spending" action={{ label: "Transactions", href: "/transactions" }}>
          <div className="flex flex-col gap-2 min-[390px]:flex-row min-[390px]:items-end min-[390px]:justify-between min-[390px]:gap-3">
            <div className="min-w-0">
              <MoneyHero amount={monthlySpending} currency={dashboardSummary.currency} />
              <div className="mt-1 text-xs text-muted-foreground">
                of {formatCurrency(monthlyBudget, dashboardSummary.currency)} budgeted
              </div>
            </div>
            <Badge className="border-transparent font-medium tabular-nums" variant={overBudget ? "over-budget" : "under-budget"}>
              {formatCurrency(Math.abs(monthlyBudgetDelta), dashboardSummary.currency)} {overBudget ? "over" : "left"}
            </Badge>
          </div>
          <FinanceStatStrip className="mt-3">
            <FinanceStatItem
              label="Spent"
              tone="primary"
              value={formatCurrency(monthlySpending, dashboardSummary.currency)}
            />
            <FinanceStatItem
              label="Projected"
              tone={projectedOverBudget ? "negative" : "muted"}
              unit={projectionIsEarly ? "Early estimate" : undefined}
              value={formatCurrency(projectedMonthlySpending, dashboardSummary.currency)}
            />
            <FinanceStatItem
              label="Budget"
              tone="positive"
              value={formatCurrency(monthlyBudget, dashboardSummary.currency)}
            />
          </FinanceStatStrip>
          <MiniLineChart
            budget={monthlyBudget}
            className="mt-3 h-36"
            points={spendingTrend}
            projection={{
              amount: projectedMonthlySpending,
              label: projectionIsEarly ? "Early estimate" : "Projected"
            }}
          />
        </DashboardCard>

        <DashboardNetWorthCard
          accountStats={[
            {
              label: "Cash",
              tone: "positive",
              value: formatCurrency(dashboardSummary.cashBalance, dashboardSummary.currency)
            },
            {
              label: "Credit",
              tone: dashboardSummary.creditBalance < 0 ? "negative" : "muted",
              value: formatCurrency(Math.abs(dashboardSummary.creditBalance), dashboardSummary.currency)
            },
            {
              label: "Invest",
              tone: "primary",
              value: formatCurrency(investmentBalance, dashboardSummary.currency)
            }
          ]}
          currentNetWorth={dashboardSummary.netWorth}
          currency={dashboardSummary.currency}
          trends={netWorthTrends}
        />

        <DashboardCard title="Transactions to review" action={{ label: "View all", href: "/transactions?review=actionable" }}>
          <DashboardReviewCard
            initialRows={reviewRows}
            lastSyncedAt={dashboardSummary.asOf}
            reviewSectionLabel={reviewSectionLabel}
            totalToReview={dashboardSummary.transactionsToReview}
          />
        </DashboardCard>

        <div className="grid content-start gap-4">
          <DashboardCard title="Top categories" action={{ label: "View all", href: "/categories" }}>
            <div className="grid gap-3">
              {dashboardSummary.topCategories.map((summary) => {
                const category = categoryById.get(summary.categoryId);
                const amount = Math.abs(summary.amount);
                const budget = summary.budgetAmount ?? amount;
                const remaining = Math.max(0, budget - amount);

                return (
                  <div className="grid gap-1.5" key={summary.categoryId}>
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 min-[390px]:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
                      <span
                        className="size-2 shrink-0 rounded-[3px]"
                        style={{ background: category?.color ?? "var(--muted-foreground)" }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{category?.name ?? "Other"}</span>
                      <span className="text-sm font-medium tabular-nums text-foreground">
                        {formatCurrency(amount, dashboardSummary.currency)}
                      </span>
                      <span className="col-start-2 text-xs tabular-nums text-muted-foreground min-[390px]:col-start-auto min-[390px]:w-16 min-[390px]:text-right">
                        {formatCurrency(remaining, dashboardSummary.currency)} left
                      </span>
                    </div>
                    <span className="block h-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          background: category?.color ?? "var(--muted-foreground)",
                          width: `${Math.min(100, (amount / budget) * 100)}%`
                        }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          </DashboardCard>

          <DashboardCard title="Next two weeks" action={{ label: "Recurrings", href: "/recurrings" }}>
            {recurringViews.length > 0 ? (
              <div className="divide-y divide-border">
                {recurringViews.slice(0, 2).map((item) => (
                  <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2 min-[390px]:grid-cols-[3.5rem_minmax(0,1fr)_auto_auto]" key={item.id}>
                    <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{item.nextDateLabel}</span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">{item.merchant}</span>
                      <span className="truncate text-xs text-muted-foreground">{item.frequency}</span>
                    </div>
                    <Badge appearance="dot" className="hidden font-normal sm:inline-flex" dotColor="muted" variant="recurring">
                      Recurring
                    </Badge>
                    <CategoryPill className="hidden min-[390px]:inline-flex" category={item.category} />
                    <span className="text-sm font-medium tabular-nums text-foreground">
                      {formatCurrency(Math.abs(item.amount), item.currency)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">Sync more Teller history to infer recurring charges.</p>
            )}
          </DashboardCard>
        </div>
      </section>

      {accountGroups.length > 0 ? (
        <section className="mt-4" aria-label="Account summary">
          <DashboardCard title="Account summary" action={{ label: "Accounts", href: "/accounts" }}>
            <FinanceStatStrip className="overflow-x-auto">
              {accountGroups.map((group) => (
                <FinanceStatItem
                  className="min-w-36"
                  key={group.id}
                  label={group.name}
                  tone={accountGroupTone(group.id)}
                  value={formatCurrency(group.totalBalance, group.currency)}
                />
              ))}
            </FinanceStatStrip>
          </DashboardCard>
        </section>
      ) : (
        <section className="mt-4" aria-label="Account summary">
          <DashboardCard title="Account summary" action={{ label: "Settings", href: "/settings" }}>
            <EmptyState
              actions={
                <>
                  <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href="/settings">
                    <WalletCards className="size-4" />
                    Connect an account
                  </Link>
                  <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/settings">
                    <Upload className="size-4" />
                    Import CSV
                  </Link>
                </>
              }
              description="Sync a Teller connection or import historical transactions before account totals can be summarized."
              icon={<WalletCards className="size-5" />}
              title="Connect an account"
            />
          </DashboardCard>
        </section>
      )}
    </main>
  );
}

function createMonthlySpendingTrend(transactions: FinanceData["transactions"]) {
  const months = getRecentMonthKeys(transactions, 6);

  return months.map((month) => ({
    label: formatMonthLabel(month),
    spending: roundMoney(
      transactions
        .filter((transaction) => transaction.date.startsWith(month) && isSpendingTransaction(transaction))
        .reduce((total, transaction) => total + Math.abs(transaction.amount), 0)
    )
  }));
}

function createNetWorthRangeTrends(
  currentNetWorth: number,
  transactions: FinanceData["transactions"]
) {
  const latestDate = getLatestTransactionDate(transactions);
  const latestMonth = latestDate.slice(0, 7);
  const latestYear = Number.parseInt(latestDate.slice(0, 4), 10);
  const earliestMonth = transactions.map((transaction) => transaction.date.slice(0, 7)).sort()[0] ?? latestMonth;
  const ytdMonthCount = monthDifference(`${latestYear}-01`, latestMonth) + 1;

  return [
    {
      label: "1W",
      points: createDailyNetWorthTrend(currentNetWorth, transactions, latestDate, 7)
    },
    {
      label: "1M",
      points: createDailyNetWorthTrend(currentNetWorth, transactions, latestDate, 30)
    },
    {
      label: "3M",
      points: createMonthlyNetWorthTrend(currentNetWorth, transactions, getRecentMonthKeys(transactions, 3))
    },
    {
      label: "YTD",
      points: createMonthlyNetWorthTrend(currentNetWorth, transactions, getRecentMonthKeys(transactions, ytdMonthCount))
    },
    {
      label: "1Y",
      points: createMonthlyNetWorthTrend(currentNetWorth, transactions, getRecentMonthKeys(transactions, 12))
    },
    {
      label: "ALL",
      points: createMonthlyNetWorthTrend(currentNetWorth, transactions, getMonthRange(earliestMonth, latestMonth))
    }
  ] satisfies Array<{ label: NetWorthRange; points: Array<{ label: string; value: number }> }>;
}

function createDailyNetWorthTrend(
  currentNetWorth: number,
  transactions: FinanceData["transactions"],
  latestDate: string,
  dayCount: number
) {
  const keys = getRecentDateKeys(latestDate, dayCount);
  const keySet = new Set(keys);
  const netCashFlowByDate = new Map<string, number>();

  for (const transaction of transactions) {
    if (keySet.has(transaction.date)) {
      netCashFlowByDate.set(transaction.date, roundMoney((netCashFlowByDate.get(transaction.date) ?? 0) + transaction.amount));
    }
  }

  return createBackwardNetWorthPoints(currentNetWorth, keys, netCashFlowByDate, formatDateLabel);
}

function createMonthlyNetWorthTrend(
  currentNetWorth: number,
  transactions: FinanceData["transactions"],
  months: string[]
) {
  const monthSet = new Set(months);
  const netCashFlowByMonth = new Map<string, number>();

  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7);
    if (monthSet.has(month)) {
      netCashFlowByMonth.set(month, roundMoney((netCashFlowByMonth.get(month) ?? 0) + transaction.amount));
    }
  }

  return createBackwardNetWorthPoints(currentNetWorth, months, netCashFlowByMonth, formatMonthLabel);
}

function createBackwardNetWorthPoints(
  currentNetWorth: number,
  keys: string[],
  netCashFlowByKey: Map<string, number>,
  formatLabel: (key: string) => string
) {
  let runningNetWorth = currentNetWorth;
  const valuesByKey = new Map<string, number>();

  for (const key of [...keys].reverse()) {
    valuesByKey.set(key, roundMoney(runningNetWorth));
    runningNetWorth = roundMoney(runningNetWorth - (netCashFlowByKey.get(key) ?? 0));
  }

  return keys.map((key) => ({
    label: formatLabel(key),
    value: valuesByKey.get(key) ?? currentNetWorth
  }));
}

function getRecentMonthKeys(transactions: FinanceData["transactions"], count: number) {
  const latestMonth = transactions
    .map((transaction) => transaction.date.slice(0, 7))
    .sort()
    .at(-1) ?? new Date().toISOString().slice(0, 7);
  const [year, month] = latestMonth.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  const months: string[] = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index, 1));
    months.push(date.toISOString().slice(0, 7));
  }

  return months;
}

function getMonthRange(startMonth: string, endMonth: string) {
  const count = monthDifference(startMonth, endMonth) + 1;
  return Array.from({ length: Math.max(1, count) }, (_, index) => addMonths(startMonth, index));
}

function monthDifference(startMonth: string, endMonth: string) {
  const [startYear, start] = startMonth.split("-").map(Number);
  const [endYear, end] = endMonth.split("-").map(Number);
  return (endYear - startYear) * 12 + (end - start);
}

function addMonths(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function getRecentDateKeys(latestDate: string, count: number) {
  return Array.from({ length: count }, (_, index) => addDays(latestDate, index - count + 1));
}

function addDays(date: string, offset: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function getLatestTransactionDate(transactions: FinanceData["transactions"]) {
  return transactions.map((transaction) => transaction.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
}

function accountGroupTone(groupId: string): FinanceStatTone {
  switch (groupId) {
    case "group_cash":
      return "positive";
    case "group_credit":
      return "negative";
    case "group_investments":
      return "primary";
    default:
      return "muted";
  }
}

function formatMonthLabel(month: string) {
  return monthLabelFormatter.format(new Date(`${month}-01T12:00:00Z`));
}

function formatDateLabel(date: string) {
  return dateLabelFormatter.format(new Date(`${date}T12:00:00Z`));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
