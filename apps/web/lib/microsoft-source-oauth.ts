import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import {
  readWorkspaceEnv,
  type WorkspaceEnv
} from "@/lib/workspace-env";

type FetchLike = typeof fetch;

export interface MicrosoftSourceAccount {
  email?: string;
  id: string;
  name?: string;
}

export interface MicrosoftSourceOAuthTokens {
  accessToken: string;
  account?: MicrosoftSourceAccount;
  expiresAt: number;
  refreshToken: string;
}

export interface MicrosoftSourceOAuthPendingState {
  codeVerifier: string;
  createdAt: number;
  redirectUri: string;
  state: string;
}

interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  encryptionSecret: string;
}

interface MicrosoftTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface MicrosoftGraphCollection {
  value?: unknown[];
}

interface MicrosoftGraphProfile {
  displayName?: string;
  id?: string;
  mail?: string;
  userPrincipalName?: string;
}

export const microsoftSourceOAuthPendingCookie = "ai_finances_microsoft_source_oauth";
export const microsoftSourceOAuthTokensStateKey = "microsoft_source_oauth_tokens_v1";
export const microsoftSourceOAuthAuthorizeUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const microsoftSourceOAuthTokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const microsoftGraphBaseUrl = "https://graph.microsoft.com/v1.0";

const microsoftSourceScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Calendars.Read"
];
const pendingStateTtlMs = 10 * 60 * 1000;
const refreshWindowMs = 5 * 60 * 1000;
const fallbackExpiryMs = 60 * 60 * 1000;

async function readStoredOAuthValue(): Promise<string | undefined> {
  const { readSyncStateValue } = await import("@/lib/db/finance-db");
  return readSyncStateValue(microsoftSourceOAuthTokensStateKey);
}

async function writeStoredOAuthValue(value: string): Promise<void> {
  const { writeSyncStateValue } = await import("@/lib/db/finance-db");
  await writeSyncStateValue(microsoftSourceOAuthTokensStateKey, value);
}

async function deleteStoredOAuthValue(): Promise<void> {
  const { deleteSyncStateValue } = await import("@/lib/db/finance-db");
  await deleteSyncStateValue(microsoftSourceOAuthTokensStateKey);
}

export function isMicrosoftSourceOAuthConfigured(env: WorkspaceEnv = readWorkspaceEnv()): boolean {
  return microsoftOAuthConfig(env) !== undefined;
}

export async function microsoftSourceOAuthStatus(env: WorkspaceEnv = readWorkspaceEnv()): Promise<{
  accountEmail?: string;
  accountName?: string;
  configured: boolean;
  connected: boolean;
  expiresAt?: string;
}> {
  const config = microsoftOAuthConfig(env);
  const tokens = config ? await getStoredMicrosoftSourceOAuthTokens(env) : undefined;

  return {
    accountEmail: tokens?.account?.email,
    accountName: tokens?.account?.name,
    configured: config !== undefined,
    connected: tokens !== undefined,
    expiresAt: tokens ? new Date(tokens.expiresAt).toISOString() : undefined
  };
}

export function createMicrosoftSourceOAuthStart(
  redirectUri: string,
  env: WorkspaceEnv = readWorkspaceEnv()
): {
  authorizationUrl: string;
  pendingState: MicrosoftSourceOAuthPendingState;
} {
  const config = requireMicrosoftOAuthConfig(env);
  const codeVerifier = randomBytes(64).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: config.clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    redirect_uri: redirectUri,
    response_mode: "query",
    response_type: "code",
    scope: microsoftSourceScopes.join(" "),
    state
  });

  return {
    authorizationUrl: `${microsoftSourceOAuthAuthorizeUrl}?${params.toString()}`,
    pendingState: {
      codeVerifier,
      createdAt: Date.now(),
      redirectUri,
      state
    }
  };
}

export function encodeMicrosoftSourceOAuthPendingState(
  pending: MicrosoftSourceOAuthPendingState,
  env: WorkspaceEnv = readWorkspaceEnv()
): string {
  return sealJson(pending, requireMicrosoftOAuthConfig(env).encryptionSecret);
}

