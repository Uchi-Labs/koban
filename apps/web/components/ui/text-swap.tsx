"use client";

import { useTextSwapValue } from "@/lib/transitions";
import { cn } from "@/lib/utils";

export function TextSwap({ className, value }: { className?: string; value: string }) {
  const { displayValue, phaseClass, ref } = useTextSwapValue(value);

  return (
    <span className={cn("t-text-swap", phaseClass, className)} ref={ref}>
      {displayValue}
    </span>
  );
}
