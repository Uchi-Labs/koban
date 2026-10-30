// Visuals the finance agent draws inline in a chat, modeled on T3 Code's
// html_render tool: the model hands over one self-contained HTML page and the
// client shows it in a sandboxed frame above the reply. The page gets Koban's
// theme tokens as CSS variables, has no network access, and is saved with the
// turn so a reopened chat shows it again.

export const showVisualToolName = "show_visual";
export const agentVisualMaxHtmlLength = 60_000;
export const agentVisualMaxTitleLength = 120;
export const agentVisualMaxPerAnswer = 3;

export interface AgentVisual {
  html: string;
  id: string;
  title: string;
}

export const showVisualToolDescription = [
  "Show a chart, table, or diagram inline in the chat, above your reply.",
  "Pass one complete, self-contained HTML page: inline <style> and <script> only, inline SVG or HTML/CSS for marks.",
  "The page cannot load anything from the network, so no CDNs, web fonts, or images by URL.",
  "Frame width is the chat column (about 400px, less on phones). Leave html and body without background, border, padding, or an outer card; give charts a fixed pixel height and let content set the page height. Never use vh units.",
  "Colors come from CSS variables: --background, --foreground, --muted, --muted-foreground, --card, --border, --primary, --positive (money in), --negative (money out), --chart-1 to --chart-5, --radius, --font-sans.",
  "Label axes and values with real numbers from the ledger payload, formatted as currency where they are money. Use tabular numbers.",
  "Text matches the chat: 14px for labels and values, 13px at the smallest (axis ticks), 15px for a title. Never smaller than 13px."
].join(" ");

export const showVisualInstruction =
  "Answer any trend, comparison, or breakdown with a chart, and show any visual the user asks for: call show_visual first with a chart or table built only from numbers in the payload, then write the reply. Do not describe or restate the visual in the reply.";

export function normalizeAgentVisual(input: unknown, id: string): AgentVisual | null {
  if (!input || typeof input !== "object") return null;
  const { html, title } = input as { html?: unknown; title?: unknown };
  if (typeof html !== "string" || !html.trim() || html.length > agentVisualMaxHtmlLength) return null;
  const cleanTitle = typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, agentVisualMaxTitleLength) : "";
  return { html, id, title: cleanTitle || "Chart" };
}

export function readAgentVisuals(value: unknown): AgentVisual[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) =>
      normalizeAgentVisual(item, typeof (item as { id?: unknown })?.id === "string" ? (item as { id: string }).id : `visual_${index}`)
    )
    .filter((visual): visual is AgentVisual => visual !== null)
    .slice(0, agentVisualMaxPerAnswer);
}
