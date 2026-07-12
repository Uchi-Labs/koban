"use client";

import { motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type PointerEvent, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

// Slider tracking needs a critically damped local spring so thumbs follow
// pointer input without overshooting a financial bound.
const SPRING_GLIDE = { stiffness: 700, damping: 50, mass: 0.5 } as const;
// The grab spring affects only thumb scale and provides tactile drag feedback.
const SPRING_BOUNCY = { type: "spring", stiffness: 500, damping: 18, mass: 0.7 } as const;

export type RangeValue = readonly [number, number];

export interface RangeSliderProps {
  value?: RangeValue;
  defaultValue?: RangeValue;
  onValueChange?: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  showTicks?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function RangeSlider({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  showTicks = false,
  disabled = false,
  className,
  "aria-label": ariaLabel = "Range"
}: RangeSliderProps) {
  const reduce = useReducedMotion();
  const [internal, setInternal] = useState<[number, number]>(() => [
    defaultValue?.[0] ?? min,
    defaultValue?.[1] ?? max
  ]);
  const [activeThumb, setActiveThumb] = useState<0 | 1 | null>(null);
  const controlled = value !== undefined;
  const source = controlled ? value : internal;
  const low = clamp(Math.min(source[0], source[1]), min, max);
  const high = clamp(Math.max(source[0], source[1]), min, max);
  const span = Math.max(max - min, 1);
  const lowPercent = ((low - min) / span) * 100;
  const highPercent = ((high - min) / span) * 100;

  const commit = useCallback((index: 0 | 1, rawValue: number) => {
    const snapped = clamp(Math.round((rawValue - min) / step) * step + min, min, max);
    const next: [number, number] = index === 0
      ? [Math.min(snapped, high), high]
      : [low, Math.max(snapped, low)];

    if (!controlled) {
      setInternal(next);
    }
    onValueChange?.(next);
  }, [controlled, high, low, max, min, onValueChange, step]);

  const valueFromPointer = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    return min + ratio * span;
  }, [min, span]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const explicitThumb = (event.target as HTMLElement).closest<HTMLElement>("[data-thumb-index]")?.dataset.thumbIndex;
    const pointerValue = valueFromPointer(event);
    const index: 0 | 1 = explicitThumb === "0" || explicitThumb === "1"
      ? Number(explicitThumb) as 0 | 1
      : Math.abs(pointerValue - low) <= Math.abs(pointerValue - high) ? 0 : 1;
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveThumb(index);
    commit(index, pointerValue);
  }, [commit, disabled, high, low, valueFromPointer]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (activeThumb === null || disabled) {
      return;
    }
    commit(activeThumb, valueFromPointer(event));
  }, [activeThumb, commit, disabled, valueFromPointer]);

  const endPointer = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setActiveThumb(null);
  }, []);

  const handleKeyDown = useCallback((index: 0 | 1, current: number, event: KeyboardEvent<HTMLDivElement>) => {
    const keyValues: Record<string, number> = {
      ArrowDown: current - step,
      ArrowLeft: current - step,
      ArrowRight: current + step,
      ArrowUp: current + step,
      End: max,
      Home: min
    };
    if (event.key in keyValues) {
      event.preventDefault();
      commit(index, keyValues[event.key]);
    }
  }, [commit, max, min, step]);

  const tickCount = Math.floor(span / step);
  const ticks = showTicks && tickCount > 0 && tickCount <= 50
    ? Array.from({ length: tickCount + 1 }, (_, index) => min + index * step)
    : [];
  const glideTransition = reduce ? { duration: 0 } : { type: "spring" as const, ...SPRING_GLIDE };
  const rangeScale = Math.max(0, (highPercent - lowPercent) / 100);

  return (
    <div
      className={cn(
        "relative flex h-8 w-full touch-none select-none items-center rounded-xl bg-muted/70",
        disabled ? "pointer-events-none opacity-50" : "cursor-grab active:cursor-grabbing",
        className
      )}
      onPointerCancel={endPointer}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-full"
        animate={{ x: `${lowPercent}%` }}
        transition={glideTransition}
      >
        <motion.div
          className="h-full origin-left rounded-xl bg-primary/15"
          animate={{ scaleX: rangeScale }}
          transition={glideTransition}
        />
      </motion.div>
      {ticks.map((tick) => (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/20"
          key={tick}
          style={{ left: `${((tick - min) / span) * 100}%` }}
        />
      ))}
      {([low, high] as const).map((current, index) => {
        const percent = ((current - min) / span) * 100;
        const thumbIndex = index as 0 | 1;
        return (
          <motion.div
            animate={{ x: `${percent}%` }}
            className="pointer-events-none absolute inset-y-0 left-0 w-full"
            key={index}
            transition={glideTransition}
          >
            <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2">
              <motion.div
                animate={{ scaleY: activeThumb === thumbIndex ? 1.35 : 1 }}
                aria-disabled={disabled || undefined}
                aria-label={`${index === 0 ? "Minimum" : "Maximum"} ${ariaLabel}`}
                aria-valuemax={max}
                aria-valuemin={min}
                aria-valuenow={current}
                className="pointer-events-auto h-5 w-1.5 rounded-sm bg-foreground shadow-sm outline-none ring-foreground/30 focus-visible:ring-4"
                data-thumb-index={index}
                onKeyDown={(event) => handleKeyDown(thumbIndex, current, event)}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                transition={reduce ? { duration: 0 } : SPRING_BOUNCY}
              />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
