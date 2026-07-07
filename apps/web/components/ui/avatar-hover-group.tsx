"use client";

import { useRef, type ReactNode } from "react";
import { applyAvatarGroupShift, useHoverCapable } from "@/lib/transitions";
import { cn } from "@/lib/utils";

export function AvatarHoverGroup({ children, className }: { children: ReactNode; className?: string }) {
  const hoverCapable = useHoverCapable();
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn("t-avatar-group", className)}
      onMouseLeave={hoverCapable ? () => applyAvatarGroupShift(ref.current, null, "out") : undefined}
      ref={ref}
    >
      {children}
    </div>
  );
}
