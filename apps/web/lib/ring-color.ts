import { oklchToHex, shadeColor } from "@/lib/bloom-color";
import { categoryColorPalette, neutralCategoryColor } from "@/lib/category-style";

export type RingName = "center" | "inner" | "outer";

export interface RingColorDot {
  color: string;
  hex: string;
  ring: RingName;
}

const outerDots: RingColorDot[] = categoryColorPalette.map((color) => ({
  color,
  hex: oklchToHex(color) ?? "#7c8794",
  ring: "outer"
}));

const innerDots: RingColorDot[] = [0, 1, 3, 4, 5, 7, 8, 9].map((outerIndex) => {
  const anchor = outerDots[outerIndex]?.hex ?? "#7c8794";
  const hex = shadeColor(anchor, 0.24);
  return { color: hex, hex, ring: "inner" };
});

const neutralHex = oklchToHex(neutralCategoryColor) ?? "#9ca3af";

/**
 * Stable color data for the picker. All persisted palette tokens stay direct
 * outer-ring anchors while selection emits their normalized hex equivalents.
 */
export const RING_COLOR_DOTS: readonly RingColorDot[] = [
  ...outerDots,
  ...innerDots,
  { color: neutralCategoryColor, hex: neutralHex, ring: "center" }
];

