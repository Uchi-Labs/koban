"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";
import { useAgentPanel } from "@/components/agent-panel-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The Koban cat walks a visitor through the app: a dimmed page with one
 * element lit, and a speech card the cat rides from spot to spot. Steps can
 * live on other routes; the tour navigates, waits for the anchor to render,
 * scrolls it into view, then moves the light. Start it from anywhere with
 * `startKobanTour()`; the public demo starts it once on a visitor's first load.
 */

export const kobanTourStartEvent = "koban:start-tour";
const seenStorageKey = "koban:tour-seen-v1";
const gold = "oklch(0.78 0.15 72)";
const ease = [0.22, 1, 0.36, 1] as const;
const anchorWaitMs = 5000;
const cardGap = 14;
const viewportMargin = 16;

interface TourStep {
  body: string;
  /** Opens the finance agent before the anchor is looked up. */
  openAgent?: boolean;
  route?: string;
  target?: string;
  title: string;
}

const steps: TourStep[] = [
  {
    title: "Hi, I'm Koban.",
    body: "I keep the books for the Morgans, a made-up family of four. Their money is pretend, but every number ties to every other one. Want a quick look around?"
  },
  {
    route: "/",
    target: '[data-tour="Monthly spending"]',
    title: "Where the month stands",
    body: "Spending so far, the budget it is measured against, and where the month is heading if the pace holds."
  },
  {
    route: "/",
    target: '[data-tour="Transactions to review"]',
    title: "New charges wait here",
    body: "Anything I could not file with confidence lands in this pile for a person to check."
  },
  {
    route: "/review",
    target: '[data-tour="review-stack"]',
    title: "Review like a card game",
    body: "Right arrow keeps my guess, up arrow picks another category, left arrow skips. W, A, S, D work too."
  },
  {
    route: "/transactions",
    target: '[data-testid="transaction-row"]',
    title: "Every charge has a story",
    body: "Open any transaction to see its note: why it happened, who it was for, and what it was part of. I read these notes when you ask me questions."
  },
  {
    route: "/categories",
    target: 'section[aria-label="Regular categories"]',
    title: "Budgets you edit in place",
    body: "Press the pencil on any category to change its budget, color, or emoji right in the row."
  },
  {
    route: "/recurrings",
    target: 'section[aria-label="Recurring calendar"]',
    title: "Bills before they arrive",
    body: "I spot subscriptions and bills from their rhythm, then lay out when each one lands next."
  },
  {
    route: "/goals",
    target: 'section[aria-label="Active goals"] > :first-child',
    title: "Money with a purpose",
    body: "Transfers tagged to a goal fill it up, so progress comes straight from the ledger."
  },
  {
    openAgent: true,
    target: '[data-testid="agent-panel"]',
    title: "Ask me anything",
    body: "Ask about any month, merchant, or plan, and I answer from the Morgans' ledger and the notes behind it."
  }
];

// A flat pill for the one action that moves the tour on, and bare text for the
// rest, so the card never shows two boxed buttons side by side.
const tourPrimaryButton = "h-7 rounded-full px-3.5 text-[13px]";
const tourTextButton = "h-7 px-2 text-[13px] text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent";

const finalQuestion = "How are we doing against our budget this month?";

interface Rect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function startKobanTour() {
  window.dispatchEvent(new Event(kobanTourStartEvent));
}

export function KobanTour({ autoStart = false }: { autoStart?: boolean }) {
  const [index, setIndex] = React.useState<number | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const agentPanel = useAgentPanel();
  const { closeAgent, openAgent } = agentPanel;
  const keepAgentOpenRef = React.useRef(false);

  React.useEffect(() => setMounted(true), []);

  // Seen as soon as it opens, so a visitor who walks away mid-tour is not greeted again.
  const start = React.useCallback(() => {
    setIndex(0);
    writeSeen();
  }, []);
  const finish = React.useCallback(() => setIndex(null), []);

  React.useEffect(() => {
    window.addEventListener(kobanTourStartEvent, start);
    return () => window.removeEventListener(kobanTourStartEvent, start);
  }, [start]);

  // Read before the agent's deep link strips ?ask= from the URL.
  const [arrivedWithQuestion] = React.useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("ask")
  );

  React.useEffect(() => {
    if (!autoStart || readSeen() || arrivedWithQuestion) return;
    const timer = window.setTimeout(start, 900);
    return () => window.clearTimeout(timer);
  }, [arrivedWithQuestion, autoStart, start]);

  // Leaving the agent step closes the panel it opened.
  const step = index === null ? null : steps[index];
  const agentStepOpen = step?.openAgent === true;
  React.useEffect(() => {
    if (agentStepOpen) {
      keepAgentOpenRef.current = false;
      openAgent();
      return () => {
        if (!keepAgentOpenRef.current) closeAgent();
      };
    }
  }, [agentStepOpen, closeAgent, openAgent]);

  if (!mounted || index === null || !step) return null;

  return createPortal(
    <TourLayer
      index={index}
      onAsk={() => {
        keepAgentOpenRef.current = true;
        finish();
        openAgent(finalQuestion);
      }}
      onClose={finish}
      onStep={setIndex}
      step={step}
    />,
    document.body
  );
}

