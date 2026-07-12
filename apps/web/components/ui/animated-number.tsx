"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { EASE_OUT } from "@/lib/motion";
import { splitPopDigits } from "@/lib/transitions";
import { cn } from "@/lib/utils";

export interface AnimatedNumberProps {
  className?: string;
  digitClassName?: (char: string, index: number, chars: string[]) => string | undefined;
  digitPopOnChange?: boolean;
  digitText?: (value: number) => string;
  duration?: number;
  format?: (value: number) => ReactNode;
  startOnView?: boolean;
  value: number;
}

export function AnimatedNumber({
  className,
  digitClassName,
  digitPopOnChange = false,
  digitText,
  duration = 1.2,
  format = (value) => Math.round(value).toLocaleString(),
  startOnView = true,
  value,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.6, once: true });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const [digitAnimating, setDigitAnimating] = useState(false);
  const fromRef = useRef(value);
  const digitMountedRef = useRef(false);

  useEffect(() => {
    if (startOnView && !inView) {
      return;
    }

    if (reduce) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const controls = animate(fromRef.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (nextValue) => {
        fromRef.current = nextValue;
        setDisplay(nextValue);
      },
    });

    return () => controls.stop();
  }, [duration, inView, reduce, startOnView, value]);

  useEffect(() => {
    if (!digitPopOnChange || reduce) {
      digitMountedRef.current = true;
      setDigitAnimating(false);
      return;
    }

    if (!digitMountedRef.current) {
      digitMountedRef.current = true;
      return;
    }

    setDigitAnimating(false);
    const frame = window.requestAnimationFrame(() => setDigitAnimating(true));
    const timeout = window.setTimeout(() => setDigitAnimating(false), 650);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [digitPopOnChange, reduce, value]);

  if (digitText) {
    const text = digitText(display);
    const chars = Array.from(text);
    const shouldAnimateDigits = digitPopOnChange && !reduce && digitAnimating;

    return (
      <span
        className={cn("t-digit-group tabular-nums", shouldAnimateDigits && "is-animating", className)}
        ref={ref}
      >
        {splitPopDigits(text).map(({ char, stagger }, index) => (
          <span
            className={cn("t-digit", digitClassName?.(char, index, chars))}
            data-stagger={stagger}
            key={index}
          >
            {char}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(display)}
    </span>
  );
}
