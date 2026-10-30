import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAuthSession, DisabledError, extractUnverifiedClaims } from "chatgpt-oauth";
import type { AuthSession, CredentialStore, PendingLogin, Session, TokenSet } from "chatgpt-oauth";
import { createChatGPT } from "chatgpt-oauth/ai-sdk";
import type { LanguageModel } from "ai";
import { readWorkspaceEnv, type WorkspaceEnv } from "@/lib/workspace-env";

type FetchLike = typeof fetch;

/**
 * Legacy on-disk token shape that predates the `chatgpt-oauth` package. Still the
 * wire format for `CHATGPT_OAUTH_TOKENS_B64` env seeding, the `~/.codex/auth.json`
 * import, and any credential rows written before this migration. Read paths
 * upgrade it to the package's `TokenSet` transparently.
 */
export interface ChatGptOAuthTokens {
  access: string;
  refresh: string;
  expiry: number;
}

// The single-user identity for this local app. Passed explicitly to every
// credential operation and never taken from a request body, query, or header —
// a multi-user deployment derives its subject from a trusted session here.
export const chatgptSubject = "default";

const chatGptOAuthClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
export const chatGptOAuthTokenUrl = "https://auth.openai.com/oauth/token";
export const chatGptCodexBaseUrl = "https://chatgpt.com/backend-api/codex";
// The Codex backend requires a client_version query param on its endpoints and
// rejects requests without it (HTTP 400). Tracks the Codex CLI's version. The
// package's transport does not add it, so it is appended in the fetch wrapper.
export const codexClientVersion = "0.144.6";
export const chatGptOAuthTokensEnvKey = "CHATGPT_OAUTH_TOKENS_B64";
export const chatGptOAuthTokensStateKey = "chatgpt_oauth_tokens_v1";
export const chatGptOAuthPendingCookie = "ai_finances_chatgpt_oauth";

const pendingStateTtlMs = 10 * 60 * 1000;
const chatGptOAuthEnvSeededStateKey = "chatgpt_oauth_tokens_env_seeded_v1";
const chatGptOAuthCodexSeededStateKey = "chatgpt_oauth_tokens_codex_seeded_v1";

export function isChatGptOAuthEnabled(env: WorkspaceEnv = readWorkspaceEnv()): boolean {
  return env.AI_FINANCES_ENABLE_CHATGPT_OAUTH === "1";
}

// ---------------------------------------------------------------------------
// CredentialStore adapter over the existing sync_state table
// ---------------------------------------------------------------------------

function stateKeyFor(subject: string): string {
  // The default subject keeps the legacy key so credentials stored before this
  // migration are not orphaned; other subjects get a namespaced key.
  return subject === chatgptSubject ? chatGptOAuthTokensStateKey : `${chatGptOAuthTokensStateKey}:${subject}`;
}

function legacyToTokenSet(legacy: ChatGptOAuthTokens, version: number): TokenSet {
  // Unverified routing/display claims decoded from the access token, matching
  // what the package derives on login/refresh so the account-id header is
  // present even before the first refresh.
  const claims = extractUnverifiedClaims(undefined, legacy.access);
  return {
    accessToken: legacy.access,
    refreshToken: legacy.refresh,
    expiresAt: legacy.expiry,
    version,
    ...claims
  };
}

function decodeTokenSet(raw: string | undefined): TokenSet | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Record<string, unknown>;

    if (
      typeof parsed.accessToken === "string" &&
      typeof parsed.refreshToken === "string" &&
      typeof parsed.expiresAt === "number" &&
      typeof parsed.version === "number"
    ) {
      return parsed as unknown as TokenSet;
    }

    const legacy = parseChatGptOAuthTokens(raw);

    if (legacy) {
      return legacyToTokenSet(legacy, 0);
    }
  } catch {
    return null;
  }

  return null;
}

function encodeTokenSet(token: TokenSet): string {
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64");
}

/**
 * A `CredentialStore` backed by the app's sync_state table. `compareAndSwap`
 * uses the table's serialized row lock (`withLockedSyncStateValue`) so the
 * version check and the write are one atomic transaction. At-rest encoding is
 * base64 JSON, matching the pre-migration behavior (no downgrade).
 */
