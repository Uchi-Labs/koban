"use client";

import * as React from "react";
import type {
  AgentStreamEvent,
  AssistantChart,
  AssistantEvidence,
  AssistantMetric,
  FinanceAssistantResponse
} from "@/lib/finance-assistant";
import type { AgentVisual } from "@/lib/agent-visual";
import { readBrowserModelSettings } from "@/lib/browser-llm/settings";

export interface AgentMeta {
  chart?: AssistantChart;
  evidence: AssistantEvidence[];
  generatedAt: string;
  insights: string[];
  metrics: AssistantMetric[];
  mode: FinanceAssistantResponse["mode"];
  question: string;
  /** Pages the model drew with show_visual, saved with the turn. */
  visuals?: AgentVisual[];
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
  const pacer = createAnswerPacer(controller, controllerRef, setState);

  try {
    // A model turned on in this browser answers here; Settings stores that per browser.
    if (!localOnly && readBrowserModelSettings().enabled) {
      const { askBrowserModel } = await import("@/lib/browser-llm/ask");
      let completed = false;

      for await (const event of askBrowserModel(question, controller.signal)) {
        completed = applyAgentEvents([event], controller, controllerRef, setState, pacer) || completed;
      }

      if (!controller.signal.aborted && controllerRef.current === controller && !completed) {
        pacer.finish(() => setState((current) => ({ ...current, status: "done" })));
      }

      return;
    }

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
      completed = applyAgentEvents(parsed.events, controller, controllerRef, setState, pacer) || completed;
    }

    const finalText = decoder.decode();

    if (finalText || pending) {
      const parsed = parseAgentStreamChunk(pending, finalText);
      pending = parsed.remaining;
      completed = applyAgentEvents(parsed.events, controller, controllerRef, setState, pacer) || completed;
    }

    if (pending.trim()) {
      completed = applyAgentEvents([parseAgentStreamLine(pending)].filter(Boolean), controller, controllerRef, setState, pacer) || completed;
    }

    if (!controller.signal.aborted && controllerRef.current === controller && !completed) {
      pacer.finish(() => setState((current) => ({ ...current, status: "done" })));
    }
  } catch (error) {
    if (controller.signal.aborted || controllerRef.current !== controller) {
      return;
    }

    pacer.flush();
    setState((current) => ({
      ...current,
      error: error instanceof Error ? error.message : "Finance agent request failed.",
      status: "error"
    }));
  } finally {
    // The download often ends before the pacer has shown all of it; the
    // request stays current (and abortable by a new question) until it has.
    pacer.finish(() => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    });
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

  if (
    event.type === "meta" ||
    event.type === "delta" ||
    event.type === "visual" ||
    event.type === "done" ||
    event.type === "error"
  ) {
    return event;
  }

  return null;
}

interface AnswerPacer {
  /** Releases everything queued at once, e.g. before showing an error. */
  flush: () => void;
  /** Runs once the queue has drained, so "done" never cuts the answer short. */
  finish: (callback: () => void) => void;
  push: (text: string) => void;
}

/**
 * Model text arrives in uneven bursts (a word, then forty characters after a
 * pause), which reads as jitter. The pacer queues it and releases a steady
 * couple of characters per frame, speeding up in proportion to the backlog so
 * the text never falls far behind the stream.
 */
function createAnswerPacer(
  controller: AbortController,
  controllerRef: React.MutableRefObject<AbortController | null>,
  setState: React.Dispatch<React.SetStateAction<AgentStreamState>>
): AnswerPacer {
  let queued = "";
  let frame = 0;
  let onDrained: Array<() => void> = [];
  const current = () => !controller.signal.aborted && controllerRef.current === controller;
  const release = (text: string) => setState((state) => ({ ...state, answer: `${state.answer}${text}` }));
  const drained = () => {
    const callbacks = onDrained;
    onDrained = [];
    for (const callback of callbacks) callback();
  };
  const tick = () => {
    frame = 0;
    if (!current()) return;
    const count = Math.max(2, Math.ceil(queued.length / 14));
    release(queued.slice(0, count));
    queued = queued.slice(count);
    if (queued) frame = requestAnimationFrame(tick);
    else drained();
  };
  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (queued && current()) release(queued);
    queued = "";
  };

  return {
    flush,
    finish(callback) {
      onDrained.push(callback);
      if (!queued && !frame) drained();
    },
    push(text) {
      // Without animation frames (a hidden tab, tests) the text goes straight in.
      if (typeof requestAnimationFrame === "undefined" || (typeof document !== "undefined" && document.hidden)) {
        release(text);
        return;
      }
      queued += text;
      if (!frame) frame = requestAnimationFrame(tick);
    }
  };
}

function applyAgentEvents(
  events: Array<AgentStreamEvent | null>,
  controller: AbortController,
  controllerRef: React.MutableRefObject<AbortController | null>,
  setState: React.Dispatch<React.SetStateAction<AgentStreamState>>,
  pacer: AnswerPacer
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
    } else if (event.type === "visual") {
      setState((current) => current.meta
        ? { ...current, meta: { ...current.meta, visuals: [...(current.meta.visuals ?? []), event.visual] } }
        : current);
    } else if (event.type === "delta") {
      pacer.push(event.text);
    } else if (event.type === "error") {
      completed = true;
      pacer.flush();
      setState((current) => ({
        ...current,
        error: event.message,
        status: "error"
      }));
    } else if (event.type === "done") {
      completed = true;
      pacer.finish(() => setState((current) => ({ ...current, status: "done" })));
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
