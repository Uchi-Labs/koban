"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import React from "react";
import { useState } from "react";
import { Amount } from "@/components/amount";
import { CategoryPill } from "@/components/category-pill";
import { FinanceStatItem, FinanceStatStrip } from "@/components/money-hero";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/card";
import { StatefulButton, type ButtonState } from "@/components/ui/stateful-button";
import { useToast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/format";
import type { TransactionView } from "@/lib/view-models";

const lastSyncedFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short"
});

export function DashboardReviewCard({
  currency,
  initialRows,
  lastSyncedAt,
  reviewSectionLabel,
  totalToReview
}: {
  currency?: string;
  initialRows: TransactionView[];
  lastSyncedAt?: string;
  reviewSectionLabel: string;
  totalToReview: number;
}) {
  const router = useRouter();
  const { showToast, updateToast } = useToast();
  const [rows, setRows] = useState(initialRows);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [buttonState, setButtonState] = useState<ButtonState>("idle");
  const [message, setMessage] = useState("");
  const remainingCount = Math.max(0, totalToReview - reviewedCount);
  const rowsToMark = rows.slice(0, 10);
  const displayRows = rows.slice(0, 5);
  const displayCurrency = currency ?? rows[0]?.currency ?? initialRows[0]?.currency ?? "USD";
  const reviewTotalAmount = rows.reduce((total, transaction) => total + Math.abs(transaction.amount), 0);

  async function markRowsReviewed() {
    if (rowsToMark.length === 0 || busy) {
      return;
    }

    setBusy(true);
    setButtonState("loading");
    setMessage(`Marking ${rowsToMark.length.toLocaleString()} transactions reviewed...`);
    const toastId = showToast({
      description: `Marking ${rowsToMark.length.toLocaleString()} dashboard transactions reviewed.`,
      duration: 0,
      status: "loading",
      title: "Review update started",
    });

    try {
      await Promise.all(
        rowsToMark.map(async (transaction) => {
          const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}`, {
            body: JSON.stringify({ reviewed: true }),
            headers: {
              "Content-Type": "application/json"
            },
            method: "PATCH"
          });

          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Unable to review ${transaction.merchant}.`);
          }
        })
      );

      const reviewedIds = new Set(rowsToMark.map((transaction) => transaction.id));
      setRows((currentRows) => currentRows.filter((transaction) => !reviewedIds.has(transaction.id)));
      setReviewedCount((currentCount) => currentCount + reviewedIds.size);
      setMessage(`${reviewedIds.size.toLocaleString()} transactions marked reviewed.`);
      setButtonState("success");
      updateToast(toastId, {
        description: `${reviewedIds.size.toLocaleString()} transactions were marked reviewed.`,
        duration: 3600,
        status: "success",
        title: "Review updated",
      });
      router.refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unable to mark transactions reviewed.";
      setButtonState("error");
      setMessage(errorMessage);
      updateToast(toastId, {
        description: errorMessage,
        duration: 5200,
        status: "error",
        title: "Review update failed",
      });
    } finally {
      setBusy(false);
      window.setTimeout(() => setButtonState("idle"), 1400);
    }
  }

  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{reviewSectionLabel}</span>
        <Badge className="tabular-nums" variant={remainingCount > 0 ? "review" : "synced"}>
          {remainingCount > 0 ? (
            <>
              {remainingCount.toLocaleString("en-US")}
              <span>to review</span>
            </>
          ) : (
            "Reviewed"
          )}
        </Badge>
      </div>
      <FinanceStatStrip className="mb-3">
        <FinanceStatItem
          animatedValue={remainingCount}
          label="Count"
          tone={remainingCount > 0 ? "warning" : "positive"}
          value={remainingCount.toLocaleString()}
        />
        <FinanceStatItem label="Amount" tone="primary" value={formatCurrency(reviewTotalAmount, displayCurrency)} />
        <FinanceStatItem label="Synced" tone="muted" value={formatLastSynced(lastSyncedAt)} />
      </FinanceStatStrip>
      <div className="divide-y divide-border">
        {displayRows.map((transaction) => (
          <div className="flex items-center gap-3 py-2" key={transaction.id}>
            <span className="size-3.5 shrink-0 rounded-[4px] border border-border" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{transaction.merchant}</span>
              <span className="truncate text-xs text-muted-foreground">{transaction.accountName}</span>
            </div>
            {transaction.category ? <CategoryPill category={transaction.category} /> : null}
            <Amount amount={transaction.amount} className="min-w-[5.5rem] text-right" currency={transaction.currency} />
          </div>
        ))}
        {displayRows.length === 0 ? (
          <EmptyState
            actions={<Badge variant="synced">Reviewed</Badge>}
            className="my-2"
            description="New imported transactions will appear here when they need category or evidence review."
            icon={<Check className="size-5 animate-in fade-in zoom-in-95 duration-200" />}
            size="sm"
            title="No transactions need review in the current local ledger."
          />
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {remainingCount > 0
            ? `1 - ${Math.min(10, remainingCount).toLocaleString()} of ${remainingCount.toLocaleString()}`
            : "0 to review"}
        </span>
        <StatefulButton
          className="ml-auto"
          disabled={busy || rowsToMark.length === 0}
          onClick={markRowsReviewed}
          loadingText="Marking"
          state={rowsToMark.length === 0 ? "idle" : buttonState}
          successText="Reviewed"
          errorText="Failed"
          size="sm"
          type="button"
          variant="secondary"
          icon={<Check className="size-4" />}
        >
          Mark {rowsToMark.length.toLocaleString()} as reviewed
        </StatefulButton>
      </div>
      {message ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          {isSuccessMessage(message) ? (
            <Check className="size-3.5 animate-in fade-in zoom-in-95 text-(--positive) duration-200" />
          ) : null}
          {message}
        </p>
      ) : null}
    </>
  );
}

function isSuccessMessage(message: string) {
  return /marked reviewed/i.test(message);
}

function formatLastSynced(lastSyncedAt?: string) {
  if (!lastSyncedAt) {
    return "No sync";
  }

  return lastSyncedFormatter.format(new Date(lastSyncedAt));
}
