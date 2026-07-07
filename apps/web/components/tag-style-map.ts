import type { TagStyle } from "@ai-finances/schema";

export function tagStyleMap(styles: TagStyle[]): Map<string, TagStyle> {
  return new Map(styles.map((style) => [style.name.toLowerCase(), style]));
}
