"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { Send, Sparkles, X } from "lucide-react";
import * as React from "react";
import { AgentAnswer } from "@/components/agent-answer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AvatarHoverGroup, AvatarHoverItem } from "@/components/ui/motion-recipes";
import { StatefulButton } from "@/components/ui/stateful-button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentStreamControls } from "@/lib/hooks/use-agent-stream";
import { EASE_SMOOTH_OUT, SPRING_GOO_MELT, SPRING_PANEL } from "@/lib/motion";
import { playClose, playOpen } from "@/lib/ui-sound";
import { cn } from "@/lib/utils";

const suggestedQuestions = [
  "Where did my money go this month?",
  "What transactions need review first?",
  "How are source syncs doing?",
  "What rules would clean this up?"
];

// Gooey suggestion nudge: a card above the question box that merges into it
// like liquid when dismissed. Two mirrored trees share one grid cell — a
// goo-filtered background layer draws the card silhouettes (the SVG filter
// blurs alpha then thresholds it back, so nearby shapes grow a fillet bridge),
// while the unfiltered content layer keeps text and buttons crisp. Both trees
// animate the same marginBottom so they stay pixel-aligned.
const NUDGE_HEIGHT_PX = 44;
const NUDGE_GAP_PX = 10;
// Matches the flattened color of the textarea's bg-input/50 over bg-background,
// since the goo layer must be solid for the alpha threshold to bite.
const GOO_SURFACE_CLASS = "rounded-2xl bg-[color-mix(in_srgb,var(--input)_50%,var(--background))]";

// Drag-resizable height for the finance agent bottom drawer. The sheet is
// anchored to the bottom edge, so height grows as the pointer moves up:
// height = window.innerHeight - clientY, clamped and capped to the viewport.
const AGENT_PANEL_MIN_HEIGHT = 320;
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
  const [nudgeQuestion] = React.useState(
    () => suggestedQuestions[Math.floor(Math.random() * suggestedQuestions.length)]
  );
  const [nudgePhase, setNudgePhase] = React.useState<"open" | "melting" | "gone">(() =>
    draftPrefill.trim() ? "gone" : "open"
  );
  const nudgeActive = nudgePhase !== "gone";
  const [panelHeight, setPanelHeight] = React.useState(AGENT_PANEL_DEFAULT_HEIGHT);
  const [resizing, setResizing] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const previousOpenRef = React.useRef(open);
  const closeAction = React.useEffectEvent(onCloseAction);
  const submitting = stream.status === "streaming";
  const canSubmit = draft.trim().length > 0 && !submitting;

  // Hydrate the persisted width after mount (localStorage is client-only, so the
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

  function meltNudge() {
    if (nudgePhase !== "open") {
      return;
    }
    setNudgePhase(reduce ? "gone" : "melting");
  }

  function ask(nextQuestion = draft) {
    const question = nextQuestion.trim();

    if (!question || submitting) {
      return;
    }

    meltNudge();
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

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground" htmlFor="agent-panel-question">
                      Question
                    </label>
                    <div className="grid">
                      {nudgeActive ? (
                        <>
                          <svg aria-hidden="true" className="pointer-events-none absolute size-0">
                            <filter height="160%" id="agent-goo" width="140%" x="-20%" y="-30%">
                              <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
                              <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 25 -11" />
                            </filter>
                          </svg>
                          <div
                            aria-hidden="true"
                            className="pointer-events-none col-start-1 row-start-1 flex flex-col [filter:url(#agent-goo)]"
                          >
                            <m.div
                              animate={{
                                marginBottom: nudgePhase === "melting" ? -NUDGE_HEIGHT_PX : NUDGE_GAP_PX
                              }}
                              className={cn("w-full shrink-0", GOO_SURFACE_CLASS)}
                              initial={false}
                              style={{ height: NUDGE_HEIGHT_PX }}
                              transition={SPRING_GOO_MELT}
                            />
                            <div className={cn("min-h-0 flex-1", GOO_SURFACE_CLASS)} />
                          </div>
                        </>
                      ) : null}
                      <div className="relative col-start-1 row-start-1 flex flex-col">
                        {nudgeActive ? (
                          <m.div
                            animate={
                              nudgePhase === "melting"
                                ? { filter: "blur(4px)", marginBottom: -NUDGE_HEIGHT_PX, opacity: 0 }
                                : { filter: "blur(0px)", marginBottom: NUDGE_GAP_PX, opacity: 1 }
                            }
                            className={cn(
                              "flex shrink-0 items-center gap-2 pr-1.5 pl-3",
                              nudgePhase === "melting" && "pointer-events-none"
                            )}
                            initial={false}
                            onAnimationComplete={() => {
                              if (nudgePhase === "melting") {
                                setNudgePhase("gone");
                              }
                            }}
                            style={{ height: NUDGE_HEIGHT_PX }}
                            transition={{
                              ...SPRING_GOO_MELT,
                              filter: { duration: 0.18 },
                              opacity: { duration: 0.18 }
                            }}
                          >
                            <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
                            <span className="sr-only">Suggested question:</span>
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                              {nudgeQuestion}
                            </span>
                            <Button
                              className="h-7 rounded-full px-3 text-xs"
                              data-sound="none"
                              disabled={submitting}
                              onClick={() => ask(nudgeQuestion)}
                              type="button"
                            >
                              Ask
                            </Button>
                            <Button
                              aria-label="Dismiss suggested question"
                              className="size-7 rounded-full text-muted-foreground"
                              data-sound="none"
                              onClick={meltNudge}
                              size="icon"
                              type="button"
                              variant="ghost"
                            >
                              <X className="size-3.5" />
                            </Button>
                          </m.div>
                        ) : null}
                        <Textarea
                          aria-label="Finance question"
                          className={cn("min-h-24", nudgeActive && "bg-transparent")}
                          disabled={submitting}
                          id="agent-panel-question"
                          onChange={(event) => {
                            setDraft(event.target.value);
                            meltNudge();
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
                      {suggestedQuestions.filter((suggestion) => suggestion !== nudgeQuestion).map((suggestion, index) => (
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
