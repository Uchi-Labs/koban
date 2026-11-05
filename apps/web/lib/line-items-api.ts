import type { SourceItem, SourceItemLine } from "@ai-finances/schema";
import { lineItemTotal, type LineItemMatch } from "@/lib/db/finance-db";

// snake_case API shapes for itemized lines, shared by the line-item routes and source items.

export const lineToApi = (line: SourceItemLine) => ({
  object: "line_item" as const,
  name: line.name,
  quantity: line.quantity ?? null,
  unit_price: line.unitPrice ?? null,
  amount: line.amount ?? null,
  paid: lineItemTotal(line) ?? null,
  sku: line.sku ?? null,
  category_id: line.categoryId ?? null
});

/** A receipt's lines with their index, which the split endpoint addresses. */
export const linesToApi = (lines: SourceItemLine[]) => lines.map((line, position) => ({ ...lineToApi(line), position }));

/**
 * What a receipt's split adds up to per category, largest first; lines not
 * filed under a category are totalled under `category_id: null`. Empty when no
 * line has been split.
 */
export function lineSplitToApi(lines: SourceItemLine[]) {
  if (!lines.some((line) => line.categoryId)) {
    return [];
  }

  const totals = new Map<string | null, number>();

  for (const line of lines) {
    const paid = lineItemTotal(line) ?? 0;
    totals.set(line.categoryId ?? null, (totals.get(line.categoryId ?? null) ?? 0) + paid);
  }

  return [...totals.entries()]
    .map(([categoryId, amount]) => ({ amount: Math.round(amount * 100) / 100, category_id: categoryId }))
    .sort((left, right) => right.amount - left.amount);
}

export const sourceItemRefToApi = (item: SourceItem) => ({
  id: item.id,
  source_id: item.sourceId,
  kind: item.kind,
  title: item.title,
  merchant_name: item.merchantName ?? null,
  occurred_at: item.occurredAt ?? null,
  amount: item.amount ?? null,
  currency: item.currency ?? null
});

export const lineMatchToApi = (match: LineItemMatch) => ({
  ...lineToApi(match.line),
  source_item: sourceItemRefToApi(match.sourceItem),
  transaction: match.transaction
    ? {
        id: match.transaction.id,
        date: match.transaction.date,
        amount: match.transaction.amount,
        merchant_name: match.transaction.merchantName || null,
        description: match.transaction.description
      }
    : null
});
