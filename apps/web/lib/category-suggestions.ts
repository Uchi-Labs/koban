import { z } from "zod";
import { aiSdkLlmClient } from "@/lib/ai/provider";
import { inferCategoryEmoji, neutralCategoryEmoji } from "@/lib/category-style";
import { getEffectiveLlmEnrichmentStatus } from "@/lib/enrichment-runs";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export interface CategorySuggestion {
  emoji: string;
  name: string;
}

export interface CategorySuggestionResult {
  completed: boolean;
  errorMessage?: string;
  providerConfigured: boolean;
  suggestions: CategorySuggestion[];
}

const categorySuggestionsSchema = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            emoji: z.string().min(1).max(16),
            name: z.string().min(1).max(80)
          })
          .strict()
      )
      .min(1)
      .max(3)
  })
  .strict();

const categoryEmojiSchema = z
  .object({
    emoji: z.string().min(1).max(16)
  })
  .strict();

export async function resolveCategoryEmoji(name: string, providedEmoji?: string): Promise<string> {
  const trimmedEmoji = providedEmoji?.trim();

  if (trimmedEmoji) {
    return trimmedEmoji.slice(0, 16);
  }

  const localEmoji = inferCategoryEmoji(name, neutralCategoryEmoji);

  if (localEmoji !== neutralCategoryEmoji) {
    return localEmoji;
  }

  const provider = await getEffectiveLlmEnrichmentStatus();

  if (!provider.configured || !provider.model || !provider.baseUrl) {
    return localEmoji;
  }

  try {
    const result = await aiSdkLlmClient.generateObject({
      env: readWorkspaceEnv(),
      maxOutputTokens: 80,
      messages: [
        {
          content: "Return one finance category emoji. Use common emoji only. Return JSON only.",
          role: "system"
        },
        {
          content: `Category name: ${name.trim().slice(0, 80)}`,
          role: "user"
        }
      ],
      provider,
      schema: categoryEmojiSchema,
      schemaName: "finance_category_emoji"
    });

    return result.object.emoji.trim().slice(0, 16) || localEmoji;
  } catch {
    return localEmoji;
  }
}

export async function suggestCategories({
  description,
  merchants
}: {
  description?: string;
  merchants?: string[];
}): Promise<CategorySuggestionResult> {
  const localSuggestions = localCategorySuggestions(description, merchants);
  const provider = await getEffectiveLlmEnrichmentStatus();

  if (!provider.configured || !provider.model || !provider.baseUrl) {
    return {
      completed: false,
      errorMessage: provider.errorMessage ?? "No AI provider is configured.",
      providerConfigured: false,
      suggestions: localSuggestions
    };
  }

  try {
    const result = await aiSdkLlmClient.generateObject({
      env: readWorkspaceEnv(),
      maxOutputTokens: 220,
      messages: [
        {
          content:
            "Suggest 1 to 3 concise personal-finance category names and matching emoji. Do not invent merchant facts. Return JSON only.",
          role: "system"
        },
        {
          content: JSON.stringify({
            description: description?.trim().slice(0, 400) ?? "",
            uncategorized_merchants: (merchants ?? []).slice(0, 12).map((merchant) => merchant.slice(0, 80))
          }),
          role: "user"
        }
      ],
      provider,
      schema: categorySuggestionsSchema,
      schemaName: "finance_category_suggestions"
    });

    return {
      completed: true,
      providerConfigured: true,
      suggestions: result.object.suggestions.map((suggestion) => ({
        emoji: suggestion.emoji.trim().slice(0, 16) || inferCategoryEmoji(suggestion.name),
        name: normalizeSuggestionName(suggestion.name)
      }))
    };
  } catch (error) {
    return {
      completed: false,
      errorMessage: error instanceof Error ? error.message : "AI category suggestion failed.",
      providerConfigured: true,
      suggestions: localSuggestions
    };
  }
}

function localCategorySuggestions(description?: string, merchants?: string[]): CategorySuggestion[] {
  const seeds = [description, ...(merchants ?? [])]
    .map((value) => normalizeSuggestionName(value ?? ""))
    .filter(Boolean);
  const name = seeds[0] || "Custom category";

  return [
    {
      emoji: inferCategoryEmoji(name, neutralCategoryEmoji),
      name
    }
  ];
}

function normalizeSuggestionName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 80);

  if (!normalized) {
    return "";
  }

  if (normalized.length <= 3) {
    return normalized.toUpperCase();
  }

  return normalized
    .split(" ")
    .map((word) => (word.length <= 3 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join(" ");
}
