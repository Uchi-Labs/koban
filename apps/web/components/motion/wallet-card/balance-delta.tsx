"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

/**
 * A transient change indicator for the balance: a tinted pill with a trend
 * arrow that pops in whenever the balance moves and persists until it moves
 * again.
 */
export function BalanceDelta({
  balance,
  initialChange,
}: {
  balance: number;
  initialChange?: number;
}) {
  const reduce = useReducedMotion();
  const prevRef = useRef(balance);
  const [delta, setDelta] = useState<{ id: number; amount: number } | null>(
    initialChange ? { id: 0, amount: initialChange } : null,
  );

  // Persist the last change until the balance moves again — don't auto-hide.
  useEffect(() => {
    const diff = balance - prevRef.current;
    prevRef.current = balance;
    if (diff === 0) return;
    setDelta({ id: Date.now(), amount: diff });
  }, [balance]);

  const up = (delta?.amount ?? 0) > 0;

  return (
    <div className="mt-2 flex h-7 items-center justify-center">
      <AnimatePresence mode="wait">
        {delta ? (
          <motion.span
            key={delta.id}
            initial={reduce ? false : { opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -6, scale: 0.9 }}
            transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
            className={cn(
              "pill-tint inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums",
            )}
            style={{ "--pill-color": up ? "var(--positive)" : "var(--negative)" } as CSSProperties}
          >
            {up ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {up ? "+" : "-"}$
            {Math.abs(delta.amount).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
