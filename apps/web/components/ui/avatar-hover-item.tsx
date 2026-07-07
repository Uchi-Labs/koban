"use client";

import type { ReactNode } from "react";
import { applyAvatarGroupShift, useHoverCapable } from "@/lib/transitions";
import { cn } from "@/lib/utils";

export function AvatarHoverItem({
  children,
  className,
  index
}: {
  children: ReactNode;
  className?: string;
  index: number;
}) {
  const hoverCapable = useHoverCapable();

  return (
    <div
      className={cn("t-avatar", className)}
      onMouseEnter={
        hoverCapable
          ? (event) => applyAvatarGroupShift(event.currentTarget.closest<HTMLElement>(".t-avatar-group"), index, "in")
          : undefined
      }
    >
      {children}
    </div>
  );
}