export function parseMicrosoftSourceOAuthPendingState(
  value: string | undefined,
  env: WorkspaceEnv = readWorkspaceEnv()
): MicrosoftSourceOAuthPendingState | undefined {
  const config = microsoftOAuthConfig(env);

  if (!value || !config) {
    return undefined;
  }

  const parsed = unsealJson<Partial<MicrosoftSourceOAuthPendingState>>(value, config.encryptionSecret);

  if (
    parsed &&
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

  return undefined;
}

export function isMicrosoftSourceOAuthPendingStateExpired(
  pending: MicrosoftSourceOAuthPendingState,
  now = Date.now()
): boolean {
  return pending.createdAt + pendingStateTtlMs < now;
}

export async function exchangeMicrosoftSourceOAuthCode({
  code,
  codeVerifier,
  env = readWorkspaceEnv(),
  fetcher = fetch,
  redirectUri
}: {
  code: string;
  codeVerifier: string;
  env?: WorkspaceEnv;
  fetcher?: FetchLike;
  redirectUri: string;
}): Promise<MicrosoftSourceOAuthTokens> {
  const config = requireMicrosoftOAuthConfig(env);
  const response = await fetcher(microsoftSourceOAuthTokenUrl, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      scope: microsoftSourceScopes.join(" ")
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Microsoft OAuth token exchange failed with status ${response.status}.`);
  }

  return tokensFromResponse(await readTokenResponse(response));
}

export async function attachMicrosoftSourceAccount(
  tokens: MicrosoftSourceOAuthTokens,
  fetcher: FetchLike = fetch
): Promise<MicrosoftSourceOAuthTokens> {
  const response = await fetcher(`${microsoftGraphBaseUrl}/me?$select=id,displayName,mail,userPrincipalName`, {
    headers: graphHeaders(tokens.accessToken)
  });

  if (!response.ok) {
    throw new Error(`Microsoft Graph profile read failed with status ${response.status}.`);
  }

  const profile = (await response.json()) as MicrosoftGraphProfile;

  if (!profile.id) {
    throw new Error("Microsoft Graph profile response did not include an account id.");
  }

  return {
    ...tokens,
    account: {
      email: profile.mail ?? profile.userPrincipalName,
      id: profile.id,
      name: profile.displayName
    }
  };
}

export async function getStoredMicrosoftSourceOAuthTokens(
  env: WorkspaceEnv = readWorkspaceEnv()
): Promise<MicrosoftSourceOAuthTokens | undefined> {
  const config = microsoftOAuthConfig(env);

  if (!config) {
    return undefined;
  }

  return parseStoredTokens(await readStoredOAuthValue(), config.encryptionSecret);
}

export async function saveMicrosoftSourceOAuthTokens(
  tokens: MicrosoftSourceOAuthTokens,
  env: WorkspaceEnv = readWorkspaceEnv()
): Promise<void> {
  const config = requireMicrosoftOAuthConfig(env);
  await writeStoredOAuthValue(sealJson(tokens, config.encryptionSecret));
}

export async function clearMicrosoftSourceOAuthTokens(): Promise<void> {
  await deleteStoredOAuthValue();
}

export async function getFreshMicrosoftSourceAccessToken(
  env: WorkspaceEnv = readWorkspaceEnv(),
  fetcher: FetchLike = fetch,
  persistTokens: (tokens: MicrosoftSourceOAuthTokens, env?: WorkspaceEnv) => Promise<void> = saveMicrosoftSourceOAuthTokens,
  readTokens: (env?: WorkspaceEnv) => Promise<MicrosoftSourceOAuthTokens | undefined> = getStoredMicrosoftSourceOAuthTokens
): Promise<string | undefined> {
  const config = microsoftOAuthConfig(env);

  if (!config) {
    return undefined;
  }

  const tokens = await readTokens(env);

  if (!tokens) {
    return undefined;
  }

  if (tokens.expiresAt > Date.now() + refreshWindowMs) {
    return tokens.accessToken;
  }

  const response = await fetcher(microsoftSourceOAuthTokenUrl, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      scope: microsoftSourceScopes.join(" ")
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Microsoft OAuth token refresh failed with status ${response.status}.`);
  }

  const refreshed = tokensFromResponse(await readTokenResponse(response), tokens);
  await persistTokens(refreshed, env);
  return refreshed.accessToken;
}

export async function fetchMicrosoftSourceRecords(
  env: WorkspaceEnv = readWorkspaceEnv(),
  fetcher: FetchLike = fetch
): Promise<unknown[]> {
  const accessToken = await getFreshMicrosoftSourceAccessToken(env, fetcher);

  if (!accessToken) {
    throw new Error("Outlook is not connected. Connect a Microsoft account in Settings first.");
  }

  const messageUrl = new URL(`${microsoftGraphBaseUrl}/me/messages`);
  messageUrl.searchParams.set("$select", "id,subject,from,sender,receivedDateTime,bodyPreview,importance,inferenceClassification");
  messageUrl.searchParams.set("$orderby", "receivedDateTime desc");
  messageUrl.searchParams.set("$top", "200");

  const now = Date.now();
  const calendarUrl = new URL(`${microsoftGraphBaseUrl}/me/calendarView`);
  calendarUrl.searchParams.set("startDateTime", new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString());
  calendarUrl.searchParams.set("endDateTime", new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString());
  calendarUrl.searchParams.set("$select", "id,subject,start,end,organizer,location,bodyPreview,isCancelled");
  calendarUrl.searchParams.set("$orderby", "start/dateTime desc");
  calendarUrl.searchParams.set("$top", "50");

  const [messages, events] = await Promise.all([
    readGraphCollection(messageUrl, accessToken, fetcher, "message"),
    readGraphCollection(calendarUrl, accessToken, fetcher, "calendar")
  ]);

  return [...messages, ...events];
}

