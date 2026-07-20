import { Upload, WalletCards } from "lucide-react";
import Link from "next/link";
import { CategoryPill } from "@/components/category-pill";
import { MiniLineChart } from "@/components/charts";
import { DashboardNetWorthCard } from "@/components/dashboard-net-worth-card";
import { DashboardReviewCard } from "@/components/dashboard-review-card";
import { DashboardCard } from "@/components/dashboard-card";
import { NetWorthAccountsDialog } from "@/components/net-worth-accounts-dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/card";
import { FaviconBadge } from "@/components/ui/favicon-badge";
import { FinanceStatItem, FinanceStatStrip, MoneyHero } from "@/components/money-hero";
import { TextReveal } from "@/components/motion/text-reveal";
import { buildTopCategoryCells } from "@/lib/dashboard-top-categories";
import { createMonthlySpendingProjection } from "@/lib/finance-projection";
import { getFinanceData } from "@/lib/finance-data";
import { applyBudgetOverrides, getCategoryBudgetOverrides } from "@/lib/category-budgets";
import { formatCurrency } from "@/lib/format";
import { getDismissedInsightIds } from "@/lib/insight-dismissals";
import { deriveInsights } from "@/lib/insights";
import { InsightsFeed } from "@/components/insights-feed";
import { merchantDomain } from "@/lib/merchant-domain";
import { buildDashboardTrends } from "@/lib/net-worth-trend";
import { buildNetWorthToggleGroups } from "@/lib/net-worth-toggles";
import { isReviewActionableTransaction } from "@/lib/transaction-classification";
import { getTransactionViews, getUpcomingRecurringViews } from "@/lib/view-models";