export function createChatGptCredentialStore(): CredentialStore {
  return {
    async load(subject: string): Promise<TokenSet | null> {
      const { readSyncStateValue } = await import("@/lib/db/finance-db");
      return decodeTokenSet(await readSyncStateValue(stateKeyFor(subject)));
    },

    async compareAndSwap(subject: string, expectedVersion: number, next: TokenSet) {
      const { withLockedSyncStateValue } = await import("@/lib/db/finance-db");
      return withLockedSyncStateValue<{ ok: boolean; current: TokenSet | null }>(
        stateKeyFor(subject),
        async (raw) => {
          const current = decodeTokenSet(raw);
          const currentVersion = current?.version ?? 0;

          if (currentVersion !== expectedVersion) {
            // Someone else won the race: keep the stored value untouched.
            return { result: { ok: false, current }, value: raw ?? "" };
          }

          return { result: { ok: true, current: next }, value: encodeTokenSet(next) };
        }
      );
    },

    async delete(subject: string): Promise<void> {
      const { deleteSyncStateValue } = await import("@/lib/db/finance-db");
      await deleteSyncStateValue(stateKeyFor(subject));
    }
  };
}

// One store instance and one auth session per process: the package keys its
// refresh singleflight by store identity, so these must be module singletons.
export const chatgptCredentialStore = createChatGptCredentialStore();
export const chatgptAuth: AuthSession = createAuthSession({
  store: chatgptCredentialStore,
  disabled: () => !isChatGptOAuthEnabled(readWorkspaceEnv())
});

// ---------------------------------------------------------------------------
// Env / Codex CLI seeding, ported to write through the CredentialStore
// ---------------------------------------------------------------------------

/**
 * Reuse an existing Codex CLI session (`$CODEX_HOME/auth.json`, default
 * `~/.codex/auth.json`) so a local dev instance can ride the same ChatGPT
 * subscription without a second sign-in. Absent in hosted deployments, so a
 * silent no-op there.
 */
export function readCodexHomeTokens(): ChatGptOAuthTokens | undefined {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");

  try {
    const parsed = JSON.parse(readFileSync(join(home, "auth.json"), "utf8")) as {
      tokens?: { access_token?: unknown; refresh_token?: unknown };
    };
    const access = parsed.tokens?.access_token;
    const refresh = parsed.tokens?.refresh_token;

    if (typeof access !== "string" || access.length === 0 || typeof refresh !== "string" || refresh.length === 0) {
      return undefined;
    }

    // 0 expiry when the JWT has no `exp` → treated as already expired, forcing a
    // refresh on first use.
    return { access, expiry: jwtExpiryMs(access) ?? 0, refresh };
  } catch {
    return undefined;
  }
}

async function seedTokensThroughStore(tokens: ChatGptOAuthTokens): Promise<void> {
  const current = await chatgptCredentialStore.load(chatgptSubject);
  const expectedVersion = current?.version ?? 0;
  await chatgptCredentialStore.compareAndSwap(
    chatgptSubject,
    expectedVersion,
    legacyToTokenSet(tokens, expectedVersion + 1)
  );
}

async function seedChatGptCredentialsIfNeeded(env: WorkspaceEnv): Promise<void> {
  const { readSyncStateValue, writeSyncStateValue } = await import("@/lib/db/finance-db");

  // Seed once from CHATGPT_OAUTH_TOKENS_B64, then from an existing Codex CLI
  // session. After either seed the store owns + refreshes the tokens; each
  // source is imported at most once (guarded by a sentinel), so a manual
  // disconnect is not silently undone.
  const envTokens = parseChatGptOAuthTokens(env[chatGptOAuthTokensEnvKey]);

  if (envTokens && !(await readSyncStateValue(chatGptOAuthEnvSeededStateKey))) {
    await seedTokensThroughStore(envTokens);
    await writeSyncStateValue(chatGptOAuthEnvSeededStateKey, new Date().toISOString());
    return;
  }

  const codexTokens = readCodexHomeTokens();

  if (codexTokens && !(await readSyncStateValue(chatGptOAuthCodexSeededStateKey))) {
    await seedTokensThroughStore(codexTokens);
    await writeSyncStateValue(chatGptOAuthCodexSeededStateKey, new Date().toISOString());
  }
}

/**
 * `status` throws DisabledError once the kill switch is on, where it used to
 * return normally. "Is ChatGPT connected" is asked from the settings page on
 * every install, including the ones that never enabled it, and the answer there
 * is no rather than a raised error.
 */
