"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import React from "react";
import { useState } from "react";
import { Amount } from "@/components/amount";
import { CategoryPill } from "@/components/category-pill";
import { FinanceStatItem, FinanceStatStrip } from "@/components/money-hero";
import { Badge } from "@/components/ui/badge";
import { ActionSwapIcon, ActionSwapText } from "@/components/ui/action-swap";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { FaviconBadge } from "@/components/ui/favicon-badge";
import { useToast } from "@/components/ui/toast";
import { merchantDomain } from "@/lib/merchant-domain";
import type { TransactionView } from "@/lib/view-models";

const lastSyncedFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short"
});

type ReviewButtonState = "error" | "idle" | "loading" | "success";

const DASHBOARD_REVIEW_ROWS = 8;

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
  const [buttonState, setButtonState] = useState<ReviewButtonState>("idle");
  const [message, setMessage] = useState("");
  const remainingCount = Math.max(0, totalToReview - reviewedCount);
  // The button marks exactly the rows on screen, never ones the user hasn't seen.
  const displayRows = rows.slice(0, DASHBOARD_REVIEW_ROWS);
  const rowsToMark = displayRows;
  const displayCurrency = currency ?? rows[0]?.currency ?? initialRows[0]?.currency ?? "USD";
  const reviewTotalAmount = rows.reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
  const displayedButtonState: ReviewButtonState = rowsToMark.length === 0 ? "idle" : buttonState;
  const reviewButtonLabel = displayedButtonState === "loading"
    ? "Marking"
    : displayedButtonState === "success"
      ? "Reviewed"
      : displayedButtonState === "error"
        ? "Failed"
        : `Mark ${rowsToMark.length.toLocaleString()} as reviewed`;

  async function markRowsReviewed() {
    if (rowsToMark.length === 0 || busy) {
      return;
    }

    setBusy(true);
    setButtonState("loading");
    setMessage(`Marking ${rowsToMark.length.toLocaleString()} transactions reviewed…`);
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
        <FinanceStatItem animatedCurrency={displayCurrency} animatedValue={reviewTotalAmount} label="Amount" tone="primary" />
        <FinanceStatItem label="Synced" tone="muted" value={formatLastSynced(lastSyncedAt)} />
      </FinanceStatStrip>
      <div className="grid gap-2">
        {displayRows.map((transaction) => {
          const domain = merchantDomain(transaction.merchant);

          return (
            <Link href="/transactions?review=actionable" key={transaction.id}>
              {/* ponytail: plain div, not IconiqCard interactive — 10 spring-hover
                  cards with backdrop-blur made dashboard hover visibly laggy */}
              <div className="gap-0 rounded-xl border border-border/50 bg-background/45 py-0 transition-colors hover:bg-muted/40 motion-reduce:transition-none">
                <div className="@container flex items-center gap-3 px-3 py-2.5">
                  {domain ? (
                    <FaviconBadge badgeClassName="bg-background" size="sm" website={domain} />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/50 text-[10px] font-semibold text-muted-foreground"
                    >
                      {transaction.merchant.charAt(0).toUpperCase() || "?"}
                    </span>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{transaction.merchant}</span>
                    <span className="truncate text-xs text-muted-foreground">{transaction.accountName}</span>
                  </div>
                  {/* The row, not the viewport, decides: it narrows when the agent docks. */}
                  {transaction.category ? (
                    <CategoryPill category={transaction.category} className="hidden max-w-36 min-w-0 @min-[24rem]:inline-flex" />
                  ) : null}
                  <Amount amount={transaction.amount} className="min-w-[5.5rem] text-right" currency={transaction.currency} />
                </div>
              </div>
            </Link>
          );
        })}
        {displayRows.length === 0 ? (
          <EmptyState
            actions={
              <>
                <Badge variant="synced">Reviewed</Badge>
                <Link className="link-underline min-h-10 content-center text-xs font-medium text-primary" href="/transactions">
                  View transactions
                </Link>
              </>
            }
            className="my-2"
            description="New imported transactions will appear here when they need category or evidence review."
            icon={<Check className="size-5 animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none" />}
            size="sm"
            title="No transactions need review in the current local ledger."
          />
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {remainingCount > 0
            ? `1 - ${Math.min(DASHBOARD_REVIEW_ROWS, remainingCount).toLocaleString()} of ${remainingCount.toLocaleString()}`
            : "0 to review"}
        </span>
        <Button
          aria-label={reviewButtonLabel}
          className="ml-auto"
          disabled={busy || rowsToMark.length === 0}
          onClick={markRowsReviewed}
          size="sm"
          type="button"
          variant="secondary"
        >
          <ActionSwapIcon animation="blur" value={displayedButtonState}>
            {displayedButtonState === "loading" ? (
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            ) : displayedButtonState === "error" ? (
              <CircleAlert className="size-4 text-destructive" />
            ) : (
              <Check className={displayedButtonState === "success" ? "size-4 text-(--positive)" : "size-4"} />
            )}
          </ActionSwapIcon>
          <ActionSwapText animation="blur" value={displayedButtonState}>
            {reviewButtonLabel}
          </ActionSwapText>
        </Button>
      </div>
      {message ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          {isSuccessMessage(message) ? (
            <Check className="size-3.5 animate-in fade-in zoom-in-95 text-(--positive) duration-200 motion-reduce:animate-none" />
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
