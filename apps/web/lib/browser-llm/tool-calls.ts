// LFM3's chat template writes a tool call as
//   <tool_call>
//   <function=search_transactions>
//   <parameter=merchant>
//   Netflix
//   </parameter>
//   </function>
//   </tool_call>
// after the reasoning block. None of these tags are special tokens, so they
// survive decoding with special tokens skipped, and the model can also write a
// JSON object ({"name", "arguments"}) inside the same tags.

export interface BrowserToolDefinition {
  description: string;
  name: string;
  parameters: unknown;
}

export interface ParsedToolCall {
  arguments: Record<string, unknown>;
  name: string;
}

export interface ParsedModelOutput {
  /** The reply text, with reasoning and tool-call blocks taken out. */
  content: string;
  thinking: string;
  toolCalls: ParsedToolCall[];
}

const toolCallBlock = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
const functionTag = /<function=([^>\n]+)>([\s\S]*?)(?:<\/function>|$)/;
const parameterTag = /<parameter=([^>\n]+)>\n?([\s\S]*?)\n?<\/parameter>/g;

/**
 * Splits one generation into reasoning, reply and tool calls. The generation
 * prompt already opened `<think>`, so text before `</think>` is reasoning; a
 * generation that never closed it is all reasoning, with no reply.
 */
export function parseModelOutput(text: string, tools: BrowserToolDefinition[] = []): ParsedModelOutput {
  const body = text.replace(/^\s*<think>/, "");
  const end = body.indexOf("</think>");
  const thinking = end >= 0 ? body.slice(0, end).trim() : body.trim();
  const after = end >= 0 ? body.slice(end + "</think>".length) : "";
  const toolCalls: ParsedToolCall[] = [];

  for (const match of after.matchAll(toolCallBlock)) {
    const call = parseToolCallBody(match[1] ?? "", tools);
    if (call) toolCalls.push(call);
  }

  return {
    content: after.replace(toolCallBlock, "").replace(/<\/?think>/g, "").trim(),
    thinking,
    toolCalls
  };
}

function parseToolCallBody(body: string, tools: BrowserToolDefinition[]): ParsedToolCall | null {
  const xml = functionTag.exec(body);

  if (xml) {
    const name = xml[1].trim();
    const properties = schemaProperties(tools.find((tool) => tool.name === name)?.parameters);
    const args: Record<string, unknown> = {};

    for (const parameter of (xml[2] ?? "").matchAll(parameterTag)) {
      const key = parameter[1].trim();
      args[key] = coerceParameter(parameter[2] ?? "", properties[key]?.type);
    }

    return { arguments: args, name };
  }

  try {
    const json = JSON.parse(body.trim()) as { arguments?: unknown; name?: unknown; parameters?: unknown };
    const args = json.arguments ?? json.parameters ?? {};

    if (typeof json.name !== "string" || !json.name) return null;

    return {
      arguments: typeof args === "string" ? (JSON.parse(args) as Record<string, unknown>) : (args as Record<string, unknown>),
      name: json.name
    };
  } catch {
    return null;
  }
}

function schemaProperties(schema: unknown): Record<string, { type?: unknown }> {
  if (!schema || typeof schema !== "object") return {};
  const properties = (schema as { properties?: unknown }).properties;
  return properties && typeof properties === "object" ? (properties as Record<string, { type?: unknown }>) : {};
}

// The template writes strings raw and everything else as JSON, so only a
// parameter the schema types as non-string is parsed.
function coerceParameter(raw: string, type: unknown): unknown {
  if (type === "string" || type === undefined) {
    return type === "string" ? raw : parseJsonOr(raw, raw);
  }

  return parseJsonOr(raw.trim(), raw);
}

function parseJsonOr(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
