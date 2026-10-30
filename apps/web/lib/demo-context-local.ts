"use client";

// Context a public-demo visitor adds in Review stays in their browser, like
// their chats (agent-conversations-local.ts): every visitor shares one demo
// ledger, so free text written to the server would show to the next visitor.

const storageKey = "koban:demo-context";

type ContextOverlay = Record<string, string>;

function read(): ContextOverlay {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ContextOverlay) : {};
  } catch {
    return {};
  }
}

/** The visitor's full context for each transaction they have added to. */
export function readDemoContext(): ContextOverlay {
  return typeof window === "undefined" ? {} : read();
}

export function saveDemoContext(transactionId: string, context: string): void {
  const next = { ...read(), [transactionId]: context };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Blocked storage: the context still shows until the page reloads.
  }
}