function microsoftOAuthConfig(env: WorkspaceEnv): MicrosoftOAuthConfig | undefined {
  const clientId = env.MICROSOFT_SOURCE_CLIENT_ID?.trim();
  const clientSecret = env.MICROSOFT_SOURCE_CLIENT_SECRET?.trim();
  const encryptionSecret = (env.MICROSOFT_SOURCE_TOKEN_ENCRYPTION_KEY ?? env.BETTER_AUTH_SECRET)?.trim();

  if (!clientId || !clientSecret || !encryptionSecret) {
    return undefined;
  }

  return { clientId, clientSecret, encryptionSecret };
}

function requireMicrosoftOAuthConfig(env: WorkspaceEnv): MicrosoftOAuthConfig {
  const config = microsoftOAuthConfig(env);

  if (!config) {
    throw new Error(
      "Microsoft source OAuth requires MICROSOFT_SOURCE_CLIENT_ID, MICROSOFT_SOURCE_CLIENT_SECRET, and BETTER_AUTH_SECRET or MICROSOFT_SOURCE_TOKEN_ENCRYPTION_KEY."
    );
  }

  return config;
}

async function readGraphCollection(
  url: URL,
  accessToken: string,
  fetcher: FetchLike,
  label: string
): Promise<unknown[]> {
  const response = await fetcher(url, {
    headers: graphHeaders(accessToken)
  });

  if (!response.ok) {
    throw new Error(`Microsoft Graph ${label} read failed with status ${response.status}.`);
  }

  const body = (await response.json()) as MicrosoftGraphCollection;
  return Array.isArray(body.value) ? body.value : [];
}

function graphHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Prefer: 'outlook.body-content-type="text"'
  };
}

async function readTokenResponse(response: Response): Promise<MicrosoftTokenResponse> {
  const parsed = (await response.json()) as MicrosoftTokenResponse;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Microsoft OAuth token response was not JSON.");
  }

  return parsed;
}

function tokensFromResponse(
  response: MicrosoftTokenResponse,
  existing?: MicrosoftSourceOAuthTokens
): MicrosoftSourceOAuthTokens {
  const accessToken = response.access_token ?? existing?.accessToken;
  const refreshToken = response.refresh_token ?? existing?.refreshToken;

  if (!accessToken || !refreshToken) {
    throw new Error("Microsoft OAuth token response did not include usable credentials.");
  }

  return {
    accessToken,
    account: existing?.account,
    expiresAt:
      typeof response.expires_in === "number" && Number.isFinite(response.expires_in) && response.expires_in > 0
        ? Date.now() + response.expires_in * 1000
        : Date.now() + fallbackExpiryMs,
    refreshToken
  };
}

function parseStoredTokens(value: string | undefined, secret: string): MicrosoftSourceOAuthTokens | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = unsealJson<Partial<MicrosoftSourceOAuthTokens>>(value, secret);

  if (
    parsed &&
    typeof parsed.accessToken === "string" &&
    parsed.accessToken.length > 0 &&
    typeof parsed.refreshToken === "string" &&
    parsed.refreshToken.length > 0 &&
    typeof parsed.expiresAt === "number" &&
    Number.isFinite(parsed.expiresAt)
  ) {
    return {
      accessToken: parsed.accessToken,
      account: parseAccount(parsed.account),
      expiresAt: parsed.expiresAt,
      refreshToken: parsed.refreshToken
    };
  }

  return undefined;
}

function parseAccount(value: unknown): MicrosoftSourceAccount | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const account = value as Partial<MicrosoftSourceAccount>;

  if (typeof account.id !== "string" || account.id.length === 0) {
    return undefined;
  }

  return {
    email: typeof account.email === "string" ? account.email : undefined,
    id: account.id,
    name: typeof account.name === "string" ? account.name : undefined
  };
}

function sealJson(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function unsealJson<T>(value: string, secret: string): T | undefined {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");

    if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
      return undefined;
    }

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    return undefined;
  }
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(`ai-finances:microsoft-source-oauth:v1:${secret}`).digest();
}
