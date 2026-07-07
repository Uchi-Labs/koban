const questionStarters = /^(?:who|what|when|where|why|how|which|show|list|find|is|are|do|does|can)\b/i;

export function looksLikeQuestion(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length < 8) {
    return false;
  }

  return trimmed.endsWith("?") || trimmed.split(/\s+/).length >= 4 || questionStarters.test(trimmed);
}
