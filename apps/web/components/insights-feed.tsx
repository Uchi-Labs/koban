"use client";

import { ArrowDownRight, ArrowUpRight, BellOff, RefreshCw, X } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/card";
import {
  ReasoningStep,
  ReasoningStepSource,
  ReasoningStepSources,
  ReasoningSteps,
  ReasoningStepsContent,
  ReasoningStepsTrigger,
} from "@/components/ui/reasoning-steps";
import type { FinanceInsight } from "@/lib/insights";
import { EASE_OUT, EASE_SMOOTH_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

const toneClasses = {
  negative: "bg-[var(--negative)]",
  positive: "bg-[var(--positive)]",
  warning: "bg-warning"
};

export function InsightsFeed({ compact = false, initialInsights }: { compact?: boolean; initialInsights: FinanceInsight[] }) {
  const reduce = useReducedMotion();
  const [insights, setInsights] = useState(initialInsights);
  const visible = compact ? insights.slice(0, 3) : insights;

  async function dismiss(id: string) {
    const previous = insights;
    setInsights((current) => current.filter((insight) => insight.id !== id));
    const response = await fetch(`/api/v1/insights/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) setInsights(previous);
  }

  return (
    <LazyMotion features={domAnimation}>
      <div className="grid gap-2" data-testid="insights-feed">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.length > 0 ? visible.map((insight) => (
            <m.article
              animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
              className="group flex gap-3 rounded-lg border border-border/60 bg-background/45 p-3"
              exit={reduce
                ? { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } }
                : { opacity: 0, transform: "translateY(-4px) scale(0.98)", transition: { duration: 0.15, ease: EASE_OUT } }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px) scale(0.98)" }}
              key={insight.id}
              layout={reduce ? false : "position"}
              transition={reduce
                ? { duration: 0.1, ease: EASE_OUT }
                : { duration: 0.15, ease: EASE_OUT, layout: { duration: 0.2, ease: EASE_SMOOTH_OUT } }}
            >
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", toneClasses[insight.tone])} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-foreground">{insight.title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{insight.detail}</p>
                  </div>
                  <span aria-hidden="true" className="mt-0.5 text-muted-foreground">
                    {insight.kind === "new-recurring" ? <RefreshCw className="size-3.5" /> : insight.tone === "positive" ? <ArrowDownRight className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                  </span>
                </div>
                {compact ? null : <InsightReasoning insight={insight} />}
              </div>
              <Button aria-label={`Dismiss ${insight.title}`} className="-m-1 opacity-60 group-hover:opacity-100" onClick={() => void dismiss(insight.id)} size="icon-sm" type="button" variant="ghost">
                <X className="size-3.5" />
              </Button>
            </m.article>
          )) : (
            <m.div
              animate={{ opacity: 1 }}
              initial={{ opacity: 0 }}
              key="insights-empty"
              layout={reduce ? false : "position"}
              transition={{ delay: reduce ? 0.1 : 0.15, duration: 0.1, ease: EASE_OUT }}
            >
              <EmptyState
                actions={
                  <Link className={buttonVariants()} href="/transactions">
                    Review transactions
                  </Link>
                }
                description="Insights appear as your transaction history grows. Review recent activity while the ledger gathers more context."
                icon={<BellOff className="size-4" />}
                size="sm"
                title="All caught up"
              />
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}

function InsightReasoning({ insight }: { insight: FinanceInsight }) {
  const method = insightMethod(insight);
  const sourceHref = insight.merchant
    ? `/transactions?q=${encodeURIComponent(insight.merchant)}`
    : insight.categoryId
      ? `/transactions?category_id=${encodeURIComponent(insight.categoryId)}`
      : "/transactions";
  const sourceLabel = insight.merchant ? `${insight.merchant} transactions` : "Matching transactions";

  return (
    <ReasoningSteps className="mt-2 max-w-none border border-border/50 bg-muted/20" duration={0}>
      <ReasoningStepsTrigger className="min-h-8 px-2 py-1.5">Why this insight</ReasoningStepsTrigger>
      <ReasoningStepsContent>
        <ReasoningStep description={method.description} label={method.label} status="done" />
        <ReasoningStep description={insight.detail} label="Recorded the ledger finding" status="done">
          <ReasoningStepSources>
            <ReasoningStepSource href={sourceHref}>{sourceLabel}</ReasoningStepSource>
          </ReasoningStepSources>
        </ReasoningStep>
      </ReasoningStepsContent>
    </ReasoningSteps>
  );
}

function insightMethod(insight: FinanceInsight): { description: string; label: string } {
  switch (insight.kind) {
    case "category-delta":
      return {
        description: "Summed spending in the latest seven days and the prior seven days; surfaced only differences above $25 and 30% of the prior window.",
        label: "Compared adjacent seven-day windows",
      };
    case "unusual-charge":
      return {
        description: "Compared this charge with at least three earlier merchant or category charges, using the merchant 95th percentile or three times the category median.",
        label: "Compared the charge with its history",
      };
    case "new-recurring":
      return {
        description: "Found three recent charges from the same merchant with both gaps between 20 and 40 days.",
        label: "Checked the merchant’s monthly cadence",
      };
    case "budget-trajectory":
      return {
        description: "Scaled month-to-date category spend by elapsed days and surfaced projected budget overages above $25.",
        label: "Projected month-end spending",
      };
  }
}
