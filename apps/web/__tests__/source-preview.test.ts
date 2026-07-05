import { describe, expect, it } from "vitest";
import {
  compactSourcePreviewSummary,
  compactSourcePreviewText,
  compactSourcePreviewTitle,
  sourcePreviewSummaryMaxLength,
  sourcePreviewTitleMaxLength
} from "@/lib/source-preview";

describe("source preview text", () => {
  it("keeps short source text unchanged except whitespace compaction", () => {
    expect(compactSourcePreviewText("  Amazon   order\nreceipt  ", 80)).toBe("Amazon order receipt");
  });

  it("trims long source titles and summaries for Settings preview payloads", () => {
    const longTitle = Array.from({ length: 40 }, (_, index) => `Item ${index + 1}`).join(", ");
    const longSummary = Array.from({ length: 120 }, (_, index) => `summary-token-${index + 1}`).join(" ");

    expect(compactSourcePreviewTitle(longTitle).length).toBeLessThanOrEqual(sourcePreviewTitleMaxLength);
    expect(compactSourcePreviewTitle(longTitle)).toMatch(/\.\.\.$/);
    expect(compactSourcePreviewSummary(longSummary).length).toBeLessThanOrEqual(sourcePreviewSummaryMaxLength);
    expect(compactSourcePreviewSummary(longSummary)).toMatch(/\.\.\.$/);
  });
});
