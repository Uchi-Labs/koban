"use client";

import type { ComponentProps } from "react";
import { useModifierKeyLabel } from "@/lib/hooks/use-modifier-key";
import { cn } from "@/lib/utils";

export interface ShortcutHintProps extends Omit<ComponentProps<"kbd">, "children"> {
  /** The key pressed with the platform modifier, e.g. "K". */
  shortcutKey: string;
}

// "⌘K" on Apple platforms, "Ctrl K" elsewhere. Pass `aria-label` only when the
// hint itself must be announced; inside a labelled button it stays decorative.
export function ShortcutHint({ className, shortcutKey, ...props }: ShortcutHintProps) {
  const modifierKey = useModifierKeyLabel();
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-sans font-medium text-muted-foreground",
        modifierKey === "⌘" ? "gap-0.5" : "gap-1",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn("leading-none", modifierKey === "⌘" ? "text-2xs" : "text-3xs")}>
        {modifierKey}
      </span>
      <span className="text-3xs leading-none">{shortcutKey}</span>
    </kbd>
  );
}
