import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

class TestIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect() {}

  observe(target: Element) {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: Date.now(),
        },
      ],
      this
    );
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve() {}
}

globalThis.IntersectionObserver = TestIntersectionObserver;

// jsdom does not implement matchMedia; components that read pointer/motion media
// queries (e.g. swipeable-list's coarse-pointer detection) need a stub. Defaults
// to non-matching, which is the correct desktop/test baseline.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  });
}

const localAiEnvKeys = [
  "AI_FINANCES_LLM_API_KEY",
  "AI_FINANCES_LLM_BASE_URL",
  "AI_FINANCES_LLM_MODEL",
  "AI_FINANCES_LLM_PROVIDER",
  "AI_FINANCES_LLM_REASONING_MODEL",
  "AI_FINANCES_LLM_SIMPLE_MODEL",
  "AI_FINANCES_LLM_TIMEOUT_MS",
  "AI_FINANCES_ENABLE_CHATGPT_OAUTH",
  "MICROSOFT_SOURCE_CLIENT_ID",
  "MICROSOFT_SOURCE_CLIENT_SECRET",
  "MICROSOFT_SOURCE_TOKEN_ENCRYPTION_KEY",
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
