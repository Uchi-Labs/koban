"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowLeft, ArrowUp, History, SquarePen, X } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { AgentAnswer } from "@/components/agent-answer";
import { AgentChatHistory, type AgentChatHistoryProps } from "@/components/agent-chat-history";
import { ManekiMoment } from "@/components/maneki-moment";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { AgentConversationTurnSummary } from "@/lib/agent-conversations";
import type { AgentMeta, AgentStreamControls } from "@/lib/hooks/use-agent-stream";
import { EASE_SMOOTH_OUT } from "@/lib/motion";
import { playClose, playOpen } from "@/lib/ui-sound";
import { cn } from "@/lib/utils";

const suggestedQuestions = [
  "Where did my money go this month?",
  "What transactions need review first?",
  "How are source syncs doing?",
  "What rules would clean this up?"
];

// On wide screens the agent docks as a right-hand column and the page reflows
// beside it (the shell reads --agent-dock-width as the content's right margin),
// so every page keeps working while the chat is open. Narrower screens can't
// fit both, so the panel slides over the page instead.
const AGENT_PANEL_MIN_WIDTH = 360;
const AGENT_PANEL_MAX_WIDTH = 760;
const AGENT_PANEL_DEFAULT_WIDTH = 440;
// Room the page keeps beside the dock: the left sidebar plus a usable column.
const AGENT_PANEL_PAGE_RESERVE = 256 + 520;
// Docks only when the narrowest panel still leaves the page its reserve.
const AGENT_PANEL_DOCK_QUERY = `(min-width: ${AGENT_PANEL_PAGE_RESERVE + AGENT_PANEL_MIN_WIDTH}px)`;
const AGENT_PANEL_WIDTH_STORAGE_KEY = "koban:agent-panel-width";
const AGENT_DOCK_WIDTH_VAR = "--agent-dock-width";
// The panel slide and the page's margin shift (app-shell, 320ms ease-smooth-out)
// run on one curve so the two move as a single motion.
const AGENT_PANEL_SLIDE = { duration: 0.32, ease: [0.22, 1, 0.36, 1] } as const;

function clampAgentPanelWidth(px: number) {
  const viewportCap =
    typeof window === "undefined" ? AGENT_PANEL_MAX_WIDTH : window.innerWidth - AGENT_PANEL_PAGE_RESERVE;
  const max = Math.max(AGENT_PANEL_MIN_WIDTH, Math.min(AGENT_PANEL_MAX_WIDTH, viewportCap));
  return Math.min(max, Math.max(AGENT_PANEL_MIN_WIDTH, px));
}

