"use client";

import { m, useReducedMotion, type Variants } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { AgentMeta, AgentStreamStatus } from "@/lib/hooks/use-agent-stream";
import { EvidenceCitation } from "@/components/ui/evidence-citation";
import { Alert } from "@/components/ui/alert";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AgentAnswerProps {
  answer: string;
  meta: AgentMeta | null;
  question: string;
  status: AgentStreamStatus;
  variant?: "inline" | "panel";
}

const revealEase = [0.22, 1, 0.36, 1] as const;

export function AgentAnswer({
  answer,
  meta,
  question,
  status,
  variant = "panel"
}: AgentAnswerProps) {
  const reduce = useReducedMotion();
  const receivingTokens = useTokenActivity(answer, status);
  const compact = variant === "inline";
  const showStructured = status === "done" && Boolean(meta);

  if (status === "idle" && !answer && !meta) {
    return null;
  }

  const evidence = compact ? meta?.evidence.slice(0, 3) ?? [] : meta?.evidence ?? [];
  const blocks: Array<{ id: string; node: ReactNode }> = [];
  if (meta?.metrics.length) {
    blocks.push({ id: "metrics", node: <MetricsGrid compact={compact} metrics={meta.metrics} /> });
  }
  if (meta?.chart) {
    blocks.push({ id: "chart", node: <AssistantChart chart={meta.chart} compact={compact} /> });
  }
  if (evidence.length > 0) {
    blocks.push({ id: "evidence", node: <EvidenceList compact={compact} evidence={evidence} /> });
  }
  if (!compact && meta?.insights.length) {
    blocks.push({ id: "insights", node: <InsightsList insights={meta.insights} /> });
  }

  return (
    <section
      aria-label="Finance agent answer"
      className={cn("flex min-w-0 flex-col", compact ? "gap-3" : "gap-4")}
    >
      {question ? <span className="sr-only">Question: {question}</span> : null}
      <div
        className={cn(
          "min-w-0 whitespace-pre-wrap text-sm leading-6 text-foreground",
          compact ? "px-1" : "rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm"
        )}
        data-testid="agent-answer-text"
      >
        {status === "streaming" && !answer ? (
          <ThinkingIndicator words={["Reading your ledger…", "Checking context…", "Working…"]} />
        ) : (
          renderAnswerParagraphs(answer)
        )}
        {status === "streaming" && answer ? (
          <span
            aria-hidden
            className="agent-stream-caret ml-0.5 text-primary"
            data-receiving={receivingTokens ? "true" : "false"}
          >
            ▍
          </span>
        ) : null}
      </div>

      {status === "error" ? (
        <Alert appearance="destructive" message="The finance agent could not finish this answer." variant="inline" width="100%" />
      ) : null}

      {showStructured && blocks.length > 0 ? (
        <div className={cn("flex flex-col", compact ? "gap-3" : "gap-4")}>
          {blocks.map((block, index) => (
            <m.div
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: "var(--distance-base)" }}
              key={block.id}
              transition={{
                delay: reduce ? 0 : index * 0.04,
                duration: reduce ? 0.15 : 0.25,
                ease: revealEase
              }}
              variants={revealVariants}
            >
              {block.node}
            </m.div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function useTokenActivity(answer: string, status: AgentStreamStatus) {
  const [receiving, setReceiving] = useState(false);
  const previousAnswer = useRef(answer);

  useEffect(() => {
    const grew = answer.length > previousAnswer.current.length;
    previousAnswer.current = answer;

    if (status !== "streaming" || !grew) {
      setReceiving(false);
      return;
    }

    setReceiving(true);
    const timer = window.setTimeout(() => setReceiving(false), 180);
    return () => window.clearTimeout(timer);
  }, [answer, status]);

  return receiving;
}

function renderAnswerParagraphs(answer: string) {
  if (!answer) {
    return null;
  }

  const paragraphs = answer.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0);

  if (paragraphs.length <= 1) {
    return answer;
  }

  return paragraphs.map((paragraph) => (
    <p className="mb-3 last:mb-0" key={paragraph}>
      {paragraph}
    </p>
  ));
}

const revealVariants: Variants = {};

function MetricsGrid({
  compact,
  metrics
}: {
  compact: boolean;
  metrics: NonNullable<AgentMeta["metrics"]>;
}) {
  return (
    <div
      aria-label="Answer metrics"
      className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}
    >
      {metrics.map((metric) => (
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1 rounded-2xl bg-muted/45",
            compact ? "px-2.5 py-2" : "px-3 py-2.5"
          )}
          data-testid="agent-answer-metric"
          key={`${metric.label}-${metric.value}`}
        >
          <span className="truncate text-xs text-muted-foreground">{metric.label}</span>
          <strong className="truncate text-sm font-semibold tabular-nums text-foreground">{metric.value}</strong>
          {metric.detail ? <em className="truncate text-xs text-muted-foreground not-italic">{metric.detail}</em> : null}
        </div>
      ))}
    </div>
  );
}

function AssistantChart({
  chart,
  compact
}: {
  chart: NonNullable<AgentMeta["chart"]>;
  compact: boolean;
}) {
  const maxValue = Math.max(...chart.data.map((row) => row.value), 1);

  return (
    <div
      aria-label={chart.title}
      className={cn("flex flex-col gap-2 rounded-2xl bg-muted/45", compact ? "p-3" : "p-4")}
      data-testid="agent-chart"
    >
      <h3 className="text-sm font-semibold">{chart.title}</h3>
      <div className="flex flex-col gap-2">
        {chart.data.map((row) => (
          <div
            className={cn(
              "grid items-center gap-3 text-sm",
              compact ? "grid-cols-[4.75rem_1fr_4.25rem]" : "grid-cols-[6rem_1fr_5rem]"
            )}
            key={row.label}
          >
            <span className="truncate text-xs text-muted-foreground">{row.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-background/60">
              <i
                className="block h-full rounded-full not-italic"
                style={{
                  background: row.color ?? "var(--chart-1)",
                  width: `${Math.max(3, (row.value / maxValue) * 100)}%`
                }}
              />
            </div>
            <b className="text-right text-xs font-medium tabular-nums">
              {chart.unit === "currency" ? formatCurrency(row.value) : row.value.toLocaleString()}
            </b>
          </div>
        ))}
        {chart.data.length === 0 ? <p className="text-sm text-muted-foreground">No chartable rows for this answer.</p> : null}
      </div>
    </div>
  );
}

function EvidenceList({
  compact,
  evidence
}: {
  compact: boolean;
  evidence: NonNullable<AgentMeta["evidence"]>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Evidence</h3>
      <div className="flex flex-col gap-2">
        {evidence.map((item, index) => (
          <article
            className={cn(
              "flex min-w-0 items-start justify-between gap-3 rounded-2xl bg-muted/45",
              compact ? "px-2.5 py-2" : "px-3 py-2.5"
            )}
            key={item.transactionId}
          >
            <EvidenceCitation
              description={`${item.date} · ${item.category} · ${item.reason}`}
              href={`/transactions?transaction_id=${encodeURIComponent(item.transactionId)}`}
              index={index + 1}
              linkLabel="View transaction"
              title={item.merchant}
            />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-medium">{item.merchant}</strong>
              <p className="truncate text-xs text-muted-foreground">
                {item.date} · {item.category}
                {item.accountName ? ` · ${item.accountName}` : ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {item.reason}
                {item.score === undefined ? "" : ` · ${Math.round(item.score * 100)}% match`}
              </p>
            </div>
            <b
              className="shrink-0 text-sm font-semibold tabular-nums"
              style={{ color: item.amount > 0 ? "var(--positive)" : "var(--negative)" }}
            >
              {formatCurrency(item.amount, item.currency)}
            </b>
          </article>
        ))}
      </div>
    </div>
  );
}

function InsightsList({ insights }: { insights: NonNullable<AgentMeta["insights"]> }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Insights</h3>
      <div className="flex flex-col gap-2">
        {insights.map((insight) => (
          <p className="rounded-2xl bg-muted/45 px-3 py-2.5 text-sm text-muted-foreground" key={insight}>
            {insight}
          </p>
        ))}
      </div>
    </div>
  );
}
