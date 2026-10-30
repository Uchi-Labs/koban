// Same bar the ledger uses to trust a suggested evidence link
// (`l.confidence >= 0.74` in lib/db/finance-db.ts).
export const reviewConfidentThreshold = 0.74;

export type ReviewConfidence =
  | { kind: "confident" }
  | { kind: "low"; score: number }
  | { kind: "no_suggestion" };

/**
 * How sure the model was about a review card's category.
 *
 * A card with no pending category suggestion is treated as unsure: nothing
 * backs its category but the provider's raw label. A suggestion whose
 * confidence is unknown is not flagged, since flagging it would be a guess.
 */
export function reviewConfidenceFor(suggestion: { categoryId?: string; confidence?: number } | undefined): ReviewConfidence {
  if (!suggestion?.categoryId) return { kind: "no_suggestion" };
  if (suggestion.confidence !== undefined && suggestion.confidence < reviewConfidentThreshold) {
    return { kind: "low", score: suggestion.confidence };
  }
  return { kind: "confident" };
}

export function isUnsure(confidence: ReviewConfidence): boolean {
  return confidence.kind !== "confident";
}
