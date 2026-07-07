"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

type IslandContextValue = {
  view: string | null;
};

const IslandContext = createContext<IslandContextValue | null>(null);

const SHELL_SPRING = {
  bounce: 0.2,
  duration: 0.8,
  type: "spring"
} as const;

const CONTENT_SPRING = {
  bounce: 0.35,
  duration: 0.8,
  type: "spring"
} as const;

const RADIUS = 32;
const PILL_WIDTH = 126;
const PILL_HEIGHT = 37;

function useContentSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    setSize({ height: element.offsetHeight, width: element.offsetWidth });
  }, []);

  useEffect(() => {
    const element = ref.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      setSize({ height: element.offsetHeight, width: element.offsetWidth });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

function Slot({
  children,
  className,
  keyId
}: {
  keyId: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <m.div
      animate={
        reduce
          ? { opacity: 1 }
          : { opacity: 1, scale: 1, y: 0 }
      }
      className={cn("flex items-center justify-center", className)}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.1 } }
          : {
              opacity: 0,
              scale: 0.9,
              transition: { duration: 0.08, ease: EASE_OUT },
              y: -6
            }
      }
      initial={
        reduce
          ? { opacity: 0 }
          : { opacity: 0, scale: 0.9, y: -8 }
      }
      key={keyId}
      style={{
        transformOrigin: "top center"
      }}
      transition={reduce ? { duration: 0.15 } : CONTENT_SPRING}
    >
      {children}
    </m.div>
  );
}

export interface DynamicIslandProps {
  view: string | null;
  compact?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function DynamicIsland({ children, className, compact, view }: DynamicIslandProps) {
  const reduce = useReducedMotion();
  const expanded = view !== null;
  const [sizerRef, size] = useContentSize();
  const contextValue = useMemo(() => ({ view }), [view]);

  return (
    <IslandContext.Provider value={contextValue}>
      <LazyMotion features={domAnimation}>
        <m.div
          animate={
            size
              ? { height: size.height, width: size.width }
              : { height: PILL_HEIGHT, width: PILL_WIDTH }
          }
          aria-live="polite"
          className={cn(
            "relative inline-flex items-start justify-center overflow-hidden",
            "border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-lg",
            className
          )}
          initial={false}
          role="status"
          style={{ borderRadius: RADIUS }}
          transition={reduce ? { duration: 0 } : SHELL_SPRING}
        >
          <div className="w-max" ref={sizerRef}>
            <AnimatePresence mode="popLayout" initial={false}>
              {!expanded && compact ? (
                <Slot className="min-h-[37px] min-w-[126px] gap-2 px-4 py-1.5 text-xs font-medium" keyId="compact">
                  {compact}
                </Slot>
              ) : null}
            </AnimatePresence>
            {children}
          </div>
        </m.div>
      </LazyMotion>
    </IslandContext.Provider>
  );
}

export interface DynamicIslandViewProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function DynamicIslandView({ children, className, id }: DynamicIslandViewProps) {
  const context = use(IslandContext);

  if (!context) {
    throw new Error("DynamicIslandView must be used inside <DynamicIsland>");
  }

  const active = context.view === id;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {active ? (
        <Slot className={cn("px-5 py-3", className)} keyId={id}>
          {children}
        </Slot>
      ) : null}
    </AnimatePresence>
  );
}
