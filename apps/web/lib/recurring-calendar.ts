import type { RecurringCadence } from "@ai-finances/schema";

/** Minimal shape recurring-calendar projection needs from a RecurringItem. */
export interface RecurringAnchor {
  cadence: RecurringCadence;
  nextDate: string;
}

const DAY_MS = 86_400_000;

const CADENCE_STEP_DAYS: Partial<Record<RecurringCadence, number>> = {
  biweekly: 14,
  weekly: 7
};

const CADENCE_STEP_MONTHS: Partial<Record<RecurringCadence, number>> = {
  annual: 12,
  monthly: 1,
  quarterly: 3
};

function toUtc(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Project the expected charge dates of a recurring item into a calendar month
 * ("YYYY-MM"), in both directions from its `nextDate` anchor. Month-stepped
 * cadences clamp the anchor's day-of-month to the target month's length
 * (Jan 31 → Feb 28). These are estimates for display, not ledger facts.
 */
export function occurrencesInMonth(item: RecurringAnchor, month: string): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const stepDays = CADENCE_STEP_DAYS[item.cadence];

  if (stepDays !== undefined) {
    const anchor = toUtc(item.nextDate);
    const monthStart = Date.UTC(year, monthNumber - 1, 1);
    const monthEnd = Date.UTC(year, monthNumber - 1, daysInMonth(year, monthNumber));
    const stepMs = stepDays * DAY_MS;
    const stepsToStart = Math.ceil((monthStart - anchor) / stepMs);
    const dates: string[] = [];
    for (let time = anchor + stepsToStart * stepMs; time <= monthEnd; time += stepMs) {
      dates.push(formatUtc(time));
    }
    return dates;
  }

  const stepMonths = CADENCE_STEP_MONTHS[item.cadence] ?? 1;
  const [anchorYear, anchorMonth, anchorDay] = item.nextDate.split("-").map(Number);
  const monthsFromAnchor = (year - anchorYear) * 12 + (monthNumber - anchorMonth);
  if (monthsFromAnchor % stepMonths !== 0) {
    return [];
  }

  const day = Math.min(anchorDay, daysInMonth(year, monthNumber));
  return [`${month}-${String(day).padStart(2, "0")}`];
}

/** Monday-first weekday index (0 = Monday … 6 = Sunday) for a "YYYY-MM-01". */
export function mondayIndexOfFirst(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
}

export function daysInCalendarMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return daysInMonth(year, monthNumber);
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
