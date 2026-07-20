"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { ArrowDown, Send, Sparkles, X } from "lucide-react";
import * as React from "react";
import { AgentAnswer } from "@/components/agent-answer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from "@/components/ui/message-scroller";
import { StatefulButton } from "@/components/ui/stateful-button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { AgentConversationTurnSummary } from "@/lib/agent-conversations";
import type { AgentMeta, AgentStreamControls } from "@/lib/hooks/use-agent-stream";
import { EASE_SMOOTH_OUT, SPRING_PANEL } from "@/lib/motion";
import { playClose, playOpen } from "@/lib/ui-sound";
import { cn } from "@/lib/utils";

const suggestedQuestions = [
  "Where did my money go this month?",
  "What transactions need review first?",
  "How are source syncs doing?",
  "What rules would clean this up?"
];

// Drag-resizable height for the finance agent bottom drawer. The sheet is
// anchored to the bottom edge, so height grows as the pointer moves up:
// height = window.innerHeight - clientY, clamped and capped to the viewport.
const AGENT_PANEL_MIN_HEIGHT = 480;
const AGENT_PANEL_MAX_HEIGHT = 900;
const AGENT_PANEL_DEFAULT_HEIGHT = 560;
const AGENT_PANEL_HEIGHT_STORAGE_KEY = "koban:agent-panel-height";

function clampAgentPanelHeight(px: number) {
  const viewportCap =
    typeof window === "undefined" ? AGENT_PANEL_MAX_HEIGHT : Math.round(window.innerHeight * 0.92);
  const max = Math.min(AGENT_PANEL_MAX_HEIGHT, viewportCap);
  return Math.min(max, Math.max(AGENT_PANEL_MIN_HEIGHT, px));
}

