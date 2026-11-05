import type { Category } from "@ai-finances/schema";
import { ArrowDownLeft, Car, Circle, Home, Laptop, Plane, Repeat2, ShoppingBag, Utensils } from "lucide-react";
import type { CSSProperties, ComponentType } from "react";
import { isValidCssColor, neutralCategoryColor } from "@/lib/category-style";
import { cn } from "@/lib/utils";

const categoryIcons: Record<string, ComponentType<{ className?: string }>> = {
  "arrow-down-left": ArrowDownLeft,
  car: Car,
  circle: Circle,
  home: Home,
  laptop: Laptop,
  plane: Plane,
  repeat: Repeat2,
  "shopping-bag": ShoppingBag,
  utensils: Utensils
};

type PillStyle = CSSProperties & { "--pill-color": string };

export function CategoryPill({ category, className }: { category: Category; className?: string }) {
  const color = category.id === "cat_transfer"
    ? "var(--chart-1)"
    : isValidCssColor(category.color)
      ? category.color
      : neutralCategoryColor;
  const emoji = category.emoji?.trim();
  const CategoryIcon = categoryIcons[category.icon];

  return (
    <span
      className={cn(
        "pill-tint category-tag inline-flex h-[26px] min-w-0 items-center gap-1.5 rounded-[8px] border pl-[3px] pr-2.5 text-ui font-medium leading-none whitespace-nowrap",
        className
      )}
      data-transfer={category.id === "cat_transfer" ? "true" : undefined}
      style={{ "--pill-color": color } as PillStyle}
    >
      {/* Concentric radii: outer 8px = swatch 5px + 3px inset. Apple Color Emoji
          paints above the baseline at small sizes; nudge only the emoji case. */}
      <span
        aria-hidden="true"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] text-sm leading-none"
        data-emoji={emoji ? "" : undefined}
        data-swatch=""
      >
        <span className={cn("inline-flex items-center justify-center leading-none", emoji && "translate-y-px")}>
          {emoji ? emoji : CategoryIcon ? <CategoryIcon className="size-3.5" /> : category.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      </span>
      <span className="min-w-0 truncate leading-none">{category.name}</span>
    </span>
  );
}
