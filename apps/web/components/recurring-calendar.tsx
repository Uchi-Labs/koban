"use client";

import { CalendarDays, ChevronLeft, ChevronRight, PieChart, Undo2 } from "lucide-react";
import Link from "next/link";
import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import { addMonths, daysInCalendarMonth, mondayIndexOfFirst, occurrencesInMonth } from "@/lib/recurring-calendar";
import { cn } from "@/lib/utils";

export interface CalendarRecurring {
  cadence: "annual" | "biweekly" | "monthly" | "quarterly" | "weekly";
  amount: number;
  color: string;
  currency: string;
  frequencyLabel: string;
  href: string;
  id: string;
  name: string;
  nextDate: string;
}

export interface RecurringDonutSegment {
  color: string;
  id: string;
  monthly: number;
  name: string;
}

interface DayEntry {
  date: string;
  items: CalendarRecurring[];
  total: number;
}

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

const monthTitleFormatter = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC", year: "numeric" });
const dayTitleFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" });

function formatMonthTitle(month: string) {
  return monthTitleFormatter.format(new Date(`${month}-01T12:00:00Z`));
}

function formatDayTitle(date: string) {
  return dayTitleFormatter.format(new Date(`${date}T12:00:00Z`));
}

function buildMonthEntries(items: CalendarRecurring[], month: string): Map<string, DayEntry> {
  const entries = new Map<string, DayEntry>();
  for (const item of items) {
    for (const date of occurrencesInMonth(item, month)) {
      const entry = entries.get(date) ?? { date, items: [], total: 0 };
      entry.items.push(item);
      entry.total += item.amount;
      entries.set(date, entry);
    }
  }
  return entries;
}

function monthTotal(items: CalendarRecurring[], month: string): number {
  let total = 0;
  for (const item of items) {
    total += occurrencesInMonth(item, month).length * item.amount;
  }
  return total;
}

