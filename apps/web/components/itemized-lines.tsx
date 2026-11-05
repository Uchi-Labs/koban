import type { Category, SourceItemLine } from "@ai-finances/schema";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const paidFor = (line: SourceItemLine) =>
  line.amount ?? (line.unitPrice === undefined ? undefined : Math.round(line.unitPrice * (line.quantity ?? 1) * 100) / 100);

type CategoryRef = Pick<Category, "emoji" | "id" | "name">;

/** Per-category totals of a receipt whose lines were split across categories, largest first. */
export function lineSplit(lines: SourceItemLine[]): Array<{ amount: number; categoryId: string }> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!line.categoryId) continue;
    totals.set(line.categoryId, (totals.get(line.categoryId) ?? 0) + (paidFor(line) ?? 0));
  }
  return [...totals.entries()]
    .map(([categoryId, amount]) => ({ amount: Math.round(amount * 100) / 100, categoryId }))
    .sort((left, right) => right.amount - left.amount);
}

/**
 * The itemized lines of a receipt or order behind a transaction: name, quantity and price paid.
 * Shows the first `max` lines and counts the rest, so a long grocery order stays one glance.
 * When the lines are split across categories and `categories` is given, each line carries its
 * category's emoji and the split's totals follow.
 */
export function ItemizedLines({
  categories,
  className,
  currency,
  lines,
  max = 4
}: {
  categories?: CategoryRef[];
  className?: string;
  currency?: string;
  lines: SourceItemLine[];
  max?: number;
}) {
  const shown = lines.slice(0, max);
  const rest = lines.length - shown.length;
  const categoryById = new Map((categories ?? []).map((category) => [category.id, category]));
  const split = categories ? lineSplit(lines).filter((part) => categoryById.has(part.categoryId)) : [];
  return (
    <div className={className}>
      <ul aria-label="Itemized lines" className="space-y-0.5 text-xs">
        {shown.map((line, index) => {
          const paid = paidFor(line);
          const category = line.categoryId ? categoryById.get(line.categoryId) : undefined;
          return (
            <li className="flex min-w-0 items-baseline gap-2" key={`${line.name}-${index}`}>
              {split.length ? (
                <span aria-label={category?.name ?? "Not split"} className="w-4 shrink-0 text-center" title={category?.name}>
                  {category?.emoji ?? ""}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-foreground">{line.name}</span>
              {line.quantity !== undefined && line.quantity !== 1 ? <span className="shrink-0 text-muted-foreground tabular-nums">×{line.quantity}</span> : null}
              <span className="shrink-0 text-muted-foreground tabular-nums">{paid === undefined ? "—" : formatCurrency(paid, currency)}</span>
            </li>
          );
        })}
        {rest > 0 ? <li className="text-muted-foreground">+{rest} more {rest === 1 ? "item" : "items"}</li> : null}
      </ul>
      {split.length > 1 ? (
        <p aria-label="Split across categories" className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground" data-testid="line-split">
          <span className="font-medium text-foreground">Split</span>
          {split.map((part) => {
            const category = categoryById.get(part.categoryId)!;
            return (
              <span className="whitespace-nowrap" key={part.categoryId}>
                {category.emoji} {category.name} <span className="tabular-nums">{formatCurrency(part.amount, currency)}</span>
              </span>
            );
          })}
        </p>
      ) : null}
    </div>
  );
}
