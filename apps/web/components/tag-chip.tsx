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
  const classes = cn(
    "inline-flex h-6 items-center gap-1 rounded-2xl border border-border px-2 text-xs text-foreground transition-colors",
    onRemove ? "bg-secondary hover:bg-muted" : "bg-secondary",
    className
  );
  const dot = (
    <span
      aria-hidden="true"
      className="size-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
    />
  );

  if (!onRemove) {
    return (
      <span className={classes}>
        {dot}
        {tag}
      </span>
    );
  }

  return (
    <button aria-label={`Remove tag ${tag}`} className={classes} onClick={onRemove} type="button">
      {dot}
      {tag}
      <X className="size-3 text-current opacity-70" />
    </button>
  );
}
