import type { AgentConversationTurn } from "@ai-finances/schema";
import type { LlmGenerationClient } from "@/lib/ai/provider";
import {
  callConfiguredLlmText,
  type LlmJsonCompletionResult
} from "@/lib/llm-enrichment";
import type { WorkspaceEnv } from "@/lib/workspace-env";

export interface GeneratedAgentConversationTitle {
  autoTitled: boolean;
  title: string;
}

interface GenerateAgentConversationTitleOptions {
  client?: LlmGenerationClient;
  env?: WorkspaceEnv;
  generateText?: typeof callConfiguredLlmText;
}

export async function generateAgentConversationTitle(
  turns: AgentConversationTurn[],
  options: GenerateAgentConversationTitleOptions = {}
): Promise<GeneratedAgentConversationTitle> {
  const firstUserTurn = turns.find((turn) => turn.role === "user");
  const firstAssistantTurn = turns.find((turn) => turn.role === "assistant");
  const fallback = fallbackAgentConversationTitle(firstUserTurn?.content);

  if (!firstUserTurn || !firstAssistantTurn) {
    return { autoTitled: false, title: fallback };
  }

  try {
    const generateText = options.generateText ?? callConfiguredLlmText;
    const result: LlmJsonCompletionResult = await generateText({
      client: options.client,
      env: options.env,
      maxTokens: 24,
      messages: [
        {
          role: "system",
          content: "Create a specific chat title using at most four words. Return only the title in Title Case."
        },
        {
          role: "user",
          content: [
            "First user message:",
            firstUserTurn.content,
            "",
            "First assistant response:",
            firstAssistantTurn.content
          ].join("\n")
        }
      ],
      modelUseCase: "simple"
    });

    if (!result.completed || !result.content) {
      return { autoTitled: false, title: fallback };
    }

    const title = normalizeGeneratedTitle(result.content);
    return title
      ? { autoTitled: true, title }
      : { autoTitled: false, title: fallback };
  } catch {
    return { autoTitled: false, title: fallback };
  }
}

export function fallbackAgentConversationTitle(question: string | undefined): string {
  const normalized = question?.trim().replace(/\s+/g, " ") ?? "";
  return normalized.slice(0, 32).trim() || "New chat";
}

export function normalizeGeneratedTitle(value: string): string {
  const words = value
    .replace(/[`"“”]/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’\-]+$/gu, ""))
    .filter(Boolean)
    .slice(0, 4)
    .map(titleCaseWord);

  return words.join(" ");
}

function titleCaseWord(word: string): string {
  return word
    .toLocaleLowerCase()
    .replace(/(^|[-'’])(\p{L})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`);
}
