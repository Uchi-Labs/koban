"use client";

import { ArrowDownRight, ArrowUpRight, RefreshCw, X } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FinanceInsight } from "@/lib/insights";
import { EASE_OUT, EASE_SMOOTH_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

const toneClasses = {
  negative: "bg-[var(--negative)]",
  positive: "bg-[var(--positive)]",
  warning: "bg-amber-500"
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
              className="group flex gap-3 rounded-xl border border-border/60 bg-background/45 p-3"
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
              </div>
              <Button aria-label={`Dismiss ${insight.title}`} className="-m-1 opacity-60 group-hover:opacity-100" onClick={() => void dismiss(insight.id)} size="icon-sm" type="button" variant="ghost">
                <X className="size-3.5" />
              </Button>
            </m.article>
          )) : (
            <m.p
              animate={{ opacity: 1 }}
              className="py-6 text-sm text-muted-foreground"
              initial={{ opacity: 0 }}
              key="insights-empty"
              layout={reduce ? false : "position"}
              transition={{ delay: reduce ? 0.1 : 0.15, duration: 0.1, ease: EASE_OUT }}
            >
              No new signals yet. Insights appear as your transaction history grows.
            </m.p>
          )}
        </AnimatePresence>
        {compact && insights.length > 3 ? <Link className="mt-1 text-xs font-medium text-primary hover:underline" href="/insights">View {insights.length - 3} more insights</Link> : null}
      </div>
    </LazyMotion>
  );
}
