import {
  agentMaxSteps,
  createThinkTagFilter,
  emptyModelAnswerMessage,
  localModelMaxOutputTokens,
  modelFailureMessage
} from "@/lib/agent-answer";
import { agentVisualMaxPerAnswer, normalizeAgentVisual, showVisualToolName } from "@/lib/agent-visual";
import type { AgentStreamEvent, AssistantPrompt } from "@/lib/finance-assistant";
import { parseModelOutput, type ParsedToolCall } from "./tool-calls";
import { apiErrorMessage, executeBrowserToolCall } from "./tool-executor";

type FetchLike = typeof fetch;

export type BrowserChatMessage =
  | { content: string; role: "system" | "user" }
  | { content: string; role: "tool" }
  | {
      content: string;
      role: "assistant";
      thinking?: string;
      tool_calls: Array<{ function: { arguments: Record<string, unknown>; name: string }; type: "function" }>;
    };

export interface BrowserGenerateInput {
  maxNewTokens: number;
  messages: BrowserChatMessage[];
  /** Each decoded piece of the generation, as it arrives. */
  onText: (text: string) => void;
  signal?: AbortSignal;
  tools: Array<{ function: { description: string; name: string; parameters: unknown }; type: "function" }>;
}

/** Runs the model once on the chat and resolves with everything it generated after the prompt. */
export type BrowserGenerate = (input: BrowserGenerateInput) => Promise<string>;

/**
 * Ask, answered by a model in this browser. Koban prepares the same messages
 * and tools server Ask uses; the model here decides on tool calls, which go to
 * Koban's read-only tool routes, until it replies or uses its six steps. The
 * events match `/api/v1/assistant/stream`, so the chat renders them the same.
 */
export async function* runBrowserAgent({
  fetcher = fetch,
  generate,
  question,
  signal
}: {
  fetcher?: FetchLike;
  generate: BrowserGenerate;
  question: string;
  signal?: AbortSignal;
}): AsyncGenerator<AgentStreamEvent> {
  const promptResponse = await fetcher("/api/v1/assistant/prompt", {
    body: JSON.stringify({ question }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal
  });
  const prompt = (await promptResponse.json().catch(() => ({}))) as Partial<AssistantPrompt> & { error?: unknown };

  if (!promptResponse.ok || !prompt.meta || !prompt.messages || !prompt.tools) {
    throw new Error(apiErrorMessage(prompt.error) ?? "Finance agent request failed.");
  }

  yield prompt.meta;

  const definitions = prompt.tools;
  const templateTools = definitions.map((definition) => ({ function: definition, type: "function" as const }));
  const messages: BrowserChatMessage[] = [...prompt.messages];
  const maxSteps = Math.min(prompt.max_steps ?? agentMaxSteps, agentMaxSteps);
  const visualPrefix = `visual_${prompt.meta.generatedAt}`;
  let visualCount = 0;
  let emittedText = false;

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      // The generation prompt opened <think>, so the filter sees it opened too.
      const thinkFilter = createThinkTagFilter();
      const guard = createToolCallGuard();
      const channel = createChannel<string>();
      thinkFilter.push("<think>");

      const generation = generate({
        maxNewTokens: localModelMaxOutputTokens,
        messages,
        onText: (text) => {
          const visible = guard.push(thinkFilter.push(text));
          if (visible) channel.push(visible);
        },
        signal,
        tools: templateTools
      }).finally(() => {
        const rest = guard.push(thinkFilter.flush()) + guard.flush();
        if (rest) channel.push(rest);
        channel.close();
      });

      for await (const text of channel) {
        emittedText = emittedText || text.trim().length > 0;
        yield { text, type: "delta" };
      }

      const parsed = parseModelOutput(await generation, definitions);

      if (parsed.toolCalls.length === 0) {
        break;
      }

      messages.push({
        content: parsed.content,
        role: "assistant",
        thinking: parsed.thinking,
        tool_calls: parsed.toolCalls.map((call) => ({ function: call, type: "function" }))
      });

      for (const call of parsed.toolCalls) {
        if (call.name === showVisualToolName) {
          const visual = visualCount < agentVisualMaxPerAnswer
            ? normalizeAgentVisual(call.arguments, `${visualPrefix}_${visualCount}`)
            : null;
          if (visual) {
            visualCount += 1;
            yield { type: "visual", visual };
          }
          messages.push({ content: "Shown to the user above your reply.", role: "tool" });
          continue;
        }

        messages.push({ content: JSON.stringify(await runToolCall(call, definitions, fetcher, signal)), role: "tool" });
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
    yield { message: modelFailureMessage(error), type: "error" };
    return;
  }

  if (!emittedText) {
    yield { message: emptyModelAnswerMessage, type: "error" };
    return;
  }

  yield { type: "done" };
}

async function runToolCall(
  call: ParsedToolCall,
  definitions: AssistantPrompt["tools"],
  fetcher: FetchLike,
  signal: AbortSignal | undefined
): Promise<unknown> {
  try {
    return await executeBrowserToolCall(call, definitions, { fetcher, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { error: error instanceof Error ? error.message : "The tool failed." };
  }
}

/**
 * Passes reply text through until a `<tool_call>` opens, then holds back the
 * rest of the generation: the call's markup is for Koban, not the reader.
 */
export function createToolCallGuard() {
  const tag = "<tool_call>";
  let pending = "";
  let blocked = false;

  return {
    push(text: string): string {
      if (blocked || !text) return "";
      pending += text;
      const start = pending.indexOf(tag);

      if (start >= 0) {
        blocked = true;
        const out = pending.slice(0, start);
        pending = "";
        return out;
      }

      const cut = pending.lastIndexOf("<");
      const keep = cut >= 0 && tag.startsWith(pending.slice(cut)) ? cut : pending.length;
      const out = pending.slice(0, keep);
      pending = pending.slice(keep);
      return out;
    },
    flush(): string {
      const out = blocked ? "" : pending;
      pending = "";
      return out;
    }
  };
}

/** A queue a callback fills and a `for await` drains, so streamed text can be yielded. */
function createChannel<T>() {
  const items: T[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  return {
    close() {
      closed = true;
      notify();
    },
    push(item: T) {
      items.push(item);
      notify();
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        if (items.length) {
          yield items.shift() as T;
        } else if (closed) {
          return;
        } else {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    }
  };
}
