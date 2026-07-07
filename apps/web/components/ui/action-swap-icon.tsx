"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import type { ActionSwapIconProps } from "@/components/ui/action-swap-types";
import { ICON_VARIANTS, type CoreAnimation } from "@/components/ui/action-swap-motion";
import { cn } from "@/lib/utils";

export function ActionSwapIcon({
  animation = "blur",
  children,
  className,
  value
}: ActionSwapIconProps) {
  const reduce = useReducedMotion();
  const coreAnimation: CoreAnimation = animation === "cascade" ? "roll" : animation;

  return (
    <LazyMotion features={domAnimation}>
      <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden", className)}>
        <AnimatePresence mode="popLayout" initial={false}>
          <m.span
            animate={reduce ? { opacity: 1, scale: 1, y: 0 } : "animate"}
            aria-hidden
            className="col-start-1 row-start-1 inline-flex items-center justify-center will-change-[opacity,transform]"
            exit={reduce ? undefined : "exit"}
            initial={reduce ? false : "initial"}
            key={`${animation}-${value}`}
            variants={ICON_VARIANTS[coreAnimation]}
          >
            {children}
          </m.span>
        </AnimatePresence>
      </span>
    </LazyMotion>
  );
}
