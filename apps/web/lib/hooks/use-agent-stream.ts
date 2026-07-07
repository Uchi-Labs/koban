"use client";

import * as React from "react";
import type {
  AgentStreamEvent,
  AssistantChart,
  AssistantEvidence,
  AssistantMetric,
  FinanceAssistantResponse
} from "@/lib/finance-assistant";

export interface AgentMeta {
  chart?: AssistantChart;
  evidence: AssistantEvidence[];
  generatedAt: string;
  insights: string[];
  metrics: AssistantMetric[];
  mode: FinanceAssistantResponse["mode"];
  question: string;
}

export type AgentStreamStatus = "idle" | "streaming" | "done" | "error";

export interface AgentStreamState {
  answer: string;
  error: string;
  meta: AgentMeta | null;
  question: string;
  status: AgentStreamStatus;
}

export interface AgentStreamControls extends AgentStreamState {
  ask: (question: string, opts?: { localOnly?: boolean }) => void;
  reset: () => void;
}

export function useAgentStream(): AgentStreamControls {
  const [state, setState] = React.useState<AgentStreamState>({
    answer: "",
    error: "",
    meta: null,
    question: "",
    status: "idle"
  });
  const controllerRef = React.useRef<AbortController | null>(null);

  const abortCurrent = React.useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const reset = React.useCallback(() => {
    abortCurrent();
    setState({
      answer: "",
      error: "",
      meta: null,
      question: "",
      status: "idle"
    });
  }, [abortCurrent]);

  const ask = React.useCallback((rawQuestion: string, opts: { localOnly?: boolean } = {}) => {
    const question = rawQuestion.trim();

    abortCurrent();

    if (!question) {
      setState({
        answer: "",
        error: "",
        meta: null,
        question: "",
        status: "idle"
      });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setState({
      answer: "",
      error: "",
      meta: null,
      question,
      status: "streaming"
    });

    void readAgentStream(question, opts.localOnly === true, controller, controllerRef, setState);
  }, [abortCurrent]);

  React.useEffect(() => abortCurrent, [abortCurrent]);

  return {
    ...state,
    ask,
    reset
  };
}

async function readAgentStream(
  question: string,
  localOnly: boolean,
  controller: AbortController,
  controllerRef: React.MutableRefObject<AbortController | null>,
  setState: React.Dispatch<React.SetStateAction<AgentStreamState>>
) {
  try {
    const response = await fetch("/api/v1/assistant/stream", {
      body: JSON.stringify({ local_only: localOnly, question }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await responseErrorMessage(response));
    }

    if (!response.body) {
      throw new Error("Finance agent stream is unavailable.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let completed = false;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const parsed = parseAgentStreamChunk(pending, decoder.decode(value, { stream: true }));
      pending = parsed.remaining;
      completed = applyAgentEvents(parsed.events, controller, controllerRef, setState) || completed;
    }

    const finalText = decoder.decode();

    if (finalText || pending) {
      const parsed = parseAgentStreamChunk(pending, finalText);
      pending = parsed.remaining;
      completed = applyAgentEvents(parsed.events, controller, controllerRef, setState) || completed;
    }

    if (pending.trim()) {
      completed = applyAgentEvents([parseAgentStreamLine(pending)].filter(Boolean), controller, controllerRef, setState) || completed;
    }

    if (!controller.signal.aborted && controllerRef.current === controller && !completed) {
      setState((current) => ({
        ...current,
        status: "done"
      }));
    }
  } catch (error) {
    if (controller.signal.aborted || controllerRef.current !== controller) {
      return;
    }

    setState((current) => ({
      ...current,
      error: error instanceof Error ? error.message : "Finance agent request failed.",
      status: "error"
    }));
  } finally {
    if (controllerRef.current === controller) {
      controllerRef.current = null;
    }
  }
}

export function parseAgentStreamChunk(
  previous: string,
  chunk: string
): { events: AgentStreamEvent[]; remaining: string } {
  const lines = `${previous}${chunk}`.split("\n");
  const remaining = lines.pop() ?? "";

  return {
    events: lines.flatMap((line) => {
      const event = parseAgentStreamLine(line);
      return event ? [event] : [];
    }),
    remaining
  };
}

export function parseAgentStreamLine(line: string): AgentStreamEvent | null {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as unknown;

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    return null;
  }

  const event = parsed as AgentStreamEvent;

  if (event.type === "meta" || event.type === "delta" || event.type === "done" || event.type === "error") {
    return event;
  }

  return null;
}

function applyAgentEvents(
  events: Array<AgentStreamEvent | null>,
  controller: AbortController,
  controllerRef: React.MutableRefObject<AbortController | null>,
  setState: React.Dispatch<React.SetStateAction<AgentStreamState>>
): boolean {
  let completed = false;

  for (const event of events) {
    if (!event || controller.signal.aborted || controllerRef.current !== controller) {
      continue;
    }

    if (event.type === "meta") {
      setState((current) => ({
        ...current,
        meta: {
          chart: event.chart,
          evidence: event.evidence,
          generatedAt: event.generatedAt,
          insights: event.insights,
          metrics: event.metrics,
          mode: event.mode,
          question: event.question
        },
        question: event.question
      }));
    } else if (event.type === "delta") {
      setState((current) => ({
        ...current,
        answer: `${current.answer}${event.text}`
      }));
    } else if (event.type === "error") {
      completed = true;
      setState((current) => ({
        ...current,
        error: event.message,
        status: "error"
      }));
    } else if (event.type === "done") {
      completed = true;
      setState((current) => ({
        ...current,
        status: "done"
      }));
    }
  }

  return completed;
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };

    if (typeof body.error === "string" && body.error) {
      return body.error;
    }
  } catch {
    return "Finance agent request failed.";
  }

  return "Finance agent request failed.";
}