function subscribeDockQuery(onChange: () => void) {
  const media = window.matchMedia(AGENT_PANEL_DOCK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useDockedLayout() {
  return React.useSyncExternalStore(
    subscribeDockQuery,
    () => window.matchMedia(AGENT_PANEL_DOCK_QUERY).matches,
    () => true
  );
}

export function AgentPanel({
  chats,
  conversationLoading,
  draftPrefill,
  onAskAction,
  onCloseAction,
  open,
  persistenceError,
  showChatSignal,
  stream,
  submitting,
  turns
}: {
  /** The chat list shown in the panel's History view, and starting a new chat. */
  chats: AgentChatHistoryProps & { onNewChat: () => void };
  conversationLoading: boolean;
  draftPrefill: string;
  onAskAction: (question: string) => void;
  onCloseAction: () => void;
  open: boolean;
  persistenceError: string;
  showChatSignal: number;
  stream: AgentStreamControls;
  submitting: boolean;
  turns: AgentConversationTurnSummary[];
}) {
  const reduce = useReducedMotion();
  const [draft, setDraft] = React.useState(() => draftPrefill);
  // The panel remounts for every new or reopened chat, so this resets to "chat".
  const [view, setView] = React.useState<"chat" | "history">("chat");
  const [seenShowChatSignal, setSeenShowChatSignal] = React.useState(showChatSignal);
  if (seenShowChatSignal !== showChatSignal) {
    setSeenShowChatSignal(showChatSignal);
    setView("chat");
  }
  const docked = useDockedLayout();
  const [panelWidth, setPanelWidth] = React.useState(AGENT_PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const turnIdRef = React.useRef(0);
  const previousOpenRef = React.useRef(open);
  const closeAction = React.useEffectEvent(onCloseAction);
  const canSubmit = draft.trim().length > 0 && !submitting;

  // Hydrate the persisted width after mount (localStorage is client-only, so the
  // first render must match the SSR default to avoid a hydration mismatch).
  React.useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(AGENT_PANEL_WIDTH_STORAGE_KEY);
    } catch {
      // Storage blocked: fall back to the default width, still clamped below.
    }
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    const preferred = Number.isFinite(parsed) ? parsed : AGENT_PANEL_DEFAULT_WIDTH;
    // Re-clamp on resize so the page always keeps its reserve beside the dock.
    const apply = () => setPanelWidth((current) => clampAgentPanelWidth(current));
    setPanelWidth(clampAgentPanelWidth(preferred));
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(AGENT_DOCK_WIDTH_VAR, open && docked ? `${panelWidth}px` : "0px");
    return () => {
      root.style.setProperty(AGENT_DOCK_WIDTH_VAR, "0px");
    };
  }, [docked, open, panelWidth]);

  function handleResizePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    setResizing(true);
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    let latest = panelWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      latest = clampAgentPanelWidth(window.innerWidth - moveEvent.clientX);
      setPanelWidth(latest);
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      setResizing(false);
      try {
        window.localStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(latest));
      } catch {
        // Width just won't persist (private window, blocked storage).
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function resetPanelWidth() {
    setPanelWidth(clampAgentPanelWidth(AGENT_PANEL_DEFAULT_WIDTH));
    try {
      window.localStorage.removeItem(AGENT_PANEL_WIDTH_STORAGE_KEY);
    } catch {
      // Nothing persisted to clear.
    }
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
            {docked ? null : (
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
            )}
            <m.aside
              animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
              aria-label="Finance agent"
              aria-modal={docked ? undefined : true}
              className={cn(
                "fixed inset-y-0 right-0 z-50 flex flex-col overflow-hidden border-l border-border bg-background",
                !docked && "shadow-2xl"
              )}
              data-docked={docked ? "true" : "false"}
              data-testid="agent-panel"
              exit={reduce ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, transition: { duration: 0.2 }, x: "100%" }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: "100%" }}
              role={docked ? "complementary" : "dialog"}
              style={{ width: docked ? `${panelWidth}px` : "min(92vw, 28rem)" }}
              transition={reduce ? { duration: 0.15 } : AGENT_PANEL_SLIDE}
            >
              {docked ? (
                <button
                  aria-label="Drag to resize the finance agent. Double-click to reset."
                  className="group/agent-resize absolute inset-y-0 left-0 z-10 flex w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center select-none"
                  data-dragging={resizing ? "true" : undefined}
                  onDoubleClick={resetPanelWidth}
                  onPointerDown={handleResizePointerDown}
                  tabIndex={-1}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-full w-px transition-colors motion-reduce:transition-none",
                      resizing ? "bg-primary" : "bg-transparent group-hover/agent-resize:bg-primary/50"
                    )}
                  />
                </button>
              ) : null}
              <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 pr-2 pl-4 backdrop-blur-[var(--blur-small)]">
                {view === "history" ? (
                  <div className="-ml-2 flex items-center gap-1">
                    <Button
                      aria-label="Back to chat"
                      data-sound="none"
                      onClick={() => setView("chat")}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                    <h2 className="text-sm font-semibold tracking-tight">Chats</h2>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <KobanAvatar size={24} />
                    <h2 className="text-sm font-semibold tracking-tight">Ask Koban</h2>
                  </div>
                )}
                <div className="flex items-center">
                  {view === "chat" ? (
                    <Button
                      aria-label="Chat history"
                      data-sound="none"
                      onClick={() => setView("history")}
                      size="icon-sm"
                      title="Chat history"
                      type="button"
                      variant="ghost"
                    >
                      <History className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    aria-label="New chat"
                    data-sound="none"
                    data-testid="new-chat-button"
                    onClick={chats.onNewChat}
                    size="icon-sm"
                    title="New chat"
                    type="button"
                    variant="ghost"
                  >
                    <SquarePen className="size-4" />
                  </Button>
                  <Button
                    aria-label="Close finance agent"
                    data-sound="none"
                    onClick={onCloseAction}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </header>

              <div className="relative min-h-0 flex-1">
                {view === "history" ? (
                  <div className="scroll-fade-y h-full overflow-y-auto overscroll-contain p-2">
                    <AgentChatHistory
                      {...chats}
                      onOpenConversation={(id) => {
                        setView("chat");
                        return chats.onOpenConversation(id);
                      }}
                    />
                  </div>
                ) : conversationLoading ? (
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
                      aria-label="Suggested questions"
                      className="m-auto flex w-full max-w-sm flex-col items-center gap-5 py-6 text-center"
                    >
                      <ManekiMoment priority size={76} />
                      <div className="space-y-1">
                        <h3 className="text-base font-semibold text-balance">What would you like to know?</h3>
                        <p className="text-sm leading-5 text-pretty text-muted-foreground">
                          I can read every transaction, note, budget, and goal in this ledger.
                        </p>
                      </div>
                      <ul className="flex w-full flex-col gap-1.5">
                        {suggestedQuestions.map((suggestion) => (
                          <li key={suggestion}>
                            <button
                              className="w-full rounded-xl border border-border/70 bg-card/60 px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                              data-sound="send"
                              data-sound-hover=""
                              onClick={() => ask(suggestion)}
                              type="button"
                            >
                              {suggestion}
                            </button>
                          </li>
                        ))}
                      </ul>
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
                                <AssistantRow>
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
                                </AssistantRow>
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

              <div className={cn("shrink-0 bg-background px-4 pt-2 pb-4", view === "history" && "hidden")}>
                <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 transition-colors focus-within:border-ring/60">
                  <Textarea
                    aria-label="Finance question"
                    className="max-h-40 min-h-11 flex-1 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0"
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
                    placeholder="Ask about spending, a merchant, a goal…"
                    ref={textareaRef}
                    rows={1}
                    value={draft}
                  />
                  <Button
                    aria-label={submitting ? "Asking" : "Send question"}
                    className="mb-0.5 shrink-0 rounded-xl"
                    data-sound="send"
                    disabled={!canSubmit}
                    onClick={() => ask()}
                    size="icon-sm"
                    type="button"
                  >
                    {submitting ? <Spinner aria-hidden="true" size="sm" variant="ring" /> : <ArrowUp className="size-4" />}
                  </Button>
                </div>
                <p className="mt-2 px-1 text-2xs text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
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
      <section aria-label="Your question" className="flex justify-end">
        <p className="max-w-[85%] break-words whitespace-pre-wrap rounded-2xl bg-accent px-3.5 py-2.5 text-sm leading-5 text-accent-foreground">
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
      <AssistantRow>
        <AgentAnswer
          answer={content}
          meta={meta}
          question={question}
          status="done"
          variant="panel"
        />
      </AssistantRow>
    </MessageScrollerItem>
  );
}

// Koban's answers read as prose beside the mascot, not as bubbles.
function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <KobanAvatar className="mt-0.5" size={22} />
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
    </div>
  );
}

function KobanAvatar({ className, size }: { className?: string; size: number }) {
  return (
    <Image
      alt=""
      className={cn("koban-cat shrink-0 object-contain select-none", className)}
      draggable={false}
      height={size}
      src="/icons/koban-1024-transparent.png"
      width={size}
    />
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
