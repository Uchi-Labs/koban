import type React from "react";
import type { CSSProperties } from "react";
import { CalendarClock, RefreshCw, Repeat2, Wallet } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CategoryPill } from "@/components/category-pill";
import { FaviconBadge } from "@/components/ui/favicon-badge";
import { RecurringCalendar, type CalendarRecurring, type RecurringDonutSegment } from "@/components/recurring-calendar";
import { formatCurrency } from "@/lib/format";
import { merchantBrandColor, merchantDomain } from "@/lib/merchant-domain";
import { getUpcomingRecurringViews } from "@/lib/view-models";
import { PageHeader, pageFrameClassName } from "@/components/page-header";

// One shared column grid, applied identically to the header row and every data row, so
// every column edge lands on the same x regardless of that row's content (fixed px tracks
// only — an `auto`-sized last column would resize per row and cascade misalignment into
// every fr-based column before it). Columns drop by the table's own width (it narrows when
// the agent docks): category from 36rem, last charged and observed from 60rem.
const RECURRING_ROW_GRID =
  "grid grid-cols-[28px_minmax(0,1fr)_96px_92px] gap-3 @xl/recurring:grid-cols-[28px_minmax(0,1fr)_100px_96px_minmax(0,9.5rem)] @5xl/recurring:grid-cols-[28px_minmax(0,1fr)_104px_100px_116px_72px_minmax(0,9.5rem)]";
const RECURRING_CATEGORY_CELL = "hidden min-w-0 @xl/recurring:block";
const RECURRING_WIDE_CELL = "hidden @5xl/recurring:block";
type RecurringRowStyle = CSSProperties & { "--merchant-accent": string };

type RecurringCandidateRow = Awaited<ReturnType<typeof getUpcomingRecurringViews>>[number] & {
  accentColor: string;
  accountName: string;
  href: string;
  lastChargedLabel: string;
  monthlyizedAmount: number;
  observedCount: number;
};

export interface RecurringsViewProps {
  calendarItems: CalendarRecurring[];
  candidateRows: RecurringCandidateRow[];
  donutSegments: RecurringDonutSegment[];
  monthlyizedTotal: number;
  now: string;
  upcomingCount: number;
}

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
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold"
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

export function RecurringsView({
  calendarItems,
  candidateRows,
  donutSegments,
  monthlyizedTotal,
  now,
  upcomingCount
}: RecurringsViewProps) {
  return (
    <main className="@container/page w-full" data-testid="recurrings-page">
      <div className={pageFrameClassName}>
        <PageHeader
          description="Charges Koban spotted repeating in your transactions. Expected dates are estimates from past charges, not confirmed bills."
          title="Recurring candidates"
        />

        {/* Side by side only when the page itself is wide; it narrows when the agent docks. */}
        <div className="grid w-full items-start gap-5 @6xl/page:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
          <div className="flex w-full min-w-0 flex-col gap-5">
            <RecurringCalendar initialMonth={now.slice(0, 7)} items={calendarItems} segments={donutSegments} today={now.slice(0, 10)} />

            <section aria-label="Recurring totals" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricCard icon={<Wallet size={15} />} label="Yearly forecast" value={formatCurrency(roundMoney(monthlyizedTotal * 12))} />
              <MetricCard icon={<RefreshCw size={15} />} label="Average monthly cost" value={formatCurrency(roundMoney(monthlyizedTotal))} />
              <MetricCard icon={<Repeat2 size={15} />} label="Detected candidates" value={candidateRows.length.toLocaleString()} />
              <MetricCard icon={<CalendarClock size={15} />} label="Due or overdue" value={upcomingCount.toLocaleString()} />
            </section>
          </div>

          <Card className="@container/recurring min-w-0">
            <CardHeader>
              <h2 className="text-base font-medium">Detected recurring charges</h2>
              <p className="text-sm text-muted-foreground">Soonest first, with the account each charge comes from.</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5">
              {candidateRows.length > 0 ? (
                <div className={`${RECURRING_ROW_GRID} px-3 pb-1.5 text-2xs font-medium tracking-wide text-muted-foreground uppercase`}>
                  <span aria-hidden="true" />
                  <span>Merchant</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Next expected</span>
                  <span className={`${RECURRING_WIDE_CELL} text-right`}>Last charged</span>
                  <span className={`${RECURRING_WIDE_CELL} text-right`}>Observed</span>
                  <span className={RECURRING_CATEGORY_CELL}>Category</span>
                </div>
              ) : null}
              {candidateRows.map((candidate) => (
                <Link
                  aria-label={`View transactions for recurring candidate ${candidate.merchant}`}
                  className={`${RECURRING_ROW_GRID} items-center rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--merchant-accent)_9%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none`}
                  href={candidate.href}
                  key={candidate.id}
                  style={{ "--merchant-accent": candidate.accentColor } as RecurringRowStyle}
                >
                  <MerchantAvatar color={candidate.accentColor} merchant={candidate.merchant} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{candidate.merchant}</p>
                    <p className="truncate text-xs text-muted-foreground">{candidate.accountName}</p>
                  </div>
                  {/* Amount over cadence — stacked so "Monthly" never truncates at
                      the narrower xl column widths. Mirrors the two-line merchant cell. */}
                  <div className="min-w-0 text-right">
                    <p className="font-medium tabular-nums">{formatCurrency(candidate.averageAmount)}</p>
                    <p className="text-2xs text-muted-foreground">{candidate.frequency}</p>
                  </div>
                  <div className="text-right tabular-nums">{candidate.nextDateLabel}</div>
                  <div className={`${RECURRING_WIDE_CELL} text-right tabular-nums`}>{candidate.lastChargedLabel}</div>
                  <div className={`${RECURRING_WIDE_CELL} text-right tabular-nums`}>{candidate.observedCount.toLocaleString()}</div>
                  <div className={RECURRING_CATEGORY_CELL}>
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
      {/* Label above value, not beside it. Side by side, a two-word label wrapped
          to a second line while the value had no shrink-0 to hold its ground, so
          the two overlapped -- "Yearly forecast" printed straight through
          "$35,077.68". Stacking cannot collide at any width, and it is the usual
          shape for a stat tile anyway: caption, then the figure it captions. */}
      <CardContent className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          {/* The label wraps rather than truncating. Truncating turned "Average
              monthly cost" into "Average monthly c…", which is no more readable
              than the overlap it replaced; stacked, a second line costs nothing
              because the card grows to fit. The value keeps tabular-nums and
              never wraps, so figures stay comparable down the column. */}
          <span className="text-xs text-balance text-muted-foreground">{label}</span>
          <strong className="text-lg font-semibold whitespace-nowrap tabular-nums">{value}</strong>
        </span>
      </CardContent>
    </Card>
  );
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
