"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { Send, X } from "lucide-react";
import * as React from "react";
import { AgentAnswer } from "@/components/agent-answer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AvatarHoverGroup, AvatarHoverItem } from "@/components/ui/motion-recipes";
import { StatefulButton } from "@/components/ui/stateful-button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentStreamControls } from "@/lib/hooks/use-agent-stream";
import { EASE_SMOOTH_OUT, SPRING_PANEL } from "@/lib/motion";
import { playClose, playOpen } from "@/lib/ui-sound";
import { cn } from "@/lib/utils";

const suggestedQuestions = [
  "Where did my money go this month?",
  "What transactions need review first?",
  "How are source syncs doing?",
  "What rules would clean this up?"
];

// Drag-resizable width for the finance agent drawer — mirrors the left sidebar's
// resize handle in components/app-shell.tsx (clamp + localStorage + double-click
// reset). The panel is anchored to the right edge, so width grows as the pointer
// moves left: width = window.innerWidth - clientX.
const AGENT_PANEL_MIN_WIDTH = 320;
const AGENT_PANEL_MAX_WIDTH = 640;
const AGENT_PANEL_DEFAULT_WIDTH = 420;
const AGENT_PANEL_WIDTH_STORAGE_KEY = "koban:agent-panel-width";

function clampAgentPanelWidth(px: number) {
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, px));
}

export function AgentPanel({
  draftPrefill,
  onCloseAction,
  open,
  stream
}: {
  draftPrefill: string;
  onCloseAction: () => void;
  open: boolean;
  stream: AgentStreamControls;
}) {
  const reduce = useReducedMotion();
  const [draft, setDraft] = React.useState(() => draftPrefill);
  const [panelWidth, setPanelWidth] = React.useState(AGENT_PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const previousOpenRef = React.useRef(open);
  const closeAction = React.useEffectEvent(onCloseAction);
  const submitting = stream.status === "streaming";
  const canSubmit = draft.trim().length > 0 && !submitting;

  // Hydrate the persisted width after mount (localStorage is client-only, so the
  // first render must match the SSR default to avoid a hydration mismatch).
  React.useEffect(() => {
    const stored = window.localStorage.getItem(AGENT_PANEL_WIDTH_STORAGE_KEY);
    if (!stored) {
      return;
    }
    const parsed = Number.parseInt(stored, 10);
    if (Number.isFinite(parsed)) {
      setPanelWidth(clampAgentPanelWidth(parsed));
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
      window.localStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(latest));
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function resetPanelWidth() {
    setPanelWidth(AGENT_PANEL_DEFAULT_WIDTH);
    window.localStorage.removeItem(AGENT_PANEL_WIDTH_STORAGE_KEY);
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
    stream.ask(question);
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
            <button
              aria-label="Drag to resize the finance agent panel. Double-click to reset."
              className="group/agent-resize fixed top-0 z-[60] hidden h-svh w-1.5 cursor-col-resize touch-none select-none sm:block"
              data-dragging={resizing ? "true" : undefined}
              onDoubleClick={resetPanelWidth}
              onPointerDown={handleResizePointerDown}
              style={{ right: `${panelWidth - 3}px` }}
              tabIndex={-1}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-0 right-0 w-0.5 transition-colors motion-reduce:transition-none",
                  resizing ? "bg-primary" : "bg-transparent group-hover/agent-resize:bg-primary/50"
                )}
              />
            </button>
            <m.aside
              animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
              aria-label="Finance agent"
              aria-modal="true"
              className="fixed top-0 right-0 z-50 flex h-svh w-full flex-col overflow-y-auto border-l border-border bg-background shadow-2xl sm:w-[var(--agent-panel-width)]"
              data-testid="agent-panel"
              exit={reduce ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, transition: { duration: 0.15 }, x: "100%" }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: "100%" }}
              role="dialog"
              style={{ ["--agent-panel-width" as string]: `${panelWidth}px` }}
              transition={reduce ? { duration: 0.15 } : SPRING_PANEL}
            >
              <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-[var(--blur-small)]">
                <h2 className="text-sm font-semibold tracking-tight">Finance agent</h2>
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

              <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5" htmlFor="agent-panel-question">
                    <span className="text-xs text-muted-foreground">Question</span>
                    <Textarea
                      aria-label="Finance question"
                      className="min-h-24"
                      disabled={submitting}
                      id="agent-panel-question"
                      onChange={(event) => setDraft(event.target.value)}
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
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatefulButton
                      data-sound="none"
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

                  {!draft.trim() ? (
                    <AvatarHoverGroup className="flex flex-wrap gap-2">
                      {suggestedQuestions.map((suggestion, index) => (
                        <AvatarHoverItem index={index} key={suggestion}>
                          <Button
                            className="h-7 rounded-xl px-2.5 text-xs"
                            data-sound="none"
                            disabled={submitting}
                            onClick={() => ask(suggestion)}
                            type="button"
                            variant="secondary"
                          >
                            {suggestion}
                          </Button>
                        </AvatarHoverItem>
                      ))}
                    </AvatarHoverGroup>
                  ) : null}
                </div>

                {stream.error ? (
                  <Alert appearance="destructive" message={stream.error} variant="inline" width="100%" />
                ) : null}

                <div className={cn("min-h-0", stream.status === "idle" && "hidden")}>
                  <AgentAnswer
                    answer={stream.answer}
                    meta={stream.meta}
                    question={stream.question}
                    status={stream.status}
                    variant="panel"
                  />
                </div>
              </div>
            </m.aside>
          </>
        ) : null}
      </AnimatePresence>
    </LazyMotion>
  );
}
