import { createHash, randomBytes } from "node:crypto";
import {
  deleteWorkspaceEnv,
  readWorkspaceEnv,
  upsertWorkspaceEnv,
  type WorkspaceEnv
} from "@/lib/workspace-env";

type FetchLike = typeof fetch;

export interface ChatGptOAuthTokens {
  access: string;
  refresh: string;
  expiry: number;
}

export interface ChatGptOAuthPendingState {
  codeVerifier: string;
  createdAt: number;
  redirectUri: string;
  state: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
}

export const chatGptOAuthClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
export const chatGptOAuthAuthorizeUrl = "https://auth.openai.com/oauth/authorize";
export const chatGptOAuthTokenUrl = "https://auth.openai.com/oauth/token";
export const chatGptCodexBaseUrl = "https://chatgpt.com/backend-api/codex";
export const chatGptOAuthTokensEnvKey = "CHATGPT_OAUTH_TOKENS_B64";
export const chatGptOAuthPendingCookie = "ai_finances_chatgpt_oauth";

const pendingStateTtlMs = 10 * 60 * 1000;
const refreshWindowMs = 5 * 60 * 1000;
const fallbackExpiryMs = 15 * 60 * 1000;
const chatGptOAuthScope = "openid profile email offline_access api.connectors.read api.connectors.invoke";

export function isChatGptOAuthEnabled(env: WorkspaceEnv = readWorkspaceEnv()): boolean {
  return env.AI_FINANCES_ENABLE_CHATGPT_OAUTH === "1";
}

export function getStoredChatGptOAuthTokens(env: WorkspaceEnv = readWorkspaceEnv()): ChatGptOAuthTokens | undefined {
  return parseChatGptOAuthTokens(env[chatGptOAuthTokensEnvKey]);
}

export function hasStoredChatGptOAuthTokens(env: WorkspaceEnv = readWorkspaceEnv()): boolean {
  return getStoredChatGptOAuthTokens(env) !== undefined;
}

export function chatGptOAuthStatus(env: WorkspaceEnv = readWorkspaceEnv()): {
  connected: boolean;
  enabled: boolean;
  expiresAt?: string;
} {
  const tokens = getStoredChatGptOAuthTokens(env);

  return {
    connected: tokens !== undefined,
    enabled: isChatGptOAuthEnabled(env),
    expiresAt: tokens ? new Date(tokens.expiry).toISOString() : undefined
  };
}

export function createChatGptOAuthStart(redirectUri: string): {
  authorizationUrl: string;
  pendingState: ChatGptOAuthPendingState;
} {
  const codeVerifier = randomBase64Url(64);
  const state = randomBase64Url(32);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: chatGptOAuthClientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    codex_cli_simplified_flow: "true",
    id_token_add_organizations: "true",
    originator: "codex_cli_rs",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: chatGptOAuthScope,
    state
  });

  return {
    authorizationUrl: `${chatGptOAuthAuthorizeUrl}?${params.toString()}`,
    pendingState: {
      codeVerifier,
      createdAt: Date.now(),
      redirectUri,
      state
    }
  };
}

export async function exchangeChatGptOAuthCode({
  code,
  codeVerifier,
  fetcher = fetch,
  redirectUri
}: {
  code: string;
  codeVerifier: string;
  fetcher?: FetchLike;
  redirectUri: string;
}): Promise<ChatGptOAuthTokens> {
  const response = await fetcher(chatGptOAuthTokenUrl, {
    body: new URLSearchParams({
      client_id: chatGptOAuthClientId,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`ChatGPT OAuth token exchange failed with status ${response.status}.`);
  }

  return tokensFromResponse(await readTokenResponse(response));
}

export async function refreshChatGptOAuthTokens(
  tokens: ChatGptOAuthTokens,
  fetcher: FetchLike = fetch
): Promise<ChatGptOAuthTokens> {
  const response = await fetcher(chatGptOAuthTokenUrl, {
    body: JSON.stringify({
      client_id: chatGptOAuthClientId,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`ChatGPT OAuth token refresh failed with status ${response.status}.`);
  }

  return tokensFromResponse(await readTokenResponse(response), tokens);
}

export async function getFreshChatGptOAuthAccessToken(
  env: WorkspaceEnv = readWorkspaceEnv(),
  fetcher: FetchLike = fetch,
  persistTokens: (tokens: ChatGptOAuthTokens) => Promise<void> = saveChatGptOAuthTokens
): Promise<string | undefined> {
  if (!isChatGptOAuthEnabled(env)) {
    return undefined;
  }

  const tokens = getStoredChatGptOAuthTokens(env);

  if (!tokens) {
    return undefined;
  }

  if (tokens.expiry > Date.now() + refreshWindowMs) {
    return tokens.access;
  }

  const refreshed = await refreshChatGptOAuthTokens(tokens, fetcher);
  await persistTokens(refreshed);
  return refreshed.access;
}

export async function saveChatGptOAuthTokens(tokens: ChatGptOAuthTokens): Promise<void> {
  await upsertWorkspaceEnv({
    [chatGptOAuthTokensEnvKey]: encodeChatGptOAuthTokens(tokens)
  });
}

export async function clearChatGptOAuthTokens(): Promise<void> {
  await deleteWorkspaceEnv([chatGptOAuthTokensEnvKey]);
}

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

export function encodeChatGptOAuthPendingState(state: ChatGptOAuthPendingState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function parseChatGptOAuthPendingState(value: string | undefined): ChatGptOAuthPendingState | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ChatGptOAuthPendingState>;

    if (
      typeof parsed.codeVerifier === "string" &&
      parsed.codeVerifier.length > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt) &&
      typeof parsed.redirectUri === "string" &&
      parsed.redirectUri.length > 0 &&
      typeof parsed.state === "string" &&
      parsed.state.length > 0
    ) {
      return {
        codeVerifier: parsed.codeVerifier,
        createdAt: parsed.createdAt,
        redirectUri: parsed.redirectUri,
        state: parsed.state
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function isChatGptOAuthPendingStateExpired(state: ChatGptOAuthPendingState, now = Date.now()): boolean {
  return state.createdAt + pendingStateTtlMs < now;
}

async function readTokenResponse(response: Response): Promise<OAuthTokenResponse> {
  const parsed = (await response.json()) as OAuthTokenResponse;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("ChatGPT OAuth token response was not JSON.");
  }

  return parsed;
}

function tokensFromResponse(response: OAuthTokenResponse, existing?: ChatGptOAuthTokens): ChatGptOAuthTokens {
  const access = response.access_token ?? existing?.access;
  const refresh = response.refresh_token ?? existing?.refresh;

  if (!access || !refresh) {
    throw new Error("ChatGPT OAuth token response did not include usable credentials.");
  }

  return {
    access,
    expiry: tokenExpiry(access, response.expires_in, existing?.expiry),
    refresh
  };
}

function tokenExpiry(accessToken: string, expiresIn: number | undefined, previousExpiry: number | undefined): number {
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
    return Date.now() + expiresIn * 1000;
  }

  const jwtExpiry = jwtExpiryMs(accessToken);

  if (jwtExpiry) {
    return jwtExpiry;
  }

  return previousExpiry && previousExpiry > Date.now() ? previousExpiry : Date.now() + fallbackExpiryMs;
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

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}
