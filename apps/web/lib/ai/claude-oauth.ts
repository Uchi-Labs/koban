import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readWorkspaceEnv, type WorkspaceEnv } from "@/lib/workspace-env";

type FetchLike = typeof fetch;

/**
 * Claude Pro/Max subscription credentials, the way Claude Code, hermes-agent and
 * opencode hold them: an OAuth access token sent as `Authorization: Bearer` to
 * Anthropic's Messages API. Three sources, in order:
 *
 * 1. A token stored in sync_state by Settings: a pasted `claude setup-token`
 *    (long-lived, no refresh token) or an OAuth PKCE login (refreshed here).
 * 2. `CLAUDE_CODE_OAUTH_TOKEN` in the environment (static).
 * 3. Claude Code's own login in `~/.claude/.credentials.json`, read live and
 *    never refreshed by this app: refreshing rotates the single-use refresh
 *    token Claude Code also holds, so an expired borrowed login is reported as
 *    expired instead.
 */

export const claudeOAuthTokensStateKey = "claude_oauth_tokens_v1";
const claudeOAuthPendingStateKey = "claude_oauth_pending_login_v1";

export const claudeOAuthClientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
// platform.claude.com is the live token host; console.anthropic.com is kept as a fallback.
export const claudeOAuthTokenUrls = [
  "https://platform.claude.com/v1/oauth/token",
  "https://console.anthropic.com/v1/oauth/token"
];
const claudeOAuthAuthorizeUrl = "https://claude.ai/oauth/authorize";
export const claudeOAuthRedirectUri = "https://console.anthropic.com/oauth/code/callback";
const claudeOAuthScopes = "org:create_api_key user:profile user:inference";
// Anthropic rate-limits token-endpoint requests whose user agent starts with
// `claude-code/`; the CLI itself uses a bare axios agent there.
const claudeOAuthTokenUserAgent = "axios/1.7.9";
const pendingLoginTtlMs = 10 * 60 * 1000;
// Refresh a minute early so a token never expires mid-request.
const expiryBufferMs = 60_000;

export type ClaudeCredentialSource = "oauth_login" | "setup_token" | "env" | "claude_code";

export interface StoredClaudeTokens {
  accessToken: string;
  /** Epoch ms; absent for setup tokens, which last a year and cannot be refreshed. */
  expiresAt?: number;
  refreshToken?: string;
  source: "oauth_login" | "setup_token";
  version: number;
}

export interface ClaudeCredential {
  accessToken: string;
  expiresAt?: number;
  source: ClaudeCredentialSource;
}

export interface ClaudeConnectionState {
  connected: boolean;
  errorMessage?: string;
  expiresAt?: string;
  source?: ClaudeCredentialSource;
}

export class ClaudeCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCredentialError";
  }
}

/**
 * True for Anthropic OAuth and setup tokens (`sk-ant-oat…`). Console API keys
 * (`sk-ant-api…`) bill per token and authenticate with `x-api-key`; sending
 * them with the Claude Code identity would be wrong, so they are refused.
 */
