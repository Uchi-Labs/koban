"use client";

// Live "we're listening" waveform for voice capture.
// Adapted from Amicro's `siri-wave` / `waveform-loader` recipes
// (https://amicro.vercel.app) to this app's conventions: motion/react + LazyMotion
// instead of bare framer-motion, `currentColor` instead of hardcoded zinc, and a
// prefers-reduced-motion branch (house rule: every animation gets one).

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { EASE_IN_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface VoiceWaveformProps {
  /** Bar count. 5 reads as "Siri"; 8+ reads as a recorder meter. */
  bars?: number;
  className?: string;
  /** Peak bar height in px. */
  height?: number;
  label?: string;
}

// Deterministic per-bar phase. Amicro used `Math.sin(i) * 0.5`, which yields
// negative delays for some i (Motion clamps those to 0, collapsing bars into
// lockstep). Normalising to [0, 1) keeps the travelling-wave read intact.
function barDelay(index: number, bars: number): number {
  return ((Math.sin(index * 1.7) + 1) / 2) * (bars > 6 ? 0.45 : 0.32);
}

export function VoiceWaveform({ bars = 7, className, height = 18, label = "Listening" }: VoiceWaveformProps) {
  const reduce = useReducedMotion() ?? false;
  const min = Math.max(2, Math.round(height * 0.18));

  return (
    <LazyMotion features={domAnimation}>
      <span
        aria-label={label}
        className={cn("inline-flex items-center gap-[3px] text-current", className)}
        role="status"
        style={{ height }}
      >
        {Array.from({ length: bars }).map((_, index) => (
          <m.span
            animate={reduce ? { height: min * 2, opacity: [1, 0.45, 1] } : { height: [min, height, min] }}
            className="w-[3px] rounded-full bg-current"
            key={index}
            style={{ height: min }}
            transition={
              reduce
                ? { duration: 1.6, ease: EASE_IN_OUT, repeat: Infinity }
                : {
                    delay: barDelay(index, bars),
                    duration: 1.1,
                    ease: EASE_IN_OUT,
                    repeat: Infinity
                  }
            }
          />
        ))}
        <span className="sr-only">{label}</span>
      </span>
    </LazyMotion>
  );
}