export function RecurringCalendar({ initialMonth, items, segments, today }: {
  initialMonth: string;
  items: CalendarRecurring[];
  segments: RecurringDonutSegment[];
  today: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [view, setView] = useState<"breakdown" | "calendar">("calendar");
  const [totalHovered, setTotalHovered] = useState(false);
  const [selectedDay, setSelectedDay] = useState<DayEntry | null>(null);

  const entries = useMemo(() => buildMonthEntries(items, month), [items, month]);
  const total = useMemo(() => monthTotal(items, month), [items, month]);

  // Typical month = median projected total over the year ahead; the pill calls
  // out how far the visible month drifts from it.
  const typical = useMemo(() => {
    const totals = Array.from({ length: 12 }, (_, index) => monthTotal(items, addMonths(initialMonth, index)));
    totals.sort((left, right) => left - right);
    const middle = totals.length / 2;
    return (totals[Math.floor(middle)] + totals[Math.ceil(middle) - 1]) / 2;
  }, [items, initialMonth]);

  const isCurrentMonth = month === initialMonth;
  const remaining = useMemo(() => {
    if (!isCurrentMonth) {
      return 0;
    }
    let sum = 0;
    for (const entry of entries.values()) {
      if (entry.date >= today) {
        sum += entry.total;
      }
    }
    return sum;
  }, [entries, isCurrentMonth, today]);

  const drift = total - typical;
  const regular = Math.abs(drift) < 0.5;
  const showRemaining = totalHovered && isCurrentMonth;

  const leadingBlanks = mondayIndexOfFirst(month);
  const dayCount = daysInCalendarMonth(month);

  const showBreakdown = view === "breakdown" && segments.length > 0;

  return (
    <section aria-label="Recurring calendar" className="relative flex flex-col items-center gap-5 rounded-2xl border border-border bg-card px-5 py-6">
      {segments.length > 0 ? (
        <Button
          aria-label={showBreakdown ? "Show calendar" : "Show category breakdown"}
          className="absolute top-3 right-3 text-muted-foreground"
          onClick={() => setView((current) => (current === "calendar" ? "breakdown" : "calendar"))}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {showBreakdown ? <CalendarDays className="size-4" /> : <PieChart className="size-4" />}
        </Button>
      ) : null}

      {showBreakdown ? (
        <BreakdownDonut segments={segments} />
      ) : (
        <>
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1">
          <Button aria-label="Previous month" onClick={() => setMonth((current) => addMonths(current, -1))} size="icon-sm" type="button" variant="ghost">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-40 text-center text-sm text-muted-foreground">
            {showRemaining ? "Remaining" : formatMonthTitle(month)}
          </span>
          <Button aria-label="Next month" onClick={() => setMonth((current) => addMonths(current, 1))} size="icon-sm" type="button" variant="ghost">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <span
          className="cursor-default text-4xl font-semibold tracking-tight tabular-nums"
          onMouseEnter={() => setTotalHovered(true)}
          onMouseLeave={() => setTotalHovered(false)}
          title={isCurrentMonth ? `${formatCurrency(remaining)} still to charge this month` : undefined}
        >
          {formatCurrency(showRemaining ? remaining : total)}
        </span>
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium tabular-nums",
            regular
              ? "bg-[color-mix(in_oklab,var(--positive)_14%,transparent)] text-[var(--positive)]"
              : drift > 0
                ? "bg-[color-mix(in_oklab,var(--negative)_14%,transparent)] text-[var(--negative)]"
                : "bg-[color-mix(in_oklab,var(--positive)_14%,transparent)] text-[var(--positive)]"
          )}
        >
          {regular
            ? "Regular month"
            : `${drift > 0 ? "+" : "−"}${formatCurrency(Math.abs(drift))} vs typical`}
        </span>
      </div>

      <div className="w-full max-w-xl">
        <div className="grid grid-cols-7 gap-1.5 pb-1.5">
          {WEEKDAY_LABELS.map((label, index) => (
            <span className="text-center text-[10px] font-medium tracking-wide text-muted-foreground" key={`${label}-${index}`}>
              {label}
            </span>
          ))}
        </div>
        {/* key remounts the grid per month so the fade-in replays on navigation */}
        <div className="grid grid-cols-7 gap-1.5 animate-in fade-in-0 duration-200 motion-reduce:animate-none" key={month}>
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <span aria-hidden="true" key={`blank-${index}`} />
          ))}
          {Array.from({ length: dayCount }, (_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, "0")}`;
            const entry = entries.get(date);
            return (
              <DayCell
                entry={entry}
                date={date}
                dayNumber={index + 1}
                isToday={date === today}
                key={date}
                onOpen={entry ? () => setSelectedDay(entry) : undefined}
              />
            );
          })}
        </div>
      </div>

      {!isCurrentMonth ? (
        <Button onClick={() => setMonth(initialMonth)} size="sm" type="button" variant="outline">
          <Undo2 className="size-3.5" />
          Current month
        </Button>
      ) : null}
        </>
      )}

      <Dialog onOpenChange={(open) => (!open ? setSelectedDay(null) : undefined)} open={selectedDay !== null}>
        <DialogContent className="sm:max-w-sm">
          {selectedDay ? (
            <>
              <DialogHeader>
                <DialogTitle>Recurring charges</DialogTitle>
                <DialogDescription>{formatDayTitle(selectedDay.date)}</DialogDescription>
              </DialogHeader>
              <ul className="flex flex-col gap-1">
                {selectedDay.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60"
                      href={item.href}
                    >
                      <ItemAvatar color={item.color} name={item.name} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{item.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.frequencyLabel} · <span className="tabular-nums">{formatCurrency(item.amount, item.currency)}</span>
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold tabular-nums">{formatCurrency(selectedDay.total)}</span>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DayCell({ date, dayNumber, entry, isToday, onOpen }: {
  date: string;
  dayNumber: number;
  entry?: DayEntry;
  isToday: boolean;
  onOpen?: () => void;
}) {
  const shared = cn(
    "relative flex h-12 items-center justify-center rounded-xl bg-muted/40",
    isToday && "ring-1 ring-ring/60"
  );
  const dayLabel = (
    <span className="pointer-events-none absolute right-1.5 bottom-1 text-[10px] text-muted-foreground/80 tabular-nums">
      {dayNumber}
    </span>
  );

  if (!entry || !onOpen) {
    return <div className={shared}>{dayLabel}</div>;
  }

  const visible = entry.items.slice(0, 2);
  const overflow = entry.items.length - visible.length;

  return (
    <button
      aria-label={`${formatDayTitle(date)}: ${entry.items.length} recurring ${entry.items.length === 1 ? "charge" : "charges"}, ${formatCurrency(entry.total)}`}
      className={cn(shared, "transition-[filter] hover:brightness-125")}
      onClick={onOpen}
      style={{ backgroundColor: `color-mix(in oklab, ${entry.items[0].color} 22%, var(--muted))` }}
      title={entry.items.map((item) => `${item.name} · ${formatCurrency(item.amount, item.currency)}`).join("\n")}
      type="button"
    >
      <span className="flex items-center -space-x-1.5">
        {visible.map((item) => (
          <ItemAvatar color={item.color} name={item.name} key={item.id} size="sm" />
        ))}
        {overflow > 0 ? (
          <span className="grid size-5 place-items-center rounded-full bg-background text-[9px] font-medium text-muted-foreground ring-1 ring-border">
            +{overflow}
          </span>
        ) : null}
      </span>
      {dayLabel}
    </button>
  );
}

function ItemAvatar({ color, name, size = "md" }: { color: string; name: string; size?: "md" | "sm" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold ring-1 ring-background/60",
        size === "md" ? "size-8 text-sm" : "size-5 text-[10px]"
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 30%, var(--background))`,
        color: `color-mix(in oklab, ${color} 55%, var(--foreground))`
      }}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

