import type React from "react";
import { cn } from "@/lib/utils";

/** Shared low-alpha gain/loss treatment using the app's money-semantic tokens. */
export function GainLossPill({
  children,
  className,
  positive
}: {
  children: React.ReactNode;
  className?: string;
  positive: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-medium tabular-nums",
        positive ? "bg-(--positive)/10 text-(--positive)" : "bg-(--negative)/10 text-(--negative)",
        className
      )}
    >
      {children}
    </span>
  );
}
