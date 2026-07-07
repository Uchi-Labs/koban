"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ActionSwapTextProps } from "@/components/ui/action-swap-types";
import {
  CASCADE_LETTER_VARIANTS,
  CASCADE_STAGGER,
  EASE_OUT_STYLE,
  TEXT_VARIANTS,
  type CoreAnimation
} from "@/components/ui/action-swap-motion";
import { cn } from "@/lib/utils";

export function ActionSwapText({
  animation = "blur",
  children,
  className,
  splitText,
  value
}: ActionSwapTextProps) {
  const reduce = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  const cascade = animation === "cascade" && splitText !== undefined && !reduce;
  const coreAnimation: CoreAnimation = animation === "cascade" ? "roll" : animation;

  useLayoutEffect(() => {
    const nextWidth = measureRef.current?.offsetWidth;

    if (!nextWidth) {
      return;
    }

    setWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
  }, [children]);

  return (
    <LazyMotion features={domAnimation}>
      <span
        className={cn("relative inline-block overflow-hidden whitespace-nowrap align-bottom", className)}
        style={{
          transition: reduce ? undefined : `width 220ms ${EASE_OUT_STYLE}`,
          width
        }}
      >
        <span aria-hidden className="invisible inline-block whitespace-nowrap" ref={measureRef}>
          {children}
        </span>
        {cascade ? (
          <>
            <span className="sr-only">{splitText}</span>
            <AnimatePresence initial={false}>
              <m.span
                aria-hidden
                animate="animate"
                className="absolute top-0 left-0 inline-block whitespace-pre"
                exit="exit"
                initial="initial"
                key={`cascade-${value}`}
              >
                {splitText.split("").map((char, index) => (
                  <m.span
                    className="inline-block whitespace-pre will-change-[opacity,transform]"
                    custom={index * CASCADE_STAGGER}
                    key={`${char}-${index}`}
                    variants={CASCADE_LETTER_VARIANTS}
                  >
                    {char}
                  </m.span>
                ))}
              </m.span>
            </AnimatePresence>
          </>
        ) : (
          <AnimatePresence initial={false}>
            <m.span
              animate={reduce ? { opacity: 1, scale: 1, y: 0 } : "animate"}
              className="absolute top-0 left-0 inline-block will-change-[opacity,transform]"
              exit={reduce ? undefined : "exit"}
              initial={reduce ? false : "initial"}
              key={`${animation}-${value}`}
              variants={TEXT_VARIANTS[coreAnimation]}
            >
              {children}
            </m.span>
          </AnimatePresence>
        )}
      </span>
    </LazyMotion>
  );
}
