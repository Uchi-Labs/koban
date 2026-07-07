import { X } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";

export function TagChip({
  className,
  color,
  onRemove,
  tag
}: {
  className?: string;
  color?: string;
  onRemove?: () => void;
  tag: string;
}) {
  const style = color
    ? {
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
        borderColor: `color-mix(in oklab, ${color} 34%, var(--border))`,
        color: `color-mix(in oklab, ${color} 76%, var(--foreground))`
      }
    : undefined;
  const classes = cn(
    "inline-flex h-6 items-center gap-1 rounded-2xl border border-border px-2 text-xs text-foreground transition-colors",
    onRemove ? "hover:bg-muted" : "bg-secondary text-secondary-foreground",
    className
  );

  if (!onRemove) {
    return (
      <span className={classes} style={style}>
        {tag}
      </span>
    );
  }

  return (
    <button aria-label={`Remove tag ${tag}`} className={classes} onClick={onRemove} style={style} type="button">
      {tag}
      <X className="size-3 text-current opacity-70" />
    </button>
  );
}
