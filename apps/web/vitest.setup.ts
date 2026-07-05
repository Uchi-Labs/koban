import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

const localAiEnvKeys = [
  "AI_FINANCES_LLM_API_KEY",
  "AI_FINANCES_LLM_BASE_URL",
  "AI_FINANCES_LLM_MODEL",
  "AI_FINANCES_LLM_PROVIDER",
  "AI_FINANCES_LLM_REASONING_MODEL",
  "AI_FINANCES_LLM_SIMPLE_MODEL",
  "AI_FINANCES_LLM_TIMEOUT_MS",
  "AI_FINANCES_ENABLE_CHATGPT_OAUTH",
  "CHATGPT_OAUTH_TOKENS_B64",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "VOYAGE_EMBEDDING_MODEL"
];

function clearLocalAiEnv() {
  for (const key of localAiEnvKeys) {
    delete process.env[key];
  }

  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
}

clearLocalAiEnv();

afterEach(() => {
  clearLocalAiEnv();
});