export function isClaudeOAuthToken(token: string): boolean {
  const value = token.trim();

  if (value.startsWith("sk-ant-api") || value.startsWith("sk-ant-admin")) {
    return false;
  }

  return value.startsWith("sk-ant-oat");
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function encodeStoredClaudeTokens(tokens: StoredClaudeTokens): string {
  return Buffer.from(JSON.stringify(tokens), "utf8").toString("base64");
}

export function decodeStoredClaudeTokens(raw: string | undefined): StoredClaudeTokens | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Partial<StoredClaudeTokens>;

    if (
      typeof parsed.accessToken === "string" &&
      parsed.accessToken.length > 0 &&
      (parsed.source === "oauth_login" || parsed.source === "setup_token") &&
      typeof parsed.version === "number"
    ) {
      return {
        accessToken: parsed.accessToken,
        expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined,
        refreshToken: typeof parsed.refreshToken === "string" && parsed.refreshToken ? parsed.refreshToken : undefined,
        source: parsed.source,
        version: parsed.version
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function loadStoredTokens(): Promise<StoredClaudeTokens | null> {
  const { readSyncStateValue } = await import("@/lib/db/finance-db");
  return decodeStoredClaudeTokens(await readSyncStateValue(claudeOAuthTokensStateKey));
}

/** Writes `next` only if the stored version still equals `expectedVersion`; returns what is stored afterwards. */
async function compareAndSwapTokens(
  expectedVersion: number,
  next: Omit<StoredClaudeTokens, "version">
): Promise<{ ok: boolean; current: StoredClaudeTokens | null }> {
  const { withLockedSyncStateValue } = await import("@/lib/db/finance-db");
  return withLockedSyncStateValue<{ ok: boolean; current: StoredClaudeTokens | null }>(claudeOAuthTokensStateKey, async (raw) => {
    const current = decodeStoredClaudeTokens(raw);

    if ((current?.version ?? 0) !== expectedVersion) {
      return { result: { ok: false, current }, value: raw ?? "" };
    }

    const stored = { ...next, version: expectedVersion + 1 };
    return { result: { ok: true, current: stored }, value: encodeStoredClaudeTokens(stored) };
  });
}

export async function saveClaudeSetupToken(token: string): Promise<void> {
  const value = token.trim();

  if (!isClaudeOAuthToken(value)) {
    throw new ClaudeCredentialError(
      "That is not a Claude subscription token. Run `claude setup-token` and paste the sk-ant-oat… token it prints."
    );
  }

  const current = await loadStoredTokens();
  await compareAndSwapTokens(current?.version ?? 0, { accessToken: value, source: "setup_token" });
}

export async function clearClaudeOAuthTokens(): Promise<void> {
  const { deleteSyncStateValue } = await import("@/lib/db/finance-db");
  await deleteSyncStateValue(claudeOAuthTokensStateKey);
  await deleteSyncStateValue(claudeOAuthPendingStateKey);
}

// ---------------------------------------------------------------------------
// Claude Code login (borrowed, read-only)
// ---------------------------------------------------------------------------

export function claudeCodeCredentialsPath(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  return join(override || join(homedir(), ".claude"), ".credentials.json");
}

export function readClaudeCodeCredential(path = claudeCodeCredentialsPath()): ClaudeCredential | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown };
    };
    const accessToken = parsed.claudeAiOauth?.accessToken;
    const expiresAt = parsed.claudeAiOauth?.expiresAt;

    if (typeof accessToken !== "string" || !isClaudeOAuthToken(accessToken)) {
      return null;
    }

    return {
      accessToken,
      expiresAt: typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : undefined,
      source: "claude_code"
    };
  } catch {
    return null;
  }
}

