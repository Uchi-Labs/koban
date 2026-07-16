import type { RecurringItem, Transaction } from "@ai-finances/schema";
import type React from "react";
import type { CSSProperties } from "react";
import { CalendarClock, RefreshCw, Repeat2, Wallet } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CategoryPill } from "@/components/category-pill";
import { FaviconBadge } from "@/components/ui/favicon-badge";
import { RecurringCalendar, type CalendarRecurring, type RecurringDonutSegment } from "@/components/recurring-calendar";
import { formatCurrency } from "@/lib/format";
import { getFinanceData } from "@/lib/finance-data";
import { merchantBrandColor, merchantDomain } from "@/lib/merchant-domain";
import { isSpendingTransaction } from "@/lib/transaction-classification";
import { getAccountName, getUpcomingRecurringViews } from "@/lib/view-models";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

// One shared column grid, applied identically to the header row and every data row, so
// every column edge lands on the same x regardless of that row's content (fixed px tracks
// only — an `auto`-sized last column would resize per row and cascade misalignment into
// every fr-based column before it).
const RECURRING_ROW_GRID = "grid grid-cols-[28px_minmax(0,1fr)_128px_96px_116px_72px_128px] gap-3";
type RecurringRowStyle = CSSProperties & { "--merchant-accent": string };

/**
 * Merchant favicon when the merchant name resolves to a real domain (rare for bank-derived
 * merchant strings); otherwise an honest tinted-initial fallback in the row's category color
 * -- mirrors the AccountFaviconBadge pattern, never a fabricated logo.
 */
function MerchantAvatar({ color, merchant }: { color: string; merchant: string }) {
  const domain = merchantDomain(merchant);
  const accentColor = merchantBrandColor(merchant) ?? color;

  if (!domain) {
    return (
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{
          backgroundColor: `color-mix(in oklab, ${accentColor} 18%, transparent)`,
          color: accentColor
        }}
      >
        {merchant.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }

  return <FaviconBadge badgeClassName="bg-background/80" size="sm" website={domain} />;
}

export default async function RecurringsPage() {
  const { accounts, categories, recurringItems, transactions } = await getFinanceData();
  const candidates = getUpcomingRecurringViews(recurringItems, categories);
  const candidateRows = candidates
    .map((candidate) => ({
      ...candidate,
      accountName: candidate.accountId ? getAccountName(candidate.accountId, accounts) : "Unknown account",
      accentColor: merchantBrandColor(candidate.merchant) ?? candidate.category.color,
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
    href: recurringTransactionHref(candidate),
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
    <main className="flex min-h-svh flex-col" data-testid="recurrings-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Recurrings</span>
      </header>

      <div className="mx-auto flex w-full max-w-[70rem] flex-1 flex-col gap-6 p-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <section className="text-center">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Repeated merchants</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Recurring candidates</h1>
            <p className="mx-auto mt-1.5 max-w-xl text-sm text-muted-foreground">
              Inferred from posted transaction cadence — projected charge dates are review targets, not confirmed subscriptions.
            </p>
          </section>

          <RecurringCalendar initialMonth={now.slice(0, 7)} items={calendarItems} segments={donutSegments} today={now.slice(0, 10)} />

          <section aria-label="Recurring totals" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard icon={<Wallet size={15} />} label="Yearly forecast" value={formatCurrency(roundMoney(monthlyizedTotal * 12))} />
            <MetricCard icon={<RefreshCw size={15} />} label="Average monthly cost" value={formatCurrency(roundMoney(monthlyizedTotal))} />
            <MetricCard icon={<Repeat2 size={15} />} label="Detected candidates" value={candidateRows.length.toLocaleString()} />
            <MetricCard icon={<CalendarClock size={15} />} label="Due or overdue" value={upcomingCount.toLocaleString()} />
          </section>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Detected recurring charges</h2>
            <p className="text-sm text-muted-foreground">Sorted by expected charge date, with the account and observed transaction count shown for auditability.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-0.5">
            {candidateRows.length > 0 ? (
              <div className={`${RECURRING_ROW_GRID} px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase`}>
                <span aria-hidden="true" />
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
                className={`${RECURRING_ROW_GRID} items-center rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--merchant-accent)_9%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none`}
                href={recurringTransactionHref(candidate)}
                key={candidate.id}
                style={{ "--merchant-accent": candidate.accentColor } as RecurringRowStyle}
              >
                <MerchantAvatar color={candidate.accentColor} merchant={candidate.merchant} />
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
              <p className="px-1 text-sm text-muted-foreground">No recurring candidates found in synced transactions yet.</p>
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
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{label}</span>
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
