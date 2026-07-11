"use client";
// beui.dev/components/motion/text-animation

import { motion, type Transition, useInView, useReducedMotion } from "motion/react";
import { useRef, type ElementType, type ReactNode } from "react";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

type SplitMode = "word" | "char";

export interface TextRevealProps {
  text: string | string[];
  as?: ElementType;
  className?: string;
  split?: SplitMode;
  stagger?: number;
  delay?: number;
  blur?: number;
  yOffset?: string | number;
  spring?: { stiffness?: number; damping?: number; mass?: number };
  once?: boolean;
  whileInView?: boolean;
  children?: ReactNode;
}

// Text needs a softer landing than control motion so words remain readable as
// they rise; this named local spring is intentionally limited to this reveal.
const DEFAULT_SPRING = { stiffness: 180, damping: 28, mass: 0.8 };

export function TextReveal({
  text,
  as: Comp = "span",
  className,
  split = "word",
  stagger = 0.09,
  delay = 0,
  blur = 8,
  yOffset = "40%",
  spring,
  once = true,
  whileInView = false,
  children,
}: TextRevealProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once, amount: 0.4 });
  const reduce = useReducedMotion();
  const shouldAnimate = whileInView ? inView : true;

  const lines = Array.isArray(text) ? text : [text];
  const revealSpring = { ...DEFAULT_SPRING, ...spring };

  let unitIndex = 0;
  const lineCounts = new Map<string, number>();

  return (
    <Comp ref={ref} className={cn("block", className)}>
      {lines.map((line) => {
        const units = split === "word" ? line.split(" ") : Array.from(line);
        const lineCount = lineCounts.get(line) ?? 0;
        lineCounts.set(line, lineCount + 1);
        const lineKey = `${line}-${lineCount}`;
        const unitCounts = new Map<string, number>();

        return (
          <span key={lineKey} className="block">
            {units.map((unit, i) => {
              const unitDelay = delay + unitIndex * stagger;
              unitIndex += 1;
              const unitCount = unitCounts.get(unit) ?? 0;
              unitCounts.set(unit, unitCount + 1);
              const unitKey = `${unit}-${unitCount}`;
              const initial = reduce
                ? { opacity: 1 }
                : { y: yOffset, opacity: 0, filter: `blur(${blur}px)` };
              const animate = shouldAnimate
                ? reduce
                  ? { opacity: 1 }
                  : { y: 0, opacity: 1, filter: "blur(0px)" }
                : initial;
              // Filter is the deliberate blur-reveal effect requested by this
              // component; keep it subtle and within the UI timing budget.
              const transition: Transition = reduce
                ? { duration: 0 }
                : {
                    y: { type: "spring" as const, ...revealSpring, delay: unitDelay },
                    opacity: { duration: 0.24, ease: EASE_OUT, delay: unitDelay },
                    filter: { duration: 0.28, ease: EASE_OUT, delay: unitDelay },
                  };
              return (
                <motion.span
                  key={unitKey}
                  initial={reduce ? false : initial}
                  animate={animate}
                  transition={transition}
                  className="inline-block will-change-transform"
                >
                  {unit}
                  {split === "word" && i < units.length - 1 ? (
                    <span className="inline-block">&nbsp;</span>
                  ) : null}
                </motion.span>
              );
            })}
          </span>
        );
      })}
      {children}
    </Comp>
  );
}
