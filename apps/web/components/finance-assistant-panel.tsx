"use client";

import { useEffect, useState } from "react";
import type { FinanceAssistantResponse } from "@/lib/finance-assistant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { Textarea } from "@/components/ui/textarea";
import { ThinkingCloud } from "@/components/thinking-cloud";
import { playSuccess, playTap } from "@/lib/ui-sound";

export function FinanceAssistantPanel({
  initialResponse,
  suggestedQuestions
}: {
  initialResponse: FinanceAssistantResponse;
  suggestedQuestions: string[];
}) {
  const [questionDraft, setQuestionDraft] = useState<string | null>(null);
  const [responseOverride, setResponseOverride] = useState<FinanceAssistantResponse | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const response = responseOverride ?? initialResponse;
  const question = questionDraft ?? response.question;
  const controlsDisabled = !isReady || isLoading;

  useEffect(() => {
    setIsReady(true);
  }, []);

  async function ask(nextQuestion = question) {
    const trimmedQuestion = nextQuestion.trim();

    if (!trimmedQuestion || controlsDisabled) {
      return;
    }

    setIsLoading(true);
    setError("");
    setQuestionDraft(trimmedQuestion);
    playTap();

    try {
      const result = await fetch("/api/v1/assistant", {
        body: JSON.stringify({ question: trimmedQuestion }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await result.json()) as FinanceAssistantResponse | { error?: string };

      if (!result.ok || !isFinanceAssistantResponse(body)) {
        throw new Error("error" in body && body.error ? body.error : "Finance agent request failed.");
      }

      setResponseOverride(body);
      playSuccess();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Finance agent request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card>
          <CardHeader>
            <h1 className="text-xl font-semibold">Ask your finances</h1>
            <p className="text-sm text-muted-foreground">
              Answers use your local Teller ledger, semantic transaction index, rules, source sync state, and evidence links.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5" htmlFor="finance-assistant-question">
                <span className="text-xs text-muted-foreground">Question</span>
                <Textarea
                  aria-label="Finance question"
                  id="finance-assistant-question"
                  onChange={(event) => setQuestionDraft(event.target.value)}
                  rows={4}
                  value={question}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={controlsDisabled} onClick={() => void ask()} type="button">
                  {isLoading ? "Analyzing..." : "Ask"}
                </Button>
                {suggestedQuestions.map((suggestion) => (
                  <Button
                    disabled={controlsDisabled}
                    key={suggestion}
                    onClick={() => {
                      void ask(suggestion);
                    }}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {isLoading ? (
              <div className="flex items-center gap-3 pt-1">
                <ThinkingCloud className="scale-[0.6]" />
                <p className="text-sm text-muted-foreground">Reading your ledger…</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card aria-label="Finance agent answer">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {response.mode === "llm_finance_agent" ? "LLM finance agent" : "Local semantic agent"}
              </span>
              <h2 className="mt-1 text-xl font-semibold">{response.question}</h2>
            </div>
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={response.generatedAt}>
              {new Date(response.generatedAt).toLocaleString()}
            </time>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">{response.answer}</p>
            <div aria-label="Answer metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {response.metrics.map((metric) => (
                <div className="flex flex-col gap-1 rounded-2xl bg-muted/40 px-3 py-2.5" key={`${metric.label}-${metric.value}`}>
                  <span className="text-xs text-muted-foreground">{metric.label}</span>
                  <strong className="text-base font-semibold tabular-nums">{metric.value}</strong>
                  {metric.detail ? <em className="text-xs text-muted-foreground not-italic">{metric.detail}</em> : null}
                </div>
              ))}
            </div>
            {response.chart ? <AssistantChart chart={response.chart} /> : null}
          </CardContent>
        </Card>
      </div>

      <aside className="flex w-full flex-col gap-6 lg:w-80 lg:shrink-0">
        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Insights</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {response.insights.map((insight) => (
              <p className="text-sm text-muted-foreground" key={insight}>
                {insight}
              </p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Evidence</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {response.evidence.map((item) => (
              <article className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5" key={item.transactionId}>
                <div className="min-w-0">
                  <strong className="text-sm font-medium">{item.merchant}</strong>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.date} · {item.category}
                    {item.accountName ? ` · ${item.accountName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.reason}
                    {item.score === undefined ? "" : ` · ${Math.round(item.score * 100)}% match`}
                  </p>
                </div>
                <b className={item.amount > 0 ? "shrink-0 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400" : "shrink-0 text-sm font-semibold tabular-nums"}>
                  {formatCurrency(item.amount, item.currency)}
                </b>
              </article>
            ))}
            {response.evidence.length === 0 ? <p className="text-sm text-muted-foreground">No matching transactions for this answer.</p> : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function isFinanceAssistantResponse(value: FinanceAssistantResponse | { error?: string }): value is FinanceAssistantResponse {
  return "object" in value && value.object === "finance_assistant_response";
}

function AssistantChart({ chart }: { chart: FinanceAssistantResponse["chart"] }) {
  if (!chart) {
    return null;
  }

  const maxValue = Math.max(...chart.data.map((row) => row.value), 1);

  return (
    <div aria-label={chart.title} className="flex flex-col gap-2 rounded-2xl bg-muted/40 p-4">
      <h3 className="text-sm font-semibold">{chart.title}</h3>
      <div className="flex flex-col gap-2">
        {chart.data.map((row) => (
          <div className="grid grid-cols-[6rem_1fr_5rem] items-center gap-3 text-sm" key={row.label}>
            <span className="truncate text-xs text-muted-foreground">{row.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <i
                className="block h-full rounded-full not-italic"
                style={{ background: row.color, width: `${Math.max(3, (row.value / maxValue) * 100)}%` }}
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