function isUsableClaudeCodeLoginAllowed(env: WorkspaceEnv): boolean {
  return env.AI_FINANCES_CLAUDE_USE_CLAUDE_CODE_LOGIN?.trim() !== "0";
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export interface ClaudeTokenEndpointResult {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

async function postTokenEndpoint(
  payload: Record<string, string>,
  fetcher: FetchLike,
  what: string
): Promise<ClaudeTokenEndpointResult> {
  let lastError: Error | undefined;

  for (const url of claudeOAuthTokenUrls) {
    let response: Response;

    try {
      response = await fetcher(url, {
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json", "user-agent": claudeOAuthTokenUserAgent },
        method: "POST",
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      lastError = new ClaudeCredentialError(
        `Claude token ${what} failed: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    const body = (await response.json().catch(() => ({}))) as {
      access_token?: unknown;
      error?: unknown;
      error_description?: unknown;
      expires_in?: unknown;
      refresh_token?: unknown;
    };

    if (response.ok && typeof body.access_token === "string" && body.access_token) {
      const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
      return {
        accessToken: body.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
        refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : undefined
      };
    }

    const code = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    const description = typeof body.error_description === "string" ? ` (${body.error_description})` : "";
    lastError = new ClaudeCredentialError(`Claude token ${what} failed: ${code}${description}`);

    // A rejected grant is rejected at every host; replaying it only spends it again.
    if (code === "invalid_grant" || code === "invalid_token" || code === "refresh_token_reused") {
      break;
    }
  }

  throw lastError ?? new ClaudeCredentialError(`Claude token ${what} failed.`);
}

export function refreshClaudeOAuthToken(refreshToken: string, fetcher: FetchLike = fetch) {
  return postTokenEndpoint(
    { client_id: claudeOAuthClientId, grant_type: "refresh_token", refresh_token: refreshToken },
    fetcher,
    "refresh"
  );
}

// ---------------------------------------------------------------------------
// Access-token resolution with refresh
// ---------------------------------------------------------------------------

function isExpired(expiresAt: number | undefined, now: number): boolean {
  return expiresAt !== undefined && expiresAt - expiryBufferMs <= now;
}

let refreshInFlight: Promise<ClaudeCredential> | null = null;

async function refreshStored(stored: StoredClaudeTokens, fetcher: FetchLike): Promise<ClaudeCredential> {
  if (!stored.refreshToken) {
    throw new ClaudeCredentialError("The stored Claude token has expired. Connect your Claude subscription again in Settings.");
  }

  const refreshed = await refreshClaudeOAuthToken(stored.refreshToken, fetcher);
  const swap = await compareAndSwapTokens(stored.version, {
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    refreshToken: refreshed.refreshToken ?? stored.refreshToken,
    source: stored.source
  });
  // Lost the race: another instance refreshed first and its token is the live one.
  const winner = swap.current;

  if (!winner) {
    throw new ClaudeCredentialError("The Claude subscription was disconnected while refreshing.");
  }

  return { accessToken: winner.accessToken, expiresAt: winner.expiresAt, source: winner.source };
}

/**
 * The access token to send right now. `forceRefresh` is used after a 401 on a
 * token that looked valid; it only applies to OAuth logins that can refresh.
 */
export async function resolveClaudeAccessToken(
  options: { env?: WorkspaceEnv; fetcher?: FetchLike; forceRefresh?: boolean; now?: number } = {}
): Promise<ClaudeCredential> {
  const env = options.env ?? readWorkspaceEnv();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const stored = await loadStoredTokens();

  if (stored) {
    if (!options.forceRefresh && !isExpired(stored.expiresAt, now)) {
      return { accessToken: stored.accessToken, expiresAt: stored.expiresAt, source: stored.source };
    }

    if (!refreshInFlight) {
      refreshInFlight = refreshStored(stored, fetcher).finally(() => {
        refreshInFlight = null;
      });
    }

    return refreshInFlight;
  }

  const envToken = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();

  if (envToken && isClaudeOAuthToken(envToken)) {
    return { accessToken: envToken, source: "env" };
  }

  if (isUsableClaudeCodeLoginAllowed(env)) {
    const borrowed = readClaudeCodeCredential();

    if (borrowed) {
      if (isExpired(borrowed.expiresAt, now)) {
        throw new ClaudeCredentialError(
          "Your Claude Code login has expired. Open Claude Code once to renew it, or connect your Claude subscription in Settings."
        );
      }

      return borrowed;
    }
  }

  throw new ClaudeCredentialError("No Claude subscription is connected. Connect it in Settings.");
}

/** What Settings and readiness show; never includes a token. */
export async function claudeConnectionState(
  env: WorkspaceEnv = readWorkspaceEnv(),
  now = Date.now()
): Promise<ClaudeConnectionState> {
  const stored = await loadStoredTokens();

  if (stored) {
    if (isExpired(stored.expiresAt, now) && !stored.refreshToken) {
      return {
        connected: false,
        errorMessage: "The stored Claude token has expired. Connect again.",
        source: stored.source
      };
    }

    return {
      connected: true,
      expiresAt: stored.expiresAt ? new Date(stored.expiresAt).toISOString() : undefined,
      source: stored.source
    };
  }

  const envToken = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();

  if (envToken && isClaudeOAuthToken(envToken)) {
    return { connected: true, source: "env" };
  }

  if (isUsableClaudeCodeLoginAllowed(env)) {
    const borrowed = readClaudeCodeCredential();

    if (borrowed) {
      return isExpired(borrowed.expiresAt, now)
        ? {
            connected: false,
            errorMessage: "Your Claude Code login has expired. Open Claude Code once to renew it, or connect here.",
            source: "claude_code"
          }
        : {
            connected: true,
            expiresAt: borrowed.expiresAt ? new Date(borrowed.expiresAt).toISOString() : undefined,
            source: "claude_code"
          };
    }
  }

  return { connected: false };
}

// ---------------------------------------------------------------------------
// OAuth PKCE login (authorization code shown by Anthropic, pasted back)
// ---------------------------------------------------------------------------

interface PendingClaudeLogin {
  createdAt: number;
  state: string;
  verifier: string;
}

export function createClaudePkcePair(): { challenge: string; verifier: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { challenge, verifier };
}

export function buildClaudeAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: claudeOAuthClientId,
    code: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: claudeOAuthRedirectUri,
    response_type: "code",
    scope: claudeOAuthScopes,
    state
  });
  return `${claudeOAuthAuthorizeUrl}?${params.toString()}`;
}

export async function startClaudeOAuthLogin(): Promise<{ url: string }> {
  const { writeSyncStateValue } = await import("@/lib/db/finance-db");
  const { challenge, verifier } = createClaudePkcePair();
  const state = randomBytes(32).toString("base64url");
  const pending: PendingClaudeLogin = { createdAt: Date.now(), state, verifier };
  await writeSyncStateValue(claudeOAuthPendingStateKey, Buffer.from(JSON.stringify(pending)).toString("base64"));
  return { url: buildClaudeAuthorizeUrl(challenge, state) };
}

/** Splits the `code#state` string Anthropic's callback page shows. */
export function parseClaudeAuthorizationCode(value: string): { code: string; state: string } {
  const [code = "", state = ""] = value.trim().split("#");
  return { code: code.trim(), state: state.trim() };
}

export async function finishClaudeOAuthLogin(pasted: string, fetcher: FetchLike = fetch): Promise<void> {
  const { deleteSyncStateValue, readSyncStateValue } = await import("@/lib/db/finance-db");
  const raw = await readSyncStateValue(claudeOAuthPendingStateKey);
  let pending: PendingClaudeLogin | null = null;

  try {
    pending = raw ? (JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as PendingClaudeLogin) : null;
  } catch {
    pending = null;
  }

  if (!pending || pending.createdAt + pendingLoginTtlMs < Date.now()) {
    throw new ClaudeCredentialError("This Claude sign-in has expired. Start it again.");
  }

  const { code, state } = parseClaudeAuthorizationCode(pasted);

  if (!code) {
    throw new ClaudeCredentialError("Paste the code Anthropic showed after you approved access.");
  }

  // CSRF guard: the code must come back with the state this login sent.
  if (state !== pending.state) {
    throw new ClaudeCredentialError("That code belongs to a different sign-in attempt. Start again and paste the new code.");
  }

  const result = await postTokenEndpoint(
    {
      client_id: claudeOAuthClientId,
      code,
      code_verifier: pending.verifier,
      grant_type: "authorization_code",
      redirect_uri: claudeOAuthRedirectUri,
      state
    },
    fetcher,
    "exchange"
  );
  const current = await loadStoredTokens();
  await compareAndSwapTokens(current?.version ?? 0, {
    accessToken: result.accessToken,
    expiresAt: result.expiresAt,
    refreshToken: result.refreshToken,
    source: "oauth_login"
  });
  await deleteSyncStateValue(claudeOAuthPendingStateKey);
}
