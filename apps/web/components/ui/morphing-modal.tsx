"use client";

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { type ReactNode } from "react";
import { EASE_OUT } from "@/lib/motion";

export interface MorphingPanelProps {
  viewId: string;
  children: ReactNode;
  className?: string;
}

export function MorphingPanel({ children, className, viewId }: MorphingPanelProps) {
  const reduce = useReducedMotion();

  return (
    <LazyMotion features={domAnimation}>
      <m.div className={className} layout="position">
        <AnimatePresence mode="popLayout" initial={false}>
          <m.div
            animate={
              reduce
                ? { opacity: 1, transition: { duration: 0.18, ease: EASE_OUT } }
                : {
                    opacity: 1,
                    transition: { duration: 0.24, ease: EASE_OUT },
                    y: 0
                  }
            }
            exit={
              reduce
                ? { opacity: 0, transition: { duration: 0.14, ease: EASE_OUT } }
                : {
                    opacity: 0,
                    transition: { duration: 0.16, ease: EASE_OUT },
                    y: -8
                  }
            }
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            key={viewId}
          >
            {children}
          </m.div>
        </AnimatePresence>
      </m.div>
    </LazyMotion>
  );
}