function TourLayer({
  index,
  onAsk,
  onClose,
  onStep
}: {
  index: number;
  onAsk: () => void;
  onClose: () => void;
  onStep: (index: number) => void;
  step: TourStep;
}) {
  const step = steps[index];
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion() === true;
  const rect = useAnchorRect(step, pathname, router, reduce);
  const viewport = useViewport();
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = React.useState(240);
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const compact = viewport.width < 640;

  React.useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setCardHeight(card.offsetHeight));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  // Focus goes to the card, not a button, so no focus ring shows until the
  // visitor actually tabs.
  React.useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [index]);

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight" && !isLast) {
        event.preventDefault();
        onStep(index + 1);
      } else if (event.key === "ArrowLeft" && !isFirst) {
        event.preventDefault();
        onStep(index - 1);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, isFirst, isLast, onClose, onStep]);

  const cardWidth = Math.min(isFirst ? 400 : 360, viewport.width - viewportMargin * 2);
  const spotlight = rect ? clipToViewport(padRect(rect, 8), viewport) : null;
  const position = placeCard({ cardHeight, cardWidth, compact, rect: spotlight, viewport });
  const motionTransition = reduce ? { duration: 0 } : { duration: 0.55, ease };

  return (
    <LazyMotion features={domAnimation}>
      <div className="fixed inset-0 z-[60]" data-koban-tour="">
        {/* Catches clicks so the page under the light stays still while the cat talks. */}
        <div aria-hidden="true" className="absolute inset-0" />

        <m.div
          animate={
            spotlight
              ? { height: spotlight.height, left: spotlight.left, opacity: 1, top: spotlight.top, width: spotlight.width }
              : { height: 0, left: viewport.width / 2, opacity: 1, top: viewport.height / 2, width: 0 }
          }
          aria-hidden="true"
          className="pointer-events-none absolute rounded-2xl"
          initial={{ height: 0, left: viewport.width / 2, opacity: 0, top: viewport.height / 2, width: 0 }}
          style={{ boxShadow: `0 0 0 200vmax oklch(0.18 0.012 60 / 0.52), 0 0 0 2px ${gold}` }}
          transition={motionTransition}
        />

        <AnimatePresence>
          {spotlight && !reduce ? (
            <m.div
              animate={{ opacity: [0, 0.85, 0], scale: [1, 1, 1.06] }}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-2xl"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0, scale: 1 }}
              key={`${index}-glint`}
              style={{
                boxShadow: `0 0 0 3px ${gold}, 0 0 18px 2px color-mix(in oklab, ${gold} 55%, transparent)`,
                height: spotlight.height,
                left: spotlight.left,
                top: spotlight.top,
                width: spotlight.width
              }}
              transition={{ delay: 0.45, duration: 0.9, ease }}
            />
          ) : null}
        </AnimatePresence>

        <m.div
          animate={{ left: position.left, opacity: 1, top: position.top }}
          aria-describedby="koban-tour-body"
          aria-labelledby="koban-tour-title"
          aria-modal="true"
          className="absolute outline-none"
          initial={{ left: position.left, opacity: 0, top: position.top + (reduce ? 0 : 12) }}
          ref={cardRef}
          role="dialog"
          style={{ width: cardWidth }}
          tabIndex={-1}
          transition={motionTransition}
        >
          <TourCat hopKey={index} large={isFirst} reduce={reduce} />
          <div
            className={cn(
              "relative rounded-2xl border border-border bg-popover text-popover-foreground shadow-md",
              isFirst ? "px-6 pt-14 pb-5" : "px-5 pt-9 pb-4"
            )}
          >
            <Button
              aria-label="End tour"
              className="absolute top-2 right-2 text-muted-foreground"
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <CloseGlyph />
            </Button>
            <AnimatePresence initial={false} mode="wait">
              <m.div
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -4 }}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                key={index}
                transition={reduce ? { duration: 0 } : { duration: 0.28, ease }}
              >
                <h2
                  className={cn("font-semibold tracking-tight text-balance", isFirst ? "text-center text-lg" : "text-[15px]")}
                  id="koban-tour-title"
                >
                  {step.title}
                </h2>
                <p
                  className={cn(
                    "mt-1.5 text-[13.5px] leading-relaxed text-pretty text-muted-foreground",
                    isFirst && "text-center"
                  )}
                  id="koban-tour-body"
                >
                  {step.body}
                </p>
              </m.div>
            </AnimatePresence>

            <div className={cn("mt-4 flex items-center gap-2", isFirst ? "justify-center" : "justify-between")}>
              {isFirst ? (
                <>
                  <Button className={tourTextButton} onClick={onClose} size="sm" type="button" variant="ghost">
                    I&apos;ll explore
                  </Button>
                  <Button className={tourPrimaryButton} onClick={() => onStep(1)} size="sm" type="button">
                    Show me around
                  </Button>
                </>
              ) : (
                <>
                  <StepDots count={steps.length - 1} current={index - 1} />
                  <div className="flex items-center gap-1.5">
                    <Button className={tourTextButton} onClick={() => onStep(index - 1)} size="sm" type="button" variant="ghost">
                      Back
                    </Button>
                    {isLast ? (
                      <Button className={tourPrimaryButton} onClick={onAsk} size="sm" type="button">
                        Ask a question
                      </Button>
                    ) : (
                      <Button className={tourPrimaryButton} onClick={() => onStep(index + 1)} size="sm" type="button">
                        Next
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </m.div>
      </div>
    </LazyMotion>
  );
}

// The cat sits on the card's top edge and hops each time the card moves.
function TourCat({ hopKey, large, reduce }: { hopKey: number; large: boolean; reduce: boolean }) {
  const size = large ? 96 : 60;

  return (
    <m.div
      animate={reduce ? undefined : { rotate: [0, -7, 0], y: [0, -16, 0] }}
      aria-hidden="true"
      className={cn("absolute z-10 select-none", large ? "left-1/2 -top-12 -ml-12" : "-top-8 left-4")}
      key={hopKey}
      style={{ height: size, width: size }}
      transition={reduce ? undefined : { duration: 0.6, ease, times: [0, 0.4, 1] }}
    >
      {large ? (
        <span
          className="absolute inset-[-18%] rounded-full"
          style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${gold} 30%, transparent), transparent)` }}
        />
      ) : null}
      <Image alt="" className="koban-cat object-contain" draggable={false} fill priority sizes={`${size}px`} src="/icons/koban-1024-transparent.png" />
    </m.div>
  );
}

function StepDots({ count, current }: { count: number; current: number }) {
  return (
    <span aria-label={`Step ${current + 1} of ${count}`} className="flex items-center gap-1" role="img">
      {Array.from({ length: count }, (_, dot) => (
        <span
          className={cn(
            "h-1.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none",
            dot === current ? "w-4" : "w-1.5 bg-muted-foreground/25"
          )}
          key={dot}
          style={dot === current ? { backgroundColor: gold } : undefined}
        />
      ))}
    </span>
  );
}

function CloseGlyph() {
  return (
    <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 16 16">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/**
 * Navigates to the step's route when needed, waits for its anchor, scrolls it
 * into view, then follows it every frame so the light stays put while the page
 * settles, scrolls, or the agent panel slides in.
 */
function useAnchorRect(
  step: TourStep,
  pathname: string,
  router: ReturnType<typeof useRouter>,
  reduce: boolean
): Rect | null {
  const [rect, setRect] = React.useState<Rect | null>(null);
  const onRoute = !step.route || step.route === pathname;

  React.useEffect(() => {
    if (step.route && step.route !== pathname) router.push(step.route);
  }, [pathname, router, step.route]);

  React.useEffect(() => {
    setRect(null);
    if (!step.target || !onRoute) return;

    let frame = 0;
    let element: HTMLElement | null = null;
    let last: Rect | null = null;
    const startedAt = performance.now();

    const tick = () => {
      if (!element || !element.isConnected) {
        element = document.querySelector<HTMLElement>(step.target!);
        if (element) {
          // Tall anchors, and every anchor on a phone where the card docks at the
          // bottom, start just under the top edge so they stay clear of the card.
          const tall =
            window.innerWidth < 640 || element.getBoundingClientRect().height > window.innerHeight * 0.55;
          element.style.scrollMarginTop = tall ? "72px" : "";
          element.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: tall ? "start" : "center", inline: "nearest" });
        } else if (performance.now() - startedAt > anchorWaitMs) {
          return;
        }
      }
      if (element) {
        const box = element.getBoundingClientRect();
        const next = { height: box.height, left: box.left, top: box.top, width: box.width };
        if (!last || !sameRect(last, next)) {
          last = next;
          setRect(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    // A short beat lets the route's content and the agent panel start moving first.
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, step.openAgent ? 360 : 60);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [onRoute, reduce, step]);

  return rect;
}

function useViewport() {
  const [viewport, setViewport] = React.useState(() => ({ height: window.innerHeight, width: window.innerWidth }));

  React.useEffect(() => {
    const update = () => setViewport({ height: window.innerHeight, width: window.innerWidth });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return viewport;
}

function placeCard({
  cardHeight,
  cardWidth,
  compact,
  rect,
  viewport
}: {
  cardHeight: number;
  cardWidth: number;
  compact: boolean;
  rect: Rect | null;
  viewport: { height: number; width: number };
}) {
  const centeredLeft = (viewport.width - cardWidth) / 2;
  const bottomTop = viewport.height - cardHeight - viewportMargin - 8;

  if (!rect) return { left: centeredLeft, top: Math.max(viewportMargin + 48, (viewport.height - cardHeight) / 2) };
  if (compact) {
    // Phones: the card docks at the bottom unless the lit element sits there.
    const litBottomHalf = rect.top > viewport.height / 2;
    return { left: centeredLeft, top: litBottomHalf ? viewportMargin + 40 : bottomTop };
  }

  const clampLeft = (left: number) => Math.min(Math.max(left, viewportMargin), viewport.width - cardWidth - viewportMargin);
  const clampTop = (top: number) => Math.min(Math.max(top, viewportMargin + 40), viewport.height - cardHeight - viewportMargin);
  const below = rect.top + rect.height + cardGap + 40;
  const above = rect.top - cardGap - cardHeight;

  if (below + cardHeight <= viewport.height - viewportMargin) return { left: clampLeft(rect.left), top: below };
  if (above >= viewportMargin + 40) return { left: clampLeft(rect.left), top: above };
  if (rect.left - cardGap - cardWidth >= viewportMargin) {
    return { left: rect.left - cardGap - cardWidth, top: clampTop(rect.top + 40) };
  }
  if (rect.left + rect.width + cardGap + cardWidth <= viewport.width - viewportMargin) {
    return { left: rect.left + rect.width + cardGap, top: clampTop(rect.top + 40) };
  }
  return { left: centeredLeft, top: bottomTop };
}

function padRect(rect: Rect, pad: number): Rect {
  return { height: rect.height + pad * 2, left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2 };
}

// Tall anchors (a whole table, the agent panel) are lit only where they are on screen.
function clipToViewport(rect: Rect, viewport: { height: number; width: number }): Rect {
  const top = Math.max(rect.top, 8);
  const left = Math.max(rect.left, 8);
  const bottom = Math.min(rect.top + rect.height, viewport.height - 8);
  const right = Math.min(rect.left + rect.width, viewport.width - 8);
  return { height: Math.max(bottom - top, 0), left, top, width: Math.max(right - left, 0) };
}

function sameRect(left: Rect, right: Rect) {
  return (
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

function readSeen() {
  try {
    return window.localStorage.getItem(seenStorageKey) !== null;
  } catch {
    return false;
  }
}

function writeSeen() {
  try {
    window.localStorage.setItem(seenStorageKey, new Date().toISOString());
  } catch {
    // Without storage the tour may greet this visitor again next time.
  }
}