export default async function DashboardPage() {
  const [financeData, budgetOverrides, dismissedInsights] = await Promise.all([
    getFinanceData(),
    getCategoryBudgetOverrides(),
    getDismissedInsightIds()
  ]);
  const {
    accountGroups,
    accounts,
    categories,
    dashboardSummary,
    recurringItems,
    source,
    transactions
  } = financeData;
  const insights = deriveInsights(transactions, applyBudgetOverrides(categories, budgetOverrides)).filter((item) => !dismissedInsights.has(item.id));
  const reviewRows = getTransactionViews(
    transactions.filter(isReviewActionableTransaction).slice(0, 10),
    { accounts, categories }
  );
  const recurringViews = getUpcomingRecurringViews(recurringItems, categories);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const monthlyBudget = categories.reduce((total, category) => total + (category.budgetAmount ?? 0), 0);
  const monthlySpending = Math.abs(dashboardSummary.monthlySpending);
  const monthlyBudgetDelta = monthlySpending - monthlyBudget;
  const { latestTransactionDate, netWorthTrends, spendingTrend } = buildDashboardTrends(
    dashboardSummary.netWorth,
    transactions
  );
  const monthlySpendingProjection = createMonthlySpendingProjection({
    latestDate: latestTransactionDate,
    monthlySpending,
    transactions
  });
  const projectedMonthlySpending = monthlySpendingProjection.amount;
  const reviewSectionLabel = reviewRows[0]?.dateLabel ?? "Latest";
  const investmentBalance = accountGroups.find((group) => group.id === "group_investments")?.totalBalance ?? 0;
  const topCategoryCells = buildTopCategoryCells(dashboardSummary.topCategories, categories);

  const overBudget = monthlyBudgetDelta >= 0;
  const projectionIsEarly = monthlySpendingProjection.confidence === "early";
  const projectedOverBudget = !projectionIsEarly && projectedMonthlySpending > monthlyBudget && monthlyBudget > 0;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-6 lg:px-8" data-testid="dashboard-page">
      <div className="mb-5 flex items-center gap-3">
        <TextReveal
          as="h1"
          blur={4}
          className="app-page-title"
          stagger={0}
          text="Dashboard"
          yOffset={6}
        />
        {source === "koban" ? (
          <Badge appearance="dot" dotColor="positive" variant="synced" className="font-normal">
            Synced accounts
          </Badge>
        ) : null}
      </div>

      {/* Content sits beside a 256px sidebar, so the 2-up grid only has room once the
          viewport clears ~1024px (md's 768px leaves cards ~250px wide with the sidebar
          open) -- below that, cards stack single-column instead of cramming. */}
      <section className="grid gap-3 lg:grid-cols-2" aria-label="Dashboard overview">
        <DashboardCard title="Monthly spending" action={{ label: "Transactions", href: "/transactions" }} surface="iconiq">
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
            className="mt-3 h-32"
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
              animatedCurrency: dashboardSummary.currency,
              animatedValue: dashboardSummary.cashBalance,
              label: "Cash",
              tone: "positive",
              value: formatCurrency(dashboardSummary.cashBalance, dashboardSummary.currency)
            },
            {
              animatedCurrency: dashboardSummary.currency,
              animatedValue: Math.abs(dashboardSummary.creditBalance),
              label: "Credit",
              tone: dashboardSummary.creditBalance < 0 ? "negative" : "muted",
              value: formatCurrency(Math.abs(dashboardSummary.creditBalance), dashboardSummary.currency)
            },
            {
              animatedCurrency: dashboardSummary.currency,
              animatedValue: investmentBalance,
              label: "Invest",
              tone: "primary",
              value: formatCurrency(investmentBalance, dashboardSummary.currency)
            }
          ]}
          currentNetWorth={dashboardSummary.netWorth}
          currency={dashboardSummary.currency}
          settingsSlot={<NetWorthAccountsDialog groups={buildNetWorthToggleGroups(accounts)} />}
          trends={netWorthTrends}
        />

        <DashboardCard title="Transactions to review" action={{ label: "View all", href: "/transactions?review=actionable" }} surface="iconiq">
          <DashboardReviewCard
            initialRows={reviewRows}
            lastSyncedAt={dashboardSummary.asOf}
            reviewSectionLabel={reviewSectionLabel}
            totalToReview={dashboardSummary.transactionsToReview}
          />
        </DashboardCard>

        <div className="grid content-start gap-3">
          <DashboardCard title="Top categories" action={{ label: "View all", href: "/categories" }} surface="iconiq">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {topCategoryCells.map((cell) => {
                const category = categoryById.get(cell.categoryId);
                const remaining = Math.max(0, cell.budget - cell.amount);

                return (
                  <div className="grid gap-1.5" key={cell.categoryId}>
                    <div className="flex items-center justify-between gap-2">
                      {category ? (
                        <CategoryPill className="min-w-0 max-w-full" category={category} />
                      ) : (
                        <CategoryPill category={{ archived: false, color: "", emoji: "🏷️", icon: "circle", id: "cat_other", name: "Other", sortOrder: 0 }} />
                      )}
                      <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                        {formatCurrency(cell.amount, dashboardSummary.currency)}
                      </span>
                    </div>
                    <span
                      className="block h-1.5 overflow-hidden rounded-full"
                      style={{
                        background: `color-mix(in oklab, ${category?.color ?? "var(--muted-foreground)"} 14%, transparent)`
                      }}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{
                          background: category?.color ?? "var(--muted-foreground)",
                          width: `${cell.budget > 0 ? Math.min(100, (cell.amount / cell.budget) * 100) : 0}%`
                        }}
                      />
                    </span>
                    <span className="text-right text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(remaining, dashboardSummary.currency)} left
                    </span>
                  </div>
                );
              })}
            </div>
          </DashboardCard>

          <DashboardCard title="Insights" action={{ label: "View all", href: "/insights" }} surface="iconiq">
            <InsightsFeed compact initialInsights={insights} />
          </DashboardCard>

          <DashboardCard title="Next two weeks" action={{ label: "Recurrings", href: "/recurrings" }} surface="iconiq">
            {recurringViews.length > 0 ? (
              <div className="grid gap-2">
                {recurringViews.slice(0, 2).map((item) => {
                  const domain = merchantDomain(item.merchant);

                  return (
                    <Link href="/recurrings" key={item.id}>
                      <div className="gap-0 rounded-xl border border-border/50 bg-background/45 py-0 transition-colors hover:bg-muted/40 motion-reduce:transition-none">
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{item.nextDateLabel}</span>
                          {domain ? <FaviconBadge badgeClassName="bg-background" size="sm" website={domain} /> : null}
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium text-foreground">{item.merchant}</span>
                            <span className="truncate text-xs text-muted-foreground">{item.frequency}</span>
                          </div>
                          <Badge appearance="dot" className="hidden font-normal sm:inline-flex" dotColor="muted" variant="recurring">
                            Recurring
                          </Badge>
                          <CategoryPill className="hidden min-[390px]:inline-flex" category={item.category} />
                          <span className="min-w-[5rem] text-right text-sm font-medium tabular-nums text-foreground">
                            {formatCurrency(Math.abs(item.amount), item.currency)}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">Sync more account history to infer recurring charges.</p>
            )}
          </DashboardCard>
        </div>
      </section>

      {/* The populated "Account summary" card duplicated the Net worth card's
          Cash/Credit/Invest breakdown, so it's removed to keep the dashboard in
          one viewport. The zero-account onboarding CTA is kept — it's the only
          connect-an-account affordance on an empty dashboard. */}
      {accountGroups.length === 0 ? (
        <section className="mt-4" aria-label="Account summary">
          <DashboardCard title="Account summary" action={{ label: "Settings", href: "/settings" }} surface="iconiq">
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
              description="Sync a connected account or import historical transactions before account totals can be summarized."
              icon={<WalletCards className="size-5" />}
              title="Connect an account"
            />
          </DashboardCard>
        </section>
      ) : null}
    </main>
  );
}
