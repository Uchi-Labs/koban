export const sourcePreviewTitleMaxLength = 180;
export const sourcePreviewSummaryMaxLength = 280;

export function compactSourcePreviewText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  const slice = compacted.slice(0, Math.max(0, maxLength - 3));
  const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf(","));
  const trimmed = lastBreak >= Math.floor(maxLength * 0.6) ? slice.slice(0, lastBreak) : slice;

  return `${trimmed.trimEnd()}...`;
}

export function compactSourcePreviewTitle(value: string): string {
  return compactSourcePreviewText(value, sourcePreviewTitleMaxLength);
}

export function compactSourcePreviewSummary(value: string): string {
  return compactSourcePreviewText(value, sourcePreviewSummaryMaxLength);
}