export function AgentPanel({
  conversationLoading,
  draftPrefill,
  onAskAction,
  onCloseAction,
  open,
  persistenceError,
  stream,
  submitting,
  turns
}: {
  conversationLoading: boolean;
  draftPrefill: string;
  onAskAction: (question: string) => void;
  onCloseAction: () => void;
  open: boolean;
  persistenceError: string;
  stream: AgentStreamControls;
  submitting: boolean;
  turns: AgentConversationTurnSummary[];
}) {
  const reduce = useReducedMotion();
  const [draft, setDraft] = React.useState(() => draftPrefill);
  const [panelHeight, setPanelHeight] = React.useState(AGENT_PANEL_DEFAULT_HEIGHT);
  const [resizing, setResizing] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const turnIdRef = React.useRef(0);
  const previousOpenRef = React.useRef(open);
  const closeAction = React.useEffectEvent(onCloseAction);
  const canSubmit = draft.trim().length > 0 && !submitting;

  // Hydrate the persisted height after mount (localStorage is client-only, so the
  // first render must match the SSR default to avoid a hydration mismatch).
  React.useEffect(() => {
    const stored = window.localStorage.getItem(AGENT_PANEL_HEIGHT_STORAGE_KEY);
    if (!stored) {
      return;
    }
    const parsed = Number.parseInt(stored, 10);
    if (Number.isFinite(parsed)) {
      setPanelHeight(clampAgentPanelHeight(parsed));
    }
  }, []);

  function handleResizePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    setResizing(true);
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    let latest = panelHeight;

    const handleMove = (moveEvent: PointerEvent) => {
      latest = clampAgentPanelHeight(window.innerHeight - moveEvent.clientY);
      setPanelHeight(latest);
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      setResizing(false);
      window.localStorage.setItem(AGENT_PANEL_HEIGHT_STORAGE_KEY, String(latest));
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function resetPanelHeight() {
    setPanelHeight(AGENT_PANEL_DEFAULT_HEIGHT);
    window.localStorage.removeItem(AGENT_PANEL_HEIGHT_STORAGE_KEY);
  }

  React.useEffect(() => {
    if (previousOpenRef.current !== open) {
      if (open) {
        playOpen();
      } else {
        playClose();
      }
      previousOpenRef.current = open;
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAction();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function ask(nextQuestion = draft) {
    const question = nextQuestion.trim();

    if (!question || submitting) {
      return;
    }

    setDraft(question);
    turnIdRef.current += 1;
    onAskAction(question);
  }

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        {open ? (
          <>
            <m.button
              aria-label="Close finance agent"
              animate={{ opacity: 1 }}
              className="fixed inset-0 z-40 bg-background/35"
              data-sound="none"
              exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.15 } }}
              initial={{ opacity: 0 }}
              onClick={onCloseAction}
              transition={reduce ? { duration: 0 } : { duration: 0.25, ease: EASE_SMOOTH_OUT }}
              type="button"
            />
            <m.aside
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
              aria-label="Finance agent"
              aria-modal="true"
              className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border border-b-0 bg-background shadow-2xl"
              data-testid="agent-panel"
              exit={reduce ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, transition: { duration: 0.2 }, y: "100%" }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: "100%" }}
              role="dialog"
              style={{ height: `min(${panelHeight}px, 92svh)` }}
              transition={reduce ? { duration: 0.15 } : SPRING_PANEL}
            >
              <button
                aria-label="Drag to resize the finance agent drawer. Double-click to reset."
                className="group/agent-resize relative z-10 flex h-5 w-full shrink-0 cursor-row-resize touch-none items-center justify-center select-none"
                data-dragging={resizing ? "true" : undefined}
                onDoubleClick={resetPanelHeight}
                onPointerDown={handleResizePointerDown}
                tabIndex={-1}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1 w-9 rounded-full transition-colors motion-reduce:transition-none",
                    resizing ? "bg-primary" : "bg-border group-hover/agent-resize:bg-primary/50"
                  )}
                />
              </button>
              <header className="flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 pb-3 backdrop-blur-[var(--blur-small)]">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-tight">Finance agent</h2>
                  <span className="sheen-pill inline-flex h-5 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold tracking-wide text-primary uppercase">
                    <Sparkles aria-hidden="true" className="size-3" />
                    AI
                  </span>
                </div>
                <Button
                  aria-label="Close finance agent"
                  data-sound="none"
                  onClick={onCloseAction}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              </header>

              <div className="relative min-h-0 flex-1">
                {conversationLoading ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <Spinner aria-label="Loading chat" size="lg" variant="ring" />
                  </div>
                ) : turns.length === 0 && stream.status === "idle" ? (
                  // overflow-y-auto + m-auto: centered when it fits, scrolls (never
                  // paints over the composer) when the drawer is short.
                  <div className="scroll-fade-y flex h-full flex-col overflow-y-auto overscroll-contain p-4">
                    {persistenceError ? (
                      <Alert appearance="destructive" message={persistenceError} variant="inline" width="100%" />
                    ) : null}
                    <section
                      aria-label="Finance agent suggestions"
                      className="m-auto flex flex-col items-center gap-4 py-6 text-center"
                    >
                      <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Sparkles aria-hidden="true" className="size-5" />
                      </span>
                      <div className="max-w-sm space-y-1">
                        <h3 className="text-sm font-semibold">Ask your ledger</h3>
                        <p className="text-sm leading-5 text-muted-foreground">
                          Explore spending, review work, source health, or cleanup opportunities.
                        </p>
                      </div>
                      <div className="flex max-w-lg flex-wrap justify-center gap-2">
                        {suggestedQuestions.map((suggestion) => (
                          <Button
                            className="h-auto rounded-xl px-3 py-2 text-left text-xs whitespace-normal"
                            data-sound="send"
                            data-sound-hover=""
                            key={suggestion}
                            onClick={() => ask(suggestion)}
                            type="button"
                            variant="secondary"
                          >
                            {suggestion}
                          </Button>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : (
                  <MessageScrollerProvider
                    autoScroll
                    defaultScrollPosition="last-anchor"
                    scrollMargin={16}
                  >
                    <MessageScroller>
                      <MessageScrollerViewport className="scroll-fade-y overscroll-contain">
                        <MessageScrollerContent
                          aria-busy={submitting}
                          className="gap-4 p-4 pb-12"
                        >
                          {turns.map((turn, index) => turn.role === "user" ? (
                            <UserMessage content={turn.content} key={turn.id} messageId={turn.id} />
                          ) : (
                            <AssistantMessage
                              content={turn.content}
                              key={turn.id}
                              messageId={turn.id}
                              meta={toAgentMeta(turn.meta)}
                              question={previousUserQuestion(turns, index)}
                            />
                          ))}

                          {stream.status !== "idle" ? (
                            <>
                              <UserMessage
                                content={stream.question}
                                key={`question-${turnIdRef.current}`}
                                messageId={`question-${turnIdRef.current}`}
                              />
                              <MessageScrollerItem
                                key={`answer-${turnIdRef.current}`}
                                messageId={`answer-${turnIdRef.current}`}
                              >
                                <div className="flex flex-col gap-4">
                                  {stream.error ? (
                                    <Alert appearance="destructive" message={stream.error} variant="inline" width="100%" />
                                  ) : null}

                                  <AgentAnswer
                                    answer={stream.answer}
                                    meta={stream.meta}
                                    question={stream.question}
                                    status={stream.status}
                                    variant="panel"
                                  />
                                </div>
                              </MessageScrollerItem>
                            </>
                          ) : null}

                          {persistenceError ? (
                            <MessageScrollerItem messageId="conversation-persistence-error">
                              <Alert appearance="destructive" message={persistenceError} variant="inline" width="100%" />
                            </MessageScrollerItem>
                          ) : null}
                        </MessageScrollerContent>
                      </MessageScrollerViewport>
                      <MessageScrollerButton
                        behavior={reduce ? "auto" : "smooth"}
                        className="bottom-3 rounded-full border-border/80 bg-background/95 shadow-lg backdrop-blur-[var(--blur-small)] motion-reduce:transition-none"
                        data-sound="none"
                        size="sm"
                        variant="outline"
                      >
                        <ArrowDown aria-hidden="true" data-icon="inline-start" />
                        Jump to latest
                      </MessageScrollerButton>
                    </MessageScroller>
                  </MessageScrollerProvider>
                )}
              </div>

              <div className="shrink-0 border-t border-border bg-background p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground" htmlFor="agent-panel-question">
                      Question
                    </label>
                    <div className="grid">
                      <div className="relative col-start-1 row-start-1 flex flex-col">
                        <Textarea
                          aria-label="Finance question"
                          className="min-h-24 px-4 py-3"
                          disabled={submitting}
                          id="agent-panel-question"
                          onChange={(event) => {
                            setDraft(event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              ask();
                            }
                          }}
                          placeholder="Ask about spending, review, merchants, rules, or sources"
                          ref={textareaRef}
                          rows={4}
                          value={draft}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatefulButton
                      data-sound="send"
                      disabled={!canSubmit}
                      icon={<Send className="size-4" />}
                      loadingText="Asking"
                      onClick={() => ask()}
                      state={submitting ? "loading" : stream.status === "error" ? "error" : "idle"}
                      type="button"
                    >
                      Ask
                    </StatefulButton>
                  </div>

                </div>
              </div>
            </m.aside>
          </>
        ) : null}
      </AnimatePresence>
    </LazyMotion>
  );
}

