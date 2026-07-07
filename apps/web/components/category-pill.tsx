import type { Category } from "@ai-finances/schema";
import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function CategoryPill({ category, className }: { category: Category; className?: string }) {
  return (
    <Badge
      className={cn("border-transparent font-medium", className)}
      style={{
        backgroundColor: `color-mix(in oklab, ${category.color} 12%, transparent)`,
        color: `color-mix(in oklab, ${category.color} 72%, var(--foreground))`
      }}
      variant="outline"
    >
      <span aria-hidden="true">{category.emoji ?? "🏷️"}</span>
      {category.name}
    </Badge>
  );
}