// Video-style breakdown: segments idle as muted arcs; hovering one lights it in
// its category color with a glow and swaps the center readout to that category.
function BreakdownDonut({ segments }: { segments: RecurringDonutSegment[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const total = segments.reduce((sum, segment) => sum + segment.monthly, 0) || 1;
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const gap = segments.length > 1 ? 10 : 0;
  const usable = circumference - gap * segments.length;

  let cursor = 0;
  const arcs = segments.map((segment) => {
    const length = Math.max(2, (segment.monthly / total) * usable);
    const arc = { ...segment, length, start: cursor };
    cursor += length + gap;
    return arc;
  });

  const active = segments.find((segment) => segment.id === activeId) ?? null;

  return (
    <div className="flex flex-col items-center gap-3 py-2 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <span className="text-sm text-muted-foreground">Recurring cost by category</span>
      <div className="relative size-60">
        <svg
          aria-label={`Monthly recurring cost by category: ${segments
            .map((segment) => `${segment.name} ${formatCurrency(segment.monthly)}`)
            .join(", ")}`}
          className="size-full -rotate-90"
          role="img"
          viewBox="0 0 200 200"
        >
          {arcs.map((arc) => (
            <circle
              className="cursor-pointer transition-[stroke,opacity] duration-200 motion-reduce:transition-none"
              cx="100"
              cy="100"
              fill="none"
              key={arc.id}
              onMouseEnter={() => setActiveId(arc.id)}
              onMouseLeave={() => setActiveId(null)}
              r={radius}
              stroke={arc.color}
              opacity={activeId === null || activeId === arc.id ? 1 : 0.35}
              strokeDasharray={`${arc.length} ${circumference - arc.length}`}
              strokeDashoffset={-arc.start}
              strokeLinecap="round"
              strokeWidth={activeId === arc.id ? 16 : 14}
              style={activeId === arc.id ? { filter: `drop-shadow(0 0 8px ${arc.color})` } : undefined}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="max-w-36 text-center">
            {active ? (
              <>
                <p className="truncate text-lg font-semibold tracking-tight">{active.name}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {formatCurrency(active.monthly)} · {Math.round((active.monthly / total) * 100)}%
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold tracking-tight tabular-nums">{formatCurrency(Math.round(total))}</p>
                <p className="text-sm text-muted-foreground">per month</p>
              </>
            )}
          </div>
        </div>
      </div>
      <span className="text-xs text-muted-foreground">
        {segments.length} {segments.length === 1 ? "category" : "categories"} · hover a segment for detail
      </span>
    </div>
  );
}
