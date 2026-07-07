"use client";

import type { Category } from "@ai-finances/schema";
import * as React from "react";
import { toast } from "sonner";
import { Amount } from "@/components/amount";
import { CategoryPill } from "@/components/category-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { deriveRuleMatchValue } from "@/lib/rule-match";

const RULE_MATCH_FIELD = "merchant_or_description";
const RULE_MATCH_OPERATOR = "contains";

interface PreviewCategory extends Category {}

interface PreviewTransaction {
  amount: number;
  category?: PreviewCategory;
  currency: string;
  date: string;
  id: string;
  merchant_name: string;
}

interface RulePreviewResponse {
  data: PreviewTransaction[];
  has_more: boolean;
  total_count: number;
}

interface RulePreviewState {
  error: string;
  matchValue: string;
  preview: RulePreviewResponse | null;
}

export interface NewRuleDialogProps {
  category: Category | null;
  merchant: string;
  onCreated: (result: { categoryId: string; matchedTransactionIds: string[]; transactionsUpdated: number }) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const previewDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

function formatPreviewDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : previewDateFormatter.format(parsed);
}

async function loadRulePreview(params: URLSearchParams, signal: AbortSignal) {
  const response = await fetch(`/api/v1/rules/preview?${params.toString()}`, { cache: "no-store", signal });
  const body = (await response.json()) as RulePreviewResponse & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Unable to load matching transactions.");
  }
  return body;
}

export function NewRuleDialog({ category, merchant, onCreated, onOpenChange, open }: NewRuleDialogProps) {
  const matchValue = React.useMemo(() => deriveRuleMatchValue(merchant), [merchant]);
  const [previewState, setPreviewState] = React.useState<RulePreviewState>({
    error: "",
    matchValue: "",
    preview: null
  });
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!open || !matchValue) {
      return;
    }

    const controller = new AbortController();

    const params = new URLSearchParams({
      field: RULE_MATCH_FIELD,
      operator: RULE_MATCH_OPERATOR,
      value: matchValue
    });

    loadRulePreview(params, controller.signal)
      .then((body) => {
        setPreviewState({ error: "", matchValue, preview: body });
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setPreviewState({
            error: caught instanceof Error ? caught.message : "Unable to load matching transactions.",
            matchValue,
            preview: null
          });
        }
      });

    return () => controller.abort();
  }, [matchValue, open]);

  async function handleCreate() {
    if (!category || creating) {
      return;
    }

    setCreating(true);

    try {
      const response = await fetch("/api/v1/rules", {
        body: JSON.stringify({
          category_id: category.id,
          mark_reviewed: false,
          match_field: RULE_MATCH_FIELD,
          match_operator: RULE_MATCH_OPERATOR,
          name: `${matchValue} → ${category.name}`,
          pattern: matchValue
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json()) as {
        apply_result?: { transactionsUpdated?: number };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to create rule.");
      }

      const matchedRows = previewState.matchValue === matchValue ? previewState.preview?.data : undefined;
      const matchedTransactionIds = (matchedRows ?? []).map((item) => item.id);
      const transactionsUpdated = body.apply_result?.transactionsUpdated ?? 0;

      onCreated({ categoryId: category.id, matchedTransactionIds, transactionsUpdated });
      onOpenChange(false);
      toast.success(
        transactionsUpdated > 0
          ? `Rule created — ${transactionsUpdated.toLocaleString()} transaction${transactionsUpdated === 1 ? "" : "s"} updated`
          : "Rule created"
      );
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Unable to create rule.");
    } finally {
      setCreating(false);
    }
  }

  const previewReady = previewState.matchValue === matchValue;
  const currentPreview = previewReady ? previewState.preview : null;
  const totalCount = currentPreview?.total_count ?? 0;
  const rows = currentPreview?.data ?? [];
  const overflow = Math.max(0, totalCount - rows.length);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-4 sm:max-w-lg" showCloseButton>
        <header className="flex flex-col items-center gap-1 text-center">
          <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            New rule for {category?.name ?? "category"}
          </span>
          <p className="text-sm text-muted-foreground">
            Would you like to create a new rule for all matching transactions?
          </p>
        </header>

        <p className="text-center text-2xl font-semibold tracking-tight">{merchant}</p>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          {category ? <CategoryPill category={category} /> : null}
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="min-h-[8rem]">
          {!previewReady ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading matching transactions…</p>
          ) : previewState.error ? (
            <p className="py-8 text-center text-sm text-(--negative)">{previewState.error}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions match “{matchValue}”.</p>
          ) : (
            <div className="scroll-fade max-h-72 overflow-y-auto">
              <ul className="flex flex-col">
                {rows.map((item) => (
                  <li
                    className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm"
                    key={item.id}
                  >
                    <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatPreviewDate(item.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.merchant_name}</span>
                    {item.category ? (
                      <CategoryPill category={item.category} className="hidden max-w-40 shrink-0 sm:inline-flex" />
                    ) : null}
                    <Amount
                      amount={item.amount}
                      className="min-w-[5.5rem] shrink-0 text-right"
                      currency={item.currency}
                    />
                  </li>
                ))}
              </ul>
              {overflow > 0 ? (
                <p className="px-1 pt-2 text-center text-xs text-muted-foreground">+ {overflow.toLocaleString()} more</p>
              ) : null}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2">
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button disabled={creating || !category} onClick={handleCreate} type="button">
            {creating ? "Creating…" : "Create rule"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
