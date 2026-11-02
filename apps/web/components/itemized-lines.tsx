import type { SourceItemLine } from "@ai-finances/schema";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const paidFor = (line: SourceItemLine) =>
  line.amount ?? (line.unitPrice === undefined ? undefined : Math.round(line.unitPrice * (line.quantity ?? 1) * 100) / 100);

/**
 * The itemized lines of a receipt or order behind a transaction: name, quantity and price paid.
 * Shows the first `max` lines and counts the rest, so a long grocery order stays one glance.
 */
export function ItemizedLines({
  className,
  currency,
  lines,
  max = 4
}: {
  className?: string;
  currency?: string;
  lines: SourceItemLine[];
  max?: number;
}) {
  const shown = lines.slice(0, max);
  const rest = lines.length - shown.length;
  return (
    <ul aria-label="Itemized lines" className={cn("space-y-0.5 text-xs", className)}>
      {shown.map((line, index) => {
        const paid = paidFor(line);
        return (
          <li className="flex min-w-0 items-baseline gap-2" key={`${line.name}-${index}`}>
            <span className="min-w-0 flex-1 truncate text-foreground">{line.name}</span>
            {line.quantity !== undefined && line.quantity !== 1 ? <span className="shrink-0 text-muted-foreground tabular-nums">×{line.quantity}</span> : null}
            <span className="shrink-0 text-muted-foreground tabular-nums">{paid === undefined ? "—" : formatCurrency(paid, currency)}</span>
          </li>
        );
      })}
      {rest > 0 ? <li className="text-muted-foreground">+{rest} more {rest === 1 ? "item" : "items"}</li> : null}
    </ul>
  );
}
