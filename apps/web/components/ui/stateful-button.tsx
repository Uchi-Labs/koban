"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion, type Variants } from "motion/react";
import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { EASE_OUT, SPRING_SWAP } from "@/lib/motion";
import { configureSuccessCheckPaths, forceReflow } from "@/lib/transitions";

export type ButtonState = "idle" | "loading" | "success" | "error";

export interface StatefulButtonProps extends Omit<ComponentProps<typeof Button>, "children"> {
  children: ReactNode;
  errorText?: ReactNode;
  icon?: ReactNode;
  loadingText?: ReactNode;
  state?: ButtonState;
  successText?: ReactNode;
}

const ICON_VARIANTS: Variants = {
  animate: {
    opacity: 1,
    scale: 1,
    transition: SPRING_SWAP,
    width: "1.5rem",
  },
  exit: {
    opacity: 0,
    scale: 0.7,
    transition: { duration: 0.16, ease: EASE_OUT },
    width: 0,
  },
  initial: { opacity: 0, scale: 0.7, width: 0 },
};

export function StatefulButton({
  children,
  disabled,
  errorText = "Try again",
  icon,
  loadingText = "Loading",
  state = "idle",
  successText = "Done",
  ...props
}: StatefulButtonProps) {
  const isBusy = state === "loading";
  const stateText =
    state === "loading" ? loadingText : state === "success" ? successText : state === "error" ? errorText : children;
  const textKey = typeof stateText === "string" ? `${state}-${stateText}` : state;

  return (
    <Button aria-busy={isBusy} disabled={disabled || isBusy} {...props}>
      <LazyMotion features={domAnimation}>
        <span aria-live="polite" className="relative inline-flex items-center justify-center overflow-hidden">
          <AnimatePresence initial={false}>
            {state === "loading" ? (
              <IconSlot keyId="loading-icon">
                <span aria-hidden="true">
                  <Loader className="h-4 w-4" size={16} variant="spinner" />
                </span>
              </IconSlot>
            ) : null}
            {state === "success" ? (
              <IconSlot keyId="success-icon">
                <SuccessCheckIcon />
              </IconSlot>
            ) : null}
            {state === "error" ? (
              <IconSlot keyId="error-icon">
                <X className="h-4 w-4" />
              </IconSlot>
            ) : null}
          </AnimatePresence>

          <TextSlot value={textKey}>{stateText}</TextSlot>

          <AnimatePresence initial={false}>
            {state === "idle" && icon ? <IconSlot keyId="idle-icon">{icon}</IconSlot> : null}
          </AnimatePresence>
        </span>
      </LazyMotion>
    </Button>
  );
}

function IconSlot({ children, keyId }: { children: ReactNode; keyId: string }) {
  const reduce = useReducedMotion();

  return (
    <m.span
      animate={reduce ? { opacity: 1 } : "animate"}
      className="inline-grid shrink-0 place-items-center overflow-hidden"
      exit={reduce ? { opacity: 0 } : "exit"}
      initial={reduce ? { opacity: 0 } : "initial"}
      key={keyId}
      transition={reduce ? { duration: 0.15 } : undefined}
      variants={ICON_VARIANTS}
    >
      {children}
    </m.span>
  );
}

function SuccessCheckIcon() {
  const ref = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"in" | "out">("out");

  useLayoutEffect(() => {
    configureSuccessCheckPaths(ref.current);
    forceReflow(ref.current);
    setState("in");
  }, []);

  return (
    <span className="t-success-check" data-state={state} ref={ref} aria-hidden="true">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
        <path
          d="M20 6 9 17l-5-5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
      </svg>
    </span>
  );
}

function TextSlot({ children, value }: { children: ReactNode; value: string }) {
  const reduce = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const nextWidth = measureRef.current?.offsetWidth;

    if (!nextWidth) {
      return;
    }

    setWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
  }, [children]);

  return (
    <m.span
      animate={{ width }}
      className="relative inline-block overflow-hidden whitespace-nowrap align-bottom"
      initial={false}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
    >
      <span className="sr-only">{children}</span>
      <span aria-hidden className="invisible inline-block whitespace-nowrap" ref={measureRef}>
        {children}
      </span>

      <AnimatePresence initial={false}>
        <m.span
          aria-hidden
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          className="absolute top-0 left-0 inline-block will-change-[opacity,transform]"
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14 }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
          key={`text-${value}`}
          transition={reduce ? { duration: 0.15 } : SPRING_SWAP}
        >
          {children}
        </m.span>
      </AnimatePresence>
    </m.span>
  );
}