async function readStoredSession(): Promise<Session | null> {
  try {
    return await chatgptAuth.status(chatgptSubject);
  } catch (error) {
    if (error instanceof DisabledError) {
      return null;
    }

    throw error;
  }
}

/** The stored session for the default subject, seeding from env/codex on first read. */
export async function getStoredChatGptOAuthSession(env: WorkspaceEnv = readWorkspaceEnv()): Promise<Session | null> {
  const existing = await readStoredSession();

  if (existing || !isChatGptOAuthEnabled()) {
    return existing;
  }

  await seedChatGptCredentialsIfNeeded(env);
  return readStoredSession();
}

export async function chatGptOAuthStatus(env: WorkspaceEnv = readWorkspaceEnv()): Promise<{
  connected: boolean;
  enabled: boolean;
  expiresAt?: string;
}> {
  const session = await getStoredChatGptOAuthSession(env);

  return {
    connected: session !== null,
    enabled: isChatGptOAuthEnabled(env),
    expiresAt: session ? new Date(session.expiresAt).toISOString() : undefined
  };
}

export async function clearChatGptOAuthTokens(): Promise<void> {
  await chatgptAuth.logout(chatgptSubject);
}

// ---------------------------------------------------------------------------
// AI SDK model factory (subscription transport lives entirely in the package)
// ---------------------------------------------------------------------------

/** Appends the Codex `client_version` query param the backend requires. */
function withClientVersion(base: FetchLike): FetchLike {
  return (input, init) => {
    let target: typeof input = input;

    try {
      if (typeof input === "string" || input instanceof URL) {
        const url = new URL(input.toString());

        if (!url.searchParams.has("client_version")) {
          url.searchParams.set("client_version", codexClientVersion);
        }

        target = url.toString();
      }
    } catch {
      // Non-URL inputs (a Request object) pass through untouched.
    }

    return base(target, init);
  };
}

/**
 * Builds an ordinary AI SDK language model that authenticates as the connected
 * ChatGPT subscription. The package owns refresh, the account-id header, the
 * streaming `store:false` rewrite, and the single 401 retry.
 */
export function createChatGptLanguageModel(model: string, fetcher?: FetchLike): LanguageModel {
  const chatgpt = createChatGPT(chatgptAuth, chatgptSubject, { fetch: withClientVersion(fetcher ?? fetch) });
  return chatgpt(model) as unknown as LanguageModel;
}

// ---------------------------------------------------------------------------
// Legacy token codec (still used for env seeding + status detection)
// ---------------------------------------------------------------------------

export function encodeChatGptOAuthTokens(tokens: ChatGptOAuthTokens): string {
  return Buffer.from(JSON.stringify(tokens), "utf8").toString("base64");
}

export function parseChatGptOAuthTokens(value: string | undefined): ChatGptOAuthTokens | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Partial<ChatGptOAuthTokens>;

    if (
      typeof parsed.access === "string" &&
      parsed.access.length > 0 &&
      typeof parsed.refresh === "string" &&
      parsed.refresh.length > 0 &&
      typeof parsed.expiry === "number" &&
      Number.isFinite(parsed.expiry)
    ) {
      return {
        access: parsed.access,
        expiry: parsed.expiry,
        refresh: parsed.refresh
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Pending-login cookie custody (state/verifier pair between redirect + callback)
// ---------------------------------------------------------------------------

interface ChatGptOAuthPendingCookie {
  pending: PendingLogin;
  createdAt: number;
}

export function encodeChatGptOAuthPendingLogin(pending: PendingLogin): string {
  const payload: ChatGptOAuthPendingCookie = { pending, createdAt: Date.now() };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function parseChatGptOAuthPendingLogin(value: string | undefined): ChatGptOAuthPendingCookie | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ChatGptOAuthPendingCookie>;
    const pending = parsed.pending;

    if (
      pending &&
      typeof pending.url === "string" &&
      typeof pending.state === "string" &&
      typeof pending.verifier === "string" &&
      typeof pending.redirectUri === "string" &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt)
    ) {
      return { pending: pending as PendingLogin, createdAt: parsed.createdAt };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function isChatGptOAuthPendingLoginExpired(createdAt: number, now = Date.now()): boolean {
  return createdAt + pendingStateTtlMs < now;
}

function jwtExpiryMs(jwt: string): number | undefined {
  const [, payload] = jwt.split(".");

  if (!payload) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof parsed.exp === "number" && Number.isFinite(parsed.exp) ? parsed.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
