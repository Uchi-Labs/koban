"use client";

import type { AgentStreamEvent } from "@/lib/finance-assistant";
import { runBrowserAgent } from "./agent-loop";
import { createWorkerGenerate, isBrowserModelCached } from "./browser-model";
import { detectBrowserModelSupport } from "./readiness";

/**
 * Ask on the in-browser model. It never downloads here: the download (with
 * its progress) happens in Settings, so an evicted cache or a GPU that went
 * away ends the answer with the reason, never a silent switch to a server model.
 */
export async function* askBrowserModel(question: string, signal: AbortSignal): AsyncGenerator<AgentStreamEvent> {
  const readiness = await detectBrowserModelSupport();

  if (readiness.status !== "ready") {
    yield { message: `The in-browser model cannot run here: ${readiness.reason}`, type: "error" };
    return;
  }

  if (!(await isBrowserModelCached(readiness.dtype))) {
    yield {
      message: "The in-browser model is not downloaded in this browser. Download it again in Settings, under Ask Koban model.",
      type: "error"
    };
    return;
  }

  yield* runBrowserAgent({ generate: createWorkerGenerate(readiness.dtype), question, signal });
}
