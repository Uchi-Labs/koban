// Answer rules shared by server Ask and the in-browser model, kept free of
// server imports so the browser bundle can use them.

/** Model steps per answer: each tool round trip is one, and the reply is the last. */
export const agentMaxSteps = 6;

/**
 * Output budget per step for a model on the user's own hardware, whose
 * reasoning shares it with the answer and any visual's HTML. LFM3-1.7B used
 * all of 6,000 tokens thinking on 3 of 20 Ask questions.
 */
export const localModelMaxOutputTokens = 16_000;

export const emptyModelAnswerMessage =
  "The model returned no answer (it may have run out of output tokens). Try again, or ask a narrower question.";

export function modelFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  return detail
    ? `The model could not answer: ${detail.slice(0, 300)}`
    : "The model could not answer. Check the AI provider in Settings.";
}

/**
 * Drops reasoning a server streamed as text instead of a separate field: a
 * leading `<think>…</think>` block, and any stray think tag. Reasoning written
 * as untagged prose cannot be told apart from an answer and passes through.
 */
export function createThinkTagFilter() {
  let pending = "";
  let state: "start" | "thinking" | "answer" = "start";
  const stripTags = (text: string) => text.replace(/<\/?think>/g, "");

  return {
    push(text: string): string {
      if (state === "answer") {
        pending += text;
        // Hold a possible partial tag at the end until the next chunk.
        const cut = pending.lastIndexOf("<");
        const tail = cut >= 0 ? pending.slice(cut) : "";
        const keep = tail && ("</think>".startsWith(tail) || "<think>".startsWith(tail)) ? cut : pending.length;
        const out = stripTags(pending.slice(0, keep));
        pending = pending.slice(keep);
        return out;
      }

      pending += text;

      if (state === "start") {
        const trimmed = pending.trimStart();

        if (trimmed.length < "<think>".length && "<think>".startsWith(trimmed)) {
          return "";
        }

        if (!trimmed.startsWith("<think>")) {
          state = "answer";
          const out = pending;
          pending = "";
          return this.push(out);
        }

        state = "thinking";
      }

      const end = pending.indexOf("</think>");

      if (end < 0) {
        return "";
      }

      const after = pending.slice(end + "</think>".length).replace(/^\s+/, "");
      pending = "";
      state = "answer";
      return after ? this.push(after) : "";
    },
    flush(): string {
      const out = state === "thinking" ? "" : stripTags(pending);
      pending = "";
      return out;
    }
  };
}