function UserMessage({
  content,
  messageId
}: {
  content: string;
  messageId: string;
}) {
  return (
    <MessageScrollerItem messageId={messageId} scrollAnchor>
      <section aria-label="Your question" className="flex flex-col items-end gap-1.5">
        <span className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          You
        </span>
        <p className="max-w-[85%] break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-5 text-primary-foreground shadow-sm">
          {content}
        </p>
      </section>
    </MessageScrollerItem>
  );
}

function AssistantMessage({
  content,
  messageId,
  meta,
  question
}: {
  content: string;
  messageId: string;
  meta: AgentMeta | null;
  question: string;
}) {
  return (
    <MessageScrollerItem messageId={messageId}>
      <AgentAnswer
        answer={content}
        meta={meta}
        question={question}
        status="done"
        variant="panel"
      />
    </MessageScrollerItem>
  );
}

function previousUserQuestion(turns: AgentConversationTurnSummary[], index: number) {
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (turns[candidate]?.role === "user") {
      return turns[candidate]?.content ?? "";
    }
  }

  return "";
}

function toAgentMeta(value: unknown): AgentMeta | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AgentMeta>;

  if (
    !Array.isArray(candidate.evidence) ||
    !Array.isArray(candidate.insights) ||
    !Array.isArray(candidate.metrics) ||
    typeof candidate.generatedAt !== "string" ||
    typeof candidate.mode !== "string" ||
    typeof candidate.question !== "string"
  ) {
    return null;
  }

  return candidate as AgentMeta;
}
